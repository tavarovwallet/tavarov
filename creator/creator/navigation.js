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
