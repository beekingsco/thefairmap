let map;
let popup;
let geolocateControl;

const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_CENTER = [-95.8624, 32.5585];
const DEFAULT_ZOOM = 17;
const DEFAULT_PITCH = 60;
const DEFAULT_BEARING = 0;
const SOURCE_ID = 'locations';
const LAYER_MARKERS = 'location-markers';
const LAYER_ICONS = 'location-icons';
const LAYER_SELECTED = 'location-selected';

const appState = {
  mapData: null,
  categories: [],
  categoriesById: new Map(),
  locations: [],
  categoryExpanded: new Map(),
  categoryIconFiles: new Map(),
  activeCategories: new Set(),
  filteredLocations: [],
  selectedLocationId: null,
  sidebarOpen: false,
  overviewOpen: true,
  mapEventsBound: false,
  activeMapStyle: 'venue',
  venueStyleUrl: STYLE_FALLBACK,
  satelliteStyleUrl: SATELLITE_STYLE_FALLBACK,
  filtersInitialized: false
};

const ICON_SVGS = {
  fork: '<path fill="#fff" d="M7 2a1 1 0 0 1 1 1v5a3 3 0 0 1-2 2.83V22H4V10.83A3 3 0 0 1 2 8V3a1 1 0 1 1 2 0v5a1 1 0 1 0 2 0V3a1 1 0 0 1 1-1Zm9 0a4 4 0 0 1 4 4v16h-2v-6h-4v6h-2V6a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v8h4V6a2 2 0 0 0-2-2Z"/>',
  shirt: '<path fill="#fff" d="M8 2h8l2 3 4 2-2 5-3-1v11H7V11l-3 1-2-5 4-2 2-3Zm1.1 2L8 5.7 5.2 7.1l.6 1.6L9 7.7V20h6V7.7l3.2 1 .6-1.6L16 5.7 14.9 4H9.1Z"/>',
  gem: '<path fill="#fff" d="M7 3h10l4 5-9 13L3 8l4-5Zm1 2L6 7.5h12L16 5H8Zm4 13.1 5.7-8.6H6.3L12 18.1Z"/>',
  home: '<path fill="#fff" d="m12 3 9 7v11h-6v-7H9v7H3V10l9-7Zm0 2.5L5 11v8h2v-7h10v7h2v-8l-7-5.5Z"/>',
  star: '<path fill="#fff" d="m12 2 2.9 6.1L22 9.2l-5 4.8 1.2 7-6.2-3.4L5.8 21 7 14 2 9.2l7.1-1.1L12 2Z"/>',
  hand: '<path fill="#fff" d="M8 11V4a1 1 0 1 1 2 0v6h1V3a1 1 0 1 1 2 0v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8c0 4.4-3.6 8-8 8s-8-3.6-8-8v-2a1 1 0 1 1 2 0v2c0 3.3 2.7 6 6 6s6-2.7 6-6v-2h-9Z"/>',
  chair: '<path fill="#fff" d="M7 4a3 3 0 0 1 6 0v5h5a2 2 0 0 1 2 2v5h-2v6h-2v-6H8v6H6v-6H4v6H2v-6a2 2 0 0 1 2-2h7V4a1 1 0 1 0-2 0v3H7V4Z"/>',
  clock: '<path fill="#fff" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v5.4l3.8 2.2-1 1.7L11 13V7h2Z"/>',
  palette: '<path fill="#fff" d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h3a6 6 0 0 0 0-12h-3Zm-4 7a1.3 1.3 0 1 1 0-2.6A1.3 1.3 0 0 1 8 10Zm-2 4a1.3 1.3 0 1 1 0-2.6A1.3 1.3 0 0 1 6 14Zm8-6a1.3 1.3 0 1 1 0-2.6A1.3 1.3 0 0 1 14 8Zm4 2a1.3 1.3 0 1 1 0-2.6A1.3 1.3 0 0 1 18 10Z"/>',
  leaf: '<path fill="#fff" d="M20.5 3.5c-9.3.3-14.7 4.9-16 14.2l-.3 2.3 2.3-.3c9.3-1.3 13.9-6.7 14.2-16l.1-2.3-2.3.1ZM7.3 17c1.1-5.9 4.2-9 10.1-10.1-1.1 5.9-4.2 9-10.1 10.1Z"/>',
  bag: '<path fill="#fff" d="M8 7a4 4 0 1 1 8 0h3l1 13H4L5 7h3Zm2 0h4a2 2 0 1 0-4 0Zm-3.1 2-.7 9h11.6l-.7-9H16v2h-2V9h-4v2H8V9H6.9Z"/>',
  glasses: '<path fill="#fff" d="M3 8h7l1 3h2l1-3h7v2h-1l-1 4a3 3 0 0 1-2.9 2.3h-2.2a3 3 0 0 1-2.9-2.3l-.5-1.7-.5 1.7a3 3 0 0 1-2.9 2.3H6.9A3 3 0 0 1 4 14l-1-4H2V8h1Zm3.9 6.3h2.2a1 1 0 0 0 1-.8l.8-3.5H5l.8 3.5c.1.5.5.8 1 .8Zm8.2 0h2.2a1 1 0 0 0 1-.8L19 10h-5.9l.8 3.5c.1.5.5.8 1 .8Z"/>',
  wood: '<path fill="#fff" d="M12 2c6 0 10 4 10 10s-4 10-10 10S2 18 2 12 6 2 12 2Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 2a6 6 0 0 1 6 6h-2a4 4 0 1 0-4 4v2a6 6 0 1 1 0-12Z"/>',
  dollar: '<path fill="#fff" d="M13 2v2.1c2.5.3 4.2 1.8 4.6 4.1h-2c-.3-1.2-1.2-2.1-3.1-2.1-2 0-3 .8-3 2 0 1 .5 1.6 3.5 2.2 3.5.7 5.1 2 5.1 4.7 0 2.5-1.8 4.2-5.1 4.6V22h-2v-2.1c-2.9-.3-4.8-2-5.2-4.5h2.1c.3 1.5 1.4 2.5 3.6 2.5 2.2 0 3.4-.9 3.4-2.3 0-1.3-.8-2-3.9-2.7-3.2-.7-4.7-1.8-4.7-4.2 0-2.3 1.8-3.9 4.7-4.3V2h2Z"/>',
  info: '<path fill="#fff" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm0 3h2v6h-2v-6Z"/>',
  wheelchair: '<path fill="#fff" d="M13 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-5 7h4l1.5 3H17v2h-4.8L10 10H8V8Zm2.5 5.5a4.5 4.5 0 1 0 4.4-5.5h2.1a6.5 6.5 0 1 1-6.3 8h2.1a4.5 4.5 0 0 0-2.3-2.5Z"/>',
  restroom: '<path fill="#fff" d="M7 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm10 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM6 7h2v5l1 3v7H7v-6l-2-6V7Zm11 0h2v3l-2 6v6h-2v-7l1-3V7Zm-5 0h2v15h-2V7Z"/>',
  pin: '<path fill="#fff" d="M12 2a6 6 0 0 1 6 6c0 4.7-6 12-6 12S6 12.7 6 8a6 6 0 0 1 6-6Zm0 2a4 4 0 0 0-4 4c0 2.5 2.5 6.5 4 8.7 1.5-2.2 4-6.2 4-8.7a4 4 0 0 0-4-4Z"/>'
};

