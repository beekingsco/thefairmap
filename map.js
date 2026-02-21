let map;
let geolocateControl;

const STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_STYLE_FALLBACK = {
  version: 8,
  sources: {
    esri: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Imagery © Esri'
    }
  },
  layers: [{ id: 'esri-imagery', type: 'raster', source: 'esri' }]
};
const DEFAULT_CENTER = [-95.86125950671834, 32.560925506814755];
const DEFAULT_ZOOM = 17.5;
const DEFAULT_PITCH = 50;
const DEFAULT_BEARING = 0;
const LEGACY_CENTER = [-95.8624, 32.5585];
const SOURCE_ID = 'locations';
const LAYER_MARKERS = 'location-markers';
const LAYER_ICONS = 'location-icons';
const LAYER_CLUSTERS = 'location-clusters';
const LAYER_CLUSTER_COUNT = 'location-cluster-count';
const LAYER_SELECTED = 'location-selected';
const LAYER_HOVER = 'location-hover';
const MAP_BRAND_OVERLAY_ID = 'map-brand-overlay';

const CATEGORY_GROUP_DEFINITIONS = [
  { id: 'favorites', label: 'My Favorites', icon: '\u2605' },
  { id: 'amenities', label: 'Market Amenities', icon: 'A' },
  { id: 'food-drink', label: 'Food & Drink', icon: 'F' },
  { id: 'shop-by-type', label: 'Shop by Product Type', icon: 'S' },
  { id: 'entertainment-rentals', label: 'Entertainment & Rentals', icon: 'E' }
];

const HIDDEN_CATEGORY_NAMES = new Set([
  'market amenities',
  'shop by product type',
  'food & drink',
  'entertainment & rentals'
]);

const appState = {
  mapData: null,
  categories: [],
  categoriesById: new Map(),
  categoryGroups: [],
  locations: [],
  categoryExpanded: new Map(),
  groupExpanded: new Map(),
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
  filtersInitialized: false,
  totalLocationCount: 0,
  sourceLocationCount: 0,
  filterCountRetryTimer: null,
  filterCountDeferredTimer: null,
  filterCountRetryAttempts: 0,
  mapStyleLoading: false,
  detailClosing: false,
  detailCloseTimer: null,
  mobileScrimTimer: null,
  hoveredFeatureId: null,
  hoverPopup: null,
  popupPinned: false,
  sidebarView: 'categories',
  selectedCategoryId: null
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
  console.log('[filters] init:start');
  const data = await fetchMapData();
  console.log('[filters] init:data-loaded', {
    categories: Array.isArray(data.categories) ? data.categories.length : 0,
    locations: Array.isArray(data.locations) ? data.locations.length : 0
  });
  appState.mapData = data;
  appState.venueStyleUrl = resolveVenueStyleUrl(data.map?.style);
  appState.satelliteStyleUrl = resolveSatelliteStyleUrl();
  normalizeData(data);
  console.log('[filters] init:locations-parsed', {
    locations: appState.locations.length,
    filtered: appState.filteredLocations.length
  });
  updateFilterCount('init:after-normalize');
  scheduleFilterCountRefresh(250, 'init:deferred-250ms');
  initializeSidebarState();
  bindUi();
  applyFilters();
  const initialMapView = resolveInitialMapView(data);

  map = new maplibregl.Map({
    container: 'map',
    style: appState.venueStyleUrl,
    center: initialMapView.center,
    zoom: initialMapView.zoom,
    pitch: initialMapView.pitch,
    bearing: DEFAULT_BEARING,
    maxZoom: data.map?.maxZoom || 20,
    attributionControl: false,
    antialias: true
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

  geolocateControl = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: false,
    showUserHeading: true
  });
  map.addControl(geolocateControl, 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Mapme' }), 'bottom-left');

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
      const hasLocations = Array.isArray(json.locations) && json.locations.length > 0;
      const hasCategories = Array.isArray(json.categories) && json.categories.length > 0;
      if (hasLocations && hasCategories) {
        console.log('[filters] fetchMapData:using-source', source, {
          categories: json.categories.length,
          locations: json.locations.length
        });
        return json;
      }
    } catch (_) {
      // try next source
    }
  }
  throw new Error('Unable to load map data');
}

