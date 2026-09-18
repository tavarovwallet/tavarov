import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const c = await b.newContext({ viewport:{width:430,height:900}, colorScheme:'dark', locale:'ru-RU', deviceScaleFactor:2 });
const p = await c.newPage();
await p.addInitScript(() => {
  localStorage.setItem('tavarov.invoice.v1', JSON.stringify({wallet:'0xff33e4e0d47650b7d15e6fc1df788133c464d0e4', shop:'Кофейня на углу', cur:'USDT', ttl:'900'}));
  const now=Date.now();
  localStorage.setItem('tavarov.invoices.v1', JSON.stringify([
    {h:'0xaa11',m:'0xff33',a:'12.00',c:'USDT',o:'заказ-1024',n:'Кофейня',i:'Ключ Steam',net:'bnb',t:Math.floor(now/1000)+900,at:now-600000,paid:true,tx:'0xb01612'},
    {h:'0xbb22',m:'0xff33',a:'4.50',c:'USDT',o:'',n:'Кофейня',i:'Капучино',net:'bnb',t:Math.floor(now/1000)-100,at:now-90000000,paid:false,tx:null}
  ]));
});
await p.goto('http://localhost:8098/invoice.html', { waitUntil:'load' });
await p.waitForTimeout(900);
console.log('шапка видна:', await p.isVisible('#whoBar'), '| поле кошелька скрыто:', !(await p.isVisible('#fWallet')));
console.log('имя:', (await p.textContent('#whoName')).trim(), '| адрес:', (await p.textContent('#whoAddr')).trim());
console.log('итог за неделю:', (await p.textContent('#logWeekSum')).trim());
await p.screenshot({ path:'/tmp/invoice-2.png' });
await b.close();
