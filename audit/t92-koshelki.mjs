/* Несколько кошельков в одном приложении (1 октября 2026).

   Проверяется: на главном видно, какой кошелёк открыт; можно создать ещё
   один и отменить посреди; новый кошелёк открывается сам, прежний не
   теряется; переключение туда-обратно; добавление по фразе; тот же
   кошелёк второй раз не добавляется; переименование; убрать можно только
   не открытый и только с подтверждением; после выхода и входа по паролю
   все кошельки на месте; резервная копия содержит все; старое хранилище
   (один кошелёк, без номеров) открывается как «Кошелёк 1». */
import { boot, reporter, answerConfirm, unlock } from './boot.mjs';
import { start } from './mocknode.mjs';
await start(8592);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8592' });
const wait = ms => page.waitForTimeout(ms);
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);
const decrypt = () => page.evaluate(async () => decryptVault(localStorage.getItem(VAULT_KEY), 'testpassword1'));
page.on('dialog', d => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept(); });
const dialogs = []; let promptAnswer = '';

const first = await page.evaluate(() => wallet.evm.address);
R.ok('НА ГЛАВНОМ ВИДНО, КАКОЙ КОШЕЛЁК ОТКРЫТ', await vis('#walletChip') && (await page.textContent('#walletChipName')) === 'Кошелёк 1', await page.textContent('#walletChipName'));
R.ok('и выбор сети тут же, сверху', await vis('#dashCard #netPills') && (await page.$$eval('#dashCard #netPills .netpill', e => e.length)) === 4);
await page.click('#dashCard #netPills .netpill[data-net="eth"]'); await wait(200);
R.ok('нажал Ethereum на главном — сеть сменилась', await page.evaluate(() => network) === 'eth');
await page.click('#dashCard #netPills .netpill[data-net="bnb"]'); await wait(200);

// ---- создать и передумать ----
await page.click('#walletChip'); await wait(200);
R.ok('список кошельков открылся, в нём один — открытый', await vis('#walletsModal') && (await page.$$eval('#walletsList .wl-row', e => e.length)) === 1 &&
  /Сейчас открыт/.test(await page.textContent('#walletsList')));
await page.evaluate(() => startAddWallet('new')); await wait(300);
R.ok('«Создать новый» — показаны 12 слов нового кошелька', await vis('#mnemonicCard') && (await page.$$eval('#mnemonicGrid .mnemonic-word', e => e.length)) === 12);
R.ok('и есть «Отмена»', await vis('#mnemonicCancel'));
const back1 = await page.evaluate(() => window.nonGoBack());
await wait(200);
R.ok('«Назад» отменяет добавление: прежний кошелёк, слова стёрты', back1 === true && await page.evaluate(() => flowStage === 'ready' && wallet.evm.address) === first &&
  (await page.$$eval('#mnemonicGrid .mnemonic-word', e => e.length)) === 0);
R.ok('пароль при добавлении не спрашивали и хранилище не тронули', (await decrypt()).others === undefined);

// ---- создать ----
await page.evaluate(() => startAddWallet('new')); await wait(300);
await page.check('#savedCheck');
await page.evaluate(() => finishGenerate()); await page.waitForFunction(() => flowStage === 'ready' && !addingWallet);
const second = await page.evaluate(() => wallet.evm.address);
R.ok('НОВЫЙ КОШЕЛЁК СОЗДАН И ОТКРЫТ', second !== first && (await page.textContent('#walletChipName')) === 'Кошелёк 2', second);
R.ok('экрана «придумайте пароль» не было — пароль у приложения уже есть', !(await vis('#protectCard')) && await vis('#dashCard'));
let v = await decrypt();
R.ok('в хранилище: открыт второй, первый — в others со своей фразой', v.evm.address === second && v.others.length === 1 && v.others[0].evm.address === first && v.others[0].mnemonic.split(' ').length === 12 && v.n === 2 && v.others[0].n === 1);

// ---- переключение ----
await page.click('#walletChip'); await wait(200);
R.ok('в списке два кошелька по порядку', JSON.stringify(await page.$$eval('#walletsList .row-title', e => e.map(x => x.textContent))) === '["Кошелёк 1","Кошелёк 2"]');
await page.click('#walletsList .wl-row:not(.active)'); await page.waitForFunction(f => wallet.evm.address === f, first);
R.ok('ПЕРЕКЛЮЧИЛСЯ НА ПЕРВЫЙ', (await page.textContent('#walletChipName')) === 'Кошелёк 1' && await page.evaluate(() => document.getElementById('dashAddr').textContent).then(a => a.toLowerCase().includes(first.toLowerCase().slice(2, 10))));
v = await decrypt();
R.ok('и это сохранено', v.evm.address === first && v.others[0].evm.address === second);

