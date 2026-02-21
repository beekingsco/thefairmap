let map;
let mapData;
let popup;
let geolocateControl;
let userLocation = null;

const activeCategories = new Set();
const categoryById = new Map();
const totalCountsByCategory = new Map();

let locations = [];
let visibleLocations = [];
let selectedLocationId = null;
let categoriesCollapsed = false;
let clusterRefreshRaf = 0;
let clusterRefreshToken = 0;
const categoryIconImageIds = new Map();

const SOURCE_ID = 'locations-source';
const LAYER_CLUSTER = 'clusters';
const LAYER_CLUSTER_COUNT = 'cluster-count';
const LAYER_POINT_CIRCLES = 'location-point-circles';
const LAYER_POINT_ICONS = 'location-point-icons';
const LAYER_SELECTED = 'location-selected';
const UNCATEGORIZED_ID = '__uncategorized__';
const DEFAULT_COLOR = '#7a7a7a';
const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright'; // fallback if no MAPTILER_KEY
const FALLBACK_ICON_IMAGE_ID = 'category-icon-fallback';

async function init() {
  const response = await fetch('/api/locations');
  mapData = await response.json();

  document.getElementById('map-title').textContent = mapData.map?.name || 'First Monday Finder';
  document.getElementById('map-subtitle').textContent = mapData.map?.subtitle || 'Canton, Texas';

  hydrateLocations();
  setupCategoryState();
  initSidebarControls();

  const preferredStyle = resolveMapStyleUrl(mapData.map?.style);
  const fallbackStyle  = 'https://tiles.openfreemap.org/styles/bright';

  // Pre-flight: test if MapTiler style is accessible before initialising the map
  async function pickMapStyle() {
    if (!preferredStyle.includes('maptiler.com')) return preferredStyle;
    try {
      const r = await fetch(preferredStyle, { method: 'HEAD' });
      if (r.ok) return preferredStyle;
      console.warn(`MapTiler style returned ${r.status} — falling back to OpenFreeMap`);
      return fallbackStyle;
    } catch {
      console.warn('MapTiler style unreachable — falling back to OpenFreeMap');
      return fallbackStyle;
    }
  }

  const mapStyle = await pickMapStyle();

  map = new maplibregl.Map({
    container: 'map',
    style: mapStyle,
    center: mapData.map?.center || [-95.8624, 32.5585],
    zoom: mapData.map?.zoom ?? 17,
    pitch: mapData.map?.pitch ?? 60,
    bearing: mapData.map?.bearing ?? 0,
    maxZoom: mapData.map?.maxZoom || 20,
    antialias: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  geolocateControl = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserHeading: true,
    showAccuracyCircle: false
  });
  map.addControl(geolocateControl, 'top-right');

  geolocateControl.on('geolocate', (e) => {
    userLocation = { lat: e.coords.latitude, lng: e.coords.longitude };
  });

  map.on('load', async () => {
    await buildMapLayers();
    refreshVisibleData();
    renderMobileCatSheet();
    updateMobileToggleButton();

    // Hide loading overlay
    const loader = document.getElementById('map-loader');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 500); }

    // Deep-link support: ?loc=id
    const urlParams = new URLSearchParams(window.location.search);
    const locParam = urlParams.get('loc');
    if (locParam) {
      const target = locations.find(l => l.id === locParam);
      if (target) {
        setTimeout(() => openLocation(target, true), 600);
      }
    }
  });

  map.on('moveend', queueClusterColorRefresh);
  map.on('zoomend', queueClusterColorRefresh);
}

