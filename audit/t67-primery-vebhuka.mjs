/* Примеры проверки вебхука из документации (/dev) — запускаются как есть.

   Программист магазина скопирует их не читая. Если в примере ошибка, он
   либо отвергнет наши настоящие вебхуки (и не отдаст оплаченный товар), либо
   — хуже — примет поддельный. Поэтому каждый пример здесь получает:
     настоящий вебхук, подписанный так, как подписывает сервер API → 200;
     тот же вебхук с изменённой суммой → 400;
     подпись чужим секретом → 400;
     вебхук часовой давности → 400. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
const API = await import('/home/claude/apk/functions/api/v1/[[path]].js');

let okN = 0, badN = 0;
const ok = (n, c, d) => { if (c) okN++; else badN++;
  console.log((c ? 'OK   ' : 'ПРОВАЛ ') + n + (d !== undefined && d !== '' ? '  [' + String(d).slice(0, 200) + ']' : '')); };

const html = fs.readFileSync('/home/claude/apk/www/dev.html', 'utf8');
const unesc = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pane = (group, name) => {
  const box = html.split('data-group="' + group + '"')[1];
  const m = box.match(new RegExp('<pre data-pane="' + name + '">([\\s\\S]*?)</pre>'));
  return unesc(m[1]);
};
const SECRET = 'whsec_' + 'k'.repeat(43);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));

const body = JSON.stringify({ id: 'evt_' + 'a'.repeat(32), type: 'invoice.paid', created: 1, livemode: true,
  data: { id: '0x' + '1'.repeat(64), status: 'paid', order_id: '1001', amount: '12.5', currency: 'USDT' } });
async function cases(){
  const t = Math.floor(Date.now() / 1000);
  const good = 't=' + t + ',v1=' + await API.signPayload(SECRET, t, body);
  const stale = 't=' + (t - 3600) + ',v1=' + await API.signPayload(SECRET, t - 3600, body);
  const foreign = 't=' + t + ',v1=' + await API.signPayload('whsec_other', t, body);
  return [
    ['настоящий вебхук', good, body, 200],
    ['сумма подменена после подписи', good, body.replace('"12.5"', '"1250"'), 400],
    ['подпись чужим секретом', foreign, body, 400],
    ['вебхук часовой давности (повтор перехваченного)', stale, body, 400],
    ['без подписи', '', body, 400],
  ];
}
const waitPort = async port => { for (let i = 0; i < 50; i++){ try{ await fetch('http://127.0.0.1:' + port + '/'); return; } catch(e){ await new Promise(r => setTimeout(r, 100)); } } };
async function runAgainst(lang, port, url){
  for (const [name, sig, b, want] of await cases()){
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, sig ? { 'Tavarov-Signature': sig } : {}), body: b });
    ok(lang + ': ' + name + ' → ' + want, r.status === want, 'ответ ' + r.status);
  }
}

// ---------------- PHP ----------------
{
  fs.writeFileSync(path.join(dir, 'hook.php'), pane('hook', 'php'));
  const port = 8871;
  const p = spawn('php', ['-S', '127.0.0.1:' + port, path.join(dir, 'hook.php')], { env: Object.assign({}, process.env, { TAVAROV_WEBHOOK_SECRET: SECRET }), stdio: 'ignore' });
  await waitPort(port);
  await runAgainst('PHP', port, 'http://127.0.0.1:' + port + '/tavarov/webhook');
  p.kill();
}

// ---------------- Node.js (express заменён крошечной копией: реестр npm отсюда закрыт) ----------------
{
  const nm = path.join(dir, 'node_modules', 'express');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'package.json'), '{"name":"express","main":"index.js"}');
  fs.writeFileSync(path.join(nm, 'index.js'), `
const http = require('http');
function express(){
  const routes = [];
  const app = { post(p, ...h){ routes.push({ p, h }); }, listen(port, cb){ return http.createServer((req, res) => {
    req.get = n => req.headers[n.toLowerCase()];
    res.sendStatus = c => { res.statusCode = c; res.end(String(c)); };
    const r = routes.find(x => x.p === req.url);
    if (!r){ res.statusCode = 404; return res.end(); }
    let i = 0; const next = () => { const f = r.h[i++]; if (f) f(req, res, next); }; next();
  }).listen(port, cb); } };
  return app;
}
express.raw = () => (req, res, next) => { const ch = []; req.on('data', d => ch.push(d)); req.on('end', () => { req.body = Buffer.concat(ch); next(); }); };
module.exports = express;`);
  const port = 8872;
  fs.writeFileSync(path.join(dir, 'hook.mjs'), pane('hook', 'node') + '\napp.listen(' + port + ');\n');
  const p = spawn('node', [path.join(dir, 'hook.mjs')], { cwd: dir, env: Object.assign({}, process.env, { TAVAROV_WEBHOOK_SECRET: SECRET }), stdio: 'ignore' });
  await waitPort(port);
  await runAgainst('Node.js', port, 'http://127.0.0.1:' + port + '/tavarov/webhook');
  p.kill();
}

// ---------------- Python (Flask) ----------------
{
  const port = 8873;
  fs.writeFileSync(path.join(dir, 'hook.py'), pane('hook', 'python') + '\nif __name__ == "__main__":\n    app.run(port=' + port + ')\n');
  const p = spawn('python3', [path.join(dir, 'hook.py')], { env: Object.assign({}, process.env, { TAVAROV_WEBHOOK_SECRET: SECRET }), stdio: 'ignore' });
  await waitPort(port);
  await runAgainst('Python', port, 'http://127.0.0.1:' + port + '/tavarov/webhook');
  p.kill();
}

// ---------------- примеры выставления счёта хотя бы синтаксически целы ----------------
{
  fs.writeFileSync(path.join(dir, 'create.php'), pane('create', 'php'));
  let phpOk = true; try{ execFileSync('php', ['-l', path.join(dir, 'create.php')], { stdio: 'pipe' }); } catch(e){ phpOk = false; }
  ok('пример счёта на PHP без синтаксических ошибок', phpOk);
  fs.writeFileSync(path.join(dir, 'create.mjs'), 'async function x(order, res){\n' + pane('create', 'node') + '\n}\n');
  let nodeOk = true; try{ execFileSync('node', ['--check', path.join(dir, 'create.mjs')], { stdio: 'pipe' }); } catch(e){ nodeOk = false; }
  ok('пример счёта на Node.js без синтаксических ошибок', nodeOk);
  fs.writeFileSync(path.join(dir, 'create.py'), 'def x(order, redirect):\n' + pane('create', 'python').split('\n').map(l => '    ' + l).join('\n') + '\n');
  let pyOk = true; try{ execFileSync('python3', ['-m', 'py_compile', path.join(dir, 'create.py')], { stdio: 'pipe' }); } catch(e){ pyOk = false; }
  ok('пример счёта на Python без синтаксических ошибок', pyOk);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('\n--- ' + okN + ' из ' + (okN + badN) + ' ---');
process.exit(badN ? 1 : 0);
