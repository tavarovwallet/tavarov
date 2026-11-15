/* Ссылка вместо адреса в поле получателя (RECIPIENT-URL-V1).

   Снимок экрана 15 ноября: «Оплатить покупку», получатель —
   https://wallet.tavarov.com/d/treerayy, 0.1 USDT, и после «Подтвердить» —
   «Ошибка отправки: сеть не отвечает». Ссылка на страницу донатов прошла
   проверку (она проверяла только длину), а библиотека приняла её за имя ENS.

   Проверяем:
   a. ссылка /d/<занятое имя> — в поле имя, оно найдено, на подтверждении
      адрес, перевод уходит; так же — из сканера; ссылка тестовой сети в
      другой сети не берётся;
   b. /d/<свободное имя> — «ни за кем не числится», до подтверждения не доходит;
   c. чужая ссылка, длинная строка, адрес не той длины, адрес с неверной
      контрольной суммой — остановлены до подтверждения словами «не адрес»;
   d. обычный адрес и обычное имя (с @, заглавными) работают как раньше;
   e. кривой получатель на уровне doSend — не «сеть не отвечает».         */
import { boot, reporter, answerConfirm } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const PORT = Number(process.env.T104_RPC_PORT || 8604);
const srv = await start(PORT);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:' + PORT });
let lastAlert = '';
page.on('dialog', d => { lastAlert = d.message(); d.accept().catch(()=>{}); });
await page.evaluate(() => { const real = window.waitTx; window.waitTx = (hash) => real(hash, 1); });

const NAME_ADDR = '0x2222222222222222222222222222222222222222';
state.names['donatee'] = NAME_ADDR;
const addr = await page.evaluate(() => wallet.evm.address);
state.balances[addr.toLowerCase()] = { native: 0.5, USDT: 100 };
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);

const NOT_ADDR = /не адрес и не имя/;
const NET_MSG = /сеть не отвечает/;
const confirmShown = () => page.evaluate(() => !document.getElementById('sendConfirm').classList.contains('hidden'));
const fieldVal = () => page.evaluate(() => document.getElementById('sendTo').value);
const boxText = () => page.evaluate(() => {
  const b = document.getElementById('scanIntentBox'); return b && !b.classList.contains('hidden') ? b.textContent : '';
});
const hintShown = () => page.evaluate(() => {
  const h = document.getElementById('donateLinkHint'); return !!h && !h.classList.contains('hidden') && /донат/i.test(h.textContent);
});
const putTo = async (v, wait = 1800) => {
  await page.evaluate(() => { cancelSend(); });
  await page.fill('#sendTo', v);
  await page.waitForTimeout(wait);
};
const review = async (amount = '1') => {
  lastAlert = '';
  await page.fill('#sendAmount', amount);
  await page.evaluate(() => reviewSend());
  await page.waitForTimeout(300);
};
const sendNow = async () => { const p = page.evaluate(() => doSend()); await answerConfirm(page); await p; };

// ---------- a. ссылка на донаты с занятым именем ----------
await putTo('https://wallet.tavarov.com/d/Donatee/?net=bnbTestnet');
R.ok('a: В ПОЛЕ — ИМЯ ИЗ ССЫЛКИ, А НЕ ССЫЛКА', (await fieldVal()) === 'donatee', await fieldVal());
const rn = await page.evaluate(() => resolvedName);
R.ok('a: имя найдено, адрес тот, что в контракте имён',
  !!rn && rn.name === 'donatee' && String(rn.address).toLowerCase() === NAME_ADDR, JSON.stringify(rn));
R.ok('a: человек видит имя и адрес', /donatee/.test(await boxText()) && /0x2222/.test(await boxText()), (await boxText()).slice(0, 80));
R.ok('a: подсказка «это ссылка на донаты» под полем', await hintShown());
await review('1');
R.ok('a: ЭКРАН ПОДТВЕРЖДЕНИЯ ПОКАЗЫВАЕТ НАЙДЕННЫЙ АДРЕС',
  (await confirmShown()) && /donatee · 0x2222222222222222222222222222222222222222/i.test(
    await page.evaluate(() => document.getElementById('confirmTo').textContent)), lastAlert);
state.receiptSilent = 0; state.txStatus = '0x1';
const sentBefore = state.sent.length;
await sendNow();
const okSent = await page.waitForFunction(
  () => /подтвердила|отправлен/i.test(document.getElementById('sendResult').textContent),
  null, { timeout: 30000 }).then(() => true).catch(() => false);
const resA = await page.evaluate(() => document.getElementById('sendResult').textContent.trim());
R.ok('a: ПЕРЕВОД ПО ИМЕНИ ИЗ ССЫЛКИ УШЁЛ', okSent && state.sent.length > sentBefore && !/Ошибка/.test(resA), resA.slice(0, 90));
R.ok('a: после отправки подсказка ушла', !(await hintShown()));

// то же из сканера (камера/«вставить ссылку» ведут в applyScannedPayment)
await page.evaluate(() => { document.getElementById('sendTo').value = ''; });
await page.evaluate(() => applyScannedPayment('https://wallet.tavarov.com/d/@donatee?net=bnbTestnet'));
await page.waitForTimeout(1800);
R.ok('a: из сканера — тоже имя, и оно найдено',
  (await fieldVal()) === 'donatee' && await page.evaluate(() => !!resolvedName && resolvedName.name === 'donatee'));
R.ok('a: «вставить ссылку» в сканере признаёт ссылку на донаты',
  await page.evaluate(() => looksLikePayLink('https://wallet.tavarov.com/d/donatee')));
