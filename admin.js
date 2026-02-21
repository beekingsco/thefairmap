'use strict';

let adminMap;
let mapData;
let dropPin;
let editingId = null;  // null = add mode, string = edit mode
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilter = '';

// ── Auth check ──────────────────────────────────────────────────────────────
async function checkAuth() {
  const res = await fetch('/api/me');
  if (!res.ok) {
    window.location.href = '/login';
    return false;
  }
  const { user } = await res.json();
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('topbar-user').textContent = `Logged in as ${user.username}`;
  document.getElementById('auth-wall').style.display = 'none';
  document.getElementById('admin-content').style.display = 'block';
  return true;
}

// Sign out
document.getElementById('btn-signout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
});

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  const authed = await checkAuth();
  if (!authed) return;

  await loadData();
  normalizeData();
  initMap();
  bindUI();
  populateCategorySelect();
  renderTable();
  updateStats();
}

async function loadData() {
  const res = await fetch('/api/locations');
  mapData = await res.json();
}

function normalizeData() {
  mapData.categories = (mapData.categories || []).map((cat) => ({
    ...cat,
    color: normalizeColor(cat.color)
  }));

  mapData.locations = (mapData.locations || []).map((loc, idx) => {
    const category = mapData.categories.find((c) => c.id === loc.categoryId || c.id === loc.category);
    const categoryId = loc.categoryId || loc.category || category?.id || '';
    return {
      id: String(loc.id || `loc-${Date.now()}-${idx}`),
      name: loc.name || 'Untitled',
      description: loc.description || '',
      address: loc.address || loc.booth || '',
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      featured: Boolean(loc.featured),
      image: loc.image || '',
      categoryId,
      categoryName: loc.categoryName || category?.name || ''
    };
  }).filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
}

// ── Map ─────────────────────────────────────────────────────────────────────
function initMap() {
  adminMap = new maplibregl.Map({
    container: 'admin-map',
    style: resolveMapStyleUrl(mapData.map?.style),
    center: mapData.map?.center || [-95.8624, 32.5585],
    zoom: Math.max((mapData.map?.zoom || 17) - 1, 12),
    pitch: 0,
    bearing: 0
  });

  adminMap.addControl(new maplibregl.NavigationControl(), 'top-right');

  adminMap.on('click', (event) => {
    document.getElementById('loc-lat').value = event.lngLat.lat.toFixed(7);
    document.getElementById('loc-lng').value = event.lngLat.lng.toFixed(7);
    if (dropPin) dropPin.remove();
    dropPin = new maplibregl.Marker({ color: '#bb3e2f' })
      .setLngLat([event.lngLat.lng, event.lngLat.lat])
      .addTo(adminMap);
  });
}

function resolveMapStyleUrl(styleUrl) {
  const url = styleUrl || 'https://tiles.openfreemap.org/styles/bright';
  if (window.MAPTILER_KEY && url.includes('YOUR_MAPTILER_KEY')) {
    return url.replace('YOUR_MAPTILER_KEY', window.MAPTILER_KEY);
  }
  return url;
}

// ── UI bindings ─────────────────────────────────────────────────────────────
function bindUI() {
  document.getElementById('add-form').addEventListener('submit', upsertLocation);
  document.getElementById('btn-cancel-edit').addEventListener('click', cancelEdit);

  document.getElementById('add-form').addEventListener('reset', () => {
    cancelEdit();
    clearDropPin();
    document.getElementById('img-preview').classList.remove('visible');
    document.getElementById('img-preview').src = '';
  });

  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json').addEventListener('click', () => document.getElementById('json-file').click());
  document.getElementById('json-file').addEventListener('change', importJSON);
  document.getElementById('btn-csv-import').addEventListener('click', importCSV);
  document.getElementById('csv-file').addEventListener('change', handleCSVFile);

  // Image upload
  document.getElementById('btn-upload-img').addEventListener('click', () => document.getElementById('img-file-input').click());
  document.getElementById('img-file-input').addEventListener('change', handleImageUpload);

  // Show preview when URL typed
  document.getElementById('loc-image').addEventListener('input', (e) => {
    updateImagePreview(e.target.value);
  });

  // Table search/filter
  document.getElementById('table-search').addEventListener('input', (e) => {
    currentFilter = e.target.value.trim().toLowerCase();
    currentPage = 1;
    renderTable(currentFilter);
  });
}

