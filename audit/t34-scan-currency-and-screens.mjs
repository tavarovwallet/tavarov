/* Валюта из кода и экраны продавца.

   Три живых случая одним набором, все три увидены человеком на телефоне, а
   не машиной.

   ПЕРВЫЙ. Код продавца читался, сумма подставлялась, а валюта — нет. В коде
   на монету сети (BNB) валюта не проставлялась вовсе: разбор кода заполнял
   адрес и сумму, а поле валюты оставалось таким, каким было до сканирования.
   Человек видел свою сумму и чужую валюту и платил восемнадцать USDT там,
   где просили восемнадцать BNB. Ошибка на два порядка, и совершается молча.

   Второй путь к тому же: валюта в коде есть, но в списке её нет — монету
   спрятали в кошельке. Приложение молча оставляло прежнюю. Спрятать монету —
   это решение про то, что показывать, а не разрешение платить не тем.

   ВТОРОЙ. Продавец, зашедший «пополнить с биржи» или «принять перевод»,
   видел форму «выставить счёт» вместо собственного адреса. Пополнить кошелёк
   он не мог вовсе: адреса на экране не было. Досталось это от времён, когда
   экраны делились только по роли, и нижняя проверка молча отменяла верхнюю.

   ТРЕТИЙ. Любое ожидание, добравшееся до конца, падало с «t is not a
   function»: переменную таймера звали так же, как функцию перевода. На
   быстром интернете не проявлялось никогда — вылезло на эмуляторе Android,
   где до узлов сети не дотянуться. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const SHOP = '0x2222222222222222222222222222222222222222';

// ================= покупатель: валюта из кода =================
{
  const { browser, page, errors } = await boot({ role: 'buyer', rpc: 'http://localhost:8555' });

  const scan = (opts) => page.evaluate(async o => {
    const link = buildQrPayload(o);
    await applyScannedPayment(link);
    return { link,
             cur: document.getElementById('sendCurrency').value,
             amt: document.getElementById('sendAmount').value,
             to:  document.getElementById('sendTo').value,
             note: document.getElementById('scanIntentBox').textContent,
             options: [...document.getElementById('sendCurrency').options].map(x => x.value) };
  }, opts);

  let r = await scan({ to: SHOP, m: SHOP, cur: 'USDC', amt: '18.5', name: 'coffee' });
  R.ok('валюта из кода подставлена', r.cur === 'USDC', r.cur);
  R.ok('и сумма тоже', r.amt === '18.5', r.amt);

  /* Монета сети. Тот самый случай, где молчание стоило дороже всего. */
  r = await scan({ to: SHOP, m: SHOP, cur: '', amt: '0.05', name: 'coffee' });
  R.ok('КОД НА МОНЕТУ СЕТИ ПЕРЕКЛЮЧАЕТ ВАЛЮТУ, А НЕ ОСТАВЛЯЕТ ПРЕЖНЮЮ',
    r.cur === 'native', r.cur);
  R.ok('и сумма у него своя', r.amt === '0.05', r.amt);
  R.ok('сумма и валюта не расходятся',
    !(r.cur !== 'native' && r.amt === '0.05'), r.cur + ' / ' + r.amt);

  /* Спрятанная монета: возвращаем в список, а не платим чем попало. */
  await page.evaluate(() => { setTokenHidden(network, 'USDC', true); renderWalletState(); });
  const before = await page.evaluate(() =>
    [...document.getElementById('sendCurrency').options].map(x => x.value));
  R.ok('монета спрятана и из выбора пропала', !before.includes('USDC'), before.join(','));

  r = await scan({ to: SHOP, m: SHOP, cur: 'USDC', amt: '7', name: 'coffee' });
  R.ok('СПРЯТАННАЯ МОНЕТА ВОЗВРАЩАЕТСЯ В СПИСОК, ЕСЛИ ЕЮ ПРОСЯТ ЗАПЛАТИТЬ',
    r.options.includes('USDC'), r.options.join(','));
  R.ok('и выбирается она же', r.cur === 'USDC', r.cur);
  R.ok('и сумма подставлена', r.amt === '7', r.amt);

  /* Совсем незнакомая монета: сумму не подставляем и говорим словами. */
  const unknown = await page.evaluate(async () => {
    await applyScannedPayment('tavarov:pay?to=' + '0x2222222222222222222222222222222222222222'
      + '&m=0x2222222222222222222222222222222222222222&net=bnb&cur=SHIBA&amt=42&name=coffee');
    return { cur: document.getElementById('sendCurrency').value,
             amt: document.getElementById('sendAmount').value,
             note: document.getElementById('scanIntentBox').textContent };
  });
  R.ok('НЕЗНАКОМАЯ МОНЕТА НЕ ПОДСТАВЛЯЕТ СУММУ В ЧУЖОЙ ВАЛЮТЕ',
    unknown.amt === '', 'сумма: ' + unknown.amt);
  R.ok('и человеку сказано, в чём дело',
    /SHIBA/.test(unknown.note) && /нет/.test(unknown.note), unknown.note.slice(0, 90));

  // ---------- ожидание, которое не дождалось ----------
  const said = await page.evaluate(async () => {
    try { await withTimeout(new Promise(()=>{}), 1200); return 'не сработал'; }
    catch(e){ return e.message; }
  });
  R.ok('ОЖИДАНИЕ КОНЧАЕТСЯ ЧЕЛОВЕЧЕСКИМ ТЕКСТОМ, А НЕ «t is not a function»',
    /не ответила|не ответил/i.test(said) && !/is not a function/.test(said), said);
  R.ok('и срок назван числом, а не нулём', !/ 0 /.test(said), said);

  const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
  R.ok('и ни одной ошибки на странице при этом нет', clean.length === 0, clean.join(' | ').slice(0, 90));
  await browser.close();
}

