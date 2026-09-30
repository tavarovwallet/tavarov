/* Общее для Telegram-бота Tavarov Pay: вызов Bot API, тексты сообщений,
   уведомления «оплачено». Этим файлом пользуются и сам бот (tg/[[path]].js),
   и таймер API v1 — он находит оплату в сети и зовёт уведомление отсюда.

   Токен бота живёт только в секрете Cloudflare TG_BOT_TOKEN. В код, в
   хранилище и в ответы он не попадает никогда. Секрет вебхука выводится из
   токена (HMAC), поэтому второго секрета заводить не нужно: сменили токен
   у @BotFather — сменился и он. */

export const TG_HOOK_URL = 'https://wallet.tavarov.com/api/tg';

/* Наш кошелёк предлагаем всем: кому нужен кошелёк — создать, у кого уже
   есть — смотреть оплаты и возвращать деньги. */
export const APP_URL = 'https://tavarov.com/#download';
export const WEB_URL = 'https://wallet.tavarov.com';
export const appButtons = (L, kind) => kind === 'open'
  ? { inline_keyboard: [[{ text: L.btnApp, url: WEB_URL }]] }
  : { inline_keyboard: [[{ text: L.btnGetApp, url: APP_URL }]] };

export function hasBot(env){ return !!(env && env.TG_BOT_TOKEN); }

async function hmacHex(secret, text){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Подпись ссылок встроенного режима (@бот 25 в чужом чате): ссылку может
   выпустить только бот, подделать сумму или кошелёк в ней нельзя. */
export async function linkSig(env, data){
  return (await hmacHex(String(env.TG_BOT_TOKEN), 'tavarov-tg-link-v1:' + data)).slice(0, 32);
}
export async function sha256hex(text){
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Отправка файла (QR-код картинкой). Возвращает то же, что tgCall. */
export async function tgUpload(env, method, fields, fileField, bytes, filename){
  if (!hasBot(env)) return { ok: false, code: 0, none: true };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  fd.append(fileField, new Blob([bytes], { type: 'image/png' }), filename);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try{
    const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/' + method, { method: 'POST', body: fd, signal: ctl.signal });
    let d = null;
    try{ d = await r.json(); } catch(e){}
    return { ok: !!(d && d.ok), code: r.status, result: d && d.result, desc: d && d.description };
  } catch(e){
    return { ok: false, code: 0 };
  } finally { clearTimeout(timer); }
}

/* Секрет, который Telegram присылает в заголовке X-Telegram-Bot-Api-Secret-Token.
   Разрешены только буквы, цифры, _ и -; до 256 знаков. */
export async function hookSecret(env){
  return (await hmacHex(String(env.TG_BOT_TOKEN), 'tavarov-tg-webhook-v1')).slice(0, 48);
}

/* Вызов Bot API. Возвращает { ok, code, result }. Ошибки сети не бросает. */
export async function tgCall(env, method, body){
  if (!hasBot(env)) return { ok: false, code: 0, none: true };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try{
    const r = await fetch('https://api.telegram.org/bot' + env.TG_BOT_TOKEN + '/' + method, {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}) });
    let d = null;
    try{ d = await r.json(); } catch(e){}
    return { ok: !!(d && d.ok), code: r.status, result: d && d.result, desc: d && d.description };
  } catch(e){
    return { ok: false, code: 0 };
  } finally { clearTimeout(timer); }
}

/* ---------- язык ---------- */

const RU_LIKE = ['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg'];
export function langOf(code){
  const c = String(code || '').toLowerCase().slice(0, 2);
  return RU_LIKE.includes(c) ? 'ru' : 'en';
}

/* Для HTML-разметки Telegram: всё, что пришло от людей, экранируем. */
export function esc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function shortAddr(a){ a = String(a || ''); return a.slice(0, 6) + '…' + a.slice(-4); }

