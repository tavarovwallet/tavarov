export const NETWORKS=Object.freeze({solana:'Solana',bnb:'BNB Chain',base:'Base',eth:'Ethereum'});
export function validRecipient(network,address){
 if(!Object.hasOwn(NETWORKS,network)||typeof address!=='string')return false;
 if(network!=='solana')return /^0x[0-9a-fA-F]{40}$/.test(address)&&!/^0x0{40}$/i.test(address);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))return false;
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
 let value=0n;
 for(const char of address)value=value*58n+BigInt(alphabet.indexOf(char));
 let bytes=0;for(let n=value;n>0n;n>>=8n)bytes++;
 let leading=0;for(const char of address){if(char!=='1')break;leading++}
 return bytes+leading===32&&value!==0n;
}
export function donationLinks(network,address,language='en'){
 if(!validRecipient(network,address))throw new Error('Invalid recipient');
 const lang=['en','ru','es','pt','tr','tg','id'].includes(language)?language:'en';
 const tip=new URL('https://wallet.tavarov.com/d/'+encodeURIComponent(address));
 tip.search=new URLSearchParams({net:network,lang}).toString();
 const alert=new URL('https://wallet.tavarov.com/alert');
 alert.search=new URLSearchParams({to:address,net:network,lang}).toString();
 const preview=new URL(alert);preview.searchParams.set('demo','1');preview.searchParams.set('snd','0');
 return {tip:tip.href,alert:alert.href,preview:preview.href};
}
