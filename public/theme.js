(function(){
  const key='clearway-theme';
  const saved=localStorage.getItem(key);
  const system=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  const apply=t=>{document.documentElement.dataset.theme=t; localStorage.setItem(key,t); document.dispatchEvent(new CustomEvent('clearway:theme',{detail:t}));};
  apply(saved||system);
  function mount(){
    if(document.querySelector('.theme-toggle')) return;
    const host=document.querySelector('.d-topbar .topbar-actions')||document.querySelector('.d-topbar')||document.body;
    const wrap=document.createElement('div'); wrap.className='theme-toggle-wrap';
    wrap.innerHTML='<button class="theme-toggle" type="button" aria-label="Switch theme" title="Switch light/dark theme"><span class="theme-icon sun">☼</span><span class="theme-track"><span class="theme-knob"></span></span><span class="theme-icon moon">☾</span></button>';
    host.appendChild(wrap);
    const btn=wrap.firstElementChild;
    const sync=()=>{const light=document.documentElement.dataset.theme==='light';btn.classList.toggle('is-light',light);btn.setAttribute('aria-pressed',String(light));btn.title=light?'Switch to dark theme':'Switch to light theme'};
    btn.onclick=()=>apply(document.documentElement.dataset.theme==='light'?'dark':'light');
    document.addEventListener('clearway:theme',sync); sync();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
