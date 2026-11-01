import {NETWORKS,base58,validAddress,sameAddress,profilePayload,profileText,donationLinks,obsSettings,totals} from './core.mjs?v=e7a7927ff4ae';
const $=id=>document.getElementById(id),t=value=>window.tavarovText?.(value)||value;
// The dashboard lives on its own origin (creator.tavarov.com); the wallet and its API stay on wallet.tavarov.com.
// Different origins mean this page can talk to the wallet window only through messages, never reach into it.
const LOCAL=['127.0.0.1','localhost'].includes(location.hostname),WALLET=LOCAL?location.protocol+'//'+location.hostname+':8898':'https://wallet.tavarov.com';
const NETS=Object.keys(NETWORKS),familyOf=net=>net==='solana'?'solana':'evm';
let profilesOk=false,otherGoals=[],retry=null,recentSave=null,tgCode='',tgOn=false;
let recipient=null,session=null,profile=null,profileLoaded=false,goalRaised=null,epoch=0,dirty=false,loading=false,saving=false,lastSavedTime=0;
let popup=null,bridgeNonce='',bridgeAddresses=null;const pending=new Map();
const errors={telegram_expired:'The Telegram link has expired. Press “Telegram notifications” again.',invalid_telegram:'The Telegram link has expired. Press “Telegram notifications” again.',invalid_address:'Enter a valid wallet address for the selected network.',invalid_greeting:'Use up to 200 characters, without line breaks or hidden characters.',invalid_goal:'Use a goal name of up to 48 characters, without hidden characters.',invalid_target:'Add both a goal name and a target from 1 to 1,000,000.',expired_request:'The request expired. Please try again.',cancelled:'Cancelled.',unavailable:'Open this page in your wallet browser, or connect NoN Wallet.',disconnected:'Your wallet connection changed. Connect again.',popup_blocked:'Allow the NoN Wallet window to open, then try again.',timeout:'The wallet did not respond. Please try again.',rate_limit:'Too many changes in a short time. Wait a few minutes and try again.',no_network_address:'This wallet has no address on this network.',clock:'Your device clock is off. Set the correct time and try again.',profiles_incomplete:'Could not load your page settings on every network. Press Refresh, then save again.'};
function errorText(e){return t(errors[e?.code||e?.message]||'Could not complete this request. Please try again.')}
const failure=code=>Object.assign(new Error(code),{code});
function notify(text,isError=false,id='creator-status'){const el=$(id);el.textContent=text;el.classList.toggle('is-error',isError)}
function language(){return document.documentElement.lang||'en'}
function canEdit(){
 if(!session||!recipient)return false;
 if(session.kind==='non'){const mine=session.addresses[familyOf(recipient.net)];return !!mine&&sameAddress(recipient.net,mine,recipient.address)}
 return sameAddress(recipient.net,session.address,recipient.address)&&familyOf(recipient.net)===session.family;
}
// NoN Wallet shares both its addresses at once, so the dashboard covers every network.
function allNetworks(){return session?.kind==='non'&&canEdit()}
function targets(){
 if(!allNetworks())return [{net:recipient.net,address:recipient.address}];
 return NETS.map(net=>({net,address:session.addresses[familyOf(net)]})).filter(x=>x.address&&validAddress(x.net,x.address));
}
function renderScope(){
 const note=document.querySelector('.stats-note');
 if(note)note.textContent=t(allNetworks()?'Totals across BNB Chain, Ethereum, Base and Solana. USDT and USDC, before service fees. Network fees are separate.':'USDT and USDC totals, before service fees. Blockchain network fees are separate.');
}
function updateEditing(){const edit=canEdit()&&profileLoaded&&!saving;$('save-profile').disabled=!edit;$('connect-for-editing').hidden=canEdit();for(const id of ['creator-greeting','creator-goal-title','creator-goal-target'])$(id).disabled=!edit;$('restart-goal').disabled=!edit;$('tg-connect').disabled=!edit;$('account-kind').textContent=t(allNetworks()?'Connected wallet · all networks':canEdit()?'Connected wallet':'Viewing only');renderScope()}
function currentObs(){return obsSettings({min:$('obs-min').value,d:$('obs-duration').value,snd:$('obs-sound').checked,msg:$('obs-message').checked})}
function renderLinks(){if(!recipient)return;const links=donationLinks(recipient.net,recipient.address,language(),currentObs(),allNetworks()?session.addresses.evm:'');$('share-link').value=links.tip;$('view-donation-page').href=links.tip;$('obs-alert-url').value=links.alert;$('obs-preview').href=links.preview;$('obs-goal-url').value=links.goal;$('obs-goal-preview').href=links.goalPreview}
function renderProfile(){
 if(!profileLoaded)return;
 if(!dirty){$('creator-greeting').value=profile?.greeting||'';$('creator-goal-title').value=profile?.goal?.title||'';$('creator-goal-target').value=profile?.goal?.target||''}
 const goal=profile?.goal;$('goal-progress').hidden=!goal;if(goal){$('goal-settings').open=true;const raised=goalRaised===null?String(goal.raised):String(Math.round(goalRaised)/100);const pct=Math.max(0,Math.min(100,Number(raised)/Number(goal.target)*100||0));$('goal-progress-bar').value=pct;$('goal-raised').textContent=raised+' / '+goal.target+' USDT / USDC';$('goal-percent').textContent=Math.floor(pct)+'%'}
 $('tg-status').textContent=t(tgCode?'Telegram is open. Press Start in the bot, then press Save changes here.':tgOn?'On: every donation arrives in Telegram. To turn off, send /donoff to the bot.':'Get a Telegram message for every donation.');
 updateEditing();
}
function selectTool(id,focus=false){const ids=['creator-page','creator-history','stream-alerts'];const target=ids.includes(id)?id:'creator-page';document.querySelectorAll('.creator-tabs [role=tab]').forEach(button=>{const on=button.getAttribute('aria-controls')===target;button.setAttribute('aria-selected',String(on));button.tabIndex=on?0:-1;$(button.getAttribute('aria-controls')).hidden=!on;if(on&&focus)button.focus()})}
function hashTool(){if(location.hash==='#stream-alerts')selectTool('stream-alerts')}
document.querySelectorAll('.creator-tabs [role=tab]').forEach((button,i,all)=>{button.addEventListener('click',()=>selectTool(button.getAttribute('aria-controls')));button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(i+1)%all.length;else if(event.key==='ArrowLeft')next=(i+all.length-1)%all.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=all.length-1;else return;event.preventDefault();selectTool(all[next].getAttribute('aria-controls'),true)})});
window.addEventListener('hashchange',hashTool);hashTool();
async function api(query,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const response=await fetch(WALLET+'/api/donate'+(query?'?'+query:''),{method:body?'POST':'GET',cache:'no-store',credentials:'omit',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});let data;try{data=await response.json()}catch{throw failure('request_failed')}if(!response.ok){const e=failure(response.status===429?'rate_limit':response.status===410?'telegram_expired':response.status===400&&/too old/.test(String(data?.error))?'clock':'request_failed');e.status=response.status;throw e}return data}finally{clearTimeout(timer)}
}
function query(extra={}){return new URLSearchParams({net:recipient.net,to:recipient.address,...extra}).toString()}
function renderHistory(items){const list=$('donation-history');list.replaceChildren();if(!items.length){const p=document.createElement('p');p.className='empty-state';p.textContent=t('No confirmed donations yet.');list.append(p);return}for(const it of items.slice(0,100)){const row=document.createElement('article');row.className='donation-row';const top=document.createElement('div'),amount=document.createElement('strong'),date=document.createElement('time');amount.textContent='+'+String(it.amount||'0')+' '+String(it.cur||'');const stamp=Number(it.ts);date.textContent=Number.isFinite(stamp)?new Date(stamp).toLocaleString(language(),{dateStyle:'medium',timeStyle:'short'}):'';top.append(amount,date);const name=document.createElement('p');name.className='donation-name';name.textContent=(it.nick||t('Anonymous'))+(it.net&&NETWORKS[it.net]?' · '+NETWORKS[it.net]:'');row.append(top,name);if(it.msg){const msg=document.createElement('p');msg.className='donation-message';msg.textContent=it.msg;row.append(msg)}list.append(row)}}
async function loadDashboard(){
 if(!recipient||loading)return;loading=true;const requestEpoch=epoch;$('refresh-dashboard').disabled=true;
 const list=targets(),many=list.length>1,q=(x,extra)=>new URLSearchParams({net:x.net,to:x.address,...extra}).toString();
 const calls=await Promise.allSettled(list.flatMap(x=>[api(q(x,{profile:'1'})),api(q(x,{stats:'1'})),api(q(x,{limit:'100'}))]));
 if(requestEpoch!==epoch){if(!loading)$('refresh-dashboard').disabled=false;return}
 const part=(i,k)=>calls[i*3+k],ok=(r,key)=>r.status==='fulfilled'&&r.value&&r.value[key];
 let failed=false;const mine=Math.max(0,list.findIndex(x=>x.net===recipient.net));
 goalRaised=null;profilesOk=list.every((x,i)=>ok(part(i,0),'profile'));otherGoals=list.map((x,i)=>ok(part(i,0),'profile')?part(i,0).value.profile.goal:null).filter(Boolean);
 if(ok(part(mine,0),'profile')){
  profile=part(mine,0).value.profile;tgOn=!!profile?.telegram||(tgOn&&!!recentSave);
  // Right after a save the storage may still return the previous text for a minute: keep what was just saved.
  if(recentSave&&Date.now()<recentSave.until&&recentSave.net===recipient.net&&(profile.greeting!==recentSave.profile.greeting||(profile.goal?.title||'')!==(recentSave.profile.goal?.title||'')||(profile.goal?.target||'')!==(recentSave.profile.goal?.target||'')))profile=recentSave.profile;profileLoaded=true;$('profile-load-state').textContent='';
  if(many&&profile.goal){let cents=0;list.forEach((x,i)=>{const g=ok(part(i,0),'profile')?part(i,0).value.profile.goal:null;if(g&&g.title===profile.goal.title&&Number(g.target)===Number(profile.goal.target))cents+=Math.round(Number(g.raised)*100)||0});goalRaised=cents}
  renderProfile();
 }else{failed=true;profileLoaded=false;$('profile-load-state').textContent=t('Could not load your page settings. Press Refresh to try again.');updateEditing()}
 const hours=Object.create(null);let statsOk=true;
 list.forEach((x,i)=>{const r=part(i,1);if(!ok(r,'stats')){statsOk=false;return}for(const [hr,c]of Object.entries(r.value.stats.hours||{}))if(Number.isSafeInteger(c)&&c>=0)hours[hr]=(hours[hr]||0)+c});
 if(statsOk){const v=totals(hours);for(const [key,id]of [['day','stat-day'],['week','stat-week'],['month','stat-month']])$(id).textContent=new Intl.NumberFormat(language(),{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v[key]/100)}else{failed=true;for(const id of ['stat-day','stat-week','stat-month'])$(id).textContent='—'}
 const items=[];let historyOk=true;
 list.forEach((x,i)=>{const r=part(i,2);if(r.status!=='fulfilled'||!Array.isArray(r.value?.items)){historyOk=false;return}for(const it of r.value.items)items.push(many?{...it,net:x.net}:it)});
 if(historyOk){items.sort((a,b)=>(Number(b.ts)||0)-(Number(a.ts)||0));renderHistory(items)}else{failed=true;$('donation-history').textContent=t('Could not load donations. Press Refresh to try again.')}
 if(failed)notify(t('Some data could not be loaded. Press Refresh to try again.'),true);else notify('');loading=false;$('refresh-dashboard').disabled=false;
}
async function activate(address,net,connection=null){
 if(!validAddress(net,address))throw failure('invalid_address');epoch++;recipient={address,net};session=connection;profile=null;profileLoaded=false;goalRaised=null;profilesOk=false;otherGoals=[];retry=null;recentSave=null;dirty=false;loading=false;
 $('creator-network').value=net;$('creator-login').hidden=true;$('creator-account').hidden=false;$('account-address').textContent=address;
 for(const id of ['creator-greeting','creator-goal-title','creator-goal-target'])$(id).value='';$('goal-progress').hidden=true;$('goal-settings').open=false;$('profile-status').textContent='';
 for(const id of ['stat-day','stat-week','stat-month'])$(id).textContent='—';$('donation-history').textContent=t('Loading…');updateEditing();renderLinks();
 try{localStorage.setItem('tavarov-creator-view-v1',JSON.stringify(recipient))}catch{}
 await loadDashboard();
}
function forgetConnection(){session=null;bridgeAddresses=null;updateEditing()}
function rpcBridge(type,fields={}){
 return new Promise((resolve,reject)=>{
  if(!popup||popup.closed){reject(failure('disconnected'));return}
  const id=crypto.randomUUID(),message={channel:'tavarov-creator-v1',type,id,nonce:bridgeNonce,...fields};
  const send=()=>{if(popup?.closed){finish(failure('disconnected'));return}popup.postMessage(message,WALLET)};
  let timer,interval;function finish(error,data){clearTimeout(timer);clearInterval(interval);pending.delete(id);if(error)reject(error);else resolve(data)}
  pending.set(id,{type,finish});timer=setTimeout(()=>{popup?.postMessage({channel:'tavarov-creator-v1',type:'cancel',nonce:bridgeNonce,id},WALLET);finish(failure('timeout'))},180000);interval=setInterval(send,700);send();
 });
}
window.addEventListener('message',event=>{
 if(event.origin!==WALLET||event.source!==popup)return;const d=event.data;if(!d||d.channel!=='tavarov-creator-v1'||d.nonce!==bridgeNonce)return;
 const item=pending.get(d.id);if(!item)return;
 if(d.type==='error'){item.finish(failure(d.error==='cancelled'?'cancelled':['reconnect','wallet_changed'].includes(d.error)?'disconnected':'request_failed'));return}
 if((item.type==='connect-all'&&d.type==='connected')||(item.type==='profile'&&d.type==='signed'))item.finish(null,d);
});
function openBridge(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));bridgeNonce=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 // A fresh window name per connection: reusing an open wallet window would only change its #hash and the wallet would never see the new request.
 popup=window.open(WALLET+'/?lang='+language()+'#creator-connect='+bridgeNonce,'tavarov-donate-wallet-'+bridgeNonce.slice(0,12),'popup,width=460,height=780');if(!popup)throw failure('popup_blocked');
}
async function shareAddresses(){
 if(!popup||popup.closed)openBridge();popup.focus();const response=await rpcBridge('connect-all');const shared=response.addresses||{};
 const addresses={evm:validAddress('bnb',shared.evm)?shared.evm:'',solana:validAddress('solana',shared.solana)?shared.solana:''};
 if(!addresses.evm&&!addresses.solana)throw failure('invalid_address');return addresses;
}
let connecting=false;
async function connectNoN(){
 if(connecting)return;connecting=true;$('wallet-dialog').close();notify(t('Confirm the connection in NoN Wallet.'));
 try{
  const net=$('creator-network').value;
  const addresses=await shareAddresses();
  const start=addresses[familyOf(net)]?net:addresses.evm?'bnb':'solana';bridgeAddresses=addresses;
  await activate(addresses[familyOf(start)],start,{kind:'non',addresses});
 }catch(e){notify(errorText(e),true)}finally{connecting=false}
}
function disconnectHandler(){epoch++;loading=false;forgetConnection();notify(t('Your wallet connection changed. Connect again.'),true)}
async function connectExternal(kind){
 if(connecting)return;connecting=true;$('wallet-dialog').close();
 try{
  let net=$('creator-network').value,address,provider;
  if(kind==='sol'){
   provider=window.phantom?.solana||window.solflare||window.solana;if(!provider?.connect||!provider?.signMessage)throw failure('unavailable');
   const response=await provider.connect();address=String(response.publicKey||provider.publicKey);net='solana';
  }else{
   provider=window.ethereum?.providers?.find(p=>p.isMetaMask)||window.ethereum;if(!provider?.request)throw failure('unavailable');
   const accounts=await provider.request({method:'eth_requestAccounts'});address=accounts?.[0];if(net==='solana')net='bnb';
  }
  if(!validAddress(net,address))throw failure('invalid_address');const changed=()=>{if(session?.provider===provider)disconnectHandler()};provider.on?.('accountsChanged',changed);provider.on?.('accountChanged',changed);provider.on?.('disconnect',changed);
  await activate(address,net,{kind:kind==='sol'?'sol':'evm',family:kind==='sol'?'solana':'evm',address,provider});
 }catch(e){notify(e?.code===4001? t('Cancelled.'):errorText(e),true)}finally{connecting=false}
}
async function signPayloads(payloads){
 if(!canEdit())throw failure('disconnected');const snapshot=session;
 if(snapshot.kind==='non'){
  for(const p of payloads)if(!bridgeAddresses||!sameAddress(p.net,bridgeAddresses[familyOf(p.net)],p.to))throw failure('disconnected');
  if(!popup||popup.closed){
   // The wallet window was closed after connecting: open it again and check it is the same wallet before asking for the signature.
   notify(t('Confirm the connection in NoN Wallet.'),false,'profile-status');const again=await shareAddresses();
   if((again.evm||'').toLowerCase()!==(bridgeAddresses.evm||'').toLowerCase()||again.solana!==bridgeAddresses.solana)throw failure('disconnected');
   notify(t('Approve the message in your wallet.'),false,'profile-status');
  }
  popup.focus();const response=await rpcBridge('profile',{payloads});const signed=Array.isArray(response.signatures)?response.signatures:[];
  return payloads.map(p=>{const s=signed.find(x=>x&&x.net===p.net);if(!s||!sameAddress(p.net,s.address,p.to)||typeof s.signature!=='string')throw failure('disconnected');return s.signature});
 }
 if(payloads.length!==1)throw failure('disconnected');const payload=payloads[0];
 if(snapshot.kind==='sol'){
  if(!sameAddress(payload.net,String(snapshot.provider.publicKey),payload.to))throw failure('disconnected');const signed=await snapshot.provider.signMessage(new TextEncoder().encode(profileText(payload)),'utf8');return [base58(signed.signature||signed)];
 }
 const accounts=await snapshot.provider.request({method:'eth_accounts'});if(!accounts?.[0]||!sameAddress(payload.net,accounts[0],payload.to))throw failure('disconnected');
 const hex='0x'+Array.from(new TextEncoder().encode(profileText(payload)),b=>b.toString(16).padStart(2,'0')).join('');
 return [await snapshot.provider.request({method:'personal_sign',params:[hex,payload.to]})];
}
async function saveProfile(restart=false){
 if(saving||!canEdit()||!profileLoaded)return;
 if(allNetworks()&&!profilesOk){notify(errorText(failure('profiles_incomplete')),true,'profile-status');return}
 const line=id=>$(id).value.trim().replace(/[\r\n\t]+/g,' ');
 const fields={greeting:line('creator-greeting'),goal:line('creator-goal-title'),target:line('creator-goal-target').replace(',','.'),telegram:tgCode},key=JSON.stringify(fields);
 // After a partial save, pressing Save with the same text finishes only the networks that are still missing (and keeps a pending restart).
 const again=retry&&retry.key===key&&!restart;if(again)restart=retry.restart;
 let payloads;
 try{const ts=Math.max(Math.floor(Date.now()/1000),lastSavedTime+1);payloads=targets().filter(x=>!again||retry.nets.includes(x.net)).map(x=>profilePayload({net:x.net,to:x.address,...fields,restart,ts}))}catch(e){notify(errorText(e),true,'profile-status');return}
 if(!payloads.length){retry=null;return}
 const payload=payloads.find(p=>p.net===recipient.net)||payloads[0];
 const goals=(allNetworks()?otherGoals:[profile?.goal]).filter(Boolean);
 const goalChanged=!again&&goals.some(g=>payload.goal!==g.title||Number(payload.target)!==Number(g.target));
 if((restart&&!again||goalChanged)&&!confirm(t(restart?'Start this goal again from zero? Existing donations and funds are kept.':'Changing the goal starts a new total. Existing donations and funds are kept. Continue?')))return;
 const requestEpoch=epoch;saving=true;updateEditing();notify(t('Approve the message in your wallet.'),false,'profile-status');
 try{
  const signatures=await signPayloads(payloads);if(epoch!==requestEpoch)throw failure('disconnected');
  let own=null,firstError=null;const failed=[];
  for(let i=0;i<payloads.length;i++){
   try{const data=await api('',{...payloads[i],sig:signatures[i]});if(!data.ok||!data.profile)throw failure('request_failed');if(payloads[i].net===recipient.net)own=data.profile;if(data.telegram){tgOn=true}}
   catch(e){firstError??=e;failed.push(payloads[i].net)}
   if(epoch!==requestEpoch)return;
  }
  if(failed.length===payloads.length)throw firstError||failure('request_failed');
  if(tgOn&&tgCode&&!failed.length)tgCode='';
  lastSavedTime=payload.ts;if(own){profile=own;profileLoaded=true;recentSave={net:recipient.net,profile:own,until:Date.now()+120000}}
  if(!failed.length){retry=null;dirty=false;renderProfile();notify(t(targets().length>1?'Saved on all networks. Your donation page is up to date.':'Saved. Your donation page is up to date.'),false,'profile-status')}
  else{retry={key,nets:failed,restart};renderProfile();notify(t(firstError?.code==='rate_limit'?'Saved on some networks only. Wait a few minutes, then press Save to finish.':'Saved on some networks only. Press Save again to finish.'),true,'profile-status')}
  if(targets().length>1)setTimeout(loadDashboard,0);
 }catch(e){if(epoch===requestEpoch){if(e?.code==='disconnected')forgetConnection();notify(e?.code===4001?t('Cancelled.'):errorText(e),true,'profile-status')}}
 finally{saving=false;updateEditing()}
}
function confirmDiscard(){return !dirty||confirm(t('Discard unsaved changes?'))}
$('tg-connect').addEventListener('click',()=>{if(!canEdit())return;const b=new Uint8Array(18);crypto.getRandomValues(b);tgCode=btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');window.open('https://t.me/tavarov_pay_bot?start=dn_'+tgCode,'_blank','noopener');renderProfile()});
$('connect-non').addEventListener('click',connectNoN);$('choose-non').addEventListener('click',connectNoN);
const dialogText=[];{const walk=document.createTreeWalker($('wallet-dialog'),NodeFilter.SHOW_TEXT);while(walk.nextNode())if(walk.currentNode.textContent.trim())dialogText.push([walk.currentNode,walk.currentNode.textContent])}
function translateDialog(){for(const [node,original]of dialogText)node.textContent=t(original.trim())}
for(const id of ['connect-other','connect-for-editing'])$(id).addEventListener('click',()=>{translateDialog();$('wallet-dialog').showModal()});
$('close-wallet-dialog').addEventListener('click',()=>$('wallet-dialog').close());$('choose-phantom').addEventListener('click',()=>connectExternal('sol'));$('choose-evm').addEventListener('click',()=>connectExternal('evm'));
$('view-address-form').addEventListener('submit',async event=>{event.preventDefault();const value=$('creator-address').value.trim();let net=$('creator-network').value;if(!validAddress(net,value)){if(validAddress('solana',value))net='solana';else if(validAddress('bnb',value)&&net==='solana')net='bnb'}try{await activate(value,net)}catch(e){notify(errorText(e),true)}});
function toLogin(){epoch++;recipient=null;session=null;profileLoaded=false;dirty=false;retry=null;$('creator-account').hidden=true;$('creator-login').hidden=false;notify('');try{localStorage.removeItem('tavarov-creator-view-v1')}catch{}}
$('change-wallet').addEventListener('click',()=>{if(saving||!confirmDiscard())return;toLogin()});
$('creator-network').addEventListener('change',async()=>{if(!recipient)return;const net=$('creator-network').value;if(saving||!confirmDiscard()){$('creator-network').value=recipient.net;return}if(session?.kind==='non'){const mine=session.addresses[familyOf(net)];if(!mine){$('creator-network').value=recipient.net;notify(errorText(failure('no_network_address')),true);return}await activate(mine,net,session);return}
 const old=recipient;if((net==='solana')!==(old.net==='solana')){
  // MetaMask and Phantom each have addresses on one side only, and a viewed address belongs to one side: say so instead of silently resetting.
  const why=session?.kind==='evm'?'MetaMask works on BNB Chain, Ethereum and Base. To see Solana, connect Phantom, or NoN Wallet for all networks at once.':session?.kind==='sol'?'Phantom works on Solana only. For BNB Chain, Ethereum and Base, connect MetaMask, or NoN Wallet for all networks at once.':'This address is for a different network. Enter an address for the selected network.';
  toLogin();$('creator-network').value=net;if(!session&&why.startsWith('This address')){const d=document.querySelector('details.view-address');if(d)d.open=true}notify(t(why),true);return}
 await activate(old.address,net,session)});
for(const id of ['creator-greeting','creator-goal-title','creator-goal-target'])$(id).addEventListener('input',()=>{dirty=true;notify('',false,'profile-status')});
$('page-settings').addEventListener('submit',event=>{event.preventDefault();saveProfile(false)});$('restart-goal').addEventListener('click',()=>saveProfile(true));
$('refresh-dashboard').addEventListener('click',loadDashboard);$('refresh-history').addEventListener('click',loadDashboard);
for(const id of ['obs-min','obs-duration','obs-sound','obs-message'])$(id).addEventListener('change',()=>{const settings=currentObs();$('obs-min').value=String(settings.min);try{localStorage.setItem('tavarov.obs.v1',JSON.stringify(settings))}catch{}renderLinks()});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const input=$(button.dataset.copy);try{await navigator.clipboard.writeText(input.value);notify(t('Copied.'))}catch{input.focus();input.select();notify(t('Select and copy the link.'))}}));
$('site-language').addEventListener('change',()=>{translateDialog();renderLinks();renderProfile();if(recipient)loadDashboard()});
try{const settings=obsSettings(JSON.parse(localStorage.getItem('tavarov.obs.v1')||'{}'));$('obs-min').value=settings.min;$('obs-duration').value=settings.d;$('obs-sound').checked=settings.snd;$('obs-message').checked=settings.msg;const saved=JSON.parse(localStorage.getItem('tavarov-creator-view-v1')||'null');if(saved&&validAddress(saved.net,saved.address))activate(saved.address,saved.net)}catch{}
