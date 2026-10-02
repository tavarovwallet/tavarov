/* Сплошной обход приложения: каждый экран, каждая вкладка, вход-выход,
   восстановление из фразы. Смотрим не только «не упало», но и что на
   экране действительно то, что должно быть. */
import { boot, reporter, unlock, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';

/* Резервная копия спрашивает подтверждение: без этого её можно было унести,
   обойдя разом и порог перевода, и смену пароля. В песочнице Face ID нет,
   поэтому подтверждаем паролем — ровно как человек за таким же устройством. */
async function passTotp(page){
  const open = await page.evaluate(() => {
    const m = document.getElementById('confirmModal');
    return !!m && !m.classList.contains('hidden');
  });
  if (!open) return false;
  await answerConfirm(page);
  await page.waitForTimeout(400);
  return true;
}


const srv = await start(8555);
const R = reporter();
const SHOTS = '/home/claude/apk/audit/shots';

const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 0.42, USDT: 87.5, TVR: 1500 };
state.vaults[me.toLowerCase()] = '0x5555555555555555555555555555555555555555';
state.balances['0x5555555555555555555555555555555555555555'] = { native: 0, USDT: 0, TVR: 0 };

const shot = (n) => page.screenshot({ path: SHOTS + '/' + n + '.png', fullPage: true });

// ---------- вкладки ----------
const tabs = [
  ['wallet',   '#dashCard',    'Кошелёк'],
  ['pay',      '#payHub',      'Оплата'],
  ['cashback', '#cashbackCard','Кешбэк'],
  ['history',  '#historyCard', 'История'],
  ['settings', '#settingsCard','Настройки']
];
for (const [t, sel, label] of tabs){
  await page.evaluate(x => setTab(x), t);
  await page.waitForTimeout(700);
  const vis = await page.isVisible(sel).catch(() => false);
  R.ok('вкладка «' + label + '» открывается', vis, sel);
  await shot('вкладка-' + t);
}

// ---------- быстрые действия ----------
await page.evaluate(() => setTab('wallet'));
for (const [kind, want] of [['deposit','receive'], ['withdraw','send'], ['transfer','send']]){
  await page.evaluate(k => quickAction(k), kind);
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ tab, actionTab, direct: payDirect,
    recv: !document.getElementById('receivePanel').classList.contains('hidden'),
    send: !document.getElementById('sendPanel').classList.contains('hidden') }));
  R.ok('«' + kind + '» ведёт на нужную панель', st.actionTab === want, JSON.stringify(st));
  R.ok('«' + kind + '» показывает только одну панель', st.recv !== st.send, JSON.stringify(st));
}

// стейкинг
await page.evaluate(() => quickAction('staking'));
await page.waitForTimeout(1500);
R.ok('шторка стейкинга открывается', await page.isVisible('#stakingModal'));
R.ok('в стейкинге видна ставка 8%', (await page.evaluate(() => document.getElementById('stakeBaseApy').textContent)).includes('8'));
await shot('стейкинг');
await page.evaluate(() => document.getElementById('stakingModal').classList.add('hidden'));

// ---------- шторки настроек ----------
await page.evaluate(() => setTab('settings'));
await page.waitForTimeout(400);
for (const [fn, sel, label] of [['openTokensSheet','#tokensModal','Другие валюты'],
                                 ['openPasswordSheet','#passwordModal','Смена пароля'],
                                 ['openBackupSheet','#backupModal','Резервная копия']]){
  page.evaluate(f => window[f](), fn);
  await page.waitForTimeout(600);
  await passTotp(page);
  R.ok('шторка «' + label + '» открывается', await page.isVisible(sel));
  await page.evaluate(s => document.querySelector(s).classList.add('hidden'), sel);
}

// ---------- экран токена ----------
await page.evaluate(() => setTab('wallet'));
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(2000);
const rows = await page.evaluate(() => document.querySelectorAll('#tokenList .row').length);
R.ok('в списке три строки: монета сети, TVR и USDT', rows === 3, 'строк ' + rows);
await page.evaluate(() => openToken('USDT'));
await page.waitForTimeout(800);
R.ok('экран токена открывается', await page.isVisible('#tokenCard'));
R.ok('на экране токена виден баланс',
  (await page.evaluate(() => document.getElementById('tkBalance').textContent)).includes('87.5'));
await shot('токен-usdt');
await page.evaluate(() => closeToken());

