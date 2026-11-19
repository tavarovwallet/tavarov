#!/usr/bin/env node
/* Tavarov Pay on X Layer: deploy the SAME contracts that run on BNB Chain,
   Ethereum and Base (TavarovPay v3, its MerchantVault v2 template and
   TavarovCharges). Not one byte of contract code changes.

   USAGE (on your own computer, Node 18 or newer, nothing to install):

     node tools/xlayer/deploy-xlayer.mjs keystore          make a NEW deployer wallet, saved encrypted
     XLAYER_NET=testnet node tools/xlayer/deploy-xlayer.mjs plan     dry run: checks + simulation, sends nothing
     XLAYER_NET=testnet node tools/xlayer/deploy-xlayer.mjs deploy   the real thing, asks "yes" first
     XLAYER_NET=testnet node tools/xlayer/deploy-xlayer.mjs verify   re-check what is deployed

   ENVIRONMENT
     XLAYER_NET             testnet | mainnet                         (required)
     XLAYER_KEYSTORE        encrypted key file      (default ~/.tavarov/xlayer-deployer.json)
     XLAYER_KEYSTORE_PASSWORD  if unset, asked in the terminal (not echoed)
     XLAYER_RPC             your own node instead of the official ones
     XLAYER_TOKENS          override the coins, e.g. "USDC=0x…,USDT=0x…" (testnet faucet coins)
     XLAYER_REWARD_TOKEN    the constructor's reward-token slot      (default: the network's USDC)
     XLAYER_NEW_OWNER       hand the payment contract to this address at the end;
                            "bnb" = the BNB Chain owner 0x1840…7891  (default: keep the deployer)
     XLAYER_NAMES_BYTECODE  optional: file with TavarovNamesV3 creation bytecode (see README)
     XLAYER_STATE           where progress is kept       (default tools/xlayer/state-<chainId>.json)
     XLAYER_YES=1           do not ask "yes" (for scripts)
     XLAYER_FROM            plan only: the deployer address, when there is no keystore yet

   WHAT IS DIFFERENT FROM BNB CHAIN: only settings at deploy time, exactly as on
   Ethereum and Base. No TVR bonuses: every coin's rate is 0. The constructor's
   "reward token" slot holds this network's USDC, so coins sent to the
   contract by mistake can be returned (withdrawUnallocated). The fee is 1%
   to the same treasury wallet as everywhere.

   SAFETY: the private key exists only in memory, unlocked from the keystore
   for the "deploy" command. Every transaction is simulated with eth_call
   before it is signed. Progress is saved after each step, so running
   "deploy" again continues where it stopped instead of deploying twice. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E, HERE, CHAINS, TREASURY, OWNER_BNB, HALVING, VESTING, FEE_BPS, S, W, A, loadBuild, client, isWallet,
         sameCode, fmt, feeFields, keystorePath, keystoreAddress, unlock, askHidden, askLine } from './lib.mjs';

const GAS = { vault: 600000n, pay: 3000000n, token: 80000n, charges: 600000n, owner: 60000n, names: 5000000n };

export function config(env = process.env){
  const net = env.XLAYER_NET;
  if (!CHAINS[net]) throw new Error('Set XLAYER_NET=testnet or XLAYER_NET=mainnet');
  const base = CHAINS[net];
  let tokens = Object.assign({}, base.tokens);
  if (env.XLAYER_TOKENS){
    tokens = {};
    for (const part of env.XLAYER_TOKENS.split(',')){
      const [sym, a] = part.split('=').map(s => s.trim());
      if (!/^[A-Z0-9]{2,8}$/.test(sym || '') || !/^0x[0-9a-fA-F]{40}$/.test(a || '')) throw new Error('XLAYER_TOKENS: bad entry "' + part + '"');
      tokens[sym] = E.utils.getAddress(a.toLowerCase());
    }
  }
  if (!Object.keys(tokens).length) throw new Error('No coins to accept');
  const reward = env.XLAYER_REWARD_TOKEN || tokens.USDC || Object.values(tokens)[0];
  let newOwner = env.XLAYER_NEW_OWNER || null;
  if (newOwner === 'bnb') newOwner = OWNER_BNB;
  if (newOwner && !/^0x[0-9a-fA-F]{40}$/.test(newOwner)) throw new Error('XLAYER_NEW_OWNER is not an address');
  if (newOwner && /[A-F]/.test(newOwner) && /[a-f]/.test(newOwner)) E.utils.getAddress(newOwner);   // mixed case: checksum must hold
  return {
    net, chainId: base.chainId, name: base.name, sym: base.sym, explorer: base.explorer,
    rpcs: env.XLAYER_RPC ? [env.XLAYER_RPC] : base.rpcs,
    tokens, reward, newOwner: newOwner ? newOwner.toLowerCase() : null,
    namesFile: env.XLAYER_NAMES_BYTECODE || null,
    stateFile: env.XLAYER_STATE || path.join(HERE, 'state-' + base.chainId + '.json'),
    keystore: keystorePath(env), yes: env.XLAYER_YES === '1',
    from: env.XLAYER_FROM && /^0x[0-9a-fA-F]{40}$/.test(env.XLAYER_FROM) ? env.XLAYER_FROM : null
  };
}

const loadState = f => { try{ return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e){ return {}; } };
const saveState = (f, st) => fs.writeFileSync(f, JSON.stringify(st, null, 2) + '\n');

function namesCreation(cfg){
  if (!cfg.namesFile) return null;
  let hex = fs.readFileSync(cfg.namesFile, 'utf8').trim();
  if (hex.startsWith('{')){ const j = JSON.parse(hex); hex = j.bytecode && (j.bytecode.object || j.bytecode) || j.bin; }
  hex = String(hex).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 200) throw new Error(cfg.namesFile + ' does not hold creation bytecode');
  /* constructor(address v2Address, address treasury): no older names
     contract on X Layer, so v2 is the zero address (the contract allows it). */
  return '0x' + hex + A('0x0000000000000000000000000000000000000000') + A(TREASURY);
}