function updateImagePreview(url) {
  const preview = document.getElementById('img-preview');
  if (url) {
    preview.src = url;
    preview.classList.add('visible');
    preview.onerror = () => { preview.classList.remove('visible'); };
  } else {
    preview.classList.remove('visible');
    preview.src = '';
  }
}

async function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const btn = document.getElementById('btn-upload-img');
  btn.textContent = 'Uploading…';
  btn.disabled = true;

  const form = new FormData();
  form.append('image', file);

  try {
    const res = await fetch('/api/upload-image', { method: 'POST', body: form });
    const data = await res.json();
    if (data.ok) {
      document.getElementById('loc-image').value = data.url;
      updateImagePreview(data.url);
    } else {
      alert('Upload failed: ' + data.error);
    }
  } catch (e) {
    alert('Upload error: ' + e.message);
  } finally {
    btn.textContent = '📷 Upload';
    btn.disabled = false;
    event.target.value = '';
  }
}

function populateCategorySelect() {
  const select = document.getElementById('loc-category');
  select.innerHTML = '';
  mapData.categories
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      select.appendChild(option);
    });
}

function updateStats() {
  document.getElementById('stat-total').textContent = String(mapData.locations.length);
  const used = new Set(mapData.locations.map((l) => l.categoryId).filter(Boolean));
  document.getElementById('stat-cats').textContent = String(used.size);
  const featured = mapData.locations.filter(l => l.featured).length;
  document.getElementById('stat-featured').textContent = String(featured);
  const withImages = mapData.locations.filter(l => l.image).length;
  document.getElementById('stat-images').textContent = String(withImages);
  renderCategoryGrid();
}

function renderCategoryGrid() {
  const grid = document.getElementById('category-grid');
  if (!grid) return;

  const countMap = new Map();
  mapData.locations.forEach(l => countMap.set(l.categoryId, (countMap.get(l.categoryId) || 0) + 1));

  const cats = mapData.categories.slice().sort((a, b) => (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0));
  document.getElementById('cat-count-badge').textContent = `(${cats.length})`;

  grid.innerHTML = cats.map(cat => {
    const count = countMap.get(cat.id) || 0;
    return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.6rem;background:#f9fafb;border-radius:8px;border:1px solid #e5ebf1;">
      <span style="width:16px;height:16px;border-radius:4px;background:${cat.color};flex-shrink:0;"></span>
      <span style="flex:1;font-size:0.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</span>
      <span style="font-size:0.72rem;color:#9aa5b1;flex-shrink:0;">${count}</span>
    </div>`;
  }).join('');
}

function renderTable(filter = '') {
  currentFilter = filter;
  const tbody = document.getElementById('location-tbody');
  tbody.innerHTML = '';

  let list = mapData.locations.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (filter) {
    list = list.filter(loc =>
      loc.name.toLowerCase().includes(filter) ||
      (loc.address || '').toLowerCase().includes(filter) ||
      (loc.categoryName || '').toLowerCase().includes(filter)
    );
  }

  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageList = list.slice(start, start + PAGE_SIZE);

  if (!total) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:#9aa5b1;padding:2rem;">No locations found.</td>`;
    tbody.appendChild(tr);
    renderPagination(0, 0, 0);
    return;
  }

  pageList.forEach((loc) => {
    const category = getCategory(loc.categoryId, loc.categoryName);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(loc.name)}</strong>${loc.featured ? ' ⭐' : ''}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(loc.address || '—')}</td>
      <td><span class="badge" style="background:${category.color};">${escapeHtml(category.name)}</span></td>
      <td style="font-size:0.78rem;white-space:nowrap;"><code>${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}</code></td>
      <td>${loc.image ? `<img src="${escapeHtml(loc.image)}" style="width:48px;height:34px;object-fit:cover;border-radius:5px;" loading="lazy">` : '—'}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${escapeHtml(loc.id)}">Edit</button>
        <a class="btn btn-sm btn-secondary" href="/?loc=${encodeURIComponent(loc.id)}" target="_blank" title="View on map">🗺️</a>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${escapeHtml(loc.id)}">✕</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => editLocation(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteLocation(btn.dataset.id));
  });

  renderPagination(currentPage, totalPages, total);
}

