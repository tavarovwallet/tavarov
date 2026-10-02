/* Служебный работник (service worker) для Tavarov Wallet.
 *
 * Делает две вещи:
 *   1. Кошелёк открывается без интернета — файлы лежат в кэше браузера.
 *   2. Приложение можно установить на экран «Домой» как обычное.
 *
 * Чего он НЕ делает: не трогает запросы в блокчейн и к курсам. Такие
 * ответы кэшировать нельзя — покажет вчерашний баланс, а человек решит,
 * что у него украли деньги. Всё, что не наши файлы, идёт мимо кэша.
 *
 * ПОЧЕМУ ЗДЕСЬ ДВА РАЗНЫХ ПРАВИЛА
 *
 *   Первая версия отдавала из кэша всё подряд, а свежее подтягивала «на
 *   следующий раз». Из-за этого после каждого обновления человек видел
 *   ПРОШЛУЮ версию приложения: новая попадала в кэш, но показывалась
 *   только со следующего открытия. Выложил исправление — а на экране всё
 *   по-старому, и кажется, что ничего не починили.
 *
 *   Теперь само приложение (index.html) берётся из сети, и только если
 *   сети нет — из кэша. Оно маленькое, задержки не видно.
 *
 *   Библиотеки — наоборот, из кэша: они весят больше мегабайта и не
 *   меняются годами. Когда меняются, у них меняется и версия в имени
 *   кэша ниже.
 */
const CACHE = 'tavarov-v4';   // v4: шрифты витрины (Manrope, Unbounded) лежат в кэше, чтобы без сети не прыгал текст
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './lib/ethers.umd.min.js',
  './lib/nacl-fast.min.js',
  './lib/qrcode.min.js',
  './lib/qr-scanner.umd.min.js',
  './lib/qr-scanner-worker.min.js',
  './fonts/manrope-cyrillic.woff2',
  './fonts/manrope-latin.woff2',
  './fonts/unbounded-cyrillic.woff2',
  './fonts/unbounded-latin.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // не смогли закэшировать — не беда, работаем из сети
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Само приложение — это переход по адресу или запрос html. */
function isApp(req, url){
  return req.mode === 'navigate'
      || url.pathname.endsWith('/')
      || url.pathname.endsWith('index.html')
      || url.pathname.endsWith('manifest.json');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Чужие адреса — узлы сетей, курсы — всегда только из сети, без кэша.
  if (url.origin !== self.location.origin) return;

  /* Ответы шлюза не кэшируем НИКОГДА. «Оплачено ли» — вопрос, ответ на
     который меняется через минуту; отданный из памяти вчерашний «нет»
     означал бы, что продавец не увидит уже пришедшие деньги, а покупателя
     отправят платить второй раз. */
  if (url.pathname.startsWith('/api/')) return;

  if (isApp(req, url)){
    /* Сначала сеть: человек должен видеть ту версию, которую вы выложили.

       В кэш кладём страницу БЕЗ строки запроса. Раньше ключом был полный
       адрес, и в хранилище браузера — на том же сайте, где лежит кошелёк, —
       оседали счета целиком: «/pay?p=…» с продавцом, суммой и товаром,
       «/sticker?m=…&n=Моя кофейня». Страница от этого не меняется: данные
       счёта она читает из адреса сама. */
    const key = new Request(url.origin + url.pathname);
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic'){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy));
        }
        return res;
      }).catch(() => caches.match(key).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Библиотеки: из кэша мгновенно, свежее подтянется в фоне.
  e.respondWith(
    caches.match(req).then(hit => {
      const fromNet = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic'){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || fromNet;
    })
  );
});
