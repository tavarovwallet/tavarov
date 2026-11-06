"""Расширение NoN Wallet для Chrome (и Edge, Brave, Opera) — сборка из www/ (22.10.2026).

Тот же кошелёк, что на сайте и в APK, только в окошке расширения. Исходник
один — www/index.html; эта сборка переделывает его под правила расширений:

  1. Chrome не выполняет в расширениях код, вписанный прямо в страницу: ни
     <script>…</script>, ни onclick="…". Поэтому код из <script> выносится в
     файлы js/inline-N.js, а каждый onclick/onchange/oninput/onkeydown — в
     js/handlers.js как обычная функция, и вешается на тот же элемент. this и
     event внутри обработчика — те же, что были; return false — так же отменяет
     действие по умолчанию.
  2. Обращения к нашему серверу (/api/…) и ссылки на наши страницы ведут на
     https://wallet.tavarov.com (у расширения свой адрес chrome-extension://…).
  3. Без service worker'а сайта и без файла manifest.json сайта.
  4. Окошко 380×600; кнопка «Открыть во вкладке» — для сканера QR и долгих дел.

Запуск: python3 build_extension.py  → extension/ и NoN-Wallet-extension.zip
Права расширения — только wallet.tavarov.com (наш сервер). Ни доступа к
сайтам, ни к вкладкам, ни к истории."""
import html, json, os, re, shutil, zipfile
from pathlib import Path
from PIL import Image

# Пути считаются от проекта, а не от машины, на которой когда-то собирали.
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'www'
OUT = ROOT / 'extension'
ZIP = ROOT / 'NoN-Wallet-extension.zip'
SITE = 'https://wallet.tavarov.com'
# Версия расширения — та же, что у кошелька (APP_VERSION в www/index.html):
# сайт, Android и расширение собираются из одного файла и не расходятся.
# 1.0.0–1.0.2 — октябрь 2026; 1.1.3 — имя и пароль вместо 12 слов сначала,
# копия в iCloud или Google Drive (6.11.2026).
VERSION = re.search(r"const APP_VERSION = '([0-9.]+)'", (SRC / 'index.html').read_text(encoding='utf-8')).group(1)

if OUT.exists(): shutil.rmtree(OUT)
(OUT / 'js').mkdir(parents=True)
s = (SRC / 'index.html').read_text(encoding='utf-8')

# ---------- 1. код из <script> — в файлы ----------
scripts = []
def take(m):
    scripts.append(m.group(1))
    return '<script src="./js/inline-%d.js"></script>' % (len(scripts) - 1)
s = re.sub(r'<script>(.*?)</script>', take, s, flags=re.S)

# ---------- 2. обработчики onX="…" — в handlers.js ----------
handlers = []
def hook(m):
    ev, code = m.group(1), html.unescape(m.group(2))
    handlers.append((ev, code))
    return ' data-h-%s="h%d"' % (ev, len(handlers) - 1)
s = re.sub(r'\son(click|change|input|keydown|keyup|submit|focus|blur)="([^"]*)"', hook, s)
left = re.findall(r'\son[a-z]+="', s)
assert not left, ('остались встроенные обработчики', left[:5])

# ---------- 3. адреса нашего сервера ----------
def fix_js(code):
    code = code.replace("IS_NATIVE ? 'https://wallet.tavarov.com", "(IS_NATIVE || window.IS_EXT) ? 'https://wallet.tavarov.com")
    code = code.replace("(IS_NATIVE ? 'https://wallet.tavarov.com' : '')", "((IS_NATIVE || window.IS_EXT) ? 'https://wallet.tavarov.com' : '')")
    code = code.replace("'./sticker.html?'", "(window.IS_EXT ? '" + SITE + "/sticker.html?' : './sticker.html?')")
    code = code.replace("if ('serviceWorker' in navigator && !IS_NATIVE && window.isSecureContext){",
                        "if ('serviceWorker' in navigator && !IS_NATIVE && !window.IS_EXT && window.isSecureContext){")
    return code
scripts = [fix_js(c) for c in scripts]
assert not re.search(r"IS_NATIVE \? '/api", ''.join(scripts)), 'адрес /api без IS_EXT'
s = s.replace('href="./sticker.html"', 'href="' + SITE + '/sticker.html"')
s = re.sub(r'<link rel="manifest"[^>]*>\n?', '', s)
# Мост Tavarov Donate (creator/bridge.js) нужен, только когда кабинет
# creator.tavarov.com открывает wallet.tavarov.com своим окном. Расширение
# так не открывают, а файла в нём нет: без этой строки Chrome писал
# ERR_FILE_NOT_FOUND при каждом открытии кошелька.
s = re.sub(r'<script type="module" src="/creator/bridge\.js[^"]*"></script>\n?', '', s)
# Ни одного адреса от корня сайта: в расширении «/» — это само расширение.
left = re.findall(r'(?:src|href)="/(?!/)[^"]*"', s)
assert not left, ('адреса от корня сайта', left[:5])

# окружение расширения — самым первым скриптом
s = s.replace('<script src="./js/inline-0.js"></script>', '<script src="./js/ext-env.js"></script>\n<script src="./js/inline-0.js"></script>', 1)
# обработчики — последним, когда вся разметка уже есть
s = s.replace('</body>', '<script src="./js/handlers.js"></script>\n</body>', 1)
assert 'js/handlers.js' in s and 'js/ext-env.js' in s

for i, c in enumerate(scripts):
    (OUT / 'js' / ('inline-%d.js' % i)).write_text(c, encoding='utf-8')

hjs = ['/* Собрано tools/build_extension.py из onclick/onchange/… в www/index.html. */',
       '(function(){', 'var H = {']