function normalizeCategoryLabel(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isAmenityCategory(name) {
  const value = normalizeCategoryLabel(name);
  return [
    'restroom',
    'handicap parking',
    'information',
    'first aid',
    'atm',
    'entrance',
    'gate',
    'cooling station',
    'points of interest',
    'point of interest',
    'visual marker',
    'market amenit',
    'sample'
  ].some((token) => value.includes(token));
}

function isFoodDrinkCategory(name) {
  const value = normalizeCategoryLabel(name);
  return [
    'food',
    'drink',
    'beverage',
    'coffee',
    'tea',
    'ice cream',
    'candy',
    'snack',
    'lemonade',
    'slush',
    'beer',
    'wine',
    'gourmet'
  ].some((token) => value.includes(token));
}

function isEntertainmentRentalCategory(name) {
  const value = normalizeCategoryLabel(name);
  return ['entertainment', 'live entertainment', 'rental', 'music', 'hidden boots game'].some((token) =>
    value.includes(token)
  );
}

function categoryGroupIdForName(name) {
  const value = normalizeCategoryLabel(name);
  if (value === 'my favorites') return 'favorites';
  if (isEntertainmentRentalCategory(value)) return 'entertainment-rentals';
  if (isFoodDrinkCategory(value)) return 'food-drink';
  if (isAmenityCategory(value)) return 'amenities';
  return 'shop-by-type';
}

function buildCategoryGroups(categories) {
  const groups = CATEGORY_GROUP_DEFINITIONS.map((group) => ({ ...group, categories: [] }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const category of categories) {
    if (!category || HIDDEN_CATEGORY_NAMES.has(normalizeCategoryLabel(category.name))) continue;
    const groupId = categoryGroupIdForName(category.name);
    const group = byId.get(groupId) || byId.get('shop-by-type');
    group.categories.push(category);
  }
  return groups;
}

function normalizeData(data) {
  appState.sourceLocationCount = Array.isArray(data.locations) ? data.locations.length : 0;
  appState.categoriesById = new Map();
  appState.activeCategories = new Set();
  appState.categoryExpanded = new Map();
  appState.groupExpanded = new Map();
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
      const name = String(loc.name || '').trim();
      if (!name) return null;
      const categoryId = String(loc.categoryId || loc.category || 'uncategorized');
      const category = appState.categoriesById.get(categoryId);
      const categoryName = loc.categoryName || category?.name || 'Uncategorized';
      return {
        id: String(loc.id || `loc-${idx}`),
        name,
        description: typeof loc.description === 'string' ? loc.description : '',
        address: typeof loc.address === 'string' ? loc.address : '',
        photos: extractLocationPhotos(loc),
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        categoryId,
        categoryName,
        color: normalizeColor(category?.color || loc.color),
        iconType: iconTypeForCategory(categoryId, categoryName),
        search: `${loc.name || ''} ${categoryName} ${loc.address || ''} ${loc.description || ''}`.toLowerCase()
      };
    })
    .filter(
      (loc) =>
        loc &&
        Number.isFinite(loc.lat) &&
        Number.isFinite(loc.lng)
    );

  // Keep orphaned category ids visible instead of dropping those locations from filters.
  const missingCategoryIds = new Set(
    appState.locations.map((loc) => loc.categoryId).filter((id) => !appState.categoriesById.has(id))
  );
  for (const categoryId of missingCategoryIds) {
    const sample = appState.locations.find((loc) => loc.categoryId === categoryId);
    const fallback = {
      id: categoryId,
      name: sample?.categoryName || 'Uncategorized',
      color: normalizeColor(sample?.color || '#7a7a7a'),
      count: 0
    };
    appState.categories.push(fallback);
    appState.categoriesById.set(categoryId, fallback);
    appState.activeCategories.add(categoryId);
    appState.categoryExpanded.set(categoryId, false);
  }

  appState.filteredLocations = [...appState.locations];
  appState.totalLocationCount = appState.sourceLocationCount || appState.locations.length;
  appState.filtersInitialized = false;
  console.log('[filters] normalizeData:totals', {
    sourceLocationCount: appState.sourceLocationCount,
    totalLocationCount: appState.totalLocationCount,
    locations: appState.locations.length
  });

  // Ensure category counts match the rendered data.
  const computedCounts = new Map();
  for (const location of appState.locations) {
    computedCounts.set(location.categoryId, (computedCounts.get(location.categoryId) || 0) + 1);
  }
  appState.categories = appState.categories
    .map((category) => ({ ...category, count: computedCounts.get(category.id) || category.count || 0 }))
    .filter((category) => category.count > 0)
    .filter((category) => !HIDDEN_CATEGORY_NAMES.has(normalizeCategoryLabel(category.name)))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  appState.categoryGroups = buildCategoryGroups(appState.categories);
  for (const group of appState.categoryGroups) {
    appState.groupExpanded.set(group.id, false);
  }
  requestAnimationFrame(() => updateFilterCount('normalizeData:raf'));
  scheduleFilterCountRefresh(120, 'normalizeData:deferred-120ms');
  scheduleFilterCountRefresh(600, 'normalizeData:deferred-600ms');
}

function bindUi() {
  const searchInput = document.getElementById('search-input');
  const mobileSearchInput = document.getElementById('mobile-search-input');
  const syncSearch = (value, source) => {
    if (searchInput && source !== searchInput) searchInput.value = value;
    if (mobileSearchInput && source !== mobileSearchInput) mobileSearchInput.value = value;
  };

  searchInput.addEventListener('input', () => {
    syncSearch(searchInput.value, searchInput);
    applyFilters();
  });
  mobileSearchInput?.addEventListener('input', () => {
    syncSearch(mobileSearchInput.value, mobileSearchInput);
    applyFilters();
  });

  document.getElementById('overview-toggle').addEventListener('click', () => {
    appState.overviewOpen = !appState.overviewOpen;
    document.getElementById('overview-toggle').setAttribute('aria-expanded', String(appState.overviewOpen));
    document.getElementById('overview-toggle').textContent = appState.overviewOpen ? 'Collapse Overview' : 'Expand Overview';
    document.getElementById('overview-list').classList.toggle('is-collapsed', !appState.overviewOpen);
  });

  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('mobile-categories-btn').addEventListener('click', toggleSidebar);
  document.getElementById('style-venue-btn').addEventListener('click', () => setMapStyle('venue'));
  document.getElementById('style-satellite-btn').addEventListener('click', () => setMapStyle('satellite'));
  document.getElementById('mobile-scrim').addEventListener('click', closeMobileSidebar);
  document.getElementById('detail-scrim').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
  bindMobileGestures();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeDetailPanel();
      closeMobileSidebar();
    }
  });

  window.addEventListener('resize', () => {
    const mobile = window.innerWidth <= 960;
    if (!mobile) {
      const mobileScrim = document.getElementById('mobile-scrim');
      mobileScrim.hidden = true;
      mobileScrim.classList.remove('is-open');
      const app = document.getElementById('app');
      app.classList.toggle('sidebar-open', appState.sidebarOpen);
      app.classList.toggle('sidebar-collapsed', !appState.sidebarOpen);
      app.classList.remove('mobile-sidebar-open');
      updateSidebarToggle(appState.sidebarOpen);
      updateMobileCategoriesButton();
    }
    if (mobile) {
      const app = document.getElementById('app');
      app.classList.remove('sidebar-collapsed');
      app.classList.add('sidebar-open');
      updateSidebarToggle(true);
      updateMobileCategoriesButton();
    }
    updateMapBrandOverlayPosition();
    map?.resize();
  });

  const app = document.getElementById('app');
  if (app && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => updateMapBrandOverlayPosition());
    observer.observe(app, { attributes: true, attributeFilter: ['class'] });
  }
}

