// ============================================
// TheFairMap — Admin Logic
// ============================================

let adminMap, mapData, dropPin;
const ADMIN_PASS = 'fairmap2026'; // Change this

// ---- Auth ----
function checkAuth() {
  const stored = sessionStorage.getItem('fairmap-admin');
  if (stored === ADMIN_PASS) return true;
  const pass = prompt('Enter admin password:');
  if (pass === ADMIN_PASS) {
    sessionStorage.setItem('fairmap-admin', pass);
    return true;
  }
  document.body.innerHTML = '<div style="padding:60px;text-align:center"><h2>Access Denied</h2><p>Refresh to try again.</p></div>';
  return false;
}

async function init() {
  if (!checkAuth()) return;

  const res = await fetch('./data/locations.json');
  mapData = await res.json();

  // Init admin map
  adminMap = new maplibregl.Map({
    container: 'admin-map',
    style: mapData.map.style,
    center: mapData.map.center,
    zoom: mapData.map.zoom - 1
  });

  adminMap.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Click to drop pin
  adminMap.on('click', (e) => {
    document.getElementById('loc-lat').value = e.lngLat.lat.toFixed(6);
    document.getElementById('loc-lng').value = e.lngLat.lng.toFixed(6);
    if (dropPin) dropPin.remove();
    dropPin = new maplibregl.Marker({ color: '#E74C3C' })
      .setLngLat([e.lngLat.lng, e.lngLat.lat])
      .addTo(adminMap);
  });

  // Populate category dropdown
  const select = document.getElementById('loc-category');
  mapData.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon} ${cat.name}`;
    select.appendChild(opt);
  });

  renderTable();
  updateStats();

  // Form submit
  document.getElementById('add-form').addEventListener('submit', addLocation);

  // Export
  document.getElementById('btn-export').addEventListener('click', exportJSON);

  // CSV import
  document.getElementById('btn-csv-import').addEventListener('click', importCSV);

  // File upload
  document.getElementById('csv-file').addEventListener('change', handleCSVFile);
}

// ---- Table ----
function renderTable() {
  const tbody = document.getElementById('location-tbody');
  tbody.innerHTML = '';

  mapData.locations.forEach((loc, idx) => {
    const cat = mapData.categories.find(c => c.id === loc.category);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${loc.name}</strong>${loc.featured ? ' ⭐' : ''}</td>
      <td>${loc.booth || '—'}</td>
      <td><span class="cat-badge" style="background:${cat ? cat.color : '#999'};padding:2px 6px;border-radius:10px;color:white;font-size:11px">${cat ? cat.icon + ' ' + cat.name : loc.category}</span></td>
      <td style="font-family:monospace;font-size:11px">${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}</td>
      <td>
        <button class="btn btn-sm btn-secondary" onclick="editLocation(${idx})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteLocation(${idx})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateStats() {
  document.getElementById('stat-total').textContent = mapData.locations.length;
  const cats = {};
  mapData.locations.forEach(l => { cats[l.category] = (cats[l.category] || 0) + 1; });
  document.getElementById('stat-cats').textContent = Object.keys(cats).length;
}

// ---- Add ----
function addLocation(e) {
  e.preventDefault();
  const loc = {
    id: document.getElementById('loc-id').value || ('loc-' + Date.now()),
    name: document.getElementById('loc-name').value,
    category: document.getElementById('loc-category').value,
    booth: document.getElementById('loc-booth').value,
    description: document.getElementById('loc-desc').value,
    lat: parseFloat(document.getElementById('loc-lat').value),
    lng: parseFloat(document.getElementById('loc-lng').value),
    website: document.getElementById('loc-website').value,
    image: document.getElementById('loc-image').value,
    featured: document.getElementById('loc-featured').checked
  };

  if (!loc.name || isNaN(loc.lat) || isNaN(loc.lng)) {
    alert('Name, latitude, and longitude are required.');
    return;
  }

  // Check if editing existing
  const editIdx = document.getElementById('add-form').dataset.editIdx;
  if (editIdx !== undefined && editIdx !== '') {
    mapData.locations[parseInt(editIdx)] = loc;
    delete document.getElementById('add-form').dataset.editIdx;
    document.getElementById('btn-submit').textContent = '+ Add Location';
  } else {
    mapData.locations.push(loc);
  }

  document.getElementById('add-form').reset();
  if (dropPin) { dropPin.remove(); dropPin = null; }
  renderTable();
  updateStats();
}

// ---- Edit ----
window.editLocation = function(idx) {
  const loc = mapData.locations[idx];
  document.getElementById('loc-id').value = loc.id;
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-category').value = loc.category;
  document.getElementById('loc-booth').value = loc.booth || '';
  document.getElementById('loc-desc').value = loc.description || '';
  document.getElementById('loc-lat').value = loc.lat;
  document.getElementById('loc-lng').value = loc.lng;
  document.getElementById('loc-website').value = loc.website || '';
  document.getElementById('loc-image').value = loc.image || '';
  document.getElementById('loc-featured').checked = loc.featured || false;

  document.getElementById('add-form').dataset.editIdx = idx;
  document.getElementById('btn-submit').textContent = '✓ Update Location';

  // Fly to location on admin map
  adminMap.flyTo({ center: [loc.lng, loc.lat], zoom: 17 });
  if (dropPin) dropPin.remove();
  dropPin = new maplibregl.Marker({ color: '#E74C3C' })
    .setLngLat([loc.lng, loc.lat])
    .addTo(adminMap);

  document.getElementById('add-form').scrollIntoView({ behavior: 'smooth' });
};

// ---- Delete ----
window.deleteLocation = function(idx) {
  const name = mapData.locations[idx].name;
  if (!confirm(`Delete "${name}"?`)) return;
  mapData.locations.splice(idx, 1);
  renderTable();
  updateStats();
};

// ---- Export JSON ----
function exportJSON() {
  const json = JSON.stringify(mapData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'locations.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---- CSV Import ----
function importCSV() {
  const text = document.getElementById('csv-textarea').value.trim();
  if (!text) return alert('Paste CSV data first.');
  parseCSV(text);
}

function handleCSVFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('csv-textarea').value = ev.target.result;
  };
  reader.readAsText(file);
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return alert('CSV needs a header row + data rows.');

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('name');
  const catIdx = headers.indexOf('category');
  const boothIdx = headers.indexOf('booth');
  const descIdx = headers.indexOf('description');
  const latIdx = headers.indexOf('lat');
  const lngIdx = headers.indexOf('lng');

  if (nameIdx === -1 || latIdx === -1 || lngIdx === -1) {
    alert('CSV must have columns: name, lat, lng (minimum). Also supports: category, booth, description, website, image, featured');
    return;
  }

  const webIdx = headers.indexOf('website');
  const imgIdx = headers.indexOf('image');
  const featIdx = headers.indexOf('featured');
  let added = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (!cols[nameIdx]) continue;

    mapData.locations.push({
      id: 'csv-' + Date.now() + '-' + i,
      name: cols[nameIdx],
      category: catIdx !== -1 ? cols[catIdx] : 'general',
      booth: boothIdx !== -1 ? cols[boothIdx] : '',
      description: descIdx !== -1 ? cols[descIdx] : '',
      lat: parseFloat(cols[latIdx]),
      lng: parseFloat(cols[lngIdx]),
      website: webIdx !== -1 ? cols[webIdx] : '',
      image: imgIdx !== -1 ? cols[imgIdx] : '',
      featured: featIdx !== -1 ? cols[featIdx] === 'true' : false
    });
    added++;
  }

  alert(`Imported ${added} locations.`);
  renderTable();
  updateStats();
  document.getElementById('csv-textarea').value = '';
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', init);
