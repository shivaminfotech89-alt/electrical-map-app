// public/app-bridge.js
// Minimal adapter: Replace Save/Open button handlers to use the server API,
// but keep all your original drawing code & helpers intact.

(() => {
  const BASE_URL = ""; // same-origin (Render). If testing local UI against deployed API, set the full URL.

  const $ = (id) => document.getElementById(id);
  const toast = (m, t='info') => (typeof showToast === 'function' ? showToast(m, t) : console.log(`[${t}] ${m}`));

  // --- Server API ---
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
    if (!res.ok) throw new Error(`List failed (${res.status})`);
    const json = await res.json(); // { items: [...] }
    return json.items || [];
  }

  async function loadMapFromServer(id) {
    const res = await fetch(`${BASE_URL}/api/maps/${id}`);
    if (!res.ok) throw new Error(`Load failed (${res.status})`);
    return await res.json(); // { id, title, data, ... }
  }

  // Reuse your existing loader by stashing server data into localStorage
  function stashToLocalAndLoad(name, data) {
    try {
      localStorage.setItem('sld_map_' + name, JSON.stringify(data));
      const idxKey = 'sld_maps_index_final';
      const names = JSON.parse(localStorage.getItem(idxKey) || '[]');
      if (!names.includes(name)) {
        names.push(name);
        localStorage.setItem(idxKey, JSON.stringify(names));
      }
      if (typeof loadMap === 'function') {
        loadMap(name);
      } else {
        toast('loadMap() not found. Update bridge to use direct rehydrate.', 'danger');
      }
    } catch (e) {
      console.error(e);
      toast('Failed to load map locally.', 'danger');
    }
  }

  // Remove all old listeners by cloning the button
  function replaceButton(id) {
    const oldBtn = $(id);
    if (!oldBtn) return null;
    const newBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    return newBtn;
  }

  // Build searchable modal list with your existing showModal UI
  function showSearchableListModal(items, onOpen) {
    if (typeof showModal !== 'function') {
      // Fallback prompt
      const pick = prompt('Enter map id to open:\n' + items.map(i => `${i.id} — ${i.title}`).join('\n'));
      if (!pick) return;
      const id = Number((pick.split('—')[0] || '').trim());
      if (id) onOpen(id);
      return;
    }

    const lines = items.map(i => `${i.id} — ${i.title}`);
    showModal({
      title: 'Open Map (Server)',
      message: '',
      inputs: [{ id: 'searchText', type: 'text', placeholder: 'Search by title or id...' }],
      type: 'list',
      items: lines, // modal will render these
      buttons: {
        cancel: { text: 'Cancel' },
        ok: {
          text: 'Open',
          action: (selectedValue) => {
            // Ensure we always have a string like "id — title"
            const selectedText = (typeof selectedValue === 'string')
              ? selectedValue
              : (selectedValue?.dataset?.value || '');
            if (!selectedText) { toast('Pick a map.', 'warn'); return; }
            const idPart = selectedText.split(' — ')[0];
            const id = Number((idPart || '').trim());
            if (!id) { toast('Invalid selection.', 'warn'); return; }
            onOpen(id);
          }
        }
      }
    });

    // wire search to filter the modal list
    const input = document.getElementById('searchText');
    const listDiv = document.getElementById('modal-list');
    if (!input || !listDiv) return;

    const renderList = (arr) => {
      listDiv.innerHTML = '';
      arr.forEach(text => {
        const div = document.createElement('div');
        div.className = 'modal-list-item';
        div.textContent = text;
        div.dataset.value = text; // IMPORTANT so OK receives a string
        div.onclick = () => {
          listDiv.querySelectorAll('.selected').forEach(s => s.classList.remove('selected'));
          div.classList.add('selected');
        };
        listDiv.appendChild(div);
      });
    };

    renderList(lines);
    input.addEventListener('input', () => {
      const q = (input.value || '').toLowerCase();
      renderList(lines.filter(t => t.toLowerCase().includes(q)));
    });
  }

  function wireSave() {
    const btn = replaceButton('btnSaveMap'); // remove old listeners
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const name = $('mapName')?.value?.trim();
        if (!name) { toast('Enter map name.', 'warn'); return; }
        if (typeof saveMapData !== 'function') { toast('saveMapData() missing.', 'danger'); return; }
        const payload = saveMapData();
        const id = await saveMapToServer(name, payload);
        // optional local backup
        localStorage.setItem('sld_map_' + name, JSON.stringify(payload));
        toast(`Saved on server (id=${id}).`, 'success');
      } catch (e) {
        console.error(e);
        toast('Server save failed.', 'danger');
      }
    });
  }

  function wireOpen() {
    const btn = replaceButton('btnOpenMap'); // remove old listeners
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        const items = await listMapsFromServer(); // [{id,title,updatedAt}]
        if (!items.length) { toast('No maps on server.', 'info'); return; }
        showSearchableListModal(items, async (id) => {
          try {
            const rec = await loadMapFromServer(id); // { id, title, data }
            // Use your existing loader:
            stashToLocalAndLoad(rec.title, rec.data);
            toast(`Loaded "${rec.title}" from server.`, 'success');
          } catch (e) {
            console.error(e);
            toast('Failed to load map from server.', 'danger');
          }
        });
      } catch (e) {
        console.error(e);
        toast('Failed to fetch maps from server.', 'danger');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireSave();
    wireOpen();
    console.log('[app-bridge] Save/Open wired to server API (listeners replaced).');
  });
})();
