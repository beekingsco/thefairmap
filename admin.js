'use strict';

// ══════════════════════════════════════════════════════════════════════════
// TENANT AWARENESS
// ══════════════════════════════════════════════════════════════════════════

const _tp = (() => {
  const p = new URLSearchParams(window.location.search);
  const t = p.get('tenant');
  return t ? '?tenant=' + encodeURIComponent(t) : '';
})();
function _api(path) {
  if (!_tp) return path;
  return path + (path.includes('?') ? '&' : '?') + _tp.slice(1);
}

// ══════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════

let adminMap;
let mapData = { map: {}, categories: [], locations: [] };
let currentUser = null;
let currentSection = 'locations';
let editingId = null;       // null = list view, string = editing that location
let isNewLocation = false;  // true when "+ New Location" clicked
let clickToSetActive = false;
let dropPin = null;
let pulseMarker = null;
let mapMarkers = [];

// Pagination & filters
const PAGE_SIZE = 50;
let currentPage = 1;
let searchFilter = '';
let categoryFilter = '';
let statusFilter = '';

// Review modal state
let reviewingType = '';
let reviewingId = '';

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════

async function checkAuth() {
  try {
    const res = await fetch(_api('/api/me'));
    if (!res.ok) { window.location.href = '/login' + _tp; return false; }
    const data = await res.json();
    currentUser = data.user;
    document.getElementById('topbar-user').textContent = currentUser.username || currentUser.name || currentUser.email || 'Admin';
    document.getElementById('auth-wall').style.display = 'none';
    document.getElementById('app-layout').style.display = 'flex';
    return true;
  } catch {
    window.location.href = '/login';
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════

async function init() {
  if (!(await checkAuth())) return;
  await loadData();
  initMap();
  bindGlobalUI();
  renderSection(currentSection);
  // Tenant-aware view map link
  const vml = document.getElementById('view-map-link');
  if (vml && _tp) vml.href = '/' + _tp;
}

async function loadData() {
  const res = await fetch(_api('/api/locations'));
  mapData = await res.json();
  mapData.categories = (mapData.categories || []).map(c => ({ ...c, color: normalizeColor(c.color) }));
  mapData.locations = (mapData.locations || []).map((loc, i) => {
    const cat = mapData.categories.find(c => c.id === loc.categoryId || c.id === loc.category);
    return {
      ...loc,
      id: String(loc.id || `loc-${Date.now()}-${i}`),
      name: loc.name || 'Untitled',
      description: loc.description || '',
      address: loc.address || loc.booth || '',
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      featured: Boolean(loc.featured),
      image: loc.image || '',
      website: loc.website || '',
      categoryId: loc.categoryId || loc.category || cat?.id || '',
      categoryName: loc.categoryName || cat?.name || ''
    };
  }).filter(loc => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
}

// ══════════════════════════════════════════════════════════════════════════
// MAP
// ══════════════════════════════════════════════════════════════════════════

function initMap() {
  const styleUrl = mapData.map?.style || 'https://tiles.openfreemap.org/styles/bright';
  const resolvedStyle = (window.MAPTILER_KEY && styleUrl.includes('YOUR_MAPTILER_KEY'))
    ? styleUrl.replace('YOUR_MAPTILER_KEY', window.MAPTILER_KEY) : styleUrl;

  adminMap = new maplibregl.Map({
    container: 'admin-map',
    style: resolvedStyle,
    center: mapData.map?.center || [-95.8624, 32.5585],
    zoom: Math.max((mapData.map?.zoom || 17) - 1, 12),
    pitch: 0, bearing: 0
  });

  adminMap.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Map click handler for click-to-set mode
  adminMap.on('click', (e) => {
    if (!clickToSetActive) return;
    const lat = e.lngLat.lat.toFixed(7);
    const lng = e.lngLat.lng.toFixed(7);
    const latInput = document.getElementById('ed-lat');
    const lngInput = document.getElementById('ed-lng');
    if (latInput) latInput.value = lat;
    if (lngInput) lngInput.value = lng;
    placeDropPin(Number(lng), Number(lat));
  });

  adminMap.on('load', () => renderMapMarkers());
}

function renderMapMarkers() {
  // Clear existing
  mapMarkers.forEach(m => m.remove());
  mapMarkers = [];

  mapData.locations.forEach(loc => {
    const cat = mapData.categories.find(c => c.id === loc.categoryId) || { color: '#707070' };
    const el = document.createElement('div');
    el.style.cssText = `width:12px;height:12px;border-radius:50%;background:${cat.color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;`;
    el.title = loc.name;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([loc.lng, loc.lat])
      .addTo(adminMap);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentSection === 'locations') {
        editingId = loc.id;
        isNewLocation = false;
        renderSection('locations');
      }
    });

    marker._locId = loc.id;
    mapMarkers.push(marker);
  });
}

