let adminMap;
let mapData;
let dropPin;

const ADMIN_PASS = 'fairmap2026';

function checkAuth() {
  const stored = sessionStorage.getItem('fairmap-admin');
  if (stored === ADMIN_PASS) return true;

  const pass = prompt('Enter admin password:');
  if (pass === ADMIN_PASS) {
    sessionStorage.setItem('fairmap-admin', pass);
    return true;
  }

  document.body.innerHTML = '<div style="padding:60px; text-align:center;"><h2>Access denied</h2><p>Refresh to try again.</p></div>';
  return false;
}

async function init() {
  if (!checkAuth()) return;

  const response = await fetch('./data/locations.json');
  mapData = await response.json();

  normalizeData();
  initMap();
  bindUI();
  populateCategorySelect();
  renderTable();
  updateStats();
}

function normalizeData() {
  mapData.categories = (mapData.categories || []).map((cat) => ({
    ...cat,
    color: normalizeColor(cat.color)
  }));

  mapData.locations = (mapData.locations || []).map((loc, idx) => {
    const category = mapData.categories.find((cat) => cat.id === loc.categoryId || cat.id === loc.category);
    const categoryId = loc.categoryId || loc.category || category?.id || '';

    return {
      id: String(loc.id || `loc-${Date.now()}-${idx}`),
      name: loc.name || 'Untitled',
      description: loc.description || '',
      address: loc.address || loc.booth || '',
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      featured: Boolean(loc.featured),
      categoryId,
      categoryName: loc.categoryName || category?.name || ''
    };
  }).filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
}

