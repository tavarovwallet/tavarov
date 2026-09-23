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
  /* Экрана подключения кода между паролем и кошельком больше нет:
     опасные действия подтверждает лицо или отпечаток, а в браузере без
     них — пароль от кошелька. Ждём просто готового кошелька. */
  await page.waitForFunction(() => flowStage === 'ready');

  return { browser, ctx, page, errors, console_ };
}

/* Вход в запертый кошелёк. Подтверждения при входе нет: оно спрашивается
   при оплате и на опасных действиях, а вход открывает пароль. */
export async function unlock(page, password = 'testpassword1') {
  await page.fill('#unlockPass', password);
  page.evaluate(() => doUnlock());
  await page.waitForFunction(
    () => flowStage === 'ready'
       || !document.getElementById('confirmModal').classList.contains('hidden')
       || !document.getElementById('unlockError').classList.contains('hidden'),
    null, { timeout: 15000 });
  if (await page.evaluate(() => !document.getElementById('confirmModal').classList.contains('hidden'))) {
    await answerConfirm(page, password);
  }
}

/* Подтверждение опасного действия там, где оно теперь и живёт.

   В песочнице Face ID нет: ключи доступа в headless-браузере не заводятся,
   и приложение честно показывает поле пароля. Проверка отвечает ровно тем
   же, чем ответил бы человек за таким же устройством, — паролем. Никакой
   лазейки «для проверок» в приложении нет: пароль сверяется настоящей
   расшифровкой хранилища. */
export async function answerConfirm(page, password = 'testpassword1', timeout = 8000) {
  try {
    await page.waitForFunction(
      () => !document.getElementById('confirmModal').classList.contains('hidden'),
      null, { timeout });
  } catch (e) { return false; }
  /* Дальше возможны два исхода, и проверка обязана пережить оба.

     Если на стенде поднят виртуальный ключ доступа (так делают проверки
     входа по лицу), приложение подтвердит действие само и закроет окно —
     пароль спрашивать будет не у кого. Если ключа нет, появится поле
     пароля. Ждём того, что случится первым; ждать только поля значит
     однажды провалиться там, где всё как раз сработало. */
  await page.waitForFunction(() => {
    const m = document.getElementById('confirmModal');
    const f = document.getElementById('confirmPassField');
    return m.classList.contains('hidden') || !f.classList.contains('hidden');
  }, null, { timeout: 15000 });
  if (await page.evaluate(() => document.getElementById('confirmModal').classList.contains('hidden')))
    return true;                                  // подтвердилось лицом
  await page.fill('#confirmPass', password);
  await page.evaluate(() => confirmSubmit());
  /* Ждём закрытия ИЛИ ошибки на экране. Без второй ветки неверный пароль
     в проверке выглядел бы как зависшее приложение: голый таймаут, из
     которого не видно, что окно всё это время показывало «неверный
     пароль». */
  await page.waitForFunction(() => {
    const m = document.getElementById('confirmModal');
    const e = document.getElementById('confirmError');
    return m.classList.contains('hidden') || !e.classList.contains('hidden');
  }, null, { timeout: 15000 });
  if (!await page.evaluate(() => document.getElementById('confirmModal').classList.contains('hidden')))
    throw new Error('подтверждение отвергнуто: ' +
      await page.textContent('#confirmError'));
  return true;
}

/* Старое имя: половина проверок зовёт его. Ведёт себя так же. */
export const answerTotp = (page, timeout = 8000) => answerConfirm(page, 'testpassword1', timeout);

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