function highlightMarker(locId) {
  // Remove existing pulse
  if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }
  if (!locId) return;

  const loc = mapData.locations.find(l => l.id === locId);
  if (!loc) return;

  const cat = mapData.categories.find(c => c.id === loc.categoryId) || { color: '#707070' };
  const el = document.createElement('div');
  el.className = 'pulse-marker';
  el.style.background = cat.color;

  pulseMarker = new maplibregl.Marker({ element: el })
    .setLngLat([loc.lng, loc.lat])
    .addTo(adminMap);

  adminMap.flyTo({ center: [loc.lng, loc.lat], zoom: Math.max(adminMap.getZoom(), 16) });
}

function placeDropPin(lng, lat) {
  if (dropPin) dropPin.remove();
  dropPin = new maplibregl.Marker({ color: '#ef4444' })
    .setLngLat([lng, lat])
    .addTo(adminMap);
}

function clearDropPin() {
  if (dropPin) { dropPin.remove(); dropPin = null; }
}

// ══════════════════════════════════════════════════════════════════════════
// GLOBAL UI BINDINGS
// ══════════════════════════════════════════════════════════════════════════

function bindGlobalUI() {
  // Sign out
  document.getElementById('btn-signout').addEventListener('click', async () => {
    await fetch(_api('/api/logout'), { method: 'POST' });
    window.location.href = '/login';
  });

  // Sidebar nav
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      currentSection = section;
      editingId = null;
      isNewLocation = false;
      clickToSetActive = false;
      clearDropPin();
      if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }

      document.querySelectorAll('.sidebar-item').forEach(s => s.classList.remove('active'));
      item.classList.add('active');

      const labels = { home: 'Home', locations: 'Locations', categories: 'Categories', import: 'Import', settings: 'Settings', admin: 'Admin' };
      document.getElementById('topbar-section').textContent = labels[section] || section;

      renderSection(section);
    });
  });

  // Review modal buttons
  document.getElementById('btn-review-cancel').addEventListener('click', closeReviewModal);
  document.getElementById('btn-review-approve').addEventListener('click', () => reviewAction('approve'));
  document.getElementById('btn-review-reject').addEventListener('click', () => reviewAction('reject'));
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION ROUTER
// ══════════════════════════════════════════════════════════════════════════

