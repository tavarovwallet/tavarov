/* «Оплачен ли счёт?» — на сайте кошелька, а не на отдельном шлюзе.

   ПОЧЕМУ ЗДЕСЬ. Шлюз жил отдельным сайтом на Netlify и не был выложен ни
   разу: у Netlify кончились кредиты, а без выложенного шлюза ссылка на
   оплату не работает нигде, кроме компьютера продавца. Ссылка, которую
   нельзя послать покупателю, — это не ссылка.

   Поэтому страницы счёта переехали на сайт кошелька, а этот файл — их
   единственная серверная часть. Cloudflare Pages подхватывает папку
   functions сам: файл functions/api/status.js становится адресом
   /api/status. Ничего настраивать не нужно, выкладывается тем же скриптом.

   Ключей и денег здесь нет и быть не может: мы только читаем цепочку.

   ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА. «Оплачено» говорится только тогда, когда
   сошлось ВСЁ: тот счёт, тот продавец, та валюта и сумма не меньше
   выставленной. Раньше сверялись только номер счёта и продавец — а номер
   счёта известен всякому, кому прислали ссылку на оплату. Значит, любой,
   кто её видел, мог заплатить одну копейку по тому же номеру, и страница
   сказала бы магазину «оплачено». */

const PAID_TOPIC =
  '0x5862fc5c885dd22d0d12c28144427d16ae076a4ce245f7525c310fcc15d08861';

/* Валюты нужны здесь не для красоты: без адреса и точности нечем сверить
   сумму. Числа те же, что в кошельке (поддельный доллар в тестовой сети —
   шестизначный, настоящий на BNB Chain — восемнадцатизначный). */