async function init() {
  const data = await fetchMapData();
  await loadIconManifest();
  appState.mapData = data;
  appState.venueStyleUrl = resolveStyleUrl(data.map?.style);
  appState.satelliteStyleUrl = resolveSatelliteStyleUrl();
  normalizeData(data);
  initializeSidebarState();
  bindUi();
  applyFilters();

  map = new maplibregl.Map({
    container: 'map',
    style: appState.venueStyleUrl,
    center: data.map?.center || DEFAULT_CENTER,
    zoom: Number.isFinite(data.map?.zoom) ? data.map.zoom : DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: DEFAULT_BEARING,
    maxZoom: data.map?.maxZoom || 20,
    attributionControl: true,
    antialias: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  geolocateControl = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserHeading: true
  });
  map.addControl(geolocateControl, 'bottom-right');

  map.on('load', async () => {
    await hydrateStyleContent();
    bindMapEvents();
  });
}

async function loadIconManifest() {
  try {
    const res = await fetch('/data/icons/manifest.json');
    if (!res.ok) return;
    const manifest = await res.json();
    for (const [categoryId, def] of Object.entries(manifest || {})) {
      if (typeof def?.file !== 'string' || !def.file.endsWith('.svg')) continue;
      appState.categoryIconFiles.set(String(categoryId), def.file);
    }
  } catch (_) {
    // Keep generic icons when manifest cannot be loaded.
  }
}

