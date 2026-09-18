/* Понятные слова об отказе сети.

   Это разбор живой поломки. Продавец нажимал «Подключить приём оплаты» и
   получал «сеть отклонила операцию, обычно это значит, что условие внутри
   контракта не выполнено». Он два дня искал поломку в контракте — а контракт
   был исправен: библиотека кладёт в e.reason общую фразу «cannot estimate
   gas», и под ней прячутся совсем разные беды, от нехватки монеты на
   комиссию до отказа контракта по своему условию. Приложение читало только
   это одно поле и потому всем говорило одно и то же.

   Здесь проверяется, что теперь оно смотрит внутрь и называет причину. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

const say = (err) => page.evaluate(e => shortErr(e), err);

/* Ровно тот вид ошибки, который отдаёт ethers, когда на кошельке нет монеты
   сети: снаружи «cannot estimate gas», внутри настоящая причина. */
const noGas = {
  reason: 'cannot estimate gas; transaction may fail or may require manual gas limit',
  code: 'UNPREDICTABLE_GAS_LIMIT',
  error: { code: -32000, message: 'insufficient funds for gas * price + value' }
};
const outNoGas = await say(noGas);
R.ok('НЕХВАТКА МОНЕТЫ НА КОМИССИЮ НАЗВАНА СВОИМ ИМЕНЕМ',
  /не хватает/.test(outNoGas) && /комиссию сети/.test(outNoGas), outNoGas);
R.ok('и про «условие внутри контракта» здесь не говорится',
  !/условие внутри контракта/.test(outNoGas), outNoGas);

/* Так выглядит настоящий отказ контракта. */
const already = {
  reason: 'cannot estimate gas; transaction may fail or may require manual gas limit',
  code: 'UNPREDICTABLE_GAS_LIMIT',
  error: { code: 3, message: 'execution reverted: Pay: vault already exists' }
};
const outAlready = await say(already);
R.ok('ПРИЁМНИК УЖЕ СОЗДАН — так и сказано',
  /уже создан/.test(outAlready), outAlready);

const notAccepted = {
  reason: 'cannot estimate gas',
  error: { error: { message: 'execution reverted: Pay: token not accepted' } }
};
R.ok('непринимаемая валюта названа', /не принимается кассой/.test(await say(notAccepted)),
  await say(notAccepted));

const usedInvoice = {
  error: { data: { message: 'execution reverted: Pay: invoice already used' } }
};
R.ok('повторный счёт назван', /уже платили/.test(await say(usedInvoice)), await say(usedInvoice));

R.ok('отказ человека — не ошибка',
  /отменена/.test(await say({ code: 'ACTION_REJECTED', message: 'user rejected transaction' })));

R.ok('сеть не ответила — сказано про сеть',
  !/условие внутри контракта/.test(await say({ message: 'could not detect network' })),
  await say({ message: 'could not detect network' }));

/* Общая фраза остаётся ровно там, где причины действительно не видно. */
const blind = { reason: 'cannot estimate gas; transaction may fail or may require manual gas limit' };
R.ok('когда причины не видно — прежняя честная фраза',
  /условие внутри контракта/.test(await say(blind)), await say(blind));

R.ok('пустая ошибка не роняет разбор', (await say(null)).length > 0, await say(null));

// ---------- валюта, которую касса не принимает ----------
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 10, TVR: 0 };
state.vaults[me.toLowerCase()] = '0x6666666666666666666666666666666666666666';

await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
await page.evaluate(() => refreshVault(true));
await page.waitForTimeout(1500);

/* Подделываем ответ контракта: USDT принимается, USDC — нет. Ровно так и
   было в основной сети до того, как USDC разрешили.

   Баллы TVR для этого случая не годятся: у них теперь своя подпись «без
   комиссии», потому что мимо кассы они идут намеренно. Нужна именно чужая
   валюта, которую касса не берёт, — добавляем её в список на время проверки. */