function resolveMapStyleUrl(styleUrl) {
  const key = window.MAPTILER_KEY;
  let url = styleUrl || DEFAULT_MAP_STYLE;

  // Inject API key placeholder
  if (key && url.includes('YOUR_MAPTILER_KEY')) {
    url = url.replace(/YOUR_MAPTILER_KEY/g, key);
  }

  // If we have a key but the style is still OpenFreeMap (default/fallback),
  // upgrade to MapTiler Streets Essential to match MapMe's look exactly
  if (key && url.includes('openfreemap.org')) {
    url = `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
  }

  return url;
}

function hydrateLocations() {
  const categoriesById = new Map((mapData.categories || []).map((cat) => [cat.id, cat]));

  locations = (mapData.locations || []).map((loc, index) => {
    const normalizedCategoryId = loc.categoryId || UNCATEGORIZED_ID;
    const category = categoriesById.get(normalizedCategoryId);
    const categoryName = loc.categoryName || category?.name || 'Uncategorized';

    return {
      id: String(loc.id || `loc-${index}`),
      name: String(loc.name || 'Untitled'),
      description: loc.description || '',
      address: loc.address || '',
      image: loc.image || '',
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      featured: Boolean(loc.featured),
      categoryId: normalizedCategoryId,
      categoryName,
      color: normalizeColor(category?.color || DEFAULT_COLOR),
      searchText: `${loc.name || ''} ${loc.address || ''} ${categoryName}`.toLowerCase()
    };
  }).filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
}

function setupCategoryState() {
  (mapData.categories || []).forEach((category) => {
    categoryById.set(category.id, {
      ...category,
      color: normalizeColor(category.color)
    });
  });

  if (locations.some((loc) => loc.categoryId === UNCATEGORIZED_ID)) {
    categoryById.set(UNCATEGORIZED_ID, {
      id: UNCATEGORIZED_ID,
      name: 'Uncategorized',
      color: '#6d6d6d'
    });
  }

  categoryById.forEach((_, categoryId) => {
    const totalCount = locations.reduce((count, loc) => count + (loc.categoryId === categoryId ? 1 : 0), 0);
    totalCountsByCategory.set(categoryId, totalCount);
    activeCategories.add(categoryId);
  });
}

function initSidebarControls() {
  // Debounced search for performance with 700+ locations
  let searchTimeout;
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(refreshVisibleData, 180);
  });

  // Enter on search flies to first result
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      refreshVisibleData();
      if (visibleLocations.length > 0) {
        openLocation(visibleLocations[0], true);
      }
    }
  });

  // Escape closes detail sheet / popup / sidebar
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const sheet = document.getElementById('detail-sheet');
      if (sheet && !sheet.hidden) { closeDetailSheet(); return; }
      if (popup) { popup.remove(); popup = null; selectedLocationId = null; syncSelectedLayer(); }
      if (window.innerWidth <= 960) closeSidebarMobile();
    }
  });

  document.getElementById('btn-select-all').addEventListener('click', () => {
    activeCategories.clear();
    categoryById.forEach((_, id) => activeCategories.add(id));
    refreshVisibleData();
  });

  document.getElementById('btn-clear-all').addEventListener('click', () => {
    activeCategories.clear();
    selectedLocationId = null;
    if (popup) popup.remove();
    refreshVisibleData();
  });

  document.getElementById('category-panel-toggle').addEventListener('click', (event) => {
    categoriesCollapsed = !categoriesCollapsed;
    event.currentTarget.setAttribute('aria-expanded', String(!categoriesCollapsed));
    document.getElementById('category-list').classList.toggle('is-collapsed', categoriesCollapsed);
  });

  document.getElementById('sidebar-collapse').addEventListener('click', toggleSidebarDesktop);
  document.getElementById('mobile-sidebar-toggle').addEventListener('click', toggleSidebarFromMapButton);
  document.getElementById('mobile-backdrop').addEventListener('click', closeSidebarMobile);

  // Detail sheet close
  document.getElementById('detail-close')?.addEventListener('click', closeDetailSheet);

  // Mobile search bar
  initMobileSearchBar();

  // Mobile category bottom sheet
  initMobileCatSheet();

  // Map style switcher — default is Streets Essential (matches MapMe), toggle to Satellite/Terrain
  const mapStyles = window.MAPTILER_KEY ? [
    { name: 'Streets',   label: '🛰️ Satellite', url: `https://api.maptiler.com/maps/streets-v2/style.json?key=${window.MAPTILER_KEY}` },
    { name: 'Satellite', label: '🏔️ Terrain',   url: `https://api.maptiler.com/maps/hybrid/style.json?key=${window.MAPTILER_KEY}` },
    { name: 'Terrain',   label: '🗺️ Streets',   url: `https://api.maptiler.com/maps/topo-v2/style.json?key=${window.MAPTILER_KEY}` }
  ] : [
    { name: 'Bright', label: '🗺️ Map', url: 'https://tiles.openfreemap.org/styles/bright' }
  ];
  let currentStyleIdx = 0; // start at Streets Essential
  const styleBtn = document.getElementById('map-style-btn');
  if (styleBtn) {
    styleBtn.textContent = mapStyles[0].label; // show what clicking will switch TO
    if (mapStyles.length <= 1) styleBtn.style.display = 'none';
    styleBtn.addEventListener('click', () => {
      currentStyleIdx = (currentStyleIdx + 1) % mapStyles.length;
      const style = mapStyles[currentStyleIdx];
      map.setStyle(style.url);
      styleBtn.textContent = style.label; // label of next destination
      map.once('style.load', () => buildMapLayers());
    });
  }

  // Mobile bottom nav
  initMobileNav();

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      closeSidebarMobile();
    }
    updateMobileToggleButton();
  });

  // Swipe-to-close on mobile sidebar
  let touchStartX = 0;
  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  sidebar.addEventListener('touchend', (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    if (deltaX < -60 && window.innerWidth <= 960) closeSidebarMobile();
  }, { passive: true });
}

