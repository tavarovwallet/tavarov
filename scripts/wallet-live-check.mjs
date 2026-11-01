// Opens the live wallet in a real browser and reads the incoming-payments
// list (the one with the Refund button) for known test merchants, read-only.
import { chromium } from 'playwright';
const cases = [
  ['bnb', '0xFF33E4e0d47650b7D15e6fC1Df788133c464D0E4'],
  ['bnb', '0xb02571d5eae3f72af7efc8e4b0a930db5ae1373a'],
  ['base', '0xb02571d5eae3f72af7efc8e4b0a930db5ae1373a'],
];
const b = await chromium.launch();
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.goto('https://wallet.tavarov.com/?v=' + Date.now(), { waitUntil: 'load' });
await p.waitForFunction(() => typeof loadIncoming === 'function', null, { timeout: 30000 });
const out = [];
for (const [net, addr] of cases){
  const r = await p.evaluate(async ([net, addr]) => {
    const saveW = wallet, saveN = network; network = net; wallet = { evm: { address: addr } };
    const t0 = Date.now(); let err = null;
    try{ await loadIncoming(); } catch(e){ err = String(e); }
    const res = { ms: Date.now() - t0, err, box: document.getElementById('incomingList').innerText.slice(0, 160),
      items: incoming.map(it => it.sym + ' ' + ethers.utils.formatUnits(it.gross, it.decimals) + ' refunded=' + (it.refunded ? ethers.utils.formatUnits(it.refunded, it.decimals) : '?')),
      buttons: document.querySelectorAll('#incomingList button').length };
    wallet = saveW; network = saveN; return res;
  }, [net, addr]);
  out.push({ net, addr, ...r });
}
console.log(JSON.stringify({ pageErrors: errs, out }, null, 1));
await b.close();
const failed = out.some(o => /не отвечает|not answering/i.test(o.box)) || errs.length;
process.exit(failed ? 1 : 0);