for i, (ev, code) in enumerate(handlers):
    hjs.append('h%d: function(event){ %s\n},' % (i, code))
hjs += ['};',
        'var EVENTS = ' + json.dumps(sorted({ev for ev, _ in handlers})) + ';',
        'EVENTS.forEach(function(ev){',
        "  document.querySelectorAll('[data-h-' + ev + ']').forEach(function(el){",
        "    var fn = H[el.getAttribute('data-h-' + ev)];",
        '    if (!fn) return;',
        '    el.addEventListener(ev, function(event){ if (fn.call(el, event) === false) event.preventDefault(); });',
        '  });',
        '});',
        '})();']
(OUT / 'js' / 'handlers.js').write_text('\n'.join(hjs) + '\n', encoding='utf-8')

(OUT / 'js' / 'ext-env.js').write_text(r"""/* Кошелёк открыт как расширение браузера. */
window.IS_EXT = true;
(function(){
  var tab = /[?&]tab=1/.test(location.search);
  if (tab) document.documentElement.classList.add('ext-tab');
  document.addEventListener('DOMContentLoaded', function(){
    if (tab || !(window.chrome && chrome.tabs)) return;
    /* «Открыть во вкладке»: сканер QR и долгие дела удобнее в полном окне. */
    var nav = document.querySelector('.nav');
    if (!nav) return;
    var b = document.createElement('button');
    b.className = 'ext-tab-btn'; b.type = 'button';
    b.title = 'Open in a tab'; b.setAttribute('aria-label', 'Open in a tab');
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>';
    b.addEventListener('click', function(){ chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') }); window.close(); });
    /* рядом с шестерёнкой «Настройки», справа в шапке */
    (document.querySelector('.nav-right') || nav).appendChild(b);
  });
  /* Камера в маленьком окошке расширения не работает: Chrome не может показать
     там вопрос «разрешить камеру?». Поэтому сканер QR открывается во вкладке,
     а там — сам, как только кошелёк открыт. */
  document.addEventListener('DOMContentLoaded', function(){
    if (!tab && window.chrome && chrome.tabs){
      window.openQrScanner = function(){
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1&scan=1') });
        window.close();
      };
    }
    if (tab && /[?&]scan=1/.test(location.search)){
      var tries = 0;
      var t = setInterval(function(){
        tries++;
        var ready = false;
        try{ ready = (typeof flowStage !== 'undefined' && flowStage === 'ready' && !!wallet); } catch(e){}
        if (ready){ clearInterval(t); try{ quickAction('scan'); } catch(e){} }
        else if (tries > 1200) clearInterval(t);          // 10 минут ждём, пока откроют кошелёк
      }, 500);
    }
  });
})();
""", encoding='utf-8')

# размер окошка
s = s.replace('</style>', """
/* Расширение: окошко 380×600; во вкладке — как сайт. */
html:not(.ext-tab), html:not(.ext-tab) body{ width:380px; height:600px; }
.ext-tab-btn{ background:none; border:none; padding:6px; margin-left:0; margin-right:-6px; color:var(--label-2); cursor:pointer; border-radius:10px; display:inline-flex; } .nav-right .nav-icon{ margin-right:0; } .nav-right{ gap:2px; }
.ext-tab-btn svg{ width:18px; height:18px; }
.ext-tab-btn:hover{ background:var(--fill); }
</style>""", 1)
(OUT / 'popup.html').write_text(s, encoding='utf-8')

# ---------- 4. файлы ----------
for d in ['lib', 'fonts']:
    shutil.copytree(SRC / d, OUT / d)
# Библиотека сканера предупреждает «камера только по https», хотя у расширения
# свой безопасный адрес chrome-extension:// — камера там разрешена.
qp = OUT / 'lib' / 'qr-scanner.umd.min.js'
q = qp.read_text(encoding='utf-8')
old = '"https:"!==window.location.protocol&&console.warn('
assert q.count(old) == 1, 'qr-scanner: не нашёл проверку https'
q = q.replace(old, '"https:"!==window.location.protocol&&"chrome-extension:"!==window.location.protocol&&console.warn(')
qp.write_text(q, encoding='utf-8')
(OUT / 'img').mkdir()
shutil.copy2(SRC / 'img' / 'coins.webp', OUT / 'img' / 'coins.webp')
(OUT / 'icons').mkdir()
icon = Image.open(SRC / 'icon-192.png').convert('RGBA')
for n in (16, 32, 48, 128):
    icon.resize((n, n), Image.LANCZOS).save(OUT / 'icons' / ('icon-%d.png' % n))

manifest = {
    'manifest_version': 3,
    'name': 'NoN Wallet — USDT & USDC',
    'short_name': 'NoN Wallet',
    'version': VERSION,
    'description': 'Non-custodial wallet for USDT and USDC on BNB Chain, Ethereum, Base and Solana. Swap coins, get paid by QR. Keys stay with you.',  # не длиннее 132 знаков — иначе Chrome Web Store не примет архив
    'action': {'default_popup': 'popup.html', 'default_title': 'NoN Wallet',
               'default_icon': {str(n): 'icons/icon-%d.png' % n for n in (16, 32, 48)}},
    'icons': {str(n): 'icons/icon-%d.png' % n for n in (16, 32, 48, 128)},
    'host_permissions': [SITE + '/*'],
    'minimum_chrome_version': '110',
    'homepage_url': 'https://tavarov.com',
}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

if ZIP.exists(): ZIP.unlink()
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(OUT):
        for f in files:
            p = Path(root) / f; z.write(p, p.relative_to(OUT).as_posix())
print('ok: scripts', len(scripts), 'handlers', len(handlers), 'zip', round(ZIP.stat().st_size / 1024), 'KB')