async function buildMapLayers() {
  await loadCategoryMarkerImages();

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: asFeatureCollection([]),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 52,
    generateId: true
  });

  map.addLayer({
    id: LAYER_CLUSTER,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['coalesce', ['feature-state', 'dominantColor'], '#b8895f'],
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        14,
        15,
        17,
        50,
        21
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  });

  map.addLayer({
    id: LAYER_CLUSTER_COUNT,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12,
      'text-font': ['Noto Sans Regular']
    },
    paint: {
      'text-color': '#1f2023'
    }
  });

  // ── Venue tileset overlay (from MapMe settings) ────────────────────────
  if (window.MAPTILER_KEY) {
    const OVERLAY_SOURCE = 'venue-tileset';
    const OVERLAY_LAYER  = 'venue-tileset-layer';
    if (!map.getSource(OVERLAY_SOURCE)) {
      map.addSource(OVERLAY_SOURCE, {
        type: 'raster',
        tiles: [`https://api.maptiler.com/tiles/0196a1e2-92d2-7ed9-9540-2191fb00a1af/{z}/{x}/{y}.png?key=${window.MAPTILER_KEY}`],
        tileSize: 256,
        minzoom: 14,
        maxzoom: 21
      });
    }
    if (!map.getLayer(OVERLAY_LAYER)) {
      map.addLayer({
        id: OVERLAY_LAYER,
        type: 'raster',
        source: OVERLAY_SOURCE,
        paint: {
          'raster-opacity': 0.75,
          'raster-fade-duration': 300
        }
      });
    }
    // Wire up overlay toggle button
    const overlayBtn = document.getElementById('overlay-toggle-btn');
    if (overlayBtn) {
      overlayBtn.hidden = false;
      let overlayVisible = true;
      overlayBtn.addEventListener('click', () => {
        overlayVisible = !overlayVisible;
        map.setLayoutProperty(OVERLAY_LAYER, 'visibility', overlayVisible ? 'visible' : 'none');
        overlayBtn.classList.toggle('active', overlayVisible);
        overlayBtn.title = overlayVisible ? 'Hide venue overlay' : 'Show venue overlay';
      });
    }
  }

  // Featured glow ring (behind regular markers)
  map.addLayer({
    id: 'location-featured-glow',
    type: 'circle',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'featured'], true]],
    paint: {
      'circle-color': '#fbbf24',
      'circle-radius': 18,
      'circle-opacity': 0.35,
      'circle-blur': 0.5
    }
  });

  map.addLayer({
    id: LAYER_POINT_CIRCLES,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        13, ['case', ['==', ['get', 'featured'], true], 12, 10],
        15, ['case', ['==', ['get', 'featured'], true], 18, 16],
        17, ['case', ['==', ['get', 'featured'], true], 22, 20],
        20, ['case', ['==', ['get', 'featured'], true], 26, 24]
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': [
        'interpolate', ['linear'], ['zoom'],
        13, 1.5,
        17, 2.5,
        20, 3
      ],
      'circle-opacity': 1
    }
  });

  map.addLayer({
    id: LAYER_POINT_ICONS,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['coalesce', ['get', 'iconImageId'], FALLBACK_ICON_IMAGE_ID],
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        13, 0.7,
        15, 1.0,
        17, 1.3,
        20, 1.6
      ],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    }
  });

  map.addLayer({
    id: LAYER_SELECTED,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        6,
        14,
        8,
        16,
        10,
        18,
        13,
        20,
        15
      ],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#111111',
      'circle-stroke-width': 2,
      'circle-opacity': 0.35
    }
  });

  map.on('click', LAYER_CLUSTER, onClusterClick);
  map.on('click', LAYER_POINT_CIRCLES, onPointClick);
  map.on('click', LAYER_POINT_ICONS, onPointClick);

  map.on('mouseenter', LAYER_CLUSTER, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', LAYER_CLUSTER, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_POINT_CIRCLES, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', LAYER_POINT_CIRCLES, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_POINT_ICONS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', LAYER_POINT_ICONS, () => {
    map.getCanvas().style.cursor = '';
  });
}

function onClusterClick(event) {
  const features = map.queryRenderedFeatures(event.point, { layers: [LAYER_CLUSTER] });
  const clusterId = features[0]?.properties?.cluster_id;
  if (clusterId == null) return;

  map.getSource(SOURCE_ID).getClusterExpansionZoom(clusterId, (error, zoom) => {
    if (error) return;
    map.easeTo({ center: features[0].geometry.coordinates, zoom });
  });
}

function onPointClick(event) {
  const feature = event.features?.[0];
  if (!feature) return;

  const loc = visibleLocations.find((item) => item.id === feature.properties.id);
  if (!loc) return;

  openLocation(loc, true);
}

function refreshVisibleData() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();

  visibleLocations = locations
    .filter((loc) => activeCategories.has(loc.categoryId))
    .filter((loc) => !query || loc.searchText.includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (map?.isStyleLoaded() && map.getSource(SOURCE_ID)) {
    try {
      map.removeFeatureState({ source: SOURCE_ID });
    } catch (_) {
      // no-op; source may not have existing state yet
    }

    map.getSource(SOURCE_ID).setData(asFeatureCollection(visibleLocations));
    queueClusterColorRefresh();
  }

  if (!visibleLocations.some((loc) => loc.id === selectedLocationId)) {
    selectedLocationId = null;
    if (popup) popup.remove();
  }

  syncSelectedLayer();
  renderCategoryList(query);
  renderLocationList();
  updateResultCount();
}

