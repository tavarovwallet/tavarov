/* Код кассы должен читаться ЧУЖИМИ кошельками.

   До этой правки в картинке лежала строка tavarov:pay?… — свой формат,
   понятный только нашему приложению. Trust Wallet, MetaMask и кошелёк
   биржи отвечали на неё «непонятный код», и человек без нашего приложения
   заплатить не мог вообще. Для кассы это приговор: чем платит покупатель,
   решает покупатель.

   Теперь в картинке лежит EIP-681 — общий стандарт, — а своё дописано
   полями tv_*. Здесь проверяется и то и другое: что стандартная часть
   собрана ровно по правилам (иначе чужой кошелёк её молча не поймёт), и
   что наше приложение по-прежнему вытаскивает из кода всё своё. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

/* Приёмников больше нет: в честном коде кассы получатель и продавец — это
   один и тот же адрес. Разошлись — код подменён, и приложение обязано его
   отвергнуть; это проверяется ниже отдельно. */
const SHOP  = await page.evaluate(() => wallet.evm.address);
const VAULT = SHOP;

/* Считаем в основной сети: там настоящий USDT с восемнадцатью знаками —
   ровно то место, где ошибка в числе знаков стоила бы дороже всего. */
await page.evaluate(() => {
  try{ localStorage.setItem(TESTNET_KEY, '0'); } catch(e){}
  NETWORKS = MAINNET; network = 'bnb';
});

const built = await page.evaluate(([to, m]) => buildQrPayload({
  to, m, cur:'USDT', amt:'12.34', item:'Кофе', name:'Кофейня на углу'
}), [VAULT, SHOP]);

R.ok('код теперь стандартный, а не наш собственный',
  built.startsWith('ethereum:') && !built.startsWith('tavarov:'), built.slice(0, 46));

const usdt = await page.evaluate(() => MAINNET.bnb.tokens.USDT.contract);
R.ok('в коде адрес самого USDT, а не получателя',
  built.toLowerCase().startsWith('ethereum:' + usdt.toLowerCase() + '@56/transfer?'), built.slice(0, 60));
R.ok('получатель — кошелёк продавца',
  new RegExp('address=' + SHOP, 'i').test(built));

/* Восемнадцать знаков, а не шесть: на этом ломаются все, кто переносит
   касу из тестовой сети в основную. 12.34 USDT — это 12340000000000000000. */
R.ok('СУММА В ПРАВИЛЬНЫХ ЕДИНИЦАХ', /uint256=12340000000000000000(&|$)/.test(built),
  (built.match(/uint256=\d+/) || [''])[0]);

R.ok('своё дописано отдельно и стандарту не мешает',
  /(\?|&)tv_m=/i.test(built) && /(\?|&)tv_item=/.test(built) && /(\?|&)tv_net=bnb/.test(built));
R.ok('стандартные поля идут перед нашими',
  built.indexOf('uint256=') < built.indexOf('tv_'));

// ---------- обратно ----------
const back = await page.evaluate(s => parsePayLink(s), built);
R.ok('приложение читает свой же код', !!back && back.structured === true);
R.ok('получатель прочитан', (back.to || '').toLowerCase() === SHOP.toLowerCase(), back.to);
R.ok('касса прочитана', (back.m || '').toLowerCase() === SHOP.toLowerCase(), back.m);
R.ok('валюта прочитана', back.cur === 'USDT', back.cur);
R.ok('СУММА ПРОЧИТАНА ОБРАТНО БЕЗ ПОТЕРЬ', back.amt === '12.34', back.amt);
R.ok('товар прочитан', back.item === 'Кофе', back.item);
R.ok('название точки прочитано', back.name === 'Кофейня на углу', back.name);

// ---------- код рисуется и читается сканером ----------
const round = await page.evaluate(async (text) => {
  const holder = document.createElement('div');
  holder.style.position = 'fixed'; holder.style.left = '-9999px';
  document.body.appendChild(holder);
  const drawn = drawQr(holder, text, 260);
  let backText = null;
  if (drawn){
    try{
      const r = await QrScanner.scanImage(holder.querySelector('canvas'), { returnDetailedScanResult: true });
      backText = r && r.data !== undefined ? r.data : r;
    } catch(e){}
  }
  holder.remove();
  return { drawn, backText };
}, built);
R.ok('картинка рисуется', round.drawn);
R.ok('и читается сканером без искажений', round.backText === built,
  String(round.backText || '').slice(0, 50));

// ---------- чужой стандартный код мы тоже понимаем ----------
const plain = await page.evaluate(u =>
  parsePayLink('ethereum:' + u + '@56/transfer?address=0x1111111111111111111111111111111111111111&uint256=5000000000000000000'),
  usdt);