// ================= продавец: свои экраны =================
{
  const { browser, page, errors } = await boot({ role: 'seller', rpc: 'http://localhost:8555' });

  const screen = (mode) => page.evaluate(async m => {
    tab = 'pay'; renderWalletState();
    setPayMode(m);
    await new Promise(r => setTimeout(r, 400));
    const vis = id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden'); };
    return { kassa: vis('kassaGroup'), simple: vis('simpleReceive'), send: vis('sendPanel'),
             addr: (document.getElementById('recvAddr').textContent || '').trim(),
             qr: document.querySelectorAll('#recvQr img, #recvQr canvas').length };
  }, mode);

  let s = await screen('deposit');
  R.ok('ПРОДАВЦУ В «ПОПОЛНИТЬ С БИРЖИ» ПОКАЗЫВАЮТ ЕГО АДРЕС, А НЕ КАССУ',
    s.simple && !s.kassa, JSON.stringify(s));
  R.ok('и адрес там настоящий', /^0x[0-9a-fA-F]{40}$/.test(s.addr), s.addr);
  R.ok('и код нарисован', s.qr > 0, 'картинок: ' + s.qr);

  /* Экран один, а подсказка обязана быть своя: на бирже ошибаются сетью, и
     эта ошибка невозвратная. Общая фраза «покажите код отправителю» тут не
     помогает вовсе. */
  let note = await page.evaluate(() => document.getElementById('recvNote').textContent);
  R.ok('В ПОПОЛНЕНИИ С БИРЖИ СКАЗАНО ПРО СЕТЬ И ЕЁ НАЗВАНИЕ',
    /BEP-20/.test(note) && /сет/i.test(note), note.slice(0, 80));
  R.ok('и предупреждено, что вернуть будет нельзя', /вернуть/i.test(note), note.slice(0, 110));
  R.ok('и про минимальную сумму вывода', /минимальн/i.test(note), note.slice(-70));
  /* Здесь раньше проверялось, что у «пополнить с биржи» и «принять перевод»
     РАЗНЫЕ заголовки и разные подсказки. 18 сентября меню свели к двум
     действиям — «Отправить» и «Принять», — и оба этих режима стали одним
     экраном. Проверка переписана под то, что теперь верно.

     И отдельно: предупреждение про сеть теперь показывают ВСЕГДА, а не
     только при пополнении с биржи. Так безопаснее. Человек, принимающий
     перевод «от друга», сплошь и рядом получает его с биржевого счёта — а
     ошибка сетью невозвратная, и молчать про неё было тем самым случаем,
     когда экономия на строчке стоит чужих денег. */
  R.ok('ЗАГОЛОВОК ПРИЁМА — «ПРИНЯТЬ», ОДИН НА ОБА СЛУЧАЯ',
    /принять/i.test(await page.textContent('#simpleTitle')),
    await page.textContent('#simpleTitle'));

  s = await screen('receive');
  note = await page.evaluate(() => document.getElementById('recvNote').textContent);
  R.ok('ПРО СЕТЬ ПРЕДУПРЕЖДАЮТ И В ОБЫЧНОМ ПРИЁМЕ, А НЕ ТОЛЬКО С БИРЖИ',
    /BEP-20/.test(note), note.slice(0, 80));
  R.ok('и заголовок тот же', /принять/i.test(await page.textContent('#simpleTitle')),
    await page.textContent('#simpleTitle'));
  R.ok('в «принять» — адрес, а не касса', s.simple && !s.kassa, JSON.stringify(s));
  R.ok('и адрес на месте', /^0x[0-9a-fA-F]{40}$/.test(s.addr), s.addr);

  s = await screen('withdraw');
  R.ok('В «ВЫВЕСТИ НА БИРЖУ» КАССЫ НЕТ ВОВСЕ', !s.kassa, JSON.stringify(s));
  R.ok('и это экран отправки', s.send && !s.simple, JSON.stringify(s));

  s = await screen('transfer');
  R.ok('в «перевести человеку» кассы тоже нет', !s.kassa && s.send, JSON.stringify(s));

  s = await screen('kassa');
  R.ok('А В САМОЙ КАССЕ ОНА, РАЗУМЕЕТСЯ, ЕСТЬ', s.kassa && !s.simple, JSON.stringify(s));

  /* Покупателю касса не показывается нигде — роль по-прежнему решает. */
  const buyerKassa = await page.evaluate(async () => {
    userRole = 'buyer'; tab = 'pay'; setPayMode('kassa');
    await new Promise(r => setTimeout(r, 300));
    const e = document.getElementById('kassaGroup');
    return !!e && !e.classList.contains('hidden');
  });
  R.ok('покупателю касса не показывается', !buyerKassa);

  const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
  R.ok('и у продавца страница без ошибок', clean.length === 0, clean.join(' | ').slice(0, 90));
  await browser.close();
}

const good = R.done([]);
srv.close();
process.exit(good ? 0 : 1);