/* Сумма для людей: «1 250.5» по-русски, «1,250.5» по-английски. */
export function money(a, lang){
  const s = String(a);
  const [w, f] = s.split('.');
  const sep = lang === 'ru' ? ' ' : ',';
  const ww = w.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const out = f ? ww + '.' + f : ww;
  return lang === 'ru' ? out.replace('.', ',') : out;
}

/* ---------- тексты ---------- */

export const T = {
  ru: {
    hello: n => '👋 ' + (n ? esc(n) + ', привет!' : 'Привет!') + '\n\n' +
      'Я выставляю счета в <b>USDT и USDC</b>. Покупатель платит с любого кошелька — MetaMask, Trust Wallet, NoN Wallet и других, — а деньги <b>сразу приходят на ваш кошелёк</b>. Комиссия 1%, ни абонплаты, ни вывода.\n\n' +
      'Для начала пришлите <b>адрес вашего кошелька в сети BNB Chain</b> — он начинается с <code>0x</code>. На него будут приходить деньги.\n\n' +
      '📲 Нет кошелька? Создайте бесплатно в <b>NoN Wallet</b> — за минуту, в браузере или на Android, — и пришлите сюда его адрес.',
    helloBack: (w) => '👋 С возвращением! Деньги приходят на <code>' + esc(w) + '</code>.\n\n' +
      'Напишите сумму — например <b>25</b> или <b>12.5 кофе и десерт</b> — и я пришлю ссылку на оплату.',
    walletSaved: (w) => '✅ Кошелёк сохранён:\n<code>' + esc(w) + '</code>\n\n' +
      'Проверьте адрес: деньги будут приходить именно сюда. Лучше свой кошелёк (MetaMask, Trust Wallet, NoN Wallet), а не адрес на бирже.\n\n' +
      'Теперь просто напишите сумму — например <b>25</b> или <b>12.5 USDC заказ 17</b>.\n' +
      'Название магазина на странице оплаты: /name\n\n' +
      '💡 В <b>NoN Wallet</b> видно все оплаты, а вернуть деньги покупателю можно одной кнопкой.',
    walletBad: 'Это не похоже на адрес кошелька. Нужен адрес сети BNB Chain: <code>0x</code> и ещё 40 знаков.',
    walletBlocked: '⛔ Этот адрес помечен как небезопасный — деньги на него принимать нельзя. Пришлите другой кошелёк.',
    walletContract: '⚠️ Это адрес контракта Tavarov Pay или монеты, а не кошелёк. Пришлите адрес своего кошелька.',
    needWallet: 'Сначала пришлите адрес кошелька в сети BNB Chain (начинается с <code>0x</code>) — туда будут приходить деньги.\n\n📲 Нет кошелька — создайте в NoN Wallet, это бесплатно.',
    walletNow: (w) => 'Деньги приходят на:\n<code>' + esc(w) + '</code>\n\nЧтобы сменить — просто пришлите новый адрес.',
    amountBad: 'Не понял сумму. Напишите число, например <b>25</b>, <b>12.5</b> или <b>12,5 USDC кофе</b>.',
    amountRange: 'Сумма должна быть от 0.1 до 100 000.',
    amountAmbiguous: 'Не понял: это тысяча или единица? Напишите без запятой-разделителя — <b>1000</b> — или с точкой: <b>1.5</b>.',
    tooMany: 'Слишком много счетов подряд. Подождите пару минут.',
    invoice: (a, c, memo, hours) => '🧾 <b>Счёт на ' + money(a, 'ru') + ' ' + c + '</b>' + (memo ? '\n«' + esc(memo) + '»' : '') +
      '\n\nОтправьте покупателю ссылку ниже или откройте её сами и покажите QR-код.\nСсылка действует ' + hours + ' ч. Как только оплатят — напишу сюда.',
    btnOpen: 'Открыть страницу оплаты',
    btnShare: 'Переслать покупателю',
    btnCheck: 'Проверить оплату',
    btnGetApp: '📲 Создать кошелёк NoN Wallet',
    btnApp: '📲 Открыть NoN Wallet',
    shareText: (a, c, memo) => 'Оплата ' + money(a, 'ru') + ' ' + c + (memo ? ' — ' + memo : ''),
    paid: (a, c, memo, got, tx, late) => '✅ <b>Оплачено: ' + money(a, 'ru') + ' ' + c + '</b>' + (memo ? '\n«' + esc(memo) + '»' : '') +
      '\n\n' + (got ? 'На ваш кошелёк пришло <b>' + money(got, 'ru') + ' ' + c + '</b> (за вычетом комиссии).' : 'Деньги уже на вашем кошельке (за вычетом комиссии 1%).') +
      (late ? '\nОплатили после срока действия ссылки — но деньги пришли.' : '') +
      (tx ? '\n<a href="https://bscscan.com/tx/' + tx + '">Транзакция в BscScan</a>' : '') +
      '\n\nБаланс, история оплат и возврат покупателю — в NoN Wallet.',
    warnUnder: (a, c, got, memo) => '⚠️ <b>Оплата меньше суммы счёта</b>' + (memo ? ' «' + esc(memo) + '»' : '') + '\nСчёт: ' + money(a, 'ru') + ' ' + c + ', заплатили: ' + money(got, 'ru') + '.\nДеньги на вашем кошельке, решите с покупателем, как быть с разницей.',
    warnCur: (a, c, got, cur, memo) => '⚠️ <b>Оплатили не той монетой</b>' + (memo ? ' «' + esc(memo) + '»' : '') + '\nСчёт: ' + money(a, 'ru') + ' ' + c + ', пришло: ' + money(got, 'ru') + ' ' + esc(cur) + '.\nДеньги на вашем кошельке.',
    stPending: 'Пока не оплачен. Как только оплатят — напишу.',
    stPaid: 'Оплачен ✅',
    stExpired: 'Срок ссылки истёк, оплаты не было.',
    stUnder: 'Оплачен не полностью.',
    stCur: 'Оплачен не той монетой.',
    stRefunded: 'Деньги возвращены покупателю.',
    stNotFound: 'Этот счёт не найден.',
    stNet: 'Сеть сейчас не отвечает, попробуйте через минуту.',
    listEmpty: 'Счетов пока нет. Напишите сумму — пришлю ссылку на оплату.',
    listHead: '🧾 <b>Последние счета</b>',
    lPaid: 'оплачен', lPending: 'ждёт', lExpired: 'истёк', lUnder: 'недоплата', lCur: 'не та монета', lRefunded: 'возврат',
    nameAsk: 'Пришлите название одной строкой после команды, например:\n<code>/name Кофейня на Садовой</code>\n\nОно будет видно покупателю на странице оплаты. Убрать: <code>/name -</code>',
    nameSaved: n => n ? '✅ Название сохранено: <b>' + esc(n) + '</b>' : '✅ Название убрано.',
    nameBad: 'Название — одной строкой, до 48 знаков.',
    help: '<b>Как пользоваться</b>\n\n' +
      '• Напишите сумму — <b>25</b>, <b>12.5</b> или <b>12,5 USDC кофе</b> — пришлю ссылку на оплату. По умолчанию USDT.\n' +
      '• Перешлите ссылку покупателю или покажите QR-код со страницы оплаты.\n' +
      '• Оплатят — я напишу. Деньги сразу на вашем кошельке, комиссия 1%.\n\n' +
      '• В любом чате с клиентом: <code>@{bot} 25 кофе</code> — клиенту придёт кнопка «Оплатить».\n\n' +
      '/list — последние счета\n/stats — сколько оплатили\n/ref — партнёрская программа: 20% нашей комиссии\n/wallet — кошелёк для оплат\n/name — название на странице оплаты\n\n' +
      '📲 <b>NoN Wallet</b> — наш кошелёк: баланс, история оплат, возврат покупателю, касса с QR. Бесплатно: wallet.tavarov.com или приложение для Android на tavarov.com',
    groups: 'Я работаю только в личных сообщениях — напишите мне напрямую.',
    other: 'Напишите сумму, например <b>25</b>, — и я пришлю ссылку на оплату. Подсказка: /help',
    off: 'Бот временно не может выставить счёт. Попробуйте позже.',
    askName: '🏷 <b>Как подписать вас на странице оплаты?</b>\nНапример: «Кофейня на Садовой» или «Анна, маникюр». Так покупатель поймёт, кому платит.\n\nНапишите одной строкой или нажмите «Пропустить».',
    btnSkip: 'Пропустить',
    skipped: 'Хорошо, без названия. Добавить потом: /name\n\nТеперь напишите сумму — например <b>25</b>.',
    ready: 'Готово! Теперь просто напишите сумму — например <b>25</b> или <b>12,5 кофе</b>.',
    btnAgain: '🔁 Ещё такой же счёт',
    qrCaption: 'Покажите этот QR-код покупателю — он отсканирует его камерой или кошельком.',
    statsHead: '📊 <b>Оплаты</b>',
    statsLine: (label, n, sums) => label + ': ' + (n ? '<b>' + n + '</b> — ' + sums : 'нет'),
    statsToday: 'Сегодня', statsWeek: 'За 7 дней', statsMonth: 'За 30 дней',
    statsWaiting: n => n ? '\n⏳ Ждут оплаты: ' + n : '',
    statsNote: '\n\nСчитаются последние 50 счетов. Все оплаты — в NoN Wallet.',
    inlineTitle: (a, c, memo) => 'Счёт на ' + money(a, 'ru') + ' ' + c + (memo ? ' — ' + memo : ''),
    inlineDesc: 'Нажмите — счёт с кнопкой «Оплатить» уйдёт в этот чат',
    inlineMsg: (a, c, memo, name) => '🧾 <b>Счёт на ' + money(a, 'ru') + ' ' + c + '</b>' + (memo ? '\n«' + esc(memo) + '»' : '') + (name ? '\nОт: ' + esc(name) : '') +
      '\n\nОплата в USDT/USDC с любого кошелька — MetaMask, Trust Wallet, NoN Wallet. Ссылка действует 24 ч.',
    btnPay: (a, c) => '💳 Оплатить ' + money(a, 'ru') + ' ' + c,
    inlineNoWallet: 'Сначала подключите кошелёк в боте',
    inlineHelp: 'Напишите сумму: @{bot} 25 кофе',
    goBad: 'Ссылка на оплату повреждена. Попросите продавца прислать счёт заново.',
    goNoWallet: 'Продавец ещё не подключил кошелёк. Попросите его прислать счёт заново.',
    refInvite: by => '🤝 Вас пригласил партнёр <code>' + esc(by) + '</code>.\n\nЗакрепите его — он год будет получать пятую часть <b>нашей</b> комиссии с ваших продаж. Вы ничего не теряете: ваша выручка и цены для покупателей не меняются. Закрепить можно только до первой продажи.',
    btnRefBind: '🤝 Закрепить партнёра',
    refCabinet: (n, earned, page, tg) => '🤝 <b>Партнёрская программа</b>\n\nПриведите продавца, стримера или магазин — и <b>год</b> вам будет идти <b>20% нашей комиссии</b> с каждой его продажи. Автоматически, прямо на ваш кошелёк, той же операцией, что и оплата.\n\nВы привели: <b>' + n + '</b>\nЗаработано: <b>' + earned + '</b>\n\nВаша ссылка для Telegram:\n' + tg + '\n\nДля сайта или соцсетей (работает с любым кошельком):\n' + page,
    btnRefShare: '📤 Поделиться ссылкой',
    btnRefAbout: 'Как это работает',
    refShareText: 'Принимай оплату в USDT и USDC — деньги сразу на твой кошелёк, комиссия 1%',
    inlineTip: '💬 <b>Счёт прямо в переписке с клиентом:</b> в любом чате напишите <code>@{bot} 25 кофе</code> и выберите «Счёт на 25 USDT» — клиенту придёт кнопка «Оплатить».'
  },
  en: {
    hello: n => '👋 ' + (n ? 'Hi, ' + esc(n) + '!' : 'Hi!') + '\n\n' +
      'I create invoices in <b>USDT and USDC</b>. Your customer pays from any wallet — MetaMask, Trust Wallet, NoN Wallet and others — and the money <b>lands straight in your wallet</b>. 1% fee, no subscription, no payouts to wait for.\n\n' +
      'To start, send me <b>your wallet address on BNB Chain</b> — it starts with <code>0x</code>. That\'s where the money will go.\n\n' +
      '📲 No wallet? Create one for free in <b>NoN Wallet</b> — takes a minute, in the browser or on Android — and send me its address.',
    helloBack: (w) => '👋 Welcome back! Payments go to <code>' + esc(w) + '</code>.\n\n' +
      'Send me an amount — like <b>25</b> or <b>12.5 coffee and cake</b> — and I\'ll send a payment link.',
    walletSaved: (w) => '✅ Wallet saved:\n<code>' + esc(w) + '</code>\n\n' +
      'Double-check it: payments will go exactly here. Use your own wallet (MetaMask, Trust Wallet, NoN Wallet), not an exchange deposit address.\n\n' +
      'Now just send an amount — like <b>25</b> or <b>12.5 USDC order 17</b>.\n' +
      'Shop name on the payment page: /name\n\n' +
      '💡 In <b>NoN Wallet</b> you see every payment and can refund a customer with one tap.',
    walletBad: 'That doesn\'t look like a wallet address. I need a BNB Chain address: <code>0x</code> followed by 40 characters.',
    walletBlocked: '⛔ This address is flagged as unsafe — payments can\'t go there. Please send another wallet.',
    walletContract: '⚠️ That\'s the Tavarov Pay contract or a token address, not a wallet. Please send your wallet address.',
    needWallet: 'First, send your wallet address on BNB Chain (starts with <code>0x</code>) — that\'s where payments will go.\n\n📲 No wallet? Create one in NoN Wallet, it\'s free.',
    walletNow: (w) => 'Payments go to:\n<code>' + esc(w) + '</code>\n\nTo change it, just send a new address.',
    amountBad: 'I didn\'t get the amount. Send a number like <b>25</b>, <b>12.5</b> or <b>12.5 USDC coffee</b>.',
    amountRange: 'The amount must be between 0.1 and 100,000.',
    amountAmbiguous: 'Is that a thousand or one? Please write it without a thousands separator — <b>1000</b> — or with a dot: <b>1.5</b>.',
    tooMany: 'Too many invoices in a row. Please wait a couple of minutes.',
    invoice: (a, c, memo, hours) => '🧾 <b>Invoice for ' + money(a, 'en') + ' ' + c + '</b>' + (memo ? '\n"' + esc(memo) + '"' : '') +
      '\n\nSend the link below to your customer, or open it yourself and show the QR code.\nThe link is valid for ' + hours + ' h. I\'ll message you as soon as it\'s paid.',
    btnOpen: 'Open payment page',
    btnShare: 'Send to customer',
    btnCheck: 'Check payment',
    btnGetApp: '📲 Get NoN Wallet',
    btnApp: '📲 Open NoN Wallet',
    shareText: (a, c, memo) => 'Payment ' + money(a, 'en') + ' ' + c + (memo ? ' — ' + memo : ''),
    paid: (a, c, memo, got, tx, late) => '✅ <b>Paid: ' + money(a, 'en') + ' ' + c + '</b>' + (memo ? '\n"' + esc(memo) + '"' : '') +
      '\n\n' + (got ? '<b>' + money(got, 'en') + ' ' + c + '</b> arrived in your wallet (after the fee).' : 'The money is already in your wallet (after the 1% fee).') +
      (late ? '\nPaid after the link expired — but the money arrived.' : '') +
      (tx ? '\n<a href="https://bscscan.com/tx/' + tx + '">Transaction on BscScan</a>' : '') +
      '\n\nBalance, payment history and refunds — in NoN Wallet.',
    warnUnder: (a, c, got, memo) => '⚠️ <b>Paid less than the invoice</b>' + (memo ? ' "' + esc(memo) + '"' : '') + '\nInvoice: ' + money(a, 'en') + ' ' + c + ', paid: ' + money(got, 'en') + '.\nThe money is in your wallet; settle the difference with the customer.',
    warnCur: (a, c, got, cur, memo) => '⚠️ <b>Paid in a different coin</b>' + (memo ? ' "' + esc(memo) + '"' : '') + '\nInvoice: ' + money(a, 'en') + ' ' + c + ', received: ' + money(got, 'en') + ' ' + esc(cur) + '.\nThe money is in your wallet.',
    stPending: 'Not paid yet. I\'ll message you as soon as it is.',
    stPaid: 'Paid ✅',
    stExpired: 'The link expired, no payment.',
    stUnder: 'Partially paid.',
    stCur: 'Paid in a different coin.',
    stRefunded: 'Refunded to the customer.',
    stNotFound: 'Invoice not found.',
    stNet: 'The network isn\'t answering, try again in a minute.',
    listEmpty: 'No invoices yet. Send an amount and I\'ll send a payment link.',
    listHead: '🧾 <b>Recent invoices</b>',
    lPaid: 'paid', lPending: 'waiting', lExpired: 'expired', lUnder: 'underpaid', lCur: 'wrong coin', lRefunded: 'refunded',
    nameAsk: 'Send the name on one line after the command, e.g.:\n<code>/name Corner Coffee</code>\n\nCustomers see it on the payment page. To remove: <code>/name -</code>',
    nameSaved: n => n ? '✅ Name saved: <b>' + esc(n) + '</b>' : '✅ Name removed.',
    nameBad: 'The name must be one line, up to 48 characters.',
    help: '<b>How it works</b>\n\n' +
      '• Send an amount — <b>25</b>, <b>12.5</b> or <b>12.5 USDC coffee</b> — and I\'ll send a payment link. USDT by default.\n' +
      '• Forward the link to your customer or show the QR code from the payment page.\n' +
      '• When it\'s paid, I\'ll message you. The money is already in your wallet, 1% fee.\n\n' +
      '• In any chat with a customer: <code>@{bot} 25 coffee</code> — they get a "Pay" button.\n\n' +
      '/list — recent invoices\n/stats — how much was paid\n/ref — partner program: 20% of our fee\n/wallet — wallet for payments\n/name — name on the payment page\n\n' +
      '📲 <b>NoN Wallet</b> — our wallet: balance, payment history, refunds, a QR checkout. Free: wallet.tavarov.com or the Android app at tavarov.com',
    groups: 'I only work in private chats — message me directly.',
    other: 'Send an amount, like <b>25</b>, and I\'ll send a payment link. Tip: /help',
    off: 'The bot can\'t create an invoice right now. Please try again later.',
    askName: '🏷 <b>How should we sign you on the payment page?</b>\nE.g. "Corner Coffee" or "Anna, nails". This way the customer knows who they are paying.\n\nSend it on one line or tap "Skip".',
    btnSkip: 'Skip',
    skipped: 'OK, no name. Add one later: /name\n\nNow send an amount — like <b>25</b>.',
    ready: 'All set! Now just send an amount — like <b>25</b> or <b>12.5 coffee</b>.',
    btnAgain: '🔁 Same invoice again',
    qrCaption: 'Show this QR code to the customer — they scan it with the camera or a wallet.',
    statsHead: '📊 <b>Payments</b>',
    statsLine: (label, n, sums) => label + ': ' + (n ? '<b>' + n + '</b> — ' + sums : 'none'),
    statsToday: 'Today', statsWeek: 'Last 7 days', statsMonth: 'Last 30 days',
    statsWaiting: n => n ? '\n⏳ Waiting for payment: ' + n : '',
    statsNote: '\n\nCounts the last 50 invoices. All payments are in NoN Wallet.',
    inlineTitle: (a, c, memo) => 'Invoice for ' + money(a, 'en') + ' ' + c + (memo ? ' — ' + memo : ''),
    inlineDesc: 'Tap — an invoice with a "Pay" button goes to this chat',
    inlineMsg: (a, c, memo, name) => '🧾 <b>Invoice for ' + money(a, 'en') + ' ' + c + '</b>' + (memo ? '\n"' + esc(memo) + '"' : '') + (name ? '\nFrom: ' + esc(name) : '') +
      '\n\nPay in USDT/USDC from any wallet — MetaMask, Trust Wallet, NoN Wallet. The link is valid for 24 h.',
    btnPay: (a, c) => '💳 Pay ' + money(a, 'en') + ' ' + c,
    inlineNoWallet: 'First connect your wallet in the bot',
    inlineHelp: 'Type an amount: @{bot} 25 coffee',
    goBad: 'This payment link is damaged. Ask the seller to send the invoice again.',
    goNoWallet: 'The seller has not connected a wallet yet. Ask them to send the invoice again.',
    refInvite: by => '🤝 You were invited by partner <code>' + esc(by) + '</code>.\n\nConfirm them — for a year they will get a fifth of <b>our</b> fee on your sales. You lose nothing: your revenue and your customers\' prices stay the same. This can only be done before your first sale.',
    btnRefBind: '🤝 Confirm partner',
    refCabinet: (n, earned, page, tg) => '🤝 <b>Partner program</b>\n\nBring a seller, a streamer or a shop — and for <b>a year</b> you get <b>20% of our fee</b> on each of their sales. Automatically, straight to your wallet, in the same transaction as the payment.\n\nYou brought: <b>' + n + '</b>\nEarned: <b>' + earned + '</b>\n\nYour Telegram link:\n' + tg + '\n\nFor a website or social media (works with any wallet):\n' + page,
    btnRefShare: '📤 Share link',
    btnRefAbout: 'How it works',
    refShareText: 'Get paid in USDT and USDC — straight to your wallet, 1% fee',
    inlineTip: '💬 <b>Invoice right in a chat with your customer:</b> in any chat type <code>@{bot} 25 coffee</code> and pick "Invoice for 25 USDT" — the customer gets a "Pay" button.'
  }
};

