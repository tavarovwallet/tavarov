/* Ethereum и Base в кошельке (1 октября 2026).

   Проверяется то, на чём можно потерять деньги или запутать человека:
   — сетей три, у каждой свои монеты; в Base нет мостового USDT, TVR нигде,
     кроме BNB;
   — пока контракт оплаты в сети не выпущен, кассы там нет, а переводы есть;
   — когда выпущен — касса есть, а кешбэка нет (и сказано почему);
   — имена читаются из BNB; занять имя можно только в BNB; имя контракта
     в другой сети по имени не переводится;
   — код оплаты из другой сети переключает кошелёк сам и говорит об этом;
     код из тестовой сети (их в приложении больше нет) — остановка;
   — разрешение на USDT сначала обнуляется, если остался хвост;
   — в Base держим запас на плату за запись в Ethereum. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
await start(8582);
const RPC = 'http://localhost:8582';
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', rpc: RPC });
await page.evaluate(url => { ['eth','base'].forEach(k => { MAINNET[k].rpc = url; MAINNET[k].rpcs = [url]; }); }, RPC);
const wait = ms => page.waitForTimeout(ms);

/* Код по адресам подменяем: «контракт» — у одного имени, обычный кошелёк
   с делегированием EIP-7702 — у другого. Остальное отвечает узел-заглушка. */
const CONTRACT_HOLDER = '0x1111111111111111111111111111111111111111';
const EOA_7702 = '0x2222222222222222222222222222222222222222';
await page.route(RPC + '/**', async route => {
  const body = route.request().postDataJSON && route.request().postDataJSON();
  const one = b => b && b.method === 'eth_getCode' && b.params && typeof b.params[0] === 'string';
  if (one(body)){
    const a = body.params[0].toLowerCase();
    const code = a === CONTRACT_HOLDER ? '0x6080604052' : a === EOA_7702 ? '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' : '0x';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: code }) });
  }
  return route.continue();
});
await page.route(RPC, async route => {
  const body = route.request().postDataJSON && route.request().postDataJSON();
  if (body && body.method === 'eth_getCode'){
    const a = String(body.params[0]).toLowerCase();
    const code = a === CONTRACT_HOLDER ? '0x6080604052' : a === EOA_7702 ? '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' : '0x';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result: code }) });
  }
  return route.continue();
});

// ---- сети ----
const pills = await page.evaluate(() => { renderNetPills(); return [...document.querySelectorAll('#netPills .netpill')].map(e => e.textContent); });
R.ok('четыре сети: BNB, Ethereum, Base, Solana', JSON.stringify(pills) === JSON.stringify(['BNB Chain','Ethereum','Base','Solana']), pills.join(', '));
const where = await page.evaluate(() => ({ inDash: !!document.querySelector('#dashCard #netPills'), inSettings: !!document.querySelector('#settingsCard #netPills') }));
R.ok('выбор сети — на главном экране, а не в настройках', where.inDash && !where.inSettings, JSON.stringify(where));
const tn = await page.evaluate(() => ({ eth: !!TESTNET.eth, base: !!TESTNET.base, sol: !!TESTNET.solana, ck: JSON.stringify(CONTRACT_KEYS) }));
R.ok('тестовых Sepolia, Base Sepolia и Solana devnet больше нет', !tn.eth && !tn.base && !tn.sol && !/ethTestnet|baseTestnet/.test(tn.ck), JSON.stringify(tn));
const main = await page.evaluate(() => ['bnb','eth','base'].map(k => MAINNET[k].name + ':' + MAINNET[k].chainId + ':' + Object.keys(MAINNET[k].tokens).join('+')));
R.ok('основные: BNB, Ethereum (USDT+USDC), Base (только USDC)',
  JSON.stringify(main) === JSON.stringify(['BNB Chain:56:USDT+USDC+TVR','Ethereum:1:USDT+USDC','Base:8453:USDC']), main.join(' | '));
const usdtEth = await page.evaluate(() => MAINNET.eth.tokens.USDT);
R.ok('USDT в Ethereum — настоящий, 6 знаков', usdtEth.contract === '0xdAC17F958D2ee523a2206206994597C13D831ec7' && usdtEth.decimals === 6);

await page.evaluate(() => switchNetwork('eth')); await wait(300);
const ethState = await page.evaluate(() => ({ net: network, nav: document.getElementById('navNet').textContent, c: contractsFor(), bonus: bonusesHere(), toks: Object.keys(tokensFor('eth')) }));
R.ok('переключились на Ethereum', ethState.net === 'eth' && ethState.nav === 'Ethereum');
R.ok('TVR в этой сети нет', !ethState.toks.includes('TVR'), ethState.toks.join(','));

