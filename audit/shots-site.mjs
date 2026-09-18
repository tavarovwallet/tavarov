/* Снимки экрана для витрины — на всех пяти языках.

   Прежние снимки делались в тестовой сети: оранжевая полоса «монеты
   ненастоящие», подписи tBNB. Показывать такое на витрине нельзя — человек
   решит, что приложение игрушечное. Поэтому здесь всё то же приложение
   поднимается в ОСНОВНОЙ сети, а адреса контрактов подменяются на адреса
   поддельного узла: тогда узел отвечает, а приложение считает себя в BNB
   Chain и рисует всё как обычно.

   И снимки делаются на каждом языке отдельно. Английская витрина с русскими
   снимками читается как чужая работа, наспех переведённая.

   Ничего в приложении ради снимков не подкручивается: что на снимке видно,
   то оно и рисует на настоящих числах. */
import { boot } from './boot.mjs';
import { start, state, ADDR } from './mocknode.mjs';
import fs from 'node:fs';

const srv = await start(8555);
/* Можно пересобрать один язык: node shots-site.mjs en. Пересобирать все
   пять ради одной исправленной надписи — двадцать минут впустую. */
const LANGS = process.argv[2] ? [process.argv[2]] : ['ru', 'en', 'es', 'tr', 'pt'];

/* Поддельный узел знает адреса тестовых контрактов — значит основной сети
   надо подсунуть их же. Иначе приложение спрашивает остатки по настоящим
   адресам BSC, узел про них не знает и отвечает нулём. */
const mainnet = async (page) => {
  await page.evaluate(A => {
    Object.assign(CONTRACTS.bnbMainnet, A);
    MAINNET.bnb.tokens.USDT = { contract: A.usdt,  decimals: 6  };
    MAINNET.bnb.tokens.TVR  = { contract: A.token, decimals: 18 };
    delete MAINNET.bnb.tokens.USDC;          // у поддельного узла его нет
  }, ADDR);
};

for (const lang of LANGS){
  const dir = 'shots/сайт/' + lang;
  fs.mkdirSync(dir, { recursive: true });

  // ---------- кошелёк, бонусы и перевод: глазами покупателя ----------
  {
    const { browser, page } = await boot({ role: 'buyer', lang, rpc: 'http://localhost:8555' });
    await mainnet(page);
    const me = await page.evaluate(() => wallet.evm.address);
    state.names['anna'] = me;
    /* Получателю имя тоже нужно: перевод на незанятое имя приложение честно
       помечает предупреждением, и на витрине это выглядит как ошибка. */
    state.names['ivan'] = '0x2222222222222222222222222222222222222222';
    state.balances[me.toLowerCase()] = { native: 0.418, USDT: 1240.5, TVR: 318.42 };
    state.bonus = { pending: 12.4, claimable: 3.16 };

    await page.evaluate(() => { tab = 'wallet'; renderWalletState(); refreshMyName(true); refreshBalances(); });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: dir + '/wallet.png' });

    await page.evaluate(() => { tab = 'cashback'; renderWalletState(); refreshVault(true); });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: dir + '/bonus.png' });

    await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); renderWalletState(); });
    await page.waitForTimeout(600);
    await page.fill('#sendTo', 'ivan');
    await page.fill('#sendAmount', '25');
    await page.waitForTimeout(2200);
    await page.screenshot({ path: dir + '/send.png' });
    await browser.close();
  }

  // ---------- касса: глазами продавца ----------
  {
    const { browser, page } = await boot({ role: 'seller', lang, rpc: 'http://localhost:8555' });
    await mainnet(page);
    const me = await page.evaluate(() => wallet.evm.address);
    state.names['coffee'] = me;
    state.balances[me.toLowerCase()] = { native: 0.21, USDT: 486.2, TVR: 44.9 };

    await page.evaluate(() => { tab = 'pay'; renderWalletState(); refreshMyName(true); });
    await page.waitForTimeout(2000);
    await page.evaluate(() => setPayMode('kassa'));
    await page.waitForTimeout(800);
    await page.fill('#kassaItem', { ru:'Кофе и круассан', en:'Coffee and a croissant',
                                    es:'Café y un cruasán', tr:'Kahve ve kruvasan',
                                    pt:'Café e um croissant' }[lang]);
    await page.fill('#kassaAmount', '18.50');
    await page.evaluate(() => createTicket());
    await page.waitForTimeout(2500);
    await page.screenshot({ path: dir + '/till.png' });
    await browser.close();
  }
  console.log(lang + ' — готово');
}

srv.close();
process.exit(0);
