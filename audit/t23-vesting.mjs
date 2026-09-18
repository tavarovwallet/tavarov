/* Созревание бонуса, объяснённое словами.

   Живая история. Человек оплачивал через кассу, бонус в контракте
   начислялся — и всё равно несколько дней подряд звучало «бонусы не
   зачисляются». Приложение показывало «Можно забрать сейчас: 0.0000 TVR» и
   молчало о том, что начисленное переходит в доступное долями, день за днём,
   девяносто дней. Ноль на экране без объяснения означает для человека ровно
   одно: его обманули. И он совершенно прав так думать.

   Здесь проверяется, что приложение больше не молчит: называет срок, берёт
   его у самого контракта, показывает начисленное целиком и отдельно говорит
   про самый частый случай — начисление есть, забрать пока нечего. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 50, TVR: 0 };

const open = async () => {
  await page.evaluate(() => refreshVault(true));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { tab = 'cashback'; renderWalletState(); renderCashback(); });
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    big:      document.getElementById('cbBig').textContent,
    pending:  document.getElementById('cbPendingLine').textContent,
    total:    document.getElementById('cbTotalLine').textContent,
    vest:     document.getElementById('cbVestText').textContent,
    perDay:   document.getElementById('cbPerDay').textContent,
    totalKv:  document.getElementById('cbTotal').textContent,
    nothing:  document.getElementById('cbNothingYet').textContent,
    nothingShown: !document.getElementById('cbNothingYet').classList.contains('hidden'),
    claimDisabled: document.getElementById('cbClaimBtn').disabled,
    days:     vaultState ? vaultState.vestingDays : null
  }));
};

// ---------- начислено, но ещё не созрело ----------
state.bonus = { pending: 9, claimable: 0 };
let v = await open();
R.ok('срок созревания взят У КОНТРАКТА, а не выдуман', v.days === 90, String(v.days));
R.ok('СРОК НАЗВАН ЧЕЛОВЕКУ ПРЯМО', /90 дней/.test(v.vest), v.vest.slice(0, 90));
R.ok('и сказано, что это правило контракта, а не наше решение',
  /не может никто, включая нас/.test(v.vest), v.vest.slice(-70));
R.ok('видно, сколько начислено всего, а не только доступное',
  /9\.00/.test(v.total) && /9\.00/.test(v.totalKv), v.total + ' | ' + v.totalKv);
R.ok('видно, сколько созревает за сутки', /0\.10/.test(v.perDay), v.perDay);
R.ok('ПУСТАЯ КНОПКА ОБЪЯСНЕНА, А НЕ ОСТАВЛЕНА ЗАГАДКОЙ',
  v.nothingShown && /бонус начислен, но ещё не созрел/.test(v.nothing), v.nothing.slice(0, 70));
R.ok('забрать при этом нечего — кнопка заперта', v.claimDisabled);

// ---------- часть созрела ----------
state.bonus = { pending: 6, claimable: 3 };
v = await open();
R.ok('доступное показано отдельно от начисленного', /3\.00/.test(v.big), v.big);
R.ok('несозревшее показано отдельно', /6\.00/.test(v.pending), v.pending);
R.ok('ВСЕГО — ЭТО СУММА ТОГО И ДРУГОГО, А НЕ ОДНО ИЗ НИХ',
  /9\.00/.test(v.totalKv), v.totalKv);
R.ok('кнопка отперта, когда есть что забрать', !v.claimDisabled);
R.ok('и лишней тревожной строки уже нет', !v.nothingShown, v.nothing);

// ---------- бонусов нет вовсе ----------
state.bonus = { pending: 0, claimable: 0 };
v = await open();
R.ok('без бонусов не пугаем строкой про несозревшее', !v.nothingShown, v.nothing);
R.ok('и всё равно объясняем правило заранее', /90 дней/.test(v.vest), v.vest.slice(0, 60));

// ---------- другой срок в контракте — другой текст ----------
state.vestingSeconds = 30 * 86400;
state.bonus = { pending: 3, claimable: 0 };
v = await open();
R.ok('СРОК НЕ ЗАШИТ ЧИСЛОМ: ДРУГОЙ КОНТРАКТ — ДРУГОЙ ТЕКСТ',
  /30 дней/.test(v.vest) && !/90 дней/.test(v.vest), v.vest.slice(0, 80));
R.ok('и суточная доля пересчитана по новому сроку', /0\.10/.test(v.perDay), v.perDay);
state.vestingSeconds = 90 * 86400;

// ---------- сеть молчит: не врём числом ----------
await page.evaluate(() => { TESTNET.bnb.rpc = 'http://localhost:8599'; TESTNET.bnb.rpcs = ['http://localhost:8599']; });
await page.evaluate(() => { vaultState = null; tab = 'cashback'; renderCashback(); });
await page.waitForTimeout(600);
const off = await page.evaluate(() => ({
  vest: document.getElementById('cbVestText').textContent,
  perDay: document.getElementById('cbPerDay').textContent
}));
R.ok('БЕЗ ОТВЕТА СЕТИ СРОК НЕ ВЫДУМЫВАЕТСЯ',
  !/90|30/.test(off.vest) && /Точный срок задан в контракте/.test(off.vest), off.vest.slice(0, 80));
R.ok('и вместо числа стоит прочерк, а не ноль', off.perDay === '—', off.perDay);

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|8599|ECONNREFUSED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