// ---- приём: подпись сети ----
const recv = await page.evaluate(() => { setTab('pay'); setPayMode('receive'); return document.getElementById('recvNote').textContent; });
R.ok('на приёме сказано про сеть Ethereum', /Ethereum/.test(recv), recv.slice(0, 90));
await page.evaluate(() => { MAINNET.eth; }); 

// ---- касса после выпуска ----
const after = await page.evaluate(() => ({ c: !!contractsFor(), bonus: bonusesHere(), charges: chargesAddress() }));
R.ok('касса в Ethereum есть, кешбэка нет', after.c && !after.bonus && !!after.charges);
await page.evaluate(() => setTab('cashback')); await wait(300);
const cb = await page.evaluate(() => ({ off: !document.getElementById('cbOff').classList.contains('hidden'), live: !document.getElementById('cbLive').classList.contains('hidden'), text: document.getElementById('cbOffText').textContent }));
R.ok('вкладка кешбэка честно говорит, что TVR только в BNB', cb.off && !cb.live && /BNB Chain/.test(cb.text), cb.text.slice(0, 80));
page.on('dialog', d => d.accept());
const canWeb = await page.evaluate(async () => {
  setTab('pay'); setPayMode('kassa');
  const cur = document.getElementById('kassaCurrency'); if (cur) cur.value = 'USDC';
  const am = document.getElementById('kassaAmount'); if (am) am.value = '5';
  try { await createTicket({}); } catch(e){ return 'createTicket: ' + e.message; }
  const b = document.getElementById('ticketShareBtn');
  const box = document.getElementById('ticketWebBox');
  return (b ? b.classList.contains('hidden') : 'no button') + '|cur=' + (cur && cur.value) + '|tk=' + (typeof ticketInvoice !== 'undefined' ? !!ticketInvoice : '?');
});
R.ok('веб-ссылка на оплату в новой сети есть', /^false\|cur=USDC\|tk=true/.test(String(canWeb)), String(canWeb));
const webNet = await page.evaluate(() => { const t = document.getElementById('ticketWebLink'); const u = t ? t.textContent : '';
  const m = u.match(/[#?&]p=([A-Za-z0-9_-]+)/); if (!m) return 'no link: ' + u.slice(0, 60);
  let b = m[1].replace(/-/g,'+').replace(/_/g,'/'); while (b.length % 4) b += '='; return JSON.parse(decodeURIComponent(escape(atob(b)))).net; });
R.ok('и в ней сеть eth', webNet === 'eth', webNet);
// ---- имена ----
const nm = await page.evaluate(() => ({ addr: namesAddress(), bnbNames: CONTRACTS.bnbMainnet.names, here: namesManagedHere() }));
R.ok('имена в Ethereum читаются из BNB', nm.addr === nm.bnbNames && nm.here === false);
await page.evaluate(() => { setTab('settings'); renderMyName(); }); await wait(200);
const nmUi = await page.evaluate(() => ({ elsewhere: !document.getElementById('myNameElsewhere').classList.contains('hidden'), none: !document.getElementById('myNameNone').classList.contains('hidden') }));
R.ok('в Ethereum вместо «занять имя» — объяснение', nmUi.elsewhere && !nmUi.none);
const writeErr = await page.evaluate(() => { try { namesContract(false); return 'no error'; } catch(e){ return e.message; } });
R.ok('занять имя из Ethereum нельзя', /BNB Chain/.test(writeErr), writeErr.slice(0, 60));

const viaWrap = async (holder) => page.evaluate(async (h) => {
  /* Подменяем ответ контракта имён на уровне узла: addressOf вернёт h. */
  const orig = getEvmProvider('bnb').call.bind(getEvmProvider('bnb'));
  const iface = new ethers.utils.Interface(NAMES_ABI);
  getEvmProvider('bnb').call = async (tx, bt) => {
    if (tx && String(tx.data || '').startsWith(iface.getSighash('addressOf'))) return ethers.utils.defaultAbiCoder.encode(['address'], [h]);
    return orig(tx, bt);
  };
  try { return await namesContract(true).addressOf('kofeinya'); }
  catch(e){ return 'ERR ' + e.message; }
  finally { getEvmProvider('bnb').call = orig; }
}, holder);
const r1 = await viaWrap(CONTRACT_HOLDER), r2 = await viaWrap(EOA_7702);
R.ok('имя за контрактом в другой сети не переводится', /^ERR .*контракт/.test(r1), String(r1).slice(0, 80));
R.ok('имя за кошельком с EIP-7702 переводится', String(r2).toLowerCase() === EOA_7702, String(r2).slice(0, 80));
const other = await page.evaluate(async () => { const c = namesContract(true); return typeof c.nameOf === 'function' && typeof c.isFree === 'function'; });
R.ok('остальные вызовы имён работают через обёртку', other === true);

// ---- код оплаты из другой сети ----
await page.evaluate(() => switchNetwork('bnb')); await wait(200);
await page.evaluate(() => { setTab('pay'); setPayMode('send'); });
const m = '0x9999999999999999999999999999999999999999';
await page.evaluate(async (m) => { await applyScannedPayment('ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=' + m + '&uint256=2500000&tv_m=' + m + '&tv_name=Coffee'); }, m);
await wait(400);
const sw = await page.evaluate(() => ({ net: network, box: document.getElementById('scanIntentBox').textContent, cls: document.getElementById('scanIntentBox').className, to: document.getElementById('sendTo').value, amt: document.getElementById('sendAmount').value, cur: document.getElementById('sendCurrency').value }));
R.ok('код из Base переключил кошелёк на Base', sw.net === 'base', sw.net);
R.ok('и сказал об этом', /Base/.test(sw.box) && !/err/.test(sw.cls), sw.box.slice(0, 120));
R.ok('сумма и монета подставлены', sw.amt === '2.5' && sw.cur === 'USDC' && sw.to.toLowerCase() === m, sw.amt + ' ' + sw.cur);

await page.evaluate(() => switchNetwork('bnb')); await wait(200);
await page.evaluate(async (m) => { await applyScannedPayment('tavarov:pay?to=' + m + '&net=eth&m=' + m + '&cur=USDC&amt=3&name=Shop'); }, m);
await wait(400);
const sw2 = await page.evaluate(() => ({ net: network, box: document.getElementById('scanIntentBox').textContent }));
R.ok('ссылка tavarov:pay с net=eth переключила на Ethereum', sw2.net === 'eth' && /Ethereum/.test(sw2.box), sw2.net + ' | ' + sw2.box.slice(0, 80));

await page.evaluate(() => switchNetwork('bnb')); await wait(200);
await page.evaluate(async (m) => { await applyScannedPayment('ethereum:' + m + '@11155111?value=5e15'); }, m);
await wait(300);
const stop = await page.evaluate(() => ({ net: network, cls: document.getElementById('scanIntentBox').className, to: document.getElementById('sendTo').value }));
R.ok('код из тестовой сети Sepolia — остановка, поля пустые', stop.net === 'bnb' && /err/.test(stop.cls) && stop.to === '', JSON.stringify(stop));

// ---- ссылка на веб-оплату с новой сетью ----
const web = await page.evaluate(() => {
  const o = { m: '0x9999999999999999999999999999999999999999', a: '4', c: 'USDC', h: '0x' + '1'.repeat(64), net: 'base' };
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return payLinkFromUrl('https://wallet.tavarov.com/pay#p=' + b);
});
R.ok('веб-ссылка с net=base понимается', /net=base/.test(web || ''), web);
const webBad = await page.evaluate(() => {
  const o = { m: '0x9999999999999999999999999999999999999999', a: '4', c: 'USDC', h: '0x' + '1'.repeat(64), net: 'polygon' };
  const b = btoa(JSON.stringify(o)).replace(/=+$/, '');
  return payLinkFromUrl('https://wallet.tavarov.com/pay#p=' + b);
});
R.ok('незнакомая сеть в веб-ссылке не принимается', webBad === null);

// ---- разрешение на USDT ----
const ap = await page.evaluate(async () => {
  const calls = [];
  const fake = { approve: async (s, a) => { calls.push(String(a)); return { hash: '0x' + calls.length }; } };
  const save = window.waitTx; window.waitTx = async () => true;
  try {
    await approveExact(fake, '0xS', ethers.BigNumber.from(5), ethers.BigNumber.from(3));
    const a = calls.slice(); calls.length = 0;
    await approveExact(fake, '0xS', ethers.BigNumber.from(5), ethers.BigNumber.from(0));
    return { withTail: a, clean: calls.slice() };
  } finally { window.waitTx = save; }
});
R.ok('хвост разрешения сначала обнуляется (USDT в Ethereum)', JSON.stringify(ap.withTail) === '["0","5"]', JSON.stringify(ap.withTail));
R.ok('без хвоста — одна операция', JSON.stringify(ap.clean) === '["5"]', JSON.stringify(ap.clean));

// ---- запас на L2 ----
const l1 = await page.evaluate(() => [l1Reserve(NETWORKS.base).toString(), l1Reserve(NETWORKS.eth).toString(), l1Reserve(NETWORKS.bnb).toString()]);
R.ok('в Base запас 0,000005 ETH, в Ethereum и BNB — нет', JSON.stringify(l1) === '["5000000000000","0","0"]', l1.join(','));

// ---- переводы новых строк ----
for (const L of ['en','es','tr','pt']){
  const miss = await page.evaluate(L => ['k0e6ad164','k4ace8933','kfb85908b','kf9c5e148'].filter(k => !I18N[L][k] || I18N[L][k] === I18N.ru[k]), L);
  R.ok('переводы на ' + L, miss.length === 0, miss.join(','));
}
R.done(errors.filter(e => !/ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e)));
await browser.close();
process.exit(0);