/* ---------- checks before anything is sent ---------- */
async function preflight(cfg, c, from, log){
  const problems = [];
  const chain = parseInt(await c.rpc('eth_chainId'), 16);
  if (chain !== cfg.chainId) throw new Error('The node is on chain ' + chain + ', not ' + cfg.name + ' (' + cfg.chainId + '). Nothing done.');
  log('network      ' + cfg.name + ' (' + chain + ') via ' + cfg.rpcs[0]);
  log('deployer     ' + from);
  const tCode = await c.code(TREASURY);
  if (!isWallet(tCode)) problems.push('there is a contract at the treasury address ' + TREASURY + ' on this network');
  log('treasury     ' + TREASURY + ' (1% fee)');
  for (const [sym, a] of Object.entries(cfg.tokens)){
    const code = await c.code(a);
    if (!code || code === '0x'){ problems.push('no contract for ' + sym + ' at ' + a); continue; }
    const d = await c.num(a, S.decimals).catch(() => -1n);
    if (d !== 6n) problems.push(sym + ' at ' + a + ' answers ' + d + ' decimals instead of 6');
    log('coin         ' + sym.padEnd(5) + a + '  (6 decimals, no bonus)');
  }
  if (!cfg.tokens[Object.keys(cfg.tokens).find(k => cfg.tokens[k].toLowerCase() === cfg.reward.toLowerCase())])
    log('reward slot  ' + cfg.reward + ' (not one of the coins above; rates stay 0 either way)');
  else log('reward slot  ' + cfg.reward + ' (rates are 0: no bonuses)');
  if (cfg.newOwner) log('owner after  ' + cfg.newOwner + (cfg.newOwner === OWNER_BNB.toLowerCase() ? ' (the BNB Chain owner)' : ''));
  else log('owner        the deployer ' + from + (from.toLowerCase() === OWNER_BNB.toLowerCase() ? ' (the BNB Chain owner)' : ' (not the BNB Chain owner ' + OWNER_BNB + ')'));
  return problems;
}

/* Simulate the creation of a contract: eth_call without "to" runs the
   constructor and returns the code that would be stored. */
async function simulateCreate(c, from, data, b, label){
  let out;
  try{ out = await c.rpc('eth_call', [{ from, data }, 'latest']); }
  catch(e){ throw new Error(label + ': the network refuses to run the constructor: ' + e.message); }
  if (b && !sameCode(out, b)) throw new Error(label + ': the simulated code is not the code we built');
  if (!b && (!out || out === '0x')) throw new Error(label + ': the simulated constructor produced no code');
  return out;
}