// ---------- вход по паролю ----------
await page.evaluate(() => { wallet = null; sessionPassword = null; flowStage = 'lock'; renderWalletState(); });
await page.waitForTimeout(400);
R.ok('после блокировки просят пароль', await page.isVisible('#lockCard'));
await page.fill('#unlockPass', 'неверныйпароль');
await page.evaluate(() => doUnlock());
await page.waitForTimeout(1500);
R.ok('неверный пароль не пускает', await page.isVisible('#lockCard'));
R.ok('о неверном пароле сказано', await page.isVisible('#unlockError'));
/* Кода при входе больше нет: он спрашивается при оплате и на опасных
   действиях. Вход открывает пароль — и только он. Проверяем, что второй
   рубеж не переехал обратно на вход: подтверждать каждый вход люди не
   терпят — они выключают защиту целиком. */
await unlock(page);
await page.waitForTimeout(2000);
R.ok('верный пароль пускает', await page.evaluate(() => flowStage === 'ready'));
R.ok('ПОДТВЕРЖДЕНИЯ ПРИ ВХОДЕ НЕ СПРАШИВАЮТ',
  await page.evaluate(() => document.getElementById('confirmModal').classList.contains('hidden')));
R.ok('адрес после входа тот же',
  (await page.evaluate(() => wallet.evm.address)) === me);

// ---------- восстановление из фразы ----------
const seedPage = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });
await seedPage.page.evaluate(() => { chooseRole('buyer'); flowStage='setup'; renderWalletState(); showSetup('import'); showImportMode('seed'); });
await seedPage.page.waitForTimeout(500);
await seedPage.page.fill('#importSeedInput', 'test test test test test test test test test test test junk');
await seedPage.page.evaluate(() => doImport());
await seedPage.page.waitForTimeout(2500);
const imported = await seedPage.page.evaluate(() => flowStage);
R.ok('известная фраза принимается', imported === 'protect', 'стадия ' + imported);
if (imported === 'protect'){
  await seedPage.page.fill('#newPass', 'testpassword1');
  await seedPage.page.fill('#newPass2', 'testpassword1');
  await seedPage.page.evaluate(() => savePassword());
  await seedPage.page.waitForTimeout(1500);
  await seedPage.page.evaluate(() => { if (flowStage === 'totp-setup') skipTotpSetup(); });
  await seedPage.page.waitForTimeout(1200);
  // адрес этой фразы известен заранее
  R.ok('адрес выведен из фразы правильно',
    (await seedPage.page.evaluate(() => wallet.evm.address)) === '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    await seedPage.page.evaluate(() => wallet.evm.address));
}
// короткая фраза не принимается
await seedPage.page.evaluate(() => { wallet=null; chooseRole('buyer'); flowStage='setup'; renderWalletState(); showSetup('import'); showImportMode('seed'); });
await seedPage.page.waitForTimeout(400);
await seedPage.page.fill('#importSeedInput', 'test test test');
await seedPage.page.evaluate(() => doImport());
await seedPage.page.waitForTimeout(700);
R.ok('короткая фраза отклоняется', await seedPage.page.isVisible('#importError'));

// ---------- слабый пароль ----------
const p2 = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });
await p2.page.evaluate(() => chooseRole('buyer'));
await p2.page.evaluate(() => beginGenerate());
await p2.page.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
R.ok('фраза показана из 12 слов', true);
R.ok('кнопка «Продолжить» заблокирована, пока не отмечено «записал»',
  await p2.page.evaluate(() => document.getElementById('confirmSavedBtn').disabled));
await p2.page.evaluate(() => finishGenerate());
await p2.page.fill('#newPass', 'корот');
await p2.page.fill('#newPass2', 'корот');
await p2.page.evaluate(() => savePassword());
await p2.page.waitForTimeout(400);
R.ok('короткий пароль не принимается', await p2.page.isVisible('#protectError'));
await p2.page.fill('#newPass', 'testpassword1');
await p2.page.fill('#newPass2', 'другойпароль1');
await p2.page.evaluate(() => savePassword());
await p2.page.waitForTimeout(400);
R.ok('несовпадающие пароли не принимаются',
  (await p2.page.evaluate(() => document.getElementById('protectError').textContent)).includes('не совпадают'));

const clean = [...errors, ...seedPage.errors, ...p2.errors]
  .filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); await seedPage.browser.close(); await p2.browser.close(); srv.close();
process.exit(good ? 0 : 1);