function renderPagination(page, totalPages, total) {
  let el = document.getElementById('table-pagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'table-pagination';
    el.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;font-size:0.85rem;color:#5f6770;';
    document.querySelector('.admin-table-wrap').after(el);
  }

  if (totalPages <= 1) {
    el.innerHTML = total > 0 ? `<span>${total} location${total === 1 ? '' : 's'}</span>` : '';
    return;
  }

  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  el.innerHTML = `
    <button class="btn btn-sm btn-secondary" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span>Page <strong>${page}</strong> of ${totalPages} · ${start}–${end} of ${total}</span>
    <button class="btn btn-sm btn-secondary" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
  `;

  el.querySelector('#pg-prev')?.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderTable(currentFilter); }
  });
  el.querySelector('#pg-next')?.addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderTable(currentFilter); }
  });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
async function upsertLocation(event) {
  event.preventDefault();

  const categoryId = document.getElementById('loc-category').value;
  const category = getCategory(categoryId);

  const payload = {
    id: editingId || document.getElementById('loc-id').value.trim() || `loc-${Date.now()}`,
    name: document.getElementById('loc-name').value.trim(),
    description: document.getElementById('loc-desc').value,
    address: document.getElementById('loc-address').value.trim(),
    lat: Number(document.getElementById('loc-lat').value),
    lng: Number(document.getElementById('loc-lng').value),
    featured: document.getElementById('loc-featured').checked,
    image: document.getElementById('loc-image').value.trim(),
    categoryId,
    categoryName: category.name
  };

  if (!payload.name || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !payload.categoryId) {
    alert('Name, category, latitude, and longitude are required.');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;

  try {
    let res;
    if (editingId) {
      res = await fetch(`/api/locations/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();

    // Update local state
    if (editingId) {
      const idx = mapData.locations.findIndex(l => l.id === editingId);
      if (idx !== -1) mapData.locations[idx] = data.location;
    } else {
      mapData.locations.push(data.location);
    }

    cancelEdit();
    document.getElementById('add-form').reset();
    clearDropPin();
    renderTable(document.getElementById('table-search').value.trim().toLowerCase());
    updateStats();
    showToast(editingId ? 'Location updated!' : 'Location added!');
  } catch (e) {
    alert('Error saving location: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function editLocation(id) {
  const loc = mapData.locations.find(l => l.id === id);
  if (!loc) return;

  editingId = loc.id;
  document.getElementById('loc-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-category').value = loc.categoryId;
  document.getElementById('loc-address').value = loc.address || '';
  document.getElementById('loc-lat').value = String(loc.lat);
  document.getElementById('loc-lng').value = String(loc.lng);
  document.getElementById('loc-desc').value = loc.description || '';
  document.getElementById('loc-featured').checked = Boolean(loc.featured);
  document.getElementById('loc-image').value = loc.image || '';
  updateImagePreview(loc.image || '');

  document.getElementById('form-heading').textContent = `Edit: ${loc.name}`;
  document.getElementById('btn-submit').textContent = 'Update Location';
  document.getElementById('btn-cancel-edit').style.display = '';

  clearDropPin();
  dropPin = new maplibregl.Marker({ color: '#bb3e2f' }).setLngLat([loc.lng, loc.lat]).addTo(adminMap);
  adminMap.flyTo({ center: [loc.lng, loc.lat], zoom: Math.max(adminMap.getZoom(), 17) });
  document.getElementById('add-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteLocation(id) {
  const loc = mapData.locations.find(l => l.id === id);
  if (!loc) return;
  if (!confirm(`Delete "${loc.name}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Server error ' + res.status);
    mapData.locations = mapData.locations.filter(l => l.id !== id);
    renderTable(document.getElementById('table-search').value.trim().toLowerCase());
    updateStats();
    showToast('Location deleted.');
  } catch (e) {
    alert('Error deleting: ' + e.message);
  }
}

function cancelEdit() {
  editingId = null;
  document.getElementById('loc-id').value = '';
  document.getElementById('form-heading').textContent = 'Add Location';
  document.getElementById('btn-submit').textContent = 'Add Location';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

// ── Import / Export ──────────────────────────────────────────────────────────
function exportJSON() {
  const output = {
    ...mapData,
    locations: mapData.locations.map(loc => ({
      id: loc.id, name: loc.name, description: loc.description,
      address: loc.address, lat: loc.lat, lng: loc.lng,
      image: loc.image || '',
      categoryId: loc.categoryId, categoryName: loc.categoryName,
      featured: Boolean(loc.featured)
    }))
  };
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `locations-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (loadEvent) => {
    try {
      const parsed = JSON.parse(loadEvent.target.result);
      if (!parsed.locations || !Array.isArray(parsed.locations)) throw new Error('JSON must include a locations array.');

      const mode = confirm('Replace ALL locations? (OK = replace, Cancel = merge)');

      const res = await fetch('/api/import-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations: parsed.locations,
          categories: parsed.categories,
          merge: !mode
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      // Reload
      await loadData();
      normalizeData();
      populateCategorySelect();
      renderTable();
      updateStats();
      showToast(`Imported — ${data.count} locations total.`);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function importCSV() {
  const raw = document.getElementById('csv-textarea').value.trim();
  if (!raw) { alert('Paste CSV data first.'); return; }

  const rows = parseCSV(raw);
  if (rows.length < 2) { alert('CSV must include a header row and one data row.'); return; }

  const headers = rows[0].map(h => h.trim().toLowerCase());
  const col = name => headers.indexOf(name);
  const idxName = col('name'), idxLat = col('lat'), idxLng = col('lng');

  if (idxName === -1 || idxLat === -1 || idxLng === -1) {
    alert('CSV requires name, lat, and lng columns.'); return;
  }

  const newLocs = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i];
    const name = (c[idxName] || '').trim();
    const lat = Number(c[idxLat]);
    const lng = Number(c[idxLng]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const catId = resolveCategoryId(
      c[col('categoryid')] || '', c[col('categoryname')] || '', c[col('category')] || ''
    );
    const category = getCategory(catId);
    newLocs.push({
      id: `csv-${Date.now()}-${i}`,
      name, description: c[col('description')] || '',
      address: c[col('address')] || '',
      image: c[col('image')] || '',
      lat, lng,
      categoryId: category.id, categoryName: category.name,
      featured: normalizeBoolean(c[col('featured')])
    });
  }

  fetch('/api/import-locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: newLocs, merge: true })
  }).then(r => r.json()).then(async (data) => {
    if (!data.ok) throw new Error(data.error);
    await loadData();
    normalizeData();
    renderTable();
    updateStats();
    document.getElementById('csv-textarea').value = '';
    showToast(`Imported ${newLocs.length} locations from CSV.`);
  }).catch(e => alert('CSV import failed: ' + e.message));
}

function handleCSVFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => { document.getElementById('csv-textarea').value = e.target.result; };
  reader.readAsText(file);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, color = '#1e2328') {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.cssText = `position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);
    background:${color};color:#fff;padding:0.65rem 1.25rem;border-radius:12px;
    font-size:0.9rem;font-weight:600;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);
    animation:fadeIn 0.2s ease;font-family:inherit;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

function getCategory(id, fallbackName = '') {
  return mapData.categories.find(c => c.id === id) || { id, name: fallbackName || 'Uncategorized', color: '#707070' };
}

function clearDropPin() {
  if (!dropPin) return;
  dropPin.remove();
  dropPin = null;
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

function escapeHtml(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

document.addEventListener('DOMContentLoaded', init);
