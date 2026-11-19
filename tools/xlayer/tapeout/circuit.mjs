/* The payment-acceptance rule of the Tavarov USDT checker, as a TapeOut
   circuit (NAND gates) to be taped out on X Layer.

   WHY. The checker at tavarov.com/en/check tells a seller "hand over the
   goods" (green), "do not" (red) or "wait / not a payment" (amber). Until now
   that rule lived only in our JavaScript, which we can change any day. Taped
   out, the rule is a public, immutable circuit on X Layer: anyone can read
   its netlist, run it for free (eval is a view call), and see that the
   checker's verdict is what the published rule says for the facts it found.
   The checker evaluates the circuit for every verdict and refuses to show a
   verdict the circuit disagrees with.

   The facts are read from the blockchain by the checker (two nodes that
   agree); the circuit only decides. Seven facts in, two bits out:

     in 0  mined     the transaction is in a block (not pending)
     in 1  success   it did not fail
     in 2  real      it moves an official USDT/USDC contract's token
     in 3  fake      it moves a token that copies the USDT/USDC name but is not the official contract
     in 4  addr      the seller typed a valid address of their own
     in 5  toSeller  a real transfer goes to that address
     in 6  enough    enough confirmations (TRON: solidified)

     out 0 ACCEPT   (green)   out 1 REJECT (red)   neither: amber.  Never both.

   ACCEPT = mined ∧ success ∧ real ∧ ¬fake ∧ (¬addr ∨ toSeller) ∧ enough
   REJECT = mined ∧ success ∧ (fake ∨ (real ∧ addr ∧ ¬toSeller))

   This is exactly the order of site/check-core.js judge(): a fake token is
   red even next to a real one; real money to another address is red; real
   money without enough confirmations waits.

   Netlist format (TapeOut, as published in TapeOutProtocol/TapeKit and used
   by X Layer projects): one element after another; NAND = 0x00 a:u24 b:u24
   (big-endian), new signal = NOT(a AND b). Signal 0 = constant 0, 1 =
   constant 1, inputs are 2 … 1+nIn, each element appends one signal, the
   last nOut signals are the outputs. Inputs and outputs are packed LSB-first:
   bit i is (byte[i>>3] >> (i&7)) & 1. */

export const N_IN = 7, N_OUT = 2;
export const IN = { mined: 0, success: 1, real: 2, fake: 3, addr: 4, toSeller: 5, enough: 6 };

/* The rule in plain JavaScript, the reference the netlist is tested against. */
export function rule(f){
  const ok = f.mined && f.success;
  const wrongAddr = f.addr && !f.toSeller;
  const accept = !!(ok && f.real && !f.fake && !wrongAddr && f.enough);
  const reject = !!(ok && (f.fake || (f.real && wrongAddr)));
  return { accept, reject };
}

/* Build the netlist. Returns { hex, gates, nIn, nOut }. */
export function build(){
  const els = [];
  let next = 2 + N_IN;                      // first free signal
  const sig = name => 2 + IN[name];
  const nand = (a, b) => { els.push([a, b]); return next++; };
  const not = a => nand(a, a);
  const and = (a, b) => not(nand(a, b));

  const ok    = and(sig('mined'), sig('success'));
  const nTo   = not(sig('toSeller'));
  const addrFine = nand(sig('addr'), nTo);          // ¬(addr ∧ ¬toSeller)
  const wrong = not(addrFine);                      //   addr ∧ ¬toSeller
  const nRealWrong = nand(sig('real'), wrong);      // ¬(real ∧ wrong)
  const nFake = not(sig('fake'));
  const fakeOrRW = nand(nFake, nRealWrong);         // fake ∨ (real ∧ wrong)
  const nReject = nand(ok, fakeOrRW);
  const a1 = and(ok, nFake);
  const a2 = and(a1, sig('real'));
  const a3 = and(a2, addrFine);
  const nAccept = nand(a3, sig('enough'));
  not(nAccept);                                     // output 0: ACCEPT
  not(nReject);                                     // output 1: REJECT

  const u24 = v => v.toString(16).padStart(6, '0');
  const hex = '0x' + els.map(([a, b]) => '00' + u24(a) + u24(b)).join('');
  return { hex, gates: els.length, nIn: N_IN, nOut: N_OUT };
}

/* Run a netlist the way TapeOut's eval() does (NAND only; LATCH and REF are
   not used here and are refused). inputs/outputs: Uint8Array, LSB-first. */
export function evalNetlist(hex, nIn, nOut, inputBytes){
  const b = Buffer.from(String(hex).replace(/^0x/, ''), 'hex');
  const s = [0, 1];
  for (let i = 0; i < nIn; i++) s.push((inputBytes[i >> 3] >> (i & 7)) & 1);
  for (let p = 0; p < b.length;){
    const op = b[p];
    if (op !== 0) throw new Error('only NAND elements are expected, got opcode ' + op);
    const a = b.readUIntBE(p + 1, 3), c = b.readUIntBE(p + 4, 3);
    if (a >= s.length || c >= s.length) throw new Error('NAND: future signal');
    s.push(1 - (s[a] & s[c]));
    p += 7;
  }
  if (s.length - nOut < 2 + nIn) throw new Error('too few signals for outputs');
  const out = new Uint8Array(Math.ceil(nOut / 8));
  for (let i = 0; i < nOut; i++) out[i >> 3] |= s[s.length - nOut + i] << (i & 7);
  return out;
}

export function factsToByte(f){
  let v = 0;
  for (const [k, i] of Object.entries(IN)) if (f[k]) v |= 1 << i;
  return v;
}
export function byteToFacts(v){
  const f = {};
  for (const [k, i] of Object.entries(IN)) f[k] = !!((v >> i) & 1);
  return f;
}