async function fetchMapData() {
  const sources = ['/api/locations', '/data/mapme-full-export.json'];
  for (const source of sources) {
    try {
      const res = await fetch(source);
      if (!res.ok) continue;
      const json = await res.json();
      if (Array.isArray(json.locations) && Array.isArray(json.categories)) {
        return json;
      }
    } catch (_) {
      // try next source
    }
  }
  throw new Error('Unable to load map data');
}

function normalizeData(data) {
  appState.categories = (data.categories || []).map((category) => ({
    id: String(category.id),
    name: String(category.name || 'Uncategorized'),
    color: normalizeColor(category.color),
    count: Number(category.count || 0)
  }));

  appState.categories.forEach((category) => {
    appState.categoriesById.set(category.id, category);
    appState.activeCategories.add(category.id);
    appState.categoryExpanded.set(category.id, false);
  });

  appState.locations = (data.locations || [])
    .map((loc, idx) => {
      const categoryId = String(loc.categoryId || 'uncategorized');
      const category = appState.categoriesById.get(categoryId);
      const categoryName = loc.categoryName || category?.name || 'Uncategorized';
      return {
        id: String(loc.id || `loc-${idx}`),
        name: String(loc.name || 'Untitled'),
        description: typeof loc.description === 'string' ? loc.description : '',
        address: typeof loc.address === 'string' ? loc.address : '',
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        categoryId,
        categoryName,
        color: normalizeColor(category?.color || loc.color),
        iconType: iconTypeForCategory(categoryId, categoryName),
        search: `${loc.name || ''} ${categoryName} ${loc.address || ''}`.toLowerCase()
      };
    })
    .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
  appState.filteredLocations = [...appState.locations];
  appState.filtersInitialized = true;

  // Ensure category counts match the rendered data.
  const computedCounts = new Map();
  for (const location of appState.locations) {
    computedCounts.set(location.categoryId, (computedCounts.get(location.categoryId) || 0) + 1);
  }
  appState.categories = appState.categories
    .map((category) => ({ ...category, count: computedCounts.get(category.id) || category.count || 0 }))
    .filter((category) => category.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function bindUi() {
  const searchInput = document.getElementById('search-input');
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(applyFilters, 120);
  });

  document.getElementById('overview-toggle').addEventListener('click', () => {
    appState.overviewOpen = !appState.overviewOpen;
    document.getElementById('overview-toggle').setAttribute('aria-expanded', String(appState.overviewOpen));
    document.getElementById('overview-toggle').textContent = appState.overviewOpen ? 'Collapse Overview' : 'Expand Overview';
    document.getElementById('overview-list').classList.toggle('is-collapsed', !appState.overviewOpen);
  });

  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('style-venue-btn').addEventListener('click', () => setMapStyle('venue'));
  document.getElementById('style-satellite-btn').addEventListener('click', () => setMapStyle('satellite'));
  document.getElementById('mobile-scrim').addEventListener('click', closeMobileSidebar);
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDetailPanel();
      closeMobileSidebar();
    }
  });

  window.addEventListener('resize', () => {
    const mobile = window.innerWidth <= 960;
    if (!mobile) {
      document.getElementById('mobile-scrim').hidden = true;
      const app = document.getElementById('app');
      app.classList.toggle('sidebar-open', appState.sidebarOpen);
      app.classList.toggle('sidebar-collapsed', !appState.sidebarOpen);
      updateSidebarToggle(appState.sidebarOpen);
    }
    if (mobile) {
      document.getElementById('app').classList.remove('sidebar-collapsed');
      document.getElementById('app').classList.add('sidebar-open');
      updateSidebarToggle(true);
    }
    map?.resize();
  });
}

function initializeSidebarState() {
  const mobile = window.innerWidth <= 960;
  appState.sidebarOpen = mobile ? true : false;
  const app = document.getElementById('app');
  app.classList.toggle('sidebar-open', appState.sidebarOpen);
  app.classList.toggle('sidebar-collapsed', !appState.sidebarOpen);
  updateSidebarToggle(appState.sidebarOpen);
  updateFilterCount();
  updateMapStyleButtons();
}

async function loadMarkerIcons() {
  const categoryIconFiles = new Set(appState.categoryIconFiles.values());
  for (const iconFile of categoryIconFiles) {
    const iconId = iconIdFromFile(iconFile);
    if (map.hasImage(iconId)) continue;
    try {
      const image = await loadImageByUrl(`/data/icons/${iconFile}`);
      map.addImage(iconId, image, { pixelRatio: 2 });
    } catch (_) {
      // fall back to generic icon
    }
  }

  const iconTypes = Object.keys(ICON_SVGS);
  for (const iconType of iconTypes) {
    if (map.hasImage(iconType)) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24">${ICON_SVGS[iconType]}</svg>`;
    const image = await loadSvgImage(svg);
    map.addImage(iconType, image, { pixelRatio: 2 });
  }
}

