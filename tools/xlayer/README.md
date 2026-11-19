# X Layer tools

Everything here runs on your own computer with Node 18+ and nothing to
install. The key stays in an encrypted keystore (`~/.tavarov/xlayer-deployer.json`);
no script prints it or sends it anywhere. Every command that sends
transactions first simulates each one and asks you to type `yes`.

| Script | What it does | Network |
|---|---|---|
| `deploy-xlayer.mjs keystore` | makes a new deployer wallet, saved encrypted | – |
| `deploy-xlayer.mjs plan / deploy / verify` | TavarovPay v3 + MerchantVault v2 + TavarovCharges, the same bytes as BNB Chain, Ethereum and Base (read from `site/vypusk-seti.html`) | testnet 1952, mainnet 196 |
| `tapeout/tapeout-xlayer.mjs plan / run / check` | our own TapeOut processor, 18 NAND transistors, the checker's payment rule taped out as circuit #1, then all 128 inputs checked on chain | mainnet 196 |
| `tapeout/deweb-xlayer.mjs plan / run` | optional: the till's static files into the rule circuit's DeWEB container, name `1.2.<CPU>.tape` | mainnet 196 |
| `compile-names.mjs` | optional: TavarovNamesV3 bytecode (needs `npm install solc@0.8.34` once); see the warning in the file before deploying names on X Layer | – |

Tests: `audit/t105-xlayer-deploy.mjs`, `audit/t108-xlayer-tapeout.mjs`
(fake X Layer node, `audit/xlayermock.mjs`).

## Turning X Layer on (after the deploy)

Nothing changes on the live sites until these lines are filled in. All of
them are inert while empty.

1. `www/pay.html`: `const XLAYER_PAY = null;` → the `pay:` address from `deploy-xlayer.mjs`.
2. `functions/api/status.js`: `xlayer: { … pay: null …` → the same address.
3. `pay-app/www/app.js` (branch `xlayer-till`): `const XLAYER_PAY = null;` → the same address.
4. `site/check-core.js`: `const XLAYER_ON = false;` → `true` to check X Layer payments;
   `const RULE_CIRCUIT = null;` → the line `tapeout-xlayer.mjs` prints, to cross-check
   every verdict against the taped-out rule. Then mention X Layer in the
   texts of `site/en/check.html` (networks list, FAQ, "Reading … networks").
5. Run `audit/t106`, `t107`, `t109` and the old `t53`, `t83`, `t100`, `t102`, `t103`.
