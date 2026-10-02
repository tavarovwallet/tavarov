/* Приглашения продавцов — третья версия контракта оплаты.

   Правило простое и записано в контракте: продавец один раз, до первой
   продажи, называет того, кто его привёл, и год пятая часть нашей
   комиссии с его продаж уходит этому человеку. Здесь проверяется, что
   приложение пересказывает это правило честно и отправляет в сеть ровно
   ту операцию, которую нужно, — байт в байт.

   И отдельно — переезд на новую версию: старые покупки, возвраты по ним и
   несобранные бонусы остаются видны и работают через старый контракт. */
import { boot, reporter, answerConfirm, unlock, URL } from './boot.mjs';
import { start, state, paidLog, ADDR } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers
       || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const RPC = 'http://localhost:8561';
await start(8561);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: RPC });
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

const me = await page.evaluate(() => wallet.evm.address);
const REF = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4';
const OLD = '0x1111111111111111111111111111111111111111';
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
const iface = new E.utils.Interface(['function setReferrer(address)', 'function claimBonus()',
  'function refund(bytes32,uint256)', 'function approve(address,uint256)']);
const vis = sel => page.evaluate(s => { const el = document.querySelector(s);
  return !!el && !el.classList.contains('hidden') && !(el.closest('.hidden')); }, sel);
const cashback = async () => {
  await page.evaluate(() => { tab = 'wallet'; setTab('cashback'); });
  await page.evaluate(() => refreshReferral(true));
  await page.waitForTimeout(700);
};

// ======================= вторая версия: приглашений нет =======================
state.payVersion = 2;
await cashback();
R.ok('НА ВТОРОЙ ВЕРСИИ КОНТРАКТА ПРИГЛАШЕНИЙ НЕ ВИДНО — ОБЕЩАТЬ НЕЧЕГО', !(await vis('#refBox')));
R.ok('и о закреплении у кассы не напоминаем', !(await vis('#refPending')));

// ======================= ссылка приглашения =======================
state.payVersion = 3;
await page.goto(URL + '?ref=' + REF);
await page.waitForFunction(() => typeof window.renderWalletState === 'function');
await page.evaluate(url => { TESTNET.bnb.rpc = url; TESTNET.bnb.rpcs = [url]; MAINNET.bnb.rpc = url; MAINNET.bnb.rpcs = [url]; }, RPC);
R.ok('ССЫЛКА ПРИГЛАШЕНИЯ ЗАПОМНЕНА', await page.evaluate(r => (refStored() || {}).r === r, REF),
  await page.evaluate(() => JSON.stringify(refStored())));
R.ok('и убрана из адресной строки', await page.evaluate(() => !/ref=/.test(location.href)), await page.evaluate(() => location.href));
await unlock(page);
await page.waitForFunction(() => flowStage === 'ready');
await page.evaluate(url => { TESTNET.bnb.rpc = url; TESTNET.bnb.rpcs = [url]; }, RPC);

await page.evaluate(() => { tab = 'wallet'; setTab('pay'); });
await page.evaluate(() => refreshReferral(true));
await page.waitForTimeout(600);
R.ok('У КАССЫ НАПОМИНАНИЕ: ВАС ПРИГЛАСИЛИ, ЗАКРЕПИТЕ ДО ПЕРВОЙ ПРОДАЖИ', await vis('#refPending'),
  await page.evaluate(() => document.getElementById('refPending').innerText.replace(/\s+/g, ' ')));
R.ok('в напоминании — кто пригласил', /0x5B38/i.test(await page.textContent('#refPendingWho')));

await cashback();
R.ok('ВО ВКЛАДКЕ «КЕШБЭК» ЕСТЬ ПРИГЛАШЕНИЯ', await vis('#refBox'));
const link = await page.textContent('#refLink');
R.ok('МОЯ ССЫЛКА — НАШ ДОМЕН И МОЙ АДРЕС (страница приглашения для любого кошелька)', link === 'https://wallet.tavarov.com/ref?by=' + me, link);
R.ok('доля названа числом из контракта — 20%', /20% /.test(await page.textContent('#refShareLine')), await page.textContent('#refShareLine'));
R.ok('поступления можно проверить в обозревателе', /bscscan\.com\/address\/0x/i.test(await page.getAttribute('#refScanLink', 'href')));
R.ok('ПРОДАВЦУ ПРЕДЛОЖЕНО ЗАКРЕПИТЬ ПРИГЛАСИВШЕГО', await vis('#refBindBox'));
R.ok('поле уже заполнено адресом из ссылки', (await page.inputValue('#refInput')) === REF, await page.inputValue('#refInput'));

