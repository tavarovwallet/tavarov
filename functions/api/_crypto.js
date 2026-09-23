/* Keccak-256 and "who signed this" — without a single third-party library.

   WHY BY HAND. This file runs inside a Cloudflare Worker. There is no npm
   install there and no build step: what ships is what is written here. Adding
   a dependency for this would mean adding a build step to a project whose
   whole point is that every page is one file you can read.

   WHAT IS NOT DONE BY HAND, deliberately. Recovering an address from a
   signature is elliptic-curve arithmetic, and hand-written curve code is
   exactly the kind of thing that looks right, passes the happy path, and is
   quietly wrong on the one input an attacker will find. So we do not write it.
   Ethereum has had that operation built into every node since the beginning —
   the precompiled contract at address 0x01 — and we simply ask a node to run
   it. The node does the maths; we only prepare the question and check the
   answer.

   That choice has a price, and it is the right one: if no node answers, we
   refuse the write instead of guessing. A till that says "could not check who
   you are, try again" is a nuisance. A till that accepts an unverified amount
   is a way to charge a stranger's customer the wrong price. */

/* ===================== Keccak-256 =====================
   This is the hash Ethereum uses everywhere — not SHA-3, despite the family
   resemblance: the padding differs by one byte, and that byte is the whole
   difference between an address that matches and one that does not. */

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

/* How far each lane turns on the rho step, laid out the way the state is
   indexed: ROT[x + 5*y]. */
const ROT = [
   0n,  1n, 62n, 28n, 27n,
  36n, 44n,  6n, 55n, 20n,
   3n, 10n, 43n, 25n, 39n,
  41n, 45n, 15n, 21n,  8n,
  18n,  2n, 61n, 56n, 14n
];

const M64 = (1n << 64n) - 1n;
const rotl = (v, n) => n === 0n ? v : (((v << n) | (v >> (64n - n))) & M64);

function keccakF(A){
  for (let round = 0; round < 24; round++){
    /* theta */
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x+5] ^ A[x+10] ^ A[x+15] ^ A[x+20];
    for (let x = 0; x < 5; x++){
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x + 5*y] ^= D;
    }
    /* rho and pi together: each lane turns, then moves to its new seat */
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y + 5 * ((2*x + 3*y) % 5)] = rotl(A[x + 5*y], ROT[x + 5*y]);
    /* chi */
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        A[x + 5*y] = B[x + 5*y] ^ ((~B[(x+1)%5 + 5*y] & M64) & B[(x+2)%5 + 5*y]);
    /* iota */
    A[0] ^= RC[round];
  }
  return A;
}

/* Bytes in, 32 bytes out. */
export function keccak256(bytes){
  const RATE = 136;                       // 1600 bits of state minus 512 of capacity
  const len = bytes.length;
  const padded = new Uint8Array(Math.ceil((len + 1) / RATE) * RATE);
  padded.set(bytes);
  padded[len] |= 0x01;                    // Keccak's padding, NOT SHA-3's 0x06
  padded[padded.length - 1] |= 0x80;

  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE){
    for (let i = 0; i < RATE / 8; i++){
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i*8 + b]);
      A[i] ^= lane;
    }
    keccakF(A);
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++){
    let lane = A[i];
    for (let b = 0; b < 8; b++){ out[i*8 + b] = Number(lane & 0xffn); lane >>= 8n; }
  }
  return out;
}

export const toHex = b => '0x' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export function fromHex(h){
  const s = String(h || '').replace(/^0x/i, '');
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i*2, i*2 + 2), 16);
  return out;
}

/* ===================== The signed message =====================
   The same envelope every wallet puts around a message it signs for a human:
   a prefix that cannot occur in a transaction, so a signature given to a
   website can never be replayed as a transaction that moves money. */
export function messageHash(text){
  const body = new TextEncoder().encode(text);
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + body.length);
  const all = new Uint8Array(prefix.length + body.length);
  all.set(prefix); all.set(body, prefix.length);
  return keccak256(all);
}

/* ===================== Who signed it =====================
   The order of the curve, and its half. Every signature has a mirror twin
   that is just as valid mathematically — same signer, different bytes. We
   accept only the lower one, as Ethereum itself has since Homestead. Not for
   the maths: for us. If both twins were accepted, the same authorisation
   would have two different forms, and "have we seen this one already?" would
   answer no to a replay we have in fact already seen. */
const N      = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;

const ECRECOVER = '0x0000000000000000000000000000000000000001';

/* Split a 65-byte signature into its parts, refusing anything malformed
   before it ever reaches a node. */
export function splitSignature(sig){
  const b = fromHex(sig);
  if (!b || b.length !== 65) return null;
  const num = o => { let v = 0n; for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(b[o + i]); return v; };
  const r = num(0), s = num(32);
  let v = b[64];
  if (v < 27) v += 27;                       // some wallets write 0/1
  if (v !== 27 && v !== 28) return null;
  if (r === 0n || r >= N) return null;
  if (s === 0n || s > HALF_N) return null;   // the mirror twin is refused
  return { r, s, v };
}

const word = n => n.toString(16).padStart(64, '0');

/* Ask a node to run the built-in recovery. Returns a lowercase address, or
   null when the maths says "no such signer". Throws when no node answered —
   and the caller must treat that as "unknown", never as "not the merchant". */
export async function recoverAddress(rpc, hash, sig){
  const parts = splitSignature(sig);
  if (!parts) return null;
  const data = '0x' + toHex(hash).slice(2)
             + word(BigInt(parts.v)) + word(parts.r) + word(parts.s);
  const out = await rpc('eth_call', [{ to: ECRECOVER, data }, 'latest']);
  const hex = String(out || '').replace(/^0x/, '');
  if (hex.length < 64) return null;
  const addr = '0x' + hex.slice(24, 64).toLowerCase();
  if (addr === '0x' + '0'.repeat(40)) return null;   // recovery failed
  return addr;
}
