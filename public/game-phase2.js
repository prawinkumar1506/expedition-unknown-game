(function(){
  const stageNames=['Archive Reconstruction','Manual Override','Feature Hunt','Quality Lab','Forecast'];
  const stageKeys=['event1','manual','features','quality','forecast'];
  let previousStage=null;
  function workspace(){return document.querySelector('#workspace')}
  function currentStage(){
    const active=document.querySelector('[data-stage].active,[data-stage].is-active');
    if(active?.dataset.stage) return active.dataset.stage;
    const text=document.querySelector('#mission-status')?.textContent||'';
    return stageKeys.find((_,i)=>text.toLowerCase().includes(stageNames[i].toLowerCase().split(' ')[0]))||stageKeys[0];
  }
  function hud(){
    const box=workspace(); if(!box) return;
    const existing=document.querySelector('.clearway-hud');
    if(existing) return;
    const h=document.createElement('div'); h.className='clearway-hud';
    h.innerHTML='<span class="hud-label">RESTORATION PROGRESS</span><div class="hud-track"><div class="hud-fill"></div></div><span class="hud-step"></span>';
    box.parentElement?.insertBefore(h,box);
    updateHud();
  }
  function updateHud(){
    const h=document.querySelector('.clearway-hud'); if(!h) return;
    const key=currentStage(), idx=Math.max(0,stageKeys.indexOf(key));
    const pct=Math.round((idx/(stageKeys.length-1))*100);
    h.querySelector('.hud-fill').style.width=pct+'%';
    h.querySelector('.hud-step').textContent=`EVENT ${idx+1} / ${stageKeys.length} · ${stageNames[idx]}`;
  }
  function animateStage(){
    const box=workspace(); if(!box) return;
    const now=currentStage();
    if(previousStage!==null && now!==previousStage){
      box.classList.remove('phase-enter'); void box.offsetWidth; box.classList.add('phase-enter');
      document.body.classList.remove('clearway-stage-change'); void document.body.offsetWidth; document.body.classList.add('clearway-stage-change');
      setTimeout(()=>document.body.classList.remove('clearway-stage-change'),500);
    }
    previousStage=now; updateHud();
  }
  function ripple(e){
    const button=e.target.closest('button:not(:disabled)'); if(!button||!workspace()?.contains(button)) return;
    const r=document.createElement('span'); r.className='clearway-ripple';
    const rect=button.getBoundingClientRect(); r.style.left=(e.clientX-rect.left)+'px'; r.style.top=(e.clientY-rect.top)+'px'; button.appendChild(r); setTimeout(()=>r.remove(),600);
  }
  function selectionPing(e){
    const target=e.target.closest('.pick.feature,.model,.class-grid button,.tool-catalog>button'); if(!target||target.disabled) return;
    target.animate([{filter:'brightness(1)'},{filter:'brightness(1.3)'},{filter:'brightness(1)'}],{duration:260,easing:'ease-out'});
  }
  function init(){
    hud(); animateStage();
    document.addEventListener('click',ripple,true); document.addEventListener('click',selectionPing,true);
    const obs=new MutationObserver(()=>{hud(); animateStage()});
    const root=document.querySelector('#workspace')||document.body; obs.observe(root,{childList:true,subtree:true});
    setInterval(updateHud,1000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();

// Keep the matrix readable while scanning large channel sets: highlight the active row/column.
document.addEventListener('mouseover', event => {
  const cell = event.target.closest('.matrix-table td');
  if (!cell) return;
  const table = cell.closest('.matrix-table');
  table.querySelectorAll('.matrix-hover-row,.matrix-hover-col').forEach(el => el.classList.remove('matrix-hover-row','matrix-hover-col'));
  const row = cell.closest('tr');
  if (row) row.classList.add('matrix-hover-row');
  const col = cell.dataset.col;
  if (col !== undefined) table.querySelectorAll(`td[data-col="${col}"], th:nth-child(${Number(col)+2})`).forEach(el => el.classList.add('matrix-hover-col'));
});
document.addEventListener('mouseout', event => {
  if (!event.target.closest('.matrix-table')) return;
  if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.matrix-table')) return;
  document.querySelectorAll('.matrix-hover-row,.matrix-hover-col').forEach(el => el.classList.remove('matrix-hover-row','matrix-hover-col'));
});


// Evidence viewer: open the selected analysis result in a large, focused overlay.
(function(){
  let backdrop = null;
  function ensureViewer(){
    if(backdrop) return backdrop;
    backdrop=document.createElement('div');
    backdrop.className='clearway-evidence-backdrop';
    backdrop.innerHTML=`<div class="clearway-evidence-modal" role="dialog" aria-modal="true" aria-label="Expanded analysis evidence">
      <div class="clearway-evidence-head"><div><strong>Expanded analysis</strong><span>    click outside or press Escape to close</span></div><button class="clearway-evidence-close" type="button" aria-label="Close expanded analysis">×</button></div>
      <div class="clearway-evidence-body"></div>
    </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', e=>{
      if(e.target===backdrop || e.target.closest('.clearway-evidence-close')) closeViewer();
    });
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeViewer(); });
    return backdrop;
  }
  function closeViewer(){
    if(!backdrop) return;
    backdrop.classList.remove('is-open');
    document.body.style.overflow='';
  }
  function openViewer(source){
    const b=ensureViewer();
    const body=b.querySelector('.clearway-evidence-body');
    const clone=source.cloneNode(true);
    clone.querySelectorAll('button,select,input').forEach(el=>el.setAttribute('tabindex','-1'));
    body.replaceChildren(clone);
    b.classList.add('is-open');
    document.body.style.overflow='hidden';
    b.querySelector('.clearway-evidence-close')?.focus();
  }
  document.addEventListener('click', e=>{
    const finding=e.target.closest('.findings .finding');
    if(!finding) return;
    if(e.target.closest('button,select,input,a')) return;
    openViewer(finding);
  });
})();
