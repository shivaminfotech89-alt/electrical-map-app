// public/server-override.js
// Override only saveMap, listMaps, loadMap to use your /api/maps server.
// Everything else in your big script stays untouched.

(() => {
  const BASE_URL = ""; // keep empty if UI + API are on the same Render app
  const $ = (id) => document.getElementById(id);
  const toast = (m, t='info') => (typeof showToast === 'function' ? showToast(m, t) : console.log(`[${t}] ${m}`));

  // keep originals in case we need them
  const original = {
    saveMap: window.saveMap,
    listMaps: window.listMaps,
    loadMap: window.loadMap,
  };

  // cache a title -> id map for server items
  let serverIndex = new Map(); // title => id

  async function apiList() {
    const r = await fetch(`${BASE_URL}/api/maps`);
    if (!r.ok) throw new Error(`List failed: ${r.status}`);
    const j = await r.json(); // { items:[{id,title,updatedAt}] }
    serverIndex = new Map(j.items.map(i => [i.title, i.id]));
    return j.items;
  }

  async function apiRead(id) {
    const r = await fetch(`${BASE_URL}/api/maps/${id}`);
    if (!r.ok) throw new Error(`Load failed: ${r.status}`);
    return r.json(); // { id,title,data,... }
  }

  async function apiSave(title, data, id = null) {
    const r = await fetch(`${BASE_URL}/api/maps`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(id != null ? { id, title, data } : { title, data })
    });
    if (!r.ok) throw new Error(`Save failed: ${r.status}`);
    return r.json(); // { id }
  }

  // === Override: listMaps() -> returns array of titles (what your modal expects)
  window.listMaps = async function listMaps_override() {
    try {
      const items = await apiList();
      // return titles so your existing Open modal keeps working
      return items.map(i => i.title);
    } catch (e) {
      console.error(e);
      toast('Could not fetch maps from server; falling back to local.', 'danger');
      // fallback to original local list if available
      if (typeof original.listMaps === 'function') {
        return original.listMaps();
      }
      return [];
    }
  };

  // helper to stash data in localStorage so your original loader can render it
  function stashForOriginalLoader(title, dataObj) {
    try {
      localStorage.setItem('sld_map_' + title, JSON.stringify(dataObj));
      const idxKey = 'sld_maps_index_final';
      const names = JSON.parse(localStorage.getItem(idxKey) || '[]');
      if (!names.includes(title)) {
        names.push(title);
        localStorage.setItem(idxKey, JSON.stringify(names));
      }
    } catch (e) {
      console.warn('local stash failed', e);
    }
  }

  // === Override: loadMap(name) -> fetch from server by title, then call original loader
  window.loadMap = async function loadMap_override(title) {
    try {
      // ensure we have the latest index
      if (!serverIndex.has(title)) {
        await apiList();
      }
      const id = serverIndex.get(title);
      if (!id) {
        toast(`Map "${title}" not found on server.`, 'danger');
        // fallback to original local loader
        if (typeof original.loadMap === 'function') return original.loadMap(title);
        return;
      }
      const rec = await apiRead(id); // {id,title,data}
      // stash into localStorage for your original loader to rehydrate
      stashForOriginalLoader(rec.title, rec.data);
      if (typeof original.loadMap === 'function') {
        return original.loadMap(rec.title);
      } else {
        // no original? do a very light direct rehydrate
        if (typeof clearAll === 'function' && rec.data) {
          // very small fallback if needed:
          // (Prefer original.loadMap because it already draws everything correctly.)
          clearAll();
          toast('Loaded, but original loader missing. Please keep original script.', 'warn');
        }
      }
    } catch (e) {
      console.error(e);
      toast('Failed to load from server; trying local.', 'danger');
      if (typeof original.loadMap === 'function') return original.loadMap(title);
    }
  };

  // === Override: saveMap(name) -> saves to server; also keeps local copy for offline
  window.saveMap = async function saveMap_override(title) {
    try {
      if (typeof saveMapData !== 'function') throw new Error('saveMapData() missing');
      const payload = saveMapData(); // your existing builder data
      const res = await apiSave(title, payload);
      // keep local backup so original loader can open instantly
      stashForOriginalLoader(title, payload);
      toast(`Saved on server (id=${res.id}).`, 'success');
    } catch (e) {
      console.error(e);
      toast('Server save failed; saving locally only.', 'danger');
      // fallback to original local save
      if (typeof original.saveMap === 'function') return original.saveMap(title);
    }
  };

  // === Rebind buttons to call saveMap()/loadMap() we just overrode (uses your existing flows)
  function rebindButtons() {
    const btnSave = $('btnSaveMap');
    const btnOpen = $('btnOpenMap');

    if (btnSave) {
      // replace any previous listeners
      const clone = btnSave.cloneNode(true);
      btnSave.parentNode.replaceChild(clone, btnSave);
      clone.addEventListener('click', async () => {
        const name = $('mapName')?.value?.trim();
        if (!name) return toast('Enter map name.', 'warn');
        await window.saveMap(name); // our override
      });
    }

    if (btnOpen) {
      const clone = btnOpen.cloneNode(true);
      btnOpen.parentNode.replaceChild(clone, btnOpen);
      clone.addEventListener('click', async () => {
        try {
          // Your original code shows modal using listMaps() and on pick calls loadMap(name).
          // So we let your original UI run: just trigger the same handler it expects:
          // But since we replaced listeners, simulate your original "Open Map" flow:

          const titles = await window.listMaps(); // array of names
          if (!titles.length) { toast('No maps on server.', 'info'); return; }

          if (typeof showModal !== 'function') {
            const pick = prompt('Enter map title to open:\n' + titles.join('\n'));
            if (pick) await window.loadMap(pick.trim());
            return;
          }

          showModal({
            title: 'Open Map (Server)',
            type: 'list',
            items: titles,
            buttons: {
              cancel: { text: 'Cancel' },
              ok: {
                text: 'Open',
                action: async (selectedItem) => {
                  const title = (typeof selectedItem === 'string')
                    ? selectedItem
                    : (selectedItem?.dataset?.value || '');
                  if (!title) return toast('Pick a map.', 'warn');
                  await window.loadMap(title.trim());
                  toast(`Loaded "${title}" from server.`, 'success');
                }
              }
            }
          });
        } catch (e) {
          console.error(e);
          toast('Failed to fetch maps from server.', 'danger');
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', rebindButtons);
  console.log('[server-override] saveMap/listMaps/loadMap routed to server API');
})();
