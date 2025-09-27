(() => {
/*** sanity: prove JS is executing (remove these 3 lines later if you want) ***/
alert("JS loaded ✅");
window.addEventListener('error', e => alert('JS error: ' + e.message));
window.addEventListener('unhandledrejection', e => alert('Promise error: ' + (e.reason?.message || e.reason || '')));

/*** DOM refs ***/
const svg = document.getElementById('view');
const wrap = document.getElementById('canvasWrap');
const legend = document.getElementById('legend');
const $ = id => document.getElementById(id);
const statusBadge = $('statusBadge');
const elist = $('elist');
const scaleInput = $('scaleInput');
const legendMeta = $('legendMeta');
const mapNameInput = $('mapName');
const reportBox = $('htvrReport');
const widthScaleInput = $('widthScale');
const symbolScaleInput = $('symbolScale');
const htKvaLabel = $('htKvaLabel');
const htKvaInput = $('htKvaInput');
const componentSelect = $('componentSelect');
const componentInputs = $('component-inputs');

const svgNS = 'http://www.w3.org/2000/svg';
const state = {
  nodes: [], segs: [], symbols: [],
  current: null, dir: 'right', stack: [], history: [],
  idc: 1, scale: Number(scaleInput?.value) || 120,
  ssName: '', widthScale: Number(widthScaleInput?.value) || 1,
  symbolScale: Number(symbolScaleInput?.value) || 1,
  customComponents: [],
};

let activeMarker = null;
let htvrOverlays = [];

/*** Server API helpers ***/
// ===== Server API helpers =====
const BASE_URL = ""; // same origin (keep empty). If testing local UI against Render server, set full URL: "https://YOUR-APP.onrender.com"

async function saveMapToServer(title, dataObj) {
  const res = await fetch(`${BASE_URL}/api/maps`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, data: dataObj })
  });
  if (!res.ok) throw new Error("Server save failed");
  const json = await res.json(); // { id }
  return json.id;
}

async function listMapsFromServer() {
  const res = await fetch(`${BASE_URL}/api/maps`);
  if (!res.ok) throw new Error("Failed to list maps from server");
  const json = await res.json(); // { items: [{id,title,updatedAt}] }
  return json.items || [];
}

async function loadMapFromServer(id) {
  const res = await fetch(`${BASE_URL}/api/maps/${id}`);
  if (!res.ok) throw new Error("Failed to load map from server");
  return await res.json(); // { id,title,data,... }
}

// bridge helper: stash server map into browser localStorage then reuse your existing loadMap(name)
function stashToLocalAndLoad(name, data) {
  try {
    // put the data into the same place your old code expects
    localStorage.setItem("sld_map_" + name, JSON.stringify(data));
    // optionally maintain the local index so your older "Open Map" flow still sees it
    const idxKey = "sld_maps_index_final";
    const names = JSON.parse(localStorage.getItem(idxKey) || "[]");
    if (!names.includes(name)) {
      names.push(name);
      localStorage.setItem(idxKey, JSON.stringify(names));
    }
    // now call your existing loader
    if (typeof loadMap === "function") {
      loadMap(name);
    } else {
      // fallback: if you don’t have loadMap(name) in this build, you can rehydrate manually later
      console.warn("loadMap(name) not found; data is stored locally.");
    }
  } catch (e) {
    console.error(e);
    showToast("Failed to load map locally.", "danger");
  }
}
/*** Status helpers ***/
function readyOK(){ if(!statusBadge) return; statusBadge.textContent='Ready'; statusBadge.style.borderColor='var(--success)'; statusBadge.style.background='#10301a'; statusBadge.style.color='#c9f7d8'; }
function readyERR(msg){ if(!statusBadge) return; statusBadge.textContent='Error'; statusBadge.style.borderColor='var(--danger)'; statusBadge.style.background='#3a0c10'; statusBadge.style.color='#ffd0d0'; console.error('[SLD Builder]', msg); showToast(msg, 'danger'); }

/*** constants ***/
const COEF = { RABBIT:{label:"Rabbit 55 mm² (OHL)",num:0.1,denom:160}, DOG:{label:"DOG 100 mm² (OHL)",num:0.035,denom:100}, UG185:{label:"UG Cable 3.5C×185",num:0.025,denom:100}, UG240:{label:"UG Cable 3.5C×240",num:0.020,denom:100}, PROPRABBIT:{label:"Proposed 55 mm² Rabbit",num:0.1,denom:160}, PROPDOG:{label:"Proposed 100 mm² DOG",num:0.035,denom:100}, PROG185:{label:"Proposed UG 3.5C×185",num:0.025,denom:100}, PROG240:{label:"Proposed UG 3.5C×240",num:0.020,denom:100} };
const TRANSFORMER_KVA = { T5:5, T10:10, T16:16, T25:25, T63:63, T100:100, T200:200, T500:500 };
const AVAILABLE_SYMBOLS = {
  diamond:{ d:'M 0 -9 L 7 0 L 0 9 L -7 0 Z', color:'var(--customSymbol)' },
  square:{ d:'M -7 -7 H 7 V 7 H -7 Z', color:'var(--customSymbol)' },
  circle:{ d:'M 0, 0 m -8, 0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0', color:'var(--customSymbol)' },
  cross:{ d:'M -7 -7 L 7 7 M -7 7 L 7 -7', color:'var(--customSymbol)', fill:'none', 'stroke-width':'2' }
};

/*** toast & modal ***/
function showToast(message, type='info'){
  const container = $('toast-container'); if (!container) return alert(message);
  const toast = document.createElement('div');
  toast.className = `toast ${type}`; toast.textContent = message; container.appendChild(toast);
  setTimeout(()=>toast.classList.add('show'),10);
  setTimeout(()=>{ toast.classList.remove('show'); setTimeout(()=>toast.remove(),500); }, 3000);
}
const modal = {
  overlay:$('modal-overlay'), title:$('modal-title'), message:$('modal-message'),
  inputContainer:$('modal-input-container'), list:$('modal-list'), buttons:$('modal-buttons')
};
function hideModal(){ modal.overlay?.classList.remove('show'); }
function showModal(config){
  if (!modal.overlay) return alert(config.message || config.title || 'Dialog');
  modal.title.textContent = config.title; modal.message.textContent = config.message||'';
  modal.message.style.display = config.message ? 'block' : 'none';
  modal.inputContainer.innerHTML='';
  if(config.inputs){ config.inputs.forEach(ic=>{
    if(ic.type==='text'){ const i=document.createElement('input'); i.id=ic.id; i.placeholder=ic.placeholder||''; i.value=ic.value||''; modal.inputContainer.appendChild(i); }
    if(ic.type==='select'){ const s=document.createElement('select'); s.id=ic.id; for(const [v,t] of Object.entries(ic.options)){ const o=document.createElement('option'); o.value=v; o.textContent=t; s.appendChild(o);} modal.inputContainer.appendChild(s); }
  });}
  modal.list.innerHTML=''; modal.list.style.display='none';
  if(config.type==='list'){ modal.list.style.display='block'; config.items.forEach(item=>{ const div=document.createElement('div'); div.className='modal-list-item'; div.textContent=item; div.dataset.value=item; div.onclick=()=>{ modal.list.querySelectorAll('.selected').forEach(s=>s.classList.remove('selected')); div.classList.add('selected'); }; modal.list.appendChild(div); }); }
  modal.buttons.innerHTML='';
  if(config.buttons?.cancel){ const b=document.createElement('button'); b.className='btn ghost'; b.textContent=config.buttons.cancel.text||'Cancel'; b.onclick=()=>{ hideModal(); config.buttons.cancel.action?.(); }; modal.buttons.appendChild(b); }
  if(config.buttons?.ok){ const b=document.createElement('button'); b.className=`btn ${config.buttons.ok.class||'success'}`; b.textContent=config.buttons.ok.text||'OK'; b.onclick=()=>{ let value=null; if(config.inputs){ value={}; config.inputs.forEach(ic=> value[ic.id]=($(ic.id).value)); } else if(config.type==='list'){ value = modal.list.querySelector('.selected')?.dataset.value; } hideModal(); config.buttons.ok.action?.(value); }; modal.buttons.appendChild(b); }
  if(config.buttons?.extra){ const b=document.createElement('button'); b.className=`btn ${config.buttons.extra.class||'danger'}`; b.textContent=config.buttons.extra.text; b.onclick=()=>{ const value=modal.list.querySelector('.selected')?.dataset.value; if(value){ hideModal(); config.buttons.extra.action?.(value); } else { showToast('Please select a map first.','danger'); } }; modal.buttons.appendChild(b); }
  modal.overlay.classList.add('show'); if(config.inputs?.[0]) $(config.inputs[0].id).focus();
}

