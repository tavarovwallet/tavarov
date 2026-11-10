(()=>{
const dictionaries=window.TAVAROV_TRANSLATIONS||{},valid=new Set(['en','ru','es','pt','tr','tg','id']);
const control=document.querySelector('#site-language');if(!control)return;
const params=new URLSearchParams(location.search);let stored;try{stored=localStorage.getItem('tavarov-site-language')}catch{}
let language=valid.has(params.get('lang'))?params.get('lang'):valid.has(stored)?stored:'en';
const nodes=[],attrs=[],links=[];const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:node=>!node.parentElement.closest('script,style,pre,code,select,dialog')&&node.textContent.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
while(walk.nextNode()){const node=walk.currentNode;nodes.push({node,original:node.textContent,key:node.textContent.trim()})}
document.querySelectorAll('[aria-label],img[alt],[placeholder]').forEach(node=>{for(const attr of ['aria-label','alt','placeholder']){if(node.hasAttribute(attr))attrs.push({node,attr,original:node.getAttribute(attr)})}});
document.querySelectorAll('a[href]').forEach(node=>links.push({node,original:node.getAttribute('href')}));
window.tavarovText=text=>dictionaries[language]?.[text]||text;
const originalTitle=document.title;
const titles={en:['Tavarov — Pay simply. Get paid simply.','Tavarov Pay — Crypto payments for your business','NoN Wallet — Your crypto. In your hands.'],ru:['Tavarov — Платить и получать оплату проще','Tavarov Pay — Криптоплатежи для вашего бизнеса','NoN Wallet — Ваша криптовалюта в ваших руках'],es:['Tavarov — Pagar y cobrar, más fácil','Tavarov Pay — Pagos cripto para tu negocio','NoN Wallet — Tu cripto en tus manos'],pt:['Tavarov — Pagar e receber, mais simples','Tavarov Pay — Pagamentos cripto para seu negócio','NoN Wallet — Sua cripto nas suas mãos'],tr:['Tavarov — Kolay ödeyin, kolay ödeme alın','Tavarov Pay — İşletmeniz için kripto ödemeler','NoN Wallet — Kriptonuz sizin elinizde'],tg:['Tavarov — Пардохт кардан ва гирифтан содатар','Tavarov Pay — Криптопардохтҳо барои тиҷорати шумо','NoN Wallet — Криптовалютаи шумо дар дасти шумо'],id:['Tavarov — Bayar dan dibayar jadi lebih mudah','Tavarov Pay — Pembayaran kripto untuk bisnis Anda','NoN Wallet — Kripto Anda. Di tangan Anda.']};
function apply(value,updateURL){language=valid.has(value)?value:'en';document.documentElement.lang=language;control.value=language;document.getElementById('current-language').textContent=language.toUpperCase();const t=window.tavarovText;
for(const {node,original,key}of nodes){const translated=t(key);node.textContent=translated===key?original:original.replace(key,translated)}
for(const {node,attr,original}of attrs)node.setAttribute(attr,t(original));
for(const {node,original}of links){if(!original||original.startsWith('#')||original.startsWith('mailto:'))continue;const u=new URL(original,location.href);if((u.origin===location.origin&&['/','/pay/','/wallet/','/pay','/wallet','/creators','/creators/','/fundraising','/fundraising/','/donate','/donate/'].includes(u.pathname))||u.hostname==='wallet.tavarov.com'){if(language==='en'&&u.origin===location.origin)u.searchParams.delete('lang');else u.searchParams.set('lang',language);node.href=u.href}}
const index=location.pathname.includes('/wallet')?2:location.pathname.includes('/pay')?1:0;document.title=/^\/(creators|fundraising|donate)(\/|$)/.test(location.pathname)?t(originalTitle):titles[language][index];
try{localStorage.setItem('tavarov-site-language',language)}catch{}
if(updateURL){const u=new URL(location.href);if(language==='en')u.searchParams.delete('lang');else u.searchParams.set('lang',language);history.replaceState(null,'',u)}
document.querySelectorAll('[data-loop-toggle]').forEach(button=>{const video=document.querySelector(button.dataset.loopToggle);button.textContent=t(video.paused?'Play animation':'Pause animation');button.setAttribute('aria-label',t(video.paused?'Play payment animation':'Pause payment animation'))});
}
control.addEventListener('change',()=>apply(control.value,true));apply(language,false);
})();
