export const NETWORKS=Object.freeze({solana:'Solana',bnb:'BNB Chain',base:'Base',eth:'Ethereum'});
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const BAD_TEXT=/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;
export function base58(bytes){let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let s='';while(n){s=B58[Number(n%58n)]+s;n/=58n}for(const b of bytes){if(b)break;s='1'+s}return s}
export function validAddress(net,address){
 if(!Object.hasOwn(NETWORKS,net)||typeof address!=='string')return false;
 if(net!=='solana')return /^0x[0-9a-fA-F]{40}$/.test(address)&&!/^0x0{40}$/i.test(address);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return false;
 let n=0n;for(const c of address)n=n*58n+BigInt(B58.indexOf(c));
 let bytes=0;for(let v=n;v;v>>=8n)bytes++;let zeros=0;for(const c of address){if(c!=='1')break;zeros++}
 return n!==0n&&bytes+zeros===32;
}
export const sameAddress=(net,a,b)=>net==='solana'?a===b:String(a).toLowerCase()===String(b).toLowerCase();
export function profilePayload(value,now=Math.floor(Date.now()/1000)){
 const b={action:'profile',net:value.net,to:value.to,greeting:value.greeting??'',goal:value.goal??'',target:value.target??'',restart:!!value.restart,ts:value.ts??now,telegram:value.telegram??''};
 if(!validAddress(b.net,b.to))throw new Error('invalid_address');
 if(typeof b.greeting!=='string'||[...b.greeting].length>200||BAD_TEXT.test(b.greeting))throw new Error('invalid_greeting');
 if(typeof b.goal!=='string'||[...b.goal].length>48||BAD_TEXT.test(b.goal))throw new Error('invalid_goal');
 if(typeof b.target!=='string'||(b.target&&!/^\d{1,7}(\.\d{1,2})?$/.test(b.target)))throw new Error('invalid_target');
 const target=b.target?Number(b.target):0;
 if((b.target&&(target<1||target>1000000))||Boolean(b.goal.trim())!==(target>0))throw new Error('invalid_target');
 if(typeof b.telegram!=='string'||(b.telegram&&!/^[A-Za-z0-9_-]{20,32}$/.test(b.telegram)))throw new Error('invalid_telegram');
 if(!Number.isInteger(b.ts)||Math.abs(now-b.ts)>300)throw new Error('expired_request');
 return b;
}
export function profileText(o){return ['Tavarov donation page','wallet: '+(o.net==='solana'?o.to:o.to.toLowerCase()),'network: '+o.net,'greeting: '+o.greeting,'goal: '+o.goal,'target: '+o.target,'restart: '+(o.restart?'yes':'no'),'time: '+o.ts].concat(o.telegram?['telegram: '+o.telegram]:[]).join('\n')}
export function donationLinks(net,address,language='en',settings={},evm=''){
 if(!validAddress(net,address))throw new Error('invalid_address');
 const lang=['en','ru','es','pt','tr'].includes(language)?language:'en';
 const tip=new URL('https://wallet.tavarov.com/d/'+encodeURIComponent(address));tip.search=new URLSearchParams({net,lang}).toString();if(net==='solana'&&validAddress('bnb',evm))tip.searchParams.set('evm',evm);
 const alert=new URL('https://wallet.tavarov.com/alert');alert.search=new URLSearchParams({to:address,net,lang}).toString();
 const o=obsSettings(settings);if(o.min>0)alert.searchParams.set('min',String(o.min));if(o.d!==8)alert.searchParams.set('d',String(o.d));if(!o.snd)alert.searchParams.set('snd','0');if(!o.msg)alert.searchParams.set('msg','0');
 const preview=new URL(alert);preview.searchParams.set('demo','1');
 const goal=new URL(alert);goal.searchParams.set('goal','1');
 const goalPreview=new URL(goal);goalPreview.searchParams.set('demo','1');
 return {tip:tip.href,alert:alert.href,preview:preview.href,goal:goal.href,goalPreview:goalPreview.href};
}
export function obsSettings(o={}){return {min:Math.max(0,Math.min(100000,Number(o.min)||0)),d:[5,8,12,20].includes(Number(o.d))?Number(o.d):8,snd:o.snd!==false,msg:o.msg!==false}}
export function totals(hours,now=Date.now()){
 const midnight=new Date(now);midnight.setHours(0,0,0,0);const start=midnight.getTime();let day=0,week=0,month=0;
 for(const [hr,c]of Object.entries(hours||{})){const ms=Number(hr)*3600000;if(!Number.isFinite(ms)||!Number.isSafeInteger(c)||c<0||ms>now)continue;if(ms+3600000>start)day+=c;if(ms>=now-7*86400000)week+=c;if(ms>=now-30*86400000)month+=c}
 return {day,week,month};
}
