import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, opts] of [
  ['desk-light', { viewport:{width:1200,height:900}, colorScheme:'light' }],
  ['desk-dark',  { viewport:{width:1200,height:900}, colorScheme:'dark'  }],
  ['phone-dark', { viewport:{width:414,height:900}, colorScheme:'dark', deviceScaleFactor:2 }]
]){
  const c = await b.newContext(opts);
  const p = await c.newPage();
  await p.goto('http://localhost:8097/sellers.html', { waitUntil:'load' });
  await p.waitForTimeout(400);
  await p.screenshot({ path:'/tmp/sellers-'+name+'.png', fullPage:false });
  await c.close();
}
await b.close(); console.log('снимки готовы');