function initializeSidebarState() {
  const mobile = window.innerWidth <= 960;
  appState.sidebarOpen = false;
  const app = document.getElementById('app');
  app.classList.toggle('sidebar-open', mobile ? true : appState.sidebarOpen);
  app.classList.toggle('sidebar-collapsed', mobile ? false : !appState.sidebarOpen);
  app.classList.toggle('mobile-sidebar-open', mobile);
  const mobileScrim = document.getElementById('mobile-scrim');
  mobileScrim.hidden = true;
  mobileScrim.classList.remove('is-open');
  updateSidebarToggle(appState.sidebarOpen);
  updateMobileCategoriesButton();
  updateMapStyleButtons();
  updateMapBrandOverlayPosition();
}

function updateMapBrandOverlayPosition() {
  const overlay = document.getElementById(MAP_BRAND_OVERLAY_ID);
  const mapShell = document.getElementById('map-shell');
  if (!overlay || !mapShell) return;
  const rect = mapShell.getBoundingClientRect();
  overlay.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
}

async function loadMarkerIcons() {
  const iconTypes = Object.keys(ICON_SVGS);
  const iconTones = [
    { suffix: 'white', fill: '#ffffff' },
    { suffix: 'black', fill: '#111111' }
  ];
  for (const iconType of iconTypes) {
    for (const tone of iconTones) {
      const iconId = `${iconType}-${tone.suffix}`;
      if (map.hasImage(iconId)) continue;
      const svg = buildIconSvg(iconType, tone.fill);
      const image = await loadSvgImage(svg);
      map.addImage(iconId, image, { pixelRatio: 4 });
    }
  }
}

function buildIconSvg(iconType, fillColor) {
  const markup = ICON_SVGS[iconType] || ICON_SVGS.pin;
  const tinted = markup.replace(/fill=\"#[0-9a-f]{3,8}\"/gi, `fill="${fillColor}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">${tinted}</svg>`;
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
    generateId: true,
    cluster: true,
    clusterRadius: 48,
    clusterMaxZoom: 16
  });

  map.addLayer({
    id: LAYER_CLUSTERS,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#111111',
      'circle-opacity': 0.84,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        19,
        10, 23,
        30, 27,
        80, 31
      ]
    }
  });

  map.addLayer({
    id: LAYER_CLUSTER_COUNT,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
    },
    paint: {
      'text-color': '#ffffff'
    }
  });

  map.addLayer({
    id: LAYER_MARKERS,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 11.5, 16, 13.5, 17.5, 15.25, 20, 17.25],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 14, 1.9, 17, 2.2, 20, 2.5],
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.98
    }
  });

  map.addLayer({
    id: LAYER_ICONS,
    type: 'symbol',
    source: SOURCE_ID,
    layout: {
      'icon-image': ['coalesce', ['get', 'iconImage'], 'pin-white'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-padding': 14,
      'symbol-sort-key': ['-', 1000, ['to-number', ['id'], 0]],
      'icon-size': [
        'interpolate', ['linear'], ['zoom'],
        14, 0.69,
        16, 0.79,
        17.5, 0.86,
        20, 0.98
      ]
    }
  });

  map.addLayer({
    id: LAYER_HOVER,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['id'], -1]],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, 17.5,
        17, 23.4,
        20, 27.8
      ],
      'circle-color': '#ffffff',
      'circle-opacity': 0.3,
      'circle-stroke-width': 0
    }
  });

  map.addLayer({
    id: LAYER_SELECTED,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'id'], '']],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        14, 16.6,
        17, 21.8,
        20, 25.3
      ],
      'circle-color': '#ffffff',
      'circle-opacity': 0.36,
      'circle-stroke-width': 1.9,
      'circle-stroke-color': '#111111'
    }
  });

  const areaFeatures = [
    { name: 'Arbor 1', lng: -95.86333, lat: 32.55882 },
    { name: 'Arbor 2', lng: -95.86225, lat: 32.55905 },
    { name: 'Trade Center', lng: -95.86095, lat: 32.5581 },
    { name: 'Food Court', lng: -95.86192, lat: 32.55758 },
    { name: 'Boardwalk', lng: -95.86328, lat: 32.55795 },
    { name: 'PARKING', lng: -95.86415, lat: 32.55695 }
  ];

  map.addSource('venue-areas', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: areaFeatures.map((area) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [area.lng, area.lat] },
        properties: { name: area.name }
      }))
    }
  });

  map.addLayer({
    id: 'venue-areas-labels',
    type: 'symbol',
    source: 'venue-areas',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Bold'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        14, 11,
        16, 13,
        19, 16
      ],
      'text-letter-spacing': 0.08,
      'text-transform': 'uppercase',
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#313131',
      'text-halo-color': 'rgba(255,255,255,0.92)',
      'text-halo-width': 2
    },
    minzoom: 14
  });
}

function bindMapEvents() {
  if (appState.mapEventsBound) return;
  appState.mapEventsBound = true;

  map.on('click', LAYER_CLUSTERS, (event) => {
    const clusterFeature = event.features?.[0];
    const clusterId = clusterFeature?.properties?.cluster_id;
    if (clusterId === undefined || clusterId === null) return;
    const source = map.getSource(SOURCE_ID);
    if (!source || typeof source.getClusterExpansionZoom !== 'function') return;
    source.getClusterExpansionZoom(Number(clusterId), (error, zoom) => {
      if (error || !Number.isFinite(zoom)) return;
      map.easeTo({
        center: clusterFeature.geometry.coordinates,
        zoom,
        duration: 320
      });
    });
  });

  map.on('click', LAYER_MARKERS, onMarkerClick);
  map.on('click', LAYER_ICONS, onMarkerClick);

  map.on('mouseenter', LAYER_CLUSTERS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LAYER_CLUSTERS, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_MARKERS, onMarkerMouseEnter);
  map.on('mouseleave', LAYER_MARKERS, onMarkerMouseLeave);
  map.on('mouseenter', LAYER_ICONS, onMarkerMouseEnter);
  map.on('mouseleave', LAYER_ICONS, onMarkerMouseLeave);
}

