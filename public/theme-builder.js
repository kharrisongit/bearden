'use strict';
// Three independent colors, with derived surface/text shades for both modes.
// Restore before paint; never persist financial data with appearance settings.
(() => {
  const root=document.documentElement,key='bearden:custom-theme',schemeKey='bearden:classic:color-scheme';
  const defaults={surface:'#486fa2',button:'#2056a0',accent:'#2f7d8b'};
  const valid=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  let colors={...defaults},remembered=true;
  try{const saved=JSON.parse(localStorage.getItem(key));for(const part of Object.keys(colors))if(valid(saved?.[part]))colors[part]=saved[part].toLowerCase();}catch{}
  const rgb=hex=>hex.slice(1).match(/../g).map(n=>parseInt(n,16));
  const hex=values=>'#'+values.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
  const mix=(a,b,t)=>hex(rgb(a).map((n,i)=>n+(rgb(b)[i]-n)*t));
  const lum=color=>rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((s,n,i)=>s+n*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  const readable=(color,backgrounds,dark)=>{
    for(let i=0;i<=100;i++){const candidate=mix(color,dark?'#ffffff':'#000000',i/100);if(backgrounds.every(bg=>contrast(candidate,bg)>=4.5))return candidate;}
    return dark?'#ffffff':'#000000';
  };
  let applied=[];
  function palette(){
    const dark=root.dataset.theme==='dark',s=colors.surface,b=colors.button,a=colors.accent;
    const paper=mix(s,dark?'#080d16':'#ffffff',dark?.85:.90),card=mix(s,dark?'#101824':'#ffffff',dark?.78:.98);
    const inset=mix(s,dark?'#0b111d':'#ffffff',dark?.82:.94),soft=mix(a,dark?'#101824':'#ffffff',dark?.82:.92);
    const ink=dark?'#f6f8fc':'#142033',muted=dark?'#c7d1df':'#48566a',line=mix(s,dark?'#b9c9df':'#ffffff',dark?.45:.65);
    const header=mix(s,'#07101e',.78),accent=readable(a,[paper,card,inset,soft],dark);
    const onButton=contrast('#ffffff',b)>=4.5?'#ffffff':'#000000';
    return {ink,muted,paper,card,line,accent,'accent-fill':b,'on-accent':onButton,'accent-soft':soft,'accent-line':line,
      'surface-inset':inset,'surface-subtle':inset,'amount-line':line,header,'hero-debt':header,'hero-savings':header,
      'on-dark':'#ffffff','on-dark-muted':'#dbe5f3','on-dark-accent':'#dbe5f3','on-dark-line':line,'on-dark-hover':mix(header,'#ffffff',.08),'on-dark-disabled':header,
      'theme-gradient':`linear-gradient(125deg,${header},${mix(header,'#000000',.18)})`,
      'den-tracker':`linear-gradient(125deg,${header},${mix(header,'#000000',.18)})`,'den-summary':soft,'den-income':soft,'den-blue':a,
      'amount-bg':inset,'amount-ink':ink,'amount-label':muted,'amount-border':line,'custom-accent':a,'custom-button':b,'custom-on-button':onButton};
  }
  function apply(){
    if(root.dataset.colorScheme!=='custom'){for(const name of applied)root.style.removeProperty('--'+name);applied=[];return;}
    const tokens=palette();for(const [name,value]of Object.entries(tokens))root.style.setProperty('--'+name,value);applied=Object.keys(tokens);
  }
  try{if(localStorage.getItem(schemeKey)==='custom')root.dataset.colorScheme='custom';}catch{}
  apply();
  new MutationObserver(apply).observe(root,{attributes:true,attributeFilter:['data-color-scheme','data-theme']});
  document.addEventListener('DOMContentLoaded',()=>{
    const $=id=>document.getElementById(id),dialog=$('colorPickerDialog');if(!dialog)return;
    const tabs=[...dialog.querySelectorAll('[data-theme-tab]')],targets=[...dialog.querySelectorAll('[data-theme-target]')];
    let target='surface',hsv={h:0,s:0,v:0};
    const toHSV=color=>{const [r,g,b]=rgb(color).map(n=>n/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=d===0?0:max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;return {h:(h*60+360)%360,s:max?d/max*100:0,v:max*100};};
    const fromHSV=({h,s,v})=>{s/=100;v/=100;const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;return hex((h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x]).map(n=>(n+m)*255));};
    function selectTab(name,focus=false){
      for(const tab of tabs){const active=tab.dataset.themeTab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;if(active&&focus)tab.focus();}
    }
    for(const tab of tabs){tab.onclick=()=>selectTab(tab.dataset.themeTab);tab.onkeydown=event=>{const i=tabs.indexOf(tab);let next;if(event.key==='ArrowRight')next=(i+1)%tabs.length;else if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next].dataset.themeTab,true);};}
    function sync(){
      for(const button of targets){button.setAttribute('aria-pressed',String(button.dataset.themeTarget===target));button.querySelector('i').style.background=colors[button.dataset.themeTarget];}
      $('themeColorField').style.setProperty('--hue',hsv.h);
      $('themeColorField').setAttribute('aria-label',`${target==='button'?'Button':target[0].toUpperCase()+target.slice(1)} color field, ${colors[target]}`);
      $('themeColorMarker').style.left=hsv.s+'%';$('themeColorMarker').style.top=(100-hsv.v)+'%';
      for(const [name,part,suffix]of [['Hue','h','°'],['Saturation','s','%'],['Brightness','v','%']]){$('theme'+name).value=Math.round(hsv[part]);$('theme'+name+'Value').value=Math.round(hsv[part])+suffix;}
      $('themeHex').value=colors[target];$('themeHex').setCustomValidity('');$('themeNativeColor').value=colors[target];
      const preview=dialog.querySelector('.theme-preview'),p=palette();preview.style.background=p['accent-soft'];preview.style.color=p.ink;preview.style.setProperty('--preview-accent',p.accent);preview.style.setProperty('--preview-button',colors.button);preview.style.setProperty('--preview-on-button',p['on-accent']);
      $('applyCustomTheme').textContent=root.dataset.colorScheme==='custom'?'Custom theme applied':'Use custom theme';
    }
    function activate(){
      root.dataset.colorScheme='custom';apply();remembered=true;
      try{localStorage.setItem(key,JSON.stringify(colors));localStorage.setItem(schemeKey,'custom');}catch{remembered=false;}
      sync();window.dispatchEvent(new CustomEvent('bearden-custom-theme',{detail:{remembered}}));
      if(!remembered)$('colorPickerStatus').textContent='Custom theme applied, but this browser could not remember the preference.';
    }
    function commit(){colors[target]=fromHSV(hsv);activate();}
    for(const button of targets)button.onclick=()=>{target=button.dataset.themeTarget;hsv=toHSV(colors[target]);sync();};
    for(const [name,part]of [['Hue','h'],['Saturation','s'],['Brightness','v']])$('theme'+name).oninput=event=>{hsv[part]=Number(event.target.value);commit();};
    function exact(value){if(!valid(value))return false;colors[target]=value.toLowerCase();hsv=toHSV(value);activate();return true;}
    $('themeHex').oninput=event=>{if(!exact(event.target.value))event.target.setCustomValidity('Enter a six-digit hex color, such as #2056a0.');};
    $('themeHex').onchange=event=>{if(!exact(event.target.value))event.target.reportValidity();};
    $('themeNativeColor').oninput=event=>exact(event.target.value);
    const field=$('themeColorField');
    function point(event){const r=field.getBoundingClientRect();hsv.s=Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100));hsv.v=Math.max(0,Math.min(100,100-(event.clientY-r.top)/r.height*100));commit();}
    field.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();field.focus({preventScroll:true});field.setPointerCapture(event.pointerId);point(event);};
    field.onpointermove=event=>{if(field.hasPointerCapture(event.pointerId))point(event);};
    field.onpointerup=event=>{if(field.hasPointerCapture(event.pointerId)){point(event);field.releasePointerCapture(event.pointerId);}};
    field.onkeydown=event=>{const step=event.shiftKey?10:1;if(event.key==='ArrowRight')hsv.s+=step;else if(event.key==='ArrowLeft')hsv.s-=step;else if(event.key==='ArrowUp')hsv.v+=step;else if(event.key==='ArrowDown')hsv.v-=step;else return;event.preventDefault();hsv.s=Math.max(0,Math.min(100,hsv.s));hsv.v=Math.max(0,Math.min(100,hsv.v));commit();};
    $('applyCustomTheme').onclick=activate;
    function selectedTab(){if(root.dataset.holiday&&!root.dataset.colorScheme)dialog.querySelector('.theme-holidays').open=true;const selected=dialog.querySelector('[data-color-scheme-choice="'+(root.dataset.colorScheme||'')+'"]');selectTab(root.dataset.colorScheme==='custom'?'custom':selected?.closest('#themePanel-gradients')?'gradients':'presets');}
    // Reveal the active panel before the original opener restores focus.
    $('openColorPicker').addEventListener('click',()=>{selectedTab();hsv=toHSV(colors[target]);sync();},true);
    new MutationObserver(()=>{sync();if(dialog.open)selectedTab();}).observe(root,{attributes:true,attributeFilter:['data-theme','data-color-scheme']});
    window.addEventListener('storage',event=>{
      if(event.key!==key&&event.key!==schemeKey)return;
      try{const saved=JSON.parse(localStorage.getItem(key));for(const part of Object.keys(colors))if(valid(saved?.[part]))colors[part]=saved[part].toLowerCase();if(localStorage.getItem(schemeKey)==='custom')root.dataset.colorScheme='custom';}catch{}
      apply();hsv=toHSV(colors[target]);sync();
    });
    hsv=toHSV(colors[target]);sync();selectedTab();
  });
})();
