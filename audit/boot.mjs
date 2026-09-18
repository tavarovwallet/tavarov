/* Общий стенд: поднимает приложение в настоящем браузере, проходит
   первичную настройку и отдаёт страницу тестам. Всё, что здесь есть, —
   это то, что делает живой человек: нажать «Создать», записать фразу,
   поставить пароль. Никаких закладок в приложении для тестов нет. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export const URL = 'http://localhost:8099/index.html';

/* Приложение раздаём сами. Раньше сервер поднимался руками, и стоило про
   него забыть — все проверки падали с «соединение отклонено», как будто
   сломалось приложение. Проверка не должна зависеть от того, что кто-то
   помнит лишний шаг. */
const ROOT = '/home/claude/apk/www';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
                '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
let siteSrv = null;

async function serveApp() {
  if (siteSrv) return;
  const s = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('нет такого файла'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((resolve, reject) => {
    s.once('error', e => (e.code === 'EADDRINUSE' ? resolve() : reject(e)));   // уже кто-то раздаёт — и хорошо
    /* unref — чтобы сервер не держал процесс: проверке положено
       закончиться и выйти, а не висеть до утра. */
    s.listen(8099, () => { siteSrv = s; s.unref(); resolve(); });
  });
}

export async function boot(opts = {}) {
  await serveApp();
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox']
  });
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    permissions: []
  });
  const page = await ctx.newPage();

  const errors = [];
  const console_ = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    console_.push(m.type() + ': ' + m.text());
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('requestfailed', r => {
    const u = r.url();
    // Внешние узлы сети в тестах недоступны — это ожидаемо и не ошибка стенда.
    if (/^http:\/\/localhost:8099/.test(u)) errors.push('requestfailed: ' + u);
  });

  if (opts.testnet) {
    await ctx.addInitScript(() => { try { localStorage.setItem('tavarov.testnet.v1', '1'); } catch (e) {} });
  }

  /* Язык закрепляем: проверки написаны по-русски, а приложение теперь само
     подстраивается под язык браузера. Отдельная проверка языков (t10) этот
     выбор перекрывает сама. */
  if (opts.lang !== false) {
    await ctx.addInitScript(code => { try { localStorage.setItem('tavarov.lang.v1', code); } catch (e) {} },
                            opts.lang || 'ru');
  }

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.renderWalletState === 'function');

  // подменяем узел сети на местный, чтобы проверять разбор ответов
  if (opts.rpc) {
    await page.evaluate(url => {
      TESTNET.bnb.rpc = url; TESTNET.bnb.rpcs = [url];
      MAINNET.bnb.rpc = url; MAINNET.bnb.rpcs = [url];
    }, opts.rpc);
  }

  if (opts.raw) return { browser, ctx, page, errors, console_ };

  // роль
  await page.evaluate(r => chooseRole(r), opts.role || 'seller');
  // создать кошелёк
  await page.evaluate(() => beginGenerate());
  await page.waitForFunction(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length === 12);
  await page.evaluate(() => finishGenerate());
  await page.fill('#newPass', 'testpassword1');
  await page.fill('#newPass2', 'testpassword1');
  await page.evaluate(() => savePassword());
  /* Двухфакторный код. В браузере он теперь обязателен, пропустить нельзя —
     значит и проверка обязана его пройти, как проходит живой человек: взять
     ключ с экрана, посчитать по нему код и ввести. Считаем средствами самого
     приложения — это те же функции, которыми оно потом код и проверяет.
     Отдельной лазейки «для тестов» в приложении нет и быть не должно. */
  await page.waitForFunction(() => flowStage === 'totp-setup' || flowStage === 'ready');
  if (await page.evaluate(() => flowStage === 'totp-setup')) {
    if (await page.evaluate(() => typeof totpRequired === 'function' && totpRequired())) {
      await page.evaluate(async () => {
        const code = await totpAt(base32Decode(pendingTotpSecret), Math.floor(Date.now() / 1000 / 30));
        document.getElementById('totpSetupCode').value = code;
        await confirmTotpSetup();
      });
    } else {
      await page.evaluate(() => skipTotpSetup());
    }
  }
  await page.waitForFunction(() => flowStage === 'ready');

  return { browser, ctx, page, errors, console_ };
}

/* Вход в запертый кошелёк. Кода при входе больше нет: он спрашивается при
   оплате и на опасных действиях, а вход открывает пароль. Обработку окна с
   кодом оставляем на случай, если оно всё-таки появится, — молча зависнуть
   проверка не должна. */
export async function unlock(page, password = 'testpassword1') {
  await page.fill('#unlockPass', password);
  page.evaluate(() => doUnlock());
  await page.waitForFunction(
    () => flowStage === 'ready' || flowStage === 'totp-setup'
       || !document.getElementById('totpAskModal').classList.contains('hidden')
       || !document.getElementById('unlockError').classList.contains('hidden'),
    null, { timeout: 15000 });
  if (await page.evaluate(() => !document.getElementById('totpAskModal').classList.contains('hidden'))) {
    await page.evaluate(async () => {
      const code = await totpAt(base32Decode(totpAskSecret), Math.floor(Date.now() / 1000 / 30));
      document.getElementById('totpAskCode').value = code;
      await totpAskSubmit();
    });
  }
}

/* Подтверждение кодом там, где оно теперь и живёт: при оплате. Считаем код
   функциями самого приложения — отдельной лазейки «для проверок» в нём нет. */
export async function answerTotp(page, timeout = 8000) {
  try {
    await page.waitForFunction(
      () => !document.getElementById('totpAskModal').classList.contains('hidden'),
      null, { timeout });
  } catch (e) { return false; }
  await page.evaluate(async () => {
    const code = await totpAt(base32Decode(totpAskSecret), Math.floor(Date.now() / 1000 / 30));
    document.getElementById('totpAskCode').value = code;
    await totpAskSubmit();
  });
  return true;
}

export function reporter() {
  const rows = [];
  return {
    ok(name, cond, detail) {
      rows.push({ name, pass: !!cond, detail: detail || '' });
      console.log((cond ? 'OK   ' : 'ПРОВАЛ ') + name + (detail ? '  [' + detail + ']' : ''));
    },
    done(errors) {
      const bad = rows.filter(r => !r.pass);
      console.log('\n--- ' + (rows.length - bad.length) + ' из ' + rows.length + ' ---');
      if (errors && errors.length) {
        console.log('ОШИБКИ СТРАНИЦЫ:');
        [...new Set(errors)].forEach(e => console.log('  ' + e));
      }
      return bad.length === 0 && !(errors || []).length;
    },
    rows
  };
}
