import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport:{width:430,height:930}, colorScheme:'dark', locale:'ru-RU', deviceScaleFactor:2 });
const p = await c.newPage();
await p.goto('http://localhost:8098/invoice.html', { waitUntil:'load' });
await p.waitForTimeout(800);
await p.screenshot({ path:'/tmp/invoice-1.png' });
await b.close(); console.log('снято');
