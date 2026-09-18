import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
console.log('версия браузера:', b.version());
const ctx = await b.newContext();
const page = await ctx.newPage();
await page.goto('https://example.com').catch(()=>{});
const cdp = await ctx.newCDPSession(page);
await cdp.send('WebAuthn.enable');
try {
  const r = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol:'ctap2', ctap2Version:'ctap2_1', transport:'internal',
               hasResidentKey:true, hasUserVerification:true, isUserVerified:true,
               automaticPresenceSimulation:true, hasPrf:true }
  });
  console.log('виртуальный ключ создан, PRF принят:', JSON.stringify(r));
} catch(e) {
  console.log('hasPrf не принят:', e.message.slice(0,200));
}
await b.close(); process.exit(0);
