/* Страницы tavarov.com под поиск (tools/gen_pages.py): woocommerce,
   accept-usdt, crypto-donations, terms — на русском и английском.

   Проверяется то, что поисковик и человек заметят первым: у каждой страницы
   свой адрес, пара на другом языке (hreflang), описание, разметка вопросов;
   все внутренние ссылки ведут на существующие файлы; на телефоне нет
   горизонтальной прокрутки; ссылки в подвале главной ведут на английские
   страницы, когда выбран не русский. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++; console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 160) + ']' : '')); };

const SITE = '/home/claude/apk/site', PORT = 8877;
const srv = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (!path.extname(rel)) rel += '.html';
  const f = path.join(SITE, rel);
  if (!fs.existsSync(f)){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.xml') ? 'application/xml' : f.endsWith('.txt') ? 'text/plain' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(PORT, r));
const B = 'http://localhost:' + PORT;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

const SLUGS = ['woocommerce', 'accept-usdt', 'crypto-donations', 'partners', 'terms', 'donationalerts-alternative', 'donatepay-alternative', 'streamlabs-crypto-tips'];
const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
for (const slug of SLUGS){
  for (const lang of ['ru', 'en']){
    const p = (lang === 'ru' ? '/' : '/en/') + slug;
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const r = await page.goto(B + p);
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      desc: (document.querySelector('meta[name=description]') || {}).content || '',
      canon: (document.querySelector('link[rel=canonical]') || {}).href || '',
      alt: [...document.querySelectorAll('link[rel=alternate]')].map(l => l.hreflang + '=' + l.href),
      h1: document.querySelectorAll('h1').length,
      hscroll: document.documentElement.scrollWidth > innerWidth,
      ld: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent),
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => !/^(https?:|mailto:)/.test(h))
    }));
    const url = 'https://tavarov.com' + p;
    ok(p + ': открывается, язык ' + lang + ', один h1', r.status() === 200 && info.lang === lang && info.h1 === 1);
    ok(p + ': заголовок и описание', info.title.length > 20 && info.title.length <= 70 && info.desc.length >= 80 && info.desc.length <= 170, info.title.length + ' / ' + info.desc.length);
    ok(p + ': canonical и hreflang ru/en/x-default', info.canon === url && info.alt.includes('ru=https://tavarov.com/' + slug) && info.alt.includes('en=https://tavarov.com/en/' + slug) && info.alt.some(a => a.startsWith('x-default=')));
    ok(p + ': в карте сайта', sitemap.includes('<loc>' + url + '</loc>'));
    ok(p + ': на телефоне без горизонтальной прокрутки и без ошибок', !info.hscroll && errs.length === 0);
    if (slug !== 'terms') ok(p + ': разметка вопросов (FAQPage) для поиска', info.ld.some(x => x['@type'] === 'FAQPage' && x.mainEntity.length >= 3));
    const dead = [];
    for (const h of info.links){
      const abs = new URL(h, B + p).pathname;
      let rel = abs.replace(/^\/+/, '') || 'index.html';
      if (!path.extname(rel)) rel += '.html';
      if (!fs.existsSync(path.join(SITE, rel))) dead.push(h);
    }
    ok(p + ': все внутренние ссылки живые', dead.length === 0, dead.join(', '));
    await ctx.close();
  }
}

ok('скачивание плагина лежит на месте', fs.existsSync(path.join(SITE, 'downloads', 'tavarov-pay.zip')));
ok('демо в браузере: blueprint на месте, ставит WooCommerce и наш архив, открывает настройки плагина', (() => { const bp = JSON.parse(fs.readFileSync(path.join(SITE, 'downloads', 'playground.json'), 'utf8')); return bp.landingPage.includes('section=tavarov_pay') && bp.steps.some(x => x.pluginData && x.pluginData.slug === 'woocommerce') && bp.steps.some(x => x.pluginData && x.pluginData.url === 'https://tavarov.com/downloads/tavarov-pay.zip'); })());
for (const f of ['woocommerce.html', 'en/woocommerce.html']) ok('кнопка демо на ' + f, fs.readFileSync(path.join(SITE, f), 'utf8').includes('playground.wordpress.net/?blueprint-url=https://tavarov.com/downloads/playground.json'));
ok('robots.txt указывает на карту сайта', /Sitemap: https:\/\/tavarov\.com\/sitemap\.xml/.test(fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8')));

// подвал главной
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(B + '/');
const hrefs = async () => page.$$eval('a[data-page]', a => a.map(x => x.getAttribute('href')));
ok('ПОДВАЛ ГЛАВНОЙ: ссылки на новые страницы (рус.)', JSON.stringify(await hrefs()) === JSON.stringify(['./woocommerce', './accept-usdt', './crypto-donations', './partners', './terms']), (await hrefs()).join(' '));
await page.click('#langs button[data-code="es"]');
ok('по-испански — ведут на английские страницы, подписи переведены', (await hrefs()).every(h => h.startsWith('./en/')) && /WooCommerce/.test(await page.textContent('a[data-page="woocommerce"]')) && /Términos/.test(await page.textContent('a[data-page="terms"]')));
await ctx.close();

await browser.close(); srv.close();
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
