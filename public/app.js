// public/app.js
// Wire Save/Open to server API, add searchable Open modal, and robust rehydration.
// This file *re-uses* helpers defined in your original inline script (saveMapData, clearAll, createNode, etc).

(() => {
  // ---------- config ----------
  // If UI and API are on the same domain (Render), keep empty:
  const BASE_URL = ""; 
  // If testing local UI against deployed API, set:
  // const BASE_URL = "https://YOUR-APP.onrender.com";

  // ---------- tiny DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const svg = () => document.getElementById('view');

  // ---------- Toast fallback ----------
  function toast(msg, type='info') {
    if (typeof showToast === 'function') return showToast(msg, type);
    console.log(`[${type}] ${msg}`);
  }

  // ---------- Server API helpers ----------
  async function saveMapToServer(title, dataObj, id = null) {
    const res = await fetch(`${BASE_URL}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id != null ? { id, title, data: dataObj } : { title, data: dataObj })
    });
    if (!res.ok) throw new Error(`Server save failed (${res.status})`);
    const json = await res.json(); // { id }
    return json.id;
  }

  async function listMapsFromServer() {
    const res = await fetch(`${BASE_URL}/api/maps`);
    if (!res.ok) throw new Error(`Failed to list maps (${res.status})`);
    const json = await res.json(); // { items: [{id,title,updatedAt}] }
    return json.items || [];
  }

  async function loadMapFromServer(id) {
    const res = await fetch(`${BASE_URL}/api/maps/${id}`);
    if (!res.ok) throw new Error(`Failed to load map (${res.status})`);
    return await res.json(); // { id, title, data, createdAt, updatedAt }
  }

  // ---------- createSymbolElement (used by rehydration) ----------
  // Relies on your existing css(), xfColor(), and state.
  function createSymbolElement(kind, kindId, meta, x, y, scale) {
    const s = (window.state?.symbolScale ?? 1) * (scale || 1);
    const svgNS = 'http://www.w3.org/2000/svg';
    const cssVar = (name) => typeof css === 'function' ? css(name) : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const xf = (kva) => typeof xfColor === 'function' ? xfColor(kva) : '#7fb3ff';
    const el = (tag, attrs) => { const n = document.createElementNS(svgNS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

    if (kindId?.startsWith('T') || kind === 'dtr') {
      const kva = parseFloat((meta||'').replace(/[^0-9.]/g,'')||'0');
      return el('path', { d: `M -9 8 L 9 8 L 0 -10 Z`, fill: xf(kva), stroke: cssVar('--tStroke'), 'stroke-width': '1.2', 'data-sym':'dtr', 'data-kind-id': kindId || kind, transform: `translate(${x},${y}) scale(${s})` });
    }
    if (kindId === 'HT' || kind === 'ht') {
      const g = el('g', { 'data-sym':'ht', 'data-kind-id':'HT', transform:`translate(${x},${y}) scale(${s})` });
      g.appendChild(el('rect', { x:-10, y:-7, width:20, height:14, rx:3, fill:'#223f1f', stroke:'#65c95a', 'stroke-width':'1.8' }));
      return g;
    }
    if (kindId === 'RMU3' || kind === 'rmu3') {
      const g = el('g', { 'data-sym':'rmu3','data-kind-id':'RMU3', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('path',{d:`M -6 -6 L 6 -6 L 6 6 L -6 6 Z`, fill:cssVar('--rmu3'), stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:0,y1:-6,x2:0,y2:-10,stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:0,y1:6,x2:0,y2:10,stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:6,y1:0,x2:10,y2:0,stroke:cssVar('--tStroke'),'stroke-width':'1.5'})
      );
      return g;
    }
    if (kindId === 'RMU4' || kind === 'rmu4') {
      const g = el('g', { 'data-sym':'rmu4','data-kind-id':'RMU4', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('path',{d:`M -6 -6 L 6 -6 L 6 6 L -6 6 Z`, fill:cssVar('--rmu4'), stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:0,y1:-6,x2:0,y2:-10,stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:0,y1:6,x2:0,y2:10,stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:-6,y1:0,x2:-10,y2:0,stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:6,y1:0,x2:10,y2:0,stroke:cssVar('--tStroke'),'stroke-width':'1.5'})
      );
      return g;
    }
    if (kindId === 'SW' || kind === 'sw') {
      const g = el('g', { 'data-sym':'sw','data-kind-id':'SW', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('circle',{cx:0,cy:0,r:5,fill:cssVar('--sw'),stroke:cssVar('--tStroke'),'stroke-width':'1.5'}),
        el('line',{x1:0,y1:0,x2:10,y2:0,stroke:cssVar('--tStroke'),'stroke-width':'1.5'})
      );
      return g;
    }
    if (kindId === 'FP' || kind === 'fp') {
      return el('rect', { x:-6,y:-6,width:12,height:12, fill:cssVar('--feederPillar'), stroke:cssVar('--tStroke'), 'stroke-width':'1.2', 'data-sym':'fp','data-kind-id':'FP', transform:`translate(${x},${y}) scale(${s})` });
    }
    if (kindId === 'LA' || kind === 'la') {
      const g = el('g', { 'data-sym':'la','data-kind-id':'LA', transform:`translate(${x},${y}) scale(${s})` });
      g.append(el('path',{ d:'M -6 -8 H 6 V -2 H -6 Z M 0 -2 V 4 M -8 4 H 8', fill:'none', stroke:cssVar('--lightningArrester'),'stroke-width':'1.5'}));
      return g;
    }
    if (kindId === 'SEC' || kind === 'sec') {
      const g = el('g', { 'data-sym':'sec','data-kind-id':'SEC', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('rect',{x:-5,y:-5,width:10,height:10,fill:'none',stroke:cssVar('--sectionaliser'),'stroke-width':'1.5'}),
        el('text',{x:0,y:3,'font-size':'8px','text-anchor':'middle',fill:cssVar('--ink')}, 'S')
      );
      return g;
    }
    if (kindId === 'AR' || kind === 'ar') {
      const g = el('g', { 'data-sym':'ar','data-kind-id':'AR', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('rect',{x:-5,y:-5,width:10,height:10,fill:'none',stroke:cssVar('--autoRecloser'),'stroke-width':'1.5'}),
        el('text',{x:0,y:3,'font-size':'7px','text-anchor':'middle',fill:cssVar('--ink')}, 'AR')
      );
      return g;
    }
    if (kindId === 'DOF' || kind === 'dof') {
      const g = el('g', { 'data-sym':'dof','data-kind-id':'DOF', transform:`translate(${x},${y}) scale(${s})` });
      g.append(
        el('circle',{cx:0,cy:0,r:6,fill:'none',stroke:cssVar('--dropOutFuse'),'stroke-width':'1.5'}),
        el('line',{x1:-4,y1:4,x2:4,y2:-4,stroke:cssVar('--dropOutFuse'),'stroke-width':'1.5'})
      );
      return g;
    }
    // fallback custom
    return el('path', { d:'M 0 -9 L 7 0 L 0 9 L -7 0 Z', fill: cssVar('--customSymbol'), stroke: cssVar('--customSymbol'), 'stroke-width':'1.2', 'data-sym':'custom', 'data-kind-id': kindId || 'custom', transform:`translate(${x},${y}) scale(${s})` });
  }

  // ---------- Robust rehydration from server data ----------
  // Uses your existing helpers: clearAll, createNode, nodeById, styleFor, placeLengthLabel, addListRow, setDir, setStatus, centerView, state
  async function rehydrateFromData(data, mapTitle) {
    try {
      if (typeof clearAll !== 'function') throw new Error('clearAll missing');
      clearAll();

      // restore UI scalars
      if (window.state) {
        state.scale = data.scale ?? state.scale;
        state.ssName = data.ssName ?? '';
        state.widthScale = data.widthScale ?? 1;
        state.symbolScale = data.symbolScale ?? 1;
        state.customComponents = data.customComponents ?? [];
      }
      if ($('scaleInput')) $('scaleInput').value = state.scale;
      if ($('ssName')) $('ssName').value = state.ssName;
      if ($('widthScale')) $('widthScale').value = state.widthScale;
      if ($('symbolScale')) $('symbolScale').value = state.symbolScale;

      // legend position
      if (data.legendPos && $('legend')) {
        const l = $('legend');
        l.style.top = (data.legendPos.top ?? 12) + 'px';
        l.style.left = (data.legendPos.left ?? 12) + 'px';
        if (data.legendPos.width)  l.style.width  = data.legendPos.width + 'px';
        if (data.legendPos.height) l.style.height = data.legendPos.height + 'px';
      }

      // nodes
      (data.nodes || []).forEach(n => {
        const nid = createNode(n.x, n.y, n.label, n.type);
        state.nodes[state.nodes.length - 1].id = n.id;
        state.idc = Math.max(state.idc, n.id + 1);
      });

      // segments
      (data.segs || []).forEach(s => {
        const a = nodeById(s.from), b = nodeById(s.to);
        if (!a || !b) return;
        const st = styleFor(s.lineType || 'RABBIT');
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
        line.setAttribute('stroke', st.stroke);
        line.setAttribute('stroke-width', String(st.width * (state.widthScale || 1)));
        if (st.dash) line.setAttribute('stroke-dasharray', st.dash);
        svg().appendChild(line);

        const kmTxt = (() => {
          const v = Number(s.km); if (!isFinite(v)) return '';
          const r = Math.round(v * 100) / 100;
          return String(r).replace(/\.00$/, '');
        })();
        const lenLbl = (typeof placeLengthLabel === 'function')
          ? placeLengthLabel(a.x, a.y, b.x, b.y, kmTxt)
          : null;

        const hist = { kind:'seg', segId: s.id, nodeId: s.to, from: s.from, km: s.km, type: s.lineType, els:[line, ...(lenLbl?[lenLbl]:[])], tapNode: s.to };
        state.segs.push({ id: s.id, from: s.from, to: s.to, km: s.km, lineType: s.lineType });
        state.history.push(hist);

        if (typeof addListRow === 'function') {
          addListRow('Line', `${st.label} • ${kmTxt}`, () => {}, () => {}, () => {});
        }
        state.idc = Math.max(state.idc, s.id + 1);
      });

      // symbols
      (data.symbols || []).forEach(sym => {
        const at = nodeById(sym.at);
        if (!at) return;
        const g = createSymbolElement(sym.kind, sym.kindId, sym.meta, at.x, at.y, 1);
        if (g) {
          svg().appendChild(g);
          if (sym.meta) {
            const t = document.createElementNS('http://www.w3.org/2000/svg','text');
            t.setAttribute('x', at.x);
            t.setAttribute('y', at.y - 14 * (state.symbolScale || 1));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'label');
            t.textContent = sym.meta;
            svg().appendChild(t);
          }
          const hist = { kind:'sym', els:[g], rec:sym, tapNode:sym.at };
          state.symbols.push(sym);
          state.history.push(hist);
        }
      });

      state.current = data.current ?? null;
      if (typeof setDir === 'function') setDir(data.dir || 'right');
      if ($('mapName')) $('mapName').value = mapTitle || '';
      if (typeof setStatus === 'function') setStatus();
      if (typeof centerView === 'function') centerView();
      toast(`Map "${mapTitle||''}" loaded.`, 'success');
    } catch (err) {
      console.error(err);
      toast('Failed to render map.', 'danger');
    }
  }

  // ---------- Save button: POST to server ----------
  function bindSave() {
    const btn = $('btnSaveMap');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const name = $('mapName')?.value?.trim();
        if (!name) { toast('Enter map name.', 'warn'); return; }
        if (typeof saveMapData !== 'function') { toast('saveMapData() missing.', 'danger'); return; }
        const payload = saveMapData();
        const id = await saveMapToServer(name, payload);
        // optional: keep a local copy for offline
        localStorage.setItem('sld_map_' + name, JSON.stringify(payload));
        toast(`Saved on server (id=${id}).`, 'success');
      } catch (e) {
        console.error(e);
        toast('Server save failed.', 'danger');
      }
    });
  }

  // ---------- Open button: searchable list, robust selection, render ----------
  function bindOpen() {
    const btn = $('btnOpenMap');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const items = await listMapsFromServer(); // [{id,title,updatedAt}]
        if (!items.length) { toast('No maps on server.', 'info'); return; }

        // Use your existing modal. We pass items as strings "id — title"
        if (typeof showModal !== 'function') {
          console.warn('showModal missing; falling back to prompt.');
          const pick = prompt('Enter map id to open:\n' + items.map(i => `${i.id} — ${i.title}`).join('\n'));
          const id = Number((pick||'').split('—')[0].trim());
          if (id) {
            const record = await loadMapFromServer(id);
            await rehydrateFromData(record.data, record.title);
          }
          return;
        }

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
              action: async (selectedValue) => {
                // Your modal returns a string from dataset.value; guard anyway:
                const selectedText = (typeof selectedValue === 'string')
                  ? selectedValue
                  : (selectedValue?.dataset?.value || '');
                if (!selectedText) { toast('Pick a map.', 'warn'); return; }

                const idPart = selectedText.split(' — ')[0];
                const id = Number((idPart || '').trim());
                if (!id) { toast('Invalid selection.', 'warn'); return; }

                const record = await loadMapFromServer(id);
                await rehydrateFromData(record.data, record.title);
              }
            }
          }
        });

        // Live search wiring for your modal
        const input = document.getElementById('searchText');
        const listDiv = document.getElementById('modal-list');
        if (input && listDiv) {
          const renderList = (arr) => {
            listDiv.innerHTML = '';
            arr.forEach(text => {
              const div = document.createElement('div');
              div.className = 'modal-list-item';
              div.textContent = text;
              div.dataset.value = text; // IMPORTANT: so OK handler receives a string
              div.onclick = () => {
                listDiv.querySelectorAll('.selected').forEach(s => s.classList.remove('selected'));
                div.classList.add('selected');
              };
              listDiv.appendChild(div);
            });
          };
          const all = items.map(i => `${i.id} — ${i.title}`);
          renderList(all);
          input.addEventListener('input', () => {
            const q = (input.value || '').toLowerCase();
            renderList(all.filter(t => t.toLowerCase().includes(q)));
          });
        }
      } catch (e) {
        console.error(e);
        toast('Failed to fetch maps from server.', 'danger');
      }
    });
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    bindSave();
    bindOpen();
    console.log('[app.js] Save/Open wired to server API.');
  });
})();