export async function plan(cfg, opts = {}){
  const log = opts.log || console.log;
  const B = opts.build || loadBuild();
  const c = client(cfg.rpcs, opts);
  const from = opts.from || cfg.from || keystoreAddress(cfg.keystore);
  const problems = await preflight(cfg, c, from, log);
  const st = loadState(cfg.stateFile);
  /* What would be created, in this order. The vault address is not known
     before it exists; the pay simulation uses a placeholder with code
     (the constructor only checks that it is non-zero). */
  await simulateCreate(c, from, '0x' + B.MerchantVaultV2.bytecode, B.MerchantVaultV2, 'MerchantVaultV2');
  const vaultGuess = st.vault || E.utils.getContractAddress({ from, nonce: Number(BigInt(await c.rpc('eth_getTransactionCount', [from, 'pending']))) });
  await simulateCreate(c, from, payCreation(B, cfg, vaultGuess), B.TavarovPayV3, 'TavarovPayV3');
  await simulateCreate(c, from, '0x' + B.TavarovCharges.bytecode, B.TavarovCharges, 'TavarovCharges');
  const names = namesCreation(cfg);
  if (names) await simulateCreate(c, from, names, null, 'TavarovNamesV3');
  log('simulation   vault, pay' + ', charges' + (names ? ', names' : '') + ': constructors run, code matches the BNB Chain build');

  const gp = BigInt(await c.rpc('eth_gasPrice'));
  const gasAll = GAS.vault + GAS.pay + GAS.charges + GAS.token * BigInt(Object.keys(cfg.tokens).length)
               + (cfg.newOwner ? GAS.owner : 0n) + (names ? GAS.names : 0n);
  const bal = BigInt(await c.rpc('eth_getBalance', [from, 'latest']));
  const need = gp * gasAll * 3n / 2n;
  log('gas price    ' + (Number(gp) / 1e9).toFixed(4) + ' gwei');
  log('cost         about ' + fmt(gp * gasAll) + ' ' + cfg.sym + ' (keep ' + fmt(need) + ' to be safe)');
  log('balance      ' + fmt(bal) + ' ' + cfg.sym);
  if (bal < need) problems.push('not enough ' + cfg.sym + ' for gas: have ' + fmt(bal) + ', need ' + fmt(need));
  const steps = ['MerchantVaultV2', 'TavarovPayV3', ...Object.keys(cfg.tokens).map(s => 'configureToken ' + s + ' (accept, rate 0)'), 'TavarovCharges']
    .concat(names ? ['TavarovNamesV3'] : []).concat(cfg.newOwner ? ['transferOwnership → ' + cfg.newOwner] : []);
  log('transactions ' + steps.length + ': ' + steps.join(' · '));
  if (Object.keys(st).length) log('state file   ' + cfg.stateFile + ' already has: ' + Object.keys(st).filter(k => !k.startsWith('done_')).join(', '));
  if (problems.length){ problems.forEach(p => log('PROBLEM      ' + p)); }
  else log('OK           nothing was sent. Run the same command with "deploy" to do it.');
  return { ok: !problems.length, problems, steps };
}

function payCreation(B, cfg, vault){
  return '0x' + B.TavarovPayV3.bytecode + A(cfg.reward) + A(TREASURY) + W(HALVING) + W(VESTING) + A(vault);
}