export const txt = lang => T[lang] || T.en;

/* ---------- уведомления, которые шлёт таймер ---------- */

/* Счёт оплачен. rec — запись счёта API v1 с полем tg (номер чата). */
export async function notifyPaid(env, rec){
  const L = txt(rec.tl || 'ru');
  const p = rec.pay || {};
  const text = L.paid(rec.a, rec.c, rec.i, p.got || null, p.tx || null, !!p.late);
  const r = await tgCall(env, 'sendMessage', { chat_id: rec.tg, text, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: appButtons(L, 'open') });
  /* 403 — человек заблокировал бота: повторять бессмысленно, считаем доставленным. */
  if (!r.ok && r.code === 403) return { ok: true, code: 403 };
  return { ok: r.ok, code: r.code };
}

/* Недоплата или не та монета — предупредить один раз. */
export async function notifyProblem(env, rec){
  const L = txt(rec.tl || 'ru');
  const p = rec.pay || {};
  const text = rec.st === 'underpaid' ? L.warnUnder(rec.a, rec.c, p.amount || '0', rec.i)
             : L.warnCur(rec.a, rec.c, p.amount || '0', p.cur || '?', rec.i);
  const r = await tgCall(env, 'sendMessage', { chat_id: rec.tg, text, parse_mode: 'HTML', disable_web_page_preview: true });
  return r.ok || r.code === 403;
}
