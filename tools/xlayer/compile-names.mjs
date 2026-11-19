#!/usr/bin/env node
/* OPTIONAL. Build TavarovNamesV3 creation bytecode for deploy-xlayer.mjs
   (XLAYER_NAMES_BYTECODE). Needs the network once, to fetch the compiler:

     cd tools/xlayer && npm install --no-save solc@0.8.34 && node compile-names.mjs

   Settings are the ones the BNB Chain contract was verified with (README):
   solc 0.8.34+commit.80d5c536, optimizer OFF, EVM cancun. The source file is
   token/TavarovNamesV3.sol, unchanged. Output: tools/xlayer/names-v3.bin.

   This was NOT run while preparing the X Layer branch (no network there).
   Before relying on it, compare: the runtime part of the output must equal
   the code of 0xd6E8A78634bE366bDbD041227D1E94F5b374338e on BNB Chain
   (constructor values aside). If it does not, do not deploy it.

   Think twice before deploying names on X Layer at all: a second names
   contract is a second namespace, where "support" or "tavarov" are free for
   anyone until the reserved list is copied over. The apps resolve names on
   BNB Chain for every network today, X Layer included. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HERE, REPO } from './lib.mjs';

const require = createRequire(path.join(HERE, 'package.json'));
let solc;
try{ solc = require('solc'); } catch(e){ console.error('Install the compiler first: npm install --no-save solc@0.8.34'); process.exit(1); }
const ver = solc.version();
if (!ver.startsWith('0.8.34+commit.80d5c536')){ console.error('Wrong compiler ' + ver + ', need 0.8.34+commit.80d5c536'); process.exit(1); }

const src = fs.readFileSync(path.join(REPO, 'token/TavarovNamesV3.sol'), 'utf8');
const input = { language: 'Solidity', sources: { 'TavarovNamesV3.sol': { content: src } },
  settings: { optimizer: { enabled: false, runs: 200 }, evmVersion: 'cancun',
              outputSelection: { '*': { '*': ['evm.bytecode.object', 'evm.deployedBytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === 'error');
if (errs.length){ errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
const c = out.contracts['TavarovNamesV3.sol'].TavarovNamesV3;
fs.writeFileSync(path.join(HERE, 'names-v3.bin'), '0x' + c.evm.bytecode.object + '\n');
fs.writeFileSync(path.join(HERE, 'names-v3.runtime.bin'), '0x' + c.evm.deployedBytecode.object + '\n');
console.log('Wrote names-v3.bin (' + c.evm.bytecode.object.length / 2 + ' bytes) and names-v3.runtime.bin with ' + ver);
console.log('Compare names-v3.runtime.bin with the BNB Chain code before deploying (see the comment at the top).');