// ссылка основной сети в тестовом кошельке: имена там другие — не берём
await page.evaluate(() => applyScannedPayment('https://wallet.tavarov.com/d/donatee'));
await page.waitForTimeout(300);
R.ok('a: ссылку из другой сети (основная ↔ тестовая) не берём',
  (await fieldVal()) === '' && /другой сети/.test(await boxText()), (await boxText()).slice(0, 60));

// ---------- b. свободное имя ----------
await putTo('https://wallet.tavarov.com/d/nobody_here?net=bnbTestnet');
R.ok('b: в поле имя из ссылки', (await fieldVal()) === 'nobody_here');
R.ok('b: «ни за кем не числится»', /ни за кем не числится/.test(await boxText()), (await boxText()).slice(0, 80));
await review('1');
R.ok('b: ДО ПОДТВЕРЖДЕНИЯ НЕ ДОШЛО', !(await confirmShown()) && /не найдено/.test(lastAlert), lastAlert.slice(0, 80));

// ---------- c. не адрес ----------
const good = await page.evaluate(() => ethers.utils.getAddress('0x52908400098527886e0f7030069857d2e4169ee7'));
const li = good.slice(2).search(/[a-fA-F]/) + 2;        // первая буква: у цифры регистра нет
const flip = c => c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
const badSum = good.slice(0, li) + flip(good[li]) + good.slice(li + 1);
const junk = [
  ['чужая ссылка', 'https://example.com/x'],
  ['наша ссылка, но не /d/ и не /pay', 'https://wallet.tavarov.com/d/donatee/extra'],
  ['длинная строка', 'qwertyuiopasdfghjklzxcvbnm1234567890zzzz'],
  ['адрес 0x короче на знак', '0x' + '1'.repeat(39)],
  ['адрес 0x длиннее на знак', '0x' + '1'.repeat(41)],
  ['адрес Solana в сети BNB', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'],
  ['адрес с неверной контрольной суммой', badSum],
];
for (const [label, v] of junk){
  await putTo(v, 300);
  await review('1');
  R.ok('c: ' + label + ' — ОСТАНОВЛЕН ДО ПОДТВЕРЖДЕНИЯ', !(await confirmShown()) && NOT_ADDR.test(lastAlert), lastAlert.slice(0, 70));
}

// ---------- d. как раньше ----------
await putTo('0x' + '11'.repeat(20), 300);
await review('1');
R.ok('d: обычный адрес — экран подтверждения', await confirmShown(), lastAlert);
await putTo(good.toLowerCase(), 300);
await review('1');
R.ok('d: адрес в нижнем регистре — принят', await confirmShown(), lastAlert);
await putTo(good, 300);
await review('1');
R.ok('d: адрес с верной контрольной суммой — принят', await confirmShown(), lastAlert);
await putTo('@DONATEE');
await review('1');
R.ok('d: имя с @ и заглавными — найдено, на подтверждении адрес',
  (await confirmShown()) && /donatee · 0x2222/i.test(await page.evaluate(() => document.getElementById('confirmTo').textContent)), lastAlert);
R.ok('d: обычное имя — без подсказки про донаты', !(await hintShown()));
await putTo('', 300);
await review('1');
R.ok('d: пустое поле — «введите имя или адрес»', /Введите имя или адрес/.test(lastAlert), lastAlert);
await page.evaluate(() => cancelSend());

// ---------- e. у самой двери и разбор ошибок ----------
const e1 = await page.evaluate(async () => {
  pendingSend = { to: 'https://wallet.tavarov.com/d/treerayy', amount: '0.1', currency: 'USDT',
                  merchant: 'https://wallet.tavarov.com/d/treerayy', viaName: null, name: '', invoice: '', solRef: null };
  /* На старой версии doSend спросил бы пароль и ждал — не висим. */
  await Promise.race([doSend(), new Promise(r => setTimeout(r, 5000))]);
  return { res: document.getElementById('sendResult').textContent,
           asked: !document.getElementById('confirmModal').classList.contains('hidden') };
});
R.ok('e: doSend с кривым получателем — «не адрес», не «сеть не отвечает»', NOT_ADDR.test(e1.res) && !NET_MSG.test(e1.res), e1.res.slice(0, 90));
R.ok('e: и пароль даже не спрашивали', !e1.asked);
await page.evaluate(() => { pendingSend = null; });
const e2 = await page.evaluate(async () => {
  try{
    const s = new ethers.Wallet(wallet.evm.privateKey, getEvmProvider(network));
    await s.sendTransaction({ to: 'https://wallet.tavarov.com/d/treerayy', value: 1 });
    return 'ушло?!';
  } catch(e){ return shortErr(e); }
});
R.ok('e: ОТКАЗ БИБЛИОТЕКИ НА НЕ-АДРЕС РАЗБИРАЕТСЯ КАК «НЕ АДРЕС», А НЕ «СЕТЬ»', NOT_ADDR.test(e2) && !NET_MSG.test(e2), e2.slice(0, 90));
const e3 = await page.evaluate(() => shortErr(new Error('invalid address (argument="address", value="0x123", code=INVALID_ARGUMENT, version=address/5.7.0)')));
R.ok('e: «invalid address» — тоже «не адрес»', NOT_ADDR.test(e3), e3.slice(0, 60));
const e4 = await page.evaluate(() => shortErr(new Error('could not detect network (event="noNetwork", code=NETWORK_ERROR)')));
R.ok('e: настоящий сбой сети по-прежнему «сеть не отвечает»', NET_MSG.test(e4), e4.slice(0, 60));

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const ok = R.done(clean);
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
