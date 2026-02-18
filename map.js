// ============================================
// TheFairMap — Map Viewer Logic
// ============================================

let map, mapData, markers = [], popup;
const activeCategories = new Set();

async function init() {
  const res = await fetch('./data/locations.json');
  mapData = await res.json();

  // Init map
  map = new maplibregl.Map({
    container: 'map',
    style: mapData.map.style,
    center: mapData.map.center,
    zoom: mapData.map.zoom,
    maxZoom: mapData.map.maxZoom || 20
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Init all categories as active
  mapData.categories.forEach(c => activeCategories.add(c.id));

  // Build sidebar
  buildFilters();
  buildLocationList();
  renderMarkers();

  // Search
  document.getElementById('search').addEventListener('input', onSearch);

  // Locate me
  document.getElementById('btn-locate').addEventListener('click', locateMe);

  // Mobile sidebar toggle
  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);
}

// ---- Markers ----
function renderMarkers() {
  // Clear existing
  markers.forEach(m => m.remove());
  markers = [];

  const query = (document.getElementById('search')?.value || '').toLowerCase();

  mapData.locations.forEach(loc => {
    if (!activeCategories.has(loc.category)) return;
    if (query && !loc.name.toLowerCase().includes(query) && !(loc.booth || '').toLowerCase().includes(query)) return;

    const cat = mapData.categories.find(c => c.id === loc.category);

    // Create marker element
    const el = document.createElement('div');
    el.className = 'map-marker';
    el.style.cssText = `
      width: ${loc.featured ? 36 : 28}px;
      height: ${loc.featured ? 36 : 28}px;
      background: ${cat ? cat.color : '#999'};
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: ${loc.featured ? 16 : 12}px;
      transition: transform 0.15s;
    `;
    el.textContent = cat ? cat.icon : '📍';
    el.addEventListener('mouseenter', () => el.style.transform = 'scale(1.2)');
    el.addEventListener('mouseleave', () => el.style.transform = 'scale(1)');

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([loc.lng, loc.lat])
      .addTo(map);

    el.addEventListener('click', () => showPopup(loc, cat));
    marker._locId = loc.id;
    markers.push(marker);
  });
}

function showPopup(loc, cat) {
  if (popup) popup.remove();

  let html = '<div class="popup-inner">';
  if (loc.image) {
    html += `<img class="popup-img" src="${loc.image}" alt="${loc.name}">`;
  }
  if (cat) {
    html += `<span class="popup-cat-badge" style="background:${cat.color}">${cat.icon} ${cat.name}</span>`;
  }
  html += `<h3>${loc.name}</h3>`;
  if (loc.booth) {
    html += `<div class="popup-booth">📍 ${loc.booth}</div>`;
  }
  if (loc.description) {
    html += `<div class="popup-desc">${loc.description}</div>`;
  }
  if (loc.website) {
    html += `<a class="popup-link" href="${loc.website}" target="_blank" rel="noopener">Visit Website →</a>`;
  }
  html += '</div>';

  popup = new maplibregl.Popup({ offset: 20, maxWidth: '300px' })
    .setLngLat([loc.lng, loc.lat])
    .setHTML(html)
    .addTo(map);

  map.flyTo({ center: [loc.lng, loc.lat], zoom: Math.max(map.getZoom(), 17) });
}

// ---- Filters ----
function buildFilters() {
  const container = document.getElementById('filters');
  container.innerHTML = '';

  mapData.categories.forEach(cat => {
    const count = mapData.locations.filter(l => l.category === cat.id).length;
    const label = document.createElement('label');
    label.className = 'filter-item';
    label.innerHTML = `
      <input type="checkbox" checked data-cat="${cat.id}">
      <span class="filter-dot" style="background:${cat.color}"></span>
      ${cat.icon} ${cat.name} <span style="color:#999;font-size:12px">(${count})</span>
    `;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeCategories.add(cat.id);
      else activeCategories.delete(cat.id);
      renderMarkers();
      buildLocationList();
    });
    container.appendChild(label);
  });
}

// ---- Location List ----
function buildLocationList() {
  const container = document.getElementById('location-list');
  const query = (document.getElementById('search')?.value || '').toLowerCase();
  container.innerHTML = '';

  const filtered = mapData.locations.filter(loc => {
    if (!activeCategories.has(loc.category)) return false;
    if (query && !loc.name.toLowerCase().includes(query) && !(loc.booth || '').toLowerCase().includes(query)) return false;
    return true;
  });

  // Featured first, then alphabetical
  filtered.sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.name.localeCompare(b.name);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:16px;color:#999;font-size:13px">No vendors match your filters.</div>';
    return;
  }

  filtered.forEach(loc => {
    const cat = mapData.categories.find(c => c.id === loc.category);
    const card = document.createElement('div');
    card.className = 'location-card' + (loc.featured ? ' featured' : '');
    card.innerHTML = `
      <h4>${loc.featured ? '⭐ ' : ''}${loc.name}</h4>
      <div class="booth">${loc.booth || ''}</div>
      ${cat ? `<span class="cat-badge" style="background:${cat.color}">${cat.icon} ${cat.name}</span>` : ''}
    `;
    card.addEventListener('click', () => showPopup(loc, cat));
    container.appendChild(card);
  });

  // Update count
  const countEl = document.getElementById('vendor-count');
  if (countEl) countEl.textContent = `${filtered.length} vendor${filtered.length !== 1 ? 's' : ''}`;
}

// ---- Search ----
function onSearch() {
  renderMarkers();
  buildLocationList();
}

// ---- Geolocation ----
function locateMe() {
  if (!navigator.geolocation) return alert('Geolocation not supported.');
  const btn = document.getElementById('btn-locate');
  btn.textContent = '⏳';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.textContent = '📍';
      map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 18 });
      new maplibregl.Marker({ color: '#3B82F6' })
        .setLngLat([pos.coords.longitude, pos.coords.latitude])
        .addTo(map);
    },
    () => { btn.textContent = '📍'; alert('Could not get your location.'); }
  );
}

// ---- Mobile ----
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ---- Boot ----
document.addEventListener('DOMContentLoaded', init);
