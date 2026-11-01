import {NETWORKS,validRecipient,donationLinks} from './donate-core.mjs';
const byId=id=>document.getElementById(id),form=byId('donation-setup'),network=byId('donation-network'),address=byId('donation-address');
const t=value=>window.tavarovText?.(value)||value;
const result=byId('donation-result'),error=byId('address-error');let recipient=null;
function render(){
 if(!recipient)return;
 const links=donationLinks(recipient.network,recipient.address,document.documentElement.lang);
 byId('donation-link').value=links.tip;byId('open-donation-page').href=links.tip;
 byId('donation-alert-link').value=links.alert;byId('preview-alert').href=links.preview;
 byId('donation-recipient').textContent=NETWORKS[recipient.network]+' · '+recipient.address;
 byId('alerts-empty').hidden=true;byId('alerts-ready').hidden=false;
}
function showError(){
 error.textContent=t('Enter a valid wallet address for the selected network.');error.hidden=false;
 address.setAttribute('aria-invalid','true');address.focus();
}
form.addEventListener('submit',event=>{
 event.preventDefault();const value=address.value.trim();
 if(!validRecipient(network.value,value)){showError();return}
 recipient={network:network.value,address:value};address.value=value;
 error.hidden=true;address.removeAttribute('aria-invalid');render();form.hidden=true;result.hidden=false;
 try{localStorage.setItem('tavarov-donate-recipient-v1',JSON.stringify(recipient))}catch{}
 byId('link-ready').focus();
});
byId('edit-donation-wallet').addEventListener('click',()=>{result.hidden=true;form.hidden=false;address.focus()});
async function copy(id){
 const input=byId(id);try{await navigator.clipboard.writeText(input.value);byId('donate-status').textContent=t('Copied.')}catch{input.focus();input.select();byId('donate-status').textContent=t('Select and copy the link.')} 
}
byId('copy-donation-link').addEventListener('click',()=>copy('donation-link'));
byId('copy-alert-link').addEventListener('click',()=>copy('donation-alert-link'));
byId('site-language')?.addEventListener('change',()=>{render();if(!error.hidden)error.textContent=t('Enter a valid wallet address for the selected network.');byId('donate-status').textContent=''});
address.addEventListener('input',()=>{error.hidden=true;address.removeAttribute('aria-invalid')});
const revealAlerts=()=>{if(location.hash==='#stream-alerts')byId('stream-alerts').open=true};
window.addEventListener('hashchange',revealAlerts);revealAlerts();
try{const saved=JSON.parse(localStorage.getItem('tavarov-donate-recipient-v1')||'null');if(saved&&validRecipient(saved.network,saved.address)){recipient=saved;network.value=saved.network;address.value=saved.address;render();form.hidden=true;result.hidden=false}}catch{}