function renderSection(section) {
  const panel = document.getElementById('center-panel');
  switch (section) {
    case 'home':     renderSettings(panel); break;
    case 'locations':
      if (editingId || isNewLocation) renderEditor(panel);
      else renderLocationList(panel);
      break;
    case 'categories': renderCategories(panel); break;
    case 'import':     renderImport(panel); break;
    case 'settings':   renderSettings(panel); break;
    case 'admin':      renderAdmin(panel); break;
    default:           renderLocationList(panel); break;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LOCATIONS LIST
// ══════════════════════════════════════════════════════════════════════════

function renderLocationList(panel) {
  // Build filtered list
  let list = mapData.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (searchFilter) {
    const q = searchFilter.toLowerCase();
    list = list.filter(l => l.name.toLowerCase().includes(q) || (l.address || '').toLowerCase().includes(q));
  }
  if (categoryFilter) list = list.filter(l => l.categoryId === categoryFilter);
  if (statusFilter === 'featured') list = list.filter(l => l.featured);
  if (statusFilter === 'active') list = list.filter(l => !l.featured);

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);

  // Category options for filter
  const catOpts = mapData.categories.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${esc(c.id)}" ${categoryFilter === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  let html = `
    <div class="action-bar">
      <button class="btn-new" id="btn-new-loc">+ New Location</button>
      <div class="filter-row">
        <input type="search" id="loc-search" placeholder="Search locations..." value="${esc(searchFilter)}">
      </div>
      <div class="filter-row" style="margin-top:6px;">
        <select id="loc-cat-filter"><option value="">All Categories</option>${catOpts}</select>
        <select id="loc-status-filter">
          <option value="" ${!statusFilter ? 'selected' : ''}>All</option>
          <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>Active</option>
          <option value="featured" ${statusFilter === 'featured' ? 'selected' : ''}>Featured</option>
        </select>
      </div>
    </div>
    <div class="bulk-bar" id="bulk-bar">
      <strong id="bulk-count">0 selected</strong>
      <button class="btn-sm danger" id="bulk-delete-btn">Delete Selected</button>
      <button class="btn-sm" id="bulk-clear-btn">Clear</button>
    </div>
    <div class="loc-list" id="loc-list">`;

  if (pageList.length === 0) {
    html += `<div style="text-align:center;color:#6b7280;padding:40px 16px;">No locations found.</div>`;
  } else {
    pageList.forEach(loc => {
      const cat = mapData.categories.find(c => c.id === loc.categoryId) || { color: '#707070' };
      html += `
        <div class="loc-row" data-loc-id="${esc(loc.id)}">
          <input type="checkbox" class="bulk-check" data-bulk-id="${esc(loc.id)}">
          <div class="loc-info">
            <div class="loc-name">${esc(loc.name)}${loc.featured ? ' &#x2b50;' : ''}</div>
            <div class="loc-addr">${esc(loc.address || 'No address')}</div>
          </div>
          <div class="cat-dot" style="background:${cat.color};" title="${esc(cat.name || 'Uncategorized')}"></div>
        </div>`;
    });
  }

  html += `</div>
    <div class="pagination" id="pagination">
      <button id="pg-prev" ${currentPage <= 1 ? 'disabled' : ''}>Prev</button>
      <span>Page ${currentPage} of ${totalPages}</span>
      <button id="pg-next" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    </div>`;

  panel.innerHTML = html;

  // Bind events
  document.getElementById('btn-new-loc').addEventListener('click', () => {
    editingId = null;
    isNewLocation = true;
    clickToSetActive = true;
    renderSection('locations');
  });

  document.getElementById('loc-search').addEventListener('input', (e) => {
    searchFilter = e.target.value.trim();
    currentPage = 1;
    renderLocationList(panel);
  });
  document.getElementById('loc-cat-filter').addEventListener('change', (e) => {
    categoryFilter = e.target.value;
    currentPage = 1;
    renderLocationList(panel);
  });
  document.getElementById('loc-status-filter').addEventListener('change', (e) => {
    statusFilter = e.target.value;
    currentPage = 1;
    renderLocationList(panel);
  });

  // Location row clicks
  document.querySelectorAll('.loc-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      editingId = row.dataset.locId;
      isNewLocation = false;
      renderSection('locations');
    });
  });

  // Checkbox bulk
  document.querySelectorAll('.bulk-check').forEach(cb => {
    cb.addEventListener('change', updateBulkBar);
  });
  document.getElementById('bulk-delete-btn')?.addEventListener('click', bulkDeleteSelected);
  document.getElementById('bulk-clear-btn')?.addEventListener('click', () => {
    document.querySelectorAll('.bulk-check:checked').forEach(cb => cb.checked = false);
    updateBulkBar();
  });

  // Pagination
  document.getElementById('pg-prev')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderLocationList(panel); }
  });
  document.getElementById('pg-next')?.addEventListener('click', () => {
    const tp = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage < tp) { currentPage++; renderLocationList(panel); }
  });

  // Clear any highlight
  if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const checked = document.querySelectorAll('.bulk-check:checked');
  if (!bar) return;
  if (checked.length > 0) {
    bar.classList.add('visible');
    document.getElementById('bulk-count').textContent = `${checked.length} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

async function bulkDeleteSelected() {
  const ids = [...document.querySelectorAll('.bulk-check:checked')].map(cb => cb.dataset.bulkId);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} location(s)? This cannot be undone.`)) return;

  try {
    const res = await fetch(_api('/api/locations/bulk-delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    mapData.locations = mapData.locations.filter(l => !ids.includes(l.id));
    renderMapMarkers();
    renderLocationList(document.getElementById('center-panel'));
    showToast(`Deleted ${data.deleted} location(s).`);
  } catch (e) { alert('Bulk delete error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════
// LOCATION EDITOR
// ══════════════════════════════════════════════════════════════════════════

function renderEditor(panel) {
  const loc = editingId ? mapData.locations.find(l => l.id === editingId) : null;
  const isEdit = !!loc;
  const title = isEdit ? 'Edit Location' : 'New Location';

  // Category select options
  const catOpts = mapData.categories.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map(c => `<option value="${esc(c.id)}" ${loc && loc.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

  const html = `
    <div class="editor">
      <div class="editor-scroll">
        <a class="back-link" id="btn-back">&larr; Back to Locations</a>

        <label style="margin-top:0;">Name</label>
        <input type="text" class="editor-name-input" id="ed-name" value="${esc(loc?.name || '')}" placeholder="Location name">

        <label>Address</label>
        <input type="text" id="ed-address" value="${esc(loc?.address || '')}" placeholder="Address or booth number">

        <label>Description</label>
        <div class="rt-toolbar">
          <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
          <button type="button" data-cmd="createLink" title="Link">&#x1f517;</button>
          <button type="button" data-cmd="insertUnorderedList" title="Bullet list">&#x2022; List</button>
          <button type="button" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
          <button type="button" data-cmd="undo" title="Undo">&#x21a9;</button>
        </div>
        <div class="rt-editable" id="ed-desc" contenteditable="true">${loc?.description || ''}</div>

        <!-- Category accordion -->
        <div class="accordion open" id="acc-category">
          <div class="accordion-header">Category <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <select id="ed-category">${catOpts}</select>
          </div>
        </div>

        <!-- Image accordion -->
        <div class="accordion" id="acc-image">
          <div class="accordion-header">Image <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <div class="drop-zone" id="drop-zone">
              <div>Drag & drop an image here, or click to browse</div>
              <input type="file" id="ed-image-file" accept="image/*" style="display:none;">
              ${loc?.image ? `<img src="${esc(loc.image)}" id="img-thumb">` : ''}
            </div>
            <div style="margin-top:8px;">
              <label style="margin-top:0;">Or enter URL</label>
              <input type="url" id="ed-image-url" value="${esc(loc?.image || '')}" placeholder="https://example.com/image.jpg">
            </div>
          </div>
        </div>

        <!-- Position accordion -->
        <div class="accordion ${isEdit ? '' : 'open'}" id="acc-position">
          <div class="accordion-header">Position <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <label style="margin-top:0;">Latitude</label>
                <input type="number" step="any" id="ed-lat" value="${loc?.lat || ''}" placeholder="32.5585">
              </div>
              <div>
                <label style="margin-top:0;">Longitude</label>
                <input type="number" step="any" id="ed-lng" value="${loc?.lng || ''}" placeholder="-95.8624">
              </div>
            </div>
            <button type="button" class="btn-click-map ${clickToSetActive ? 'active' : ''}" id="btn-click-map">
              ${clickToSetActive ? 'Click map mode ON' : 'Click map to set'}
            </button>
          </div>
        </div>

        <!-- Featured accordion -->
        <div class="accordion" id="acc-featured">
          <div class="accordion-header">Featured <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <label style="display:flex;align-items:center;gap:8px;margin-top:0;font-weight:400;">
              <input type="checkbox" id="ed-featured" ${loc?.featured ? 'checked' : ''}> Mark as featured location
            </label>
          </div>
        </div>

        <!-- Website accordion -->
        <div class="accordion" id="acc-website">
          <div class="accordion-header">Website / Action <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <input type="url" id="ed-website" value="${esc(loc?.website || '')}" placeholder="https://example.com">
          </div>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="editor-bottom">
        ${isEdit ? '<button class="btn-delete" id="btn-editor-delete">Delete</button>' : '<div></div>'}
        <button class="btn-save" id="btn-editor-save">${isEdit ? 'Save Changes' : 'Add Location'}</button>
      </div>
    </div>`;

  panel.innerHTML = html;

  // Highlight marker on map
  if (isEdit) {
    highlightMarker(editingId);
    placeDropPin(loc.lng, loc.lat);
  }

  // Bind events
  document.getElementById('btn-back').addEventListener('click', () => {
    editingId = null;
    isNewLocation = false;
    clickToSetActive = false;
    clearDropPin();
    if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }
    renderSection('locations');
  });

  // Accordion toggles
  document.querySelectorAll('.accordion-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });

  // Rich text toolbar
  document.querySelectorAll('.rt-toolbar button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  // Click-to-set toggle
  document.getElementById('btn-click-map').addEventListener('click', () => {
    clickToSetActive = !clickToSetActive;
    const btn = document.getElementById('btn-click-map');
    btn.classList.toggle('active', clickToSetActive);
    btn.textContent = clickToSetActive ? 'Click map mode ON' : 'Click map to set';
  });

  // Image drop zone
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('ed-image-file');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) uploadImage(file);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) uploadImage(e.target.files[0]);
  });

  // Image URL input
  document.getElementById('ed-image-url').addEventListener('input', (e) => {
    const thumb = document.getElementById('img-thumb');
    if (thumb) thumb.src = e.target.value;
    else if (e.target.value) {
      const img = document.createElement('img');
      img.id = 'img-thumb';
      img.src = e.target.value;
      img.style.cssText = 'max-width:100%;max-height:120px;border-radius:6px;margin-top:8px;';
      img.onerror = () => img.remove();
      dropZone.appendChild(img);
    }
  });

  // Save
  document.getElementById('btn-editor-save').addEventListener('click', saveLocation);

  // Delete
  if (isEdit) {
    document.getElementById('btn-editor-delete').addEventListener('click', async () => {
      if (!confirm(`Delete "${loc.name}"?`)) return;
      try {
        const res = await fetch(_api(`/api/locations/${encodeURIComponent(editingId)}`), { method: 'DELETE' });
        if (!res.ok) throw new Error('Server error');
        mapData.locations = mapData.locations.filter(l => l.id !== editingId);
        editingId = null;
        isNewLocation = false;
        renderMapMarkers();
        renderSection('locations');
        showToast('Location deleted.');
      } catch (e) { alert('Error: ' + e.message); }
    });
  }
}

