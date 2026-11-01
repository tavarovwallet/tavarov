import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import * as core from '../www/creator/core.mjs';
const require=createRequire(import.meta.url),{ethers}=require('../www/lib/ethers.umd.min.js'),nacl=require('../www/lib/nacl-fast.min.js');
const listeners={},nodes=[],sent=[],origin='http://127.0.0.1:8899',nonce='c'.repeat(64),parent={postMessage:(data,target)=>sent.push({data,target})};
const node=tag=>{const n={tag,hidden:false,disabled:false,events:{},append(){},setAttribute(){},addEventListener(type,fn){this.events[type]=fn}};nodes.push(n);return n};
const evm=new ethers.Wallet('0x'+'02'.repeat(32)),sol=nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7)),solAddr=core.base58(sol.publicKey);
const context={...core,location:{hash:'#creator-connect='+nonce,origin:'http://127.0.0.1:8898',hostname:'127.0.0.1',protocol:'http:',search:'?lang=ru'},URLSearchParams,TextEncoder,ethers,nacl,document:{createElement:node,head:{append(){}},body:{append(){}}},window:{opener:parent,addEventListener:(type,fn)=>listeners[type]=fn},wallet:null};
vm.createContext(context);vm.runInContext((await readFile(new URL('../www/creator/bridge.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,''),context);
const [accept,reject]=nodes.filter(n=>n.tag==='button'),pre=nodes.find(n=>n.tag==='pre');
const send=data=>listeners.message({origin,source:parent,data:{channel:'tavarov-creator-v1',nonce,...data}});
const last=id=>sent.filter(s=>s.data.id===id).at(-1)?.data;
// Locked wallet cannot connect.
send({type:'connect-all',id:'all'});await accept.events.click();assert(!last('all'),'locked wallet must not connect');
// Unlocked: one approval shares both public addresses.
context.wallet={evm:{address:evm.address,privateKey:evm.privateKey},solana:{address:solAddr,secretKey:ethers.utils.hexlify(sol.secretKey)}};
await accept.events.click();const c=last('all');assert.equal(c.type,'connected');assert.equal(JSON.stringify(c.addresses),JSON.stringify({evm:evm.address,solana:solAddr}));
// Profile for all four networks with one approval.
const ts=Math.floor(Date.now()/1000),base={greeting:'Спасибо!',goal:'Микрофон',target:'300',ts};
const payloads=[['bnb',evm.address],['eth',evm.address],['base',evm.address],['solana',solAddr]].map(([net,to])=>core.profilePayload({...base,net,to}));
send({type:'profile',id:'p4',payloads});assert(!last('p4'),'must wait for explicit approval');
assert(pre.textContent.includes('BNB Chain · Ethereum · Base:\n'+evm.address)&&pre.textContent.includes('Solana:\n'+solAddr)&&pre.textContent.includes('Спасибо!'),'approval shows every network and the text');
await accept.events.click();const s=last('p4');assert.equal(s.type,'signed');assert.equal(s.signatures.length,4);
for(const p of payloads){const x=s.signatures.find(v=>v.net===p.net);assert(x);const text=core.profileText(p);
 if(p.net!=='solana')assert.equal(ethers.utils.verifyMessage(text,x.signature),evm.address);}
// Solana signature: decode base58 manually and verify.
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';const dec=str=>{let n=0n;for(const ch of str)n=n*58n+BigInt(B58.indexOf(ch));const out=[];while(n){out.unshift(Number(n%256n));n/=256n}for(const ch of str){if(ch!=='1')break;out.unshift(0)}return Uint8Array.from(out)};
const sp=payloads[3],ss=s.signatures.find(v=>v.net==='solana');assert(nacl.sign.detached.verify(new TextEncoder().encode(core.profileText(sp)),dec(ss.signature),sol.publicKey),'solana signature valid');

// A late copy of a finished request must not reopen the panel.
const before=sent.length;send({type:'profile',id:'p4',payloads});assert.equal(sent.length,before,'finished request ignored');assert(nodes.find(n=>n.tag==='section').hidden,'panel stays closed');
// Locked wallet while approving keeps the request open; after unlocking it signs.
const saved=context.wallet;context.wallet=null;send({type:'profile',id:'locked1',payloads:[payloads[0]]});await accept.events.click();assert(!last('locked1'),'locked wallet keeps the request pending');
context.wallet=saved;await accept.events.click();assert.equal(last('locked1').type,'signed');
// Error codes, not text.
send({type:'profile',id:'codes',payloads:[{...payloads[0],to:'0x'+'22'.repeat(20)}]});assert.equal(last('codes').error,'reconnect');
// The wallet's own origin (e.g. another wallet page) is not the dashboard: ignored.
const n0=sent.length;listeners.message({origin:'http://127.0.0.1:8898',source:parent,data:{channel:'tavarov-creator-v1',nonce,type:'connect-all',id:'same-origin'}});assert.equal(sent.length,n0,'wallet origin rejected');
// Rejections.
const err=id=>last(id)?.type==='error';
send({type:'profile',id:'mixed',payloads:[payloads[0],{...payloads[1],greeting:'Другой текст'}]});assert(err('mixed'),'different text per network is rejected');
send({type:'profile',id:'dup',payloads:[payloads[0],payloads[0]]});assert(err('dup'),'duplicate network is rejected');
send({type:'profile',id:'other',payloads:[{...payloads[0],to:'0x'+'11'.repeat(20)}]});assert(err('other'),'foreign address is rejected');
send({type:'profile',id:'five',payloads:[...payloads,payloads[0]]});assert(err('five'),'too many payloads rejected');
send({type:'eth_sendTransaction',id:'tx',payload:{to:evm.address,value:'1'}});assert(!last('tx'),'transactions ignored');
// Wallet switched to another account after connecting: signing refused.
send({type:'profile',id:'switched',payloads:[payloads[0]]});const other=new ethers.Wallet('0x'+'03'.repeat(32));context.wallet.evm={address:other.address,privateKey:other.privateKey};await accept.events.click();assert(err('switched'),'changed wallet must not sign');
// Cancel works.
context.wallet.evm={address:evm.address,privateKey:evm.privateKey};send({type:'profile',id:'cancelme',payloads:[payloads[0]]});reject.events.click();assert.equal(last('cancelme').error,'cancelled');
const dump=JSON.stringify(sent);assert(!dump.includes(evm.privateKey.slice(2))&&!dump.includes(ethers.utils.hexlify(sol.secretKey).slice(2)),'keys never leave');assert(sent.every(m=>m.target===origin));
console.log('Passed: connect-all (locked/unlocked), 4-network profile with one approval, valid EVM and Solana signatures, mixed/duplicate/foreign/oversized requests rejected, switched wallet refused, cancel, no keys leaked.');