function initMap() {
  adminMap = new maplibregl.Map({
    container: 'admin-map',
    style: resolveMapStyleUrl(mapData.map?.style),
    center: mapData.map.center,
    zoom: Math.max((mapData.map.zoom || 17) - 1, 12),
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

function bindUI() {
  document.getElementById('add-form').addEventListener('submit', upsertLocation);
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import-json').addEventListener('click', () => document.getElementById('json-file').click());
  document.getElementById('json-file').addEventListener('change', importJSON);
  document.getElementById('btn-csv-import').addEventListener('click', importCSV);
  document.getElementById('csv-file').addEventListener('change', handleCSVFile);
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

  const used = new Set(mapData.locations.map((loc) => loc.categoryId).filter(Boolean));
  document.getElementById('stat-cats').textContent = String(used.size);
}

function renderTable() {
  const tbody = document.getElementById('location-tbody');
  tbody.innerHTML = '';

  const sorted = mapData.locations
    .map((loc, idx) => ({ loc, idx }))
    .sort((a, b) => a.loc.name.localeCompare(b.loc.name));

  sorted.forEach(({ loc, idx }) => {
    const category = getCategory(loc.categoryId, loc.categoryName);
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td><strong>${escapeHtml(loc.name)}</strong>${loc.featured ? ' <span title="Featured">&#9733;</span>' : ''}</td>
      <td>${escapeHtml(loc.address || '-')}</td>
      <td><span class="badge" style="background:${category.color};">${escapeHtml(category.name)}</span></td>
      <td><code>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</code></td>
      <td>
        <button class="btn btn-sm btn-secondary" data-action="edit" data-idx="${idx}">Edit</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-idx="${idx}">Delete</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('button[data-action="edit"]').forEach((button) => {
    button.addEventListener('click', () => editLocation(Number(button.dataset.idx)));
  });

  tbody.querySelectorAll('button[data-action="delete"]').forEach((button) => {
    button.addEventListener('click', () => deleteLocation(Number(button.dataset.idx)));
  });
}

function upsertLocation(event) {
  event.preventDefault();

  const categoryId = document.getElementById('loc-category').value;
  const category = getCategory(categoryId);

  const payload = {
    id: document.getElementById('loc-id').value.trim() || `loc-${Date.now()}`,
    name: document.getElementById('loc-name').value.trim(),
    description: document.getElementById('loc-desc').value,
    address: document.getElementById('loc-address').value.trim(),
    lat: Number(document.getElementById('loc-lat').value),
    lng: Number(document.getElementById('loc-lng').value),
    featured: document.getElementById('loc-featured').checked,
    categoryId,
    categoryName: category.name
  };

  if (!payload.name || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng) || !payload.categoryId) {
    alert('Name, category, latitude, and longitude are required.');
    return;
  }

  const form = document.getElementById('add-form');
  const editIdxRaw = form.dataset.editIdx;

  if (editIdxRaw !== undefined && editIdxRaw !== '') {
    mapData.locations[Number(editIdxRaw)] = payload;
    delete form.dataset.editIdx;
    document.getElementById('btn-submit').textContent = 'Add Location';
  } else {
    mapData.locations.push(payload);
  }

  form.reset();
  clearDropPin();
  renderTable();
  updateStats();
}

function editLocation(idx) {
  const loc = mapData.locations[idx];
  if (!loc) return;

  document.getElementById('loc-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-category').value = loc.categoryId;
  document.getElementById('loc-address').value = loc.address || '';
  document.getElementById('loc-lat').value = String(loc.lat);
  document.getElementById('loc-lng').value = String(loc.lng);
  document.getElementById('loc-desc').value = loc.description || '';
  document.getElementById('loc-featured').checked = Boolean(loc.featured);

  const form = document.getElementById('add-form');
  form.dataset.editIdx = String(idx);
  document.getElementById('btn-submit').textContent = 'Update Location';

  adminMap.flyTo({ center: [loc.lng, loc.lat], zoom: Math.max(adminMap.getZoom(), 16) });
  clearDropPin();
  dropPin = new maplibregl.Marker({ color: '#bb3e2f' }).setLngLat([loc.lng, loc.lat]).addTo(adminMap);
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteLocation(idx) {
  const loc = mapData.locations[idx];
  if (!loc) return;

  if (!confirm(`Delete "${loc.name}"?`)) return;

  mapData.locations.splice(idx, 1);
  renderTable();
  updateStats();
}

function exportJSON() {
  const output = {
    ...mapData,
    locations: mapData.locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      description: loc.description,
      address: loc.address,
      lat: loc.lat,
      lng: loc.lng,
      categoryId: loc.categoryId,
      categoryName: loc.categoryName,
      featured: Boolean(loc.featured)
    }))
  };

  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'locations.json';
  link.click();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    try {
      const parsed = JSON.parse(loadEvent.target.result);
      if (!parsed.locations || !Array.isArray(parsed.locations)) {
        throw new Error('JSON must include a locations array.');
      }

      mapData = {
        ...mapData,
        ...parsed,
        map: parsed.map || mapData.map,
        categories: Array.isArray(parsed.categories) ? parsed.categories : mapData.categories,
        locations: parsed.locations
      };

      normalizeData();
      populateCategorySelect();
      renderTable();
      updateStats();
      alert(`Imported ${mapData.locations.length} locations from JSON.`);
    } catch (error) {
      alert(`JSON import failed: ${error.message}`);
    }

    event.target.value = '';
  };

  reader.readAsText(file);
}

function importCSV() {
  const raw = document.getElementById('csv-textarea').value.trim();
  if (!raw) {
    alert('Paste CSV data first.');
    return;
  }

  const rows = parseCSV(raw);
  if (rows.length < 2) {
    alert('CSV must include a header row and one data row.');
    return;
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const idxName = headers.indexOf('name');
  const idxCatId = headers.indexOf('categoryid');
  const idxCatName = headers.indexOf('categoryname');
  const idxCategory = headers.indexOf('category');
  const idxAddress = headers.indexOf('address');
  const idxLat = headers.indexOf('lat');
  const idxLng = headers.indexOf('lng');
  const idxDescription = headers.indexOf('description');
  const idxFeatured = headers.indexOf('featured');

  if (idxName === -1 || idxLat === -1 || idxLng === -1) {
    alert('CSV requires name, lat, and lng columns.');
    return;
  }

  let added = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const cols = rows[i];
    const name = (cols[idxName] || '').trim();
    const lat = Number(cols[idxLat]);
    const lng = Number(cols[idxLng]);

    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const categoryId = resolveCategoryId(
      (idxCatId !== -1 ? cols[idxCatId] : '') || '',
      (idxCatName !== -1 ? cols[idxCatName] : '') || '',
      (idxCategory !== -1 ? cols[idxCategory] : '') || ''
    );

    const category = getCategory(categoryId);

    mapData.locations.push({
      id: `csv-${Date.now()}-${i}`,
      name,
      description: idxDescription !== -1 ? (cols[idxDescription] || '') : '',
      address: idxAddress !== -1 ? (cols[idxAddress] || '') : '',
      lat,
      lng,
      categoryId: category.id,
      categoryName: category.name,
      featured: idxFeatured !== -1 ? normalizeBoolean(cols[idxFeatured]) : false
    });

    added += 1;
  }

  renderTable();
  updateStats();
  document.getElementById('csv-textarea').value = '';
  alert(`Imported ${added} locations from CSV.`);
}

function handleCSVFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    document.getElementById('csv-textarea').value = loadEvent.target.result;
  };

  reader.readAsText(file);
}

function resolveCategoryId(catId, catName, fallbackCategory) {
  const normalizedId = String(catId || '').trim();
  if (mapData.categories.some((cat) => cat.id === normalizedId)) return normalizedId;

  const nameNeedle = String(catName || fallbackCategory || '').trim().toLowerCase();
  if (nameNeedle) {
    const byName = mapData.categories.find((cat) => cat.name.toLowerCase() === nameNeedle);
    if (byName) return byName.id;
  }

  return mapData.categories[0]?.id || '';
}

function getCategory(id, fallbackName = '') {
  return mapData.categories.find((cat) => cat.id === id) || {
    id,
    name: fallbackName || 'Uncategorized',
    color: '#707070'
  };
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
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