function asFeatureCollection(items) {
  return {
    type: 'FeatureCollection',
    features: items.map((loc) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [loc.lng, loc.lat]
      },
      properties: {
        id: loc.id,
        name: loc.name,
        categoryId: loc.categoryId,
        categoryName: loc.categoryName,
        color: loc.color,
        description: loc.description,
        address: loc.address,
        featured: loc.featured,
        iconImageId: categoryIconImageIds.get(loc.categoryId) || FALLBACK_ICON_IMAGE_ID
      }
    }))
  };
}

async function loadCategoryMarkerImages() {
  await addFallbackMarkerIcon();

  const loaders = [...categoryById.values()].map((category) => loadCategoryMarkerImage(category));
  await Promise.all(loaders);
}

async function loadCategoryMarkerImage(category) {
  if (!category?.iconFile) return;

  const imageId = getCategoryImageId(category.id);
  const iconPath = `./data/icons/${category.iconFile}`;

  try {
    const svgResponse = await fetch(iconPath);
    if (!svgResponse.ok) return;

    const svg = await svgResponse.text();
    const imageData = await rasterizeSvgToImageData(toWhiteSvg(svg), 22, 22);

    if (map.hasImage(imageId)) {
      map.removeImage(imageId);
    }
    map.addImage(imageId, {
      width: imageData.width,
      height: imageData.height,
      data: imageData.data
    });
    categoryIconImageIds.set(category.id, imageId);
  } catch (_) {
    // icon stays on fallback image when a file is unavailable
  }
}

async function addFallbackMarkerIcon() {
  if (map.hasImage(FALLBACK_ICON_IMAGE_ID)) return;

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.arc(8, 8, 3, 0, Math.PI * 2);
  context.fill();

  const fallbackData = context.getImageData(0, 0, canvas.width, canvas.height);
  map.addImage(FALLBACK_ICON_IMAGE_ID, {
    width: fallbackData.width,
    height: fallbackData.height,
    data: fallbackData.data
  });
}

function getCategoryImageId(categoryId) {
  return `category-icon-${categoryId}`;
}

function toWhiteSvg(svg) {
  const withWhiteFills = svg.replace(/fill="(?!none)[^"]*"/gi, 'fill="#ffffff"');
  const withWhiteStrokes = withWhiteFills.replace(/stroke="(?!none)[^"]*"/gi, 'stroke="#ffffff"');
  return withWhiteStrokes.includes('<svg')
    ? withWhiteStrokes.replace('<svg', '<svg fill="#ffffff"')
    : withWhiteStrokes;
}

async function rasterizeSvgToImageData(svg, width, height) {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering context unavailable');

    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function queueClusterColorRefresh() {
  if (!map?.isStyleLoaded()) return;
  if (clusterRefreshRaf) cancelAnimationFrame(clusterRefreshRaf);
  clusterRefreshRaf = requestAnimationFrame(() => {
    clusterRefreshRaf = 0;
    refreshClusterColors();
  });
}

function refreshClusterColors() {
  if (!map?.isStyleLoaded() || !map.getSource(SOURCE_ID) || !map.getLayer(LAYER_CLUSTER)) return;

  const source = map.getSource(SOURCE_ID);
  const features = map.querySourceFeatures(SOURCE_ID, { filter: ['has', 'point_count'] });
  const seen = new Set();
  const clusters = [];

  features.forEach((feature) => {
    const clusterId = Number(feature.properties?.cluster_id);
    const pointCount = Number(feature.properties?.point_count);
    const featureId = feature.id;

    if (!Number.isFinite(clusterId) || !Number.isFinite(pointCount) || featureId == null) return;
    if (seen.has(clusterId)) return;

    seen.add(clusterId);
    clusters.push({ clusterId, pointCount, featureId });
  });

  if (!clusters.length) return;

  const token = ++clusterRefreshToken;

  clusters.forEach(({ clusterId, pointCount, featureId }) => {
    source.getClusterLeaves(clusterId, pointCount, 0, (error, leaves) => {
      if (error || token !== clusterRefreshToken) return;

      const colorCounts = new Map();
      (leaves || []).forEach((leaf) => {
        const color = normalizeColor(leaf?.properties?.color || DEFAULT_COLOR);
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      });

      let dominantColor = '#b8895f';
      let bestCount = -1;
      colorCounts.forEach((count, color) => {
        if (count > bestCount) {
          dominantColor = color;
          bestCount = count;
        }
      });

      map.setFeatureState({ source: SOURCE_ID, id: featureId }, { dominantColor });
    });
  });
}

function renderCategoryList(query) {
  const list = document.getElementById('category-list');
  list.innerHTML = '';

  const matchingCounts = new Map();
  visibleLocations.forEach((loc) => {
    matchingCounts.set(loc.categoryId, (matchingCounts.get(loc.categoryId) || 0) + 1);
  });

  const orderedCategories = [...categoryById.values()]
    .sort((a, b) => (totalCountsByCategory.get(b.id) || 0) - (totalCountsByCategory.get(a.id) || 0));

  orderedCategories.forEach((category) => {
    const active = activeCategories.has(category.id);
    const totalCount = totalCountsByCategory.get(category.id) || 0;
    const matchingCount = matchingCounts.get(category.id) || 0;

    const item = document.createElement('article');
    item.className = 'category-item';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'category-head';
    header.setAttribute('aria-expanded', 'false');
    header.innerHTML = `
      <span class="category-main">
        <input type="checkbox" ${active ? 'checked' : ''} data-category-checkbox="${category.id}" aria-label="Toggle ${escapeHtml(category.name)}">
        <span class="category-dot" style="--dot-color:${category.color};"></span>
        ${getCategoryIconPreviewHtml(category)}
        <span class="category-name">${escapeHtml(category.name)}</span>
      </span>
      <span class="category-count">${matchingCount}/${totalCount}</span>
    `;

    const rows = document.createElement('div');
    rows.className = 'category-locations';

    const entries = visibleLocations
      .filter((loc) => loc.categoryId === category.id)
      .slice(0, 60);

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'category-empty';
      empty.textContent = query ? 'No matches in this category.' : 'No visible locations.';
      rows.appendChild(empty);
    } else {
      entries.forEach((loc) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'category-location';
        row.textContent = loc.name;
        row.addEventListener('click', () => openLocation(loc, true));
        rows.appendChild(row);
      });

      const hiddenCount = matchingCount - entries.length;
      if (hiddenCount > 0) {
        const more = document.createElement('p');
        more.className = 'category-empty';
        more.textContent = `${hiddenCount} more locations. Use search to narrow further.`;
        rows.appendChild(more);
      }
    }

    header.addEventListener('click', (event) => {
      const checkbox = event.target.closest('input[type="checkbox"]');
      if (checkbox) {
        const catId = checkbox.getAttribute('data-category-checkbox');
        if (checkbox.checked) activeCategories.add(catId);
        else activeCategories.delete(catId);
        refreshVisibleData();
        return;
      }

      const expanded = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!expanded));
      item.classList.toggle('is-open', !expanded);
    });

    item.appendChild(header);
    item.appendChild(rows);
    list.appendChild(item);
  });
}