function onMarkerClick(event) {
  const feature = event.features?.[0];
  if (!feature?.properties?.id) return;
  if (typeof feature.id === 'number' && map.getLayer(LAYER_HOVER)) {
    appState.hoveredFeatureId = feature.id;
    map.setFilter(LAYER_HOVER, ['==', ['id'], feature.id]);
  }
  const location = appState.filteredLocations.find((loc) => loc.id === feature.properties.id);
  if (!location) return;
  showAnchorPopup(location, feature.geometry?.coordinates, true);
  openLocation(location, true);
}

function onMarkerMouseEnter(event) {
  if (window.innerWidth <= 960) return;
  const feature = event.features?.[0];
  const id = feature?.id;
  if (typeof id !== 'number') return;
  map.getCanvas().style.cursor = 'pointer';
  if (appState.hoveredFeatureId !== null && appState.hoveredFeatureId !== id) {
    map.setFeatureState({ source: SOURCE_ID, id: appState.hoveredFeatureId }, { hover: false });
  }
  appState.hoveredFeatureId = id;
  map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
  if (map.getLayer(LAYER_HOVER)) {
    map.setFilter(LAYER_HOVER, ['==', ['id'], id]);
  }
  if (!appState.popupPinned) {
    const location = appState.filteredLocations.find((loc) => loc.id === feature?.properties?.id);
    if (location) showAnchorPopup(location, feature.geometry?.coordinates, false);
  }
}

function onMarkerMouseLeave() {
  map.getCanvas().style.cursor = '';
  if (appState.hoveredFeatureId !== null) {
    map.setFeatureState({ source: SOURCE_ID, id: appState.hoveredFeatureId }, { hover: false });
    appState.hoveredFeatureId = null;
  }
  if (map.getLayer(LAYER_HOVER)) {
    map.setFilter(LAYER_HOVER, ['==', ['id'], -1]);
  }
  if (!appState.popupPinned) removeAnchorPopup();
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
    closeDetailPanel();
  }

  renderOverview(query);
  console.log('[filters] applyFilters:computed', {
    query,
    filtered: appState.filteredLocations.length,
    total: appState.locations.length
  });
  updateFilterCount('applyFilters');
}

function renderCategoryCard({ category, query, visibleCounts }) {
  const active = appState.activeCategories.has(category.id);

  const cat = document.createElement('article');
  cat.className = `category-item ${active ? '' : 'is-muted'}`;

  const row = document.createElement('div');
  row.className = 'category-row';
  const toggleCategoryVisibility = () => {
    if (appState.activeCategories.has(category.id)) appState.activeCategories.delete(category.id);
    else appState.activeCategories.add(category.id);
    applyFilters();
  };

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'category-visibility';
  toggle.title = active ? 'Hide category markers' : 'Show category markers';
  toggle.setAttribute('aria-label', `${active ? 'Hide' : 'Show'} ${category.name}`);
  toggle.style.setProperty('--cat-color', category.color);
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleCategoryVisibility();
  });

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'category-head';
  head.setAttribute('aria-pressed', String(active));
  head.title = `Show ${category.name} locations`;
  head.innerHTML = `
    <span class="category-name">${escapeHtml(category.name)}</span>
    <span class="category-count">${visibleCounts.get(category.id) || 0}/${category.count}</span>
  `;
  head.addEventListener('click', () => {
    appState.sidebarView = 'locations';
    appState.selectedCategoryId = category.id;
    renderOverview(query);
  });

  row.appendChild(toggle);
  row.appendChild(head);
  cat.appendChild(row);
  return cat;
}

function renderOverview(query) {
  const wrap = document.getElementById('overview-list');
  wrap.innerHTML = '';
  if (appState.sidebarView === 'locations') {
    renderCategoryLocationsView(wrap, query);
    return;
  }
  const groups = appState.categoryGroups.length > 0 ? appState.categoryGroups : buildCategoryGroups(appState.categories);

  const visibleCounts = new Map();
  for (const loc of appState.filteredLocations) {
    visibleCounts.set(loc.categoryId, (visibleCounts.get(loc.categoryId) || 0) + 1);
  }

  for (const group of groups) {
    const groupVisible = group.categories.reduce((sum, category) => sum + (visibleCounts.get(category.id) || 0), 0);
    const groupTotal = group.categories.reduce((sum, category) => sum + (category.count || 0), 0);
    const autoExpand = Boolean(query) && groupVisible > 0;
    const expanded = autoExpand || appState.groupExpanded.get(group.id) === true;

    const section = document.createElement('section');
    section.className = 'category-group';

    const groupHeader = document.createElement('button');
    groupHeader.type = 'button';
    groupHeader.className = 'category-group-header';
    groupHeader.setAttribute('aria-expanded', String(expanded));
    groupHeader.innerHTML = `
      <span class="category-group-arrow">${expanded ? '&#9660;' : '&#9654;'}</span>
      <span class="category-group-icon">${escapeHtml(group.icon)}</span>
      <span class="category-group-name">${escapeHtml(group.label)}</span>
      <span class="category-group-count">${groupVisible}/${groupTotal}</span>
    `;
    groupHeader.addEventListener('click', () => {
      appState.groupExpanded.set(group.id, !expanded);
      renderOverview(query);
    });
    section.appendChild(groupHeader);

    const groupBody = document.createElement('div');
    groupBody.className = 'category-group-body';
    groupBody.hidden = !expanded;
    if (group.categories.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'category-empty';
      empty.textContent = 'No categories available.';
      groupBody.appendChild(empty);
    } else {
      for (const category of group.categories) {
        groupBody.appendChild(renderCategoryCard({ category, query, visibleCounts }));
      }
    }
    section.appendChild(groupBody);
    wrap.appendChild(section);
  }
}