const NETS = {
  bnb:        { rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
                pay: '0xCa4FE6e5dF7159910b2165Acfa9BB8b19810D65c',
                tokens: { USDT: { a:'0x55d398326f99059fF775485246999027B3197955', d:18 },
                          USDC: { a:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', d:18 },
                          TVR:  { a:'0x8Baa77344Fc122967902651D0C3193cdF4c48503', d:18 } } },
  bnbTestnet: { rpcs: ['https://bsc-testnet-rpc.publicnode.com'],
                pay: '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6',
                tokens: { USDT: { a:'0xb4ac75E8CF7c768FFd9fAfeAF1bF77B48209524e', d:6  },
                          TVR:  { a:'0x74536e79b374CCFa0123035B28f7a3b7333f323a', d:18 } } }
};

/* Отступ от вершины цепочки. Сказать магазину «оплачено» про операцию из
   самого свежего блока — значит однажды отдать товар за платёж, который
   отменила перестройка цепочки. Двенадцать блоков в BNB Chain это около
   шести секунд — цена, которую стоит заплатить.

   Запас по блокам нужен только для поиска номера операции в журнале.
   Сам ответ «оплачено» берётся не из журнала, а из памяти контракта:
   у неё нет глубины, и счёт суточной давности находится так же, как
   минутный. */
const LOOKBACK = 3000;
const CONFIRMATIONS = 12;

/* saleOf(bytes32) — покупка, записанная под номером счёта. */
const SALE_OF_SELECTOR = '0x38d56afe';

const hex = n => '0x' + Math.max(0, n).toString(16);
const pad = a => '0x' + '0'.repeat(24) + a.toLowerCase().replace(/^0x/, '');
const word = (data, n) => '0x' + data.replace(/^0x/, '').slice(n * 64, (n + 1) * 64);
const addrAt = (data, n) => '0x' + word(data, n).slice(-40);
const json = (o, code) => new Response(JSON.stringify(o), {
  status: code || 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

/* Сумма из ссылки — это «12.5», а в цепочке лежит целое число мельчайших
   долей. Переводим строкой, без чисел с плавающей точкой: 0.1 + 0.2 в них
   не равно 0.3, а речь о деньгах. */
function toUnits(amount, decimals){
  const s = String(amount).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    /* Долей меньше, чем знаков в сумме: лишнее отбрасывать нельзя — сумма
       окажется меньше выставленной, и честный платёж посчитается неполным.
       Такого счёта просто не бывает, но сказать об этом честнее, чем
       округлить. */
    if (/[1-9]/.test(frac.slice(decimals))) return null;
  }
  return BigInt(whole + frac.padEnd(decimals, '0').slice(0, decimals));
}

/* Спрашиваем по очереди у всех известных узлов: отказ одного не должен
   превращаться в «не оплачено» для человека, который только что заплатил. */
async function rpc(urls, method, params){
  let last = null;
  for (const url of urls){
    try{
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      if (!r.ok){ last = 'узел ответил ' + r.status; continue; }
      const d = await r.json();
      if (d.error){ last = d.error.message || 'ошибка узла'; continue; }
      if (d.result !== undefined && d.result !== null) return d.result;
    } catch(e){ last = String(e && e.message || e); }
  }
  throw new Error(last || 'узлы не ответили');
}

/* Transfer(address,address,uint256) — обычный перевод монеты. */
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/* Сколько блоков назад смотреть в поисках прямого перевода. В BNB Chain
   блок раз в ~0.75 секунды, так что 4000 блоков — это около часа. Больше
   просить нельзя: узлы отказываются отдавать журнал за широкий промежуток,
   и вместо ответа мы получили бы ошибку. Час для кассы достаточно: счёт
   там живёт минуты, а не сутки. */
const TRANSFER_LOOKBACK = 4000;
const BLOCK_SECONDS = 0.75;

/* Ищем перевод той же монеты на того же продавца. Возвращаем ответ целиком
   или null, если ничего подходящего нет. */
async function findDirectTransfer(cfg, merchant, want, since, safeBlock){
  /* Раньше, чем выставлен счёт, платежа по нему быть не могло. Если время
     выставления не передали (старая ссылка) — смотрим весь промежуток. */
  let from = Math.max(0, safeBlock - TRANSFER_LOOKBACK);
  if (since > 0){
    const ago = Math.floor(Date.now() / 1000) - since;
    if (ago >= 0){
      const blocks = Math.ceil(ago / BLOCK_SECONDS) + 20;   // запас на разброс времени блоков
      from = Math.max(from, safeBlock - Math.min(blocks, TRANSFER_LOOKBACK));
    }
  }

  let logs;
  try{
    logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
      address: want.token, fromBlock: hex(from), toBlock: hex(safeBlock),
      topics: [TRANSFER_TOPIC, null, pad(merchant)]
    }]);
  } catch(e){ return null; }        // журнал не отдали — молчим, а не врём

  const candidates = [];
  for (const l of (logs || [])){
    let value;
    try{ value = BigInt(word(l.data, 0)); } catch(e){ continue; }
    if (value < want.units) continue;               // недоплата — не платёж
    candidates.push({ tx: l.transactionHash, block: parseInt(l.blockNumber, 16),
                      payer: ('0x' + l.topics[1].slice(-40)).toLowerCase(), value });
  }
  candidates.sort((a, b) => b.block - a.block);     // сначала самые свежие

  /* Отсеиваем платежи, сделанные ЧЕРЕЗ наш контракт. Казалось бы, их видно
     по отправителю — но нет: контракт переводит деньги не от себя, а от
     покупателя, и в журнале монеты отправителем стоит кошелёк покупателя,
     ровно как при обычном переводе. Проверено на живом платеже 17 сентября:
     0.198 продавцу и 0.002 в казну — оба перевода «от покупателя».

     Отличить можно только по самой операции: у контрактного платежа в ней
     есть записи нашего контракта оплаты. Если они есть — этот перевод уже
     принадлежит какому-то счёту, и закрывать им соседний нельзя. */
  const ourPay = (cfg.pay || '').toLowerCase();
  for (const c of candidates.slice(0, 3)){
    let viaContract = false;
    try{
      const rec = await rpc(cfg.rpcs, 'eth_getTransactionReceipt', [c.tx]);
      viaContract = !!(rec && (rec.logs || []).some(
        l => (l.address || '').toLowerCase() === ourPay));
    } catch(e){
      /* Не смогли спросить — молчим. Сказать «оплачено», не проверив,
         значит однажды отдать товар за чужой платёж. */
      continue;
    }
    if (viaContract) continue;
    return { paid: true, tx: c.tx, block: c.block, payer: c.payer,
             token: want.token, amount: c.value.toString(), fee: '0',
             source: 'transfer', direct: true };
  }
  return null;
}