function renderLocationList() {
  const list = document.getElementById('location-list');
  list.innerHTML = '';

  if (visibleLocations.length === 0) {
    const query = document.getElementById('search-input').value.trim();
    const empty = document.createElement('div');
    empty.className = 'location-empty';
    empty.style.textAlign = 'center';
    empty.style.padding = '2rem 1rem';
    empty.innerHTML = query
      ? `<div style="font-size:1.5rem;margin-bottom:0.5rem;">🔍</div><p>No results for "<strong>${escapeHtml(query)}</strong>"</p><p style="font-size:0.75rem;color:#9aa5b1;">Try a different search term or show more categories.</p>`
      : `<div style="font-size:1.5rem;margin-bottom:0.5rem;">📭</div><p>No visible locations.</p><p style="font-size:0.75rem;color:#9aa5b1;">Enable some categories to see locations on the map.</p>`;
    list.appendChild(empty);
    return;
  }

  // Sort by distance if user location is available
  let sortedLocs = visibleLocations.slice(0, 200);
  if (userLocation) {
    sortedLocs = sortedLocs.map(loc => ({
      ...loc,
      _dist: distanceFt(userLocation.lat, userLocation.lng, loc.lat, loc.lng)
    })).sort((a, b) => a._dist - b._dist);
  }

  sortedLocs.forEach((loc) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-item';

    const locationCategory = categoryById.get(loc.categoryId);
    const distHtml = loc._dist != null ? `<span class="location-item-dist">${formatDistance(loc._dist)}</span>` : '';
    button.innerHTML = `
      <span class="location-item-name">${escapeHtml(loc.name)}${loc.featured ? ' ⭐' : ''} ${distHtml}</span>
      <span class="location-item-meta">
        <span class="category-dot" style="--dot-color:${loc.color};"></span>
        ${escapeHtml(locationCategory?.name || loc.categoryName)}
        ${loc.address ? `<span class="location-item-addr">· ${escapeHtml(loc.address)}</span>` : ''}
      </span>
    `;

    button.addEventListener('click', () => openLocation(loc, true));
    list.appendChild(button);
  });

  if (visibleLocations.length > 200) {
    const hint = document.createElement('p');
    hint.className = 'location-empty';
    hint.textContent = `Showing 200 of ${visibleLocations.length} locations.`;
    list.appendChild(hint);
  }
}

function updateResultCount() {
  const text = `${visibleLocations.length} location${visibleLocations.length === 1 ? '' : 's'} visible`;
  document.getElementById('result-count').textContent = text;
}