// ======================= что нельзя =======================
const bindMsg = () => page.textContent('#refBindMsg');
await page.fill('#refInput', me);
await page.evaluate(() => bindReferrer()); await page.waitForTimeout(300);
R.ok('СЕБЯ ПРИГЛАСИВШИМ НЕ НАЗВАТЬ — СКАЗАНО ДО ОПЕРАЦИИ', /Себя/.test(await bindMsg()), await bindMsg());
await page.fill('#refInput', '0x1234');
await page.evaluate(() => bindReferrer()); await page.waitForTimeout(300);
R.ok('кривой адрес — понятная ошибка', /42 знаков/.test(await bindMsg()), await bindMsg());
await page.fill('#refInput', 'nosuchname');
await page.evaluate(() => bindReferrer()); await page.waitForTimeout(1500);
R.ok('несуществующее имя — «такого имени нет»', /Такого имени нет/.test(await bindMsg()), await bindMsg());
R.ok('ни одна из попыток не ушла в сеть', state.sent.length === 0, state.sent.length);

// ======================= закрепление =======================
state.names['agent_bob'] = REF;
await page.fill('#refInput', '@agent_bob');
dialogs.length = 0;
page.evaluate(() => bindReferrer());
await answerConfirm(page, 'testpassword1', 12000);
await page.waitForFunction(() => /Готово|отправлена/.test(document.getElementById('refBindMsg').textContent) || !document.getElementById('refBoundBox').classList.contains('hidden'), null, { timeout: 20000 }).catch(()=>{});
await page.waitForTimeout(800);
R.ok('ПЕРЕД ОПЕРАЦИЕЙ ПОКАЗАН ПОЛНЫЙ АДРЕС, А НЕ ИМЯ', dialogs.some(d => d.includes(REF)), dialogs[0]);
R.ok('и сказано, что это навсегда', dialogs.some(d => /навсегда/.test(d)));
const tx = state.sent.find(x => x.data && x.data.startsWith(iface.getSighash('setReferrer')));
R.ok('ОПЕРАЦИЯ УШЛА В КОНТРАКТ ОПЛАТЫ', tx && tx.to.toLowerCase() === ADDR.pay.toLowerCase(), tx && tx.to);
R.ok('БАЙТ В БАЙТ setReferrer(адрес пригласившего) — ИМЯ ПРЕВРАЩЕНО В АДРЕС',
  tx && tx.data.toLowerCase() === iface.encodeFunctionData('setReferrer', [REF]).toLowerCase(), tx && tx.data);
R.ok('денег операция не несёт', tx && tx.value === '0');
R.ok('ПОСЛЕ ЗАКРЕПЛЕНИЯ ВИДНО, КТО ПРИГЛАСИЛ И ДО КАКОГО ЧИСЛА', await vis('#refBoundBox'),
  await page.textContent('#refBoundText'));
R.ok('в тексте — полный адрес и «ни на цент»', (await page.textContent('#refBoundText')).includes(REF) && /ни на цент/.test(await page.textContent('#refBoundText')));
R.ok('предложение закрепить исчезло', !(await vis('#refBindBox')));
await page.evaluate(() => { setTab('pay'); renderReferral(); });
R.ok('и напоминание у кассы тоже', !(await vis('#refPending')));
R.ok('ссылка в памяти телефона больше не висит', await page.evaluate(() => !(refStored() || {}).r));

// ======================= уже продавал =======================
state.referral = {};
state.sold[me.toLowerCase()] = true;
await cashback();
R.ok('ПОСЛЕ ПЕРВОЙ ПРОДАЖИ ЗАКРЕПИТЬ НЕ ПРЕДЛАГАЕМ — КОНТРАКТ ВСЁ РАВНО ОТКАЖЕТ', !(await vis('#refBindBox')));
R.ok('а своей ссылкой делиться по-прежнему можно', await vis('#refBox'));
state.sold = {};

/* Гонка: пока экран открыт, прошла первая продажа. Контракт откажет —
   человек должен прочитать почему, а не код ошибки. */
await cashback();
state.revert = 'Pay: already selling';
await page.fill('#refInput', REF);
page.evaluate(() => bindReferrer());
await answerConfirm(page, 'testpassword1', 12000);
await page.waitForFunction(() => !document.getElementById('refBindMsg').classList.contains('hidden'), null, { timeout: 15000 }).catch(()=>{});
R.ok('ОТКАЗ «УЖЕ ПРОДАЁТ» ОБЪЯСНЁН СЛОВАМИ', /уже была продажа/.test(await bindMsg()), await bindMsg());
state.revert = null;

// ======================= «меня никто не приглашал» =======================
await page.evaluate(r => refSave({ r, ts: Date.now() }), REF);
await page.evaluate(() => { document.getElementById('refInput').value = ''; renderReferral(); });
await page.evaluate(() => dismissReferrer());
await page.evaluate(() => { setTab('pay'); renderReferral(); });
R.ok('ОТКАЗАЛСЯ — БОЛЬШЕ НЕ НАПОМИНАЕМ У КАССЫ', !(await vis('#refPending')));
R.ok('и поле пустое', (await page.inputValue('#refInput')) === '');

