
  // Applied synchronously, before the stylesheet paints, so there's no
  // flash of the wrong theme on load. Reads localStorage directly rather
  // than through the app's `storage` wrapper (defined later, and async)
  // since this needs to run immediately. Sets the data-theme attribute
  // for the shared stylesheet. The stylesheet owns all page colors.
  (function(){
    try {
      const saved = localStorage.getItem('bearden:classic:theme');
      if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
      const savedHoliday = localStorage.getItem('bearden:classic:holiday');
      if (savedHoliday === 'christmas' || savedHoliday === 'halloween') {
        document.documentElement.setAttribute('data-holiday', savedHoliday);
      }
      const color = localStorage.getItem('bearden:classic:color-scheme');
      if (['ocean','sapphire','violet','plum','rose','sunset','amber','forest','olive','slate'].includes(color)) {
        document.documentElement.setAttribute('data-color-scheme', color);
      }
    } catch (e) {}
  })();

// The color preference is independent of light/dark mode and holiday bears.
// Apply selections immediately and remember them on this device, as above.
document.addEventListener('DOMContentLoaded',()=>{
  const root=document.documentElement,dialog=document.getElementById('colorPickerDialog');
  const opener=document.getElementById('openColorPicker');
  if(!dialog||!opener)return;
  const swatches=[...dialog.querySelectorAll('[data-color-scheme-choice]')];
  const status=document.getElementById('colorPickerStatus');
  let remembered=true;
  function sync(){
    const current=root.getAttribute('data-color-scheme'),dark=root.getAttribute('data-theme')==='dark';
    const selected=swatches.find(button=>button.dataset.colorSchemeChoice===current);
    for(const button of swatches)button.setAttribute('aria-pressed',String(button===selected));
    for(const button of dialog.querySelectorAll('[data-color-mode]'))button.setAttribute('aria-pressed',String((button.dataset.colorMode==='dark')===dark));
    document.getElementById('resetColorScheme').setAttribute('aria-pressed',String(!selected));
    opener.classList.toggle('active',!!selected);
    status.textContent=(selected?selected.dataset.colorName:'Standard colors')+' · '+(dark?'Dark':'Light')+' mode'+(remembered?'':'. Applied, but this browser could not remember the preference.');
  }
  function select(value){
    if(value&&!swatches.some(button=>button.dataset.colorSchemeChoice===value))return;
    if(value)root.setAttribute('data-color-scheme',value);else root.removeAttribute('data-color-scheme');
    remembered=true;
    try{if(value)localStorage.setItem('bearden:classic:color-scheme',value);else localStorage.removeItem('bearden:classic:color-scheme');}catch{remembered=false;}
    sync();
  }
  opener.addEventListener('click',()=>{
    document.getElementById('holidayMenu')?.classList.remove('open');
    sync();if(!dialog.open)dialog.showModal();
    dialog.setAttribute('closedby','closerequest');
    (swatches.find(button=>button.getAttribute('aria-pressed')==='true')||swatches[0])?.focus({preventScroll:true});
  });
  dialog.addEventListener('click',event=>{
    const choice=event.target.closest('[data-color-scheme-choice]');
    if(choice&&dialog.contains(choice)){select(choice.dataset.colorSchemeChoice);return;}
    const mode=event.target.closest('[data-color-mode]');
    if(mode&&dialog.contains(mode)){
      const dark=root.getAttribute('data-theme')==='dark';
      if(dark!==(mode.dataset.colorMode==='dark'))window.toggleTheme?.();
      sync();
    }
  });
  document.getElementById('closeColorPicker').addEventListener('click',()=>dialog.close());
  document.getElementById('resetColorScheme').addEventListener('click',()=>select(null));
  document.getElementById('holidayItemStandard')?.addEventListener('click',()=>select(null));
  dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener('close',()=>document.getElementById('holidayToggleBtn')?.focus({preventScroll:true}));
  new MutationObserver(sync).observe(root,{attributes:true,attributeFilter:['data-theme','data-color-scheme']});
  window.addEventListener('storage',event=>{
    if(event.key!=='bearden:classic:color-scheme')return;
    const valid=swatches.some(button=>button.dataset.colorSchemeChoice===event.newValue);
    if(valid)root.setAttribute('data-color-scheme',event.newValue);else root.removeAttribute('data-color-scheme');
  });
  sync();
});