R.ok('чужой код без наших полей разбирается',
  !!plain && plain.cur === 'USDT' && plain.amt === '5', plain && plain.amt);
R.ok('и кассой его никто не считает', !!plain && !plain.m);

const native = await page.evaluate(() =>
  parsePayLink('ethereum:0x1111111111111111111111111111111111111111@56?value=1500000000000000000'));
/* Валюта здесь обязана быть проставлена, а не оставлена пустой.

   Проверка раньше требовала обратного — «cur пустой» — и тем самым закрепляла
   ошибку: экран отправки оставлял валюту такой, какой она была до
   сканирования, и человек платил восемнадцать USDT там, где просили
   восемнадцать BNB. Пустое поле в разборе кода означало не «монета сети», а
   «не знаю», и дальше по этому «не знаю» никто не проходил. */
R.ok('КОД НА МОНЕТУ СЕТИ РАЗБИРАЕТСЯ И ВАЛЮТА В НЁМ НАЗВАНА',
  !!native && native.amt === '1.5' && native.cur === 'native',
  native && (native.amt + ' / ' + native.cur));

/* Незнакомый токен — самое опасное место: подставить сумму «как будто USDT»
   значило бы показать человеку неправду о том, чем он платит. */
const alien = await page.evaluate(() =>
  parsePayLink('ethereum:0x9999999999999999999999999999999999999999@56/transfer?address=0x1111111111111111111111111111111111111111&uint256=7'));
R.ok('НЕЗНАКОМЫЙ ТОКЕН НЕ ВЫДАЁТСЯ ЗА ЗНАКОМЫЙ',
  !alien || (!alien.cur && !alien.amt), JSON.stringify(alien));

const junk = await page.evaluate(() => parsePayLink('ethereum:совсем не адрес'));
R.ok('мусор не роняет разбор', junk === null || typeof junk === 'object');

// ---------- вставленный руками код тоже срабатывает ----------
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(300);
await page.evaluate(s => { const el = document.getElementById('sendTo'); el.value = s; sendToInput(el); }, built);
await page.waitForTimeout(1200);
R.ok('вставленный стандартный код подставил сумму',
  (await page.inputValue('#sendAmount')) === '12.34', await page.inputValue('#sendAmount'));

/* Подменённый код: получатель не совпадает с кассой. Платить по такому
   нельзя — деньги уйдут не продавцу. */
const forged = await page.evaluate(([to, m]) => buildQrPayload({
  to, m, cur:'USDT', amt:'12.34', item:'Кофе', name:'Кофейня'
}), ['0x9999999999999999999999999999999999999999', SHOP]);
await page.evaluate(() => { document.getElementById('sendTo').value = ''; document.getElementById('sendAmount').value = ''; });
await page.evaluate(s => applyScannedPayment(s), forged);
await page.waitForTimeout(1200);
R.ok('ПОДМЕНЁННЫЙ КОД ОТВЕРГНУТ', (await page.inputValue('#sendTo')) === '',
  await page.inputValue('#sendTo'));
R.ok('и человеку сказано, почему',
  /собран неправильно|печатать код заново|не стоит/.test(
    await page.evaluate(() => document.getElementById('scanIntentBox').textContent)),
  await page.evaluate(() => document.getElementById('scanIntentBox').textContent.slice(0, 70)));

/* Ссылка на оплату рядом с кодом. Без неё покупка возможна только через
   камеру: человек за компьютером вбивал адрес руками, получался перевод, и
   бонусы не начислялись - ровно та беда, из-за которой касса в основной
   сети не сработала ни разу. */
await page.evaluate(() => {
  try{ localStorage.setItem(TESTNET_KEY, '1'); } catch(e){}
  NETWORKS = TESTNET; network = 'bnb';
  tab = 'pay'; setPayMode('kassa');
});
await page.evaluate(() => saveShopName('Кофейня'));
await page.fill('#kassaItem', 'Кофе');
await page.fill('#kassaAmount', '1');
await page.selectOption('#kassaCurrency', 'USDT');
await page.evaluate(() => createTicket());
await page.waitForTimeout(3000);
const shown = await page.evaluate(() => document.getElementById('ticketPayLink').textContent);
R.ok('ССЫЛКА НА ОПЛАТУ ПОКАЗАНА РЯДОМ С КОДОМ', shown.length > 20, shown.slice(0, 50));
R.ok('и это та же ссылка, что в картинке', /^(ethereum:|tavarov:pay\?)/.test(shown), shown.slice(0, 20));
const backLink = await page.evaluate(s => parsePayLink(s), shown);
R.ok('вставленная ссылка читается как ПОКУПКА, а не перевод',
  !!backLink && !!backLink.m, JSON.stringify(backLink && { m: backLink.m, amt: backLink.amt }));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
