import { chromium } from 'playwright';

const PAGE = 'file:///home/claude/apk/www/invoice.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 460, height: 1000 }, deviceScaleFactor: 2 });
p.on('pageerror', e => console.log('ОШИБКА СТРАНИЦЫ:', e.message));
await p.goto(PAGE);
await p.waitForTimeout(400);
await p.evaluate(() => applyLang('ru'));

await p.fill('#wallet', '0xFF33E4e0d47650b7D15e6fC1Df788133c464D0E4');
await p.fill('#amount', '0.2');
await p.click('#curSeg button[data-v="USDC"]');


await p.click('#makeBtn');
await p.waitForTimeout(700);

const err = await p.textContent('#formErr').catch(() => '');
console.log('ошибка формы:', (err || '').trim() || 'нет');

await p.locator('#doneCard').screenshot({ path: '/home/claude/apk/brand/qr-link.png' });
const t1 = await p.textContent('#qrHint');
console.log('подпись (ссылка):', t1.trim().slice(0, 70));

await p.click('#qrSeg button[data-v="wallet"]');
await p.waitForTimeout(400);
await p.locator('#doneCard').screenshot({ path: '/home/claude/apk/brand/qr-wallet.png' });
const t2 = await p.textContent('#qrHint');
console.log('подпись (кошелёк):', t2.trim().slice(0, 70));

console.log('что зашито в код сейчас:', (await p.evaluate(() => qrText())).slice(0,60));
console.log('размер кода в модулях:', await p.evaluate(() => { const c=document.querySelector('#qrBox canvas'); return c ? c.width : 'нет canvas'; }));
console.log('нарисован код:', await p.evaluate(() => !!document.querySelector('#qrBox canvas, #qrBox img')));
await b.close();