function renderCategoryLocationsView(wrap, query) {
  const category = appState.categoriesById.get(String(appState.selectedCategoryId || ''));
  if (!category) {
    appState.sidebarView = 'categories';
    appState.selectedCategoryId = null;
    renderOverview(query);
    return;
  }
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'category-back-btn';
  backButton.textContent = '\u2190 Back';
  backButton.addEventListener('click', () => {
    appState.sidebarView = 'categories';
    appState.selectedCategoryId = null;
    renderOverview(query);
  });
  wrap.appendChild(backButton);

  const list = document.createElement('div');
  list.className = 'category-location-list';
  const locations = appState.filteredLocations.filter((loc) => loc.categoryId === category.id);
  if (locations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'category-empty';
    empty.textContent = query ? 'No search matches in this category.' : 'No visible locations in this category.';
    list.appendChild(empty);
    wrap.appendChild(list);
    return;
  }

  for (const loc of locations) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'category-location-row';
    if (loc.id === appState.selectedLocationId) row.classList.add('is-selected');
    const description = truncateDescriptionToText(loc.description);
    row.innerHTML = `
      <span class="category-location-dot" style="--dot-color:${escapeAttr(normalizeColor(loc.color))};"></span>
      <span class="category-location-main">
        <span class="category-location-name">${escapeHtml(loc.name)}</span>
        <span class="category-location-address">${escapeHtml(sanitizeMetaAddress(loc.address) || 'Address unavailable')}</span>
        <span class="category-location-desc">${escapeHtml(description || 'No description available.')}</span>
      </span>
    `;
    row.addEventListener('click', () => openLocation(loc, true));
    list.appendChild(row);
  }
  wrap.appendChild(list);
}

function openLocation(location, fly) {
  appState.selectedLocationId = location.id;
  syncSelectedLayer();

  renderDetail(location);

  if (fly) {
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: Math.max(17.2, map.getZoom()),
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      curve: 1.35,
      speed: 0.92,
      essential: true,
      offset: getDetailAwareFlyOffset()
    });
  }

  if (window.innerWidth <= 960) {
    closeMobileSidebar();
  }

  const currentQuery = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  renderOverview(currentQuery);
}

function getDetailAwareFlyOffset() {
  const mobile = window.innerWidth <= 960;
  const detailPanel = document.getElementById('detail-panel');
  if (!detailPanel) return [0, 0];
  if (mobile) {
    const mobilePanelHeight = Math.min(detailPanel.getBoundingClientRect().height || 0, window.innerHeight * 0.74);
    return [0, Math.round(-mobilePanelHeight * 0.22)];
  }
  const desktopPanelWidth = detailPanel.getBoundingClientRect().width || Math.min(420, window.innerWidth * 0.33);
  return [Math.round(-desktopPanelWidth * 0.36), 0];
}

function renderDetail(location) {
  const panel = document.getElementById('detail-panel');
  const content = document.getElementById('detail-content');
  const scrim = document.getElementById('detail-scrim');
  const app = document.getElementById('app');
  const category = appState.categoriesById.get(location.categoryId);
  const categoryName = category?.name || location.categoryName;
  const color = normalizeColor(category?.color || location.color);
  const description = formatDescription(location.description);
  const hero = location.photos.length
    ? `<img class="detail-hero" src="${escapeAttr(location.photos[0])}" alt="${escapeAttr(location.name)} photo" loading="lazy">`
    : '';
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${location.lat},${location.lng}`)}`;
  const metaLine = [sanitizeMetaAddress(location.address), categoryName].filter(Boolean).join(' | ');

  content.innerHTML = `
    <div class="detail-media">${hero}</div>
    <header class="detail-header mapme-detail-header">
      <h2 class="detail-title">${escapeHtml(location.name)}</h2>
      ${metaLine ? `<p class="detail-meta">${escapeHtml(metaLine)}</p>` : ''}
      <div class="detail-badge" style="background:${color};color:${pickTextColor(color)};">${escapeHtml(categoryName)}</div>
    </header>
    <section class="detail-body">
      <div class="detail-description">${description}</div>
    </section>
    <div class="detail-actions">
      <a class="detail-btn primary" href="${directionsUrl}" target="_blank" rel="noreferrer noopener">Directions</a>
    </div>
  `;

  if (appState.detailCloseTimer) {
    clearTimeout(appState.detailCloseTimer);
    appState.detailCloseTimer = null;
  }
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  panel.classList.remove('is-open');
  panel.classList.remove('is-closing');
  if (scrim) {
    scrim.hidden = false;
    scrim.classList.remove('is-open');
    requestAnimationFrame(() => scrim.classList.add('is-open'));
  }
  if (app) app.classList.add('detail-open');
  requestAnimationFrame(() => panel.classList.add('is-open'));
  appState.detailClosing = false;
  syncMobileFloatingUi(true);
}

function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  const scrim = document.getElementById('detail-scrim');
  const app = document.getElementById('app');
  if (!panel || panel.hidden || appState.detailClosing) return;
  appState.popupPinned = false;
  removeAnchorPopup();
  appState.detailClosing = true;
  panel.classList.add('is-closing');
  panel.classList.remove('is-open');
  if (scrim) scrim.classList.remove('is-open');
  const finalizeClose = () => {
    if (!appState.detailClosing) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.classList.remove('is-closing');
    if (scrim) {
      scrim.hidden = true;
      scrim.classList.remove('is-open');
    }
    if (app) app.classList.remove('detail-open');
    appState.detailClosing = false;
    if (appState.detailCloseTimer) {
      clearTimeout(appState.detailCloseTimer);
      appState.detailCloseTimer = null;
    }
    syncMobileFloatingUi(false);
    panel.removeEventListener('transitionend', finalizeClose);
  };
  panel.addEventListener('transitionend', finalizeClose);
  appState.detailCloseTimer = setTimeout(finalizeClose, 320);
}