function loadSvgImage(svgMarkup) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  });
}

function loadImageByUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function buildLayers() {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection([]),
    generateId: true
  });

  map.addLayer({
    id: LAYER_MARKERS,
    type: 'circle',
    source: SOURCE_ID,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, 13,
        16, 16,
        17, 18,
        20, 20
      ],
      'circle-stroke-width': [
        'interpolate', ['linear'], ['zoom'],
        14, 1.5,
        17, 2.2,
        20, 2.6
      ],
      'circle-stroke-color': '#ffffff'
    }
  });

  map.addLayer({
    id: LAYER_ICONS,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'icon-image': ['coalesce', ['get', 'iconType'], 'pin'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        14, 0.72,
        16, 0.84,
        17, 0.95,
        20, 1.1
      ]
    }
  });

  map.addLayer({
    id: LAYER_SELECTED,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, 14,
        17, 19,
        20, 22
      ],
      'circle-color': '#ffffff',
      'circle-opacity': 0.38,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#111111'
    }
  });
}

function bindMapEvents() {
  if (appState.mapEventsBound) return;
  appState.mapEventsBound = true;

  map.on('click', LAYER_MARKERS, onMarkerClick);
  map.on('click', LAYER_ICONS, onMarkerClick);

  map.on('mouseenter', LAYER_MARKERS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LAYER_MARKERS, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_ICONS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LAYER_ICONS, () => {
    map.getCanvas().style.cursor = '';
  });
}

function onMarkerClick(event) {
  const feature = event.features?.[0];
  if (!feature?.properties?.id) return;
  const location = appState.filteredLocations.find((loc) => loc.id === feature.properties.id);
  if (!location) return;
  openLocation(location, true);
}

function applyFilters() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();

  appState.filteredLocations = appState.locations.filter((loc) => {
    const catVisible = appState.activeCategories.has(loc.categoryId);
    const matchQuery = !query || loc.search.includes(query);
    return catVisible && matchQuery;
  });
  appState.filtersInitialized = true;

  if (map?.getSource(SOURCE_ID)) {
    map.getSource(SOURCE_ID).setData(toFeatureCollection(appState.filteredLocations));
  }

  if (!appState.filteredLocations.some((loc) => loc.id === appState.selectedLocationId)) {
    appState.selectedLocationId = null;
    syncSelectedLayer();
    if (popup) {
      popup.remove();
      popup = null;
    }
    closeDetailPanel();
  }

  renderOverview(query);
  updateFilterCount();
}

function renderOverview(query) {
  const wrap = document.getElementById('overview-list');
  wrap.innerHTML = '';

  const visibleCounts = new Map();
  for (const loc of appState.filteredLocations) {
    visibleCounts.set(loc.categoryId, (visibleCounts.get(loc.categoryId) || 0) + 1);
  }

  for (const category of appState.categories) {
    const active = appState.activeCategories.has(category.id);
    const visibleInCategory = appState.filteredLocations.filter((loc) => loc.categoryId === category.id);
    const autoExpand = Boolean(query) && visibleInCategory.length > 0;
    const expanded = autoExpand || appState.categoryExpanded.get(category.id) === true;

    const cat = document.createElement('article');
    cat.className = `category-item ${expanded ? 'is-expanded' : ''} ${active ? '' : 'is-muted'}`;

    const row = document.createElement('div');
    row.className = 'category-row';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'category-visibility';
    toggle.title = active ? 'Hide category markers' : 'Show category markers';
    toggle.setAttribute('aria-label', `${active ? 'Hide' : 'Show'} ${category.name}`);
    toggle.style.setProperty('--cat-color', category.color);
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (appState.activeCategories.has(category.id)) appState.activeCategories.delete(category.id);
      else appState.activeCategories.add(category.id);
      applyFilters();
    });

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'category-head';
    head.setAttribute('aria-expanded', String(expanded));
    head.innerHTML = `
      <span class="category-name">${escapeHtml(category.name)}</span>
      <span class="category-count">${visibleCounts.get(category.id) || 0}/${category.count}</span>
    `;
    head.addEventListener('click', () => {
      appState.categoryExpanded.set(category.id, !expanded);
      renderOverview(query);
    });

    row.appendChild(toggle);
    row.appendChild(head);
    cat.appendChild(row);

    const locList = document.createElement('div');
    locList.className = 'category-locations';
    if (!expanded) locList.hidden = true;

    if (visibleInCategory.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'category-empty';
      empty.textContent = query ? 'No search matches.' : 'No visible locations.';
      locList.appendChild(empty);
    } else {
      const limit = visibleInCategory.slice(0, 80);
      for (const loc of limit) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'location-row';
        item.textContent = loc.name;
        item.addEventListener('click', () => openLocation(loc, true));
        locList.appendChild(item);
      }
      if (visibleInCategory.length > limit.length) {
        const more = document.createElement('p');
        more.className = 'category-empty';
        more.textContent = `${visibleInCategory.length - limit.length} more...`;
        locList.appendChild(more);
      }
    }

    cat.appendChild(locList);
    wrap.appendChild(cat);
  }
}

