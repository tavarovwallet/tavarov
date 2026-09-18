import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox']});
const p = await b.newPage();
await p.goto('http://localhost:8099/index.html');
await p.waitForFunction(()=>typeof QRCode==='function');
const res = await p.evaluate(()=>{
  const out=[];
  const holder=document.createElement('div'); document.body.appendChild(holder);
  const levels = { H: QRCode.CorrectLevel && QRCode.CorrectLevel.H, L: QRCode.CorrectLevel && QRCode.CorrectLevel.L,
                   M: QRCode.CorrectLevel && QRCode.CorrectLevel.M, Q: QRCode.CorrectLevel && QRCode.CorrectLevel.Q };
  for (const [name, lvl] of Object.entries(levels)){
    let max=0;
    for (let n=20; n<=800; n+=10){
      holder.innerHTML='';
      try{ new QRCode(holder,{text:'a'.repeat(n), width:200, height:200, correctLevel: lvl}); max=n; }
      catch(e){ break; }
    }
    out.push(name+' (='+lvl+'): до '+max+' знаков');
  }
  return out.join('\n');
});
console.log(res);
await b.close();
