import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const WWW = '/home/claude/apk/www';
const PORT = 8799;
let paid = new Set();
const srv = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://localhost:'+PORT);
  if (u.pathname === '/api/status'){
    const h = u.searchParams.get('h');
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify(paid.has(h)?{paid:true,tx:'0x'+'ab'.repeat(32)}:{paid:false}));
    return;
  }
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/,'')||'index.html';
  const f = path.join(WWW, rel);
  if(!f.startsWith(WWW)||!fs.existsSync(f)){res.writeHead(404);res.end('нет');return;}
  res.writeHead(200,{'content-type': f.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});
  res.end(fs.readFileSync(f));
});
await new Promise(r=>srv.listen(PORT,r));
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
const ctx = await b.newContext({locale:'ru-RU',viewport:{width:414,height:1000},deviceScaleFactor:2});
const p = await ctx.newPage();
p.on('dialog',d=>d.accept().catch(()=>{}));
await p.goto('http://localhost:'+PORT+'/invoice.html',{waitUntil:'load'});
const W='0x68021d70605A375deC030Fab45b99Df21bF39cc2';
const issue = async (amt,item,order,cur) => {
  await p.fill('#wallet',W); await p.fill('#shop','Кофейня на углу');
  await p.fill('#item',item); await p.fill('#amount',amt); await p.fill('#order',order);
  if (cur) await p.click('#curSeg button[data-v="' + cur + '"]');
  await p.click('#makeBtn'); await p.waitForTimeout(300);
  const h = await p.evaluate(()=>inv.h);
  await p.click('#againBtn'); await p.waitForTimeout(200);
  return h;
};
const a = await issue('12.34','Капучино и круассан','заказ-1024');
const c = await issue('40','Букет пионов','заказ-1025');
const d = await issue('7','Чай улун','заказ-1023','USDC');
paid.add(a); paid.add(d);
await p.evaluate(()=>logRefresh()); await p.waitForTimeout(1500);
await p.evaluate(()=>{ const l=logRead(); const i=l.findIndex(x=>!x.paid); if(i>=0){l[i].t=Math.floor(Date.now()/1000)-60; logWrite(l); renderLog();} });
await p.waitForTimeout(300);
await p.evaluate(()=>document.getElementById('logCard').scrollIntoView({block:'start'}));
await p.waitForTimeout(300);
await p.screenshot({path:'/home/claude/apk/audit/shots/журнал-счетов.png', fullPage:false});
await b.close(); srv.close();
console.log('готово');