function distanceFt(lat1, lng1, lat2, lng2) {
  // Haversine in feet (good enough for fair grounds)
  const R = 20902000; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(ft) {
  if (ft < 300) return `${Math.round(ft)} ft`;
  if (ft < 5280) return `${(ft/5280).toFixed(2)} mi`;
  return `${(ft/5280).toFixed(1)} mi`;
}

function trackRecentView(loc) {
  try {
    let recent = JSON.parse(localStorage.getItem('fairmap-recent') || '[]');
    recent = recent.filter(r => r.id !== loc.id);
    recent.unshift({ id: loc.id, name: loc.name, time: Date.now() });
    if (recent.length > 8) recent = recent.slice(0, 8);
    localStorage.setItem('fairmap-recent', JSON.stringify(recent));
  } catch {}
}

function openLocation(loc, flyTo) {
  selectedLocationId = loc.id;
  syncSelectedLayer();
  trackRecentView(loc);

  const category = categoryById.get(loc.categoryId);
  const badgeColor = normalizeColor(loc.color || category?.color);
  const badgeText = getReadableTextColor(badgeColor);

  // On mobile: use bottom sheet detail panel
  // On desktop: use both popup (as anchor) and detail side panel
  const isMobile = window.innerWidth <= 960;

  if (popup) popup.remove();

  if (!isMobile) {
    // Desktop: show a small popup anchor on the map
    popup = new maplibregl.Popup({
      offset: 18,
      maxWidth: '240px',
      className: 'fairmap-popup fairmap-popup-mini'
    })
      .setLngLat([loc.lng, loc.lat])
      .setHTML(`
        <div class="popup-mini-card">
          <strong>${escapeHtml(loc.name)}</strong>
          <span class="category-dot" style="--dot-color:${badgeColor};"></span>
          <span style="font-size:0.75rem;color:#6a7784;">${escapeHtml(category?.name || loc.categoryName)}</span>
        </div>
      `)
      .addTo(map);
  }

  // Show detail sheet (works on both mobile and desktop)
  showDetailSheet(loc, category, badgeColor, badgeText);

  if (flyTo) {
    map.easeTo({
      center: [loc.lng, loc.lat],
      zoom: Math.max(map.getZoom(), 16.8),
      pitch: mapData.map?.pitch ?? 60,
      duration: 450
    });
  }

  if (isMobile) {
    closeSidebarMobile();
  }
}

function showDetailSheet(loc, category, badgeColor, badgeText) {
  const sheet = document.getElementById('detail-sheet');
  const content = document.getElementById('detail-content');

  const shareUrl = `${location.origin}?loc=${loc.id}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
  const appleDirectionsUrl = `https://maps.apple.com/?daddr=${loc.lat},${loc.lng}`;

  const categoryEmoji = getCategoryEmoji(category);
  content.innerHTML = `
    ${loc.image ? `<img src="${loc.image.replace(/"/g,'&quot;')}" alt="${escapeHtml(loc.name)}" class="detail-hero" onerror="this.outerHTML='<div class=\\'detail-hero-placeholder\\'>${categoryEmoji}</div>'">` : `<div class="detail-hero-placeholder">${categoryEmoji}</div>`}
    <div class="detail-body">
      ${loc.featured ? `<span class="detail-featured">⭐ Featured Vendor</span>` : ''}
      <h2 class="detail-title">${escapeHtml(loc.name)}</h2>
      <span class="detail-badge" style="background:${badgeColor};color:${badgeText};">
        ${getCategoryIconPreviewHtml(category, 'popup-icon', true)}
        ${escapeHtml(category?.name || loc.categoryName)}
      </span>
      ${loc.address ? `<div class="detail-address">📍 ${escapeHtml(loc.address)}</div>` : ''}
      ${loc.description ? `<div class="detail-description">${loc.description}</div>` : ''}
      <div class="detail-actions">
        <a href="${directionsUrl}" target="_blank" rel="noopener" class="detail-action-btn primary">📍 Directions</a>
        <button type="button" class="detail-action-btn secondary" id="detail-share-btn">↗ Share</button>
      </div>
      <div style="text-align:center;margin-top:8px;">
        <a href="${appleDirectionsUrl}" target="_blank" rel="noopener" style="font-size:0.75rem;color:#6a7784;text-decoration:none;">Open in Apple Maps →</a>
      </div>
    </div>
  `;

  sheet.hidden = false;
  // Force reflow for transition
  sheet.offsetHeight;

  // Share button handler
  document.getElementById('detail-share-btn')?.addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: loc.name,
        text: `Check out ${loc.name} at First Monday Trade Days!`,
        url: shareUrl
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(shareUrl).then(() => {
        showToast('Link copied to clipboard!');
      }).catch(() => {});
    }
  });
}

function closeDetailSheet() {
  const sheet = document.getElementById('detail-sheet');
  sheet.hidden = true;
  selectedLocationId = null;
  syncSelectedLayer();
  if (popup) { popup.remove(); popup = null; }
}

function showToast(message) {
  let toast = document.querySelector('.detail-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'detail-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2400);
}

function getReadableTextColor(hex) {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? '#1f2937' : '#ffffff';
}

function syncSelectedLayer() {
  if (!map?.getLayer(LAYER_SELECTED)) return;

  map.setFilter(
    LAYER_SELECTED,
    ['==', ['get', 'id'], selectedLocationId || '']
  );
}

function toggleSidebarDesktop() {
  if (window.innerWidth <= 960) {
    toggleSidebarFromMapButton();
    return;
  }

  const app = document.getElementById('app');
  app.classList.toggle('sidebar-collapsed');

  const button = document.getElementById('sidebar-collapse');
  const collapsed = app.classList.contains('sidebar-collapsed');
  button.innerHTML = collapsed ? '&#10095;' : '&#10094;';
  button.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');

  setTimeout(() => map?.resize(), 260);
}

function toggleSidebarFromMapButton() {
  const app = document.getElementById('app');

  if (window.innerWidth <= 960) {
    app.classList.toggle('mobile-sidebar-open');
    const isOpen = app.classList.contains('mobile-sidebar-open');
    document.getElementById('mobile-backdrop').hidden = !isOpen;
    updateMobileToggleButton();
    return;
  }

  if (app.classList.contains('sidebar-collapsed')) {
    app.classList.remove('sidebar-collapsed');
    const button = document.getElementById('sidebar-collapse');
    button.innerHTML = '&#10094;';
    button.setAttribute('aria-label', 'Collapse sidebar');
    setTimeout(() => map?.resize(), 260);
  }
}

function openSidebarMobile() {
  const app = document.getElementById('app');
  app.classList.add('mobile-sidebar-open');

  const backdrop = document.getElementById('mobile-backdrop');
  backdrop.hidden = false;
  updateMobileToggleButton();
}

function closeSidebarMobile() {
  const app = document.getElementById('app');
  app.classList.remove('mobile-sidebar-open');

  const backdrop = document.getElementById('mobile-backdrop');
  backdrop.hidden = true;
  updateMobileToggleButton();
}

function updateMobileToggleButton() {
  const button = document.getElementById('mobile-sidebar-toggle');
  const isMobile = window.innerWidth <= 960;
  const isOpen = document.getElementById('app').classList.contains('mobile-sidebar-open');

  button.hidden = !isMobile;
  button.setAttribute('aria-expanded', String(isOpen));
  button.setAttribute('aria-label', isOpen ? 'Close filters' : 'Open filters');

  const count = visibleLocations.length;
  button.innerHTML = isOpen
    ? '<span class="hamburger-icon">&#10005;</span><span>Close</span>'
    : `<span class="hamburger-icon">&#9776;</span><span>Filters</span>${count > 0 ? `<span class="filter-badge">${count}</span>` : ''}`;
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return DEFAULT_COLOR;
  if (input.length === 9) return input.slice(0, 7);
  return input;
}

