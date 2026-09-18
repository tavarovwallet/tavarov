/* Итог по активам под адресом и переименованная кнопка валют. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();

// поддельный справочник курсов: настоящий из этой машины недоступен
const prices = { binancecoin: 600, tether: 1, 'usd-coin': 1 };

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });
await page.route('**/api.coingecko.com/**', route => {
  const u = route.request().url();
  const m = u.match(/ids=([^&]+)/);
  const id = m ? decodeURIComponent(m[1]) : '';
  if (prices[id] === undefined) return route.fulfill({ status: 404, body: '{}' });
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ [id]: { usd: prices[id] } }) });
});

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 0.5, USDT: 1234.5, TVR: 900 };

// ---------- надписи ----------
R.ok('кнопка называется «Другие валюты»',
  (await page.evaluate(() => [...document.querySelectorAll('.mini-btn')].map(b => b.textContent).join('|'))).includes('Другие валюты'));
await page.evaluate(() => openTokensSheet());
await page.waitForTimeout(300);
R.ok('заголовок шторки — «Другие валюты»',
  (await page.evaluate(() => document.querySelector('#tokensModal h2').textContent)) === 'Другие валюты');
R.ok('старой надписи «Видеть валюту» нигде не осталось',
  !(await page.content()).includes('Видеть валюту'));
await page.evaluate(() => closeTokensSheet());
await page.waitForTimeout(500);

// ---------- итог ----------
await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(3000);

const total = await page.evaluate(() => ({
  sum: document.getElementById('totalUsd').textContent,
  note: document.getElementById('totalNote').textContent,
  visible: !!document.getElementById('totalUsd').offsetParent
}));
console.log('итог:', JSON.stringify(total));
console.log('балансы:', await page.evaluate(()=>JSON.stringify({last:lastBalances, vis:Object.keys(visibleTokens(network)), nat:NETWORKS[network].nativeSym})));

// 0.5 tBNB * 600 + 1234.5 USDT = 1534.50; TVR без курса
R.ok('строка итога видна на экране', total.visible);
R.ok('сумма посчитана верно', total.sum.replace(/\s| /g, '').includes('1534,50'), total.sum);
R.ok('сказано, что сеть тестовая', total.note.includes('тестовая'), total.note);
R.ok('сказано, что у TVR нет курса', total.note.includes('TVR'), total.note);

// ---------- курс не отвечает ----------
await page.route('**/api.coingecko.com/**', route => route.abort());
await page.evaluate(() => { for (const k of Object.keys(spotCache)) delete spotCache[k]; });
await page.evaluate(() => renderTotal());
await page.waitForTimeout(2500);
const noPrice = await page.evaluate(() => ({
  sum: document.getElementById('totalUsd').textContent,
  note: document.getElementById('totalNote').textContent
}));
console.log('без курсов:', JSON.stringify(noPrice));
R.ok('стейблкоины считаются и без справочника', noPrice.sum.replace(/\s| /g, '').includes('1234,50'), noPrice.sum);
R.ok('честно сказано, каких курсов не хватило',
  noPrice.note.includes('без курса') && noPrice.note.includes('tBNB'), noPrice.note);

// ---------- баланс не загрузился ----------
await page.evaluate(() => { lastBalances = null; renderTotal(); });
await page.waitForTimeout(400);
R.ok('без балансов показан прочерк, а не ноль',
  (await page.evaluate(() => document.getElementById('totalUsd').textContent)) === '—');

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|net::ERR_FAILED|Failed to load resource/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
