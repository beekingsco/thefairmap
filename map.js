let map;
let mapData;
let popup;
let geolocateControl;

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
const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';
const FALLBACK_ICON_IMAGE_ID = 'category-icon-fallback';

async function init() {
  const response = await fetch('./data/locations.json');
  mapData = await response.json();

  document.getElementById('map-title').textContent = mapData.map?.name || 'First Monday Finder';
  document.getElementById('map-subtitle').textContent = mapData.map?.subtitle || 'Canton, Texas';

  hydrateLocations();
  setupCategoryState();
  initSidebarControls();

  map = new maplibregl.Map({
    container: 'map',
    style: resolveMapStyleUrl(mapData.map?.style),
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

  map.on('load', async () => {
    await buildMapLayers();
    refreshVisibleData();
    updateMobileToggleButton();
  });

  map.on('moveend', queueClusterColorRefresh);
  map.on('zoomend', queueClusterColorRefresh);
}

function resolveMapStyleUrl(styleUrl) {
  const url = styleUrl || DEFAULT_MAP_STYLE;
  if (window.MAPTILER_KEY && url.includes('YOUR_MAPTILER_KEY')) {
    return url.replace('YOUR_MAPTILER_KEY', window.MAPTILER_KEY);
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
  document.getElementById('search-input').addEventListener('input', refreshVisibleData);

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

  window.addEventListener('resize', () => {
    if (window.innerWidth > 960) {
      closeSidebarMobile();
    }
    updateMobileToggleButton();
  });
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

  map.addLayer({
    id: LAYER_POINT_CIRCLES,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 12,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.9
    }
  });

  map.addLayer({
    id: LAYER_POINT_ICONS,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['coalesce', ['get', 'iconImageId'], FALLBACK_ICON_IMAGE_ID],
      'icon-size': 1,
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
    const imageData = await rasterizeSvgToImageData(toWhiteSvg(svg), 16, 16);

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
    const empty = document.createElement('p');
    empty.className = 'location-empty';
    empty.textContent = 'No locations match the current filters.';
    list.appendChild(empty);
    return;
  }

  visibleLocations.slice(0, 200).forEach((loc) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'location-item';

    const locationCategory = categoryById.get(loc.categoryId);
    button.innerHTML = `
      <span class="location-item-name">${escapeHtml(loc.name)}</span>
      <span class="location-item-meta">
        <span class="category-dot" style="--dot-color:${loc.color};"></span>
        ${escapeHtml(locationCategory?.name || loc.categoryName)}
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

function openLocation(loc, flyTo) {
  selectedLocationId = loc.id;
  syncSelectedLayer();

  const category = categoryById.get(loc.categoryId);
  const badgeColor = normalizeColor(loc.color || category?.color);
  const badgeText = getReadableTextColor(badgeColor);

  if (popup) popup.remove();

  popup = new maplibregl.Popup({
    offset: 18,
    maxWidth: '360px',
    className: 'fairmap-popup'
  })
    .setLngLat([loc.lng, loc.lat])
    .setHTML(`
      <article class="popup-card">
        <h3 class="popup-title">${escapeHtml(loc.name)}</h3>
        <p class="popup-badge" style="--badge-color:${badgeColor};--badge-text:${badgeText};">
          ${getCategoryIconPreviewHtml(category, 'popup-icon', true)}
          <span>${escapeHtml(category?.name || loc.categoryName)}</span>
        </p>
        ${loc.address ? `<p class="popup-address">${escapeHtml(loc.address)}</p>` : ''}
        ${loc.description ? `<div class="popup-description">${loc.description}</div>` : ''}
      </article>
    `)
    .addTo(map);

  if (flyTo) {
    map.easeTo({
      center: [loc.lng, loc.lat],
      zoom: Math.max(map.getZoom(), 16.8),
      pitch: mapData.map?.pitch ?? 60,
      duration: 450
    });
  }

  if (window.innerWidth <= 960) {
    closeSidebarMobile();
  }
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

  button.innerHTML = isOpen
    ? '<span class="hamburger-icon">&#10005;</span><span>Close</span>'
    : '<span class="hamburger-icon">&#9776;</span><span>Filters</span>';
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return DEFAULT_COLOR;
  if (input.length === 9) return input.slice(0, 7);
  return input;
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

document.addEventListener('DOMContentLoaded', init);