// ---- добавить по фразе ----
const KNOWN = 'test test test test test test test test test test test junk';
await page.evaluate(() => startAddWallet('import')); await wait(200);
R.ok('«Добавить по фразе» — экран импорта, без восстановления из копии', await vis('#setupImport') && !(await vis('#setupTabRestore')) && await vis('#setupCancel'));
await page.fill('#importSeedInput', KNOWN);
await page.evaluate(() => doImport()); await page.waitForFunction(() => flowStage === 'ready' && !addingWallet);
R.ok('ДОБАВЛЕН ПО ФРАЗЕ — Кошелёк 3', (await page.evaluate(() => wallet.evm.address)) === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' && (await page.textContent('#walletChipName')) === 'Кошелёк 3');
R.ok('поля импорта очищены', (await page.inputValue('#importSeedInput')) === '');
dialogs.length = 0;
await page.evaluate(() => startAddWallet('import')); await wait(200);
await page.fill('#importSeedInput', KNOWN);
await page.evaluate(() => doImport()); await wait(600);
R.ok('тот же кошелёк второй раз не добавился — сказано словами', (await decrypt()).others.length === 2 && dialogs.some(d => /уже есть/.test(d)), dialogs.join(' | '));

// ---- переименовать ----
promptAnswer = '  Магазин‮  ';
await page.evaluate(() => { openWallets(); });
const ids = await page.evaluate(() => walletsAll().map(w => w.id));
await page.evaluate(id => renameWallet(id), ids[2]); await wait(300);
R.ok('ПЕРЕИМЕНОВАН, невидимые знаки вычищены', (await page.textContent('#walletChipName')) === 'Магазин' && (await decrypt()).name === 'Магазин', await page.textContent('#walletChipName'));

// ---- убрать ----
R.ok('у открытого кошелька кнопки «Убрать» нет', await page.evaluate(() => [...document.querySelectorAll('#walletsList .wl-row.active button')].map(b => b.title).join(',')) === 'Переименовать', await page.evaluate(() => document.getElementById('walletsList').innerHTML.slice(0, 300)));
const removing = page.evaluate(id => removeWallet(id), ids[1]);
await answerConfirm(page);
await removing; await wait(300);
v = await decrypt();
R.ok('УБРАН не открытый кошелёк — с подтверждением и предупреждением про фразу', v.others.length === 1 && v.others[0].evm.address === first && dialogs.some(d => /seed-фразе/.test(d)));
await page.evaluate(() => closeWallets());

// ---- копия и вход ----
const backup = await page.evaluate(() => localStorage.getItem(VAULT_KEY));
R.ok('резервная копия — всё хранилище, с остальными кошельками', /"data"/.test(backup) && (await decrypt()).others.length === 1);
await page.reload(); await page.waitForFunction(() => flowStage === 'lock');
await unlock(page);
R.ok('ПОСЛЕ ВХОДА ПО ПАРОЛЮ — ВСЕ КОШЕЛЬКИ НА МЕСТЕ', (await page.textContent('#walletChipName')) === 'Магазин' && await page.evaluate(() => walletsAll().length) === 2);

// ---- аудит 2.10.2026: одинаковые имена и две вкладки ----
const otherId = await page.evaluate(() => walletsAll().find(x => x.id !== wallet.id).id);
const activeName = await page.evaluate(() => walletName(wallet));
promptAnswer = activeName;
await page.evaluate(id => { openWallets(); return renameWallet(id); }, otherId); await wait(300);
R.ok('имя, как у другого кошелька, — не принято', /уже есть/.test(await page.textContent('#walletsError')) &&
  await page.evaluate(id => walletName(walletsAll().find(x => x.id === id)), otherId) !== activeName, await page.textContent('#walletsError'));
await page.evaluate(() => closeWallets());
const pageB = await page.context().newPage();
const errB = []; pageB.on('pageerror', e => errB.push(e.message));
await pageB.goto(page.url()); await pageB.waitForFunction(() => typeof flowStage !== 'undefined' && flowStage === 'lock', null, { timeout: 15000 });
await unlock(pageB);
promptAnswer = 'Вторая вкладка';
await page.evaluate(id => renameWallet(id), otherId); await wait(500);
R.ok('ДВЕ ВКЛАДКИ: в одной изменили кошельки — вторая заперлась (не затрёт свежее хранилище)', await pageB.evaluate(() => flowStage === 'lock' && wallet === null));
await unlock(pageB);
R.ok('после входа во второй вкладке — свежие данные', await pageB.evaluate(id => walletName(walletsAll().find(x => x.id === id)), otherId) === 'Вторая вкладка');
await pageB.close();
R.ok('во второй вкладке ошибок нет', errB.length === 0, errB.join(' | '));

// ---- старое хранилище ----
const old = await page.evaluate(async () => {
  const w = await walletFromMnemonicAll('test test test test test test test test test test test junk');
  await persistVault(w, 'testpassword1');
  const p = await decryptVault(localStorage.getItem(VAULT_KEY), 'testpassword1');
  wallet = p; renderWalletState();
  return { chip: document.getElementById('walletChipName').textContent, n: walletsAll().length };
});
R.ok('старое хранилище (один кошелёк, без номера) — «Кошелёк 1»', old.chip === 'Кошелёк 1' && old.n === 1, JSON.stringify(old));

const own = errors.filter(e => !/Failed to load resource|ERR_|net::|503/.test(e));
R.ok('ошибок в коде страницы нет', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
