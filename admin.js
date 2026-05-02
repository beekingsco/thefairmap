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

// CTA buttons state (shared between editor and save)
let editorCtaButtons = [];
let broadcastState = {
  audience: 'vendors_all',
  channel: 'email',
  subject: '',
  body: '',
  previewToken: '',
  previewCount: 0,
  previewNames: [],
  history: [],
  config: null
};

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
  const res = await fetch(_api('/api/admin/locations'));
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

function resolveAdminStyle(raw) {
  if (!raw || raw === 'maptiler' || raw === 'venue') return 'https://tiles.openfreemap.org/styles/bright';
  if (raw === 'streets') return 'https://tiles.openfreemap.org/styles/bright';
  if (raw === 'satellite') return 'https://tiles.openfreemap.org/styles/liberty';
  if (raw === 'dark') return 'https://tiles.openfreemap.org/styles/dark';
  if (raw === 'light') return 'https://tiles.openfreemap.org/styles/positron';
  if (raw === 'outdoors') return 'https://tiles.openfreemap.org/styles/bright';
  if (raw === 'pastel') return 'https://tiles.openfreemap.org/styles/positron';
  if (raw.startsWith('http')) return raw;
  return 'https://tiles.openfreemap.org/styles/bright';
}

function initMap() {
  const resolvedStyle = resolveAdminStyle(mapData.map?.style);

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

  adminMap.on('load', () => {
    // Add venue overlay (colored pavilion tiles) via server proxy
    adminMap.addSource('venue-overlay', {
      type: 'raster',
      tiles: [`${window.location.origin}/api/venue-tile/{z}/{x}/{y}`],
      tileSize: 256,
      minzoom: 14,
      maxzoom: 22,
      bounds: [-95.87783605142862, 32.55078690554766, -95.85260241651899, 32.57611879608321]
    });
    const layers = adminMap.getStyle().layers || [];
    let beforeId;
    for (const l of layers) { if (l.type === 'symbol') { beforeId = l.id; break; } }
    adminMap.addLayer({
      id: 'venue-overlay-layer',
      type: 'raster',
      source: 'venue-overlay',
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.72, 16, 0.88, 18, 0.94]
      }
    }, beforeId);
    renderMapMarkers();
  });
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

      const labels = {
        home: 'Home',
        locations: 'Locations',
        categories: 'Categories',
        import: 'Import',
        share: 'Share & Embed',
        broadcast: 'Broadcast Center',
        settings: 'Settings',
        about: 'About',
        admin: 'Admin'
      };
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
    case 'share':      renderShare(panel); break;
    case 'broadcast':  renderBroadcast(panel); break;
    case 'settings':   renderSettings(panel); break;
    case 'about':      renderAbout(panel); break;
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
            <div class="loc-name">${esc(loc.name)}${loc.featured ? ' <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" style="vertical-align:-1px;color:#f59e0b;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}</div>
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
          <button type="button" data-cmd="createLink" title="Link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></button>
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

        <!-- CTA Buttons accordion -->
        <div class="accordion" id="acc-cta">
          <div class="accordion-header">Action Buttons (CTA) <span class="chevron">&#x25b6;</span></div>
          <div class="accordion-body">
            <p style="font-size:11px;color:#6b7280;margin-bottom:8px;">Add buttons visitors can click to take action.</p>
            <div id="cta-list"></div>
            <div style="display:flex;gap:6px;margin-top:8px;">
              <select id="cta-type-select" style="padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
                <option value="website">Visit Website</option>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="book">Book Now</option>
                <option value="directions">Get Directions</option>
                <option value="custom">Custom Link</option>
              </select>
              <button type="button" class="btn-primary-sm" id="btn-add-cta">+ Add</button>
            </div>
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

  // CTA buttons
  const ctaSvg = (d) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ctaDefaults = { website: { label: 'Visit Website', icon: ctaSvg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'), placeholder: 'https://example.com' }, call: { label: 'Call', icon: ctaSvg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'), placeholder: '+1 555-123-4567' }, email: { label: 'Email', icon: ctaSvg('<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>'), placeholder: 'info@example.com' }, book: { label: 'Book Now', icon: ctaSvg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'), placeholder: 'https://booking-url.com' }, directions: { label: 'Get Directions', icon: ctaSvg('<polygon points="3 11 22 2 13 21 11 13 3 11"/>'), placeholder: 'Address or Google Maps URL' }, custom: { label: 'Custom Link', icon: ctaSvg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'), placeholder: 'https://...' } };
  editorCtaButtons = [];
  try { editorCtaButtons = JSON.parse(loc?.ctaButtons || '[]'); } catch {}
  if (editorCtaButtons.length === 0 && loc?.website) {
    editorCtaButtons.push({ type: 'website', label: 'Visit Website', value: loc.website });
  }

  function renderCtaList() {
    const list = document.getElementById('cta-list');
    if (!editorCtaButtons.length) { list.innerHTML = '<p style="font-size:12px;color:#9ca3af;">No action buttons yet.</p>'; return; }
    list.innerHTML = editorCtaButtons.map((cta, i) => `
      <div style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #f3f4f6;">
        <span style="display:inline-flex;align-items:center;">${ctaDefaults[cta.type]?.icon || ctaDefaults.custom.icon}</span>
        <input type="text" value="${esc(cta.label)}" data-cta-label="${i}" style="width:90px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;font-weight:600;">
        <input type="text" value="${esc(cta.value)}" data-cta-value="${i}" placeholder="${esc(ctaDefaults[cta.type]?.placeholder || '')}" style="flex:1;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:11px;">
        <button type="button" class="btn-sm danger" data-cta-remove="${i}" style="padding:2px 6px;">×</button>
      </div>`).join('');
    // Bind remove + edit
    list.querySelectorAll('[data-cta-remove]').forEach(btn => {
      btn.addEventListener('click', () => { editorCtaButtons.splice(Number(btn.dataset.ctaRemove), 1); renderCtaList(); });
    });
    list.querySelectorAll('[data-cta-label]').forEach(inp => {
      inp.addEventListener('input', () => { editorCtaButtons[Number(inp.dataset.ctaLabel)].label = inp.value; });
    });
    list.querySelectorAll('[data-cta-value]').forEach(inp => {
      inp.addEventListener('input', () => { editorCtaButtons[Number(inp.dataset.ctaValue)].value = inp.value; });
    });
  }
  renderCtaList();

  document.getElementById('btn-add-cta').addEventListener('click', () => {
    const type = document.getElementById('cta-type-select').value;
    const def = ctaDefaults[type];
    editorCtaButtons.push({ type, label: def.label, value: '' });
    renderCtaList();
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
  const ctaFiltered = editorCtaButtons.filter(c => c.value.trim());
  const website = ctaFiltered.find(c => c.type === 'website')?.value || '';

  if (!name) { alert('Name is required.'); return; }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { alert('Valid coordinates are required.'); return; }

  const cat = mapData.categories.find(c => c.id === categoryId);
  const payload = {
    name, address, description, categoryId,
    categoryName: cat?.name || '',
    lat, lng, featured, image, website,
    ctaButtons: JSON.stringify(ctaFiltered)
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

// Icon library — all available SVGs
const ICON_LIBRARY = [
  'antique---vintage','art---photography','atm-machine','auto','bath---body---beauty',
  'bed---bath','beer---wine---barware','books---media','candle---scents','candy---snacks---popcorn',
  'carpets---cowhides','clothing-kids','clothing-women','coffee---tea','cooling-stations',
  'craft---hobby','drinks-cold---slushies---lemonade','entertainment','entrance',
  'faith---inspire','farm---ranch','first-aid','floral','food','furniture',
  'garden---patio','general-merchandise','gourmet-food---seasonings','guns---ammo---military',
  'handicap-parking','handmade---artisan','health---wellness','holiday','home','ice-cream',
  'information','jewelry---watches','kitchen---dining','knives','leather','live-entertainment',
  'mens','music','my-favorites','outdoor-sports','personalized','pet','purses---totes',
  'recreational-vehicles','restroom','samples','scooter-rental','shoes---socks---footware',
  'sunglasses---fashion','t-shirts','texas-made','tools','toys---games---puzzles','western','woodcraft'
];

function iconDisplayName(slug) {
  return slug.replace(/---/g, ' / ').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function renderCategories(panel) {
  const countMap = new Map();
  mapData.locations.forEach(l => countMap.set(l.categoryId, (countMap.get(l.categoryId) || 0) + 1));
  const cats = mapData.categories.slice().sort((a, b) => a.name.localeCompare(b.name));

  let html = '<div class="panel-content"><h2 style="font-size:16px;margin-bottom:12px;">Categories</h2>';

  cats.forEach(cat => {
    const count = countMap.get(cat.id) || 0;
    const iconSrc = cat.icon ? `/data/icons/${cat.icon}.svg` : '';
    html += `
      <div class="cat-row" data-cat-id="${esc(cat.id)}">
        ${iconSrc ? `<img src="${esc(iconSrc)}" style="width:20px;height:20px;flex-shrink:0;" alt="">` : `<div class="cat-swatch" style="background:${cat.color};"></div>`}
        <div class="cat-name">${esc(cat.name)}</div>
        <span class="cat-count">${count}</span>
        <div class="cat-actions">
          <button class="btn-sm" data-cat-edit="${esc(cat.id)}">Edit</button>
          ${count === 0 ? `<button class="btn-sm danger" data-cat-del="${esc(cat.id)}">Delete</button>` : ''}
        </div>
      </div>
      <div class="cat-edit-row" id="cat-edit-${esc(cat.id)}" style="display:none;flex-wrap:wrap;">
        <input type="text" value="${esc(cat.name)}" data-edit-name="${esc(cat.id)}">
        <input type="color" value="${cat.color}" data-edit-color="${esc(cat.id)}">
        <button class="btn-sm" data-cat-icon-pick="${esc(cat.id)}" style="font-size:11px;">Icon</button>
        <button class="btn-primary-sm" data-cat-save="${esc(cat.id)}">Save</button>
        <button class="btn-sm" data-cat-cancel="${esc(cat.id)}">Cancel</button>
        <input type="hidden" data-edit-icon="${esc(cat.id)}" value="${esc(cat.icon || '')}">
        <div id="icon-picker-${esc(cat.id)}" style="display:none;width:100%;margin-top:6px;max-height:160px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px;padding:6px;"></div>
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

  // Icon picker toggles
  panel.querySelectorAll('[data-cat-icon-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.catIconPick;
      const picker = document.getElementById(`icon-picker-${id}`);
      if (picker.style.display === 'none') {
        picker.style.display = 'grid';
        picker.style.gridTemplateColumns = 'repeat(6, 1fr)';
        picker.style.gap = '4px';
        if (!picker.innerHTML) {
          // "None" option
          picker.innerHTML = `<div data-pick-icon="" style="cursor:pointer;padding:4px;border:1px solid #e5e7eb;border-radius:4px;text-align:center;font-size:10px;color:#6b7280;display:flex;align-items:center;justify-content:center;height:36px;">None</div>` +
            ICON_LIBRARY.map(slug => `
              <div data-pick-icon="${slug}" title="${iconDisplayName(slug)}" style="cursor:pointer;padding:4px;border:1px solid #e5e7eb;border-radius:4px;text-align:center;">
                <img src="/data/icons/${slug}.svg" style="width:24px;height:24px;" alt="${iconDisplayName(slug)}">
              </div>`).join('');
          picker.querySelectorAll('[data-pick-icon]').forEach(iconEl => {
            iconEl.addEventListener('click', () => {
              const iconSlug = iconEl.dataset.pickIcon;
              panel.querySelector(`[data-edit-icon="${id}"]`).value = iconSlug;
              picker.style.display = 'none';
              btn.textContent = iconSlug ? iconDisplayName(iconSlug).slice(0, 12) : 'Icon';
            });
          });
        }
      } else {
        picker.style.display = 'none';
      }
    });
  });

  // Save category edit
  panel.querySelectorAll('[data-cat-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.catSave;
      const name = panel.querySelector(`[data-edit-name="${id}"]`)?.value.trim();
      const color = panel.querySelector(`[data-edit-color="${id}"]`)?.value;
      const icon = panel.querySelector(`[data-edit-icon="${id}"]`)?.value || null;
      if (!name) return;
      try {
        const res = await fetch(_api(`/api/categories/${encodeURIComponent(id)}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color, icon })
        });
        if (!res.ok) throw new Error('Failed');
        const cat = mapData.categories.find(c => c.id === id);
        if (cat) { cat.name = name; cat.color = color; cat.icon = icon; }
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
        <button class="btn-export" id="btn-export"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>Export JSON</button>
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

async function renderSettings(panel) {
  const totalLocs = mapData.locations.length;
  const totalCats = mapData.categories.length;
  const featured = mapData.locations.filter(l => l.featured).length;
  const withImages = mapData.locations.filter(l => l.image).length;
  const mapName = mapData.map?.name || 'TheFairMap';

  // Load current settings
  let settings = {};
  try {
    const res = await fetch(_api('/api/admin/settings'));
    const data = await res.json();
    if (data.ok) settings = data.settings || {};
  } catch {}

  const activeStyle = settings.mapStyle || 'venue';
  const allowedDomains = (settings.allowedDomains || []).join('\n');

  const MAP_STYLES = [
    { id: 'venue', name: 'Venue Map', desc: 'Custom 3D venue style', preview: '#2f3d4d' },
    { id: 'streets', name: 'Streets', desc: 'Standard road map', preview: '#4a90d9' },
    { id: 'satellite', name: 'Satellite', desc: 'Aerial imagery', preview: '#2d5a27' },
    { id: 'dark', name: 'Dark', desc: 'Dark mode for evening events', preview: '#1a1a2e' },
    { id: 'light', name: 'Light', desc: 'Clean minimal style', preview: '#f0f0f0' },
    { id: 'outdoors', name: 'Outdoors', desc: 'Topographic with trails', preview: '#6b8e23' },
    { id: 'pastel', name: 'Pastel', desc: 'Soft colors, great for events', preview: '#e8b4b8' }
  ];

  const styleCards = MAP_STYLES.map(s => `
    <div class="style-card ${activeStyle === s.id ? 'active' : ''}" data-style-id="${s.id}" style="cursor:pointer;padding:10px;border:2px solid ${activeStyle === s.id ? '#00b8a9' : '#e5e7eb'};border-radius:8px;text-align:center;">
      <div style="width:100%;height:40px;border-radius:4px;background:${s.preview};margin-bottom:6px;"></div>
      <div style="font-size:12px;font-weight:600;">${s.name}</div>
      <div style="font-size:10px;color:#6b7280;">${s.desc}</div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="panel-content">
      <h2 style="font-size:16px;margin-bottom:16px;">Settings</h2>

      <!-- Stats -->
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-number">${totalLocs}</div><div class="stat-label">Locations</div></div>
        <div class="stat-card"><div class="stat-number">${totalCats}</div><div class="stat-label">Categories</div></div>
        <div class="stat-card"><div class="stat-number">${featured}</div><div class="stat-label">Featured</div></div>
        <div class="stat-card"><div class="stat-number">${withImages}</div><div class="stat-label">With Images</div></div>
      </div>

      <!-- Map Name -->
      <div class="share-card">
        <h3>Map Name</h3>
        <input type="text" id="settings-map-name" value="${esc(mapName)}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-weight:600;">
      </div>

      <!-- Map Style Gallery -->
      <div class="share-card">
        <h3>Map Style</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Choose the default base map style for visitors.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;" id="style-gallery">
          ${styleCards}
        </div>
        <input type="hidden" id="settings-map-style" value="${esc(activeStyle)}">
      </div>

      <!-- Domain Access Control -->
      <div class="share-card">
        <h3>Domain Access Control</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Restrict which domains can embed your map. Leave empty to allow all domains.</p>
        <textarea id="settings-allowed-domains" rows="3" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;" placeholder="example.com&#10;mysite.org">${esc(allowedDomains)}</textarea>
        <p style="font-size:11px;color:#9ca3af;margin-top:4px;">One domain per line. Subdomains are included automatically.</p>
      </div>

      <button class="btn-new" id="btn-save-settings" style="margin-top:12px;">Save Settings</button>
      <span id="settings-save-status" style="font-size:12px;color:#00b8a9;margin-left:8px;"></span>
    </div>`;

  // Style gallery click
  panel.querySelectorAll('.style-card').forEach(card => {
    card.addEventListener('click', () => {
      panel.querySelectorAll('.style-card').forEach(c => {
        c.style.borderColor = '#e5e7eb';
        c.classList.remove('active');
      });
      card.style.borderColor = '#00b8a9';
      card.classList.add('active');
      document.getElementById('settings-map-style').value = card.dataset.styleId;
    });
  });

  // Save settings
  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const status = document.getElementById('settings-save-status');
    const domainsRaw = document.getElementById('settings-allowed-domains').value.trim();
    const allowedDomains = domainsRaw ? domainsRaw.split('\n').map(d => d.trim().toLowerCase()).filter(Boolean) : [];

    try {
      const res = await fetch(_api('/api/admin/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantName: document.getElementById('settings-map-name').value.trim(),
          settings: {
            mapStyle: document.getElementById('settings-map-style').value,
            allowedDomains
          }
        })
      });
      if (res.ok) {
        status.textContent = 'Saved!';
        status.style.color = '#00b8a9';
        showToast('Settings saved!');
      } else {
        status.textContent = 'Error saving';
        status.style.color = '#dc2626';
      }
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch {
      status.textContent = 'Network error';
      status.style.color = '#dc2626';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// BROADCAST PANEL
// ══════════════════════════════════════════════════════════════════════════

const BROADCAST_AUDIENCE_LABELS = {
  vendors_all: 'All Vendors',
  vendors_paid: 'Paid Vendors',
  vendors_free: 'Free Vendors',
  guests_all: 'All Guests'
};

async function renderBroadcast(panel) {
  panel.innerHTML = '<div class="panel-content"><p style="color:#6b7280;">Loading broadcast center...</p></div>';

  const [configData, historyData] = await Promise.all([
    fetch(_api('/api/admin/broadcast/config')).then(r => r.json()).catch(() => ({ ok: false })),
    fetch(_api('/api/admin/broadcast/history')).then(r => r.json()).catch(() => ({ ok: false }))
  ]);

  if (configData.ok) broadcastState.config = configData;
  if (historyData.ok) broadcastState.history = historyData.messages || [];
  if (!broadcastState.config?.smsConfigured && broadcastState.channel === 'sms') {
    broadcastState.channel = 'email';
  }

  const isSms = broadcastState.channel === 'sms';
  const smsCount = broadcastState.body.length;
  const previewText = broadcastState.previewCount > 0
    ? `${broadcastState.previewCount} recipients: ${broadcastState.previewNames.join(', ')}${broadcastState.previewCount > broadcastState.previewNames.length ? '...' : ''}`
    : 'Preview recipients before sending so the count is locked in.';

  const historyRows = broadcastState.history.length ? broadcastState.history.map(message => {
    const summary = message.channel === 'email'
      ? (message.subject || '(No subject)')
      : (message.body || '').slice(0, 90);
    const dateText = formatDateTime(message.created_at || message.sent_at);
    return `
      <tr>
        <td>${esc(dateText)}</td>
        <td>${esc(BROADCAST_AUDIENCE_LABELS[message.audience] || message.audience)}</td>
        <td>${esc(String(message.channel || '').toUpperCase())}</td>
        <td>${esc(summary)}</td>
        <td>${Number(message.sent_count || 0)}</td>
        <td>${Number(message.failed_count || 0)}</td>
        <td><span class="history-status ${esc(message.status || 'pending')}">${esc(message.status || 'pending')}</span></td>
      </tr>`;
  }).join('') : '<tr><td colspan="7" style="color:#6b7280;">No broadcasts sent yet.</td></tr>';

  panel.innerHTML = `
    <div class="panel-content">
      <div class="broadcast-card">
        <h3>Compose Broadcast</h3>
        <div class="broadcast-status-row">
          <span class="status-pill ${broadcastState.config?.emailConfigured ? 'ok' : 'warn'}">Email ${broadcastState.config?.emailConfigured ? 'Ready' : 'Using fallback mode'}</span>
          <span class="status-pill ${broadcastState.config?.smsConfigured ? 'ok' : 'warn'}">SMS ${broadcastState.config?.smsConfigured ? 'Ready' : 'Twilio needed'}</span>
        </div>

        <div class="broadcast-options">
          <div class="option-group">
            <label class="group-label">Audience</label>
            <div class="option-choices">
              <label class="option-choice">
                <input type="radio" name="broadcast-audience" value="vendors_all" ${broadcastState.audience === 'vendors_all' ? 'checked' : ''}>
                <div><strong>All Vendors</strong><span>Every vendor in this tenant.</span></div>
              </label>
              <label class="option-choice">
                <input type="radio" name="broadcast-audience" value="vendors_paid" ${broadcastState.audience === 'vendors_paid' ? 'checked' : ''}>
                <div><strong>Paid Vendors Only</strong><span>Non-free vendors with active billing.</span></div>
              </label>
              <label class="option-choice">
                <input type="radio" name="broadcast-audience" value="vendors_free" ${broadcastState.audience === 'vendors_free' ? 'checked' : ''}>
                <div><strong>Free Vendors</strong><span>Free-plan vendors only.</span></div>
              </label>
              <label class="option-choice">
                <input type="radio" name="broadcast-audience" value="guests_all" ${broadcastState.audience === 'guests_all' ? 'checked' : ''}>
                <div><strong>All Guests</strong><span>Guest subscribers who opted in.</span></div>
              </label>
            </div>
          </div>

          <div class="option-group">
            <label class="group-label">Channel</label>
            <div class="option-choices">
              <label class="option-choice">
                <input type="radio" name="broadcast-channel" value="email" ${isSms ? '' : 'checked'}>
                <div><strong>Email</strong><span>Best for longer announcements and links.</span></div>
              </label>
              <label class="option-choice ${broadcastState.config?.smsConfigured ? '' : 'disabled'}" title="${broadcastState.config?.smsConfigured ? '' : 'Configure Twilio to enable SMS'}">
                <input type="radio" name="broadcast-channel" value="sms" ${isSms ? 'checked' : ''} ${broadcastState.config?.smsConfigured ? '' : 'disabled'}>
                <div><strong>SMS</strong><span>${broadcastState.config?.smsConfigured ? 'Text only vendors and guests with a phone number.' : 'Configure Twilio to enable SMS.'}</span></div>
              </label>
            </div>
          </div>
        </div>

        <div class="broadcast-field" id="broadcast-subject-wrap" style="${isSms ? 'display:none;' : ''}">
          <label for="broadcast-subject">Subject</label>
          <input type="text" id="broadcast-subject" value="${esc(broadcastState.subject)}" placeholder="Vendor update, event reminder, important notice">
        </div>

        <div class="broadcast-field">
          <label for="broadcast-body">Body / Message</label>
          <textarea id="broadcast-body" placeholder="Write your broadcast here...">${esc(broadcastState.body)}</textarea>
          <div class="broadcast-help">
            <span>Tip: use <strong>{{name}}</strong> to personalize each message.</span>
            <span id="broadcast-char-count" class="${isSms && smsCount > 300 ? 'limit-hit' : ''}">${isSms ? `${smsCount}/300 characters` : 'Email supports longer body copy'}</span>
          </div>
        </div>

        <div class="broadcast-actions">
          <button class="btn-sm" id="btn-broadcast-preview">Preview Recipients</button>
          <button class="btn-save" id="btn-broadcast-send">Send Broadcast</button>
        </div>

        <div class="broadcast-preview" id="broadcast-preview-box">${esc(previewText)}</div>
      </div>

      <div class="broadcast-card">
        <h3>Send History</h3>
        <table class="broadcast-history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Audience</th>
              <th>Channel</th>
              <th>Subject / Preview</th>
              <th>Sent</th>
              <th>Failed</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${historyRows}</tbody>
        </table>
      </div>
    </div>`;

  panel.querySelectorAll('input[name="broadcast-audience"]').forEach(input => {
    input.addEventListener('change', () => {
      broadcastState.audience = input.value;
      broadcastState.previewToken = '';
      broadcastState.previewCount = 0;
      broadcastState.previewNames = [];
      renderBroadcast(panel);
    });
  });

  panel.querySelectorAll('input[name="broadcast-channel"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.disabled) return;
      broadcastState.channel = input.value;
      broadcastState.previewToken = '';
      broadcastState.previewCount = 0;
      broadcastState.previewNames = [];
      renderBroadcast(panel);
    });
  });

  panel.querySelector('#broadcast-subject')?.addEventListener('input', e => {
    broadcastState.subject = e.target.value;
  });

  panel.querySelector('#broadcast-body')?.addEventListener('input', e => {
    broadcastState.body = e.target.value;
    const counter = panel.querySelector('#broadcast-char-count');
    if (!counter) return;
    if (broadcastState.channel === 'sms') {
      counter.textContent = `${broadcastState.body.length}/300 characters`;
      counter.classList.toggle('limit-hit', broadcastState.body.length > 300);
    }
  });

  panel.querySelector('#btn-broadcast-preview')?.addEventListener('click', async () => {
    try {
      const res = await fetch(_api('/api/admin/broadcast/preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: broadcastState.audience,
          channel: broadcastState.channel
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Preview failed');
      broadcastState.previewToken = data.token || '';
      broadcastState.previewCount = Number(data.recipientCount || 0);
      broadcastState.previewNames = data.previewNames || [];
      renderBroadcast(panel);
    } catch (err) {
      alert(err.message);
    }
  });

  panel.querySelector('#btn-broadcast-send')?.addEventListener('click', async () => {
    broadcastState.subject = panel.querySelector('#broadcast-subject')?.value || '';
    broadcastState.body = panel.querySelector('#broadcast-body')?.value || '';

    if (!broadcastState.body.trim()) {
      alert('Broadcast body is required.');
      return;
    }
    if (broadcastState.channel === 'email' && !broadcastState.subject.trim()) {
      alert('Email subject is required.');
      return;
    }
    if (broadcastState.channel === 'sms' && broadcastState.body.length > 300) {
      alert('SMS must be 300 characters or less.');
      return;
    }
    if (!broadcastState.previewCount || !broadcastState.previewToken) {
      alert('Preview recipients first so the confirmed count is locked in.');
      return;
    }

    const audienceLabel = BROADCAST_AUDIENCE_LABELS[broadcastState.audience] || broadcastState.audience;
    const confirmed = window.confirm(`You are about to send ${broadcastState.channel.toUpperCase()} to ${broadcastState.previewCount} ${audienceLabel}. This cannot be undone. Send?`);
    if (!confirmed) return;

    try {
      const res = await fetch(_api('/api/admin/broadcast/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: broadcastState.audience,
          channel: broadcastState.channel,
          subject: broadcastState.channel === 'email' ? broadcastState.subject : '',
          body: broadcastState.body,
          confirmCount: broadcastState.previewCount,
          token: broadcastState.previewToken
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Send failed');
      showToast(data.message || 'Broadcast queued.');
      broadcastState.subject = '';
      broadcastState.body = '';
      broadcastState.previewToken = '';
      broadcastState.previewCount = 0;
      broadcastState.previewNames = [];
      renderBroadcast(panel);
    } catch (err) {
      alert(err.message);
    }
  });
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

function formatDateTime(value) {
  if (!value) return '';
  const normalized = String(value).includes('T') ? value : String(value).replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
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

// ══════════════════════════════════════════════════════════════════════════
// SHARE & EMBED
// ══════════════════════════════════════════════════════════════════════════

async function renderShare(panel) {
  const mapName = mapData.map?.name || 'TheFairMap';
  const origin = window.location.origin;
  const mapUrl = origin + '/' + (_tp ? _tp : '');
  const embedCode = `<iframe src="${esc(origin)}/map${_tp}" width="100%" height="600" frameborder="0" allow="geolocation" style="border:0;border-radius:8px;"></iframe>`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mapUrl)}`;

  // Load current settings
  let settings = {};
  try {
    const res = await fetch(_api('/api/admin/settings'));
    const data = await res.json();
    if (data.ok) settings = data.settings || {};
  } catch {}
  const seoChecked = settings.seoIndexable !== false;

  panel.innerHTML = `
    <div class="panel-content">
      <h2 style="font-size:16px;margin-bottom:16px;">Share & Embed</h2>

      <!-- Share Link -->
      <div class="share-card">
        <h3>Map Link</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Share this link to give people access to your map.</p>
        <div class="share-link-row">
          <input type="text" id="share-link-input" value="${esc(mapUrl)}" readonly style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:monospace;">
          <button class="btn-sm" id="btn-copy-link" style="margin-left:6px;white-space:nowrap;">Copy Link</button>
        </div>
      </div>

      <!-- Social Sharing -->
      <div class="share-card">
        <h3>Share on Social</h3>
        <div class="share-social-btns">
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(mapUrl)}" target="_blank" rel="noopener" class="btn-sm share-fb">Facebook</a>
          <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(mapUrl)}&text=${encodeURIComponent('Check out ' + mapName)}" target="_blank" rel="noopener" class="btn-sm share-tw">X / Twitter</a>
          <a href="https://api.whatsapp.com/send?text=${encodeURIComponent(mapName + ' ' + mapUrl)}" target="_blank" rel="noopener" class="btn-sm share-wa">WhatsApp</a>
          <a href="mailto:?subject=${encodeURIComponent(mapName)}&body=${encodeURIComponent('Check out this map: ' + mapUrl)}" class="btn-sm share-em">Email</a>
        </div>
      </div>

      <!-- Embed Code -->
      <div class="share-card">
        <h3>Embed on Website</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Copy this code and paste it into your website HTML to embed the interactive map.</p>
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <label style="font-size:12px;font-weight:600;">Width
            <input type="text" id="embed-width" value="100%" style="width:70px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;">
          </label>
          <label style="font-size:12px;font-weight:600;">Height
            <input type="text" id="embed-height" value="600" style="width:70px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;">
          </label>
        </div>
        <textarea id="embed-code" rows="4" readonly style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;font-family:monospace;background:#f9fafb;resize:vertical;">${esc(embedCode)}</textarea>
        <button class="btn-sm" id="btn-copy-embed" style="margin-top:6px;">Copy Embed Code</button>
      </div>

      <!-- QR Code -->
      <div class="share-card">
        <h3>QR Code</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Print this QR code on signs, flyers, or booth cards so visitors can scan to open the map.</p>
        <div style="text-align:center;">
          <img id="share-qr-img" src="${esc(qrUrl)}" alt="QR Code" width="200" height="200" style="border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff;">
        </div>
        <div style="text-align:center;margin-top:8px;">
          <a href="${esc(qrUrl)}" download="thefairmap-qr.png" class="btn-sm">Download QR Code</a>
        </div>
      </div>

      <!-- SEO -->
      <div class="share-card">
        <h3>Search Engine Visibility</h3>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="seo-indexable" ${seoChecked ? 'checked' : ''}>
          Allow search engines to index this map
        </label>
        <p style="font-size:11px;color:#9ca3af;margin-top:4px;">When disabled, a noindex tag will be added to prevent Google from listing your map.</p>
        <span id="seo-save-status" style="font-size:11px;color:#00b8a9;"></span>
      </div>
    </div>`;

  // Event bindings
  document.getElementById('btn-copy-link').addEventListener('click', () => {
    const input = document.getElementById('share-link-input');
    navigator.clipboard.writeText(input.value).then(() => {
      document.getElementById('btn-copy-link').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('btn-copy-link').textContent = 'Copy Link'; }, 2000);
    });
  });

  document.getElementById('btn-copy-embed').addEventListener('click', () => {
    const ta = document.getElementById('embed-code');
    navigator.clipboard.writeText(ta.value).then(() => {
      document.getElementById('btn-copy-embed').textContent = 'Copied!';
      setTimeout(() => { document.getElementById('btn-copy-embed').textContent = 'Copy Embed Code'; }, 2000);
    });
  });

  // Live update embed code when dimensions change
  const updateEmbed = () => {
    const w = document.getElementById('embed-width').value || '100%';
    const h = document.getElementById('embed-height').value || '600';
    document.getElementById('embed-code').value = `<iframe src="${origin}/map${_tp}" width="${w}" height="${h}" frameborder="0" allow="geolocation" style="border:0;border-radius:8px;"></iframe>`;
  };
  document.getElementById('embed-width').addEventListener('input', updateEmbed);
  document.getElementById('embed-height').addEventListener('input', updateEmbed);

  // SEO toggle auto-save
  document.getElementById('seo-indexable').addEventListener('change', async (e) => {
    const status = document.getElementById('seo-save-status');
    try {
      await fetch(_api('/api/admin/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { seoIndexable: e.target.checked } })
      });
      status.textContent = 'Saved!';
      status.style.color = '#00b8a9';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch {
      status.textContent = 'Error saving';
      status.style.color = '#dc2626';
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════
// ABOUT SECTION
// ══════════════════════════════════════════════════════════════════════════

async function renderAbout(panel) {
  panel.innerHTML = '<div class="panel-content"><p style="color:#6b7280;">Loading...</p></div>';
  let settings = {};
  try {
    const res = await fetch(_api('/api/admin/settings'));
    const data = await res.json();
    if (data.ok) settings = data.settings || {};
  } catch {}
  const desc = settings.description || '';
  const contactName = settings.contactName || '';
  const contactEmail = settings.contactEmail || '';
  const contactPhone = settings.contactPhone || '';
  const coverImage = settings.coverImage || '';

  panel.innerHTML = `
    <div class="panel-content">
      <h2 style="font-size:16px;margin-bottom:16px;">About This Map</h2>

      <div class="share-card">
        <h3>Map Description</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Tell visitors what this map is about. This text appears in search results and when the map is shared.</p>
        <textarea id="about-description" rows="4" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-family:inherit;resize:vertical;" placeholder="Welcome to our interactive vendor map...">${esc(desc)}</textarea>
      </div>

      <div class="share-card">
        <h3>Contact Information</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">How can visitors or vendors reach you?</p>
        <div class="about-fields">
          <label style="font-size:12px;font-weight:600;">Contact Name
            <input type="text" id="about-contact-name" value="${esc(contactName)}" placeholder="Event Manager" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-top:4px;">
          </label>
          <label style="font-size:12px;font-weight:600;">Email
            <input type="email" id="about-contact-email" value="${esc(contactEmail)}" placeholder="info@example.com" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-top:4px;">
          </label>
          <label style="font-size:12px;font-weight:600;">Phone
            <input type="tel" id="about-contact-phone" value="${esc(contactPhone)}" placeholder="(555) 123-4567" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-top:4px;">
          </label>
        </div>
      </div>

      <div class="share-card">
        <h3>Cover Image</h3>
        <p style="font-size:12px;color:#6b7280;margin-bottom:8px;">Used as the hero image when sharing the map on social media.</p>
        ${coverImage ? `<img src="${esc(coverImage)}" style="max-width:100%;border-radius:6px;margin-bottom:8px;" alt="Cover">` : ''}
        <input type="url" id="about-cover-image" value="${esc(coverImage)}" placeholder="https://example.com/cover.jpg" style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
      </div>

      <button class="btn-new" id="btn-save-about" style="margin-top:12px;">Save About Info</button>
      <span id="about-save-status" style="font-size:12px;color:#00b8a9;margin-left:8px;"></span>
    </div>`;

  document.getElementById('btn-save-about').addEventListener('click', async () => {
    const settings = {
      description: document.getElementById('about-description').value,
      contactName: document.getElementById('about-contact-name').value,
      contactEmail: document.getElementById('about-contact-email').value,
      contactPhone: document.getElementById('about-contact-phone').value,
      coverImage: document.getElementById('about-cover-image').value
    };
    try {
      const res = await fetch(_api('/api/admin/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      if (res.ok) {
        document.getElementById('about-save-status').textContent = 'Saved!';
        setTimeout(() => { document.getElementById('about-save-status').textContent = ''; }, 2000);
      } else {
        document.getElementById('about-save-status').textContent = 'Error saving.';
        document.getElementById('about-save-status').style.color = '#dc2626';
      }
    } catch {
      document.getElementById('about-save-status').textContent = 'Network error.';
      document.getElementById('about-save-status').style.color = '#dc2626';
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
