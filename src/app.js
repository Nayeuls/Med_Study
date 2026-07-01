/* ============================================================
   Révisions Collèges — logique applicative
   Données : SEED (seed.js) = graine figée ; l'état vivant est
   chargé/sauvé via le serveur local (donnees.json). Fallback
   localStorage si ouvert sans serveur (file://).
   ============================================================ */

const LS_KEY = 'colleges_revision_v1';
const API = '/api/data';

/* Intervalles cibles par défaut (jours). Modifiables par l'utilisateur,
   stockés dans state.settings.intervals → conservés d'une version à l'autre. */
const DEFAULT_INTERVALS = {1:45, 2:25, 3:15, 4:8, 5:4};

const LEVELS = {
  1:{name:'Maîtrisé', color:getVar('--l1')},
  2:{name:'À consolider', color:getVar('--l2')},
  3:{name:'Intermédiaire', color:getVar('--l3')},
  4:{name:'Difficile', color:getVar('--l4')},
  5:{name:'Mal su', color:getVar('--l5')},
};
const IMP_ORDER={reference:0,cyan:1,gris:2,blanc:3};
const IMP_COLOR={reference:getVar('--imp-ref'),cyan:getVar('--imp-cyan'),gris:getVar('--imp-gris'),blanc:getVar('--imp-blanc')};
const IMP_LABEL={reference:'Référence',cyan:'Cyan',gris:'Gris',blanc:'Blanc'};
function getVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

/* ---------- état & persistance ---------- */
let state, persistOK=true, serverMode=false;

/* garantit la présence des réglages (migration douce des anciennes données) */
function migrate(st){
  if(!st || typeof st!=='object') st={chapters:[]};
  if(!Array.isArray(st.chapters)) st.chapters=[];
  if(!st.settings) st.settings={};
  if(!st.settings.intervals) st.settings.intervals={};
  for(let n=1;n<=5;n++){
    if(typeof st.settings.intervals[n]!=='number' || st.settings.intervals[n]<1)
      st.settings.intervals[n]=DEFAULT_INTERVALS[n];
  }
  return st;
}
function seedCopy(){ return migrate(JSON.parse(JSON.stringify(SEED))); }

async function load(){
  // 1) tenter le serveur local
  try{
    const r=await fetch(API,{cache:'no-store'});
    if(r.ok){
      serverMode=true;
      const txt=await r.text();
      if(txt && txt.trim()){
        const d=JSON.parse(txt);
        if(d && Array.isArray(d.chapters)) return migrate(d);
      }
      return seedCopy(); // fichier absent/vide → graine
    }
  }catch(e){ /* pas de serveur : on est en file:// */ }
  // 2) fallback navigateur (ouverture directe du HTML)
  serverMode=false;
  try{ const s=localStorage.getItem(LS_KEY); if(s) return migrate(JSON.parse(s)); }catch(e){}
  return seedCopy();
}

let saveTimer=null, pendingSave=false;
function save(){
  if(serverMode){
    pendingSave=true;
    clearTimeout(saveTimer);
    saveTimer=setTimeout(pushToServer,250);
  }else{
    try{ localStorage.setItem(LS_KEY,JSON.stringify(state)); persistOK=true; }
    catch(e){ persistOK=false; }
    updatePersistNote();
  }
}
async function pushToServer(){
  try{
    const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});
    persistOK=r.ok; pendingSave=false;
  }catch(e){ persistOK=false; }
  updatePersistNote();
}
function updatePersistNote(){
  document.getElementById('persistNote').style.display = persistOK?'none':'block';
}
// filet de sécurité : flush avant fermeture si une sauvegarde était en attente
window.addEventListener('beforeunload',()=>{
  if(serverMode && pendingSave){
    try{ navigator.sendBeacon(API,new Blob([JSON.stringify(state)],{type:'application/json'})); }catch(e){}
  }
});

