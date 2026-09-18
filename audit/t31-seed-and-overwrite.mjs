/* Затирание кошелька: предупредить прямо и словами.

   Живой случай, и самый дорогой из всех, что были. Человек завёл второй
   кошелёк — и первый молча лёг под него. В приложении живёт РОВНО ОДИН
   кошелёк: создать новый или восстановить из копии значит затереть текущий.
   Приложение об этом не говорило, и человек узнавал постфактум, когда на
   экране был уже чужой адрес.

   Показывать фразу из двенадцати слов решено не здесь: кошелёк сохраняют
   резервной копией, а вход и опасные действия закрыты кодом подтверждения.
   Но сама фраза обязана лежать ВНУТРИ зашифрованной копии — иначе копия
   восстанавливает не кошелёк, а его половину, и человек остаётся привязан
   к нашему приложению навсегда. Это здесь и проверяется, вместе с самим
   предупреждением о затирании.

   Отдельно проверяется порядок вопросов: страшный вопрос задаётся только
   тогда, когда затирать действительно есть что, и только над годным вводом.
   Вопрос над каждой опечаткой люди перестают читать через неделю. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const asked = [];
page.on('dialog', d => { asked.push({ type: d.type(), text: d.message() }); d.accept().catch(()=>{}); });

// ---------- фраза жива и уезжает в копию ----------
const mnemonic = await page.evaluate(() => wallet.mnemonic);
R.ok('фраза вообще есть в кошельке', typeof mnemonic === 'string' && mnemonic.split(/\s+/).length === 12,
  String(mnemonic).split(/\s+/).length + ' слов');

const inVault = await page.evaluate(async () => {
  const str = localStorage.getItem(VAULT_KEY);
  const payload = await decryptVault(str, 'testpassword1');
  return { has: typeof payload.mnemonic === 'string',
           same: payload.mnemonic === wallet.mnemonic };
});
R.ok('ФРАЗА ЛЕЖИТ ВНУТРИ РЕЗЕРВНОЙ КОПИИ, А НЕ ТОЛЬКО В ПАМЯТИ',
  inVault.has && inVault.same, JSON.stringify(inVault));

/* Показа фразы в приложении нет — и не должно быть ни кнопки, ни шторки,
   ни забытой функции, которую можно позвать из консоли. */
await page.evaluate(() => { tab = 'settings'; renderWalletState(); });
await page.waitForTimeout(400);
R.ok('показа фразы в настройках нет',
  await page.evaluate(() => !document.querySelector('button[onclick="askSeed()"]')
                         && !document.getElementById('seedModal')
                         && typeof window.askSeed === 'undefined'));

// ---------- затирание: спрашивают прямо ----------
const guarded = async (fn) => {
  asked.length = 0;
  await page.evaluate(f => { window[f](); }, fn).catch(()=>{});
  await page.waitForTimeout(900);
  return asked.map(d => d.text).join(' | ');
};

let warn = await guarded('beginGenerate');
R.ok('ПЕРЕД СОЗДАНИЕМ НОВОГО КОШЕЛЬКА ПРЕДУПРЕЖДАЮТ О ЗАТИРАНИИ',
  /только ОДИН кошелёк/.test(warn) && /затёрт/.test(warn), warn.slice(0, 90));
R.ok('и сказано, чем можно будет вернуть',
  /двенадцати слов|резервной копией/.test(warn), warn.slice(0, 120));
R.ok('и предложено остановиться, если ничего этого нет',
  /остановитесь/.test(warn), warn.slice(0, 140));

/* Восстановление из фразы. Порядок здесь важен: сперва приложение смотрит,
   что ему дали, и только на годной фразе спрашивает про затирание. */
await page.evaluate(() => {
  flowStage = 'setup'; renderWalletState();
  document.getElementById('importSeedBlock').classList.remove('hidden');
  document.getElementById('importSeedInput').value = 'слишком короткая фраза';
});
warn = await guarded('doImport');
R.ok('НАД ОПЕЧАТКОЙ СТРАШНЫЙ ВОПРОС НЕ ЗАДАЮТ', warn === '', warn.slice(0, 70));
R.ok('а про короткую фразу сказано на экране',
  /\b12\b|двенадцат/i.test(await page.evaluate(() =>
    document.getElementById('importError').textContent)),
  (await page.evaluate(() => document.getElementById('importError').textContent)).slice(0, 70));

await page.evaluate(m => { document.getElementById('importSeedInput').value = m; }, mnemonic);
warn = await guarded('doImport');
R.ok('перед восстановлением из годной фразы — предупреждают',
  /только ОДИН кошелёк/.test(warn), warn.slice(0, 60));

/* А когда кошелька в телефоне ещё нет, затирать нечего — и спрашивать не о
   чем. Лишний вопрос на пустом месте люди перестают читать. */
const clean = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });
const asked2 = [];
clean.page.on('dialog', d => { asked2.push(d.message()); d.accept().catch(()=>{}); });
await clean.page.evaluate(() => { chooseRole('buyer'); beginGenerate(); });
await clean.page.waitForTimeout(1200);
R.ok('НА ПУСТОМ ТЕЛЕФОНЕ ЛИШНЕГО ВОПРОСА НЕТ', asked2.length === 0, asked2.join(' | ').slice(0, 70));
R.ok('и фраза при этом показана как обычно',
  await clean.page.evaluate(() => document.querySelectorAll('#mnemonicGrid .mnemonic-word').length) === 12);

const bad = [...errors, ...clean.errors]
  .filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(bad);
await browser.close(); await clean.browser.close(); srv.close();
process.exit(good ? 0 : 1);
