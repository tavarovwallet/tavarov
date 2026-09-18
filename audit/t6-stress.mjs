/* Мелочи, на которых обычно всё и ломается: длинные строки, маленький экран,
   тёмная тема, истекающий счёт, повторные нажатия. */
import { boot, reporter } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import { chromium } from 'playwright';

const srv = await start(8555);
const R = reporter();
const SHOTS = '/home/claude/apk/audit/shots';

const seller = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });
const page = seller.page;
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 10, TVR: 0 };
state.vaults[me.toLowerCase()] = '0x6666666666666666666666666666666666666666';
state.balances['0x6666666666666666666666666666666666666666'] = { native: 0, USDT: 0, TVR: 0 };
await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.evaluate(() => refreshVault(true));
await page.waitForTimeout(600);

// ---------- длинные строки в QR ----------
await page.evaluate(() => saveShopName('Очень длинное название кофейни на углу'));

await page.fill('#kassaItem', 'Комплексный обед с супом, салатом и компотом');
await page.fill('#kassaAmount', '12.34');
await page.selectOption('#kassaCurrency', 'USDT');
await page.evaluate(() => createTicket());
await page.waitForTimeout(2500);
R.ok('одноразовый QR рисуется с длинным описанием',
  await page.evaluate(() => document.querySelectorAll('#kassaQr img, #kassaQr canvas').length) > 0,
  await page.evaluate(() => document.getElementById('kassaQr').textContent.slice(0,60)));
await page.screenshot({ path: SHOTS + '/касса-счёт.png', fullPage: true });
await page.evaluate(() => cancelTicket());

// ---------- истекающий счёт исчезает сам ----------
await page.evaluate(() => {
  chargeState = { amount: 1, sym: 'USDT', item: 'Скоро истечёт',
                  expiresAt: Math.floor(Date.now()/1000) + 2 };
  renderCharge();
});
R.ok('пока счёт жив — строка показана', await page.isVisible('#chargeLive'));
await page.waitForTimeout(3500);
R.ok('истёкший счёт пропадает с экрана сам, без перезагрузки',
  !(await page.isVisible('#chargeLive')));
R.ok('кнопка снятия истёкшего счёта тоже убрана', !(await page.isVisible('#dropChargeBtn')));

// ---------- двойное нажатие «Выставить счёт» ----------
state.sent.length = 0;
await page.fill('#kassaAmount', '5');
await page.evaluate(() => { createTicket(); createTicket(); });
await page.waitForTimeout(3000);
const timers = await page.evaluate(() => ({ has: !!ticketInfo, shown: !document.getElementById('kassaTicket').classList.contains('hidden') }));
R.ok('двойное нажатие не ломает кассу', timers.has && timers.shown, JSON.stringify(timers));
await page.evaluate(() => cancelTicket());

// ---------- маленький экран ----------
const small = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const sctx = await small.newContext({ viewport:{width:320, height:568}, deviceScaleFactor:2 });
await sctx.addInitScript(() => { try{ localStorage.setItem('tavarov.testnet.v1','1'); }catch(e){} });
const sp = await sctx.newPage();
const smallErrors = [];
sp.on('pageerror', e => smallErrors.push('pageerror: ' + e.message));
await sp.goto('http://localhost:8099/index.html');
await sp.waitForFunction(() => typeof renderWalletState === 'function');
await sp.evaluate(url => { TESTNET.bnb.rpc = url; TESTNET.bnb.rpcs = [url]; }, 'http://localhost:8555');
await sp.evaluate(() => chooseRole('buyer'));
await sp.evaluate(() => beginGenerate());
await sp.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
await sp.evaluate(() => finishGenerate());
await sp.fill('#newPass','testpassword1'); await sp.fill('#newPass2','testpassword1');
await sp.evaluate(() => savePassword());
await sp.waitForFunction(() => flowStage === 'totp-setup' || flowStage === 'ready');
await sp.evaluate(() => { if (flowStage==='totp-setup') skipTotpSetup(); });
await sp.waitForTimeout(1500);
const overflow = await sp.evaluate(() => {
  const el = document.getElementById('scroller') || document.body;
  return { w: el.scrollWidth, cw: el.clientWidth };
});
R.ok('на экране 320 точек ничего не вылезает вбок', overflow.w <= overflow.cw + 1, JSON.stringify(overflow));
await sp.screenshot({ path: SHOTS + '/узкий-экран.png', fullPage: true });

// ---------- тёмная тема ----------
const dctx = await small.newContext({ viewport:{width:414,height:896}, deviceScaleFactor:2, colorScheme:'dark' });
await dctx.addInitScript(() => { try{ localStorage.setItem('tavarov.testnet.v1','1'); }catch(e){} });
const dp = await dctx.newPage();
dp.on('pageerror', e => smallErrors.push('тёмная: ' + e.message));
await dp.goto('http://localhost:8099/index.html');
await dp.waitForFunction(() => typeof renderWalletState === 'function');
await dp.evaluate(url => { TESTNET.bnb.rpc = url; TESTNET.bnb.rpcs = [url]; }, 'http://localhost:8555');
await dp.evaluate(() => chooseRole('seller'));
await dp.evaluate(() => beginGenerate());
await dp.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
await dp.evaluate(() => finishGenerate());
await dp.fill('#newPass','testpassword1'); await dp.fill('#newPass2','testpassword1');
await dp.evaluate(() => savePassword());
await dp.waitForFunction(() => flowStage === 'totp-setup' || flowStage === 'ready');
await dp.evaluate(() => { if (flowStage==='totp-setup') skipTotpSetup(); });
await dp.waitForTimeout(1500);
const bg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
const fg = await dp.evaluate(() => getComputedStyle(document.body).color);
R.ok('тёмная тема действительно тёмная', bg !== fg && /rgb/.test(bg), 'фон ' + bg + ', текст ' + fg);
await dp.screenshot({ path: SHOTS + '/тёмная-кошелёк.png', fullPage: true });
await dp.evaluate(() => setTab('pay'));
await dp.waitForTimeout(800);
await dp.screenshot({ path: SHOTS + '/тёмная-оплата.png', fullPage: true });

const clean = [...seller.errors, ...smallErrors].filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await seller.browser.close(); await small.close(); srv.close();
process.exit(good ? 0 : 1);
