import {NETWORKS,profilePayload,profileText,sameAddress,base58,validAddress} from './core.mjs?v=e7a7927ff4ae';
// Dormant on ordinary wallet visits. Only the creator popup enables this bridge.
const match=location.hash.match(/^#creator-connect=([0-9a-f]{64})$/);
if(match&&window.opener){
 // Only the creator dashboard on its own origin may talk to this window.
 const LOCAL=['127.0.0.1','localhost'].includes(location.hostname);
 const nonce=match[1],parent=window.opener,origin=LOCAL?location.protocol+'//'+location.hostname+':8899':'https://creator.tavarov.com';
 // approved: public addresses the person agreed to share, one per address family.
 let pending=null,approved={evm:'',solana:''},approvedNets=new Set(),busy=false;
 // The dashboard repeats each request until it hears back; a late copy of a finished request must not reopen the panel.
 const finished=new Set();
 const L={
  en:{tg:'Send donation notifications to Telegram.',one:'Unlock NoN Wallet, then connect it to Tavarov Donate. This shares your public address only.',all:'Unlock NoN Wallet, then connect it to Tavarov Donate on all networks. This shares your public addresses only.',connect:'Connect wallet',approve:'Approve these donation-page changes. Signing this message does not move funds.',approveBtn:'Approve changes',cancel:'Cancel',greeting:'Greeting: ',goal:'Goal: ',target:'Target: ',restart:'Start the goal again from zero.',unlock:'Unlock your wallet first, then press the button again.',changed:'The wallet changed. Connect again.'},
  ru:{tg:'Присылать уведомления о донатах в Telegram.',one:'Разблокируйте NoN Wallet, затем подключите его к Tavarov Donate. Передаётся только публичный адрес.',all:'Разблокируйте NoN Wallet, затем подключите его к Tavarov Donate во всех сетях. Передаются только публичные адреса.',connect:'Подключить кошелёк',approve:'Подтвердите изменения страницы донатов. Подпись сообщения не переводит деньги.',approveBtn:'Подтвердить изменения',cancel:'Отмена',greeting:'Приветствие: ',goal:'Цель: ',target:'Сумма: ',restart:'Начать отсчёт цели заново с нуля.',unlock:'Сначала разблокируйте кошелёк, затем нажмите кнопку ещё раз.',changed:'Кошелёк изменился. Подключите его снова.'},
  es:{tg:'Enviar avisos de donaciones a Telegram.',one:'Desbloquea NoN Wallet y conéctala a Tavarov Donate. Solo se comparte tu dirección pública.',all:'Desbloquea NoN Wallet y conéctala a Tavarov Donate en todas las redes. Solo se comparten tus direcciones públicas.',connect:'Conectar billetera',approve:'Aprueba estos cambios de tu página de donaciones. Firmar este mensaje no mueve fondos.',approveBtn:'Aprobar cambios',cancel:'Cancelar',greeting:'Saludo: ',goal:'Meta: ',target:'Objetivo: ',restart:'Empezar la meta de nuevo desde cero.',unlock:'Primero desbloquea tu billetera y vuelve a pulsar el botón.',changed:'La billetera cambió. Vuelve a conectarla.'},
  pt:{tg:'Enviar avisos de doações para o Telegram.',one:'Desbloqueie a NoN Wallet e conecte-a ao Tavarov Donate. Só o seu endereço público é compartilhado.',all:'Desbloqueie a NoN Wallet e conecte-a ao Tavarov Donate em todas as redes. Só os seus endereços públicos são compartilhados.',connect:'Conectar carteira',approve:'Aprove estas alterações da sua página de doações. Assinar esta mensagem não move fundos.',approveBtn:'Aprovar alterações',cancel:'Cancelar',greeting:'Saudação: ',goal:'Meta: ',target:'Valor: ',restart:'Recomeçar a meta do zero.',unlock:'Primeiro desbloqueie a carteira e toque no botão de novo.',changed:'A carteira mudou. Conecte de novo.'},
  tr:{tg:'Bağış bildirimlerini Telegram’a gönder.',one:'NoN Wallet’ın kilidini açın ve Tavarov Donate’e bağlayın. Yalnızca herkese açık adresiniz paylaşılır.',all:'NoN Wallet’ın kilidini açın ve tüm ağlarda Tavarov Donate’e bağlayın. Yalnızca herkese açık adresleriniz paylaşılır.',connect:'Cüzdanı bağla',approve:'Bağış sayfası değişikliklerini onaylayın. Bu mesajı imzalamak para göndermez.',approveBtn:'Değişiklikleri onayla',cancel:'İptal',greeting:'Karşılama: ',goal:'Hedef: ',target:'Tutar: ',restart:'Hedefi sıfırdan yeniden başlat.',unlock:'Önce cüzdanınızın kilidini açın, sonra düğmeye tekrar basın.',changed:'Cüzdan değişti. Yeniden bağlayın.'},
  tg:{tg:'Огоҳиҳои донатро ба Telegram фиристодан.',one:'NoN Wallet-ро кушоед ва ба Tavarov Donate пайваст кунед. Танҳо суроғаи ошкор дода мешавад.',all:'NoN Wallet-ро кушоед ва дар ҳамаи шабакаҳо ба Tavarov Donate пайваст кунед. Танҳо суроғаҳои ошкор дода мешаванд.',connect:'Пайваст кардани ҳамён',approve:'Тағйироти саҳифаи донатро тасдиқ кунед. Имзои ин паём пулро интиқол намедиҳад.',approveBtn:'Тасдиқи тағйирот',cancel:'Бекор',greeting:'Табрик: ',goal:'Ҳадаф: ',target:'Маблағ: ',restart:'Ҳадафро аз сифр сар кардан.',unlock:'Аввал ҳамёнро кушоед, баъд тугмаро боз пахш кунед.',changed:'Ҳамён иваз шуд. Аз нав пайваст кунед.'}
 };
 const lang=new URLSearchParams(location.search).get('lang'),T=L[lang]||L.en;
 const familyOf=net=>net==='solana'?'solana':'evm';
 // The dashboard opened this window again with a new request: reload so the bridge starts with the new nonce.
 window.addEventListener('hashchange',()=>{const next=location.hash.match(/^#creator-connect=([0-9a-f]{64})$/);if(next&&next[1]!==nonce)location.reload()});
 const css=document.createElement('link');css.rel='stylesheet';css.href='/creator/bridge.css?v=7aa767607b99';document.head.append(css);
 const panel=document.createElement('section');panel.className='creator-bridge';panel.setAttribute('aria-label','Tavarov Donate');
 const title=document.createElement('strong');title.textContent='Tavarov Donate';
 const text=document.createElement('p'),details=document.createElement('pre'),actions=document.createElement('div'),accept=document.createElement('button'),reject=document.createElement('button');
 accept.type=reject.type='button';actions.append(accept,reject);panel.append(title,text,details,actions);document.body.append(panel);
 function address(family){try{if(typeof wallet==='undefined'||!wallet)return '';return family==='solana'?wallet.solana?.address||'':wallet.evm?.address||''}catch{return ''}}
 function current(){const evm=address('evm'),solana=address('solana');return {evm:validAddress('bnb',evm)?evm:'',solana:validAddress('solana',solana)?solana:''}}
 function send(type,extra={}){if(extra.id&&type!=='ready')finished.add(extra.id);parent.postMessage({channel:'tavarov-creator-v1',type,nonce,...extra},origin)}
 function idle(){pending=null;panel.hidden=true}
 function failure(message){text.textContent=message;accept.disabled=false;busy=false}
 const coded=(code)=>Object.assign(new Error(code),{code});
 // One request may carry several page versions (one per network). All of them
 // must be the same text, each bound to the address the person approved.
 function readPayloads(d){
  const raw=Array.isArray(d.payloads)?d.payloads:d.payload?[d.payload]:[];
  if(!raw.length||raw.length>Object.keys(NETWORKS).length)throw coded('invalid');
  const list=raw.map(v=>profilePayload(v)),seen=new Set(),first=list[0];
  for(const p of list){
   if(seen.has(p.net))throw coded('invalid');seen.add(p.net);
   if(!approvedNets.has(p.net))throw coded('reconnect');
   const mine=approved[familyOf(p.net)];if(!mine||!sameAddress(p.net,p.to,mine))throw coded('reconnect');
   if(p.greeting!==first.greeting||p.goal!==first.goal||p.target!==first.target||p.restart!==first.restart||p.ts!==first.ts||p.telegram!==first.telegram)throw coded('invalid');
  }
  return list;
 }
 window.addEventListener('message',event=>{
  if(event.origin!==origin||event.source!==parent||!event.data||event.data.channel!=='tavarov-creator-v1'||event.data.nonce!==nonce||busy)return;
  const d=event.data;if(typeof d.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(d.id)||finished.has(d.id))return;
  if(d.type==='cancel'){if(pending?.id===d.id){finished.add(d.id);idle()}return}
  if(pending&&pending.id===d.id)return;
  if(pending)return;
  try{
   if(d.type==='connect'){
    if(!Object.hasOwn(NETWORKS,d.net))return;
    pending={type:'connect',id:d.id,net:d.net};text.textContent=T.one;details.textContent=NETWORKS[d.net];accept.textContent=T.connect;
   }else if(d.type==='connect-all'){
    pending={type:'connect-all',id:d.id};text.textContent=T.all;details.textContent=[NETWORKS.bnb,NETWORKS.eth,NETWORKS.base,NETWORKS.solana].join(' · ');accept.textContent=T.connect;
   }else if(d.type==='profile'){
    const list=readPayloads(d),p=list[0];
    pending={type:'profile',id:d.id,payloads:list};text.textContent=T.approve;
    const groups=new Map();for(const x of list){const key=familyOf(x.net)+':'+x.to;groups.set(key,[...(groups.get(key)||[]),x])}
    const where=[...groups.values()].map(g=>g.map(x=>NETWORKS[x.net]).join(' · ')+':\n'+g[0].to);
    details.textContent=[...where,'',T.greeting+(p.greeting||'—'),T.goal+(p.goal||'—'),T.target+(p.target||'—'),p.restart?T.restart:'',...(p.telegram?[T.tg]:[])].join('\n');
    accept.textContent=T.approveBtn;
   }else return;
   reject.textContent=T.cancel;accept.disabled=false;panel.hidden=false;
  }catch(e){send('error',{id:d.id,error:['reconnect','invalid'].includes(e.code)?e.code:'invalid'});idle()}
 });
 accept.addEventListener('click',async()=>{
  if(!pending||busy)return;const request=pending,now=current();
  // A locked wallet keeps the request open: the person unlocks and presses again.
  const needs=request.type==='connect'?[familyOf(request.net)]:request.type==='connect-all'?null:[...new Set(request.payloads.map(p=>familyOf(p.net)))];
  const locked=needs?needs.some(f=>!now[f]):!now.evm&&!now.solana;
  if(locked){failure(T.unlock);return}
  busy=true;accept.disabled=true;
  try{
   if(request.type==='connect'){const family=familyOf(request.net);approved={evm:'',solana:''};approved[family]=now[family];approvedNets=new Set([request.net]);send('connected',{id:request.id,address:now[family],net:request.net});idle();try{parent.focus()}catch{}}
   else if(request.type==='connect-all'){approved={evm:now.evm,solana:now.solana};approvedNets=new Set(Object.keys(NETWORKS).filter(net=>approved[familyOf(net)]));send('connected',{id:request.id,addresses:{...approved}});idle();try{parent.focus()}catch{}}
   else{
    const signatures=[];
    for(const p of request.payloads){
     const family=familyOf(p.net);if(!sameAddress(p.net,now[family],approved[family]))throw coded('wallet_changed');
     const message=profileText(p);let signature;
     if(family==='solana'){
      const secret=ethers.utils.arrayify(wallet.solana.secretKey);
      try{signature=base58(nacl.sign.detached(new TextEncoder().encode(message),secret))}finally{secret.fill(0)}
     }else signature=await new ethers.Wallet(wallet.evm.privateKey).signMessage(message);
     signatures.push({net:p.net,address:now[family],signature});
    }
    const one=signatures.length===1?{address:signatures[0].address,net:signatures[0].net,signature:signatures[0].signature}:{};
    send('signed',{id:request.id,signatures,...one});idle();try{parent.focus()}catch{}
   }
  }catch(e){send('error',{id:request.id,error:e.code==='wallet_changed'?'wallet_changed':'sign_failed'});idle()}
  finally{busy=false;accept.disabled=false}
 });
 reject.addEventListener('click',()=>{if(pending)send('error',{id:pending.id,error:'cancelled'});idle()});
 idle();send('ready');
}