await page.evaluate(() => {
  TESTNET.bnb.tokens.USDC = { contract:'0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals:18 };
  acceptedTok[network + '|USDT'] = { accepted:true,  rewards:true  };
  acceptedTok[network + '|USDC'] = { accepted:false, rewards:false };
  acceptedTok[network + '|TVR']  = { accepted:true,  rewards:false };
  renderWalletState();
});
await page.waitForTimeout(400);

const opts = await page.evaluate(() =>
  [...document.getElementById('kassaCurrency').options].map(o => o.value + ':' + o.textContent));
R.ok('в кассе видно, какая валюта пойдёт мимо кассы',
  opts.some(o => /USDC:.*мимо кассы/.test(o)), opts.join(' | '));
R.ok('у принимаемой валюты пометки нет',
  opts.some(o => o === 'USDT:USDT'), opts.join(' | '));

/* И главное: молча такой счёт не выставляется. */
const dialogs = [];
page.on('dialog', async d => { dialogs.push({ type: d.type(), msg: d.message() }); await d.dismiss(); });
await page.evaluate(() => { document.getElementById('kassaCurrency').value = 'USDC'; });
await page.fill('#kassaAmount', '1');
await page.evaluate(() => createTicket());
await page.waitForTimeout(1200);
R.ok('О СЧЁТЕ МИМО КАССЫ ПРЕДУПРЕЖДАЮТ ЗАРАНЕЕ',
  dialogs.length > 0 && dialogs[0].type === 'confirm' && /без бонусов TVR/.test(dialogs[0].msg),
  dialogs[0] ? dialogs[0].msg.slice(0, 70) : 'ничего не спросили');
R.ok('и отказ означает, что счёт не выставлен',
  await page.evaluate(() => document.getElementById('kassaTicket').classList.contains('hidden')));

// ---------- оплата баллами: проходит через кассу, но бонусов не даёт ----------
await page.evaluate(() => {
  acceptedTok[network + '|TVR'] = { accepted:true, rewards:false };
  try{ localStorage.removeItem('tavarov.tvrwarn.v1'); }catch(e){}
  renderWalletState();
});
await page.waitForTimeout(400);
const opts2 = await page.evaluate(() =>
  [...document.getElementById('kassaCurrency').options].map(o => o.value + ':' + o.textContent));
R.ok('принимаемая валюта без бонусов помечена именно так, а не «мимо кассы»',
  opts2.some(o => /TVR:.*без бонусов/.test(o)) && !opts2.some(o => /TVR:.*мимо кассы/.test(o)),
  opts2.join(' | '));

dialogs.length = 0;
await page.evaluate(() => { document.getElementById('kassaCurrency').value = 'TVR'; });
await page.fill('#kassaAmount', '5');
await page.evaluate(() => createTicket());
await page.waitForTimeout(1200);
R.ok('ПЕРЕД СЧЁТОМ В БАЛЛАХ ГОВОРЯТ ПРАВДУ ПРО БАЛЛЫ',
  dialogs.length > 0 && /ни биржи, ни курса/.test(dialogs[0].msg),
  dialogs[0] ? dialogs[0].msg.slice(0, 60) : 'ничего не спросили');
R.ok('сказано, что больше половины выпуска у одного человека',
  dialogs.length > 0 && /одном кошельке/.test(dialogs[0].msg));
R.ok('сказано, что бонусов за оплату баллами не будет',
  dialogs.length > 0 && /печатать баллы за баллы/.test(dialogs[0].msg));

// ---------- баллы: без комиссии, и это не пугалка, а условие ----------
await page.evaluate(() => {
  acceptedTok[network + '|TVR'] = { accepted:false, rewards:false };   // как в основной сети
  renderWalletState();
});
await page.waitForTimeout(400);
const opts3 = await page.evaluate(() =>
  [...document.getElementById('kassaCurrency').options].map(o => o.value + ':' + o.textContent));
R.ok('БАЛЛЫ В КАССЕ ПОДПИСАНЫ «БЕЗ КОМИССИИ», А НЕ «МИМО КАССЫ»',
  opts3.some(o => /TVR:.*без комиссии/.test(o)) && !opts3.some(o => /TVR:.*мимо кассы/.test(o)),
  opts3.join(' | '));

dialogs.length = 0;
await page.evaluate(() => { try{ localStorage.setItem('tavarov.tvrwarn.v1','1'); }catch(e){} });
await page.evaluate(() => { document.getElementById('kassaCurrency').value = 'TVR'; });
await page.fill('#kassaAmount', '7');
await page.evaluate(() => createTicket());
await page.waitForTimeout(2500);
R.ok('второй раз про баллы уже не спрашивают', dialogs.length === 0,
  dialogs[0] ? dialogs[0].msg.slice(0, 50) : '');
R.ok('на счёте написано, что комиссии нет',
  await page.isVisible('#ticketTvrHint'));
const tvrNote = await page.evaluate(() => document.getElementById('ticketTvrHint').textContent);
R.ok('и честно сказано, что вернуть кнопкой нельзя',
  /вернуть его кнопкой нельзя/.test(tvrNote), tvrNote.slice(0, 60));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
