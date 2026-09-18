/* Сборка «одним файлом» — то, что человек кладёт на хостинг для iPhone.
   Внутри те же исходники, но собранные заново: проверяем, что сборка
   не растеряла ни библиотек, ни адресов контрактов. */
import { chromium } from 'playwright';
import { reporter } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import http from 'node:http';
import fs from 'node:fs';

/* Сборку раздаём сами: проверка не должна зависеть от того, что кто-то
   заранее поднял сервер вручную — забудешь, и она молча не запустится. */
const BUNDLE = '/home/claude/apk/tavarov-одним-файлом.html';
const bundleSrv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(BUNDLE));
});
await new Promise(r => bundleSrv.listen(8097, r));

const srv = await start(8555);
const R = reporter();
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const ctx = await browser.newContext({ viewport:{width:414,height:896}, deviceScaleFactor:2 });
await ctx.addInitScript(() => { try{ localStorage.setItem('tavarov.testnet.v1','1'); }catch(e){} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type()==='error') errors.push('console: ' + m.text()); });

const external = [];
page.on('request', q => { const u = q.url(); if (!u.startsWith('http://localhost:8097')) external.push(u); });

await page.goto('http://localhost:8097/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => typeof renderWalletState === 'function');
await page.evaluate(u => { TESTNET.bnb.rpc=u; TESTNET.bnb.rpcs=[u]; }, 'http://localhost:8555');

R.ok('библиотеки внутри файла: ethers', await page.evaluate(() => typeof ethers === 'object'));
R.ok('библиотеки внутри файла: QRCode', await page.evaluate(() => typeof QRCode === 'function'));
R.ok('библиотеки внутри файла: QrScanner', await page.evaluate(() => typeof QrScanner !== 'undefined'));
R.ok('библиотеки внутри файла: nacl', await page.evaluate(() => typeof nacl === 'object'));
R.ok('адрес контракта счетов на месте',
  (await page.evaluate(() => CONTRACTS.bnbTestnet.charges)) === ADDR.charges,
  await page.evaluate(() => CONTRACTS.bnbTestnet.charges));
R.ok('адрес контракта имён на месте',
  (await page.evaluate(() => CONTRACTS.bnbTestnet.names)) === ADDR.names,
  await page.evaluate(() => CONTRACTS.bnbTestnet.names));
R.ok('кнопка называется «Другие валюты»', (await page.content()).includes('Другие валюты'));
R.ok('старой надписи не осталось', !(await page.content()).includes('Видеть валюту'));

// заводим кошелёк целиком, как человек
await page.evaluate(() => chooseRole('seller'));
await page.evaluate(() => beginGenerate());
await page.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
await page.evaluate(() => finishGenerate());
await page.fill('#newPass','testpassword1'); await page.fill('#newPass2','testpassword1');
await page.evaluate(() => savePassword());
await page.waitForFunction(() => flowStage==='totp-setup' || flowStage==='ready');
R.ok('QR для Google Authenticator нарисован',
  await page.evaluate(() => document.querySelectorAll('#totpQr img, #totpQr canvas').length) > 0);
/* В браузере код обязателен — проходим его так же, как человек с телефоном. */
await page.evaluate(async () => {
  if (flowStage !== 'totp-setup') return;
  if (totpRequired()){
    const code = await totpAt(base32Decode(pendingTotpSecret), Math.floor(Date.now()/1000/30));
    document.getElementById('totpSetupCode').value = code;
    await confirmTotpSetup();
  } else skipTotpSetup();
});
await page.waitForFunction(() => flowStage === 'ready');

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 0.3, USDT: 55, TVR: 100 };
state.vaults[me.toLowerCase()] = '0x7777777777777777777777777777777777777777';
state.balances['0x7777777777777777777777777777777777777777'] = { native:0, USDT:0, TVR:0 };

await page.evaluate(() => refreshBalances());
await page.waitForTimeout(2500);
R.ok('итог по активам считается и в сборке',
  (await page.evaluate(() => document.getElementById('totalUsd').textContent)).includes('55'),
  await page.evaluate(() => document.getElementById('totalUsd').textContent));

await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.evaluate(() => refreshVault(true));
await page.waitForTimeout(800);
await page.evaluate(() => saveShopName('Кофейня на углу'));
await page.fill('#kassaItem', 'Комплексный обед с супом и компотом');
await page.fill('#kassaAmount', '12.34');
await page.selectOption('#kassaCurrency', 'USDT');
await page.evaluate(() => createTicket());
await page.waitForTimeout(3000);
R.ok('код счёта рисуется и в сборке',
  await page.evaluate(() => document.querySelectorAll('#kassaQr img, #kassaQr canvas').length) > 0,
  await page.evaluate(() => document.getElementById('kassaQr').textContent.slice(0,50)));

/* Наружу файл ходит ровно в двух местах: узел сети и справочник курсов.
   Ни библиотек, ни картинок, ни шрифтов со стороны быть не должно —
   иначе на плохой связи приложение просто не откроется. */
const outside = external.filter(u => !u.startsWith('http://localhost:8555')
  && !u.startsWith('data:') && !u.startsWith('blob:')
  && !u.startsWith('https://api.coingecko.com/'));
R.ok('файл не подгружает со стороны ничего, кроме узла сети и курсов',
  outside.length === 0, outside.slice(0,3).join(' '));
const priceCalls = external.filter(u => u.startsWith('https://api.coingecko.com/'));
const uniq = new Set(priceCalls);
R.ok('один и тот же курс не запрашивается по нескольку раз',
  priceCalls.length === uniq.size, priceCalls.length + ' запросов, разных ' + uniq.size);

// имя в сборке
state.names['kofeinya'] = '0xd6EFc4a8E42cEec42fD460704805E126dDa1dFe0';
await page.evaluate(() => cancelTicket());
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.fill('#sendTo', 'kofeinya');
await page.waitForTimeout(2500);
R.ok('поиск по имени работает и в сборке',
  await page.evaluate(() => typeof resolvedName !== 'undefined' && !!resolvedName),
  await page.evaluate(() => document.getElementById('scanIntentBox').textContent.slice(0,70)));

await page.screenshot({ path:'/home/claude/apk/audit/shots/сборка-одним-файлом.png', fullPage:true });

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close(); bundleSrv.close();
process.exit(good ? 0 : 1);
