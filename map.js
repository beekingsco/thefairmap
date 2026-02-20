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

const SOURCE_ID = 'locations-source';
const LAYER_CLUSTER = 'clusters';
const LAYER_CLUSTER_COUNT = 'cluster-count';
const LAYER_POINTS = 'location-points';
const LAYER_SELECTED = 'location-selected';

async function init() {
  const response = await fetch('./data/locations.json');
  mapData = await response.json();

  document.getElementById('map-title').textContent = mapData.map?.name || 'First Monday Finder';
  document.getElementById('map-subtitle').textContent = mapData.map?.subtitle || 'Canton, Texas';

  hydrateLocations();
  setupCategoryState();
  initSidebarControls();

  // Resolve MapTiler style URL - key can be in style URL or injected via config.js
  let styleUrl = mapData.map.style;
  if (window.MAPTILER_KEY && styleUrl.includes('YOUR_MAPTILER_KEY')) {
    styleUrl = styleUrl.replace('YOUR_MAPTILER_KEY', window.MAPTILER_KEY);
  }

  map = new maplibregl.Map({
    container: 'map',
    style: styleUrl,
    center: mapData.map.center,
    zoom: mapData.map.zoom,
    pitch: mapData.map.pitch ?? 60,
    bearing: mapData.map.bearing ?? 0,
    maxZoom: mapData.map.maxZoom || 20,
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

  map.on('load', () => {
    buildMapLayers();
    refreshVisibleData();
  });

  // Safety: re-set data after style is fully loaded (fixes race condition)
  map.on('idle', function onFirstIdle() {
    refreshVisibleData();
    map.off('idle', onFirstIdle);
  });
}

function hydrateLocations() {
  locations = (mapData.locations || []).map((loc, index) => {
    const category = mapData.categories.find((cat) => cat.id === loc.categoryId);
    return {
      id: String(loc.id || `loc-${index}`),
      name: loc.name || 'Untitled',
      description: loc.description || '',
      address: loc.address || '',
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      featured: Boolean(loc.featured),
      categoryId: loc.categoryId || '',
      categoryName: loc.categoryName || category?.name || 'Uncategorized',
      color: normalizeColor(category?.color) || '#787878',
      searchText: `${loc.name || ''} ${loc.address || ''} ${loc.categoryName || ''}`.toLowerCase()
    };
  }).filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
}

function setupCategoryState() {
  (mapData.categories || []).forEach((category) => {
    categoryById.set(category.id, {
      ...category,
      color: normalizeColor(category.color)
    });

    totalCountsByCategory.set(
      category.id,
      locations.reduce((count, loc) => count + (loc.categoryId === category.id ? 1 : 0), 0)
    );

    activeCategories.add(category.id);
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
  });
}

function buildMapLayers() {
  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: asFeatureCollection([]),
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 52
  });

  map.addLayer({
    id: LAYER_CLUSTER,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#d9b690',
        15,
        '#cb9463',
        50,
        '#9f693f'
      ],
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        18,
        15,
        22,
        50,
        28
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
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
    id: LAYER_POINTS,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['coalesce', ['get', 'color'], '#7d7d7d'],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        8,
        15,
        12,
        18,
        16,
        20,
        18
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 0.95
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
        11,
        15,
        16,
        18,
        21
      ],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#111111',
      'circle-stroke-width': 2,
      'circle-opacity': 0.45
    }
  });

  map.on('click', LAYER_CLUSTER, onClusterClick);
  map.on('click', LAYER_POINTS, onPointClick);

  map.on('mouseenter', LAYER_CLUSTER, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', LAYER_CLUSTER, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_POINTS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', LAYER_POINTS, () => {
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
    map.getSource(SOURCE_ID).setData(asFeatureCollection(visibleLocations));
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
        address: loc.address
      }
    }))
  };
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

  if (popup) popup.remove();

  popup = new maplibregl.Popup({ offset: 20, maxWidth: '360px' })
    .setLngLat([loc.lng, loc.lat])
    .setHTML(`
      <article class="popup-content">
        <h3>${escapeHtml(loc.name)}</h3>
        <p class="popup-badge" style="--badge-color:${loc.color};">${escapeHtml(category?.name || loc.categoryName)}</p>
        ${loc.address ? `<p class="popup-address">${escapeHtml(loc.address)}</p>` : ''}
        ${loc.description ? `<div class="popup-description">${loc.description}</div>` : ''}
      </article>
    `)
    .addTo(map);

  if (flyTo) {
    map.easeTo({
      center: [loc.lng, loc.lat],
      zoom: Math.max(map.getZoom(), 16.8),
      pitch: mapData.map.pitch ?? 60,
      duration: 450
    });
  }

  if (window.innerWidth <= 960) {
    closeSidebarMobile();
  }
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
    closeSidebarMobile();
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
  if (window.innerWidth <= 960) {
    openSidebarMobile();
    return;
  }

  const app = document.getElementById('app');
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
}

function closeSidebarMobile() {
  const app = document.getElementById('app');
  app.classList.remove('mobile-sidebar-open');

  const backdrop = document.getElementById('mobile-backdrop');
  backdrop.hidden = true;
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return '#7a7a7a';
  if (input.length === 9) return input.slice(0, 7);
  return input;
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