function syncMobileFloatingUi(detailOpen) {
  if (window.innerWidth > 960) return;
  const floatingFiltersBtn = document.getElementById('mobile-categories-btn');
  if (!floatingFiltersBtn) return;
  floatingFiltersBtn.hidden = Boolean(detailOpen);
}

function toggleSidebar() {
  const mobile = window.innerWidth <= 960;
  if (mobile) {
    const app = document.getElementById('app');
    setMobileSidebarOpen(!app.classList.contains('mobile-sidebar-open'));
    return;
  }

  appState.sidebarOpen = !appState.sidebarOpen;
  const app = document.getElementById('app');
  app.classList.toggle('sidebar-open', appState.sidebarOpen);
  app.classList.toggle('sidebar-collapsed', !appState.sidebarOpen);
  updateSidebarToggle(appState.sidebarOpen);
  updateMapBrandOverlayPosition();

  setTimeout(() => map?.resize(), 300);
}

function closeMobileSidebar() {
  if (window.innerWidth > 960) return;
  setMobileSidebarOpen(false);
}

function setMobileSidebarOpen(open) {
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.toggle('mobile-sidebar-open', open);
  const scrim = document.getElementById('mobile-scrim');
  if (scrim) {
    if (appState.mobileScrimTimer) {
      clearTimeout(appState.mobileScrimTimer);
      appState.mobileScrimTimer = null;
    }
    if (open) {
      scrim.hidden = false;
      requestAnimationFrame(() => scrim.classList.add('is-open'));
    } else {
      scrim.classList.remove('is-open');
      appState.mobileScrimTimer = setTimeout(() => {
        scrim.hidden = true;
        appState.mobileScrimTimer = null;
      }, 180);
    }
  }
  updateMobileCategoriesButton();
  updateMapBrandOverlayPosition();
}

function updateSidebarToggle(isOpen) {
  const toggle = document.getElementById('sidebar-toggle');
  const glyph = toggle?.querySelector('.map-btn-glyph');
  if (glyph) glyph.textContent = isOpen ? '<' : '>';
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Collapse filters' : 'Expand filters');
}

function updateFilterCount(source = 'unknown') {
  const countEl = document.getElementById('filters-count');
  if (!countEl) {
    // If the element is not mounted yet, retry shortly.
    console.log('[filters] updateFilterCount:countEl-missing', { source });
    scheduleFilterCountRefresh(80, `${source}:retry-no-countEl`);
    return;
  }
  const hasLocations = appState.locations.length > 0;
  const filteredCount = appState.filteredLocations?.length ?? appState.locations?.length ?? 0;
  const nextTotal = appState.sourceLocationCount || (hasLocations ? appState.locations.length : (appState.totalLocationCount || 0));
  appState.totalLocationCount = nextTotal;
  console.log('[filters] updateFilterCount', {
    source,
    locations: appState.locations.length,
    filtered: filteredCount,
    totalLocationCount: appState.totalLocationCount
  });
  countEl.textContent = `(${appState.totalLocationCount})`;
  updateMobileCategoriesButton(appState.totalLocationCount, `updateFilterCount:${source}`);

  // Retry while data is still empty to survive async load races.
  if (!hasLocations) {
    appState.filterCountRetryAttempts += 1;
    if (appState.filterCountRetryTimer) clearTimeout(appState.filterCountRetryTimer);
    appState.filterCountRetryTimer = setTimeout(() => updateFilterCount(`${source}:retry-empty-locations`), 150);
    return;
  }
  if (hasLocations) {
    appState.filterCountRetryAttempts = 0;
    if (appState.filterCountRetryTimer) {
      clearTimeout(appState.filterCountRetryTimer);
      appState.filterCountRetryTimer = null;
    }
  }
}

function scheduleFilterCountRefresh(delay = 150, source = 'unknown') {
  if (appState.filterCountDeferredTimer) {
    clearTimeout(appState.filterCountDeferredTimer);
  }
  appState.filterCountDeferredTimer = setTimeout(() => {
    appState.filterCountDeferredTimer = null;
    updateFilterCount(`deferred:${source}`);
  }, delay);
}

function updateMobileCategoriesButton(totalCount = appState.totalLocationCount || appState.locations.length || 0, source = 'unknown') {
  const button = document.getElementById('mobile-categories-btn');
  if (!button) return;
  const label = document.getElementById('mobile-filters-label');
  const open = document.getElementById('app').classList.contains('mobile-sidebar-open');
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close filters' : 'Open filters');
  const text = open ? 'Close Filters' : `Filters (${totalCount})`;
  if (label) label.textContent = text;
  else button.textContent = text;
  console.log('[filters] updateMobileCategoriesButton', {
    source,
    totalCount,
    open,
    text
  });
}

function showAnchorPopup(location, coordinates, pin) {
  if (!map || !location) return;
  const lngLat = Array.isArray(coordinates) && coordinates.length >= 2
    ? [Number(coordinates[0]), Number(coordinates[1])]
    : [Number(location.lng), Number(location.lat)];
  if (!Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) return;
  if (!appState.hoverPopup) {
    appState.hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: [0, -12],
      className: 'map-anchor-popup'
    });
  }
  appState.hoverPopup
    .setLngLat(lngLat)
    .setHTML(`<span>${escapeHtml(location.name)}</span>`)
    .addTo(map);
  appState.popupPinned = Boolean(pin);
}

function removeAnchorPopup() {
  if (appState.hoverPopup) appState.hoverPopup.remove();
}

