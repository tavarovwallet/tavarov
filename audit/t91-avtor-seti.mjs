/* Режим «Автор» в других сетях (1 октября 2026): ссылки на страницу доната
   и экран OBS несут сеть и адрес этой сети; страница автора в Solana
   подписана ключом Solana — и настоящий сервер (donate.js) эту подпись
   принимает. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
const DON = await import('/home/claude/apk/functions/api/donate.js');

await start(8566);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'author', rpc: 'http://localhost:8566' });

const map = new Map();
const env = { V1_NO_THROTTLE: '1', TILL: {
  async get(k){ const v = map.get(k); return v ? v.body : null; },
  async put(k, body){ map.set(k, { body }); },
  async delete(k){ map.delete(k); },
  async list(){ return { list_complete: true, keys: [] }; } } };
globalThis.fetch = async (url, init) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: null }) });
const asked = [];
await page.route('**/api/donate**', async route => {
  const req = route.request();
  asked.push(req.method() + ' ' + req.url());
  const r = req.method() === 'POST'
    ? await DON.onRequestPost({ env, request: new Request('https://wallet.tavarov.com/api/donate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: req.postData() }) })
    : await DON.onRequestGet({ env, request: new Request(req.url().replace(/^https?:\/\/[^/]+/, 'https://wallet.tavarov.com')) });
  route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
});

const evm = await page.evaluate(() => wallet.evm.address);
const sol = await page.evaluate(() => wallet.solana && wallet.solana.address);
R.ok('у кошелька есть адрес Solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(sol || ''), sol);

await page.evaluate(() => { tab = 'wallet'; setTab('pay'); });
await page.waitForTimeout(600);
R.ok('BNB: ссылка доната — без сети в ссылке (BNB по умолчанию)', !/[?]net=/.test(await page.textContent('#donLink')), await page.textContent('#donLink'));

// ---- Solana ----
asked.length = 0;
await page.evaluate(() => switchNetwork('solana'));
await page.waitForTimeout(900);
const vis = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && !el.closest('.hidden'); }, sel);
R.ok('в Solana донаты есть', await vis('#donBox'));
R.ok('ссылка доната — адрес Solana и сеть', (await page.textContent('#donLink')) === 'https://wallet.tavarov.com/d/' + sol + '?net=solana', await page.textContent('#donLink'));
const obs = await page.textContent('#obsLink');
R.ok('ссылка OBS — адрес Solana как есть (регистр), сеть solana', obs.startsWith('https://wallet.tavarov.com/alert?to=' + sol + '&net=solana&'), obs);
R.ok('подсказки про @имя в Solana нет (имена — для EVM)', !(await vis('#donNoName')));
R.ok('после смены сети список донатов спрошен заново — по адресу Solana', asked.some(a => a.startsWith('GET') && a.includes('net=solana&') && a.includes('to=' + sol) && !/stats|profile/.test(a)), asked.join(' | '));

await page.fill('#donGreet', 'Привет из Solana');
await page.fill('#donGoalTitle', 'Камера');
await page.fill('#donGoalSum', '200');
await page.evaluate(() => saveDonProfile(false));
await page.waitForFunction(() => /Сохранено/.test(document.getElementById('donProfMsg').textContent), null, { timeout: 8000 }).catch(() => {});
R.ok('СТРАНИЦА АВТОРА В SOLANA СОХРАНЕНА — сервер принял подпись ed25519', /Сохранено/.test(await page.textContent('#donProfMsg')), await page.textContent('#donProfMsg'));
const prof = map.get('donprof:solana:' + sol);
R.ok('на сервере — под адресом Solana, с целью', !!prof && JSON.parse(prof.body).g === 'Привет из Solana' && JSON.parse(prof.body).goal.c === 20000, prof && prof.body);
R.ok('ключ Solana после подписи не остался в памяти открытым', await page.evaluate(() => typeof wallet.solana.secretKey === 'string'));

// ---- Ethereum: донаты есть ----
await page.evaluate(() => switchNetwork('eth'));
await page.waitForTimeout(500);
R.ok('Ethereum — донаты есть, ссылка с net=eth', (await vis('#donBox')) && (await page.textContent('#donLink')).endsWith('?net=eth'), await page.textContent('#donLink'));

const own = errors.filter(e => !/Failed to load resource|net::ERR|requestfailed/.test(e));
R.ok('ошибок в коде страницы нет', own.length === 0, own.slice(0, 3).join(' | '));
await browser.close();
process.exit(R.done() ? 0 : 1);