export async function deploy(cfg, opts = {}){
  const log = opts.log || console.log;
  const B = opts.build || loadBuild();
  const c = client(cfg.rpcs, opts);
  const wallet = opts.wallet || await unlock(cfg.keystore);
  const from = wallet.address;
  const problems = await preflight(cfg, c, from, log);
  if (problems.length){ problems.forEach(p => log('PROBLEM      ' + p)); throw new Error('Preflight failed, nothing sent.'); }
  if (!cfg.yes && !opts.yes){
    const a = await askLine('Deploy on ' + cfg.name + ' (' + cfg.chainId + ') from ' + from + '? Type "yes": ');
    if (a !== 'yes') throw new Error('Not confirmed, nothing sent.');
  }
  const st = loadState(cfg.stateFile);
  st.chainId = cfg.chainId; st.deployer = from;
  const save = () => saveState(cfg.stateFile, st);

  async function send(to, data, gasCap, label){
    const tx = { from, data, chainId: cfg.chainId };
    if (to) tx.to = to;
    try{ await c.rpc('eth_call', [Object.assign({}, tx, { chainId: undefined }), 'latest']); }
    catch(e){ throw new Error(label + ': simulation says it would fail: ' + e.message); }
    let gas = gasCap;
    try{ gas = BigInt(await c.rpc('eth_estimateGas', [{ from, to: to || undefined, data }])) * 12n / 10n; } catch(e){}
    const nonce = Number(BigInt(await c.rpc('eth_getTransactionCount', [from, 'pending'])));
    const fees = await feeFields(c);
    const signed = await wallet.signTransaction(Object.assign({ to: to || undefined, data, nonce, gasLimit: gas, chainId: cfg.chainId, value: 0 }, fees));
    const hash = await c.rpc('eth_sendRawTransaction', [signed]);
    log('  sent       ' + label + '  ' + hash);
    for (let i = 0; i < 240; i++){
      const r = await c.rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (r && r.blockNumber){
        if (BigInt(r.status) !== 1n) throw new Error(label + ': the network rejected ' + hash);
        return r;
      }
      await new Promise(res => setTimeout(res, opts.pollMs || 1500));
    }
    throw new Error(label + ': not confirmed in 6 minutes: ' + hash + '. Check the explorer, then run deploy again.');
  }
  const hasCode = async a => { const x = await c.code(a); return !!x && x !== '0x'; };

  if (!(st.vault && await hasCode(st.vault))){
    const r = await send(null, '0x' + B.MerchantVaultV2.bytecode, GAS.vault, 'MerchantVaultV2');
    st.vault = E.utils.getAddress(r.contractAddress); save();
  }
  log('vault        ' + st.vault);
  if (!(st.pay && await hasCode(st.pay))){
    const r = await send(null, payCreation(B, cfg, st.vault), GAS.pay, 'TavarovPayV3');
    st.pay = E.utils.getAddress(r.contractAddress); save();
  }
  log('pay          ' + st.pay);
  /* A node can answer a call before it has caught up with the block that
     created the contract; ask again for a few seconds before giving up. */
  let ver = 0;
  for (let i = 0; i < 8; i++){
    try { ver = Number(await c.num(st.pay, S.VERSION)); } catch(e){ ver = 0; }
    if (ver === 3) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (ver !== 3) throw new Error('The contract at ' + st.pay + ' is not version 3. Stopped.');
  for (const [sym, a] of Object.entries(cfg.tokens)){
    const acc = (await c.num(st.pay, S.acceptedToken + A(a))) !== 0n;
    const rate = await c.num(st.pay, S.rewardPerUnit + A(a));
    if (!acc || rate !== 0n) await send(st.pay, S.configureToken + A(a) + W(1) + W(0), GAS.token, 'configureToken ' + sym);
    st['token_' + sym] = a; save();
  }
  if (!(st.charges && await hasCode(st.charges))){
    const r = await send(null, '0x' + B.TavarovCharges.bytecode, GAS.charges, 'TavarovCharges');
    st.charges = E.utils.getAddress(r.contractAddress); save();
  }
  log('charges      ' + st.charges);
  const names = namesCreation(cfg);
  if (names && !(st.names && await hasCode(st.names))){
    const r = await send(null, names, GAS.names, 'TavarovNamesV3');
    st.names = E.utils.getAddress(r.contractAddress); save();
  }
  if (cfg.newOwner && (await c.addr(st.pay, S.owner)) !== cfg.newOwner){
    if ((await c.addr(st.pay, S.owner)) !== from.toLowerCase()) throw new Error('The payment contract is owned by someone else already. Stopped.');
    await send(st.pay, S.transferOwnership + A(cfg.newOwner), GAS.owner, 'transferOwnership');
  }
  const res = await verify(cfg, Object.assign({}, opts, { state: st, build: B, owner: cfg.newOwner || from }));
  st.finished = res.ok; save();
  return { state: st, verify: res };
}

export async function verify(cfg, opts = {}){
  const log = opts.log || console.log;
  const B = opts.build || loadBuild();
  const c = client(cfg.rpcs, opts);
  const st = opts.state || loadState(cfg.stateFile);
  if (!st.pay) throw new Error('Nothing deployed yet (no pay address in ' + cfg.stateFile + ')');
  const owner = String(opts.owner || cfg.newOwner || st.deployer).toLowerCase();
  const P = st.pay, problems = [];
  if (!sameCode(await c.code(P), B.TavarovPayV3)) problems.push('payment contract code differs from the build');
  if (!sameCode(await c.code(st.vault), B.MerchantVaultV2)) problems.push('vault template code differs');
  if (st.charges && !sameCode(await c.code(st.charges), B.TavarovCharges)) problems.push('charges code differs');
  if ((await c.addr(P, S.owner)) !== owner) problems.push('owner is not ' + owner);
  if ((await c.addr(P, S.treasury)) !== TREASURY.toLowerCase()) problems.push('treasury is not ' + TREASURY);
  if (Number(await c.num(P, S.feeBps)) !== FEE_BPS) problems.push('fee is not 1%');
  if (Number(await c.num(P, S.REF_SHARE_BPS)) !== 2000) problems.push('partner share is not 20%');
  if ((await c.addr(P, S.vaultImplementation)) !== String(st.vault).toLowerCase()) problems.push('vault template is not ours');
  if ((await c.addr(P, S.rewardToken)) !== cfg.reward.toLowerCase()) problems.push('reward slot is not ' + cfg.reward);
  for (const [sym, a] of Object.entries(cfg.tokens)){
    if ((await c.num(P, S.acceptedToken + A(a))) === 0n) problems.push(sym + ' is not accepted');
    if ((await c.num(P, S.rewardPerUnit + A(a))) !== 0n) problems.push(sym + ' has a bonus rate');
  }
  if (st.charges && Number(await c.num(st.charges, S.MAX_TTL)) !== 3600) problems.push('charges: not our contract');
  if (problems.length){ problems.forEach(p => log('PROBLEM      ' + p)); return { ok: false, problems }; }
  log('');
  log('==== TAVAROV PAY: ' + cfg.name.toUpperCase() + ' ====');
  log('chain:    ' + cfg.chainId);
  log('pay:      ' + P);
  log('vault:    ' + st.vault);
  if (st.charges) log('charges:  ' + st.charges);
  if (st.names) log('names:    ' + st.names);
  log('owner:    ' + owner);
  log('coins:    ' + Object.entries(cfg.tokens).map(([s, a]) => s + ' ' + a).join(', '));
  log(cfg.explorer + '/address/' + P);
  log('Code matches the BNB Chain build byte for byte (constructor values aside); fee 1%, treasury, no bonuses.');
  return { ok: true, problems: [] };
}

async function makeKeystore(env = process.env){
  const file = keystorePath(env);
  if (fs.existsSync(file)) throw new Error(file + ' already exists. Move it away first; it may hold a wallet with money.');
  const w = E.Wallet.createRandom();
  const pw = env.XLAYER_KEYSTORE_PASSWORD != null ? env.XLAYER_KEYSTORE_PASSWORD : await askHidden('New password for the keystore (12+ characters): ');
  if (pw.length < 12) throw new Error('Password too short.');
  if (env.XLAYER_KEYSTORE_PASSWORD == null && (await askHidden('Repeat it: ')) !== pw) throw new Error('Passwords differ.');
  const json = await w.encrypt(pw);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, json, { mode: 0o600 });
  console.log('New deployer wallet: ' + w.address);
  console.log('Saved encrypted to ' + file + ' (the key is not shown; forget the password = lose the wallet).');
  console.log('Send it a little OKB on X Layer, then run "plan".');
  return w.address;
}

/* ---------- command line ---------- */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)){
  const cmd = process.argv[2] || 'plan';
  (async () => {
    if (cmd === 'keystore') return void await makeKeystore();
    const cfg = config();
    if (cmd === 'plan'){ const r = await plan(cfg); process.exit(r.ok ? 0 : 1); }
    if (cmd === 'deploy'){ const r = await deploy(cfg); process.exit(r.verify.ok ? 0 : 1); }
    if (cmd === 'verify'){ const r = await verify(cfg); process.exit(r.ok ? 0 : 1); }
    throw new Error('Unknown command "' + cmd + '". Use keystore, plan, deploy or verify.');
  })().catch(e => { console.error('STOPPED: ' + (e && e.message || e)); process.exit(1); });
}