async function uploadImage(file) {
  const form = new FormData();
  form.append('image', file);
  try {
    const res = await fetch(_api('/api/upload-image'), { method: 'POST', body: form });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('ed-image-url').value = data.url;
      const dropZone = document.getElementById('drop-zone');
      let thumb = document.getElementById('img-thumb');
      if (!thumb) {
        thumb = document.createElement('img');
        thumb.id = 'img-thumb';
        thumb.style.cssText = 'max-width:100%;max-height:120px;border-radius:6px;margin-top:8px;';
        dropZone.appendChild(thumb);
      }
      thumb.src = data.url;
      showToast('Image uploaded!');
    } else {
      alert('Upload failed: ' + data.error);
    }
  } catch (e) { alert('Upload error: ' + e.message); }
}

async function saveLocation() {
  const name = document.getElementById('ed-name').value.trim();
  const address = document.getElementById('ed-address').value.trim();
  const description = document.getElementById('ed-desc').innerHTML;
  const categoryId = document.getElementById('ed-category').value;
  const lat = Number(document.getElementById('ed-lat').value);
  const lng = Number(document.getElementById('ed-lng').value);
  const featured = document.getElementById('ed-featured').checked;
  const image = document.getElementById('ed-image-url').value.trim();
  const website = document.getElementById('ed-website').value.trim();

  if (!name) { alert('Name is required.'); return; }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { alert('Valid coordinates are required.'); return; }

  const cat = mapData.categories.find(c => c.id === categoryId);
  const payload = {
    name, address, description, categoryId,
    categoryName: cat?.name || '',
    lat, lng, featured, image, website
  };

  const btn = document.getElementById('btn-editor-save');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    let res;
    if (editingId) {
      res = await fetch(_api(`/api/locations/${encodeURIComponent(editingId)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      payload.id = `loc-${Date.now()}`;
      res = await fetch(_api('/api/locations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();

    if (editingId) {
      const idx = mapData.locations.findIndex(l => l.id === editingId);
      if (idx !== -1) mapData.locations[idx] = { ...mapData.locations[idx], ...payload };
    } else {
      mapData.locations.push(data.location || { ...payload, id: payload.id });
    }

    editingId = null;
    isNewLocation = false;
    clickToSetActive = false;
    clearDropPin();
    if (pulseMarker) { pulseMarker.remove(); pulseMarker = null; }
    renderMapMarkers();
    renderSection('locations');
    showToast(editingId ? 'Location updated!' : 'Location added!');
  } catch (e) {
    alert('Error saving: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = editingId ? 'Save Changes' : 'Add Location';
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CATEGORIES PANEL
// ══════════════════════════════════════════════════════════════════════════

function renderCategories(panel) {
  const countMap = new Map();
  mapData.locations.forEach(l => countMap.set(l.categoryId, (countMap.get(l.categoryId) || 0) + 1));
  const cats = mapData.categories.slice().sort((a, b) => a.name.localeCompare(b.name));

  let html = '<div class="panel-content"><h2 style="font-size:16px;margin-bottom:12px;">Categories</h2>';

  cats.forEach(cat => {
    const count = countMap.get(cat.id) || 0;
    html += `
      <div class="cat-row" data-cat-id="${esc(cat.id)}">
        <div class="cat-swatch" style="background:${cat.color};"></div>
        <div class="cat-name">${esc(cat.name)}</div>
        <span class="cat-count">${count}</span>
        <div class="cat-actions">
          <button class="btn-sm" data-cat-edit="${esc(cat.id)}">Edit</button>
          ${count === 0 ? `<button class="btn-sm danger" data-cat-del="${esc(cat.id)}">Delete</button>` : ''}
        </div>
      </div>
      <div class="cat-edit-row" id="cat-edit-${esc(cat.id)}" style="display:none;">
        <input type="text" value="${esc(cat.name)}" data-edit-name="${esc(cat.id)}">
        <input type="color" value="${cat.color}" data-edit-color="${esc(cat.id)}">
        <button class="btn-primary-sm" data-cat-save="${esc(cat.id)}">Save</button>
        <button class="btn-sm" data-cat-cancel="${esc(cat.id)}">Cancel</button>
      </div>`;
  });

  html += `
    <div class="add-cat-form">
      <input type="color" id="new-cat-color" value="#7a7a7a">
      <input type="text" id="new-cat-name" placeholder="New category name">
      <button class="btn-primary-sm" id="btn-add-cat">+ Add</button>
    </div>
  </div>`;

  panel.innerHTML = html;

  // Bind edit toggles
  panel.querySelectorAll('[data-cat-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catEdit;
      document.getElementById(`cat-edit-${id}`).style.display = 'flex';
    });
  });
  panel.querySelectorAll('[data-cat-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catCancel;
      document.getElementById(`cat-edit-${id}`).style.display = 'none';
    });
  });

  // Save category edit
  panel.querySelectorAll('[data-cat-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catSave;
      const name = panel.querySelector(`[data-edit-name="${id}"]`)?.value.trim();
      const color = panel.querySelector(`[data-edit-color="${id}"]`)?.value;
      if (!name) return;
      try {
        const res = await fetch(_api(`/api/categories/${encodeURIComponent(id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color })
        });
        if (!res.ok) throw new Error('Failed');
        const cat = mapData.categories.find(c => c.id === id);
        if (cat) { cat.name = name; cat.color = color; }
        renderCategories(panel);
        renderMapMarkers();
        showToast('Category updated!');
      } catch (e) { alert('Error: ' + e.message); }
    });
  });

  // Delete category
  panel.querySelectorAll('[data-cat-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catDel;
      const cat = mapData.categories.find(c => c.id === id);
      if (!confirm(`Delete category "${cat?.name}"?`)) return;
      try {
        const res = await fetch(_api(`/api/categories/${encodeURIComponent(id)}`), { method: 'DELETE' });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed');
        mapData.categories = mapData.categories.filter(c => c.id !== id);
        renderCategories(panel);
        showToast('Category deleted.');
      } catch (e) { alert('Error: ' + e.message); }
    });
  });

  // Add new category
  document.getElementById('btn-add-cat')?.addEventListener('click', async () => {
    const name = document.getElementById('new-cat-name')?.value.trim();
    const color = document.getElementById('new-cat-color')?.value || '#7a7a7a';
    if (!name) { alert('Enter a name.'); return; }
    try {
      const res = await fetch(_api('/api/categories'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      mapData.categories.push(data.category);
      renderCategories(panel);
      showToast('Category added!');
    } catch (e) { alert('Error: ' + e.message); }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// IMPORT PANEL
// ══════════════════════════════════════════════════════════════════════════

function renderImport(panel) {
  panel.innerHTML = `
    <div class="panel-content">
      <h2 style="font-size:16px;margin-bottom:16px;">Import / Export</h2>

      <div class="import-section">
        <h3>Export JSON</h3>
        <p>Download all locations and categories as a JSON file.</p>
        <button class="btn-export" id="btn-export">&#x2b07; Export JSON</button>
      </div>

      <div class="import-section">
        <h3>Import JSON</h3>
        <p>Upload a JSON file with locations and categories.</p>
        <input type="file" class="import-file" id="json-file" accept="application/json,.json">
        <div class="merge-row">
          <input type="checkbox" id="json-merge" checked> <label for="json-merge">Merge with existing data</label>
        </div>
        <button class="btn-primary-sm" id="btn-import-json">Import</button>
      </div>

      <div class="import-section">
        <h3>CSV Import</h3>
        <p>Paste CSV data or upload a file.</p>
        <textarea class="csv-area" id="csv-textarea" placeholder="name,categoryName,address,lat,lng,description"></textarea>
        <input type="file" class="import-file" id="csv-file" accept=".csv,.txt" style="margin-top:6px;">
        <button class="btn-primary-sm" id="btn-csv-import" style="margin-top:8px;">Import CSV</button>
        <div class="csv-help">Headers: name, categoryId/categoryName/category, address, lat, lng, description, image, featured</div>
      </div>
    </div>`;

  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json').addEventListener('click', importJSONFile);
  document.getElementById('btn-csv-import').addEventListener('click', importCSV);
  document.getElementById('csv-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { document.getElementById('csv-textarea').value = ev.target.result; };
    reader.readAsText(file);
  });
}

function exportJSON() {
  const output = {
    ...mapData,
    locations: mapData.locations.map(loc => ({
      id: loc.id, name: loc.name, description: loc.description,
      address: loc.address, lat: loc.lat, lng: loc.lng,
      image: loc.image || '', categoryId: loc.categoryId,
      categoryName: loc.categoryName, featured: Boolean(loc.featured)
    }))
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `locations-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSONFile() {
  const fileInput = document.getElementById('json-file');
  const file = fileInput.files?.[0];
  if (!file) { alert('Select a JSON file first.'); return; }
  const merge = document.getElementById('json-merge').checked;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.locations || !Array.isArray(parsed.locations)) throw new Error('JSON must include a locations array.');
      const res = await fetch(_api('/api/import-locations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: parsed.locations, categories: parsed.categories, merge })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      await loadData();
      renderMapMarkers();
      renderSection(currentSection);
      showToast(`Imported — ${data.count} locations total.`);
    } catch (err) { alert('Import failed: ' + err.message); }
    fileInput.value = '';
  };
  reader.readAsText(file);
}

function importCSV() {
  const raw = document.getElementById('csv-textarea').value.trim();
  if (!raw) { alert('Paste CSV data first.'); return; }

  const rows = parseCSV(raw);
  if (rows.length < 2) { alert('CSV must include header + data rows.'); return; }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const col = name => headers.indexOf(name);
  const iName = col('name'), iLat = col('lat'), iLng = col('lng');
  if (iName === -1 || iLat === -1 || iLng === -1) { alert('CSV requires name, lat, lng columns.'); return; }

  const newLocs = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const name = (c[iName] || '').trim();
    const lat = Number(c[iLat]);
    const lng = Number(c[iLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const catId = resolveCategoryId(c[col('categoryid')] || '', c[col('categoryname')] || '', c[col('category')] || '');
    const cat = mapData.categories.find(cc => cc.id === catId);
    newLocs.push({
      id: `csv-${Date.now()}-${i}`, name,
      description: c[col('description')] || '',
      address: c[col('address')] || '',
      image: c[col('image')] || '',
      lat, lng, categoryId: catId,
      categoryName: cat?.name || '',
      featured: normalizeBoolean(c[col('featured')])
    });
  }

  fetch(_api('/api/import-locations'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: newLocs, merge: true })
  }).then(r => r.json()).then(async (data) => {
    if (!data.ok) throw new Error(data.error);
    await loadData();
    renderMapMarkers();
    document.getElementById('csv-textarea').value = '';
    showToast(`Imported ${newLocs.length} locations from CSV.`);
  }).catch(e => alert('CSV import failed: ' + e.message));
}

// ══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL (Map Home)
// ══════════════════════════════════════════════════════════════════════════

function renderSettings(panel) {
  const totalLocs = mapData.locations.length;
  const totalCats = mapData.categories.length;
  const featured = mapData.locations.filter(l => l.featured).length;
  const withImages = mapData.locations.filter(l => l.image).length;
  const mapName = mapData.map?.name || 'TheFairMap';

  panel.innerHTML = `
    <div class="panel-content">
      <h2 style="font-size:16px;margin-bottom:16px;">Map Overview</h2>
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-number">${totalLocs}</div><div class="stat-label">Total Locations</div></div>
        <div class="stat-card"><div class="stat-number">${totalCats}</div><div class="stat-label">Categories</div></div>
        <div class="stat-card"><div class="stat-number">${featured}</div><div class="stat-label">Featured</div></div>
        <div class="stat-card"><div class="stat-number">${withImages}</div><div class="stat-label">With Images</div></div>
      </div>
      <div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;">
        <label style="font-size:12px;font-weight:600;color:#6b7280;">Map Name</label>
        <div style="font-size:15px;font-weight:600;margin-top:4px;">${esc(mapName)}</div>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════════════════════════

async function renderAdmin(panel) {
  panel.innerHTML = '<div class="panel-content"><p style="color:#6b7280;">Loading...</p></div>';

  // Load approvals, claims, users in parallel
  const [approvalsData, claimsData, usersData] = await Promise.all([
    fetch(_api('/api/admin/pending')).then(r => r.json()).catch(() => ({ ok: false })),
    fetch(_api('/api/admin/claims')).then(r => r.json()).catch(() => ({ ok: false })),
    fetch(_api('/api/users')).then(r => r.json()).catch(() => ({ ok: false }))
  ]);

  let html = '<div class="panel-content">';

  // ── Pending Approvals ──
  html += '<div class="admin-card"><h3>Pending Approvals</h3>';
  if (approvalsData.ok && approvalsData.pending?.length > 0) {
    approvalsData.pending.forEach(p => {
      html += `
        <div class="approval-row">
          <div class="approval-info">
            <div class="approval-name">${esc(p.name)}</div>
            <div class="approval-meta">by ${esc(p.ownerName)} &middot; ${p.listingTier || 'unclaimed'}</div>
          </div>
          <button class="btn-approve" data-approval-id="${esc(p.id)}">Approve</button>
          <button class="btn-reject" data-approval-rej="${esc(p.id)}">Reject</button>
        </div>`;
    });
  } else {
    html += '<p style="color:#6b7280;font-size:13px;">No pending approvals.</p>';
  }
  html += '</div>';

  // ── Pending Claims ──
  html += '<div class="admin-card"><h3>Pending Claims</h3>';
  if (claimsData.ok && claimsData.claims?.length > 0) {
    claimsData.claims.forEach(c => {
      html += `
        <div class="claim-row">
          <div class="claim-info">
            <div class="claim-name">${esc(c.locationName)}</div>
            <div class="claim-meta">${c.type === 'create' ? 'NEW' : 'CLAIM'} &middot; by ${esc(c.userName)} &middot; ${c.tier || 'basic'}</div>
          </div>
          <button class="btn-approve" data-claim-approve="${esc(c.id)}">Approve</button>
          <button class="btn-reject" data-claim-reject="${esc(c.id)}">Reject</button>
        </div>`;
    });
  } else {
    html += '<p style="color:#6b7280;font-size:13px;">No pending claims.</p>';
  }
  html += '</div>';

  // ── Team Members ──
  html += '<div class="admin-card"><h3>Team Members</h3>';
  if (usersData.ok && usersData.users?.length > 0) {
    usersData.users.forEach(u => {
      html += `
        <div class="user-row">
          <div class="user-avatar" style="background:${u.role === 'admin' ? '#00b8a9' : '#6b7280'};">${esc((u.displayName || u.username).charAt(0).toUpperCase())}</div>
          <div class="user-info">
            <div class="user-name">${esc(u.displayName || u.username)}</div>
            <div class="user-meta">@${esc(u.username)} &middot; ${u.role}</div>
          </div>
          ${u.id !== 'admin' ? `<button class="btn-sm danger" data-remove-user="${esc(u.id)}" data-user-name="${esc(u.displayName || u.username)}">Remove</button>` : '<span style="font-size:11px;color:#00b8a9;font-weight:600;">Owner</span>'}
        </div>`;
    });
  }
  html += `
    <h4 style="font-size:13px;margin-top:16px;margin-bottom:8px;">Add User</h4>
    <div class="add-user-form">
      <input type="text" id="new-username" placeholder="Username">
      <input type="text" id="new-password" placeholder="Password (min 6)">
      <input type="text" id="new-display" placeholder="Display Name">
      <select id="new-role"><option value="editor">Editor</option><option value="admin">Admin</option></select>
    </div>
    <button class="btn-primary-sm" id="btn-add-user" style="margin-top:8px;">Add User</button>
  </div>`;

  // ── Change Password ──
  html += `
    <div class="admin-card">
      <h3>Change My Password</h3>
      <div class="change-pw-form">
        <input type="password" id="old-pw" placeholder="Current password">
        <input type="password" id="new-pw" placeholder="New password (min 6)">
      </div>
      <button class="btn-primary-sm" id="btn-change-pw" style="margin-top:8px;">Update Password</button>
    </div>`;

  html += '</div>';
  panel.innerHTML = html;

  // ── Bind approval buttons ──
  panel.querySelectorAll('[data-approval-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.approvalId;
      try {
        const res = await fetch(_api(`/api/admin/pending/${encodeURIComponent(id)}/approve`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (data.ok) { showToast('Approved!'); renderAdmin(panel); } else alert(data.error);
      } catch (e) { alert(e.message); }
    });
  });
  panel.querySelectorAll('[data-approval-rej]').forEach(btn => {
    btn.addEventListener('click', () => {
      reviewingType = 'approval';
      reviewingId = btn.dataset.approvalRej;
      document.getElementById('review-modal-title').textContent = 'Reject Approval';
      document.getElementById('review-modal-body').innerHTML = '<p style="font-size:13px;">Provide a reason for rejection (optional).</p>';
      document.getElementById('review-modal').classList.add('visible');
    });
  });

  // ── Bind claim buttons ──
  panel.querySelectorAll('[data-claim-approve]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.claimApprove;
      try {
        const res = await fetch(_api(`/api/admin/claims/${encodeURIComponent(id)}/approve`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (data.ok) { showToast('Claim approved!'); await loadData(); renderMapMarkers(); renderAdmin(panel); } else alert(data.error);
      } catch (e) { alert(e.message); }
    });
  });
  panel.querySelectorAll('[data-claim-reject]').forEach(btn => {
    btn.addEventListener('click', () => {
      reviewingType = 'claim';
      reviewingId = btn.dataset.claimReject;
      document.getElementById('review-modal-title').textContent = 'Reject Claim';
      document.getElementById('review-modal-body').innerHTML = '<p style="font-size:13px;">Provide a reason for rejection (optional).</p>';
      document.getElementById('review-modal').classList.add('visible');
    });
  });

  // ── Bind remove user ──
  panel.querySelectorAll('[data-remove-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.removeUser;
      const name = btn.dataset.userName;
      if (!confirm(`Remove "${name}" from the team?`)) return;
      try {
        const res = await fetch(_api(`/api/users/${encodeURIComponent(id)}`), { method: 'DELETE' });
        if (res.ok) { showToast('User removed.'); renderAdmin(panel); }
        else { const d = await res.json(); alert(d.error || 'Failed'); }
      } catch (e) { alert(e.message); }
    });
  });

  // ── Add user ──
  document.getElementById('btn-add-user')?.addEventListener('click', async () => {
    const username = document.getElementById('new-username')?.value.trim();
    const password = document.getElementById('new-password')?.value.trim();
    const displayName = document.getElementById('new-display')?.value.trim() || username;
    const role = document.getElementById('new-role')?.value || 'editor';
    if (!username || !password) { alert('Username and password required.'); return; }
    if (password.length < 6) { alert('Min 6 characters.'); return; }
    try {
      const res = await fetch(_api('/api/users'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName, role })
      });
      const data = await res.json();
      if (data.ok) { showToast(`${displayName} added!`); renderAdmin(panel); }
      else alert(data.error);
    } catch (e) { alert(e.message); }
  });

  // ── Change password ──
  document.getElementById('btn-change-pw')?.addEventListener('click', async () => {
    const oldPw = document.getElementById('old-pw')?.value;
    const newPw = document.getElementById('new-pw')?.value;
    if (!oldPw || !newPw) { alert('Both fields required.'); return; }
    if (newPw.length < 6) { alert('Min 6 characters.'); return; }
    try {
      const res = await fetch(_api('/api/change-password'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('old-pw').value = '';
        document.getElementById('new-pw').value = '';
        showToast('Password changed!');
      } else alert(data.error);
    } catch (e) { alert(e.message); }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// REVIEW MODAL
// ══════════════════════════════════════════════════════════════════════════

function closeReviewModal() {
  document.getElementById('review-modal').classList.remove('visible');
  document.getElementById('review-note').value = '';
  reviewingType = '';
  reviewingId = '';
}

async function reviewAction(action) {
  const note = document.getElementById('review-note').value.trim();
  let url;
  if (reviewingType === 'approval') {
    url = `/api/admin/${action}/${encodeURIComponent(reviewingId)}`;
  } else {
    url = `/api/admin/claims/${encodeURIComponent(reviewingId)}/${action}`;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note })
    });
    const data = await res.json();
    if (data.ok) {
      closeReviewModal();
      showToast(data.message || 'Done!');
      await loadData();
      renderMapMarkers();
      renderAdmin(document.getElementById('center-panel'));
    } else {
      alert(data.error || 'Action failed');
    }
  } catch (e) { alert('Error: ' + e.message); }
}

// ══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════

function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return '#707070';
  if (input.length === 9) return input.slice(0, 7);
  return input;
}

function normalizeBoolean(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function resolveCategoryId(catId, catName, fallback) {
  const id = String(catId || '').trim();
  if (mapData.categories.some(c => c.id === id)) return id;
  const needle = String(catName || fallback || '').trim().toLowerCase();
  if (needle) {
    const byName = mapData.categories.find(c => c.name.toLowerCase() === needle);
    if (byName) return byName.id;
  }
  return mapData.categories[0]?.id || '';
}

function parseCSV(text) {
  const rows = []; let row = [], value = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { value += '"'; i++; } else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(value); value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(value);
      if (row.some(c => c.length > 0)) rows.push(row);
      row = []; value = '';
    } else value += char;
  }
  if (value.length > 0 || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