function openLocation(location, fly) {
  appState.selectedLocationId = location.id;
  syncSelectedLayer();

  if (popup) popup.remove();
  popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 18,
    className: 'map-anchor-popup'
  })
    .setLngLat([location.lng, location.lat])
    .setHTML(`<div class="anchor-title">${escapeHtml(location.name)}</div>`)
    .addTo(map);

  renderDetail(location);

  if (fly) {
    map.easeTo({
      center: [location.lng, location.lat],
      zoom: Math.max(17, map.getZoom()),
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      duration: 450
    });
  }

  if (window.innerWidth <= 960) {
    closeMobileSidebar();
  }
}

function renderDetail(location) {
  const panel = document.getElementById('detail-panel');
  const content = document.getElementById('detail-content');
  const category = appState.categoriesById.get(location.categoryId);
  const categoryName = category?.name || location.categoryName;
  const color = normalizeColor(category?.color || location.color);
  const directionsHref = `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`;
  const shareUrl = `${location.origin || window.location.origin}?loc=${encodeURIComponent(location.id)}`;

  content.innerHTML = `
    <h2 class="detail-title">${escapeHtml(location.name)}</h2>
    <div class="detail-badge" style="background:${color};color:${pickTextColor(color)};">${escapeHtml(categoryName)}</div>
    ${location.description ? `<div class="detail-description">${location.description}</div>` : ''}
    ${location.address ? `<p class="detail-address">${escapeHtml(location.address)}</p>` : ''}
    <div class="detail-actions">
      <a class="detail-btn primary" href="${directionsHref}" target="_blank" rel="noopener">Get Directions</a>
      <button id="detail-share" class="detail-btn" type="button">Share</button>
    </div>
  `;

  panel.hidden = false;
  panel.classList.add('is-open');

  const shareBtn = document.getElementById('detail-share');
  shareBtn?.addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: location.name, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch (_) {
      // no-op
    }
  });
}

function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('is-open');
  panel.hidden = true;
}

function toggleSidebar() {
  const mobile = window.innerWidth <= 960;
  if (mobile) {
    const app = document.getElementById('app');
    app.classList.toggle('mobile-sidebar-open');
    document.getElementById('mobile-scrim').hidden = !app.classList.contains('mobile-sidebar-open');
    return;
  }

  appState.sidebarOpen = !appState.sidebarOpen;
  const app = document.getElementById('app');
  app.classList.toggle('sidebar-open', appState.sidebarOpen);
  app.classList.toggle('sidebar-collapsed', !appState.sidebarOpen);
  updateSidebarToggle(appState.sidebarOpen);

  setTimeout(() => map?.resize(), 220);
}

function closeMobileSidebar() {
  if (window.innerWidth > 960) return;
  const app = document.getElementById('app');
  app.classList.remove('mobile-sidebar-open');
  document.getElementById('mobile-scrim').hidden = true;
}

function updateSidebarToggle(isOpen) {
  const toggle = document.getElementById('sidebar-toggle');
  const glyph = toggle?.querySelector('.map-btn-glyph');
  if (glyph) glyph.textContent = isOpen ? '\u2630' : '>';
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Collapse filters' : 'Expand filters');
}

function updateFilterCount() {
  const countEl = document.getElementById('filters-count');
  if (!countEl) return;
  const visibleCount = appState.filtersInitialized
    ? appState.filteredLocations.length
    : appState.locations.length;
  countEl.textContent = `(${visibleCount})`;
}