/*** helpers & rendering ***/
function setDir(d){ state.dir=d; document.querySelectorAll('#dirPad button').forEach(b=> b.classList.toggle('activeDir', b.dataset.dir===d)); }
function setStatus(){ if(!statusBadge) return; statusBadge.textContent = state.current ? `Node #${state.current}` : 'No SS'; if(legendMeta) legendMeta.textContent = `${state.ssName?('SS: '+state.ssName+' • '):''}Scale: ${state.scale} px/km • ${new Date().toLocaleDateString()}`; }
function css(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function styleFor(type){ switch(type){ case'RABBIT':return{stroke:css('--ohRabbit'),width:3,dash:null,label:'Rabbit 55 mm² (OHL)'}; case'DOG':return{stroke:css('--ohDog'),width:4,dash:null,label:'DOG 100 mm² (OHL)'}; case'UG185':return{stroke:css('--ug185'),width:4,dash:'8 6',label:'UG 3.5C×185'}; case'UG240':return{stroke:css('--ug240'),width:4,dash:'8 6',label:'UG 3.5C×240'}; case'PROPRABBIT':return{stroke:css('--propRabbit'),width:3,dash:'6 4',label:'Proposed 55 mm² Rabbit'}; case'PROPDOG':return{stroke:css('--propDog'),width:4,dash:'6 4',label:'Proposed 100 mm² DOG'}; case'PROG185':return{stroke:css('--propUG185'),width:4,dash:'8 6',label:'Proposed UG 3.5C×185'}; case'PROG240':return{stroke:css('--propUG240'),width:4,dash:'8 6',label:'Proposed UG 3.5C×240'}; default:return{stroke:css('--ohRabbit'),width:3,dash:null,label:'Rabbit 55 mm² (OHL)'} } }
function xfColor(kva){ const k=Number(kva); if(k<=5)return css('--t5'); if(k<=10)return css('--t10'); if(k<=16)return css('--t16'); if(k<=25)return css('--t25'); if(k<=63)return css('--t63'); if(k<=100)return css('--t100'); if(k<=200)return css('--t200'); return css('--t500'); }
function createSvgElement(tag, attributes){ const el=document.createElementNS(svgNS, tag); for(const k in attributes) el.setAttribute(k, attributes[k]); return el; }
function createNode(x,y,label,type){ const id=state.idc++; state.nodes.push({id,x,y,label:label||'',type:type||'node'}); if(type==='ss'){ const g=createSvgElement('g',{'data-node':id}); const r=createSvgElement('rect',{x:x-18,y:y-18,width:36,height:36,rx:6,fill:'#163063',stroke:'#6ea1ff','stroke-width':'2'}); const t=createSvgElement('text',{x,y:y-26,'text-anchor':'middle',class:'label'}); t.textContent='SS: '+label; g.append(t,r); svg.appendChild(g); } else { const c=createSvgElement('circle',{cx:x,cy:y,r:3.2,fill:'#b9ccff','data-node':id}); svg.appendChild(c);} moveActive(x,y); return id; }
function nodeById(id){ return state.nodes.find(n=>n.id===id); }
function moveActive(x,y){ if(!activeMarker){ activeMarker=createSvgElement('circle',{r:8,class:'active-node'}); svg.appendChild(activeMarker);} activeMarker.setAttribute('cx',x); activeMarker.setAttribute('cy',y); }
function overlaps(node){ const bb=node.getBBox(); const texts=[...svg.querySelectorAll('text')]; for(const other of texts){ if(other===node) continue; const ob=other.getBBox(); if(!(bb.x>ob.x+ob.width||bb.x+bb.width<ob.x||bb.y>ob.y+ob.height||bb.y+bb.height<ob.y)) return true; } return false; }
function placeLabel(x,y,text,cls='label'){ const t=createSvgElement('text',{x,y,'text-anchor':'middle',class:cls}); t.textContent=text; svg.appendChild(t); let moved=0,step=12,tries=0; while(overlaps(t)&&tries<40){ moved+=step; t.setAttribute('y',y+moved); tries++; } return t; }
function placeLengthLabel(x1,y1,x2,y2,text){ const dx=x2-x1, dy=y2-y1; const L=Math.hypot(dx,dy)||1; const nx=-dy/L, ny=dx/L; const off=10; const mx=(x1+x2)/2+nx*off; const my=(y1+y2)/2+ny*off; return placeLabel(mx,my,text,'lengthLabel'); }
function placeHTVRLabel(x1,y1,x2,y2,text,pct){ const dx=x2-x1, dy=y2-y1; const L=Math.hypot(dx,dy)||1; const nx=-dy/L, ny=dx/L; const off=18; const mx=(x1+x2)/2+nx*off; const my=(y1+y2)/2+ny*off; const t=placeLabel(mx,my,text,'htvrLabel'); const p=Number(pct); let col='#22c55e'; if(p>=5) col='#ef4444'; else if(p>=3) col='#f59e0b'; t.setAttribute('fill',col); return t; }
function fmtKm(km){ let s=(Math.round(Number(km)*100)/100).toFixed(2); s=s.replace(/\.00$/,'').replace(/(\.[1-9])0$/,'$1'); return s; }
function focusEls(els){ if(!els?.length) return; const b=els[0].getBBox(); wrap.scrollLeft=Math.max(0,b.x+b.width/2-wrap.clientWidth/2); wrap.scrollTop=Math.max(0,b.y+b.height/2-wrap.clientHeight/2); els.forEach(el=>el.classList?.add('hi')); setTimeout(()=>els.forEach(el=>el.classList?.remove('hi')),900); }
function addListRow(kind,meta,onFocus,onTap,onDelete){ if(!elist) return; const row=document.createElement('div'); row.className='li'; const left=document.createElement('div'); left.innerHTML=`<div class="t">${kind}</div><div class="meta">${meta}</div>`; const btnF=document.createElement('button'); btnF.className='btn ghost'; btnF.textContent='Focus'; btnF.onclick=()=>onFocus?.(); const btnT=document.createElement('button'); btnT.className='btn warn'; btnT.textContent='Tap Here'; btnT.onclick=()=>onTap?.(); const btnD=document.createElement('button'); btnD.className='btn danger'; btnD.textContent='Delete'; btnD.onclick=()=>{ onDelete?.(); row.remove(); }; row.append(left,btnF,btnT,btnD); elist.appendChild(row); elist.scrollTop=elist.scrollHeight; }
function pushTapFromNode(nodeId){ if(!nodeId)return; state.stack.push(nodeId); $('btnEndTap').disabled=false; state.current=nodeId; const n=nodeById(nodeId); moveActive(n.x,n.y); setStatus(); }
function styleForLineAndDraw(cur,nx,ny,type){ const s=styleFor(type); const line=createSvgElement('line',{x1:cur.x,y1:cur.y,x2:nx,y2:ny, stroke:s.stroke,'stroke-width':String(s.width*state.widthScale), ...(s.dash&&{'stroke-dasharray':s.dash})}); svg.appendChild(line); return {line,style:s}; }
function addLine(km,type){ if(!state.current){ showToast('Create Substation first.','warn'); return; } km=Number(km); if(!(km>0)){ showToast('Enter valid line length.','warn'); return; } type=type||'RABBIT'; const px=Math.max(18, km*state.scale); const cur=nodeById(state.current); let nx=cur.x, ny=cur.y; if(state.dir==='right') nx+=px; else if(state.dir==='left') nx-=px; else if(state.dir==='up') ny-=px; else if(state.dir==='down') ny+=px; const nid=createNode(nx,ny,'','node'); const {line,style}=styleForLineAndDraw(cur,nx,ny,type); const lenLbl=placeLengthLabel(cur.x,cur.y,nx,ny,fmtKm(km)); const sid=state.idc++; const hist={kind:'seg', segId:sid, nodeId:nid, from:state.current, km, type, els:[line,lenLbl], tapNode:nid}; state.segs.push({id:sid, from:state.current, to:nid, km, lineType:type}); state.history.push(hist); addListRow('Line',`${style.label} • ${fmtKm(km)}`,()=>focusEls([line,lenLbl]),()=>pushTapFromNode(nid),()=>deleteSeg(hist)); state.current=nid; moveActive(nx,ny); focusEls([line]); setStatus(); }
function addMarker(){ if(!state.current){ showToast('Create Substation first.','warn'); return; } const cur=nodeById(state.current); const g=createSvgElement('g',{'data-sym':'mark'}); const r=createSvgElement('rect',{x:cur.x-6*state.symbolScale,y:cur.y-6*state.symbolScale,width:12*state.symbolScale,height:12*state.symbolScale,fill:'#ffd84d',stroke:'#6b5600','stroke-width':'1.5'}); const t=placeLabel(cur.x,cur.y-12*state.symbolScale,'Tap Point'); g.appendChild(r); svg.appendChild(g); const hist={kind:'marker', els:[g,t], tapNode:state.current}; state.history.push(hist); addListRow('Marker','Tap',()=>focusEls([g,t]),()=>pushTapFromNode(state.current),()=>{ g.remove(); t.remove(); removeFromHistory(hist); }); }

/*** createSymbolElement — needed for restore ***/
// Create an SVG element for a saved symbol record
function createSymbolElement(kind, kindId, meta, x, y, scale) {
  const s = scale || state.symbolScale;
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const n = document.createElementNS(svgNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

  // known kinds
  if (kindId?.startsWith('T')) {
    // transformer by kVA color
    const kva = parseFloat((meta||'').replace(/[^0-9.]/g,'')||'0');
    const g = el('path', { d: `M -9 8 L 9 8 L 0 -10 Z`, fill: xfColor(kva), stroke: css('--tStroke'), 'stroke-width': '1.2', 'data-sym':'dtr', 'data-kind-id': kindId, transform: `translate(${x},${y}) scale(${s})` });
    return g;
  }
  if (kindId === 'HT' || kind === 'ht') {
    const g = el('g', { 'data-sym':'ht', 'data-kind-id':'HT', transform:`translate(${x},${y}) scale(${s})` });
    g.appendChild(el('rect', { x:-10, y:-7, width:20, height:14, rx:3, fill:'#223f1f', stroke:'#65c95a', 'stroke-width':'1.8' }));
    return g;
  }
  if (kindId === 'RMU3' || kind === 'rmu3') {
    const g = el('g', { 'data-sym':'rmu3', 'data-kind-id':'RMU3', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('path',{d:`M -6 -6 L 6 -6 L 6 6 L -6 6 Z`, fill:css('--rmu3'), stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:0,y1:-6,x2:0,y2:-10,stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:0,y1:6,x2:0,y2:10,stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:6,y1:0,x2:10,y2:0,stroke:css('--tStroke'),'stroke-width':'1.5'}));
    return g;
  }
  if (kindId === 'RMU4' || kind === 'rmu4') {
    const g = el('g', { 'data-sym':'rmu4', 'data-kind-id':'RMU4', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('path',{d:`M -6 -6 L 6 -6 L 6 6 L -6 6 Z`, fill:css('--rmu4'), stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:0,y1:-6,x2:0,y2:-10,stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:0,y1:6,x2:0,y2:10,stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:-6,y1:0,x2:-10,y2:0,stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:6,y1:0,x2:10,y2:0,stroke:css('--tStroke'),'stroke-width':'1.5'}));
    return g;
  }
  if (kindId === 'SW' || kind === 'sw') {
    const g = el('g', { 'data-sym':'sw','data-kind-id':'SW', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('circle',{cx:0,cy:0,r:5,fill:css('--sw'),stroke:css('--tStroke'),'stroke-width':'1.5'}),
             el('line',{x1:0,y1:0,x2:10,y2:0,stroke:css('--tStroke'),'stroke-width':'1.5'}));
    return g;
  }
  if (kindId === 'FP' || kind === 'fp') {
    return el('rect', { x:-6,y:-6,width:12,height:12, fill:css('--feederPillar'), stroke:css('--tStroke'), 'stroke-width':'1.2', 'data-sym':'fp','data-kind-id':'FP', transform:`translate(${x},${y}) scale(${s})` });
  }
  if (kindId === 'LA' || kind === 'la') {
    const g = el('g', { 'data-sym':'la','data-kind-id':'LA', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('path',{ d:'M -6 -8 H 6 V -2 H -6 Z M 0 -2 V 4 M -8 4 H 8', fill:'none', stroke:css('--lightningArrester'),'stroke-width':'1.5'}));
    return g;
  }
  if (kindId === 'SEC' || kind === 'sec') {
    const g = el('g', { 'data-sym':'sec','data-kind-id':'SEC', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('rect',{x:-5,y:-5,width:10,height:10,fill:'none',stroke:css('--sectionaliser'),'stroke-width':'1.5'}),
             el('text',{x:0,y:3,'font-size':'8px','text-anchor':'middle',fill:css('--ink')}, 'S'));
    return g;
  }
  if (kindId === 'AR' || kind === 'ar') {
    const g = el('g', { 'data-sym':'ar','data-kind-id':'AR', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('rect',{x:-5,y:-5,width:10,height:10,fill:'none',stroke:css('--autoRecloser'),'stroke-width':'1.5'}),
             el('text',{x:0,y:3,'font-size':'7px','text-anchor':'middle',fill:css('--ink')}, 'AR'));
    return g;
  }
  if (kindId === 'DOF' || kind === 'dof') {
    const g = el('g', { 'data-sym':'dof','data-kind-id':'DOF', transform:`translate(${x},${y}) scale(${s})` });
    g.append(el('circle',{cx:0,cy:0,r:6,fill:'none',stroke:css('--dropOutFuse'),'stroke-width':'1.5'}),
             el('line',{x1:-4,y1:4,x2:4,y2:-4,stroke:css('--dropOutFuse'),'stroke-width':'1.5'}));
    return g;
  }

  // custom fallback: simple diamond
  const g = el('path', { d:'M 0 -9 L 7 0 L 0 9 L -7 0 Z', fill: css('--customSymbol'), stroke: css('--customSymbol'), 'stroke-width':'1.2', 'data-sym':'custom', 'data-kind-id': kindId || 'custom', transform:`translate(${x},${y}) scale(${s})` });
  return g;
}

/*** addSymbol/addXfmr etc. ***/
function addSymbol(kind, metaText, drawFn, kindId){
  if(!state.current){ showToast('Create Substation first.','warn'); return; }
  const cur=nodeById(state.current);
  const g=drawFn(cur.x,cur.y); svg.appendChild(g);
  const rec={id:state.idc++, kind, at:state.current, meta:metaText, kindId};
  state.symbols.push(rec);
  const lblEls=[]; if(metaText){ const t=placeLabel(cur.x, cur.y-14*state.symbolScale, metaText); lblEls.push(t); }
  const hist={kind:'sym', els:[g,...lblEls], rec, tapNode:state.current}; state.history.push(hist);
  addListRow(kind.toUpperCase(), metaText||'', ()=>focusEls([g,...lblEls]), ()=>pushTapFromNode(state.current), ()=>deleteSym(hist));
  focusEls([g]);
}
function addXfmrOrSwitchgear(){
  const sel=componentSelect.value;
  if(sel==='ADD_NEW'){ handleAddNewComponent(); return; }
  const customComp = state.customComponents.find(c=>c.id===sel);
  if(customComp){
    addSymbol('custom', customComp.name, (x,y)=>{
      const s=state.symbolScale; const info=AVAILABLE_SYMBOLS[customComp.symbol];
      return createSvgElement('path',{ d:info.d, fill:info.fill||info.color, stroke:info.stroke||info.color, 'stroke-width':info['stroke-width']||'1.2', 'data-sym':'custom','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})` });
    }, sel);
    return;
  }
  let kva=0; if(sel.startsWith('T')) kva=TRANSFORMER_KVA[sel]; else if(sel==='HT') kva=Number(htKvaInput.value);
  if(sel==='HT' && !(kva>0)){ showToast('Enter valid capacity (kVA) for HT connection.','warn'); return; }
  const s=state.symbolScale;
  const draw = {
    T:(x,y)=>createSvgElement('path',{ d:'M -9 8 L 9 8 L 0 -10 Z', fill:xfColor(kva), stroke:css('--tStroke'),'stroke-width':'1.2','data-sym':'dtr','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})` }),
    HT:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'ht','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.appendChild(createSvgElement('rect',{ x:-10,y:-7,width:20,height:14,rx:3, fill:'#223f1f', stroke:'#65c95a','stroke-width':'1.8'})); return g; },
    RMU3:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'rmu3','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('path',{ d:'M -6 -6 L 6 -6 L 6 6 L -6 6 Z', fill:css('--rmu3'), stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:0,y1:-6,x2:0,y2:-10, stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:0,y1:6,x2:0,y2:10, stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:6,y1:0,x2:10,y2:0, stroke:css('--tStroke'),'stroke-width':'1.5'})); return g; },
    RMU4:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'rmu4','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('path',{ d:'M -6 -6 L 6 -6 L 6 6 L -6 6 Z', fill:css('--rmu4'), stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:0,y1:-6,x2:0,y2:-10, stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:0,y1:6,x2:0,y2:10, stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:-6,y1:0,x2:-10,y2:0, stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:6,y1:0,x2:10,y2:0, stroke:css('--tStroke'),'stroke-width':'1.5'})); return g; },
    SW:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'sw','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('circle',{ cx:0,cy:0,r:5, fill:css('--sw'), stroke:css('--tStroke'),'stroke-width':'1.5'}), createSvgElement('line',{ x1:0,y1:0,x2:10,y2:0, stroke:css('--tStroke'),'stroke-width':'1.5'})); return g; },
    FP:(x,y)=>createSvgElement('rect',{ x:-6,y:-6,width:12,height:12,'data-sym':'fp','data-kind-id':sel, fill:css('--feederPillar'), stroke:css('--tStroke'),'stroke-width':1.2, transform:`translate(${x}, ${y}) scale(${s})` }),
    LA:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'la','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('path',{ d:'M -6 -8 H 6 V -2 H -6 Z M 0 -2 V 4 M -8 4 H 8', fill:'none', stroke:css('--lightningArrester'),'stroke-width':1.5 })); return g; },
    SEC:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'sec','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('rect',{ x:-5,y:-5,width:10,height:10, fill:'none', stroke:css('--sectionaliser'),'stroke-width':1.5 }), createSvgElement('text',{ x:0,y:3,'font-size':'8px','text-anchor':'middle', fill:css('--ink'), 'font-weight':'bold', textContent:'S' })); return g; },
    AR:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'ar','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('rect',{ x:-5,y:-5,width:10,height:10, fill:'none', stroke:css('--autoRecloser'),'stroke-width':1.5 }), createSvgElement('text',{ x:0,y:3,'font-size':'7px','text-anchor':'middle', fill:css('--ink'),'font-weight':'bold', textContent:'AR' })); return g; },
    DOF:(x,y)=>{ const g=createSvgElement('g',{'data-sym':'dof','data-kind-id':sel, transform:`translate(${x}, ${y}) scale(${s})`}); g.append(createSvgElement('circle',{ cx:0,cy:0,r:6, fill:'none', stroke:css('--dropOutFuse'),'stroke-width':1.5 }), createSvgElement('line',{ x1:-4,y1:4,x2:4,y2:-4, stroke:css('--dropOutFuse'),'stroke-width':1.5 })); return g; }
  };
  if(sel.startsWith('T')) addSymbol('dtr', `${kva} kVA`, draw.T, sel);
  else if(sel==='HT') addSymbol('ht', `${kva} kVA`, draw.HT, sel);
  else if(draw[sel]) addSymbol(sel.toLowerCase(), componentSelect.options[componentSelect.selectedIndex].text, draw[sel], sel);
}
function startTap(){ if(!state.current){ showToast('Create Substation first.','warn'); return; } state.stack.push(state.current); $('btnEndTap').disabled=false; const cur=nodeById(state.current); const ring=createSvgElement('circle',{cx:cur.x, cy:cur.y, r:6.5, fill:'none', stroke:'#ffd84d','stroke-width':'2'}); svg.appendChild(ring); const hist={kind:'tapStart', els:[ring], tapNode:state.current}; state.history.push(hist); addListRow('Tap','Start',()=>focusEls([ring]),()=>pushTapFromNode(state.current),()=>{ ring.remove(); removeFromHistory(hist); }); }
function endTap(){ if(state.stack.length===0) return; state.current=state.stack.pop(); $('btnEndTap').disabled = state.stack.length===0; const cur=nodeById(state.current); moveActive(cur.x, cur.y); setStatus(); }
function deleteSeg(hist){ hist.els.forEach(el=>el.remove()); const nodesEls=[...svg.querySelectorAll('[data-node]')]; const target=nodesEls.find(e=>Number(e.getAttribute('data-node'))===hist.nodeId); if(target) target.remove(); state.nodes=state.nodes.filter(x=>x.id!==hist.nodeId); state.segs=state.segs.filter(s=>s.id!==hist.segId); if(state.current===hist.nodeId) state.current=hist.from; setStatus(); }
function deleteSym(hist){ hist.els.forEach(el=>el.remove()); const i=state.symbols.indexOf(hist.rec); if(i>=0) state.symbols.splice(i,1); }
function removeFromHistory(h){ const i=state.history.indexOf(h); if(i>=0) state.history.splice(i,1); }
function undo(){ const last=state.history.pop(); if(!last){ showToast('Nothing to undo.','info'); return; } if(last.kind==='seg') deleteSeg(last); else if(last.kind==='sym') deleteSym(last); else if(last.kind==='marker'||last.kind==='tapStart') last.els.forEach(el=>el.remove()); setStatus(); showToast('Last action undone.','info'); }
function clearAll(){ while(svg.firstChild) svg.removeChild(svg.firstChild); const border=createSvgElement('rect',{id:'mapBorder', x:'20', y:'20', width:'2760', height:'1760', fill:'none', stroke:'#7a88b7','stroke-width':'3'}); svg.appendChild(border); state.nodes=[]; state.segs=[]; state.symbols=[]; state.current=null; state.stack=[]; state.history=[]; state.idc=1; if(elist) elist.innerHTML=''; activeMarker=null; $('btnEndTap').disabled=true; clearHTVR(); clearReport(); setStatus(); state.customComponents=[]; resetComponentList(); }

/*** export & center ***/
function getStyledClone(el){ const clone=el.cloneNode(true); const props=['stroke','stroke-width','stroke-dasharray','fill','font-size','font-family','text-anchor','paint-order']; const originals=[el,...el.querySelectorAll('*')]; const clones=[clone,...clone.querySelectorAll('*')]; originals.forEach((o,i)=>{ const c=clones[i]; if(c){ const cs=window.getComputedStyle(o); props.forEach(p=>{ const v=cs.getPropertyValue(p); if(v && v!=='none' && v!=='initial' && v!=='0px') c.style.setProperty(p,v); }); } }); return clone; }
function generateSvgLegend(){ const legendGroup=createSvgElement('g'); const PAD=15, LINE=22, TITLE=28, GAP=10; let y=PAD, maxW=250; const bg=createSvgElement('rect',{ x:0,y:0,width:maxW, fill:'white', stroke:'black','stroke-width':1 }); legendGroup.appendChild(bg);
  document.querySelectorAll('#legend .section')?.forEach(section=>{ const titleText=section.querySelector('h4')?.textContent||'Section'; const title=createSvgElement('text',{ x:PAD, y:y+TITLE/2, 'font-size':'12px','font-weight':'bold', fill:'black' }); title.textContent=titleText; legendGroup.appendChild(title); y+=TITLE;
    section.querySelectorAll('.item').forEach(item=>{ const symbolSvg=item.querySelector('svg'); if(symbolSvg){ const sc=getStyledClone(symbolSvg); sc.setAttribute('x',PAD); sc.setAttribute('y',y); legendGroup.appendChild(sc);}
      const labelText=item.textContent?.trim()||''; const label=createSvgElement('text',{ x:PAD+45, y:y+12, 'font-size':'10px', fill:'black'}); label.textContent=labelText; legendGroup.appendChild(label); y+=LINE; }); y+=GAP; });
  const h=y; bg.setAttribute('height',h); legendGroup.setAttribute('data-width', maxW); legendGroup.setAttribute('data-height', h); return legendGroup;
}
function exportSVG(){ const src=svg; let bbox; try{ const content=[...src.children].filter(c=>c.id!=='mapBorder' && c!==activeMarker); if(content.length===0) throw new Error('No content'); let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; content.forEach(el=>{ const b=el.getBBox(); minX=Math.min(minX,b.x); minY=Math.min(minY,b.y); maxX=Math.max(maxX,b.x+b.width); maxY=Math.max(maxY,b.y+b.height); }); bbox={ x:minX, y:minY, width:maxX-minX, height:maxY-minY }; if(bbox.width===0||bbox.height===0) throw new Error(); } catch(e){ bbox={ x:0,y:0,width:2800,height:1800 }; }
  const pad=50; const mapGroup=createSvgElement('g'); [...src.children].forEach(c=>{ if(c.id!=='mapBorder' && c!==activeMarker) mapGroup.appendChild(getStyledClone(c)); }); const legendGroup=generateSvgLegend(); const lw=Number(legendGroup.getAttribute('data-width')), lh=Number(legendGroup.getAttribute('data-height')); legendGroup.setAttribute('transform', `translate(${bbox.x+bbox.width+pad}, ${bbox.y})`); const totalW=bbox.width+lw+pad*3, totalH=Math.max(bbox.height, lh)+pad*2; const viewBox=`${bbox.x-pad} ${bbox.y-pad} ${totalW} ${totalH}`;
  const outSvg=createSvgElement('svg',{ xmlns:svgNS, width:Math.ceil(totalW), height:Math.ceil(totalH), viewBox, style:"background-color: white;" }); outSvg.appendChild(mapGroup); outSvg.appendChild(legendGroup);
  const srcStr=new XMLSerializer().serializeToString(outSvg); const blob=new Blob([srcStr],{type:'image/svg+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(mapNameInput?.value?.trim()||'sld-export')+'.svg'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); showToast('SVG with full legend exported!','success');
}
function generateProfessionalPdfContent(mapSvgHtml, legendHtml){
  const feederName=mapNameInput?.value||'N/A'; const substationName=state.ssName||'N/A'; const date=new Date().toLocaleDateString();
  return `<!DOCTYPE html><html><head><title>SLD Export: ${feederName}</title>
  <style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:system-ui,sans-serif;color:black;background:white}
  .page-container{display:grid;grid-template-rows:auto 1fr auto;width:297mm;height:210mm;box-sizing:border-box;padding:8mm}
  .page-border{border:1px solid black;width:100%;height:100%;display:grid;grid-template-rows:auto 1fr auto}
  .header-block,.footer-block{padding:2mm 4mm;border-bottom:1px solid black}.footer-block{border-top:1px solid black;border-bottom:none}
  .main-content{display:grid;grid-template-columns:1fr 60mm;overflow:hidden}.map-area{display:flex;justify-content:center;align-items:center;overflow:hidden;padding:2mm}
  .map-area svg{max-width:100%;max-height:100%}.legend-area{border-left:1px solid black;padding:3mm;overflow-y:auto}
  .legend-area h4{font-size:10px;margin:0 0 5px 0;padding-bottom:3px;border-bottom:1px solid #ccc;text-align:center}
  .legend-table{width:100%;border-collapse:collapse;margin-bottom:10px}.legend-table td{font-size:7px;padding:2px;vertical-align:middle}
  .legend-symbol{width:20px}.legend-symbol svg{width:20px;height:8px;display:block}
  .title-table{width:100%;font-size:9px;border-collapse:collapse}.title-table td{padding:1.5mm;border:1px solid black;vertical-align:top}
  .title-table td.label{font-weight:bold;width:30%}.footer-table{width:100%;font-size:8px;border-collapse:collapse}
  .footer-table td{border:1px solid black;padding:2mm;height:12mm;text-align:center}
  .label,.lengthLabel,.htvrLabel{fill:black !important; stroke:white !important; stroke-width:3px !important;}</style></head>
  <body><div class="page-container"><div class="page-border">
  <header class="header-block"><table class="title-table">
  <tr><td class="label">Feeder Name:</td><td>${feederName} (11kV)</td><td class="label">Date:</td><td>${date}</td></tr>
  <tr><td class="label">Substation:</td><td>${substationName}</td><td class="label">Scale:</td><td>${state.scale} px/km</td></tr>
  </table></header>
  <main class="main-content"><div class="map-area">${mapSvgHtml}</div><aside class="legend-area">${legendHtml}</aside></main>
  <footer class="footer-block"><table class="footer-table"><tr><td>Drawn By</td><td>Checked By</td><td>Approved By</td></tr></table></footer>
  </div></div></body></html>`;
}
function exportPDF(){ const src=document.getElementById('view'); if(!src){ showToast('SVG element not found.','danger'); return; }
  const mapSvg=getStyledClone(src); const bbox=src.getBBox(); mapSvg.setAttribute('viewBox', `${bbox.x-20} ${bbox.y-20} ${bbox.width+40} ${bbox.height+40}`);
  let legendHtml=''; document.querySelectorAll('#legend .section')?.forEach(section=>{ const title=section.querySelector('h4')?.textContent||'Legend Section'; legendHtml+=`<h4>${title}</h4><table class="legend-table">`; section.querySelectorAll('.item').forEach(item=>{ const svgEl=item.querySelector('svg'); const text=item.textContent?.trim()||''; if(svgEl){ const sc=getStyledClone(svgEl).outerHTML; legendHtml+=`<tr><td class="legend-symbol">${sc}</td><td>${text}</td></tr>`; } }); legendHtml+=`</table>`; });
  const html=generateProfessionalPdfContent(mapSvg.outerHTML, legendHtml); const w=window.open('','_blank'); if(!w){ showToast('Please allow pop-ups for printing.','warn'); return; } w.document.write(html); w.document.close(); w.onload=()=>{ w.print(); w.onafterprint=()=>w.close(); };
}
function centerView(){ try{ const bbox=svg.getBBox(); if(bbox.width===0||bbox.height===0){ wrap.scrollLeft=(2800-wrap.clientWidth)/2; wrap.scrollTop=(1800-wrap.clientHeight)/2; } else { wrap.scrollLeft=bbox.x+bbox.width/2-wrap.clientWidth/2; wrap.scrollTop=bbox.y+bbox.height/2-wrap.clientHeight/2; } } catch(e){ console.warn('Could not center view.',e); } }

/*** SERVER STORAGE helpers ***/
function saveMapData(){ return { nodes:state.nodes, segs:state.segs, symbols:state.symbols, current:state.current, dir:state.dir, scale:state.scale, ssName:state.ssName, widthScale:state.widthScale, symbolScale:state.symbolScale, customComponents:state.customComponents, legendPos:{ top:legend.offsetTop, left:legend.offsetLeft, width:legend.offsetWidth, height:legend.offsetHeight } }; }
async function saveMapServer(title){ try{ const id=await saveToServer(title, saveMapData()); showToast(`Saved on server (id=${id})`,'success'); return id; } catch(e){ showToast('Save failed: '+e.message,'danger'); } }
async function loadMapServerAndRender(id){ try{
  const r=await loadFromServer(id); currentServerId=r.id; mapNameInput.value=r.title||''; clearAll();
  const data=r.data||{};
  state.scale=data.scale||state.scale; if(scaleInput) scaleInput.value=state.scale;
  state.ssName=data.ssName||''; $('ssName').value=state.ssName;
  state.widthScale=data.widthScale||1; if(widthScaleInput) widthScaleInput.value=state.widthScale;
  state.symbolScale=data.symbolScale||1; if(symbolScaleInput) symbolScaleInput.value=state.symbolScale;
  if(data.customComponents){ state.customComponents=data.customComponents; updateComponentList(); }
  if(data.legendPos){ legend.style.top=data.legendPos.top+'px'; legend.style.left=data.legendPos.left+'px'; legend.style.width=data.legendPos.width+'px'; legend.style.height=data.legendPos.height+'px'; }

  (data.nodes||[]).forEach(n=>{ const id=createNode(n.x,n.y,n.label,n.type); state.nodes[state.nodes.length-1].id=n.id; state.idc=Math.max(state.idc, n.id+1); });
  (data.segs||[]).forEach(s=>{ const a=state.nodes.find(n=>n.id===s.from), b=state.nodes.find(n=>n.id===s.to); if(!a||!b) return; const lt=s.lineType||'RABBIT'; const st=styleFor(lt); const line=createSvgElement('line',{ x1:a.x,y1:a.y,x2:b.x,y2:b.y, stroke:st.stroke, 'stroke-width':String(st.width*state.widthScale), ...(st.dash&&{'stroke-dasharray':st.dash}) }); svg.appendChild(line); const lenLbl=placeLengthLabel(a.x,a.y,b.x,b.y, fmtKm(s.km)); const hist={kind:'seg', segId:s.id, nodeId:s.to, from:s.from, km:s.km, type:lt, els:[line,lenLbl], tapNode:s.to}; state.segs.push({id:s.id, from:s.from, to:s.to, km:s.km, lineType:lt}); state.history.push(hist); addListRow('Line', `${st.label} • ${fmtKm(s.km)}`, ()=>focusEls([line,lenLbl]), ()=>pushTapFromNode(s.to), ()=>deleteSeg(hist)); state.idc=Math.max(state.idc, s.id+1); });
  (data.symbols||[]).forEach(sym=>{ const cur=state.nodes.find(n=>n.id===sym.at); if(!cur) return; const s=state.symbolScale; const g=createSymbolElement(sym.kind, sym.kindId, sym.meta, cur.x, cur.y, s); if(g){ svg.appendChild(g); const lblEls=[]; if(sym.meta){ const t=placeLabel(cur.x, cur.y-14*s, sym.meta); lblEls.push(t); } const hist={kind:'sym', els:[g,...lblEls], rec:sym, tapNode:sym.at}; state.symbols.push(sym); state.history.push(hist); addListRow((sym.kindId||sym.kind).toUpperCase(), sym.meta||'', ()=>focusEls([g,...lblEls]), ()=>pushTapFromNode(sym.at), ()=>deleteSym(hist)); }});
  state.current=data.current; state.dir=data.dir||'right'; setDir(state.dir); if(state.current){ const c=state.nodes.find(n=>n.id===state.current); if(c) moveActive(c.x,c.y); }
  setStatus(); applyWidthMultiplier(state.widthScale); applySymbolScale(state.symbolScale); centerView();
  showToast(`Loaded "${r.title}" (ID ${r.id})`,'success');
} catch(e){ showToast('Load failed: '+e.message,'danger'); } }
async function listMapsServer(){ try{ return await listFromServer(); } catch(e){ showToast('List failed: '+e.message,'danger'); return []; } }
async function deleteMapServer(id,title){ try{ await deleteFromServer(id); if(currentServerId===id) currentServerId=null; showToast(`Deleted map ID ${id}${title?(' ('+title+')'):''}.`,'success'); } catch(e){ showToast('Delete failed: '+e.message,'danger'); } }
async function rehydrateFromData(data, mapTitle) {
  try {
    clearAll();

    // restore scalars & UI
    state.scale = data.scale || state.scale;
    document.getElementById('scaleInput').value = state.scale;
    state.ssName = data.ssName || '';
    document.getElementById('ssName').value = state.ssName;
    state.widthScale = data.widthScale || 1;
    document.getElementById('widthScale').value = state.widthScale;
    state.symbolScale = data.symbolScale || 1;
    document.getElementById('symbolScale').value = state.symbolScale;
    if (data.customComponents) state.customComponents = data.customComponents;

    // legend pos (optional)
    if (data.legendPos) {
      const legend = document.getElementById('legend');
      legend.style.top = (data.legendPos.top||12) + 'px';
      legend.style.left = (data.legendPos.left||12) + 'px';
      legend.style.width = (data.legendPos.width||280) + 'px';
      legend.style.height = (data.legendPos.height||'auto');
    }

    // nodes
    (data.nodes || []).forEach(n => {
      const nid = createNode(n.x, n.y, n.label, n.type);
      // keep original ids
      state.nodes[state.nodes.length - 1].id = n.id;
      state.idc = Math.max(state.idc, n.id + 1);
    });

    // segments (lines)
    (data.segs || []).forEach(s => {
      const a = nodeById(s.from), b = nodeById(s.to);
      if (!a || !b) return;
      const style = styleFor(s.lineType || 'RABBIT');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      line.setAttribute('stroke', style.stroke);
      line.setAttribute('stroke-width', String(style.width * state.widthScale));
      if (style.dash) line.setAttribute('stroke-dasharray', style.dash);
      document.getElementById('view').appendChild(line);
      const lenLbl = placeLengthLabel(a.x, a.y, b.x, b.y, (Math.round(s.km*100)/100).toFixed(2).replace(/\.00$/,''));
      const hist = { kind:'seg', segId: s.id, nodeId: s.to, from: s.from, km: s.km, type: s.lineType, els:[line, lenLbl], tapNode: s.to };
      state.segs.push({ id: s.id, from: s.from, to: s.to, km: s.km, lineType: s.lineType });
      state.history.push(hist);
      addListRow('Line', `${style.label} • ${s.km}`, () => focusEls([line, lenLbl]), () => {}, () => {});
      state.idc = Math.max(state.idc, s.id + 1);
    });

    // symbols
    (data.symbols || []).forEach(sym => {
      const node = nodeById(sym.at);
      if (!node) return;
      const g = createSymbolElement(sym.kind, sym.kindId, sym.meta, node.x, node.y, state.symbolScale);
      if (g) {
        document.getElementById('view').appendChild(g);
        const lblEls = [];
        if (sym.meta) {
          const t = (function placeLabel(x, y, text, cls='label') {
            const t = document.createElementNS('http://www.w3.org/2000/svg','text');
            t.setAttribute('x', x); t.setAttribute('y', y - 14*state.symbolScale);
            t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'label'); t.textContent = text;
            document.getElementById('view').appendChild(t);
            return t;
          })(node.x, node.y, sym.meta);
          lblEls.push(t);
        }
        const hist = { kind:'sym', els:[g, ...lblEls], rec:sym, tapNode:sym.at };
        state.symbols.push(sym);
        state.history.push(hist);
      }
    });

    state.current = data.current || null;
    setDir(data.dir || 'right');
    document.getElementById('mapName').value = mapTitle || '';
    setStatus();
    centerView();
    showToast(`Map "${mapTitle||''}" loaded.`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Failed to render map.', 'danger');
  }
}

/*** HTVR & report ***/
function clearHTVR(){ htvrOverlays.forEach(el=>el.remove()); htvrOverlays=[]; }
function clearReport(){ if(!reportBox) return; reportBox.style.display='none'; reportBox.innerHTML=''; }
function computeDownstream(){ const children={}; state.segs.forEach(s=>{ (children[s.from] ||= []).push(s.to); }); const nodeKVA={}; state.symbols.forEach(sym=>{ if(sym.kind==='dtr'||sym.kind==='ht'){ const k=parseFloat((sym.meta||'').replace(/[^0-9.]/g,''))||0; if(!isNaN(k)) nodeKVA[sym.at]=(nodeKVA[sym.at]||0)+k; } }); const memo={}; function sumKVA(id){ if(memo[id]!=null) return memo[id]; let t=nodeKVA[id]||0; const ch=children[id]||[]; for(const v of ch) t+=sumKVA(v); memo[id]=t; return t; } const ss=state.nodes.find(n=>n.type==='ss')?.id || state.nodes[0]?.id; if(!ss) return {sumKVA:null,totalKVA:0}; const totalKVA=sumKVA(ss); return {sumKVA,totalKVA}; }
function generateHTVR(maxA){ clearHTVR(); const {sumKVA,totalKVA}=computeDownstream(); if(!sumKVA){ showToast('Add Substation and loads first.','warn'); return []; } if(!(maxA>0)){ showToast('Enter Max line current.','warn'); return []; } const DF=totalKVA/(1.73*11*maxA); const results=[]; state.segs.forEach((s,idx)=>{ const kv=sumKVA(s.to)||0; const a=nodeById(s.from), b=nodeById(s.to); const coef=COEF[s.lineType]||COEF['RABBIT']; const pctVR=(kv*s.km*coef.num)/(coef.denom*(DF||1)); const lbl=placeHTVRLabel(a.x,a.y,b.x,b.y,(Math.round(pctVR*100)/100).toFixed(2)+'%', pctVR); htvrOverlays.push(lbl); results.push({ index:idx+1, from:s.from, to:s.to, type:coef.label, rawType:s.lineType, km:s.km, kva:kv, df:DF, vrpct:pctVR }); }); return {rows:results, DF, totalKVA}; }
function buildReport(rows, DF, maxA, mapName){ const date=new Date().toLocaleString(); const feeder=(mapNameInput?.value||mapName||'Untitled'); const ss=(state.ssName||'—'); const totalVR=rows.reduce((t,r)=>t+r.vrpct,0); if(!reportBox) return; reportBox.innerHTML = `<h4>%HTVR Report</h4><div class="meta"><b>Feeder:</b> ${feeder} &nbsp;•&nbsp; <b>Substation:</b> ${ss}&nbsp;•&nbsp; Base: 11 kV &nbsp;•&nbsp; <b>Max A:</b> ${maxA} &nbsp;•&nbsp; <b>DF:</b> ${DF.toFixed(3)} &nbsp;•&nbsp; ${date}</div><div style="font-size:11px; margin-bottom:8px; color: var(--muted);">DF formula: Total kVA ÷ (1.73 × 11 × Max A).</div><table><thead><tr><th>#</th><th>Seg</th><th>Conductor</th><th class="right">Len (km)</th><th class="right">Down KVA</th><th class="right">%VR (section)</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.index}</b></td><td>${r.from}→${r.to}</td><td>${r.type}</td><td class="right">${fmtKm(r.km)}</td><td class="right">${(Math.round(r.kva*10)/10).toFixed(1)}</td><td class="right"><b>${(Math.round(r.vrpct*100)/100).toFixed(2)}%</b></td></tr>`).join('')}</tbody><tfoot><tr><th colspan="5" class="right"><b>Total %VR</b></th><th class="right"><b>${(Math.round(totalVR*100)/100).toFixed(2)}%</b></th></tr></tfoot></table>`; reportBox.style.display='block'; }
function exportHTVRPDF() {
  if (!reportBox || reportBox.innerHTML.trim() === '') {
    showToast('Generate %HTVR first.', 'warn');
    return;
  }
  const reportClone = reportBox.cloneNode(true);
  const title = mapNameInput?.value || 'Untitled Feeder';
  const printHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>%HTVR Report</title>
      <style>
        body{margin:0; padding:20mm; font-family:system-ui, sans-serif;}
        @page{size:A4 portrait; margin:20mm;}
        h4{font-size:16px; font-weight:bold; text-align:center; margin-bottom:10px; color:black;}
        .meta{font-size:11px; text-align:center; margin-bottom:15px; color:#333;}
        table{width:100%; border-collapse:collapse; font-size:10px;}
        th,td{border:1px solid black; padding:6px 8px; text-align:left;}
        th{font-weight:bold; background:#e9e9e9;}
        .right{text-align:right;}
        tfoot th{background:#dcdcdc;}
      </style>
    </head>
    <body>
      ${reportClone.outerHTML.replace('<h4>%HTVR Report</h4>', `<h4>%HTVR Report: ${title}</h4>`)}
    </body>
    </html>`;
  const w = window.open('', '_blank');
  if (!w) { showToast('Please allow pop-ups for printing.', 'warn'); return; }
  w.document.write(printHtml);
  w.document.close();
  w.focus();
  w.onload = () => { w.print(); w.onafterprint = () => w.close(); };
}

/*** draggables & scaling ***/
let isDragging=false, initialX, initialY, initialLeft, initialTop;
if (legend) {
  legend.addEventListener('mousedown', e=>{ isDragging=true; initialX=e.clientX; initialY=e.clientY; initialLeft=legend.offsetLeft; initialTop=legend.offsetTop; legend.style.cursor='grabbing'; });
  document.addEventListener('mousemove', e=>{ if(!isDragging) return; const dx=e.clientX-initialX; const dy=e.clientY-initialY; legend.style.left=(initialLeft+dx)+'px'; legend.style.top=(initialTop+dy)+'px'; });
  document.addEventListener('mouseup', ()=>{ isDragging=false; legend.style.cursor='grab'; });
}
function applyWidthMultiplier(m){ [...svg.querySelectorAll('line,path,rect,circle,polyline,polygon')].forEach(el=>{ const stroke=el.getAttribute('stroke'); if(!stroke) return; const baseAttr=el.getAttribute('data-base-width'); if(!baseAttr){ const cur=parseFloat(el.getAttribute('stroke-width'))||1; el.setAttribute('data-base-width', String(cur)); el.setAttribute('stroke-width', String((cur*m).toFixed(3))); } else { const base=parseFloat(baseAttr)||1; el.setAttribute('stroke-width', String((base*m).toFixed(3))); } }); [...svg.querySelectorAll('text,.label,.lengthLabel,.htvrLabel')].forEach(t=>{ const baseAttr=t.getAttribute('data-base-stroke'); const curStroke=parseFloat(t.getAttribute('stroke-width'))||0; if(!baseAttr){ t.setAttribute('data-base-stroke', String(curStroke||3)); t.setAttribute('stroke-width', String(Math.max(0.5,(parseFloat(t.getAttribute('data-base-stroke'))||1)*m))); } else { const base=parseFloat(baseAttr)||1; t.setAttribute('stroke-width', String(Math.max(0.5, base*m))); } }); }
function applySymbolScale(s){ [...svg.querySelectorAll('[data-sym]')].forEach(el=>{ const tr=el.getAttribute('transform'); if(tr){ const m=/translate\(([^,]+),([^)]+)\)/.exec(tr); if(m){ const x=m[1].trim(), y=m[2].trim(); el.setAttribute('transform', `translate(${x}, ${y}) scale(${s})`); } } }); }
widthScaleInput?.addEventListener('input', e=>{ state.widthScale=Number(e.target.value)||1; applyWidthMultiplier(state.widthScale); });
symbolScaleInput?.addEventListener('input', e=>{ state.symbolScale=Number(e.target.value)||1; applySymbolScale(state.symbolScale); });
const mo=new MutationObserver(muts=>{ muts.forEach(m=>{ m.addedNodes?.forEach(node=>{ if(!(node instanceof SVGElement)) return; if(['line','path','rect','circle','polyline','polygon'].includes(node.tagName)){ const sw=parseFloat(node.getAttribute('stroke-width'))||1; node.setAttribute('data-base-width', String(sw)); node.setAttribute('stroke-width', String((sw*state.widthScale).toFixed(3))); } }); }); }); mo.observe(svg,{childList:true, subtree:true});

/*** custom components ***/
function handleAddNewComponent(){ showModal({ title:'Add New Component Type',
  inputs:[ {id:'newCompName',type:'text',placeholder:'Component Name (e.g., HV Meter)'}, {id:'newCompSymbol',type:'select',options:{ diamond:'Diamond', square:'Square', circle:'Circle', cross:'Cross' } } ],
  buttons:{ cancel:{text:'Cancel'}, ok:{ text:'Add', action:(v)=>{ const name=(v.newCompName||'').trim(); const symbol=v.newCompSymbol; if(!name){ showToast('Component name cannot be empty.','warn'); return; } const id=`custom_${Date.now()}`; state.customComponents.push({ id, name, symbol }); updateComponentList(); showToast(`Added "${name}" to component list.`,'success'); componentSelect.value = id; } } }
});}
function updateComponentList(){ componentSelect.querySelectorAll('option[value^="custom_"]').forEach(o=>o.remove()); const anchor=componentSelect.querySelector('option[value="ADD_NEW"]'); state.customComponents.forEach(comp=>{ const opt=document.createElement('option'); opt.value=comp.id; opt.textContent=comp.name; componentSelect.insertBefore(opt, anchor); });
  const sec=$('components-legend-section'); if(!sec) return;
  sec.querySelectorAll('.custom-legend-item').forEach(x=>x.remove());
  state.customComponents.forEach(comp=>{ const info=AVAILABLE_SYMBOLS[comp.symbol]; const item=document.createElement('div'); item.className='item custom-legend-item'; const s=document.createElementNS(svgNS,'svg'); s.setAttribute('viewBox','0 0 20 20'); const p=document.createElementNS(svgNS,'path'); p.setAttribute('d', info.d); p.setAttribute('fill', info.fill||info.color); p.setAttribute('stroke', info.stroke||info.color); p.setAttribute('stroke-width', info['stroke-width']||1.2); p.setAttribute('transform', 'translate(10,10) scale(1.2)'); s.appendChild(p); item.appendChild(s); item.append(comp.name); sec.appendChild(item); });
}
function resetComponentList(){ componentSelect.querySelectorAll('option[value^="custom_"]').forEach(o=>o.remove()); const sec=$('components-legend-section'); sec?.querySelectorAll('.custom-legend-item').forEach(x=>x.remove()); }

/*** bindings ***/
document.querySelectorAll('#dirPad button').forEach(b=> b.addEventListener('click', ()=> setDir(b.dataset.dir)));
window.addEventListener('keydown', e=>{ if(document.activeElement.tagName==='INPUT') return; if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){ e.preventDefault(); const map={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'}; setDir(map[e.key]); } });
$('btnCreateSS')?.addEventListener('click', ()=>{ const name=$('ssName').value.trim(); if(!name){ showToast('Enter substation name.','warn'); return; } if(state.nodes.length){ showModal({ title:'New Substation', message:'This will clear the existing map. Are you sure?', buttons:{ cancel:{text:'Cancel'}, ok:{ text:'Clear & Create', class:'danger', action:()=>{ clearAll(); const id=createNode(140,340,name,'ss'); state.current=id; state.ssName=name; setStatus(); }}}}); } else { const id=createNode(140,340,name,'ss'); state.current=id; state.ssName=name; setStatus(); } });
$('btnAddLine')?.addEventListener('click', ()=> addLine($('lineKm').value, $('lineType').value));
$('btnAddMarker')?.addEventListener('click', addMarker);
componentSelect?.addEventListener('change', e=>{ const v=e.target.value; if(v==='ADD_NEW'){ handleAddNewComponent(); e.target.value=componentSelect.options[0].value; } htKvaLabel.style.display = v==='HT' ? 'block':'none'; htKvaInput.style.display = v==='HT' ? 'block':'none'; componentInputs.style.display = v==='HT' ? 'block':'none'; });
$('btnAddComponent')?.addEventListener('click', addXfmrOrSwitchgear);
$('btnStartTap')?.addEventListener('click', startTap);
$('btnEndTap')?.addEventListener('click', endTap);
$('btnUndo')?.addEventListener('click', undo);
$('btnClear')?.addEventListener('click', ()=>{ if(!state.nodes.length){ showToast('Map is already clear.','info'); return; } showModal({ title:'Clear Diagram', message:'Are you sure you want to clear the entire diagram? This cannot be undone.', buttons:{ cancel:{text:'Cancel'}, ok:{ text:'Clear', class:'danger', action:()=>{ clearAll(); showToast('Map cleared.','success'); } } } }); });
$('btnExport')?.addEventListener('click', exportSVG);
$('btnPDF')?.addEventListener('click', exportPDF);
$('btnCenter')?.addEventListener('click', centerView);
$('btnHTVR')?.addEventListener('click', ()=>{ const maxA=Number($('maxAmp').value); const out=generateHTVR(maxA); if(out && out.rows){ buildReport(out.rows, out.DF, maxA, mapNameInput?.value); showToast('HTVR report generated.','success'); }});
$('btnClearHTVR')?.addEventListener('click', ()=>{ clearHTVR(); clearReport(); showToast('HTVR data cleared.','info'); });
$('btnHTVRPDF')?.addEventListener('click', exportHTVRPDF);
scaleInput?.addEventListener('change', ()=>{ const v=Number(scaleInput.value); if(v>0){ state.scale=v; setStatus(); } else { showToast('Enter valid scale (px/km).','warn'); } });
$('btnNewMap')?.addEventListener('click', ()=>{ if(state.nodes.length){ showModal({ title:'New Map', message:'This will clear your current unsaved work. Are you sure?', buttons:{ cancel:{text:'Cancel'}, ok:{ text:'Create New', class:'danger', action:()=>{ clearAll(); mapNameInput.value=''; $('ssName').value=''; }}}}); } else { clearAll(); mapNameInput.value=''; $('ssName').value=''; }});

/*** Save/Open/Delete — SERVER-backed ***/
$('btnSaveMap').addEventListener('click', async () => {
  const name = document.getElementById('mapName').value.trim();
  if (!name) { showToast('Enter map name.', 'warn'); return; }
  try {
    const payload = (typeof saveMapData === 'function') ? saveMapData() : null;
    if (!payload) { showToast('No map data to save.', 'warn'); return; }
    const res = await fetch('/api/maps', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title: name, data: payload })
    });
    if (!res.ok) throw new Error('Server save failed');
    const json = await res.json(); // { id }
    showToast(`Saved on server (id=${json.id}).`, 'success');
  } catch (e) {
    console.error(e);
    showToast('Server save failed.', 'danger');
  }
});

$('btnOpenMap').addEventListener('click', async () => {
  try {
    const items = await (async function listMapsFromServer() {
      const res = await fetch('/api/maps');
      if (!res.ok) throw new Error('Failed to list maps');
      const j = await res.json();
      return j.items || [];
    })();

    if (!items.length) { showToast('No maps on server.', 'info'); return; }

    // Build a searchable modal using your existing modal system
    showModal({
      title: 'Open Map (Server)',
      message: '',
      inputs: [{ id: 'searchText', type: 'text', placeholder: 'Search by title or id...' }],
      type: 'list',
      items: items.map(i => `${i.id} — ${i.title}`),
      buttons: {
        cancel: { text: 'Cancel' },
        ok: {
  text: 'Open',
  action: async (selectedItem) => {
    if (!selectedItem) {
      showToast('Pick a map.', 'warn');
      return;
    }
            const selectedText = (typeof selectedItem === 'string')
      ? selectedItem
      : (selectedItem.dataset?.value || '');

    if (!selectedText) {
      showToast('Pick a map.', 'warn');
      return;
    }

    const id = Number(selectedText.split(' — ')[0]);
    const res = await fetch(`/api/maps/${id}`);
    if (!res.ok) {
      showToast('Failed to load map from server.', 'danger');
      return;
    }
    const record = await res.json(); // { id, title, data }
    await rehydrateFromData(record.data, record.title);
  }
});

    // wire up live search (we can access the modal elements)
    const input = document.getElementById('searchText');
    const listDiv = document.getElementById('modal-list');
    input?.addEventListener('input', () => {
      const q = (input.value || '').toLowerCase();
      // clear and repopulate
      listDiv.innerHTML = '';
      items
        .filter(i => String(i.id).includes(q) || (i.title||'').toLowerCase().includes(q))
        .map(i => `${i.id} — ${i.title}`)
        .forEach(text => {
          const div = document.createElement('div');
          div.className = 'modal-list-item';
          div.textContent = text;
          div.dataset.value = text;
          div.onclick = () => {
            listDiv.querySelectorAll('.selected').forEach(s => s.classList.remove('selected'));
            div.classList.add('selected');
          };
          listDiv.appendChild(div);
        });
    });
  } catch (e) {
    console.error(e);
    showToast('Failed to fetch maps from server.', 'danger');
  }
});
/*** Quick Demo ***/
$('btnDemo')?.addEventListener('click', ()=>{
  showModal({ title:'Run Demo?', message:'This will clear the current map and draw a sample feeder.', buttons:{ cancel:{text:'Cancel'}, ok:{ text:'Run Demo', class:'success', action:()=>{
    clearAll(); state.scale=Number(scaleInput?.value)||120; const ss=createNode(200,400,'Demo 66/11kV','ss'); state.current=ss; state.ssName='Demo 66/11kV'; $('ssName').value=state.ssName; setDir('right'); setStatus();
    const addFrom=(v)=>{ const prev=componentSelect.value; componentSelect.value=v; addXfmrOrSwitchgear(); componentSelect.value=prev; }
    addLine(0.25,'RABBIT'); addFrom('T63'); addLine(0.30,'DOG'); addFrom('T100');
    startTap(); addLine(0.20,'UG185'); addFrom('T25'); addFrom('RMU3'); endTap();
    addLine(0.40,'PROPDOG'); addFrom('T200'); addFrom('SW'); addFrom('FP');
    $('maxAmp').value=200; if(mapNameInput) mapNameInput.value='Demo Feeder';
    const out=generateHTVR(200); if(out && out.rows) buildReport(out.rows, out.DF, 200, 'Demo Feeder');
    centerView(); showToast('Demo map created!','success');
  }}}});
});

/*** init ***/
try { setDir('right'); setStatus(); readyOK(); } catch(err){ readyERR(err?.message||String(err)); }
})();