function getCategoryEmoji(category) {
  // Map common category names to emojis for the placeholder
  const name = (category?.name || '').toLowerCase();
  if (name.includes('food') || name.includes('eat') || name.includes('drink')) return '🍽️';
  if (name.includes('honey') || name.includes('bee')) return '🍯';
  if (name.includes('craft') || name.includes('art') || name.includes('handmade')) return '🎨';
  if (name.includes('antique') || name.includes('vintage')) return '🏺';
  if (name.includes('plant') || name.includes('garden') || name.includes('flower')) return '🌿';
  if (name.includes('cloth') || name.includes('apparel') || name.includes('wear') || name.includes('fashion')) return '👕';
  if (name.includes('jewel') || name.includes('accessori')) return '💎';
  if (name.includes('restroom') || name.includes('bathroom')) return '🚻';
  if (name.includes('parking')) return '🅿️';
  if (name.includes('entrance') || name.includes('gate')) return '🚪';
  if (name.includes('info')) return 'ℹ️';
  if (name.includes('atm') || name.includes('bank')) return '🏧';
  if (name.includes('pet') || name.includes('animal')) return '🐾';
  if (name.includes('tool') || name.includes('hardware')) return '🔧';
  if (name.includes('candle') || name.includes('soap') || name.includes('beauty')) return '🕯️';
  if (name.includes('leather')) return '🧳';
  if (name.includes('furniture') || name.includes('home') || name.includes('decor')) return '🪑';
  if (name.includes('toy') || name.includes('kid') || name.includes('child')) return '🧸';
  return '📍';
}

