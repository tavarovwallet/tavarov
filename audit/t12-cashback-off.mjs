/* Экран бонусов, когда бонусов в этой сети нет.

   Раньше здесь была кнопка «попробовать в тестовой сети». Тестовый режим из
   приложения убран, и кнопки больше нет — проверяем, что вместо неё сказано
   что-то по существу, а не пустой экран, и что старой отписки «работает
   только в BNB Chain» человек в самой BNB Chain не видит. */
import { boot, reporter } from './boot.mjs';

const R = reporter();
// testnet НЕ включаем: нужна ровно основная сеть
const { browser, page, errors } = await boot({ role: 'buyer' });

/* Контракты в основной сети развёрнуты, а проверять надо состояние «их в
   сборке нет» — то самое, которое видит человек, открывший старую версию
   приложения. Поэтому убираем адреса на время проверки. */
await page.evaluate(() => {
  CONTRACTS.bnbMainnet.pay = null;
  CONTRACTS.bnbMainnet.token = null;
});

await page.evaluate(() => { tab = 'cashback'; renderWalletState(); });
await page.waitForTimeout(400);

R.ok('мы в основной сети BNB', await page.evaluate(() => network === 'bnb' && !testnetOn()));
R.ok('строка про бонусы видна', await page.isVisible('#cbOff'));

const txt = await page.evaluate(() => document.getElementById('cbOffText').textContent);
R.ok('сказано, что в этой сборке касса не настроена',
  /адреса контрактов в неё не вписаны/.test(txt), txt.slice(0, 80));
R.ok('сказано, что кошелёк при этом работает',
  /Приём, отправка и хранение денег/.test(txt));
R.ok('подсказано, что делать', /обновите страницу/.test(txt));
R.ok('старой отписки «только в BNB Chain» здесь нет', !/только в BNB Chain/.test(txt));
R.ok('обещания «скоро развернём» больше нет', !/ещё не развёрнуты/.test(txt));

// ---------- тестового режима в приложении не осталось ----------
R.ok('кнопки «включить тестовую сеть» нет',
  await page.evaluate(() => !document.getElementById('cbOffTry')));
R.ok('переключателя тестовых сетей в настройках нет',
  await page.evaluate(() => !document.getElementById('testnetToggle')));
R.ok('кнопки «получить тестовые монеты» нет',
  await page.evaluate(() => !document.getElementById('faucetBtn')));
R.ok('включить тестовую сеть из приложения нечем',
  await page.evaluate(() => typeof goTestnet === 'undefined' && typeof setTestnet === 'undefined'));

/* Полоса «тестовая сеть» обязана остаться: режим ещё можно включить руками
   через хранилище, и тогда человек должен видеть это на каждом экране. */
await page.evaluate(() => {
  try{ localStorage.setItem(TESTNET_KEY, '1'); } catch(e){}
  NETWORKS = TESTNET; renderWalletState();
});
await page.waitForTimeout(400);
R.ok('включённый вручную тестовый режим виден на экране',
  await page.isVisible('#testnetBanner'));
await page.evaluate(() => {
  try{ localStorage.setItem(TESTNET_KEY, '0'); } catch(e){}
  NETWORKS = MAINNET; renderWalletState();
});

// ---------- не та сеть — прежний текст ----------
await page.evaluate(() => {
  ENABLED_NETS.push('polygon');
  network = 'polygon';
  tab = 'cashback'; renderWalletState();
});
await page.waitForTimeout(400);
const txt2 = await page.evaluate(() => document.getElementById('cbOffText').textContent);
R.ok('в чужой сети сказано именно про сеть', /только в BNB Chain/.test(txt2), txt2.slice(0, 70));

// ---------- на другом языке — тоже не пусто ----------
await page.evaluate(() => { network = 'bnb'; setLang('en'); tab='cashback'; renderWalletState(); });
await page.waitForTimeout(600);
const en = await page.evaluate(() => document.getElementById('cbOffText').textContent);
R.ok('по-английски текст переведён, а не пуст',
  en.length > 20 && !/[А-Яа-я]/.test(en), en.slice(0, 70));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close();
process.exit(good ? 0 : 1);