/* ---------- helpers ---------- */
const today=()=>new Date(new Date().toISOString().slice(0,10));
function daysBetween(iso){ if(!iso) return null; const d=new Date(iso); return Math.round((today()-d)/86400000); }
function datedSessions(ch){ return ch.sessions.filter(s=>s.date).sort((a,b)=>a.date<b.date?-1:1); }
function lastDated(ch){ const d=datedSessions(ch); return d.length?d[d.length-1]:null; }
function hasUnfinished(ch){ return ch.sessions.some(s=>s.enCours); }
function neverSeen(ch){ return datedSessions(ch).length===0; }
function getInterval(n){
  const iv=state&&state.settings&&state.settings.intervals&&state.settings.intervals[n];
  return (typeof iv==='number'&&iv>=1)?iv:DEFAULT_INTERVALS[n];
}
function score(ch){ const l=lastDated(ch); if(!l) return Infinity; const lvl=l.niveau||3; const iv=getInterval(lvl); const dd=daysBetween(l.date); return dd/iv; }
function remarks(ch){ return ch.sessions.filter(s=>s.remarque&&s.remarque.trim())
   .sort((a,b)=>((b.date||'')<(a.date||'')?-1:1)); }
function fmtDate(iso){ if(!iso) return '—'; const [y,m,d]=iso.split('-'); return d+'/'+m+'/'+y.slice(2); }
function uid(){ return 'c'+Math.random().toString(36).slice(2,9); }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),1800); }

/* popup de confirmation intégré (remplace confirm() natif). Renvoie une Promise<bool>.
   Entrée = valider, Échap / clic hors du cadre / Annuler = refuser. */
