/* Самое важное про QR: нарисованный код должен читаться обратно.
   Рисуем настоящим рисовальщиком приложения и читаем настоящим сканером
   приложения — тем же, что работает от камеры. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

const cases = [
  ['короткий адрес', '0x1111111111111111111111111111111111111111'],
  ['ссылка без названия', 'tavarov:pay?to=0x1111111111111111111111111111111111111111&net=bnb&m=0x2222222222222222222222222222222222222222'],
  ['ссылка с названием по-русски', 'tavarov:pay?to=0x1111111111111111111111111111111111111111&net=bnb&m=0x2222222222222222222222222222222222222222&name=' + encodeURIComponent('Кофейня на углу')],
  ['ссылка с длинным названием и товаром', 'tavarov:pay?to=0x1111111111111111111111111111111111111111&net=bnb&m=0x2222222222222222222222222222222222222222&cur=USDT&amt=12.34&item=' + encodeURIComponent('Комплексный обед с супом, салатом и компотом') + '&name=' + encodeURIComponent('Очень длинное название кофейни на углу')],
  ['ключ Google Authenticator', 'otpauth://totp/Tavarov%20Wallet:0x1111111111111111111111111111111111111111?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Tavarov']
];

for (const [label, text] of cases){
  const res = await page.evaluate(async (t) => {
    const holder = document.createElement('div');
    holder.style.position = 'fixed'; holder.style.left = '-9999px';
    document.body.appendChild(holder);
    const drawn = drawQr(holder, t, 260);
    if (!drawn) { holder.remove(); return { drawn: false, back: null }; }
    const canvas = holder.querySelector('canvas');
    let back = null, err = null;
    try {
      const r = await QrScanner.scanImage(canvas, { returnDetailedScanResult: true });
      back = r && r.data !== undefined ? r.data : r;
    } catch(e){ err = String(e && e.message || e); }
    holder.remove();
    return { drawn: true, back, err, len: t.length };
  }, text);
  R.ok('«' + label + '» рисуется', res.drawn, 'знаков ' + text.length);
  R.ok('«' + label + '» читается обратно без искажений', res.back === text,
       res.back === text ? '' : ('прочитано: ' + String(res.back).slice(0, 60) + (res.err ? ' / ' + res.err : '')));
}

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
