const text=value=>window.tavarovText?.(value)||value;
const productMenus=[...document.querySelectorAll('.product-menu')];
const closeProducts=except=>productMenus.forEach(menu=>{if(menu!==except)menu.open=false});
const nav=document.getElementById('main-nav'),menuToggle=document.querySelector('.menu-toggle');
const closeNavigation=()=>{closeProducts();nav?.classList.remove('open');menuToggle?.setAttribute('aria-expanded','false')};
menuToggle?.addEventListener('click',()=>{const open=menuToggle.getAttribute('aria-expanded')!=='true';closeProducts();nav?.classList.toggle('open',open);menuToggle.setAttribute('aria-expanded',String(open))});
productMenus.forEach(menu=>{
 menu.querySelector('summary').addEventListener('click',()=>closeProducts(menu));
 menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeNavigation));
});
document.addEventListener('click',event=>{if(!event.target.closest('.nav'))closeNavigation()});
document.addEventListener('focusin',event=>{if(!event.target.closest('.nav'))closeNavigation()});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const menu=productMenus.find(menu=>menu.open);if(menu){closeProducts();menu.querySelector('summary').focus()}else if(menuToggle?.getAttribute('aria-expanded')==='true'){closeNavigation();menuToggle.focus()}});
const dialog=document.querySelector('#film-dialog'),modalVideo=dialog?.querySelector('video');let filmOpener;
document.querySelectorAll('[data-film]').forEach(button=>button.addEventListener('click',()=>{filmOpener=button;dialog.querySelector('#film-title').textContent=text(button.dataset.title);dialog.querySelector('#film-caption').textContent=text(button.dataset.caption);modalVideo.src=button.dataset.film;modalVideo.poster=button.dataset.poster||'';dialog.showModal();document.body.style.overflow='hidden';modalVideo.play().catch(()=>{})}));
dialog?.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
dialog?.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
dialog?.addEventListener('close',()=>{modalVideo.pause();modalVideo.removeAttribute('src');modalVideo.load();document.body.style.overflow='';filmOpener?.focus()});
document.querySelectorAll('[data-inline-play]').forEach(button=>{const video=document.querySelector(button.dataset.inlinePlay);button.addEventListener('click',()=>{video.controls=true;video.play().catch(()=>{});video.focus()})});
document.querySelectorAll('[data-loop-toggle]').forEach(button=>{const video=document.querySelector(button.dataset.loopToggle);const sync=()=>{button.textContent=text(video.paused?'Play animation':'Pause animation');button.setAttribute('aria-label',text(video.paused?'Play payment animation':'Pause payment animation'))};button.addEventListener('click',()=>{if(video.paused)video.play().catch(()=>{});else video.pause()});video.addEventListener('play',sync);video.addEventListener('pause',sync);sync()});
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
document.querySelectorAll('video[data-auto]').forEach(video=>{if(!reduced){new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){video.play().catch(()=>{})}else video.pause()}},{threshold:.3}).observe(video)}});
const tabs=[...document.querySelectorAll('[role=tab]')];function activate(tab){for(const t of tabs){const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!on}}
tabs.forEach(tab=>{tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',e=>{let i=tabs.indexOf(tab);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=tabs.length-1;else return;e.preventDefault();activate(tabs[i]);tabs[i].focus()})});