function confirmDialog(text, sub, okLabel){
  okLabel = okLabel || 'Supprimer';
  return new Promise(resolve=>{
    const ov=document.createElement('div'); ov.className='modal-ov';
    ov.innerHTML=`<div class="modal" role="dialog" aria-modal="true">
      <div class="modal-t">${esc(text)}</div>
      ${sub?`<div class="modal-sub">${esc(sub)}</div>`:''}
      <div class="modal-btns">
        <button class="btn" data-no>Annuler</button>
        <button class="btn danger" data-yes>${esc(okLabel)}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close=(v)=>{ ov.remove(); document.removeEventListener('keydown',onKey); resolve(v); };
    const onKey=e=>{ if(e.key==='Escape') close(false); else if(e.key==='Enter') close(true); };
    ov.querySelector('[data-no]').onclick=()=>close(false);
    ov.querySelector('[data-yes]').onclick=()=>close(true);
    ov.onclick=e=>{ if(e.target===ov) close(false); };
    document.addEventListener('keydown',onKey);
    ov.querySelector('[data-yes]').focus();
  });
}

/* ---------- onglets (work = tableau+révision fusionnés / stats) ---------- */
let curTab='work';
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  curTab=b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
  document.getElementById('tab-work').hidden=curTab!=='work';
  document.getElementById('tab-stats').hidden=curTab!=='stats';
  render();
});

/* ---------- colonne tableau ---------- */
let curSem='all', query='';
document.querySelectorAll('#semFilter button').forEach(b=>b.onclick=()=>{
  curSem=b.dataset.sem; document.querySelectorAll('#semFilter button').forEach(x=>x.classList.toggle('on',x===b)); renderTable();
});
document.getElementById('q').oninput=e=>{ query=e.target.value.toLowerCase().trim(); render(); };
document.getElementById('expandAll').onclick=()=>{document.querySelectorAll('#tableBody details').forEach(d=>d.open=true);};
document.getElementById('collapseAll').onclick=()=>{document.querySelectorAll('#tableBody details').forEach(d=>d.open=false);};

/* filtre d'importance partagé (tableau + révision + stats), désactivé par défaut.
   Les cases (classe .inclSecondary) sont synchronisées ; les chapitres non-référence
   restent dans les données, ils sont seulement masqués/écartés de l'affichage. */
let includeSecondary=false;
function setIncludeSecondary(v){
  includeSecondary=v;
  document.querySelectorAll('.inclSecondary').forEach(cb=>{ cb.checked=v; });
  render();
}
document.querySelectorAll('.inclSecondary').forEach(cb=>cb.onchange=e=>setIncludeSecondary(e.target.checked));
// bascule d'affichage de la sidebar
document.getElementById('sideHide').onclick=()=>document.getElementById('workspace').classList.add('sidehidden');
document.getElementById('sideToggle').onclick=()=>document.getElementById('workspace').classList.remove('sidehidden');

const SEMS=['SEMESTRE 1','SEMESTRE 2','SEMESTRE 3','SEMESTRE 4'];
function chapMatches(ch){
  if(!includeSecondary && ch.importance!=='reference') return false;
  if(curSem!=='all'&&ch.semestre!==curSem) return false;
  if(query){ const hay=(ch.titre+' '+ch.college+' '+ch.sessions.map(s=>s.remarque||'').join(' ')).toLowerCase(); if(!hay.includes(query)) return false; }
  return true;
}
function renderTable(){
  const body=document.getElementById('tableBody');
  const list=state.chapters.filter(chapMatches);
  document.getElementById('tableCount').textContent=list.length+' chapitre'+(list.length>1?'s':'');
  // group by semestre then college, keep original order
  const groups=[]; const idx={};
  for(const ch of list){
    const key=ch.semestre+'||'+ch.college;
    if(!(key in idx)){ idx[key]=groups.length; groups.push({sem:ch.semestre,college:ch.college,color:ch.collegeColor,items:[]}); }
    groups[idx[key]].items.push(ch);
  }
  body.innerHTML = groups.length? groups.map(g=>collegeBlock(g)).join('') : '<div class="empty">Aucun chapitre ne correspond.</div>';
  bindTable();
}
function collegeBlock(g){
  const cbar = g.color? '#'+g.color : 'var(--line-strong)';
  return `<details class="college" ${query?'open':''}>
    <summary>
      <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M9 6l6 6-6 6"/></svg>
      <span class="cbar" style="background:${cbar}"></span>
      <span class="cname">${esc(g.college)}</span>
      <span class="csem">${g.sem.replace('SEMESTRE','S')}</span>
      <span class="ccount">${g.items.length} chap.</span>
    </summary>
    <div class="rows">${g.items.map(chapterRow).join('')}</div>
  </details>`;
}
function chapterRow(ch){
  const rs=remarks(ch);
  const l=lastDated(ch);
  const strip=ch.sessions.map((s,i)=>sessionSquare(ch,i,s)).join('') || '<span class="nosess">aucune session</span>';
  const lastCell = l? `${fmtDate(l.date)} ${lvlChip(l.niveau)}` : (hasUnfinished(ch)?'<span style="color:var(--muted)">en cours…</span>':'<span style="color:var(--faint)">jamais révisé</span>');
  return `<div class="chapter" data-ch="${ch.id}">
    <div class="crow" title="Cliquer pour développer / réduire">
      <span class="imp" title="${IMP_LABEL[ch.importance]}"><span class="dot-imp" style="background:${IMP_COLOR[ch.importance]}"></span></span>
      <div class="ctitle"><span class="t">${esc(ch.titre)}</span></div>
      <div class="strip">${strip}</div>
      <div class="cell-last">${lastCell}</div>
      <div class="cell-rem">${remarksBlock(rs)}</div>
    </div>
    <div class="detail" hidden></div>
  </div>`;
}
function sessionSquare(ch,i,s){
  const cls=s.enCours?'sq enc':(s.niveau?'sq':'sq none');
  const bg=s.niveau?`background:${LEVELS[s.niveau].color}`:'';
  const tip=`${fmtDate(s.date)}${s.niveau?' · '+LEVELS[s.niveau].name:''}${s.enCours?' · non terminée':''}${s.remarque?' · '+s.remarque:''}`;
  return `<span class="${cls}" style="${bg}" title="${esc(tip)}" data-sess="${ch.id}:${i}"></span>`;
}
function lvlChip(lvl){ if(!lvl) return ''; return `<span class="lvlchip" style="background:${LEVELS[lvl].color}">${lvl}</span>`; }
function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* affichage des remarques : dernière visible + badge ＊N dépliant toutes les remarques.
   Réutilisé dans le tableau et dans la sidebar de révision. */
function remListHTML(rs){
  return `<div class="allrem" hidden>${rs.map(r=>`<div class="aremitem"><span class="aremdate">${r.date?fmtDate(r.date):'—'}</span>${esc(r.remarque)}</div>`).join('')}</div>`;
}
function remarksBlock(rs){
  if(!rs.length) return '<span style="color:var(--faint)">—</span>';
  const more = rs.length>1 ? `<button class="star" data-remmore>＊${rs.length}</button>${remListHTML(rs)}` : '';
  return `<span class="rtext">${esc(rs[0].remarque)}</span>${more}`;
}
function bindRemMore(root){
  root.querySelectorAll('[data-remmore]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const box=b.parentElement.querySelector('.allrem'); if(box) box.hidden=!box.hidden;
  });
}

function bindTable(){
  const body=document.getElementById('tableBody');
  // toute la ligne est cliquable pour développer / réduire le chapitre
  body.querySelectorAll('.crow').forEach(row=>{
    row.onclick=()=>openDetail(row.closest('.chapter').dataset.ch,false);
  });
  bindRemMore(body); // le badge ＊N gère son propre clic (stopPropagation)
}
function chapById(id){ return state.chapters.find(c=>c.id===id); }
function openDetail(id,addNew){
  const chEl=document.querySelector(`.chapter[data-ch="${id}"]`); if(!chEl) return;
  const d=chEl.querySelector('.detail');
  if(!d.hidden && !addNew){ d.hidden=true; d.innerHTML=''; return; }
  d.hidden=false;
  const ch=chapById(id);
  d.innerHTML = detailHTML(ch);
  bindDetail(ch,d);
  if(addNew) addSession(ch,d);
}
function detailHTML(ch){
  const sess=ch.sessions.map((s,i)=>sessEditRow(ch,i,s,i===ch.sessions.length-1)).join('') || '<div class="empty" style="padding:6px">Aucune session — ajoute la première.</div>';
  return `<div class="sesslist">${sess}</div>
    <button class="btn mini accent" data-newsess>+ Ajouter une session</button>
    <div class="metaedit">
      <label>Titre du chapitre<input data-mtitle value="${esc(ch.titre)}" size="30"></label>
      <label>Importance<select data-mimp>${['reference','cyan','gris','blanc'].map(k=>`<option value="${k}" ${ch.importance===k?'selected':''}>${IMP_LABEL[k]}</option>`).join('')}</select></label>
      <label>Collège<input data-mcoll value="${esc(ch.college)}" size="18"></label>
      <label>Semestre<select data-msem>${SEMS.map(s=>`<option ${ch.semestre===s?'selected':''}>${s}</option>`).join('')}</select></label>
      <button class="btn mini" data-savemeta>Enregistrer</button>
      <button class="btn mini" data-delchap style="margin-left:auto;color:var(--l5);border-color:#f0caca">Supprimer le chapitre</button>
    </div>`;
}
function sessEditRow(ch,i,s,isLast){
  // « en cours » n'a de sens que pour la dernière session : les précédentes
  // sont forcément terminées (une session suivante existe).
  const encBtn = isLast
    ? `<button class="encbtn ${s.enCours?'on':''}" data-se title="marquer comme commencée / non terminée">en cours</button>`
    : '';
  return `<div class="sessrow" data-i="${i}">
    <input type="date" value="${s.date||''}" data-sd>
    <div class="lvlpick">${[1,2,3,4,5].map(l=>`<div class="p ${s.niveau===l?'sel':''}" data-sl="${l}" style="background:${LEVELS[l].color}" title="${LEVELS[l].name}"></div>`).join('')}<div class="p ${!s.niveau?'sel':''}" data-sl="0" style="background:#fff" title="aucun niveau"></div></div>
    <input class="rem" placeholder="remarque…" value="${esc(s.remarque||'')}" data-sr>
    <div style="display:flex;gap:6px;align-items:center">
      ${encBtn}
      <button class="del" data-sx title="supprimer">✕</button>
    </div>
  </div>`;
}
function bindDetail(ch,d){
  d.querySelectorAll('.sessrow').forEach(row=>{
    const i=+row.dataset.i;
    row.querySelector('[data-sd]').onchange=e=>{ch.sessions[i].date=e.target.value||null;commit();};
    row.querySelectorAll('[data-sl]').forEach(p=>p.onclick=()=>{ch.sessions[i].niveau=+p.dataset.sl||null;commit();refreshDetail(ch,d);});
    row.querySelector('[data-sr]').onchange=e=>{ch.sessions[i].remarque=e.target.value;commit();};
    const se=row.querySelector('[data-se]'); // présent uniquement sur la dernière session
    if(se) se.onclick=()=>{ch.sessions[i].enCours=!ch.sessions[i].enCours;commit();refreshDetail(ch,d);};
    row.querySelector('[data-sx]').onclick=()=>{ch.sessions.splice(i,1);commit();refreshDetail(ch,d);};
  });
  d.querySelector('[data-newsess]').onclick=()=>addSession(ch,d);
  d.querySelector('[data-savemeta]').onclick=()=>{
    ch.titre=d.querySelector('[data-mtitle]').value;
    ch.importance=d.querySelector('[data-mimp]').value;
    ch.college=d.querySelector('[data-mcoll]').value;
    ch.semestre=d.querySelector('[data-msem]').value;
    commit(); toast('Chapitre enregistré'); render();
  };
  d.querySelector('[data-delchap]').onclick=async()=>{
    const ok=await confirmDialog('Supprimer ce chapitre et toutes ses sessions ?', '« '+ch.titre+' »');
    if(ok){ state.chapters=state.chapters.filter(c=>c!==ch); commit(); render(); toast('Chapitre supprimé'); }
  };
}
function addSession(ch,d){
  ch.sessions.forEach(s=>{s.enCours=false;}); // en ajouter une → les précédentes sont terminées
  ch.sessions.push({date:new Date().toISOString().slice(0,10),niveau:3,remarque:'',enCours:false});
  commit(); refreshDetail(ch,d);
}
function refreshDetail(ch,d){ d.innerHTML=detailHTML(ch); bindDetail(ch,d);
  // rafraîchit aussi la ligne visible du chapitre sans reconstruire tout le tableau
  const chEl=d.closest('.chapter'); const fresh=document.createElement('div'); fresh.innerHTML=chapterRow(ch);
  chEl.querySelector('.crow').replaceWith(fresh.querySelector('.crow')); bindTable();
}
// sauvegarde + met à jour la sidebar (toujours visible) sans casser les panneaux ouverts
function commit(){ save(); renderRevise(); }

/* ---------- sidebar « à réviser » ---------- */
document.getElementById('dayGoal').oninput=renderRevise;
// nombre de sessions terminées aujourd'hui (toutes importances confondues)
function sessionsDoneToday(){
  const t=new Date().toISOString().slice(0,10);
  let n=0;
  for(const ch of state.chapters) for(const s of ch.sessions) if(s.date===t && !s.enCours) n++;
  return n;
}
function renderRevise(){
  const goal=parseInt(document.getElementById('dayGoal').value)||0;
  const done=sessionsDoneToday();
  const remaining=Math.max(0, goal-done);
  const pool=state.chapters.filter(ch=>{
    if(!includeSecondary && ch.importance!=='reference') return false;
    if(query){ const hay=(ch.titre+' '+ch.college).toLowerCase(); if(!hay.includes(query)) return false; }
    return true;
  });
  const unfinished=pool.filter(hasUnfinished);
  const never=pool.filter(ch=>!hasUnfinished(ch)&&neverSeen(ch));
  const rest=pool.filter(ch=>!hasUnfinished(ch)&&!neverSeen(ch)).sort((a,b)=>score(b)-score(a));
  let markCount=remaining; // on surligne ce qu'il reste à faire pour atteindre l'objectif
  const body=document.getElementById('reviseBody');
  document.getElementById('reviseInfo').textContent = `${pool.length} suivis · ${rest.filter(c=>score(c)>=1).length} en retard`;
  const prog=document.getElementById('dayProgress');
  prog.textContent = goal>0 ? `✓ ${done}/${goal} aujourd'hui` : `✓ ${done} aujourd'hui`;
  prog.classList.toggle('done', goal>0 && done>=goal);
  let html='';
  html+=bucket('À terminer (sessions non finies)', unfinished.map(c=>revCard(c,'unfin',false)));
  html+=bucket('Jamais révisés', never.map((c)=>{const m=markCount-->0;return revCard(c,'never',m);}));
  html+=bucket('À revoir — par priorité', rest.map((c)=>{const m=markCount-->0;return revCard(c,'rest',m);}));
  body.innerHTML=html || '<div class="empty">Rien à réviser ici.</div>';
  body.querySelectorAll('[data-rv]').forEach(b=>b.onclick=()=>quickRevise(b.dataset.rv));
  bindRemMore(body);
}
function bucket(title,cards){
  if(!cards.length) return '';
  return `<div class="bucket"><h3>${title}<span class="n">${cards.length}</span></h3>${cards.join('')}</div>`;
}
function revCard(ch,kind,mark){
  const l=lastDated(ch); const dd=l?daysBetween(l.date):null; const sc=score(ch);
  let urg = kind==='unfin'?getVar('--accent'):(kind==='never'?'var(--imp-ref)':LEVELS[Math.min(5,Math.max(1,Math.ceil(Math.min(sc,1)*5)||1))].color);
  urg = kind==='rest'? (l?LEVELS[l.niveau||3].color:'var(--line-strong)') : urg;
  const rs=remarks(ch);
  const remBlock = rs.length
    ? `<div class="revrem"><span class="revrtext">✎ ${esc(rs[0].remarque)}</span>${rs.length>1?`<button class="star" data-remmore>＊${rs.length}</button>${remListHTML(rs)}`:''}</div>`
    : '';
  const meta = kind==='never'? `<span>jamais révisé</span>` :
     kind==='unfin'? `<span>session en cours</span>` :
     `<span class="mono">dernier : ${fmtDate(l.date)} ${lvlChip(l.niveau)}</span><span class="daychip ${sc>=1?'overdue':''}">il y a ${dd} j</span><span class="score">score ${sc.toFixed(2)}</span>`;
  return `<div class="rev ${mark?'daymark':''}">
    <span class="urg" style="background:${urg}"></span>
    <div class="rmain">
      <div class="rt">${esc(ch.titre)}</div>
      <div class="rmeta"><span>${esc(ch.college)} · ${ch.semestre.replace('SEMESTRE','S')}</span>${meta}</div>
      ${remBlock}
    </div>
    <button class="btn mini accent" data-rv="${ch.id}">Réviser</button>
  </div>`;
}
function quickRevise(id){
  const ch=chapById(id);
  const lvl=prompt('Niveau de la session ?\n1=Maîtrisé  2=À consolider  3=Intermédiaire  4=Difficile  5=Mal su\n(laisser vide = non terminée)','3');
  if(lvl===null) return;
  const n=parseInt(lvl);
  ch.sessions.forEach(s=>{s.enCours=false;}); // les sessions précédentes sont terminées
  ch.sessions.push({date:new Date().toISOString().slice(0,10),niveau:(n>=1&&n<=5)?n:null,remarque:'',enCours:!(n>=1&&n<=5)});
  commit(); render(); toast('Session ajoutée à « '+ch.titre+' »');
}

/* ---------- réglages : intervalles cibles ---------- */
function renderSettings(){
  const box=document.getElementById('intervalEditor');
  box.innerHTML=[1,2,3,4,5].map(n=>`<div class="ivrow">
    <span class="sw" style="background:${LEVELS[n].color}"></span>
    <span class="ivlab">${LEVELS[n].name}</span>
    <input type="number" min="1" step="1" data-iv="${n}" value="${getInterval(n)}">
  </div>`).join('');
  box.querySelectorAll('[data-iv]').forEach(inp=>{
    inp.onchange=()=>{
      const n=+inp.dataset.iv; const v=parseInt(inp.value);
      if(v>=1){ state.settings.intervals[n]=v; commit(); toast('Intervalle « '+LEVELS[n].name+' » = '+v+' j'); }
      else{ inp.value=getInterval(n); }
    };
  });
}
document.getElementById('resetIntervals').onclick=()=>{
  state.settings.intervals={...DEFAULT_INTERVALS};
  commit(); renderSettings(); toast('Intervalles réinitialisés');
};

/* ---------- onglet stats ---------- */
function renderStats(){
  // par défaut : stats sur les chapitres référence uniquement.
  // case cochée : on compte TOUS les chapitres (total en retard / jamais vus).
  const chs=state.chapters.filter(c=>includeSecondary||c.importance==='reference');
  const total=chs.length;
  const seen=chs.filter(c=>!neverSeen(c)).length;
  const overdue=chs.filter(c=>!neverSeen(c)&&score(c)>=1).length;
  const neverN=chs.filter(c=>neverSeen(c)).length;
  const overdueLabel=includeSecondary?'En retard':'Réf. en retard';
  const neverLabel=includeSecondary?'Jamais vus':'Réf. jamais vus';
  const cards=[['Chapitres',total],['Déjà révisés',seen],[overdueLabel,overdue],[neverLabel,neverN]];
  document.getElementById('statCards').innerHTML=cards.map(([l,n])=>`<div class="stat"><div class="num">${n}</div><div class="lab">${l}</div></div>`).join('');
  // par collège : répartition du niveau courant (dernière session) + jamais vus
  const byColl={};
  for(const ch of chs){
    const k=ch.college; byColl[k]=byColl[k]||{never:0,l:{1:0,2:0,3:0,4:0,5:0},total:0};
    byColl[k].total++;
    const last=lastDated(ch);
    if(!last) byColl[k].never++; else byColl[k].l[last.niveau||3]++;
  }
  const rows=Object.entries(byColl).sort((a,b)=>b[1].total-a[1].total).map(([name,d])=>{
    const segs=[1,2,3,4,5].map(l=>d.l[l]?`<span style="flex:${d.l[l]};background:${LEVELS[l].color}" title="${LEVELS[l].name}: ${d.l[l]}"></span>`:'').join('')
      + (d.never?`<span style="flex:${d.never};background:#DDD9D1" title="jamais révisé: ${d.never}"></span>`:'');
    return `<div class="csrow"><div class="cn" title="${esc(name)}">${esc(name)}</div><div class="sbar">${segs}</div><div class="cc">${d.total}</div></div>`;
  }).join('');
  document.getElementById('collStats').innerHTML=rows;
}

/* ---------- export / import / reset ---------- */
document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(state,null,1)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='revisions_colleges_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  toast('Données exportées');
};
document.getElementById('importBtn').onclick=()=>document.getElementById('fileIn').click();
document.getElementById('fileIn').onchange=e=>{
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ const d=JSON.parse(r.result); if(!d.chapters) throw 0; state=migrate(d); save(); renderSettings(); render(); toast('Données importées'); }catch(err){ alert('Fichier invalide.'); } };
  r.readAsText(f); e.target.value='';
};
document.getElementById('resetBtn').onclick=()=>{ if(confirm('Réinitialiser aux données d’origine (importées de l’Excel) ? Tes modifications seront perdues.')){ state=seedCopy(); save(); renderSettings(); render(); toast('Réinitialisé'); } };

/* ---------- rendu & init ---------- */
function render(){
  if(curTab==='work') renderTable(); else renderStats();
  renderRevise(); // la sidebar « à réviser » est présente dans les deux onglets
}
/* battement de cœur : tant que l'onglet est ouvert, on prévient le serveur.
   Quand on ferme l'onglet, les battements cessent → le serveur s'arrête tout
   seul (voir watchdog dans server.py). Permet une appli sans fenêtre console. */
function startHeartbeat(){
  if(!serverMode) return;
  const beat=()=>{ fetch('/api/heartbeat',{cache:'no-store'}).catch(()=>{}); };
  setInterval(beat, 3000);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) beat(); });
  beat();
}
(async function init(){
  state=await load();
  updatePersistNote();
  startHeartbeat();
  renderSettings();
  render();
})();
