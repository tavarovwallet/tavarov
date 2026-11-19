/* t105: the X Layer deploy tool (tools/xlayer/deploy-xlayer.mjs), against a
   fake X Layer node (xlayermock.mjs). No network, no real key: the test makes
   a throwaway wallet of its own.

   What must hold, because a mistake here costs real money or a broken
   contract on a public chain:
     - the bytes deployed are exactly the BNB Chain build from site/vypusk-seti.html,
       and the constructor gets USDC, the treasury, the BNB numbers, our vault;
     - "plan" sends nothing; problems (wrong chain, wrong decimals, a contract at
       the treasury, too little OKB) stop it;
     - "deploy" sends vault, pay, one configureToken per coin (accept, rate 0),
       charges — signed for chain 196 — then checks everything back;
     - a second run sends nothing, an interrupted run continues and never deploys twice;
     - handing ownership to the BNB Chain owner works and is checked;
     - the key is never printed.

   Run: cd audit && node t105-xlayer-deploy.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reporter } from './boot.mjs';
import { makeNode, mockFetch, E } from './xlayermock.mjs';
import { config, plan, deploy, verify } from '../tools/xlayer/deploy-xlayer.mjs';
import { S, loadBuild, TREASURY, OWNER_BNB, HALVING, VESTING, CHAINS, keystoreAddress, unlock } from '../tools/xlayer/lib.mjs';

const R = reporter();
const B = loadBuild();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't105-'));
const USDT0 = CHAINS.mainnet.tokens.USDT.toLowerCase(), USDC = CHAINS.mainnet.tokens.USDC.toLowerCase();

// ---------- the tables ----------
const SIG = { owner: 'owner()', treasury: 'treasury()', feeBps: 'feeBps()', VESTING: 'VESTING()', halvingStep: 'halvingStep()',
  rewardToken: 'rewardToken()', acceptedToken: 'acceptedToken(address)', rewardPerUnit: 'rewardPerUnit(address)',
  configureToken: 'configureToken(address,bool,uint256)', VERSION: 'VERSION()', REF_SHARE_BPS: 'REF_SHARE_BPS()',
  vaultImplementation: 'vaultImplementation()', MAX_TTL: 'MAX_TTL()', decimals: 'decimals()', transferOwnership: 'transferOwnership(address)' };
R.ok('every selector is keccak of its signature', Object.entries(SIG).every(([k, s]) => S[k] === E.utils.id(s).slice(0, 10)),
  Object.entries(SIG).filter(([k, s]) => S[k] !== E.utils.id(s).slice(0, 10)).map(x => x[0]).join(','));
R.ok('bytes come from site/vypusk-seti.html (Pay 12256 bytes, Vault, Charges)', B.TavarovPayV3.bytecode.length === 24512 && B.MerchantVaultV2.bytecode.length === 4908 && B.TavarovCharges.bytecode.length === 4814);
R.ok('mainnet: chain 196, USDT0 0x779D…3736, Circle USDC 0xB6CE…3061', CHAINS.mainnet.chainId === 196 && USDT0 === '0x779ded0c9e1022225f8e0630b35a9b54be713736' && USDC === '0xb6ceceab302e2e4948951ee7843fc24e92933061');
R.ok('testnet: chain 1952, Circle testnet USDC, no USDT0', CHAINS.testnet.chainId === 1952 && Object.keys(CHAINS.testnet.tokens).join() === 'USDC' && CHAINS.testnet.tokens.USDC === '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3');
R.ok('treasury and BNB owner are the repo\'s', TREASURY === '0x73BBCD23735257660A9f6BE57d057dC4A2ABf432' && OWNER_BNB === '0x1840d0883cc5ac1c383d10b4756780d073bc7891');

// ---------- config ----------
let threw = null;
try{ config({}); } catch(e){ threw = e.message; }
R.ok('no XLAYER_NET: refuses', /XLAYER_NET/.test(threw || ''));
const base = { XLAYER_NET: 'mainnet', XLAYER_STATE: path.join(TMP, 'state.json'), HOME: TMP };
let cfg = config(base);
R.ok('mainnet config: two official RPCs, both coins, reward slot = USDC', cfg.rpcs[0] === 'https://rpc.xlayer.tech' && cfg.rpcs.length === 2 && Object.keys(cfg.tokens).join() === 'USDT,USDC' && cfg.reward === CHAINS.mainnet.tokens.USDC);
R.ok('keystore lives in ~/.tavarov by default', cfg.keystore === path.join(TMP, '.tavarov', 'xlayer-deployer.json'));
R.ok('XLAYER_NEW_OWNER=bnb means the BNB Chain owner', config(Object.assign({}, base, { XLAYER_NEW_OWNER: 'bnb' })).newOwner === OWNER_BNB.toLowerCase());
threw = null; try{ config(Object.assign({}, base, { XLAYER_TOKENS: 'USDT=0x123' })); } catch(e){ threw = e.message; }
R.ok('bad XLAYER_TOKENS entry is refused', /bad entry/.test(threw || ''));
threw = null; try{ config(Object.assign({}, base, { XLAYER_NEW_OWNER: '0x1840D0883cc5ac1c383d10b4756780d073bc7891' })); } catch(e){ threw = e.message; }
R.ok('new owner with a broken checksum is refused', !!threw);
const tcfg = config({ XLAYER_NET: 'testnet', XLAYER_TOKENS: 'USDC=0xdec90b78111ba2fc6fc6d84d8b9ec159a2d4b9b3,USDG=0x1111111111111111111111111111111111111111', HOME: TMP });
R.ok('testnet config with faucet coins', tcfg.chainId === 1952 && tcfg.tokens.USDG === '0x1111111111111111111111111111111111111111' && tcfg.rpcs[0].includes('testrpc.xlayer.tech'));

// ---------- keystore: made and opened like the owner will ----------
const wallet = E.Wallet.createRandom();
const ksFile = path.join(TMP, 'ks.json');
fs.writeFileSync(ksFile, await wallet.encrypt('correct horse battery', { scrypt: { N: 1024 } }));
R.ok('address is read from the keystore without the password', keystoreAddress(ksFile) === wallet.address);
const unlocked = await unlock(ksFile, { XLAYER_KEYSTORE_PASSWORD: 'correct horse battery' });
R.ok('keystore opens with the password', unlocked.address === wallet.address);
threw = null; try{ await unlock(ksFile, { XLAYER_KEYSTORE_PASSWORD: 'wrong' }); } catch(e){ threw = e.message; }
R.ok('wrong password: refuses', !!threw);
const ME = wallet.address.toLowerCase();

const world = (over = {}) => makeNode(Object.assign({ chainId: 196, build: B, tokens: { [USDT0]: 6, [USDC]: 6 }, balances: { [ME]: 10n ** 17n } }, over));
const quiet = [];
const log = s => quiet.push(s);
const opts = (n, extra = {}) => Object.assign({ fetch: mockFetch(n), build: B, log, from: wallet.address, wallet: unlocked, yes: true, pollMs: 1 }, extra);

// ---------- plan ----------
let n = world();
cfg = config(Object.assign({}, base, { XLAYER_KEYSTORE: ksFile }));
quiet.length = 0;
let p = await plan(cfg, opts(n));
R.ok('plan: OK, nothing sent', p.ok && n.sent.length === 0 && !n.calls.includes('eth_sendRawTransaction'), p.problems.join('; '));
R.ok('plan: simulates every constructor with eth_call', n.calls.filter(m => m === 'eth_call').length >= 3);
R.ok('plan: 5 transactions listed (vault, pay, USDT, USDC, charges)', p.steps.length === 5, p.steps.join(' | '));
R.ok('plan: shows cost in OKB', quiet.some(s => /cost\s+about .* OKB/.test(s)));
p = await plan(cfg, opts(world({ chainId: 1 }))).catch(e => ({ err: e.message }));
R.ok('plan on a node of another chain: stops', /not X Layer/.test(p.err || ''), p.err);
p = await plan(cfg, opts(world({ tokens: { [USDT0]: 18, [USDC]: 6 } })));
R.ok('plan: a coin with 18 decimals is a problem', !p.ok && p.problems.some(x => /USDT.*18 decimals/.test(x)));
n = world(); n.code[TREASURY.toLowerCase()] = '0x6080dead';
p = await plan(cfg, opts(n));
R.ok('plan: a contract at the treasury address is a problem', !p.ok && p.problems.some(x => /treasury/.test(x)));
n = world(); n.code[TREASURY.toLowerCase()] = '0xef0100' + '11'.repeat(20);
p = await plan(cfg, opts(n));
R.ok('plan: a 7702-delegated treasury wallet is still a wallet', p.ok, p.problems.join('; '));
p = await plan(cfg, opts(world({ balances: { [ME]: 1000n } })));
R.ok('plan: too little OKB is a problem', !p.ok && p.problems.some(x => /not enough OKB/.test(x)));
p = await plan(cfg, opts(world({ tokens: { [USDC]: 6 } })));
R.ok('plan: a coin with no contract on the chain is a problem', !p.ok && p.problems.some(x => /no contract for USDT/.test(x)));

// ---------- deploy ----------
n = world();
quiet.length = 0;
let d = await deploy(cfg, opts(n));
const kinds = n.sent.map(t => t.to ? 'call:' + t.data.slice(0, 10) : 'create');
R.ok('deploy: 5 transactions in order', kinds.join(',') === ['create', 'create', 'call:' + S.configureToken, 'call:' + S.configureToken, 'create'].join(','), kinds.join(','));
R.ok('deploy: every transaction signed for chain 196 by the deployer, EIP-1559', n.sent.every(t => t.chainId === 196 && t.from === ME && t.type === 2 && t.value === 0n));
R.ok('deploy: vault = MerchantVaultV2 bytes exactly', n.sent[0].data === '0x' + B.MerchantVaultV2.bytecode);
const vault = E.utils.getContractAddress({ from: wallet.address, nonce: 0 }).toLowerCase();
const tail = n.sent[1].data.slice(2 + B.TavarovPayV3.bytecode.length);
const [rw, tr, hv, vs, va] = E.utils.defaultAbiCoder.decode(['address', 'address', 'uint256', 'uint256', 'address'], '0x' + tail);
R.ok('deploy: pay = TavarovPayV3 bytes exactly + 5 constructor words', n.sent[1].data.startsWith('0x' + B.TavarovPayV3.bytecode) && tail.length === 5 * 64);
R.ok('deploy: constructor = (USDC, treasury, BNB halving, 90 days, our vault)',
  rw.toLowerCase() === USDC && tr === TREASURY && hv.toString() === HALVING.toString() && vs.toString() === VESTING.toString() && vs.toString() === '7776000' && va.toLowerCase() === vault);
const pay = E.utils.getContractAddress({ from: wallet.address, nonce: 1 }).toLowerCase();
const cfgCalls = n.sent.slice(2, 4).map(t => E.utils.defaultAbiCoder.decode(['address', 'bool', 'uint256'], '0x' + t.data.slice(10)));
R.ok('deploy: configureToken(USDT0, true, 0) and (USDC, true, 0) on the pay contract',
  n.sent[2].to === pay && n.sent[3].to === pay && cfgCalls[0][0].toLowerCase() === USDT0 && cfgCalls[1][0].toLowerCase() === USDC && cfgCalls.every(c => c[1] === true && c[2].isZero()));
R.ok('deploy: charges = TavarovCharges bytes exactly', n.sent[4].data === '0x' + B.TavarovCharges.bytecode);
R.ok('deploy: checked back, all fine', d.verify.ok, (d.verify.problems || []).join('; '));
const st = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
R.ok('state file has pay/vault/charges and "finished"', st.pay.toLowerCase() === pay && st.vault.toLowerCase() === vault && !!st.charges && st.finished === true && st.chainId === 196);
R.ok('summary block printed with the explorer link', quiet.includes('pay:      ' + E.utils.getAddress(pay)) && quiet.some(s => s === 'https://web3.okx.com/explorer/x-layer/address/' + E.utils.getAddress(pay)));
R.ok('the private key never appears in the output', !quiet.join('\n').toLowerCase().includes(wallet.privateKey.slice(2).toLowerCase()) && !fs.readFileSync(cfg.stateFile, 'utf8').toLowerCase().includes(wallet.privateKey.slice(2).toLowerCase()));
const gasOk = n.sent.every(t => t.gasLimit === 360000n);
R.ok('gas limit = node estimate + 20%', gasOk);

const before = n.sent.length;
d = await deploy(cfg, opts(n));
R.ok('second deploy: nothing new sent, still verified', n.sent.length === before && d.verify.ok);
R.ok('verify alone: OK', (await verify(cfg, opts(n))).ok);

// someone changes a coin's rate: verify catches it
n.pays[pay].rate[USDC] = 5n;
R.ok('verify: a bonus rate on a coin is caught', !(await verify(cfg, opts(n))).ok);
n.pays[pay].rate[USDC] = 0n;
n.code[pay] = n.code[pay].slice(0, -2) + 'ff';
R.ok('verify: different code at the pay address is caught', (await verify(cfg, opts(n))).problems.some(x => /code differs/.test(x)));

// ---------- interrupted and resumed ----------
fs.rmSync(cfg.stateFile);
n = world();
n.failNext = null;
const orig = n;
let count = 0;
const flaky = mockFetch(orig);
const breakAfter = 3;  // vault, pay, first configureToken go through; the 4th send fails at the network
const fetchBreak = async (url, init) => {
  const b = JSON.parse(init.body);
  if (b.method === 'eth_sendRawTransaction' && ++count === breakAfter + 1) orig.failNext = 'reject';
  return flaky(url, init);
};
threw = null;
try{ await deploy(cfg, Object.assign(opts(orig), { fetch: fetchBreak })); } catch(e){ threw = e.message; }
R.ok('a transaction the network rejects stops the run with its hash', /configureToken USDC: the network rejected 0x/.test(threw || ''), threw);
const sentBefore = orig.sent.length;
d = await deploy(cfg, opts(orig));
const resumed = orig.sent.slice(sentBefore).map(t => t.to ? 'call' : 'create');
R.ok('rerun continues: one configureToken + charges, no second vault or pay', resumed.join(',') === 'call,create' && d.verify.ok, resumed.join(','));
R.ok('only one payment contract exists', Object.keys(orig.pays).length === 1);

// ---------- hand-over to the BNB Chain owner ----------
fs.rmSync(cfg.stateFile);
n = world();
const cfgOwner = config(Object.assign({}, base, { XLAYER_KEYSTORE: ksFile, XLAYER_NEW_OWNER: 'bnb' }));
d = await deploy(cfgOwner, opts(n));
const last = n.sent[n.sent.length - 1];
R.ok('transferOwnership(BNB owner) is the last transaction', last.data === S.transferOwnership + OWNER_BNB.slice(2).toLowerCase().padStart(64, '0'));
R.ok('verify checks the new owner', d.verify.ok && n.pays[Object.keys(n.pays)[0]].owner === OWNER_BNB.toLowerCase());

// ---------- optional names contract ----------
fs.rmSync(cfg.stateFile);
n = world();
const namesHex = '6080604052' + 'ab'.repeat(200);
n.namesBytecode = namesHex;
fs.writeFileSync(path.join(TMP, 'names.bin'), '0x' + namesHex + '\n');
const cfgNames = config(Object.assign({}, base, { XLAYER_KEYSTORE: ksFile, XLAYER_NAMES_BYTECODE: path.join(TMP, 'names.bin') }));
p = await plan(cfgNames, opts(n));
R.ok('plan with names: 6 transactions', p.ok && p.steps.includes('TavarovNamesV3'), p.steps.join(','));
d = await deploy(cfgNames, opts(n));
const nm = Object.values(n.names)[0];
R.ok('names: constructor (v2 = zero address, treasury)', !!nm && nm.v2 === '0x' + '0'.repeat(40) && nm.treasury === TREASURY.toLowerCase() && !!d.state.names);
fs.writeFileSync(path.join(TMP, 'bad.bin'), 'hello');
threw = null; try{ await plan(config(Object.assign({}, base, { XLAYER_NAMES_BYTECODE: path.join(TMP, 'bad.bin') })), opts(world())); } catch(e){ threw = e.message; }
R.ok('names: a file without bytecode is refused', /does not hold creation bytecode/.test(threw || ''));

// ---------- the command line ----------
import { execFileSync } from 'node:child_process';
let out = '';
try{ execFileSync('node', [path.resolve('../tools/xlayer/deploy-xlayer.mjs'), 'plan'], { env: { PATH: process.env.PATH, HOME: TMP }, stdio: 'pipe' }); }
catch(e){ out = String(e.stderr || '') + String(e.stdout || ''); }
R.ok('CLI without XLAYER_NET: clear message, exit 1', /STOPPED: Set XLAYER_NET/.test(out), out.trim());

fs.rmSync(TMP, { recursive: true, force: true });
process.exit(R.done() ? 0 : 1);