/* Подмена узла и адреса контракта — только для проверки на своей машине.
   В Cloudflare этих переменных нет, и тогда берутся настоящие значения.
   Без такой возможности проверить этот файл целиком нельзя: настоящую сеть
   из проверочной машины не достать, а непроверенный код тут стоит денег. */
function netConfig(net, env){
  const base = NETS[net];
  const e = env || {};
  return {
    rpcs: e.TAVAROV_RPC ? [e.TAVAROV_RPC] : base.rpcs,
    pay:  e.TAVAROV_PAY || base.pay,
    tokens: base.tokens
  };
}

export async function onRequestGet({ request, env }){
  const url = new URL(request.url);
  const h = (url.searchParams.get('h') || '').toLowerCase();
  const m = url.searchParams.get('m') || '';
  const net = url.searchParams.get('net') === 'bnbTestnet' ? 'bnbTestnet' : 'bnb';
  const wantAmount = url.searchParams.get('a') || '';
  const wantCur = (url.searchParams.get('c') || '').toUpperCase();

  if (!/^0x[0-9a-f]{64}$/.test(h))    return json({ error: 'плохой номер счёта' }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(m)) return json({ error: 'плохой адрес продавца' }, 400);

  const cfg = netConfig(net, env);
  if (!cfg.pay) return json({ error: 'контракт оплаты не настроен', paid: false }, 503);

  /* Чем и сколько должны были заплатить. Без этого сверять нечего, и
     говорить «оплачено» мы не имеем права: см. правило вверху файла. */
  let want = null;
  if (wantAmount || wantCur){
    const tk = cfg.tokens[wantCur];
    if (!tk) return json({ paid: false, unknown: true,
      error: 'валюта ' + (wantCur || '—') + ' в этой сети неизвестна, сверить сумму нечем' });
    const units = toUnits(wantAmount, tk.d);
    if (units === null || units <= 0n) return json({ error: 'плохая сумма счёта' }, 400);
    want = { token: tk.a.toLowerCase(), units };
  }

  try{
    const latest = parseInt(await rpc(cfg.rpcs, 'eth_blockNumber', []), 16);
    const safe = Math.max(0, latest - CONFIRMATIONS);

    /* Память контракта на глубине, где перестройка цепочки уже не достанет.
       Здесь лежит всё нужное: кому платили, сколько до комиссии, чем и
       сколько уже вернули. */
    let sale = null;
    try{
      const raw = await rpc(cfg.rpcs, 'eth_call',
        [{ to: cfg.pay, data: SALE_OF_SELECTOR + h.slice(2) }, hex(safe)]);
      if (raw && raw.length >= 2 + 64 * 7){
        sale = { merchant: addrAt(raw, 0), amount: BigInt(word(raw, 1)),
                 buyer: addrAt(raw, 2), refunded: BigInt(word(raw, 3)),
                 token: addrAt(raw, 4) };
      }
    } catch(e){ sale = null; }      // старый контракт такого не умеет

    /* Счёта в памяти контракта нет — значит через контракт не платили. Но
       могли заплатить прямым переводом по второму коду, который читает сам
       кошелёк. Ищем такой перевод, прежде чем сказать «не оплачено». */
    const noSale = !sale || sale.merchant === '0x' + '0'.repeat(40)
                         || sale.merchant.toLowerCase() !== m.toLowerCase();
    if (noSale && want){
      const since = parseInt(url.searchParams.get('s') || '0', 10);
      const direct = await findDirectTransfer(cfg, m, want, since, safe);
      if (direct) return json(direct);
    }

    if (sale){
      if (sale.merchant === '0x' + '0'.repeat(40)) return json({ paid: false });
      /* Чужой счёт с тем же номером — не наш платёж. */
      if (sale.merchant.toLowerCase() !== m.toLowerCase()) return json({ paid: false });
      if (want){
        if (sale.token.toLowerCase() !== want.token)
          return json({ paid: false, wrongToken: true, token: sale.token,
            error: 'заплатили не той валютой' });
        if (sale.amount < want.units)
          return json({ paid: false, underpaid: true,
            amount: sale.amount.toString(), expected: want.units.toString(),
            error: 'заплатили меньше, чем выставлено' });
      }
      /* Деньги вернули — товар отдавать не за что. */
      if (want && sale.refunded > 0n && sale.amount - sale.refunded < want.units)
        return json({ paid: false, refunded: sale.refunded.toString(),
          error: 'платёж возвращён покупателю' });

      /* Номер операции для журнала: ищем в недавних блоках. Не нашли —
         не беда, на ответ «оплачено» это не влияет. */
      let tx = null, block = null;
      try{
        const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
          address: cfg.pay, fromBlock: hex(Math.max(0, safe - LOOKBACK)), toBlock: hex(safe),
          topics: [PAID_TOPIC, pad(m)]
        }]);
        for (const l of (logs || [])){
          if (word(l.data, 3).toLowerCase() !== h) continue;
          tx = l.transactionHash; block = parseInt(l.blockNumber, 16); break;
        }
      } catch(e){ /* журнал не обязателен */ }

      return json({ paid: true, tx, block, payer: sale.buyer, token: sale.token,
        amount: sale.amount.toString(), refunded: sale.refunded.toString(), source: 'sale' });
    }

    /* Запасной путь: контракт первой версии покупок не запоминает, и
       остаётся журнал. Он видит только недавние блоки — значит суточный
       счёт по нему не найдётся, и это честно сказано в ответе. */
    const to = safe;
    const from = Math.max(0, to - LOOKBACK);
    const logs = await rpc(cfg.rpcs, 'eth_getLogs', [{
      address: cfg.pay, fromBlock: hex(from), toBlock: hex(to), topics: [PAID_TOPIC, pad(m)]
    }]);

    for (const l of (logs || [])){
      if (word(l.data, 3).toLowerCase() !== h) continue;
      const toMerchant = BigInt(word(l.data, 0));
      const fee = BigInt(word(l.data, 1));
      const token = '0x' + l.topics[3].slice(-40);
      if (want){
        if (token.toLowerCase() !== want.token)
          return json({ paid: false, wrongToken: true, token, error: 'заплатили не той валютой' });
        if (toMerchant + fee < want.units)
          return json({ paid: false, underpaid: true,
            amount: (toMerchant + fee).toString(), expected: want.units.toString(),
            error: 'заплатили меньше, чем выставлено' });
      }
      return json({
        paid: true,
        tx: l.transactionHash,
        block: parseInt(l.blockNumber, 16),
        payer: '0x' + l.topics[2].slice(-40),
        token,
        amount: (toMerchant + fee).toString(),
        fee: fee.toString(),
        source: 'logs'
      });
    }
    /* ПРЯМОЙ ПЕРЕВОД С ЧУЖОГО КОШЕЛЬКА.

       Счёт можно показать вторым кодом — тем, который понимает не браузер,
       а сам кошелёк: Trust, MetaMask, Binance. Покупатель наводит камеру и
       сразу видит готовый перевод, без нашей страницы. Платёж при этом идёт
       мимо контракта: комиссии нет, баллов нет, и в памяти контракта такой
       счёт не появится — значит всё, что выше, его не найдёт.

       Поэтому ищем его руками в журнале самой монеты: перевод той же
       валюты, на того же продавца, не меньше выставленной суммы и не
       раньше, чем счёт был выставлен.

       ЧЕГО ЭТА ПРОВЕРКА НЕ УМЕЕТ, и это надо знать. В переводе нет номера
       счёта — в нём вообще нет места для наших пометок. Значит, если у
       одного продавца висят два счёта на одну и ту же сумму, один перевод
       закроет оба. Для кассы, где счёт живёт минуты, это редкость; для
       двух одинаковых счётов подряд — нет. Сказать честно: ответ помечен
       source:"transfer", и страница пишет продавцу, что платёж пришёл
       прямым переводом, а не через контракт.

       Своих же платежей тут быть не должно: когда покупатель платит через
       контракт, монета тоже уезжает продавцу, но отправителем будет наш
       контракт оплаты. Такие переводы пропускаем — иначе платёж по одному
       счёту закрыл бы соседний.

       Сама проверка живёт выше: она выполняется сразу, как только стало
       понятно, что в памяти контракта этого счёта нет. */
    return json({ paid: false, shallow: true });
  } catch(e){
    /* Молчание узла — это НЕ «не оплачено». Сказать так человеку, который
       только что заплатил, значит отправить его платить второй раз. */
    return json({ error: String(e && e.message || e), paid: false, unknown: true }, 502);
  }
}