function bindMobileGestures() {
  const sidebar = document.getElementById('sidebar');
  const detailPanel = document.getElementById('detail-panel');
  const detailHandle = detailPanel?.querySelector('[data-sheet-handle="detail"]');
  if (!sidebar || !detailPanel) return;

  const isMobile = () => window.innerWidth <= 960;
  const OPEN_DRAG_THRESHOLD_VIEWPORT = 0.3;
  const CLOSE_DRAG_THRESHOLD_PANEL = 0.4;
  const SIDEBAR_PEEK_HEIGHT = 54;

  const canDragPointer = (event) => event.isPrimary && event.button === 0;
  const getSidebarClosedOffset = () => Math.max(sidebar.getBoundingClientRect().height - SIDEBAR_PEEK_HEIGHT, 0);
  const canStartSidebarDrag = (event) => {
    const rect = sidebar.getBoundingClientRect();
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    if (event.clientY < rect.top || event.clientY > visibleBottom) return false;
    return event.clientY <= rect.top + 60;
  };

  const bindSheetDrag = ({
    panel,
    target,
    requiresOpen,
    canStartDrag,
    getStartOffset,
    getBounds,
    finalize
  }) => {
    if (!panel || !target) return;

    let dragging = false;
    let pointerId = null;
    let startY = 0;
    let startOffset = 0;
    let currentOffset = 0;

    const resetDragStyle = () => {
      panel.style.transition = '';
      panel.style.transform = '';
      document.body.style.userSelect = '';
    };

    const finish = (cancelled = false) => {
      if (!dragging) return;
      dragging = false;
      resetDragStyle();
      if (!cancelled) finalize(startOffset, currentOffset);
      pointerId = null;
    };

    const onPointerMove = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const delta = event.clientY - startY;
      const bounds = getBounds();
      if (!bounds) return;

      let nextOffset = startOffset + delta;
      if (nextOffset < bounds.min) {
        nextOffset = bounds.min + (nextOffset - bounds.min) * 0.35;
      }
      if (nextOffset > bounds.max) nextOffset = bounds.max;
      currentOffset = nextOffset;
      panel.style.transform = `translateY(${nextOffset}px)`;
      event.preventDefault();
    };

    const onPointerUp = (event) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      finish(false);
    };

    const onPointerCancel = (event) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      finish(true);
    };

    target.addEventListener('pointerdown', (event) => {
      if (!isMobile() || !canDragPointer(event)) return;
      if (requiresOpen && !panel.classList.contains('is-open')) return;
      if (panel.hidden) return;
      if (typeof canStartDrag === 'function' && !canStartDrag(event)) return;
      const bounds = getBounds();
      if (!bounds) return;

      dragging = true;
      pointerId = event.pointerId;
      startY = event.clientY;
      startOffset = getStartOffset();
      currentOffset = startOffset;

      panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp, { passive: true });
      window.addEventListener('pointercancel', onPointerCancel, { passive: true });
      event.preventDefault();
    });
  };

  bindSheetDrag({
    panel: sidebar,
    target: sidebar,
    requiresOpen: false,
    canStartDrag: canStartSidebarDrag,
    getStartOffset: () => (document.getElementById('app').classList.contains('mobile-sidebar-open') ? 0 : getSidebarClosedOffset()),
    getBounds: () => ({ min: 0, max: getSidebarClosedOffset() }),
    finalize: (startOffset, endOffset) => {
      const panelHeight = sidebar.getBoundingClientRect().height;
      if (startOffset <= 1) {
        setMobileSidebarOpen(endOffset <= panelHeight * CLOSE_DRAG_THRESHOLD_PANEL);
        return;
      }
      const draggedUp = startOffset - endOffset;
      setMobileSidebarOpen(draggedUp >= window.innerHeight * OPEN_DRAG_THRESHOLD_VIEWPORT);
    }
  });

  bindSheetDrag({
    panel: detailPanel,
    target: detailHandle,
    requiresOpen: true,
    getStartOffset: () => 0,
    getBounds: () => ({ min: -window.innerHeight * 0.12, max: detailPanel.getBoundingClientRect().height }),
    finalize: (_, endOffset) => {
      const panelHeight = detailPanel.getBoundingClientRect().height;
      if (endOffset >= panelHeight * CLOSE_DRAG_THRESHOLD_PANEL) {
        closeDetailPanel();
        return;
      }
      detailPanel.classList.add('is-open');
    }
  });
}

function updateMapStyleButtons() {
  const isVenue = appState.activeMapStyle === 'venue';
  const venueBtn = document.getElementById('style-venue-btn');
  const satelliteBtn = document.getElementById('style-satellite-btn');
  if (!venueBtn || !satelliteBtn) return;
  venueBtn.classList.toggle('is-active', isVenue);
  satelliteBtn.classList.toggle('is-active', !isVenue);
  venueBtn.disabled = appState.mapStyleLoading;
  satelliteBtn.disabled = appState.mapStyleLoading;
  venueBtn.setAttribute('aria-pressed', String(isVenue));
  satelliteBtn.setAttribute('aria-pressed', String(!isVenue));
}

async function setMapStyle(styleId) {
  if (!map || appState.mapStyleLoading || appState.activeMapStyle === styleId) return;
  const previousStyle = appState.activeMapStyle;
  appState.mapStyleLoading = true;
  appState.activeMapStyle = styleId;
  updateMapStyleButtons();
  const styleUrl = styleId === 'satellite' ? appState.satelliteStyleUrl : appState.venueStyleUrl;
  try {
    map.setStyle(styleUrl);
    map.once('style.load', async () => {
      try {
        await hydrateStyleContent();
      } finally {
        appState.mapStyleLoading = false;
        updateMapStyleButtons();
      }
    });
  } catch (error) {
    console.error('[map-style] failed to switch style', error);
    appState.activeMapStyle = previousStyle;
    appState.mapStyleLoading = false;
    updateMapStyleButtons();
  }
}