function updateMapStyleButtons() {
  const isVenue = appState.activeMapStyle === 'venue';
  const venueBtn = document.getElementById('style-venue-btn');
  const satelliteBtn = document.getElementById('style-satellite-btn');
  if (!venueBtn || !satelliteBtn) return;
  venueBtn.classList.toggle('is-active', isVenue);
  satelliteBtn.classList.toggle('is-active', !isVenue);
  venueBtn.setAttribute('aria-pressed', String(isVenue));
  satelliteBtn.setAttribute('aria-pressed', String(!isVenue));
}

async function setMapStyle(styleId) {
  if (!map || appState.activeMapStyle === styleId) return;
  appState.activeMapStyle = styleId;
  updateMapStyleButtons();
  const styleUrl = styleId === 'satellite' ? appState.satelliteStyleUrl : appState.venueStyleUrl;
  map.setStyle(styleUrl);
  map.once('style.load', async () => {
    await hydrateStyleContent();
  });
}

async function hydrateStyleContent() {
  await loadMarkerIcons();
  buildLayers();
  applyFilters();
  syncSelectedLayer();
}

function syncSelectedLayer() {
  if (!map?.getLayer(LAYER_SELECTED)) return;
  map.setFilter(LAYER_SELECTED, ['==', ['get', 'id'], appState.selectedLocationId || '']);
}

function toFeatureCollection(locations) {
  return {
    type: 'FeatureCollection',
    features: locations.map((loc) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
      properties: {
        id: loc.id,
        color: loc.color,
        iconType: loc.iconType
      }
    }))
  };
}

function mapCategoryToIconType(name) {
  const value = String(name || '').toLowerCase();
  if (value.includes('food') || value.includes('drink') || value.includes('gourmet')) return 'fork';
  if (value.includes('clothing') || value.includes('women') || value.includes('men') || value.includes('kids')) return 'shirt';
  if (value.includes('jewelry') || value.includes('watch')) return 'gem';
  if (value === 'home' || value.includes('home')) return 'home';
  if (value.includes('western')) return 'star';
  if (value.includes('handmade') || value.includes('artisan')) return 'hand';
  if (value.includes('furniture')) return 'chair';
  if (value.includes('antique') || value.includes('vintage') || value.includes('collect')) return 'clock';
  if (value.includes('art') || value.includes('photo')) return 'palette';
  if (value.includes('garden') || value.includes('patio')) return 'leaf';
  if (value.includes('purse') || value.includes('tote') || value.includes('bag')) return 'bag';
  if (value.includes('sunglass') || value.includes('fashion')) return 'glasses';
  if (value.includes('wood')) return 'wood';
  if (value.includes('texas')) return 'star';
  if (value.includes('atm')) return 'dollar';
  if (value.includes('amenit') || value.includes('market')) return 'info';
  if (value.includes('handicap')) return 'wheelchair';
  if (value.includes('restroom')) return 'restroom';
  if (value.includes('parking')) return 'info';
  if (value.includes('entertain')) return 'star';
  if (value.includes('arbor') || value.includes('boardwalk') || value.includes('marker') || value.includes('visual')) return 'pin';
  return 'pin';
}

function iconTypeForCategory(categoryId, categoryName) {
  const iconFile = appState.categoryIconFiles.get(String(categoryId));
  if (iconFile) return iconIdFromFile(iconFile);
  return mapCategoryToIconType(categoryName);
}

function iconIdFromFile(fileName) {
  return `category-${String(fileName).replace(/\.svg$/i, '').replace(/[^a-z0-9-]/gi, '-')}`;
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return '#7a7a7a';
  if (input.length === 9) return input.slice(0, 7);
  if (input.length === 7) return input;
  return '#7a7a7a';
}

function pickTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#1f2937' : '#ffffff';
}

function resolveStyleUrl(rawStyle) {
  if (typeof rawStyle === 'string' && rawStyle.startsWith('http')) {
    return rawStyle.includes('YOUR_MAPTILER_KEY') && window.MAPTILER_KEY
      ? rawStyle.replace(/YOUR_MAPTILER_KEY/g, window.MAPTILER_KEY)
      : rawStyle;
  }

  // MapMe exports "maptiler" style id; without an API key it renders blank.
  if (rawStyle === 'maptiler' && window.MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${window.MAPTILER_KEY}`;
  }

  return STYLE_FALLBACK;
}

function resolveSatelliteStyleUrl() {
  if (window.MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/hybrid/style.json?key=${window.MAPTILER_KEY}`;
  }
  return SATELLITE_STYLE_FALLBACK;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