function getCategoryIconPreviewHtml(category, className = 'category-icon-preview', invert = false) {
  if (!category?.iconFile) return '';
  const filter = invert ? ' style="filter:brightness(0) invert(1);"' : '';
  return `<span class="${className}"><img src="./data/icons/${encodeURIComponent(category.iconFile)}" alt="" loading="lazy" decoding="async"${filter}></span>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Mobile Search Bar ─────────────────────────────────────────────────────
function initMobileSearchBar() {
  const bar = document.getElementById('mobile-search-bar');
  const input = document.getElementById('mobile-search-input');
  const btn = document.getElementById('mobile-search-btn');
  if (!bar || !input) return;

  function updateVisibility() {
    bar.hidden = window.innerWidth > 960;
  }
  updateVisibility();
  window.addEventListener('resize', updateVisibility);

  // Sync with main search input
  let searchTimeout;
  input.addEventListener('input', () => {
    const mainInput = document.getElementById('search-input');
    if (mainInput) mainInput.value = input.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(refreshVisibleData, 180);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(searchTimeout);
      refreshVisibleData();
      if (visibleLocations.length > 0) openLocation(visibleLocations[0], true);
      input.blur();
    }
  });

  btn?.addEventListener('click', () => {
    refreshVisibleData();
    if (visibleLocations.length > 0) openLocation(visibleLocations[0], true);
    input.blur();
  });
}

// ── Mobile Category Bottom Sheet ──────────────────────────────────────────
function initMobileCatSheet() {
  const sheet = document.getElementById('mobile-cat-sheet');
  const handle = document.getElementById('mobile-cat-handle');
  const expandBtn = document.getElementById('mobile-cat-expand');
  if (!sheet) return;

  function updateVisibility() {
    sheet.hidden = window.innerWidth > 960;
  }
  updateVisibility();
  window.addEventListener('resize', updateVisibility);

  // Expand/collapse on handle touch or expand button
  let startY = 0;
  handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', e => {
    const delta = e.changedTouches[0].clientY - startY;
    if (delta < -40) sheet.classList.add('expanded');
    if (delta > 40)  sheet.classList.remove('expanded');
  }, { passive: true });

  expandBtn?.addEventListener('click', () => {
    sheet.classList.toggle('expanded');
  });

  // Render categories into the sheet (called after data loads)
  renderMobileCatSheet();
}

function renderMobileCatSheet() {
  const list = document.getElementById('mobile-cat-list');
  if (!list || !mapData?.categories) return;

  const countMap = new Map();
  locations.forEach(l => countMap.set(l.categoryId, (countMap.get(l.categoryId) || 0) + 1));

  const cats = [...mapData.categories]
    .filter(c => countMap.get(c.id) > 0)
    .sort((a, b) => (countMap.get(b.id) || 0) - (countMap.get(a.id) || 0));

  list.innerHTML = cats.map(cat => {
    const count = countMap.get(cat.id) || 0;
    const iconPath = `/data/icons/${cat.id}.svg`;
    const active = activeCategories.has(cat.id);
    return `
      <div class="mobile-cat-item ${active ? '' : 'cat-hidden'}" data-mob-cat="${escapeHtml(cat.id)}" style="opacity:${active ? 1 : 0.45}">
        <div class="mobile-cat-icon" style="background:${escapeHtml(cat.color || '#7a7a7a')};">
          <img src="${escapeHtml(iconPath)}" alt="" onerror="this.style.display='none'">
        </div>
        <span class="mobile-cat-name">${escapeHtml(cat.name)}</span>
        <span class="mobile-cat-count">${count}</span>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-mob-cat]').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.mobCat;
      if (activeCategories.has(id)) {
        activeCategories.delete(id);
        item.style.opacity = '0.45';
      } else {
        activeCategories.add(id);
        item.style.opacity = '1';
      }
      // Sync with main category list
      const mainCb = document.querySelector(`input[data-category-id="${id}"]`);
      if (mainCb) {
        mainCb.checked = activeCategories.has(id);
        mainCb.dispatchEvent(new Event('change'));
      } else {
        refreshVisibleData();
      }
    });
  });
}

// ── Mobile Bottom Nav ─────────────────────────────────────────────────────
function initMobileNav() {
  const nav = document.getElementById('mobile-nav');
  if (!nav) return;

  function updateNavVisibility() {
    nav.hidden = window.innerWidth > 960;
  }
  updateNavVisibility();
  window.addEventListener('resize', updateNavVisibility);

  nav.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.nav;

      // Update active state
      nav.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      switch (action) {
        case 'map':
          closeSidebarMobile();
          closeDetailSheet();
          break;
        case 'search':
          openSidebarMobile();
          setTimeout(() => {
            const input = document.getElementById('search-input');
            input?.focus();
            input?.select();
          }, 300);
          break;
        case 'categories':
          openSidebarMobile();
          // Ensure category panel is expanded
          if (categoriesCollapsed) {
            categoriesCollapsed = false;
            const toggle = document.getElementById('category-panel-toggle');
            toggle?.setAttribute('aria-expanded', 'true');
            document.getElementById('category-list')?.classList.remove('is-collapsed');
          }
          break;
        case 'nearby':
          closeSidebarMobile();
          closeDetailSheet();
          // Trigger geolocation
          if (geolocateControl) {
            geolocateControl.trigger();
          }
          // After geolocate fires, open sidebar with sorted-by-distance locations
          setTimeout(() => {
            openSidebarMobile();
          }, 800);
          break;
      }
    });
  });
}

// ── Detail sheet swipe-to-close ───────────────────────────────────────────
(function setupDetailSheetGestures() {
  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('detail-handle');
    const sheet = document.getElementById('detail-sheet');
    if (!handle || !sheet) return;

    let startY = 0;
    handle.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });
    handle.addEventListener('touchend', (e) => {
      const deltaY = e.changedTouches[0].clientY - startY;
      if (deltaY > 80) closeDetailSheet();
    }, { passive: true });
  });
})();

// Register service worker for PWA/offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