async function hydrateStyleContent() {
  await loadMarkerIcons();
  buildLayers();
  appState.hoveredFeatureId = null;
  applyFilters();
  scheduleFilterCountRefresh(120, 'hydrateStyleContent');
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
        iconType: loc.iconType,
        iconImage: `${loc.iconType}-${pickMarkerIconTone(loc.color)}`
      }
    }))
  };
}

function pickMarkerIconTone(hex) {
  const color = normalizeColor(hex);
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 128 ? 'black' : 'white';
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
  void categoryId;
  return mapCategoryToIconType(categoryName);
}

function iconIdFromFile(fileName) {
  return `category-${String(fileName).replace(/\.svg$/i, '').replace(/[^a-z0-9-]/gi, '-')}`;
}

function normalizeColor(input) {
  if (typeof input !== 'string' || !input.startsWith('#')) return '#7a7a7a';
  if (input.length === 9) {
    // MapMe exports #RRGGBBAA; MapLibre color parsing is more reliable with #RRGGBB.
    return `#${input.slice(1, 7)}`.toLowerCase();
  }
  if (input.length === 7) return input.toLowerCase();
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

function resolveVenueStyleUrl(rawStyle) {
  if (window.MAPTILER_KEY) return `https://api.maptiler.com/maps/streets-v2/style.json?key=${window.MAPTILER_KEY}`;
  return resolveStyleUrl(rawStyle);
}

function resolveSatelliteStyleUrl() {
  return SATELLITE_STYLE_FALLBACK;
}

function resolveInitialMapView(data) {
  const hasCenter = Array.isArray(data.map?.center) && data.map.center.length === 2;
  let center = hasCenter ? data.map.center : DEFAULT_CENTER;
  let zoom = Number.isFinite(data.map?.zoom) ? data.map.zoom : DEFAULT_ZOOM;
  let pitch = Number.isFinite(data.map?.pitch) ? data.map.pitch : DEFAULT_PITCH;

  const isLegacyCenter =
    hasCenter &&
    Math.abs(center[0] - LEGACY_CENTER[0]) < 1e-7 &&
    Math.abs(center[1] - LEGACY_CENTER[1]) < 1e-7;
  if (isLegacyCenter) center = DEFAULT_CENTER;
  zoom = Math.max(zoom, DEFAULT_ZOOM);
  pitch = Math.min(pitch, DEFAULT_PITCH);

  return { center, zoom, pitch };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function formatDescription(description) {
  if (!description) return 'No description available.';
  const raw = String(description);
  const stripScript = raw.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  const strippedHandlers = stripScript
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '');
  const hasHtml = /<[^>]+>/.test(strippedHandlers);
  if (!hasHtml) return escapeHtml(strippedHandlers).replace(/\n/g, '<br>');
  return replaceMapmeSocialIcons(strippedHandlers);
}

function replaceMapmeSocialIcons(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const mapmeSocialPattern = /static-resources\.mapme\.com\/ps\/images\/social-network-icons\//i;
  const emojiByNetwork = {
    facebook: '📘',
    fb: '📘',
    instagram: '📸',
    tiktok: '🎵',
    twitter: '𝕏',
    x: '𝕏',
    youtube: '▶️',
    website: '🌐',
    web: '🌐'
  };

  const socialImgs = container.querySelectorAll('img');
  socialImgs.forEach((img) => {
    const src = String(img.getAttribute('src') || '').trim();
    if (!mapmeSocialPattern.test(src)) return;
    const parentLink = img.closest('a[href]');
    const href = parentLink?.getAttribute('href') || '';
    const alt = String(img.getAttribute('alt') || '').trim().toLowerCase();
    const fileToken = src.split('/').pop()?.split('.')[0]?.toLowerCase() || '';
    const network = alt || fileToken || 'social';
    const emoji = emojiByNetwork[network] || '🔗';
    const label = network === 'x' ? 'X' : network.charAt(0).toUpperCase() + network.slice(1);
    const replacement = document.createElement(href ? 'a' : 'span');
    replacement.className = 'social-link-fallback';
    if (href) {
      replacement.setAttribute('href', href);
      replacement.setAttribute('target', '_blank');
      replacement.setAttribute('rel', 'noopener noreferrer');
    }
    replacement.innerHTML = `<span class="social-emoji" aria-hidden="true">${emoji}</span><span>${escapeHtml(label)}</span>`;

    if (parentLink) {
      const host = parentLink.parentElement;
      if (host && host !== container && host.children.length === 1) {
        host.replaceWith(replacement);
      } else {
        parentLink.replaceWith(replacement);
      }
    } else {
      img.replaceWith(replacement);
    }
  });

  return container.innerHTML;
}

function sanitizeMetaAddress(address) {
  const value = String(address || '').trim();
  if (!value) return '';
  if (/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/i.test(value)) return '';
  return value;
}

function truncateDescriptionToText(rawDescription) {
  const source = String(rawDescription || '');
  if (!source.trim()) return '';
  const stripped = source.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  const text = document.createElement('div');
  text.innerHTML = stripped;
  return (text.textContent || '').replace(/\s+/g, ' ').trim();
}

function extractLocationPhotos(location) {
  const candidates = [];
  if (Array.isArray(location.photos)) candidates.push(...location.photos);
  if (Array.isArray(location.images)) candidates.push(...location.images);
  if (typeof location.photo === 'string') candidates.push(location.photo);
  if (typeof location.image === 'string') candidates.push(location.image);
  if (Array.isArray(location.media)) candidates.push(...location.media);

  const urls = [];
  for (const item of candidates) {
    if (!item) continue;
    const url = typeof item === 'string' ? item : item.url || item.src;
    if (typeof url !== 'string') continue;
    const cleaned = url.trim();
    if (!cleaned) continue;
    if (/^https?:\/\//i.test(cleaned) || cleaned.startsWith('/uploads/')) urls.push(cleaned);
  }
  return Array.from(new Set(urls));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