// ======================= покупатель =======================
await page.evaluate(() => { userRole = 'buyer'; tab = 'wallet'; setTab('cashback'); });
await page.evaluate(() => refreshReferral(true)); await page.waitForTimeout(500);
R.ok('ПОКУПАТЕЛЬ ТОЖЕ МОЖЕТ ПРИГЛАШАТЬ ПРОДАВЦОВ', await vis('#refBox'));
R.ok('но закреплять ему некого — он не продаёт', !(await vis('#refBindBox')) && !(await vis('#refBoundBox')));
await page.evaluate(() => { userRole = 'seller'; });

// ======================= переезд: старый контракт рядом с новым =======================
await page.evaluate(o => { CONTRACTS.bnbTestnet.payOld = o; payVersionCache = {}; }, OLD);
state.versionByHub[OLD.toLowerCase()] = 2;
state.bonusByHub[OLD.toLowerCase()] = { pending: 1, claimable: 3 };
state.bonusByHub[ADDR.pay.toLowerCase()] = { pending: 0, claimable: 2 };
await page.evaluate(() => refreshVault(true)); await page.waitForTimeout(1200);
await page.evaluate(() => renderCashback());
R.ok('БОНУСЫ ИЗ ОБОИХ КОНТРАКТОВ СЛОЖЕНЫ', /^5\b/.test((await page.textContent('#cbBig')).trim()), await page.textContent('#cbBig'));
state.sent.length = 0;
page.evaluate(() => claimMerchantBonus());
await page.waitForTimeout(6000);
const claims = state.sent.filter(x => x.data === iface.getSighash('claimBonus')).map(x => x.to.toLowerCase());
R.ok('«ЗАБРАТЬ» ЗАБИРАЕТ ИЗ КАЖДОГО, ГДЕ ЕСТЬ', claims.length === 2 && claims.includes(OLD.toLowerCase()) && claims.includes(ADDR.pay.toLowerCase()), claims.join(','));

/* Покупка, сделанная через старый контракт, возвращается через него же:
   новый о ней не знает и вернуть не сможет. */
const INV = '0x' + 'ab'.repeat(32);
state.logs = [
  paidLog({ merchant: me, payer: REF, token: ADDR.usdt, toMerchant: E.utils.parseUnits('9.9', 6), fee: E.utils.parseUnits('0.1', 6), reward: 0, invoice: INV, block: 4990, address: OLD }),
  paidLog({ merchant: me, payer: REF, token: ADDR.usdt, toMerchant: E.utils.parseUnits('4.95', 6), fee: E.utils.parseUnits('0.05', 6), reward: 0, invoice: '0x' + 'cd'.repeat(32), block: 4995 })
];
await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.evaluate(() => loadIncoming()); await page.waitForTimeout(2000);
const inc = await page.evaluate(() => incoming.map(x => ({ hub: x.hub.toLowerCase(), gross: x.gross.toString() })));
R.ok('ПОСТУПЛЕНИЯ ИЗ ОБОИХ КОНТРАКТОВ В ОДНОМ СПИСКЕ', inc.length === 2, JSON.stringify(inc));
const oldIdx = inc.findIndex(x => x.hub === OLD.toLowerCase());
state.sent.length = 0; dialogs.length = 0;
page.evaluate(i => doRefund(i), oldIdx);
await answerConfirm(page, 'testpassword1', 12000);
await page.waitForTimeout(7000);
const ap = state.sent.find(x => x.data && x.data.startsWith(iface.getSighash('approve')));
const rf = state.sent.find(x => x.data && x.data.startsWith(iface.getSighash('refund')));
R.ok('ВОЗВРАТ СТАРОЙ ПОКУПКИ — В СТАРЫЙ КОНТРАКТ', rf && rf.to.toLowerCase() === OLD.toLowerCase(), rf && rf.to);
R.ok('и разрешение выдано именно ему', ap && iface.decodeFunctionData('approve', ap.data)[0].toLowerCase() === OLD.toLowerCase());
R.ok('возврат ровно на уплаченное: 10 USDT', rf && iface.decodeFunctionData('refund', rf.data)[1].toString() === E.utils.parseUnits('10', 6).toString());

// ======================= без третьей версии ничего не ломается =======================
await page.evaluate(() => { CONTRACTS.bnbTestnet.payOld = null; payVersionCache = {}; });
state.payVersion = 2; state.versionByHub = {}; state.bonusByHub = {};
await cashback();
R.ok('ВЕРНУЛИ ВТОРУЮ ВЕРСИЮ — ПРИГЛАШЕНИЯ СНОВА СКРЫТЫ', !(await vis('#refBox')));

const own = errors.filter(e => !/Failed to load resource|ERR_|net::/.test(e));
R.ok('НИ ОДНОЙ ОШИБКИ В КОДЕ СТРАНИЦЫ', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
