let map;
let geolocateControl;

// ── Favorites (localStorage) ──────────────────────────────────────────
const FAVORITES_KEY = 'thefairmap_favorites';
const GUEST_PROFILE_KEY = 'fmGuestProfile';
const LEGACY_GUEST_PROFILE_KEYS = ['firstMondayGuestProfile', 'thefairmap_guest_profile'];
const CONTEST_PROFILE_PREFIX = 'fmContestEntry:';
const FM_PUBLIC_NOTICE_URL = 'https://vfm.buzzonmarketing.com/api/fm/notices/public';
const GUEST_NOTICE_CLIENT_KEY = 'thefairmap_guest_notice_client_key';
let pendingGuestProfileResolve = null;
let guestNoticeQueue = [];
let guestNoticeVisible = false;

function normalizeGuestProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const email = String(raw.email || '').trim().toLowerCase();
  if (!email) return null;
  return {
    name: String(raw.name || raw.fullName || raw.first_name || '').trim(),
    email,
    phone: String(raw.phone || raw.mobile || '').trim(),
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function getGuestProfile() {
  try {
    const direct = normalizeGuestProfile(JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || 'null'));
    if (direct) return direct;
  } catch {}
  for (const key of LEGACY_GUEST_PROFILE_KEYS) {
    try {
      const profile = normalizeGuestProfile(JSON.parse(localStorage.getItem(key) || 'null'));
      if (profile) return saveGuestProfile(profile);
    } catch {}
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(CONTEST_PROFILE_PREFIX)) continue;
      const profile = normalizeGuestProfile(JSON.parse(localStorage.getItem(key) || 'null'));
      if (profile) return saveGuestProfile(profile);
    }
  } catch {}
  return null;
}

function saveGuestProfile(profile) {
  const clean = normalizeGuestProfile(profile);
  if (!clean) return null;
  clean.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(clean));
    localStorage.setItem('firstMondayGuestProfile', JSON.stringify(clean));
  } catch {}
  return clean;
}

function ensureGuestProfile(reason = 'favorites') {
  const existing = getGuestProfile();
  if (existing) return Promise.resolve(existing);
  return showGuestProfileModal(reason);
}

function getGuestNoticeClientKey() {
  try {
    const existing = localStorage.getItem(GUEST_NOTICE_CLIENT_KEY);
    if (existing) return existing;
    const created = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(GUEST_NOTICE_CLIENT_KEY, created);
    return created;
  } catch (e) {
    return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function formatGuestNoticeTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function ensureGuestNoticeModal() {
  let overlay = document.getElementById('guest-notice-overlay');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'guest-notice-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:10050;background:rgba(17,24,39,0.56);padding:18px;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="width:min(560px,100%);background:#fff;border-radius:22px;box-shadow:0 30px 80px rgba(17,24,39,0.25);overflow:hidden;">
      <div style="padding:18px 20px 14px;background:linear-gradient(135deg,#1a7a50,#14532d);color:#fff;">
        <div style="font-size:0.72rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.82);">Guest Notice</div>
        <div style="font-size:1rem;font-weight:800;margin-top:5px;">Message from Visit First Monday</div>
        <div id="guest-notice-time" style="font-size:0.74rem;opacity:0.88;margin-top:5px;"></div>
      </div>
      <div style="padding:20px;">
        <div id="guest-notice-image-wrap" style="display:none;margin-bottom:14px;">
          <img id="guest-notice-image" alt="Notice image" style="display:block;max-width:100%;border-radius:16px;border:1px solid #e5e7eb;" />
        </div>
        <div id="guest-notice-message" style="font-size:0.96rem;line-height:1.6;color:#1f2937;white-space:pre-wrap;"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:18px;">
          <button type="button" id="guest-notice-close-btn" style="padding:11px 16px;background:#1a7a50;color:#fff;border:none;border-radius:10px;font-size:0.82rem;font-weight:700;cursor:pointer;">Close forever</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#guest-notice-close-btn')?.addEventListener('click', dismissActiveGuestNotice);
  return overlay;
}

function showGuestNotice(notice) {
  const overlay = ensureGuestNoticeModal();
  const messageEl = overlay.querySelector('#guest-notice-message');
  const timeEl = overlay.querySelector('#guest-notice-time');
  const imageWrap = overlay.querySelector('#guest-notice-image-wrap');
  const imageEl = overlay.querySelector('#guest-notice-image');
  if (messageEl) messageEl.textContent = notice?.message || '';
  if (timeEl) timeEl.textContent = formatGuestNoticeTimestamp(notice?.createdAt);
  if (imageWrap && imageEl) {
    if (notice?.imageUrl) {
      imageEl.src = notice.imageUrl;
      imageWrap.style.display = 'block';
    } else {
      imageEl.removeAttribute('src');
      imageWrap.style.display = 'none';
    }
  }
  overlay.style.display = 'flex';
  guestNoticeVisible = true;
}

function maybeShowNextGuestNotice() {
  if (guestNoticeVisible) return;
  const next = guestNoticeQueue[0];
  if (!next) return;
  showGuestNotice(next);
}

async function dismissActiveGuestNotice() {
  const active = guestNoticeQueue[0];
  if (!active) return;
  const profile = getGuestProfile();
  try {
    await fetch(`${FM_PUBLIC_NOTICE_URL}/${encodeURIComponent(active.id)}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestEmail: profile?.email || '',
        clientKey: getGuestNoticeClientKey()
      })
    });
  } catch (error) {
    console.warn('[guest-notice] dismissal failed', error);
  }
  guestNoticeQueue.shift();
  const overlay = document.getElementById('guest-notice-overlay');
  if (overlay) overlay.style.display = 'none';
  guestNoticeVisible = false;
  maybeShowNextGuestNotice();
}

async function loadGuestNotices() {
  const params = new URLSearchParams({
    audience: 'guest',
    clientKey: getGuestNoticeClientKey()
  });
  const profile = getGuestProfile();
  if (profile?.email) params.set('guestEmail', profile.email);
  try {
    const response = await fetch(`${FM_PUBLIC_NOTICE_URL}?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return;
    guestNoticeQueue = Array.isArray(data.notices) ? data.notices : [];
    maybeShowNextGuestNotice();
  } catch (error) {
    console.warn('[guest-notice] load failed', error);
  }
}

function showGuestProfileModal(reason = 'favorites') {
  if (pendingGuestProfileResolve) return new Promise((resolve) => { pendingGuestProfileResolve = resolve; });
  let modal = document.getElementById('guest-profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'guest-profile-modal';
    modal.className = 'guest-profile-modal';
    modal.hidden = true;
    modal.innerHTML = `<div class="guest-profile-card" role="dialog" aria-modal="true" aria-labelledby="guest-profile-title">
      <button class="guest-profile-close" type="button" aria-label="Close">×</button>
      <div class="guest-profile-icon">★</div>
      <h2 id="guest-profile-title">Remember your favorites</h2>
      <p class="guest-profile-copy">Save your info once so First Monday can remember your favorite vendors, parking spot, and contest entries.</p>
      <form id="guest-profile-form">
        <label>Name<input id="guest-profile-name" name="name" autocomplete="name" placeholder="First and last name"></label>
        <label>Email<input id="guest-profile-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
        <label>Phone <span>optional</span><input id="guest-profile-phone" name="phone" type="tel" autocomplete="tel" placeholder="(555) 555-5555"></label>
        <button class="guest-profile-submit" type="submit">Save my profile</button>
        <button class="guest-profile-skip" type="button">Not now</button>
      </form>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.classList.contains('guest-profile-close') || event.target.classList.contains('guest-profile-skip')) {
        closeGuestProfileModal(null);
      }
    });
    modal.querySelector('#guest-profile-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const emailInput = form.querySelector('#guest-profile-email');
      if (!emailInput.checkValidity()) { emailInput.reportValidity(); return; }
      const profile = saveGuestProfile({
        name: form.querySelector('#guest-profile-name').value,
        email: emailInput.value,
        phone: form.querySelector('#guest-profile-phone').value
      });
      closeGuestProfileModal(profile);
      hydrateGuestPreferences(profile, { mergeLocal: true });
      loadGuestNotices();
    });
  }
  const title = modal.querySelector('#guest-profile-title');
  const copy = modal.querySelector('.guest-profile-copy');
  const icon = modal.querySelector('.guest-profile-icon');
  if (reason === 'parking') {
    icon.textContent = 'P';
    title.textContent = 'Remember your parking spot';
    copy.textContent = 'Create a quick save profile so First Monday can remember your parking spot, favorite vendors, and contest entries.';
  } else if (reason === 'recover-favorites') {
    icon.textContent = '★';
    title.textContent = 'Recover your favorites';
    copy.textContent = 'Enter the same email you used before and First Monday will bring back your saved favorite vendors and parking spot.';
  } else {
    icon.textContent = '★';
    title.textContent = 'Remember your favorites';
    copy.textContent = 'Save your info once so First Monday can remember your favorite vendors, parking spot, and contest entries.';
  }
  modal.hidden = false;
  document.body.classList.add('guest-profile-open');
  setTimeout(() => modal.querySelector('#guest-profile-email')?.focus(), 30);
  return new Promise((resolve) => { pendingGuestProfileResolve = resolve; });
}

function closeGuestProfileModal(profile) {
  const modal = document.getElementById('guest-profile-modal');
  if (modal) modal.hidden = true;
  document.body.classList.remove('guest-profile-open');
  if (pendingGuestProfileResolve) {
    const resolve = pendingGuestProfileResolve;
    pendingGuestProfileResolve = null;
    resolve(profile);
  }
}

async function hydrateGuestPreferences(profile = getGuestProfile(), opts = {}) {
  profile = normalizeGuestProfile(profile);
  if (!profile) return;
  try {
    const res = await fetch(`/api/guest/preferences?email=${encodeURIComponent(profile.email)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data || !data.ok) return;
    const serverFavs = Array.isArray(data.favorites) ? data.favorites.map(String) : [];
    const localFavs = getFavorites();
    const mergedFavs = opts.mergeLocal ? [...new Set([...serverFavs, ...localFavs])] : (serverFavs.length ? serverFavs : localFavs);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(mergedFavs));
    if (data.parking) localStorage.setItem(PARKING_KEY, JSON.stringify(data.parking));
    if (data.profile) saveGuestProfile({ ...profile, ...data.profile });
    if (opts.mergeLocal) {
      persistGuestFavorites(mergedFavs);
      const parking = getSavedParking();
      if (parking) persistGuestParking(parking);
    }
    const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    if (typeof renderOverview === 'function') renderOverview(q);
    if (map && data.parking) showParkingMarker(data.parking.lng, data.parking.lat);
    loadGuestNotices();
  } catch (err) {
    console.warn('[guest-profile] preference hydrate failed', err);
  }
}

async function persistGuestFavorites(favorites = getFavorites()) {
  const profile = getGuestProfile();
  if (!profile) return;
  try {
    await fetch('/api/guest/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: profile.email, name: profile.name, phone: profile.phone, favorites })
    });
  } catch (err) {
    console.warn('[guest-profile] favorite sync failed', err);
  }
}

async function persistGuestParking(parking = getSavedParking()) {
  const profile = getGuestProfile();
  if (!profile) return;
  try {
    await fetch('/api/guest/parking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: profile.email, name: profile.name, phone: profile.phone, parking: parking || null })
    });
  } catch (err) {
    console.warn('[guest-profile] parking sync failed', err);
  }
}


function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
  } catch { return []; }
}

function isFavorite(locationId) {
  return getFavorites().includes(String(locationId));
}

function toggleFavorite(locationId) {
  const id = String(locationId);
  const favs = getFavorites();
  const idx = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(id);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  return idx < 0; // returns true if now favorited
}

// ── Save My Car (localStorage) ────────────────────────────────────────
const PARKING_KEY = 'thefairmap_parking';
const ROUTE_SOURCE_ID = 'guest-route';
const ROUTE_POINT_SOURCE_ID = 'guest-route-points';
const ROUTE_LAYER_CASING_ID = 'guest-route-casing';
const ROUTE_LAYER_ID = 'guest-route-line';
const ROUTE_POINT_LAYER_ID = 'guest-route-points';
let parkingMarker = null;
let locationAccuracyMarker = null;
let locationStatusTimer = null;

function showLocationStatus(message) {
  let el = document.getElementById('location-status-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'location-status-toast';
    el.className = 'location-status-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(locationStatusTimer);
  locationStatusTimer = setTimeout(() => el.classList.remove('is-visible'), 4200);
}

function showLocationAccuracy(lng, lat, accuracy) {
  if (!map || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
  if (locationAccuracyMarker) locationAccuracyMarker.remove();
  const el = document.createElement('div');
  const diameter = Math.max(34, Math.min(220, (Number(accuracy) || 40) * 1.2));
  el.className = 'location-accuracy-ring';
  el.style.width = `${diameter}px`;
  el.style.height = `${diameter}px`;
  el.title = `GPS accuracy about ${Math.round(Number(accuracy) || 0)} meters`;
  locationAccuracyMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function formatRouteDistance(meters) {
  const safeMeters = Math.max(0, Number(meters) || 0);
  const feet = safeMeters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  const miles = safeMeters / 1609.344;
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

function formatRouteEta(minutes) {
  const mins = Math.max(1, Math.round(Number(minutes) || 0));
  return `${mins} min walk`;
}

function haversineMeters(a, b) {
  const [lng1, lat1] = a.map(Number);
  const [lng2, lat2] = b.map(Number);
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const aTerm = sinLat * sinLat
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(aTerm), Math.sqrt(1 - aTerm));
  return earthRadius * c;
}

function pathDistanceMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += haversineMeters(coords[i - 1], coords[i]);
  }
  return total;
}

function buildApproxWalkingRoute(origin, destination) {
  const start = [Number(origin[0]), Number(origin[1])];
  const end = [Number(destination[0]), Number(destination[1])];
  const lngDelta = Math.abs(end[0] - start[0]);
  const latDelta = Math.abs(end[1] - start[1]);
  const elbow = lngDelta >= latDelta
    ? [end[0], start[1]]
    : [start[0], end[1]];
  const coords = [start];
  if (haversineMeters(start, elbow) > 6) coords.push(elbow);
  coords.push(end);
  return coords;
}

function ensureRouteLayers() {
  if (!map) return;

  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection()
    });
  }
  if (!map.getSource(ROUTE_POINT_SOURCE_ID)) {
    map.addSource(ROUTE_POINT_SOURCE_ID, {
      type: 'geojson',
      data: emptyFeatureCollection()
    });
  }
  if (!map.getLayer(ROUTE_LAYER_CASING_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_CASING_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': 'rgba(17,24,39,0.28)',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          15, 8,
          18, 12,
          20, 16
        ],
        'line-opacity': 0.95
      }
    });
  }
  if (!map.getLayer(ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#16a34a',
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          15, 4,
          18, 6,
          20, 8
        ],
        'line-dasharray': [1.1, 0.9],
        'line-opacity': 0.98
      }
    });
  }
  if (!map.getLayer(ROUTE_POINT_LAYER_ID)) {
    map.addLayer({
      id: ROUTE_POINT_LAYER_ID,
      type: 'circle',
      source: ROUTE_POINT_SOURCE_ID,
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', 'kind'], 'start'],
          ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 8, 21, 10],
          ['interpolate', ['linear'], ['zoom'], 15, 7, 19, 9, 21, 11]
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'kind'], 'start'],
          '#2563eb',
          '#16a34a'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
        'circle-opacity': 0.96
      }
    });
  }
}

function clearActiveRoute(refreshDetail = false) {
  appState.activeRoute = null;
  if (map?.getSource(ROUTE_SOURCE_ID)) map.getSource(ROUTE_SOURCE_ID).setData(emptyFeatureCollection());
  if (map?.getSource(ROUTE_POINT_SOURCE_ID)) map.getSource(ROUTE_POINT_SOURCE_ID).setData(emptyFeatureCollection());
  if (refreshDetail && appState.selectedLocationId) {
    const selected = appState.locations.find((loc) => String(loc.id) === String(appState.selectedLocationId));
    if (selected) openLocation(selected, true);
  }
}

async function routeToLocation(locationId) {
  const location = appState.locations.find((loc) => String(loc.id) === String(locationId));
  if (!location || !map) return;

  let origin;
  let originLabel = 'your location';
  let usedParkingFallback = false;

  try {
    showLocationStatus('Building your walking path… getting the best GPS fix first.');
    const pos = await getBestGeolocation({ timeoutMs: 10000, targetAccuracy: 18 });
    origin = [Number(pos.coords.longitude), Number(pos.coords.latitude)];
    showLocationAccuracy(origin[0], origin[1], Number(pos.coords.accuracy || 0));
  } catch (error) {
    const savedParking = getSavedParking();
    if (!savedParking) {
      showLocationStatus('Turn on location access or save your parking spot first to draw an in-map booth path.');
      return;
    }
    origin = [Number(savedParking.lng), Number(savedParking.lat)];
    originLabel = 'your saved parking spot';
    usedParkingFallback = true;
    showParkingMarker(savedParking.lng, savedParking.lat);
  }

  const destination = [Number(location.lng), Number(location.lat)];
  const routeCoords = buildApproxWalkingRoute(origin, destination);
  const distanceMeters = pathDistanceMeters(routeCoords);
  const etaMinutes = Math.max(1, Math.round(distanceMeters / 80));

  ensureRouteLayers();
  map.getSource(ROUTE_SOURCE_ID)?.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: routeCoords
      },
      properties: {
        locationId: String(location.id)
      }
    }]
  });
  map.getSource(ROUTE_POINT_SOURCE_ID)?.setData({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: origin },
        properties: { kind: 'start', label: originLabel }
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: destination },
        properties: { kind: 'end', label: location.name }
      }
    ]
  });

  appState.activeRoute = {
    locationId: String(location.id),
    locationName: location.name,
    originLabel,
    distanceMeters,
    etaMinutes,
    origin,
    destination,
    routeCoords
  };

  const bounds = new maplibregl.LngLatBounds();
  routeCoords.forEach((coord) => bounds.extend(coord));
  map.fitBounds(bounds, {
    padding: { top: 110, right: 48, bottom: 170, left: 48 },
    duration: 900,
    maxZoom: 18.4
  });

  openLocation(location, false);
  showLocationStatus(`${formatRouteEta(etaMinutes)} to ${location.name} from ${originLabel}. Path is approximate on the First Monday grounds.${usedParkingFallback ? ' Using saved parking because live GPS was unavailable.' : ''}`);
}

function getBestGeolocation({ timeoutMs = 11000, targetAccuracy = 20, status = true } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS is not available on this device.'));
    let best = null;
    let settled = false;
    let watchId = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (best) return resolve(best);
      reject(new Error('Could not get your location. Please enable precise location and try again.'));
    };
    const onPosition = (pos) => {
      const acc = Number(pos.coords.accuracy || Infinity);
      if (!best || acc < Number(best.coords.accuracy || Infinity)) {
        best = pos;
        if (status) showLocationStatus(`Improving GPS accuracy… best so far ~${Math.round(acc)}m`);
      }
      if (acc <= targetAccuracy) finish();
    };
    watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: timeoutMs
    });
    setTimeout(finish, timeoutMs);
  });
}

async function improveUserLocation() {
  try {
    showLocationStatus('Getting best GPS fix… step outside or pause a moment for best accuracy.');
    const pos = await getBestGeolocation({ timeoutMs: 12000, targetAccuracy: 15 });
    const { longitude, latitude, accuracy } = pos.coords;
    showLocationAccuracy(longitude, latitude, accuracy);
    map.flyTo({ center: [longitude, latitude], zoom: accuracy <= 25 ? 19 : 18 });
    showLocationStatus(accuracy > 25 ? `GPS accuracy is about ${Math.round(accuracy)}m — move outdoors for a tighter fix.` : `GPS accuracy improved to about ${Math.round(accuracy)}m.`);
  } catch (err) {
    alert(err.message || 'Could not get your location. Please enable precise location and try again.');
  }
}

function addImproveLocationControl() {
  const container = document.createElement('div');
  container.className = 'maplibregl-ctrl maplibregl-ctrl-group improve-location-control';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Improve GPS accuracy';
  btn.setAttribute('aria-label', 'Improve GPS accuracy');
  btn.textContent = '◎';
  btn.addEventListener('click', improveUserLocation);
  container.appendChild(btn);
  map.addControl({ onAdd: () => container, onRemove: () => container.remove() }, 'top-right');
}

function getSavedParking() {
  try {
    return JSON.parse(localStorage.getItem(PARKING_KEY));
  } catch { return null; }
}

function saveParking(lng, lat, accuracy = null) {
  const data = { lng, lat, accuracy, time: Date.now() };
  localStorage.setItem(PARKING_KEY, JSON.stringify(data));
  return data;
}

function clearParking() {
  localStorage.removeItem(PARKING_KEY);
  if (parkingMarker) {
    parkingMarker.remove();
    parkingMarker = null;
  }
  // Refresh overview to remove from favorites
  const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
  if (typeof renderOverview === 'function') renderOverview(q);
  persistGuestParking(null);
}

function showParkingMarker(lng, lat) {
  if (parkingMarker) parkingMarker.remove();
  const el = document.createElement('div');
  el.className = 'parking-marker';
  el.innerHTML = '<svg viewBox="0 0 40 40" width="42" height="42"><circle cx="20" cy="20" r="18" fill="#2563eb" stroke="#fff" stroke-width="2.5"/><path fill="#fff" d="M28 18h-1.5l-2.1-4.5c-.3-.6-.9-1-1.6-1h-5.6c-.7 0-1.3.4-1.6 1L13.5 18H12c-.6 0-1 .4-1 1v5c0 .6.4 1 1 1h1c0 1.1.9 2 2 2s2-.9 2-2h6c0 1.1.9 2 2 2s2-.9 2-2h1c.6 0 1-.4 1-1v-5c0-.6-.4-1-1-1zm-11.3-3.5h6.6l1.4 3h-9.4l1.4-3zM15 24.5c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1zm10 0c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z"/></svg>';
  parkingMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([lng, lat])
    .setPopup(new maplibregl.Popup({ offset: 20, closeButton: false })
      .setHTML(`<div class="parking-popup"><strong>My Car</strong><br><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Get Directions</a> · <button onclick="clearParking();document.querySelector('.parking-popup')?.closest('.maplibregl-popup')?.remove();" style="border:0;background:none;color:#dc2626;cursor:pointer;font-size:13px;text-decoration:underline;">Remove</button></div>`))
    .addTo(map);
}

async function promptSaveParking() {
  const profile = await ensureGuestProfile('parking');
  if (!profile) return;
  const existing = getSavedParking();
  if (existing) {
    // Show existing parking location and offer to update
    map.flyTo({ center: [existing.lng, existing.lat], zoom: 18 });
    showParkingMarker(existing.lng, existing.lat);
    parkingMarker.togglePopup();
    return;
  }
  // Get current GPS position
  if (!navigator.geolocation) {
    alert('GPS is not available on this device.');
    return;
  }
  try {
    showLocationStatus('Saving parking… getting the best GPS fix first.');
    const pos = await getBestGeolocation({ timeoutMs: 12000, targetAccuracy: 15 });
    const { longitude, latitude, accuracy } = pos.coords;
    const saved = saveParking(longitude, latitude, accuracy);
    persistGuestParking(saved);
    showParkingMarker(longitude, latitude);
    showLocationAccuracy(longitude, latitude, accuracy);
    map.flyTo({ center: [longitude, latitude], zoom: accuracy <= 25 ? 19 : 18 });
    parkingMarker.togglePopup();
    showLocationStatus(accuracy > 25 ? `Parking saved, but GPS accuracy is about ${Math.round(accuracy)}m.` : `Parking saved with about ${Math.round(accuracy)}m GPS accuracy.`);
    // Refresh overview to show in favorites
    const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
    renderOverview(q);
  } catch (err) {
    alert(err.message || 'Could not get your location. Please enable precise location and try again.');
  }
}

// MapTiler custom style (shopper view flattens 3D buildings / pitch after load)
const MAPTILER_CUSTOM_STYLE = 'https://api.maptiler.com/maps/daff07a7-1b27-4d4e-bdc0-c18601af5067/style.json';
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
const BEEKINGS_LOCATION_ID = '758aad31-099f-4ece-bee7-4b22eb202334';
const DEFAULT_CENTER = [-95.86486, 32.5625]; // First Monday grounds midpoint
const DEFAULT_ZOOM = 15.25;
const DEFAULT_PITCH = 0;
const DEFAULT_BEARING = 0;
const SHOPPER_OVERVIEW_MAX_ZOOM = 16;
const SOURCE_ID = 'locations';
const LAYER_MARKERS = 'location-markers';
const LAYER_ICONS = 'location-icons';
const LAYER_CLUSTERS = 'location-clusters';
const LAYER_CLUSTER_COUNT = 'location-cluster-count';
const LAYER_SELECTED = 'location-selected';
const LAYER_HOVER = 'location-hover';
const MAP_BRAND_OVERLAY_ID = 'map-brand-overlay';

// Spec: uiLayout.categories — fallback colors by marker shape
const SHAPE_FALLBACK_COLORS = { circle: '#7a7a7a', pin: '#4a4a4a', none: '#999999' };

// Group icon: colored circle + white SVG illustration (matches MapMe style)
function makeGroupIcon(bgColor, svgPath) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="36" height="36">
    <circle cx="20" cy="20" r="20" fill="${bgColor}"/>
    <g transform="translate(8,8)">${svgPath}</g>
  </svg>`;
}

const CATEGORY_GROUP_DEFINITIONS = [
  {
    id: 'favorites', label: 'My Favorites',
    icon: makeGroupIcon('#f5a623', '<path fill="#fff" d="m12 2 2.9 6.1L22 9.2l-5 4.8 1.2 7-6.2-3.4L5.8 21 7 14 2 9.2l7.1-1.1L12 2Z"/>')
  },
  {
    id: 'amenities', label: 'Market Amenities',
    icon: makeGroupIcon('#4a90d9', '<path fill="#fff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/>')
  },
  {
    id: 'food-drink', label: 'Food & Drink',
    icon: makeGroupIcon('#e8702a', '<path fill="#fff" d="M7 2a1 1 0 0 1 1 1v5a3 3 0 0 1-2 2.83V22H4V10.83A3 3 0 0 1 2 8V3a1 1 0 1 1 2 0v5a1 1 0 1 0 2 0V3a1 1 0 0 1 1-1Zm9 0a4 4 0 0 1 4 4v16h-2v-6h-4v6h-2V6a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v8h4V6a2 2 0 0 0-2-2Z"/>')
  },
  {
    id: 'shop-by-type', label: 'Shop by Product Type',
    icon: makeGroupIcon('#d0021b', '<path fill="#fff" d="M6 2h12l2 3H4L6 2ZM2 7h20l-2 14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L2 7Zm10 3a4 4 0 0 0-4 4 4 4 0 0 0 4 4 4 4 0 0 0 4-4 4 4 0 0 0-4-4Zm0 2a2 2 0 0 1 2 2 2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2Z"/>')
  },
  {
    id: 'entertainment-rentals', label: 'Entertainment & Rentals',
    icon: makeGroupIcon('#9b59b6', '<path fill="#fff" d="M9 18.5A3.5 3.5 0 1 1 5.5 15H7V6.2L17 4v10.5A3.5 3.5 0 1 1 15 18v-8.4l-6 1.3v7.6Z"/>')
  }
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
  venueOverlayConfig: null,
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
  lastSearchFitSignature: '',
  shopperOverviewFitted: false,
  sidebarView: 'categories',
  selectedCategoryId: null,
  stallDebugData: null,
  stallDebugLoading: false,
  activeRoute: null
};

const ICON_SVGS = {
  fork: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  knife: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  kid: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  dress: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAAqo0jMgAAAAd0SU1FB+oFAQYlJNsqMtUAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDY6Mzc6MzYrMDA6MDDYC7AlAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA2OjM3OjM2KzAwOjAwqVYImQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNjozNzozNiswMDowMP5DKUYAACJ5SURBVHja7d15nFXlfcfxz7nbDDCCCgqIEBBFFIhGqSYqalVMJVpbbeIaFSRGYzTuNjaNNa2pKwaJJirRxOKS+mrSVuPrlRjTJi6JqTE2oqIRlyhRolhAhOFuT/+YO3fu7Hc5z3nO8n3zz3Dnzp3fec5zvvOc7TkgIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIhIpBoPJmV3NUlNrqdnV5AzGdXkiYo/p+neuyZtirwAomrw5t+u7IhJTBoM5r8/G3xMC5ykARGLMpMzFpmAGUzAXm5TrGkXECoNJmRfNUF40KY0BRGLJYK43nUMGQKe5XgGQJBrwJYYBmE3bkG9qYzY6DpAgCoAkGU/HsO/pYLzrMkXEdwZzs6nHzRoBJIdGAElS39pWn0gQrWyRBFMAiCSYAkAkwRQAIgmmABBJMAWASIIpAEQSTAEgkmAKAJEEUwCIJJgCQCTBFAAiCaYAEEkwBYBIgikARBIs47oA6THQRBye66K0TLGmAAiF6mYykvbqfzw+oGCI7gZTWZAs29QsUyebTeVLcU8B4Fx1M5lGniv5awp0v/J3PMQfMKaljcUM+OXQP9Czvbb4ez2mcDRX1yzTD7mKHK9FO9pEfGC6/+1rDjbnmq2m05T6PKhjozmu+af1VD/fM/PMoeYA88O65gT8oTnAHGrmGa/751v47ceZjX0eRFIynWarOdccbPZt7fPFD4pgJ6qdfgYHYfhHJg361k0s5l+9hraSmjfvzT4UGcu1ZBssscDlrCPDMzzb/VJjncV4fIblQ8xDvIa/x+NxXm7m08UfavXAVTbPdi4ixaEcPuwPvMCselZUr4w4n7EYivwlf9Ziuf/Df5LBYx0397xYZzXPs+ewb3yU/6bMEjrr+1zxl1o8QNVN9Dw+TjvH1fljH3AVNw6+omo2/D24gjKQ4dMN/8UfToEHKAIpvs6L3S8OWdXFXMk2dX76D+jkVywb7lPFb2pr66obaI4SB/B1iuzNtg19xKMc0bOqajZ4jxxdg/WjKWAYy5wAFug51uGR5aHKjkW+p6ReNf60jtFNrfU8S4YreJI0+d6fJ7aohS2qObnXQZZ7mMQoJjbxQUX+iatq/t/OaAyGSdxDDsMkRjlYvA9Zg0eeU1iDh8fGrmF8xZV8palzTG/zIWs4hQKb2Nz1kjqpPToNaEll408xkwLn8jnyjGm6J2cYB8A0RmHIcxoXkgfSjHa4iKOYAcAvKAE5buJucnh8yGvAuCb71kRgOivJcQe3kGUVZZ0wtEftakFl49+HcUzmm2RItXzJ9YPcRI4lzKQMPnyeDeVKbau4iDwXcowPn1fki7zJezwD6qw2qE19Vtn453AgF7Gb62pi4vcs4QmeA3VYv6k9fWUAJnEOf84BrmuJmSf5L77FGnVZf6k1fWQAdmAFR7quJKZ+wqm8q07rJ7WljwyM5EEOc11HjP2MY9isTuufMB5MirIJ7O26hFjbmwmuS4gXBYBvDMAKtnddR6xtzz2kXRcRJwoAP31iiJt6xB/tlHT/oH8UAH66kimuS4i9CRzruoQ4UQD4qeS6gASYwLmuS4gTXQrctJqBaFeMll1XVHfhBkixjB9X1n+B0/kMZbxInBUqgOnT4lEoO5zUcg2r2fBztGHYkbsZARh2ZYzr6gZVYjMe8CGn8j6Q4hXWV787nsmU2Z4VjAIMI0N8qG0Dr+ABWziNP+GxtfveQXXnxqnF6laz4e9EBshzMaeTJ8N417UNaS1byfIIl5IFyrzd8y2v75JNJAUUuJ75FGgL/ZIVyfE9biQHFPlj3yWT4aidhlWzeWzHTMrkuJNJGAxtId6FKvDbSulf4AXSFNna882BVnuvY+ttZCixJ7dW3v4x3ycY8U+RrXh4rGFRZSzwnG4krpdaaBC9NoeD2IkyRY7kHNd11eFpVpPhdS5rbR+51zGO65hKkenMdb1wdfkaz5Lljzze85I6+sDULv1UO/4IziYDGM5lquuqhlXmVrYAab7bdd+cfyu32iJzOIMSMIIvROD80evcggcU+TZbul9Uh+9N7VFV8xfvM8ynwLac5LqmuvyYB8jSyXd7XrKxWnuNic6gHShyNvu6Xvw63Md6PDLcx8+6XlC375bglqiZyK7riHc732IcUOJj7OS6uiELLwFlLuBVPNK8yKs9ixLEr68xm49QZBe+QQpIh7w/vcJLpHmPcyqTl5W6FybcZduU2CU3AB1kKDCPJRSBdB2TWLv0IQUgy6NcThbDKord33KzGqtRkGEmHgWu5fBKjS7mKKzfC5SADBfxGFmKbEruhpDI5a503HHcz94UaQ/x2ftai/h3snhsYWP3S2FYfTUjgtGMwFDgr7jTdVV12UAnGZ7lRN6DcLRm0MJ7GssaAzCW3fm7Bqetdm0D/9f9ZZi6as1U4Bsr0bTBdU11GsMY4HC+x9W8xLrWnsEYTeE/lmvDWK7lCRa4LqNBBQAvtNfr1lRWaO2TAreAJ7iWsa7LcCGZATCHM12X0ISTQn5dXrfxETl70tuZgTxUJXSSGAATucR1CU05KQJXIwBMjWQAwCVNPbQl4pIYABMiN/jvYigT8odpG4ByyIsczIIkTjeWxAD4gesCmubyOUBxq3Ig0e0ZTQvn8SSrTDT/PgG8zVz+GOZVZmAnno7uUNoLc+NakcQRQHSNjsCcQ6UIjwASSAEQJRmOC/mVG+GvUHpJ3JDH0i7Ay9xFGo9zLR9IWsuu3iarv6ElpoNXLJ+sfIdbMJRYWHk2sa+StwugtG7NN/glGVK8ypMAHG85AAqY8F6vZsBYvwjoHf4JgF+wC2WKfIILXC93lCUxAD7LXU0vd5ECHile4RxKpPhdz2WvHiZtfZdqAss4M7Sn2TyWWT+VliLtlQw8WYncH/MDyqT5FrtSxpBtYd0uDLS1QiGJAfBL3mfHhn/qXcrkWMbttAFbWdP9jUD/HmfYK6xjAAOGvYLpUTX3H2zgMQCOrKyXsziPPCl2aPhD3+eXQbVVeCQxAFZzAvfV+ZfqA1aTAjZyMhvw2OJ8Btp2pvK6m189rKm0B/sLa4KgO5CvZgmGMdzLaKDMdLap66Pe4SRWB1t9GITxT4llBmA+dw35GK/f8DYpMjzKdZXpQqon4AZvMpPmGT5qfQG+z4nhW3EG4H5OsP6Lfsc+3qAnQ2v2jbrX2mUcTpEyE4ecu2gNC3kkfK1qXwJHAB4GHuHz/CXH97sDbD33AimWsqr6/rCde9+T/XnKdRED2N/9hCo1G3AJwMB1XAfATL5EGTiZbfv80Dr+jf9M5uafyACoRMCP+BGPMpsrKn8r/oVnyLKGe3ve1YQg2nMOJ/BUuI4DGIATArmfrqEWrtlFWFWZ0fkJJlFgHz4LQImvs5J/rX1vsiRzqYHqcPEYskCKn/Nu1wvNN4nxOIa7A5hf6HU+z0/CtOoMHMltAdytuIHTeNBr+ixI9Qd34BDKQIEHIdGbQZKZPv98+LyR5m0ThEv8qNfXdrwkkOV+24z0ZT35ut6jLNGXAnt9/vkgG9Afk69ySFhuDTYAh/DVQH6Z58cTiiys98hKdABE2DbsDWGIgEoFe9d5sk1CJpEHAWPhRkrc3nNVgkM5zuJG10VIczQCiKo019DhuggAOrgmxA8TlyEpAKIrx+U0f0DcFwY8LifnuimkWdoFiK4sl5LmEndXBBiA67ko4cfRIk0jgCjzOIR2V4cCDUA7h2jzjzIFQLTN5XZGuogAAzCS25nrugmkFQoAv/lwnrohn2UZHUFHQOXRqssqF9QGJ+jWjT0FgL/yPEw54N+5iCVsE2QEGIBtWMKigJe0zMOhOPEpMhCDwUw2mwO5KLa35WZUUBe1GgxmlFnuYCk3m8lJv3TXbzoL4CMPE9zFwL2dSYaz6Qzot7VzC6c7WEqPrG7c8ZcCIC5OJ8Ni02l3A6kc+V/OKa4XV/yhYwDxcQrL7Z4U1OYfPwqAODmFb9s7KVg58fdtbf5xogCIl9NZaueMQOXI/1In+/5ijQIgbhZzo9/XBZju8/43stj14om/dBAwfj5HivPY4us9AikuYC9Oc71o4jcFgP/cn6c6kx35HX9vjB+lGPC4hktdLxRhaFmRoRhM1pzj4BKZ/krmBuO1dtlMZc48z9xgSq4XxxhjzDkmq8uA/KURgN8K/NZ1CQCkuJASX6ZsaO5PpwHIMoq/5cKQHCv6rfVHjyaOAsBXHiY8bZriMvL8C69RaPx4QOUv7ee4llxINn/IaC/Ab2FZtWLHFaxs4cj9OdxMh+b7iTMFQLylyLKML9LQ/PeV936RZZrrL+7CMlwVe9LcwAye4p76dgQMwCnsz1na/ONPAZAEbZzHqVBPBFQ2/2Vs57poCYJ2AZJiO77JCQzxMKzqd07gm9r8k0IjAP9tZX2/R1CHwbbcQZGf894Q7xnHIdwR0qf8rGer6xJEhmEwmEWur5gZ1GbztjlooDGAwWAOMm87mc+oPos0G5D/tAtgQ1Az8zRuBBN4gEP73ixkAA7lASYwwnWJgwpvq0aYAsBnEbhQZQIrOKI2AgzAEaxgguvShhOB1o0YBUASTeJO5ndHgAGYz51Mcl2WBE8BkEyT+Q6HVy/5OZzvMNl1SeKCAsCGKIxUJ3M38wCYx92R2Pyj0KqRo9OANnzAZka6LmJYO/EAxwMPMN51KXXYzAeuS4gjparvDMBVfNV1HXXpBNpdF1GXr3Gluqv/NALwnYchMg+wisbGD5DX5m+DjgGIJJgCQCTBFAAiCaYAsEO7q35Ti1qhALBjne5c89VW1rkuIZ6UqxYYgO/qIVo++h5nqLPaoBGABR5AyXUVsVLS5m+HAkAkwRQAIgmmABBJMAWALdpl9ZNa0xIFgC1r9Bw73xRY47qEuFKyWmEAfsafu64jJv6Lw9RV7dAIwAoPoOy6itgoa/O3RQEgkmAKAJEEUwDYo1GrX9SS1igA7HnfdQGxoZa0RtlqiYFt+TW7ua4jBn7PfqxXR7VDIwB7NuuGIF+U2Oy6hPhSAFiiv1h+UmvaogAQSTAFgEiCKQDsMWxxXUIsbOnzLHPxkQLAngIns951EZG3npN1W5U9CgCb/qTzAC0r8SfXJcSZAsAmHbz2g1rRIgWASIIpAOzSw1dbpRa0SgFg0wYupOi6iEgrciEbXBcRZwoAm4o8pmlBWlLmMUWoTQoAazzQALZ1GR0FtEkBIJJgCgCRBFMA2OWRdV1CpGU1/rdLAWDXW9zguoRIu4G3XJcQbwoAuz7gIdclRNpDfOC6hHhTAFjkAdoFaElW5wDsUgCIJJgCwDa1cCvUepapgW37A0+6LiGynuQPrkuIOwWAbS9xm+sSIus2XnJdQtwpAKzS5cAt0WXA1ikA7FMfbpZazjoFgH2bdT9bU4p6IIh9CgD77mOp6xIiaSn3uS4h/hQAQeh0XUAkqdUCoACwTLuxrVDr2aYAEEkwBYBIgikAgrCMR1yXEDmPsMx1CUmgAAjCWta6LiFy1GaBUABY54HauXEpHQIMgjqmSIIpAIKhaUEapRYLhAIgGMt5w3UJkfIGy12XkAwKgGD8RAHQkDf4iesSkkEBEAAdBmyYDgEGRN0yKGnXBUSKWisgCoCgrNRNwXUrstJ1CUmhcVYgDLTzPLu4riMiXmUWneqaQdAIIBDqzI1SiwVDARAc7dfWSy0VGAVAUPKcz0aKFCm7LiW0yhQpspHzybsuJSk00gqIAZhJmjwXchp5UoxxXVOIbKBMjru5iRwlVqljBkXtHBDT8+VIOigznvtoYxzbu67Msfd5j62cxFpSbOqZBlQdMxhq54DVBEEbeU7ii+TJcKDruhx4giI5vsl95Nja/aI6ZLDU3g5Vw6CN69mWInOZ47qmADzH02RYz6Xdm706oTtqe+dqxgQHsIAiI7kolsfBSyxhMxke7nlaorqfa1oDoVETBCfQDhQ5j/1dV+WDp1hGBujk+90vqduFhdZEyJja/+zOJIpM55bK6dpcJNaXqZzEK3Muq8mwpvYRn1FYgCTR+gitahSkK5cQeyxnFmUMoxjpuroBbOZDPFI8z+JK8a9SolK6hJPWTMj1GhFsQwbIcxoXkQcMHXzEcYFvsAkPyLGEu8kBRT7o+bY6WLhp/URGTRSkKgcJS8zh+uo3OjggsGL+uzLM97iU56rVVK9xVLeKCq2pCDO9/7sDV5GpfD2SU3z+ZffUPKt3E1fUPrlPnSi6tO5iok8YZDiP9l4vFjmCT9b5YT/mp9UoAfDoZFnf+QzUdeJAazGGzMAvT+fj3QflhpTmV6we6BvqLPGjdZoQpsH3q2OIiIiIxJVGeoHpGYSr0QemFgqeZgQKiAEYzZc4CAym4X3yeKu2yEF8idGNH7EQCTmD6TDLjTErzXVmiZloFAPd7dL1b6JZYq4zK40xy02H2iUoGmsFxMAEXmVE5b+/4D1yPM61eNT8wUvC6qjZuLuW/XIOIs84Dq68uoVdeCcJLREGaueAGJjGs4zu9eImXiRFibP4PSkK8Z4Xp9dcSFnK7MbtpCmzBx293riRvXktji0gCWbazK/MYNaaN81ac6eZYCabySZVHRa7LtqfJe/5lzKTzWQzwdxZWeLB/Mq0ua46KRS0ATHtvMC0Id9SohMospjXSZHiNdZ2fyuKq6kmvsYzjTJlprKcDNA+zIxHr7Gn14kEINP6R8jwDBSGfR5AmlEAPIABPO7jfnJs4Uc9G1MUgqDXuOVTjCDPiZxUWab6lCmYSCxr9KmVA2HgNL7Bdk38aCdfZwuQ5vu83vNy2FZcr81+KidQAkZwBe1NfNj/cQF3h20J40mtHAgDT7Ffix/yCC+RBjI8zL/3vOxyFfba7P+KBRSBErszv8UP/jX7q2sGQa0cAAMej/k49/+b/C9pIMVKLq++2u9OP79W7gAHI3v24a9lNmWgxF5M9m0Jn2AeRp3TPrVxAAz8MxeTtfDReVZV1uEGTmZjzXdKbBr4R4Za5YOed+joddhuNPdWHmxmmEnOwnIVuJEvq3Pap4OAwZhqZfOHHB+tfv2bmsOMKV5mYb8xgcdbbB3m5GIbO/fLgTR3MaPXp+9gub2yTLX8GwRQAATAABQC+EW9N8px/K7fO9J8mSeGXOdFDuSfB5g2pC3wsWIBdCbAPgVAEGYxI/Df6Q14/P2Gun7WzmilMTOYxfOui4g/3Q0YhFNj8YSfYO3Pqa5LSAIFgGWB7QDET0G3BdunALDvSBa5LiGSFnGk6xLiTwFg3xQmuS4hkiYxxXUJ8acAsEo7AC3RToB1CgDbOpjjuoTImtNnpgDxnU60WmXgCB5xXUWEzeen6qI2aQRgkQEqD9GU5uS1E2CXAsCuCVzhuoRIu4IJrkuIN42vLDKwB8+rjVtgmMWLakB7NAKwxgCUdA6gJQVK2gmwSQFgU4rd9Pe/JR67qY/apO5pjYHtWWX9xtm4e5eZvK9uaovS1SZP7duylP5I2aQOapP2//2gVrRIAWBPhmv7PAlIGjeaazVrhT0KAEsMeMwPxdQa0ZZlPp7OA9iiALBnnOsCYkMtaY0CwJ47mO66hFiYzh2uS4gvBYA9zTwTRwailrRGAWCFAYZ9FqDUq6yrAW1RANhykuYB8M0cTnJdQlwpAGz5C93H5psJ/IXrEuJKAWCBJgLznSYHs0QBYMcIXQLkq9GMcF1CPCkA7DifT7suIVY+zfmuS4gnBYDvNFS1RS3rPwWADTP0SAvfHeng+YoJoACwYX8Oc11C7Bym5yvaoADwWWUiMPGfJgezQAFgwyjXBcSSWtUCzbbiMwP78aieaGPBJg7n1+qw/tIIwH85bf5WdJBzXUL8KAB8pWcBWaXnBPlOAeC3MSx2XUJsLWaM6xLiRrtUvjIwnZcVq5aUmcFqdVk/qav6yABktAtgTZ6MdgL8pQDwVwcraHNdRGy1sUIHWP2lAPBXminarbLGYwpp10XEiwLAX3lNBGZVWTtY/lIA+Mnjb3S9mlWj+BuNsPykxvSRSbOSma6riLlVzPZ0r4VvNALwlwaotqmFfaUA8I2BNrWndSnadCLQP+qwfrqFWa5LiL1Z3OK6hDhRAPhpvI6pWOcx3nUJcaIA8IkBKLquIhGKuhrQPwoA/8zTrHWBmME81yXEhwLAP6eyu+sSEmF3TnVdQnwoAHyhHYBAaSfANwoAv5zCKa5LSAy1tW8UAH6ZqMkqAjOGia5LiAsFgA/0MNDA6WGhPlEA+GNH5rouIVHmsqPrEuJBAeCPg3VkOlCncrDrEuJBAeAPzQIQNLW4LxQALTOA5qkJXFpHAfyga9dbZmBPHuYjrutImDdYwAvqvq3SCMAPo7T5B+4jmnvJDwqAFlVOAWo0GjSjU4F+UAC0rp2jXJeQSEfR7rqE6NNOVIsMTOYVPbbSgTy78qY6cGs0AmhdSVcBOlFAk4O2TAHQqnZuZYTrIhJpBLdqJ6BVCoBWZdhPrehEiv3IuC4i6tR1W2KgqHkAnClS1HmA1igAWrWfdgCcGcF+rkuIOh1EbYnxeJp9XFeRYM8w19MgoAUaAbRKR6JdUuu3SAHQAqNL0dwzWgWtUAC05mrmuC4h0eZwtesSok0B0JpZOhPtVLsextYaBUDTNBNgKOiWoJYoAFqxGzu7LiHxdmY31yVEmQKgFV/g465LSLyP8wXXJUSZAqAVOgkVBloLLVAANEn7nWGitdEsBUDzjmeh6xIEWMjxrkuILgVA8yayvesSBNheDwprngKgKToFGCo6Fdg0BUCzxuphYKExl7GuS4gq3Q3YFANH86DrKqTqGB5SV26GRgDN0qOpwkRro0kKgCYYUMuFS0pHAZqjcVMTDOzGw+zqug6peoUF/F6duXH6O9ackUx3XYLUmM5I1yVEkwKgYQYgr73OUCmT105AMxQAzchxlHaeQsXjKD2dqRnqxg0zMIHVGnKGzGam8466c6M0AmiGHgYWPnpQWFMUAI3LsYwO10VIHx0s005A4xQAjUvzCdKui5A+tFaaogBokIGidgBCqaAHhTVOAdC4fRnlugQZwCj2dV1C9OiwaYMMPMEBrquQAT3JgerQjdEIoHG6BCistGYapgBoiPYxw05rqDEKgEZ9RXuaobUvX3FdQtQoABo1mxGuS5BBjGC26xKiRgHQAM0EGHqaHbBBCoDGTGWy6xJkCJOZ6rqEaFEANOYsDnFdggzhEM5yXUK0KAAaoxNNYac11BAFQN20bxkVWlP1UwA04lMaYIbeWXzKdQlRogBoxER2cF2CDGMHPSisEQqAOukUYGToVGADFAD121YPA4uEuWzruoTo0M1TdTJwBI+4rkLqMp+fqmPXRyOA+mlcGRVaU3VTANRFPSpqtMbqowCon24CigqtqbppV6kuBqbzOBNc1yF1eYeDWK2uXQ+NAOqVZazrEqROY8m6LiEqFAB1qDwNULuVUWH0pMB6KQDq085CzTofGWkW0u66iGjQjlIdDIzlNbZxXYfU7QOmsU6de3gaAdQr77oAaYDWVp0UAPXpUEtFSkpPb6yPunU9stzPdq6LkAZsx/06E1APBUA9PG3+kbOdjm/VQwEwLAN5TTQVOWXyOhE4PAVAPc5gvOsSpEHjOcN1CVGgAKjHIrZ3XYI0aHsWuS4hChQAw6hcBSjRo6sB66AAGN5Icq5LkCbkGOm6hPBTAAzvGua5LkGaMI9rXJcQfgqA4Y1yXYA0SWtuWAqAIRmAousqpElFHQUYjgJgOPM40HUJ0qQDtfM2HAXAcA5jlusSpEmzOMx1CWGnABiCdgAiTzsBw1AADM3TLACRto3uCBiammcIBj7N99VGEWY4gQe0AgenEcDQstr8I83TTcFDUwCIJJgCYFAGoOS6CmlRSYcBh6IAGMoMLnFdgrToEma4LiHMFABDGa8HgkfeXM3lMBQFwCB0DUBs6FqAISgABpdhT9cliA/2JOO6hPDSSa5BGNiFlXrObAxsYTavqqMPTCOAoajXxIHW4hAUAAPSKcBY0anAQSkABjOSmzQVWCzkuEmTgw1GATCYLAerdWIhxcG6IHgw6uKD00nAuNCaHJQCYDAF7TbGhqHguoSwUgAMzOMo7TfGxkiO0rmAgalZBmTSPMcerqsQ37zIHE9ndQagEcBgNGiME63NQSgABmAgo7FRrHhkdEhnIAqAgS3VfQCxsidLXZcQTgqAgU0h7boE8VGaKa5LCCcFwMA0XowbrdEBKQD60X0AsaT7AQakABjIAma7LkF8NpsFrksIIwXAQI5lmusSxGfTONZ1CWGkAOjDgM4ax1NBOwH9KQD6S+si4FgaqTM7/SkA+jubha5LEAsWcrbrEsJHAdBfu+sCxBKt2X4UACIJpgDoRdcAxJquBehHAdDXXBa7LkEsWawnPfWlAOhrKrNclyCWzGKq6xLCRgFQQ48Diz09JqwPBUBvOXZ1XYJYtKumeu9N017UMDCXpxSKMVZmf55Wp++hzt6bp0iMNa3fPhQAIgmmAKgyoF2i+PN0GLCWAqDWjtymCIg1j9vY0XURYaIAqNXG7q5LEMt2p811CWGiAKhlKLsuQSwraw+glgKgVl6dI/YMedclhIkCoEeWM3WZSOzlOFMPC++hQ15VpoPVOkCUAH9iurfJdRFhoRFADw0Ok0E7ejUUABUGjDpGIhiMVnQ3BUCPydo3TIQsk12XEB46BlBhPB7nANdVSCCe5CBPgwBAI4Ba+vufFFrTVQoAkQRTAACVQ4CSHDoMWKEA6PY1PRA0MWbzNdclhIUCoNtHGeG6BAnICD7quoSwUAB009MAkkRru0IBIJJgCgD0PKAE0jOCKhQAXT7JPq5LkADtwyddlxAOCoAuC5juugQJ0HQWuC4hHBQAXQquC5CAaY0DCgCRRFMA6BBgMukwIKAA6DJFTwROnFlMcV1CGCgAAKYwzXUJErBpCgBQAHR5nAddlyABe5DHXZcQBgqArjlR0q6rkIClNRsOqA0AMDCB+znEdR0SmJ9zIu+o82sE0O0dVrkuQQK0indclxAOCkEADLTzHU52XYcE4l7OpFNdHzQCqPCgkzNZ4boOCcAKbf491A5VBkZxGftwtOtKxJqHeIbr+FDdvptaoqpyXdhkjqXAl9jDdT3iqxdZSpb/4E1Qt++hluilenHoPkykDBQ4ldOrFwrrZGE09Kyv77GCLJDibZ7pelFdvpZaYwC9rhEfy86UgRL7cTPlyqtpOlxXKb1sqm72Kc7n16SBFG+xruct6uz9qU2G1CsKMoytfFVmBndVxwOGEezkutIE+iNbqv23xEJerh7SXkex523q4kNR69Spz51jHm3Vr8vswbJqSxq2ZY7ramPrN2yutLThPF6sOYu1tfcqUseuj9qpZf1uKt2Nf6h5scxM/sx1jRH1P6zqdaK6wGW8W/sGdd9WqQV9NsA95ntxYu2QFPD4PONcVxoy73Fbn8bLcD//2/+N6rJ+UmtaNsikE0czvs+3isxjsetqA7Kcx8j0esVjLQ8N9FZ1ULvUvg4MEgpj+dgg38pzHBeQb+BXZH1fs6aBWfRy3M+t5Ab5rsdva4/N135DgqY2D4lhpqcaw+QGZrBq4z/Y2ecC3+JYttb5Xo+1vffVB3qLiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIgf/h/UchWey9KYkgAAAABJRU5ErkJggg==" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  shirt: '<path fill="#fff" d="M8 2h8l2 3 4 2-2 5-3-1v11H7V11l-3 1-2-5 4-2 2-3Zm1.1 2L8 5.7 5.2 7.1l.6 1.6L9 7.7V20h6V7.7l3.2 1 .6-1.6L16 5.7 14.9 4H9.1Z"/>',
  gem: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAAqo0jMgAAAAlwSFlzAAALEgAACxIB0t1+/AAAAAd0SU1FB+oFAQYkJ1s4Ui4AAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDY6MzY6MzgrMDA6MDBn9qBGAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA2OjM2OjM4KzAwOjAwFqsY+gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNjozNjozOCswMDowMEG+OSUAACkESURBVHja7d15vFdVvf/x1/cMjMqgXlTAnEJzuGqZqYlTkUNOOGt6NXECTcs0cygzBXMMzREFJbUyJ3Cobg5XUslr3e4vuU6pgIAgIoqIDGf6fn5/fDfHA5zDOed71tpr7/V9P308Sg4+1vnsz/rsz573BhEREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREZG8K4QOoHIZQIGR3BY6kqBO5DelREgIynsQVvq/Kk7kHqpCRxNUA8cxCVMphqGsB2AA1WzDl/m1ZoBGjmGyWkAYynnqkq3/EfyemtCxZEQjx/IoqBzTV9m7n+EczQNa/ZvV8ABHhw6iMqkBpMwAjuM+akNHkim13MdxzXtHkho1gFQZwIlMoHvoSDKnOxM4US0gbWoAKTKA73IbvUJHkkm9uI3vqgWkSw0gNQYwghtZN3QkmbUuNzJCLSBNagApMYBTuZ6+oSPJtL5cz6lqAelRA0hFsvpfS//QkWRef65VC0iPLrymwABO4Qat/h20iPO5R8WZBuXYs2RLdhI30S90LDnyCd/nXlCB+qb8emUAh3Et67FB6FhyZiEfcyGPqUT9Una9Sbb93+Z39AkdS059yvH8EVSm/iizniSr/348wjqhY8mxzziSp0CF6ovy6kWy+g/jMd3000XLOIxnQKXqh7LqQbL6f5PHtfo7sIxDeRZUrD7oPgBfhmn1d6QXjzMsdBCxUgNwzgD2Z7JWf2d6MZn9dXOQD2oAjhnAQTxI79CRRKU3D3KQWoB7agBOGcCh3KcLf8714T4OVQtwTQ3AIQM4ggm65deL/kzgCLUAt9QAnDGAo7hd9/x5swG3c5RagEtqAE5YqSiP5mYGhI4lagO4maPVAtzRiykdMIBDOI6hbBQ6luhtxE0YD5vuCnBCWeyy5LLfnXwhdCQVYz7f4xFQ+XadMthFBjCMiQwKHUlFmcNsruApFXBXKX9dYgD78Dvt+gcwn+OZohLuGmWvCwxgF/7Av4WOpEJ9yBG8CCrj8ukqQNmSM9EbavUP5t+YzG6gqwLlU+ssU1Jy+/K4nvcPahEH8HdMhVwe5a0syeq/D0/qnv/gPmZbPlApl0f3AZTBALZhEJO1+mdAL/6d9XhDdwaUQznrNAP4Oo+zfuhIpNlHHMpfVc6dp5OAnWQAezFJq3+mrM8k9tLJwM5TA+gUA9iXB3THf+YM4AH2VQvoLDWATkju+ruXjUNHIq3YmHsZphbQOWoAHWYA+zGewaEjkTYMZjz7qQV0hhpAByWP/Ixj09CRyFpsyji9PbAz1AA6JFn9b2ez0JFIOzbjdrWAjtN1kw4wgG9xp1b/nHiXM3haxd0RylG7DOAb3KPn/XNkNqfwXyrv9ilD7Uiu+/9Gp/5y5j1O4HkVeHuUn7UwKFBgNx7Whb8cep+jdHdge5SdNiQnkbZnMuuwYehopCwLOJRprCh1cmmN8tIGA9iWZ7Ttz7VFfMYBvK5Cb4vy0iqt/hF5n2FqAW3RfQCtMIDteVqrfxQ25mm2150BrVMDaN2O/ImBoYMQRwbyJ3ZQC2iN9ovWYADT+PfQcYhTsziSf6jcV6c9gNYM0+c9o7Mpt4YOIYvUAFozlL6hQxDnqkMHkEVqAK25nLmhQxDHlnJf6BCySA1gDQWAW1gROg5xppFfcD6/Ch1GFumsSCsM4GQGcaUaZASM87gJVOytUU5alVwwOptbQkciXfY9blWht0VbuFYl5XI7Z4WORLroLG4PHUKWqTG2yQCqOY07QkciZRvJeJpU5m3THkCbCgBNTGBU6EikTKOYoNV/7dQA1qIA0MhdnB06EinD2dxFo1b/tVMDWKtkL+AOztWN5LlinMsd2vq3Tw2gHQWAIjdzPk2hY5EOauJ8bqao1b99agDtSopoLJdQHzoW6YB6LmEsaPXvCH0evAMKgMG11PBTeoSORtZqBVdyrVb+jtIeQAcVAK5iDMtDRyJrsZwxXKXVv+O0B9BhBQxGU80eDKVn6GhkDct5kamM1urfGcpVpySXAq7mfLXOjGnkBi4ClXTn6BCgUwql8rqI6yiGjkVaKHIdFzXPj3SYGkCnFQAuYUzoOKSFMVyibX85lLOyGMBl/Dx0HALAz7hCpVweZa0syYNCP9Z+QAZcyjW6569cylqZDKCW8/lF6Egq3MXcQIMKuVzKW9kMoBvncXXoSCrYRYylXmVcPmWuC9QCAtPq32W6CtAFBYB6xnJJ6Egq0iVa/btODaBLkhZwHZeFjqTiXMZ1Wv27TvezdVEBg0bGUMt51NI9dDwVoJ56xjJGj/u6oAw6YADdKXA3x4eOJXpFbuNCitSpeF3QHoADBQzqgFnMZGM9MOxRAxM4p/SvWv1dUBadMaiiyB2cpq/QefMCe6loXdJJQGcKFIrAyNKbaMWDBv6u1d8tNQCnCgBnchd1oSOJUCO/4vzQQcRG7dQ5g2rmMSB0HJEpcgMXqmBd0x6AcwWo4p7QUUTnWq3+PqgB+NDARYwOHURURnOxVn8flFMPkoeFf8LloSOJwg3MYJwe+PVDOfUieUzoGLYrvadOynY1P2cFqFT90I1AXhQwqOd+emFcHDqaHPsFo1mhld8fnQPwJHk95TJG62Hhsl3NaJZp9fdJDcCjpAVcwbWhI8mla7lCq79vyq5nBtCDMZxHUbcId8IvuVQ7//4pv94ZwLr04ipGhI4lN37Fj/S0fxqU4RQk3xOq5VEODh1LLtzGubrslw5dBUhB8nXhBmZT1FmXdhQZz/cwrf7pUJZTYwDj+a7OBKxFExM5TWWZHmU6RWoB7dDqnzrtkKaoAHAaE/Vh0VaZVv/0KdspM4BxnBE6jsx5gtl8TwWZNp0ETFkBg1EsYRDHhY4lQyZypi77haCMpy65KNiTX3Fa6Fgy4i6+z3IVYwjKeRAGsA7Xc2boSDJha95SKYahQ4AgChh8xoUUGRU6lsBu4f9YqNU/FOU9GAPoyy8qvAUM41lQIYaiy4DBFAAWczF3hI4kmFvZn2nNj05LAMp8UAbQh+sq8rLgnfyIT0FFGJJyH1jyrOBYTg0dScomcB5LVIChKf/BGUAvbuPk0JGk6NecpZd9ZIFmIAOSl4ZM4DuhI0nJbzlVL/vIBs1BJhhALfezD+tH/ahQA4uYwok0qPSyQbOQEQbQnWoeZr+IW8AbfJUm6lR4WaHLgBlRoEChjmUcybzQsXhjvMbyQp0u+2WHGkCmFKCBqbxEY+hIvHiE41Y+CiHZoFacMQbQj1n0CR2JY408zEk0qOCyRfORKcnmcR3eo2/oWBxbzIbUgUouW/QwUGYkK/9xDKAX3UNH41x3zmMZC3igtJxqA9mgeciEZOU/lm34Pv1CR+PRJ/ySav4fj6n0skGzEFjzObHh7M0xDAwdTyrmcDZPlP5VBRiW8h9M86q/B2eynG+yZeiIUjSdZ+nJOKaW/qgyDEWZD6B51d+C62lkK3YMHVEgr/AWNVzADFAphqGspy55BPh+erAeO4eOJgP+wQJO5kNQOaZPGU+VQYFuPMQm7BQ6lkx5hXrmczT1mEoyTcp2SpLHfeA37MSWugOzFUWm809OABpApZkOZTkFyTF/FXfybTagNnQ8GdbAQv7AOZgeGEqHcuxZsvL3oparGRk6mlyoZwXjuKj0ATUVqF/Kr0fNK39fzuZHFLTt74Qx3MpiloGK1Cfl1pNk5e/OphzC9TRF/Iy/H01UcwFPMEsHAz4ps14YQDU7sTPjMGW5TEaBM5lAE6hU/VBWPUi2/idwn/LrwCje5C+lK6jimnLqWPNdfidxt3b7HSkykrn8EVSwrimfThnAoWxIT67XKT+nlnEhc3hcJeuWsulMsu0/knGsHzqWSH3EmTwCKlt3lEknkpX/ML7GKWwcOpqIvc89/E1vE3BHeXTAAL7F4exXUY/0hjKbs3kSVLwuKIddZgB7M54vho6kYrzD35nAsyrfrlMGuyTZ9d+TiWwROpYKM51TeAFUwl2j7HWBAezEzWzIkNCxVKC3+YBz+KeKuCuUu7IZwLY8oW1/QDM4hNdVxuVT5sqS7PpvzZ/ZNHQsFW4W+/MvUCmXR1krQ7L6D+FZNgkdizCHb/I2qJjLoZx1UrLyD2A9ntLqnxFz2I+PWQAq6M5SvjrFAAaxLpPZlO7KXkYYdcxiOEuYq5LuHGWrEwxgEx5lZ5S5rDHgHxzBHE1NZyhXHWYAm/E7dgsdiRNL+N/VXk1aYPfcP7/43xzPuyrrjlOmOsgAtmQiQ0NHUqa/8UGL2a7hZS5f478Zz0bNzzMX2YLtQwddhhf5LtNV2B2lPHWIAQxhPHuFjqSDljFplT9Xc3npYllLq06+rf7XQzmn9IJuAA6nV+iF6qDnOY23Vdodoyx1QLL638k+oSNpx8PMpwBUMYtr1vzrzkz2Gu3gx2xKETA24qjQC9qOKZyhFtAxylE7mq/5j2Pf0LG06Tmep4YCv+Sjz3/ocmpXaQfr80Ma2IVvh17stWbkTLWAjlCG2mHwRc7gywwLHUmrpnE3Pfkj01b+wPeENreCrTiCRhoYwQ6hk9CqKZymcwHtU37WKnnUd0roONawiIsoUs1rvFj6QboT2WKPYCjb0UQVV9M/dFJW8zzfZaZKfO2UnTYlRb4Jv2HP0LG0UGQki1jCn1f+IOQUtmgE+7Mu/bkjU189nMrxui9g7ZSbNhjA+kxkAF8LHUsLza/IztbUJY2gwL7ATtwQOp5mL3ME80qhSWuUlzYY9OOJDFz1L61bBX7Gk9Ty/6gv/TF7mvcGerEDdXyHCzLxSZRpfMhRfBI+EMkRw/raVAutyYr2e/uibWvb27pG6Z9sWxml9bMhNt7MVlhT6DTaVOub9byFosbYCoO+/Indg4awlGqmcgrL+HjlD/MzWcnq1o9+NDCRPWiid9DwX+JAFucpg2lRRtZgAH8JfM/faxxAPXUshrxOUvM2ty/d6cYfGcR6AcP5KwfxSV5z6Y/ysRoD2JC/sHWwEOaxkP2ZX/pD3ieouQ2swwY8HfTNyS8wnI/zn1G3lI1VGMBAJgU78z+LxRzOe9THNTVJG9icyfQN+BK15ziOBTHlVZwyDNvE/hroVNV0+5vtmIcTfV3ILraj/c2mBzsdeH+s2ZUuMwzbzJ4PUpgz7DnbO96Vf5UcY3vbczYjSJ6n2Gax51jKYhi2hT0XpCzn2EHxr/yrZBo7yOYEyfVztkWlZFo6zDBsS3smyMp/jw2vtJI0DBtu9wRpAs/YlpWWb1mrZPV/OvVSXGhj7YTK2favkXPsBBtrC1PP+9NqAdIs2flPe+u/zK6wkytz5V8l89jJdoUtSzn7z+hAQIDmU3/PplyA9XZGZa/8q+QfO8PqU56BZ3U6UErFN9impFx859lRKr7PGYaNSP2ZgSm2heagwhm2ib2QcuGNsiqt/qsyDDvAzk55Jr6meahohmHbpVpy59se1k1lt7rkQKDaRqY6G/+wTTUXFcywje2VFAvuR1arI/+2GIZ1t3+3C1KckVdskOajIiXbnK2tIbViu8hqVGxrk8xJjV2UYgt41QZqVipQcvZ/uhVTKrSfWLUKrX3JocBPUm0BvTUvFccKtllq96M32eXa9e+oZD/g8tSuCnxkm5seEawshtXYG6mU13KbbWO0+ndG0gLG2GxbnsocvWE1mp0KYhi2vc1LobQa7BbDqlVenVXKmt2Syjmaeba9GnTFSJ5KfzeFlf8lu1WFVT7DsFvtpRSawLulNzFI9AzDvmLveC8ps4na8e+q5GBgYgqz9Y59VXNVAQzbzf7lvZzqbbxVqaBcMKzKJqTQAp5Ru46eYdgjKRTTMltHxeSKYTU2zvuc/cv2qbwWkKUvuaVjP7ZJ4bfcRlPoBY1KI+dwm+ffsRXj+VboBRWPDMPGp7D9v7p0y6+4YhjW0270PnPjNW/RMgw7OIXTf2Osu8rINcOwHbzP3Tt2sOYuUoYdYrO9l9CV1kMl5INhfexK7/M32w6ppNmrmHMABrADm3j+NaO5ihVxfdQjQz7lKkZ7/h2bsANq4PExbLjN97z1GGM9tfX3JzkTMMbzLM6vvLc0R88w7FyvZXOzbWV9VDh+GYb1sKs9t4CP7ADNY0SsdPy/xGPJjCsd+atsfDMM62bXeW4BIzSb0UhuJz3TY7k8pMt+6UneGOD3kuAyO1wzGgnDquw7Hh8oKdovVSxpMgwr2C1e3xiwwnbTnEbAMGxXj6VSb7dr9U9bsld3uzV6bAG7V8K8Rn4Z0ACq2d7jcv6NUbrsl7ZCKeOjmECdt1+yLd1CL6d0kWHd7VSPW4l6+2X8W4msMgyb5nF2t4l/HyDyPQBgEHd5G3sZN/PD0AtYuQoAz9Do7Rd8i56hl1G6wDBskMevzs2MfwuRbYZh13r8tOjg2Gc44j0AKy3fqd6WsYmJVOnoP6QCwMUs9TR8EyPoFXoZpUyGdff48EjRLo5965APVmuXePu6Q7311yznlGE9Pd79d6EKIxsMwy701gDG6tVuOWW1dovVeSmLRjtPX/jNCivd6nWet3sCbrXa0MvoT7SHsAa1zGFDT4NvzqyIk5czBrApMz1NyAdsQkOscx3vScAq7qa/p7HPYL5W/+woAMznDE/D9+fuiNeTWFm1ve1pl/A0feYza5IHhE73NONvW3XoJfQl0s5m0I2il6FHcTdN2v5nSwGgiVc9zXmRbrE2/CgbgAE8zBAPQzcxg6JW/+wpALzMSV7uCxzCw7G+JizKBgD0Y7CXtfQcntLqn1lFfsO5HsYtMJh+oRfOjwgbgAHczw4ehv6MeaGXTtqStOV5fOZh8B24P859gAgbADCIAV7GvYzHtP3PrgLAY1zmZfABDAq9fD7E2QBuZhcPoy7kXa3+2VYAeJeFHobehZti3AeIrgEY4OVc8DzOYlLopZMOmMRZXg7VBvGl0Ism7TLsK/Y/Hq4Fj9W1/3wwDBvr5X6Ae+OrgOj2AIDz2Nn5mNN5Xrv/+VAAeJ7pHoaui+8gILIGYAArPAz8onb/c2USL3oY9avsFXrBXIusAQAHsIfzMd/kt9r+50cB4Le86XzgnTg69LK5Fl8DOIhtnI/5fzwVerGkk57i/zyM2hB6sVyLqgF4OwDoru1/vhQAunsYuCm+swARMexYm+v83O8rtoMmPW8M28FecV4Lc+3YuGohqj0AYBsGOh9zAdNCL5aUYRoLnI850MMBZlARNQBPnfkVTtcBQP4UAE7ndecD+3ngOJia0AG4YgAn8SPHw87gYN4LvWxSJh83BXcDi2iDENEeADDI+VvcG5ir7X8+FQCOcn5D0I8ZEXrJXIqpARzLGMcjGh9Q0OqfYx8x1/GxYQ29YroSEEkDMIAa55vquRwa2zFfJSlAkUOZ63jYjbxcYAwkkgYA9OKLzsespk7b/zwrQB2uX+h5aUz3A8bTAIZxufMxX9L2P/eKvOT8PYER3Q4UTwNwPSNNPMjx1IdeLOmiek5imeMxd2P90IvlSjwNwLXljNTqH4UiDzveBziXPUMvlCtRNAADnK+s3fUEQCSWc77zJ0SWx3IQEEUDAAZzitPxmriJJaEXSrquANCDHo6HPYXBoZdMmhm2r+OHPupsoF4BFgfDetplzr8dvG8c1RHLHoDrs/Xd6KEDgGgsZwJNjseM5PpQBA3AAOcXer7P+6GXS9xI3g0QzVMvbkXQAIAtudnxiE+xPPRCiUNzOd3xiMU4TgPG0QD68mXHI9bqACAqdfy34xHvYqvQC+VC7huANf+PSOsKgPMbgremdwyFl/sGAEBvx+MtdX7KSEJrYqnjEV1XnZTDsM1toeNLPAfqEmBcDMMOdFwlC23z/FdJDHsA1fR1POLi0IskHnzqeLy+zg8rAoihAXihU4AxKQAsZU7oOLInhgbg+h6AOLIiq/snI0OHkD35L/Vu7OV4c/1PPgq9UOJaAdyftI/gO0H5bwADGO/4WOxC3gi9UOKF22ovcLDzh4xSl/8GYM77sB4DjtUM/uJwtGpuZIPQi9RV+W8Arv3Rw1dlJRvecHzLeH3+rxarAazubt4JHYL4UACoDR1F1qgBrE5PAUgFyX8DiOBMrEgo+W8Av4vpMw2SM7l/ZiT/DeAbMdyQKbnUg8dDh9BV+W8AruX+vK6shdvZrWKX0AvU9UWQln7Go6FDEI8e5WehQ8gWNYBVLdBJxag1sCB0CNmiBrAGXQSMlWZ2TWoAIhVMDUCkgqkBiFQwNQCRCqYGIFLB1ABEKpgagEgFUwNYlT4hGTvN8CrUAFp6jD+FDkE8e5JHQoeQJWoALU1leugQxLPN2SZ0CFmiBtBSjW4Xjd62bBs6hCxRA5DKkvtXeLilBiCV5TfcGjqELFEDkMpyCCNCh5AlagBSWfrSM3QIWaIGIJVFr3xbhRqASAVTAxCpYGoALTVqD1EqixpASzuzSegQRNKkBtDSsRwWOgSRNKkBrKoxdAAiaVIDEKlgagAiFUwNQKSCqQGIVDA1AJEKpgYgUsHUANagewFjZQDdQ0eRLXpH6qp6hw5AvDqMqx2OZnwaeoG6Kv97AB843WRfwxGhF0g86kUPh6Ot4OuhF6ir8t8AhrLC4WjVdAu9QOKR2+M7Y3HoBeqq/DeA5Y4ntaizAFI58t8AXNuedUOHIJIWNYDV/ZQ9Q4cgkhY1gDXpCCBKBtAQOoqsUQNYU716QKQGcajT8brn/0NS+W8ABee3dpzMwNALJV58mZMcjlbkFl0FCO8TfkHR6Yj/wZahF0q8cPtZsCI3sCT0InVV/hvAZ9zluAHo+3HSMRHcVpz/BoBu3ZH2Gbh+4VtN/s8AxNEA3NPNQDHahuucjjeKOaEXqevUAFozXmcB4mIAG7Cj00GnOr0JPZAYGoA5v7q7nZ4KjM4Qfu14xBoiOAaIoQHM5EjnY+oIIDY92dzpeMvjOFUcQwMo8r7zMU09IB4GOL9SdDzTQi+XC7lvAAWABhY4Hnbj/GdGWqhiY8cjLgq9SG7EUeavcYLjESfxhdALJQ59gUmORyzEcAYgigaQ7AO41S2K2RWSA4Amah0PG0l9RNAAAPfTYTToLEA0ahnquNJfZWHohXIjlgYwn5edjlfFgTHc6CkGsA53O3797Y95NfSSuRFLA3iTy52OV8Mt9NI+QBRqOc75HmJ1LMcAUTSAAuD0ba8lp+spgyhUc43zvbnq0AvlShQNAIBpTHY6Xjd+Ss/QCyVdVsP5zr9+MTmOewAgpgYwgwccj7iCutALJV1Ww7nOG/kDzAi9WK5E0gAK4P6x4D7c4PzikaTKoMFDG+8ZyxmAaBqAl2XpxpE6DZhzVdzKAMdjTuBPoRfLnZgawOPc4njE/twTVYYq0TDnJwD/lw9CL5Q7MZX3It50PGI3dg29UFI+g2rHbwGCaG4CLommARTA/RNfUKSHDgLyyaCWB/mi42Fv5u7QS+ZSNA0AgLu4wfGIQ3hI5wHyyADuY7jzK/Yfsjz0srkUVwNo5D3Hr2koMIh+agG5tA6DPYwa1QFAVA2gAHAjtzsedkceZYPQyyZluJM9nI+5go9CL5ZbETUATw8Gw77cqn2AfDHw87r4cdwaetnciqoBAH7u0t6YzUIvlnTSZs6v/0N0BwAxNoBXnL8eDPbkp9oHyJnLPXzmfQGvhF4s1+JrAHfznx5GHcL2oRdMOsoA6j0M/ERclwAhugZQAPizhy+27MkI7QPkyC6OPwJS0iO2A4DoGgAAv3X8dqCS3XVXYD4YwPF8zfnA03k49LK5F10DKICfE4G7sZ/2AXJib/b1MOprjt84kQnRNQAATw/xHsleoRdM2mMAe7GT84Hf5qb4DgBibQCjed3DqDvyldALJmtnAN/gRA9Dz+W/Qi+dD3E2gJeZ72VcvSo805Kt/wS2cj70O1wQ4/Y/UoZtY2+ae+/ZfqYWkFmGfd1me5h3s5djnfc49wDgDT72MOog7ucb2gvIJgPYiE08DP0uJ2r7nyuGDbbpXrYFH9kusW4N8stK/+xlC73M+ZtWiHXGY90DgHl86GXc9dgItBeQQXvwGOt7GfkTCtr+54xhG9hcL9uDpTbMqtQAssMwbDP7xMtsm82zDeKd7Xj3AOAzT4dtvXiML2gfIFOqGcI6XkYu8g5LQi+eP9E2gAKYt++3dC/daa4WkAUGsB6Pevpc1xIOoy7eA4BoGwBQx+H80fErwkqqeZDhoRdPWtjD092fTUz18lyh+Gel8wB1no4MV9iRuhqQBVZtR9kKT7NcZxvEPcsR7wEUAOp5yMPLwgG6c6+Hz05LJxnAbc4//lFS5CHqdQdAblnpfgB/Zsa9dcg+w7DTbLG3GR4c+wxHvAeQdO4lzj8Y9rm+nKlTgeEYwEhuoo+nX3ALS7T9zzXDsC953AdYYmfFvo3IKsOws2yJx9n9kuY29wzrY2M8FsliO1dFEoJh53rc+TcbbX3jn9moDwESnzKa0d5G76M3BYVgAPt52/kHeILFoZfSv+gbQAFgOS94/BVDuVAtIF0GcCFDPf6Ki3lVx/+RMKynXepxZ3GpXaCjxfQYhl1gSz3OqOnNDxExDDvKa7kstx+UHkkVv5IHf39gy73O5w+sm+YyIoZV2yVeS6bOvqcW4Fuy+n/P2/2dJZdaVaXMZPTnAJo1scjr+N24kZGlZ5DEDwMoMJIbvXz4c6VG5lDU8X9kDPuOLfO63TAr2mmVs+1Im2FYlZ1mRc+z+HPNYIQMw073ettIyQirVgG5Z6XDuBHe5+8zG6HZi5Jh2Cj72HsJnaK9ANeSrf8p3ufuUxuluYuWYdgE70VkNsIKKiN3DMMKKWz9F9rZmreoGXaqpzfHtlS001VI7iSHb76P/c0e0axFzjDsu/a+91JqtJEqJjcMw0Zao/c5+8hO1YxFzzDsWe/FZFZfui9Auia57l/vfb7m28mar4pg2NH2YQotYEXp7kApX3LXn68XfrX0P5qrCmEYNjyFqwFmS+2HKqvyGYb90PM9/yUf2RGap4phGHZwCicDzT6z83WDcDmSm37Pt89SmKWFdnClzlGF3u9oUMW7Xj4kubpF/A+TuL1iU10WAxjF4XyV/in8ujlsRlHzU1Gsyva0RSlsXczMPrHTtB/QccmrPn196mt1i2xPq5xnYqTESl+TT6vIPrQ37Gi1gPYZVmXYKfZpSjPziX1d81KBkmPMPTw/WNrSpzZc+wFrk8zJ4TY7lVO0ZmZ1tkdlz0nF7vokR3yzUnzv27rcz8FARRdcW5pzcjD3sUkqR/4Ai5kFOj9ToQzDvmLzU9sHMFtmB9pGelhodcnDPhvZgd4f2W7pA/uKZqKCJbuce6dYcmYrbLHtqbJrKZmHPW1xKrf8rDTXdqns3X+o4EMAgEJp1+8jZqb4S7vThz+wlw4EVjKA7fkmf6CPp2/8te50/t5cA1KpksOAt1LdCzD7xA7S9qc5/7vbBynn3+wt27nScy9AUoK72Jupl+BcO8J2reQW0LzrPy/13L9Zar8iJIW4m72eehmavWW7VWYhJiv/UDvZZqWe9dcrNevShuS2oNcCtIA3SjeiVFJBJsu7q51rrwbI+Gu69edzOgOSMIA9uJNtU//V0/g9PXmIaRD/hCQr3g4M59vsGiCA1zmDqfHnWTot2Qt4I8A2ycxsio21LePeE0i2/FvaWJsSKMtvaOsvbUrOBfwrUHGaPWPjbUCcTSBZ+QfYeHsmWH7/pWP/1WlPaBUGsAsPsEWwEJ7jfc5gaVxTYwC9uZON2TdYEG9xYunKv3xO2ViNAXyFR9gsYBBTmcN/0BjH5CRb3J48zLeDBjKVoSr41dWEDiBrChj8L58EDWIPoBvHWhHy/KIKK91oZ0xkewp8OWgwb3O6Vv81KSOtMBjCfwY8DABoZDo1/CfnUkUj5GuqDKCGJq7iGOrZwuvHPDtiBgfwdr5yKMEYhm1hM4OdrPrccptvV1p365aXewXs838utPmpvNCzfTNtizzkTjLDMGzzTLQAs+X2qf3A+tmGVpPdNtBixa+xDa2f/cCaQicuMdM2z2bOskD7RG0wgC15ms1DRwJAHQ1U8x/8jSpmr6zmrExe88r1Bapo4mvcRxO1qT7Z17aZfIvp2clV1igvbTKArXiQfmwaOpZEI0VWcBgfUmA50z//ixDTuMo2dUt6si6P0weoysyp5Vl8wjG8pTJvmzKzFkmJ78xDGdkP+DysAm9yCgWgipnMW/lX6Uxn86o/kM0pAsY9fAnLWDXN5Gj+kV5W8km5aYcB7Mr9fDF0JG36LePpRoGpLFn5Ix/TusoWfz12ZQWn8Z3QC9+mdziRl1Xg7VF+2mUAX+cetgodSTuu5BWqqWdyyx92dYJXO3k2nG5AI1/n/NCLu1ZvcQp/VXm3TxnqAAMYyl18KXQkHVDkAj5LDg7e4C+t/SerT3o7Z8j3ZptkR38drs/FS+Te5HReVHF3hHLUIQawF+Ny0QI+9xoTqF3lJ3X8qtX1/SheYH82buXvGjiV7UIvSKe8yZk8r9LuGGWpgwxgT+5i69CRdNFNLFvjZ02M4C8cSL/QwTnwL07nBRV2RylPHZYcCNzNkNCRSBtmcw2vM0Vl3XHKVCckLWBTrmVg6FhkDe9zAs+BirozlKtOSQ6R9+IhBoSORVbxIUfpyL/zlK9OSy4LPs76oSORxGccwwL+oXLuPGWsDAawDYOYTO/QsQhLOZgpoGIuh3JWluRQYB8eoxs9QkdTwVZQz2Fa/cunrJXJAKpYj915UC0gkBUcw0t8TFGFXC7lrWzN98wM534dCqTuU1YwkkmlP6iMy6XMdUnSBI7hGvrSP3Q0FWQZ5/BroEkl3DXKXpdZ6U2iZ3A964aOpUIs4QLuVPG6kJVXN+RYAczgTmo5nu2iuJ02yz7hNX6n1d8VZdGR5GDgx/xU5wM8WsqVXAMqXFeUR4cM4MfsyOG6LuDBCibxCteoaF1SLp1K9gN+xk90cOVYE1fyc1DJuqVsOmcAlzI6dBxRuZH3uEHl6p4y6oEBjKIHg/lh6Fgi8EtmcIcu+PmhnHrQfItQb45iZ84JHU9uTeB5avg9S0Gl6oey6k3SBtZnKIcyInQ0OTSRC/io9K8qU1+UWa+SJrAeYzkpdCw5cy/n8bEK1Dfl1zsD2JCBXMbw0LHkxGSuYB4fqDz9U4ZTkOwHbEQf7mQoVcp6G4wiL3IGnzIfVJxpUI5TkjSBf6M3kxhCL2V+NcYy3uZwlvIhqDDTojynKGkC/enLn9mA9ULHkxkf08Qi9mcxi0BFmSblOmVJE+jNYJ6khl4V/3LRBSzlSN6iwGeggkyb8h2EQYFaGtmTByu4BcxnMSN5HsNUiGEo7wEZwDCuZiMGhY4ldR/wHmNKb/RREYaj3AeVHBAczdnUU2Q3+oaOyLulTKVAN37NPaACDE35D67F9zgvZheaqOGwSOelkSd5lZ+u/GOcC5kvmoPMaNEIbqAP/TkydEQOPcLHVLGAS0BFlyWai8xJGkFfLqXIdhwcOp4uepLXqGIMi0t/VMFli+Yjk5r3BrbgOPbhW6HjKdPTTOEBZpT+oFLLIs1KhiVtYDuG0Ugj57F16Ig67J/cTk+e4TVQkWWZ5ibjWpwZ2ItNKdKdm+kVOqo2LOMc6oBq3uK/Sz9SgWWb5icnWjSCYXRnMHeEjmg1I3mPOp75/AcqrTzQLOVM0ghq2B1o4JDSefWAruIJaoGXaAQVVN5ovnKoxd5AX7akCEAj4/kaTc1/U6Da2S9savErq3idE5vrporpK8/vq5jySHOWY7bqHwfSu/lHTezCvS3awZqq6d7KT5evPihQy0j+q8Vrzlfw3qr/gYoovzR3kVhjva1lw1ZW5pUaGcb9a/x0KXuwcI2fFviQutV/JCIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiKSDf8fiUmzR/uRBvwAAAAASUVORK5CYII=" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  coffeeCup: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oFAQcoJG9GJq8AAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDc6NDA6MzYrMDA6MDDOemdaAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA3OjQwOjM2KzAwOjAwvyff5gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNzo0MDozNiswMDowMOgy/jkAAAzKSURBVHja7d3bdhs3FkVRqEf+/5fVD7IdO6YksgqXA+w5nzruZIQE6yygKIV8e29Aqv+tfgDAOgIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAAQTAAgmABBMACCYAEAwAYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkA/bw3XzW5GQGAYAJAX84AWxEACCYAEEwA6M1NwEYEAIIJAP05A2xDAOjF2G9IACCYADCC08AmBACCCQAEEwD6eP/mrylJACCYAEAwAYBgAgDBBIAe3p/8M4oRAAgmANxnr9+WAEAwAYBgAsBdbgA2JgCMIw3lCQD3GPKtCQAEEwDusP9vTgAgmABwnf1/ewIAwQSAq+z/BxAArjH+RxAACCYAXGH/P4QA8DrjfwwB4FXPj//b6ofKdwSA19j9jyIAvML4H0YAeJ7xP44A8CzjfyAB4DnG/0j/rH4AbODa8PsZwAacAPiOvf9gTgB8xfAfzgmAz90ZfzcAW3AC4DF7fwQnAB4x/iGcAPivHsPvBmATAsDv7PxhBICf+g2//X8bAkBrdv5YAkDv4bf/b0QAstn5wwlArjHDb//figBksvPTWhOARCOH3/6/GQHIMnbnN/7bEYAco4/9xn9DApDBPT8PCcD55gy//X9LAnC2WTu/8d+UAJxr3rHf+G9LAM40857f+G9MAM4z9w0/4781ATjL7Hf7jf/mfCTYSYw/L3ICOMX8n/Qb/wM4AZzhhPH3y0oLCMAJ5h/9x+z+EjCdW4DdnbD3s4wTwN5O2ftXPZ94ArAz7/pzkwDsa/Yv/MwZf2eAqQRgV37fjw68Cbink/9Dn3e5mUcA9nPy8DOZWwAem3XP/9P7J/+boZwAdjNjOOz8MZwA9jJ+/Gfv/KueJ601J4C9nPu5vgZ+EQHYh8/0pzu3ALsY+30+9cbfmWAKJ4B0FUbfsC/jBLCHUd/kW2H85z5n/uAEkKrO6Bv0hZwAdtB/RIw/rTUngB30HpE6w89yTgBpao3/+43/lw4EoLq+Q7DT+DOBW4Aklcbf8JfgBFBbzzHZcfxlYjAngBR1xt9QFyIAlfUblSrjb/iLEYAENcbf8BckAHX1GpgK42/4ixKA060ef6NfmgAwitHfgABU1Wd8Vu3/hn8TAnCyFeNv9LciAPRj+LcjAOda97n+bMOvAte02ziNeryrf4ZxPCcA7totVvzGCeBUs/ZO4781JwCuO/eLSmI4AVR0f7BmjI7xP4AAcI2j/xEEgCtmfEkpEwgArzP+xxCAevZ4B2Ck3R//RvwUgFf5luKDCACvGfstxUwmANRg+JfwHgCv8Dv/h3ECOM9uw7Tb4z2KAPC8k7+lOJRbgGqSfsPO+C/nBMCzTv6a0lhOAKxg/IsQAOYz/mUIALMZ/0K8B8Bz9v6eAj7hBHAaI8YLBIB5xKkcAWAW41+QAEAwAeAZPqTkUAIAwQQAggkAM7gBKEoAIJgAQDABgGACAMHekj6ABviTEwAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAATz9eDP8cFJO/Jh5N/ykWDfsUB7E4EvCcBXLM4ZROBT3gPgfEL+KQH4nMvmHF7LTwjAZ1wyZ/F6PiQAj7lciCAApBD1BwTgEZcKIQQAggkABBMACCYAEEwAyOHN3b8IAAQTAAgmABBMACCYAEAwAYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAgvl2YNI98zEhx367oACQ6bVPB/r37z4sBQJAmnsfDPbxTx+TAV8P/ohF4RkHZMCbgHDV+/5bhVsAuGPzWwInALhv25OAAEAPm94OCAD0smEEBAB62iwCAgC9bZQAAYD+tkmAAMAIm9wKCACMskECBADGKZ8AAYCRiidAAGCs0gkQABitcAIEAMYrmwABgBmKJkAAYI6SCRAACCYAMEvBM4AAwDzlEiAAMFOxBAgABBMAmKvUGUAAYLZCCRAACCYAEEwAHtn2ax7YRJmbAAGAFYokQAAgmADAGiXOAAIAwXw7MHx49NZviV166JM+/hleY1mSfPdTn3FXw/KfNzkBkO2ZEXxrx24JTgCPWZYEr+6/I66KxWcAbwKS6vXRW35g708ASPR2cZiPS4AAPHbcC81v7ry6va+MxTebAkCauyN81OYgAPCqgxIgAGTpM7zHJEAASHLM4PYiAHBFv5QsfRtQAMhh//+LAMA1R+REAEhxxMD2JgAQTAA+Y7/gOwdcIwIAwQSADAfs1iMIAAQTAAgmABBMACCYAHzO20YcTwAgmACQwec8PyQAEEwA4KoDThUCAMEE4Ct+DnCSA/br/gQArjkiKAJAjpoju/ScKQBwRc2YvEwASNJrbA8ZfwEgzTGj24cAfM3PAc5zPwEHRUQAyHNvgPuO/+ItRgDgFQft/q0JAJneLw7yYeMvAOR6dZivRuMry99jEoDvLH+JGOaVkT5u7//wz+oHAEu9t+8if+jofxAA+Dnib5/8+SgFTpcCAD8dvdc/5j2A7xXoNAcqcV0JAAQTAAgmALBCiRsAAXhOkReLY5S5ogQAggkAzFZm/xcAiCYAzynUbDZX6loSAAgmADBTqf1fAGCmYuMvAM8r99KxnYLXkADAHAXHXwAgmgA8r2TB2UTRq0cAYLyi4y8AMF7Z8ReA1xR+ISmr9FUjADBS6fEXABip+Pi39hb4Qaj3WDCeU374W3MCgDG2GH8BgBE2GX+3AFdYssre2upXaJvhb80JgBO9LRzCrcbfCeAai1bX7wM4+3XabPhbcwLgLG9f/NXof/OG4+8EcJVlq+nREI5/rbYc/Q++HZhzvH3xp6MysPHwtyYApOj/04HNR//Hk3CWvcjCVfPsQPZ45Y4Y/tacAMhz55bgmMH/9YRsZJdZukrujOZ3r+RxY/8vJwA4eMC/4/cArgu+bMrxWlwkABBMAO6w79TgdbhMACCYANxj71nPa3CDAEAwAbjL/rOW9b9FAO5zCbItAWBn4nuTAPTgMlzDut8mABBMAPqwF81nzTsQgF5cjnNZ7y4EAIIJQD/2pHmsdScC0JPLcg7r3I0A9OXSHM8adyQAvbk8x7K+XQkABBOA/uxR41jbzgRgBJfpGNa1OwEYw6XanzUdQABGcbn2ZT2HEIBxXLL9WMtBBGAkl20f1nEYARjLpXufNRzIdwPOYJGvM/5DCcAclvkKwz+cW4A5XMqvs2YTCMAsLufXWK8p3ALMZbmfYfinEYDZLPjXDP9UArCCRf+M8Z9MAFax8P9l+BcQgJUs/k+GfxEBWM0LYPgXEoAKcl8Ew7+YANSR9FIY/CIEoKKTXxSjX4oAVLf/C2TkCxMACOa/BYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAAQTAAj2z+oH0Fo74aOv4YrlH5m+/mPBlz8AWGppBFbfAhh/WGhtAIw/LJ2C1ScAYCEBgGACAMEEAIIJAAQTAAi2NgDLfw8KsjkBwFrRvwkILLQ6AG4CyLZ4AlYHYPkCQLL1AYBcy7e/CgFYvgiwRIErv0IASiwEJKoRAAkgT4lrvkoAiiwHTFLkeq8TgDJLAsOVudbXfybgn4o9HOiuzPC3VusE0FqxxYHuil3h1U4AH0o+KLip2PC3VjUArYkApyk4/pUD0JoIcIqSw99a9QC0JgLsruzwt7ZDAFoTAXZVevhb2yUArYkAeyk/+j8e5lZztdWDJdYmw9/abgH4sOFDJsRGo//jAW87Tds+cI603ej/eNjbz9H2T4DNbTr6Px78IfNzyNNgI1sP/q8ncdjkHPZ0KOiIwf/1ZA6dmEOfFgsdNfi/ntTxk3L8E2SoI8f+t6cXNB9BT5XbDh/8X08zdCpCnzZfChn6P56ySWhykCpw4P9aAtf+XyzJyQz9HwTgGRZpV8b9GwJwjWWrx7BfIAA9WcwZDHpHAjCPpX6FMZ9CACo6+UUx2KUIAASr9sUgwEQCAMEEAIIJAAQTAAgmABBMACCYAEAwAYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAAQTAAgmABBMACCYAEAwAYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAAQTAAgmABBMACCYAEAwAYBgAgDBBACCCQAEEwAIJgAQTAAgmABAMAGAYAIAwQQAggkABBMACCYAEEwAIJgAQDABgGACAMEEAIIJAAQTAAgmABDs/3fmPzubxjOcAAAAAElFTkSuQmCC" width="24" height="24"/>',
  firstAid: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAJXElEQVR4nO3aP4tjdRiG4TcyuiwiWgoiW7nVfmgbK7+MrbWFlSD4Z7HZIwPj9pPIvDnc1wUhXfJwyA9uTs7lOI4BAFo+2R4AALw8AQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSADAdb6fmT9n5vBaez1e/59n5sftHwOc0cP2ADipdzPz+faIuMfr/3ZmPmwPgTNyBwCu82Z7AB99uz0AzkgAwHW+2B7AR6+3B8AZXY7j8a804JkcnPty2R4AZ+MOAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEAAAECQAACBIAABAkAAAgSAAAQJAAAIAgAQAAQQIAAIIEADzfb9sDAG71cPMncHY/zMx3M/NmZr6cmVfbg+AKx9P770/vXy1uOZPL9gD2XI7jv3ND1N8z83p7BLBCAIQJAPwAoEsAhHkGAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAOCP7QEAvDwBwK/bAwB4eQ8L38l9+WlmPszMNzPz2cy82h50Rx6vyz9P5+TT7THwP3u/PYBdl+M4lifAKTk49+WyPQDOxl8AABAkAOA6v2wPALiFAIDr/LU9AOAWAgCu8/X2AIBbeAgQruPg3BcPAcIzuQMAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAADO7v32ADijh+0BcFKX7QEAt3AHAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACAIAEAAEECAACCBAAABAkAAAgSAAAQJAAAIEgAAECQAACA6fkXXueM8ewWqK0AAAAASUVORK5CYII=" width="24" height="24"/>',
  heartPulse: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  kitchenDining: '<image href="data:image/png;base64,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mUSZ6SLS0iiWvCkApHHFIXjKQXKmAJDwSpouIPzUiJJwKuVMjjFdRPipBSDhVMge9DBdRPgpACSc1uo2oBsUABJODhuoNF1E+CkAxLxCEjn9nN69eVMnoBtyeSPGfH/7BvXjUs08VpouwlYKADfU5LCybZJqmge+Sj8sYIhmKzYlqN8KuUgYej7sea7KYT6gd7iAZT5W+Tg35LQeYczzyU5iLMnxjr6JJUWLDezTQ4kxpitwTyElbEUzH/f4A0/yfzzCazm8gcv5nDhb0NGTylK8zCK22TiKr5Ln+Avv5LQYWYIi5lL287byUc4z1NLl57/X8hJv8A7vUp3T9opoQ48c+w+y91O1b/N2jtUGkxOlP1s4Hzl+es1plWfFd3lUWY3zW+c0J7Xxb0udPfOoMebgnOLUuFDVd85Ozu31/l7uHLlx+7n+OdhZ4+2vuJ71zm/yrDaAf2LBvCwUET9EqQ9ARLKkABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQspgAQsZgCQMRiCgARiykARCymABCxmAJAxGIKABGLKQBELKYAELGYAkDEYgoAEYspAEQs9v8Bj4pl3BxMIKcAAAAASUVORK5CYII=" width="24" height="24"/>',
  homeIcon: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oFAQc0OwQ5dgcAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDc6NTI6NTkrMDA6MDA7JhHJAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA3OjUyOjU5KzAwOjAwSnupdQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNzo1Mjo1OSswMDowMB1uiKoAABAMSURBVHja7d3ZciO5sgRAUjb//8u6D919bi9aSNYWyHB/GTONRAKozCAKpNT39xvQ6u3qAQDXEQBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAsf+uHgAXeP/k6/erB8bZ7u/bH4NVPHqxpwTBtcW9xCoKgA6vXOYlCnjH+R4neCUFwHRbL3Bw8R4042OErqMzgMn2aIX3W2zxHjbnInYAU+19YdcIgeRyjlxBO4CJjmiDFXYCye0fyucA5jmuDTTYFpGrJwCmObbMIouY1zkDmOWcy5l5K7BCKcetnB3AHO+ntcAKrcZDBMAU5zalCBhCAMxwfkOKgBEEwATXNKMIGEAArO+6Rjzv1IGDCIDVaUE28EnAlSU0/wqfEORTdgDrSmj/tJHwJAGwqqymyxoNDxMAa8pruLwR8QABsKLMZsscFV8SAKtJfustd2R8QgCsJb3FkuOJDwiAlazRXGuMktvtJgBWsk5jrTPSegJgFWs11VqjLSYA1rBeQ6034koCYAVrNtOaoy7jdwHSrdxGfk8gnh1AtpXbf8oMRhMAyWY0z4xZDCUAUk36SM2cmYwjADJNa5lJcTaKAEg0s1lmzmpxAiDP3EaZO7NlCYA0s5tk9uwW5HMASRraw2cDotgB5Gho/7aZxhMAKTQFFxAAGdra39uCIQRAgs5m6Jx1GAFwvd5G6J15DO8CXKu9BbwncDE7gCu1t/8PVuFCAuA6Cv8XK3EZAXAVRf87q3ERZwBXUO7/chpwCTuA82n/z1iZ0wmAsynyr1idkwmAcynw71ihUwmAMynuR1ilEzkEPIuyfpwDwdPYAZxD+z/Lip1CAJxBMb/Cqp1AABxPIb/Kyh1OABxNEW9h9Q4mAI6VXsD3+MO29BVcnHcBjpNeuvff/ps8Vu8JHMgO4CjJLXW7/d1S6Q2WvprLEgDHSC/Y+wNfyZK+oosSAPvL/4OX9ye+miN9VZckAPaWX6b3F/5Phvy1XY5DwH2ll+h3Le5AsIwdwH5W3fq/9l3XSV/lpQiAveSX5eONLQJqCIAWzzW1CCghAPYwZfO/7SfOlb/mSxAA26UX4qsf9/Ux4QICYKv0ItzWxCJgOAGwTXoBbm9gETCaANgivfj2aV4RMNjd6r0sfen2bNz0ua4iLkx9EvA16Q2xd6Glf0KQF7kFeEV6KxzzOhP36sV2AuB5ne1/7CNzEQHwrN72P/7ROZ0zgGd0N///P0f6OvAwO4DHpZf9ea/O9gFjCIBHaf/rno3DCIDHaP/rn5EDCIBHaP+cZ2VXAuB72j/vmdmJAPha/m+dX9uEImBx3gb8iuZ/bAzp68SnBMDn0st6e/v/muHWR7rHrxWf8NuAn0lfmK1N+/f89n48PpKwZ/uDM4CPpZfz/u26dcZxpc0jBMC/5h/8vT/x1fNGxQUEwN/ym/+4zboIqOMM4E/py3HGnbrTgOPERaQdwO/SS/ec1rQPKCIAfmm989/2nceMlNMIgB/Sm//sjbkIKCEAbjftv89P7DtiTuEQcH77b5nfdc88U1wsCoD0Bbj6TP7q558lLgDabwHSy/P69rs6QDhUcwA49z/nUURAsN4ASG/+lPbf45FEQKzWM4D0aec0f/aYVhMXhZ07gPRSzGw1+4CBGgNA+1/1yCIgTlsAOPi79tFFQJiuAEhv/vT23+MZRECUpkPA9KnmN/+aY00SF389O4DpJXfu/KavZo2WHUD6NFd8RV1xzFezA7hEeqmt2UpOAwaYvwNIn+CazT9n/OeKC73pO4D08lq/fewDljY5ALznfw4RsLDJAZBuRvvvMRIRcJmpZwDp09rv3/VLMW9GR4iLupkBkD6pOa/9HfPaT1wATLwFSC+juW3iVmA50wLAwd+1RMBiZgVAdnPcbtPbf48RioBTTToDyJ9Kzx/Z7pnpc+LibU4ApE9k/mt/93wfExcAU24B0sulrx3cCixhQgA4+MskAhawfgDkN0dn++8xchFwuNXPANKH7/NxVuB3cZG29g4gvTQU/x4ziGuaSVbeAaQPvXfr/y9r8UNcmK27A0gvCSW/52ziGmeKVQMgvT20/94zEgGHWPEWIH/IPgf3mfaViYux9XYA+UXQXuTHzS6ufda32g4gfbi2/t9rXqO4CFtrB5B+6ZtL+7xZxjXRytYJAB/4nUMExFjlFiB/mO78n9W4YnHRtUYApA/Sa/9r+tYtLgBWuAVIv8x9ZbwXtwKXSw8Ad/6ziYCLZQdAfnNo/61EwKWSAyC/ObT/HkTAhXIPAWMH9pPm31fHesaFVeoOIP1ydpTrmewDLpEYAA7+OomACyQGQDrtf5T5ERB37dPOAMKG84HGz6+da/oKR8VU1g5g+sXLn1+C6b8yHFUFSQEQtTAf0v7nEAGnSbkFCBnGl7T/maavdkhMZQRAxCC+seWCrTC/RNPXPCAEEgIgYAjfmP5qlGv6yl8eAdefAUy/SPnzS+Y04GDX7gAun/63vOd/venX4NKYunIHkH5h5pfeGqZ/POjSKrluB5DfHLb+SWZfjctC6qoASL8g0wtuRdOvyCUhcM0twPSLkT+/FTkQPMAVO4D09nDnn2v6tTk9ps7fAUy/BOnzW5sDwZ2duwPIbw7tn2/+NToxps4MgOkLnz+/OaZfqdMi4LwASF/0+a8rs0y/XidFwFlnANOXO31+8zgN2MUZO4D85pi+oZxr9pU7IaSOD4D0RZ5eRNNNv3oHh8DRtwDTFzh/ftP5eNAmxwZAfnto//WJgC3TP/DR09vDwd8c06/lYTF1VACkL+j8kmkz/XoeFAHH3AKkL+b8cunjbcHXpn3A4+Y3hzv/qaZf2d1jav8dwPRFzJ9fMweCz05550dMbw9b//mmX+NdY2rPAEhfuPmlwQ/zr/NuIbBfAExftPz58bvpV3unCNgnAOYvV/4M+dv0a75LBOwRAOkLNb8U+Nj86745BLYHwPRFyp8fX5l+9TdGwNa3AacvUP78+Jo3Br+e4KafT2+P+VtAHjG9DjbMb0sADF6WBWbHc2ZXw8uzezUA0hdk+gXnedMr4qX5vXYGMHQxFpofz3Ma8NG0Xvip9PaYfsfH66bXxtPzezYA0hfAaz/fmV0hT87uuQBIn/z0i8s+plfJE/N75gxg1MSXnB/7cBrwP48HQH57aH8eJQJ+ejQA8ttD+/MMEfBjIg99X3p7TD/b5RjT6+aB+T0SAAOmufDsONbs6vl2dt/fAiw/xaVnx9Fm3wp8O7uvdwD57aH92W56FX0xv692AEtP7AH58+Mcs3cBX87v8x1AentMP8DhXNPr6ZP5fRYAi07nQemz4xqzq+rD2X0UAOkTmX6huM70yvpnfv+eASw4iafkz4/r1J0GvH33DXG0P0cqi4C3r/5nIO3P0aoi4PczgPT20PycZ3a1/W92vwIgfcDTLwh5plfc/XY74p8HP3CwL8u/GOSZfivwY5jv26d6+Bg3/XT23Eg3ufruP3YA8YPcIHtu5Ju8D3i/3e7v2S2i/bne4CrMPgMYvPAsZPAuIDkAtD8pxkZAbgBof5IMjYDUM4AtC5Y5IyYYV5eZO4Bxy8wQW6orcheQtwOw9SfbqApNCwCv/axgTJ1m3QKMWVaGG3Mr8BY0HO3POmZEwP0tZjjan7WsHwH3lFuAu/ZnQdsiICIE3n4O5kqjTlWpsvLHg/74ewDXDUX7s7JVI+DnM1/9J8Fs/ZlgtTr+50+CXTEUr/3MsVI1/zbWt8/+x5mDeIH2J8s6twJ/PNdV7wJof6ZZJwJ+83cAnDMM7c9EK0TAX89y/r8NqPmZLbnCH/i3AY9NouTFgT3k7gM+eOy3R7/xqAE8QfuzhswI+PBxzzwE1P60yIyAj57q05Hu3XCrfVQCtkqq+U/G8vbsDwxYCjhHzu8Lfvpo9y/HuE/r2frTK6H6vxjD26s/uNQCwFWuPw348jGOPgTctvXX/qxvWx0ffCD4XQBse3p3/nC7XXka8M1P3x8Y2WuDt/WH313REd8+5yO3AK8MXPvDn84/DXjgZx47A3j2ySP+2hmMckgXPnoI+MyTb21/r//MtLWyD+jCx98FePTJvfrDUXbvwmfeBvz+QUP+1DGM9UiPPdGF/z355J9vY7Q+nOOrPnyyE5//IND9w69pfzjT/ZOvPtmJz+0Avnpq4Ey79GHGPw0GXEIAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAsf+uHgBPu189gC+8Xz0AnmMHAMUEABQTAKtJvgFIHx3/EABQTABAMQEAxQTAarLfaMseHf8QAFBMAKwm+5w9e3T8QwBAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAEAxAQDFBAAUEwBQTABAMQEAxQQAFBMAUEwAQDEBAMUEABQTAFBMAECxxAC4Xz0AOERgZScGAHASAQDFBAAUEwBQLDMAAg9LYKPIqs4MAOAUqQEQmZbwstCKTg0A4AS5ARCamPCC2GrODYDgRYOnBFdycgBELxw8KLqKswMAOFR6AESnJ3wrvIL/u3oA37rfbrf3qwcBLwhv/tstfwfwwwILCX9ZomrzdwA/2AewkiWa/3ZbJwBut1+LKgZItkzr/xzuov206LA3W6G8XJuFrBoAwA7WOAQEDiEAoJgAgGICAIoJACgmAKCYAIBiAgCKCQAoJgCgmACAYgIAigkAKCYAoJgAgGICAIoJACgmAKCYAIBiAgCKCQAoJgCgmACAYgIAigkAKCYAoJgAgGICAIoJACgmAKCYAIBiAgCKCQAoJgCgmACAYgIAigkAKCYAoJgAgGICAIoJACgmAKCYAIBiAgCKCQAoJgCgmACAYgIAigkAKCYAoJgAgGL/ByrP0D24cct0AAAAAElFTkSuQmCC" width="24" height="24"/>',
  home: '<path fill="#fff" d="m12 3 9 7v11h-6v-7H9v7H3V10l9-7Zm0 2.5L5 11v8h2v-7h10v7h2v-8l-7-5.5Z"/>',
  texas: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  star: '<path fill="#fff" d="m12 2 2.9 6.1L22 9.2l-5 4.8 1.2 7-6.2-3.4L5.8 21 7 14 2 9.2l7.1-1.1L12 2Z"/>',
  hand: '<path fill="#fff" d="M8 11V4a1 1 0 1 1 2 0v6h1V3a1 1 0 1 1 2 0v7h1V4a1 1 0 1 1 2 0v6h1V6a1 1 0 1 1 2 0v8c0 4.4-3.6 8-8 8s-8-3.6-8-8v-2a1 1 0 1 1 2 0v2c0 3.3 2.7 6 6 6s6-2.7 6-6v-2h-9Z"/>',
  chair: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  antiqueVintage: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  clock: '<path fill="#fff" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v5.4l3.8 2.2-1 1.7L11 13V7h2Z"/>',
  palette: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  floral: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  leaf: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  scooter: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  bedBath: '<image href="data:image/png;base64,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CAjApZyoVaUTIACXcJLWFk6AAJzjBBVkEyAApzg5HdEE+CLQcca/JLradgCHOS1FwV2AHcAhxr8puO6+Cvxd8CKgyw7gK+Pfllt/Afgst/zUCcAH40/uKhCAd7GFhzEE4J3xJ0kAxjD+ZAmA8eer1PUgABAmAKnew1f1ABh/0toBMP7EtQMAceUAuP+TVw4A5HUD4P7PYamfBekGAMgGwP0fRjcAwKgGwP2fY1LvAFQDAIwxmgFw/+eY2P2/GQDgjQDAu9z9vxgADwAcFhz/YgCAfwQAxoje/3v/NJgHAH6KDv8YdgAQHn8BoC49/r1HAPgQH/4xBIAqwz/GEAB6jP4nrQA88jMAlxkTaAXgUQw/k/ApwP0Zf6YhABAmAPfm/s9EBADCBADCBADCBODe/L0hExEACBOA+7MHYBoCsAUJYBICsI1XEWAGL7HrNPZyOcBXtT7xx0DU/L0JyMAYQwCokoExhvcAaMs/EgoAbfG3a2sByG/5OCCcgFoA4JBsAgQAxsgmQADgr2QCegHwLgD80wsAHBPcAwgAhBUD4CGAY3J7gGIAgDfNANgDcExsD9AMADDG6AbAHgBGNwBwTOohoBsAewAIBwBIB8AegLxyACSAvHYAIK4eAHsA0uoBkADSBEACCBOAMSSAz1JXgwBAmAD8lao+vBOAdxLAGLnrQAA+xJYeBOCrFxGgRQC+k4Cy3OoLwE+5i4A3wZUXgEM8ChAhAMdIQE1yxV9Sv390PaenIjn+dgDnRC+LnOw62wFcwklaW3b8BeByTtSqwuMvANdyutaSHv4xBOB3nLQV5Id/DAG4jZM3K8P/RgDuycl8bsb+BwGAMN8DgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgDABgLD/AUhk3NOGxsruAAAAAElFTkSuQmCC" width="24" height="24"/>',
  soap: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  bag: '<path fill="#fff" d="M8 7a4 4 0 1 1 8 0h3l1 13H4L5 7h3Zm2 0h4a2 2 0 1 0-4 0Zm-3.1 2-.7 9h11.6l-.7-9H16v2h-2V9h-4v2H8V9H6.9Z"/>',
  glasses: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  cowboyHat: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAAqo0jMgAAAAd0SU1FB+oFAQYRKR6xvZ8AAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDY6MTc6NDErMDA6MDBPBT5zAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA2OjE3OjQxKzAwOjAwPliGzwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNjoxNzo0MSswMDowMGlNpxAAACJHSURBVHja7d15nFxVmfDxX1Xv2TeSECAJBIIJO4LIC7IICOqwuACjCLITRUBf9BVGUBEUAdkUUbZX1HEZHAQHNwQEkRdHRIdFQdawBbJAFpJ0eq3z/lHVlap0J2m6q+6p5ffl81G6E+o+99Q9zz3bPRckSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZI0NKHwn4PCsrCuO8Koor8TO+DSnW8qXBsGtiwcVBtnW40aYwdQP/KX994cDnSzNW39/tIcLqKDNClS/II/Zv+rVOzQh36u0MQpbEMXafZcz19u4xQO4g2uZ1n2v6u+861eJoBE5CrEJOYQOIET1/sXZ3FW/t/HE0jxJK9XZRIYx3Y008lUPs02G/ybLRwJvM4SnmI1j9Mbqu9spQ3JNXE/Gl4NS8PqMDirw9LwajimGhvHgbBXeDqsCEvCG6F7UGfbG5aFleHOMKP6zlbaoFz1PzM8NsiqX+ixcFY1jQjkY90rrBjC2a4Mt4fdq+Vca4FdgDLLXchjeT8ns8MQPmAHTmAlnfyDR/o+rTIbyPkq28YBjGJ70kP4kFEczuvAX8COgKpe7m7YFD4QFg7hftjXOO4MmfCdMDVMCSMr9e4YCIR0mBAmhL3DkyGEriGfbwi3hxkhXalnKg1aLgGcHp4JmWFUiBBCWBj+O/wpHFWp1SIQCKPCt8PD4ZHQOcxzXRXuDDtU6plKgxYIE8Kp4a/DrBBr3ROO6rs3VkrlyPf6Z4Qvh9dKdJ694eawT+Wco/SW5arF7PB0yap/CCH8LewT5oYtKmFgMB9DW5gTtg2fHVazv78rY59fPXAQsNwaSvx5c/khDdzK5+kgVQH1I02G7biWqbTQVNJPTlXE+dU4B1rLJgDsx2m8l7El//AXuIvAHfwS4nyJuZo5mjPZgqn8S8kTHTzJLXyHRV6iqkK5xvH/LmmjeF23hz1DU/JdgXzTf5NwQni1jOf3fNjGbkB5DWWuVoOTopGWsh7hcK5iW5ppS7wR0MgoWjiaq5haxqP0MCbh86o7tq/KIgC0cD7/yqyyHmgNf6aTP3MR3cl8mbm78a6cSxtbMaesB2vnL1zCb8ALtVwcBCyXLTiCY5le5qO0sR8wm0X8ggUJnVmad3ACH07gSCPYl+Vk+AMdCZ2bVAqB8KGwsqz9/2LLw6Hl3Eeg6LMbw00JnlkIvw+THAUoF8cAyiVd4kmxDWtO8Fi9ZRjx35Am2//lYxegXAKZBI/WwDHsRBPQxIt8n47SPTaUu/vuwAdpIJChkZ0TPDPIOA1QPiaA2tDM0Ryd+/fnWMArrOLZ4T5RV1DvpvNRzol9kio9E0Dtmc4NNHAnZ7C8BJ/WQC/juCiRQT8lzgRQcrn7Zle0AJqYChzCZVzCs0PrChTc+/+Vg0lz4AD7Fyallw53BygXE0A5pNmOdyU8VLauSZzAQv5EFw/S/tZ2FcxV/1nMpYETeXfU84ApHMo9LI4chTQ4gdCS8ETZwDJhTegMT4a9Bj85WLCJd1v4UmgPq0r8hN/QvB6OcBywPJwGLI+RsQMAUrTSzNZcOYT++ygu5lTaGJnoZOb6jEl0mrOu2AUosQDQGXEEYF2N7M5JTCbD73h+w12B3F32YLZmHEeXdZX/W9NDZ7W+IaHSmQBKr4ktGR87iCIHcwhdnMeNLFs7wNdXmYoa101sw9kcVGFjbimmM5Y3XQ+gihcIO4X7B733f7I96StDS//xgKJlvruHP4U1sQPtpzcsCl8Pzdb/0rMFUHqj2YERsYMYwEQ+QKCTFl7lBlYUVac9+QDQxWz2qKh7f1aaycyqwLhqgAmghHJVqrtin12bwWcAWMRC/pnfqyDQw3HMix3cRnTS62qA0jMBlF7y23O8VZO4iu6iKCth1mLDGmljZewgak+lX6pVJQAcxTz2pDV2LDVnAb/mMp7xgi0t1wGU2h7sb/Uvg804kimxg6g9JoBS644dQM3qTPQB6zphApDqmAmgZHJzAD2x46hZIbse0NUApWQCKIncZdnATDaNHUvNamRbRgOmgBIyAZTSZlzDv8YOomaN53JOjR1ErXEdQOnsyTz2q8g1gLWhgamcSCM38kbsUGqHLYDS2Y3jqmBBTXWby4kV9qBVlTMBlI671yahy1IuJROAVMdMAKougS4nA0vHBFACoej/VFbNbO7QdemYAErHhapJmMG1HBY7iNphLi2NVg7n8NhB1IVWdmaL2EHUDhNAabRxavT98+tFcLl16dgFKBU7AKpCJoBScQhQVcgEINUxE4BUx0wAqj7dYJ+rNEwAw5Z7GZiDgMk5gPfkNzXXsDgNWApNbOVzgIlJcRRjeYhO3xIwfLYASmFPbuLtsYOoKw22uErDBDAsuYdSRrELbbFjqSvbcA6zYwdRC0wAw5ViGtu5Ni1hM/gMc2IHUQscAxiuBj7Lqb4KJHG9TgOUgglguFJs4gBgBFb/krALMFw+mqIqZgKQ6pgJQKpjJgBVK/cGLAETwDCE7P94DcaQZkvGuhRwuEwAw+UlGEcrX+ZzNMQOo9o5DTg8m3Eye8YOoi6lmcxM0+9wmQCGZxqfYErsIOpWt92v4bILMDwh+2y6VJ1MAFIdMwFIdcwEoCrnMMBwmABUvXp9DmO4TABDFPr2AvQGFM+ufMo5mOExAQzHGObSHDuIOrYL5/qewOExAQzH8VzFpNhB1DXbX8PkQqDhmMLU2CHUuQwd2SzgksChsQUwHA5BxdbGvmweO4hqZgJQNZvIpXwsdhDVzAQwJLmupy2A2FKMYFTsIKqZYwBDNZL92SN2EAJ6YwdQzUwAQzWBL7J77CCk4bELMFQpVwCo+pkAhs6306nqmQCkOmYCkOqYCUCqYyYAqY5VyDTgYJ7pcLW31i9UzPUx2OeTKiNeWwCqdq7HHIaoLYCiXDmF9zFiwFVdjSzlDlYW/u242TO3FYjTgJVhLz7I71gVN4h17vs7shfraww00M6vWZT9w9jtgGgJIF82Y5kAdHAgVzBuwEqV5iWW8SgtQIpVLO77ryMWXgtb0xbv8CpwMJN4OF4CyF/JrUyhgQD08DE+t96XxqVZTg/30MBCumNfydGOnC+bEzibQC9jmbHeaHqYTztpoIVfcQ5dcYMP8AEuZGtaIgWgYo9yGC9FvBqyduMKNqEbCEzZ4FZlgRdZw3zO4PnsL+IlgJhdgJ35EGn2YbtBRLlN/t+byNDDffw2ajtg8iCiVlIidcbyVX8MJ7EJW7L3IC/GFDOBmXyBxbzIj1gZJ36IlAByBTeXfxvCIOSWnA1szQoyvMCiSOO/vfT6Ysr6FgDSvI0RbMPn2PQtf0AbJwIPcSsr481hxGwBNNEz5Adq3sveBC7i2xHjl6ZwMe+il/FD/oRAa8wTiDANmLv/z+P0YaSfEUxhKqdzDk3ZLbqT2h0yd6SuhA6nwcjvDJiM/PW2E5ezH+OZNIzW4DZcxq4keAUXi9MCmMD+nMouw/6cOZzMYpbzEg8n2BVoZFf2ij5/o7UmcgS/5pUkDpWrpmPZm0b25yPD/sAJHM1SbuTRutnYJBDeFV4OpdEb2kNv+GmYGlLJZNBAGB1uLVH0KpWV4fjEvn9CQzgkvBS6Q2fJ4v9RaIvTAoizErChZPu4pWkjzSFcx9zEok8xIrFjaXBG0ZTg0U7kMjajsYRbwkRbU5J4FyC3iq67pB86ln0Zldj+8KFuGmvVozeZLnTuILPZvsQf3EVnnPmsGC2AMWxd8sTTwyxGg6+KUbnkhukamMGEkn/4+FgvmYuRAE7hUsaU+DPH8Q1OjXAuqjeb8W2OLvmn7sNN7BTjdGLMAmxehhdqNbApJ5LiO6z2RVEqvVzL8u18iv0YWfKPb2VOnPcbxGgBlLb/v9ZcPsMR2eaZHQGVUgBI8TZO4vgyVH+I9nRpbe0HMJVvcjQpGwAqgylcXHvdzNpKAGkmcBbn0mAbQKWSG/zbgW/y7jI+/xGy8wBJi5EAyjuJti0n8nEmxVtcqVqSu4Z25jSOLPnQdaFWDovxhGnyCWBqWYsRYBbf4P3ZZ/VDos8JqHYUXDlppvF/OL3MBxzNuRyT/HkmPwtwG9PLfoxxXMA0Lk783FSLZnE5+yVypAgrAZJPAO9M5Cgz+ChpemjmZX5CZ+XsGavKl9+v4lAa6GIWBydUNSPMA1TItuBlsD0XAfAMr/IA7a4O0ODkpvym8hHOi3HoZNXWLMBAtuI6DosdhKrMaC7i04kfNZ38Par2E0ADM/kMp4BTg9qY3LDfVnyNQyOszDuE7yV9yNrtAhR6B60s5L7suwXsCGhguRvEVhzHaVFqxlhmJn3I2m8BZO3Id9g/dhCqAmM4my9E2vD1Ng5P+pD1kgBgM77CJ+rofDUUW3IVH6YxUjNxDSuSPmQ9VYideIftf23QON7H5GhHj1Ab62MMoE8XoQJeK6aKkx8eztARO5Zk1VMLAIIv9NQGZeptqqi+WgC7cyEZ7uTBSnqfvGILAM0cxxZMGcYrPoYvyY1Nc5JPAA+XZUegwdmVXYFNWcILZduWRNVoDP+Lz7JtxAh6eInnkj9s8l2AI7g9+dMs8nGuKMO2jqpmB3E9W0eN4E3O4YbkD5t8C2ABy5M/zSLNTKPHwUAVDP61skXkUDIsoDP5w8YYA4j/Vt3RHMrrLOav7vBfv3KVfxzvJM3u9EQfD2uKcTuKfdJxzOIaWvkZJ9HuYGDteCsLvXPVP8XefJdJ1GtNiHLa8Ys6zUigzYHAGjK07/JkzmRaRdwDmuNMycc46O/5VUXMts7i5L69Awe7cVjuxWauJqg0Kd43uG07Cr7rERzDyWxfEdV/ATfyUowDx7gb/5IlTGET2iIuugTYnq+xkntpBV5nxSDXBjSzbfYlZKogaY5iBA/SNYi/O4rJpOlgOy5K/um7fjp5jUZ+wXmsiXH4OM3xxziWXj7IRZG7A2O5iDdpAC7j5kH+N7tzJTtEjVoDG+zg8rv4Km1008bmsUMGnuJMFrI6TvWPkABSBFjDP4FbaOWkqNMvKWbk/m0ejdxMzyDaAGPZMbvjsCrMRjtmuU7eSHaJHWre3dzIA31zUTH6IhHuwNnTDDCfazgk+vxr1h6M4VX+OIgtQzJ0mACqUa76z2B7uuK8iXcAd/EfEHM1StyHgRpjLH1Yj225noNjB6EyG8N5nBNjzf2AeuIPJ0dLACmAFVzAbbGLIF8Sm3Eu88C9A2tPbtx/BpdzOC0VMe4Pb3J+dll8zHDiDsJ1cC/NjGbfCsnJu3Iqr/N7lsYORGUwh49wbMV03xbwc25iSewwInYBcnnvTj7HY6xgRUXceHfhCt7mewVrS+67PI7zKqLv38XrrOCnfJ4lRH+VdfxVefAk82hkL75aEdl5hHW/RsXa6W9d/8MXWc1rsSb+ikVNACkgQCcPAwvYhGOZFrtAaOE4ennILUNqQy6bt3EUe8aOBYA/cAO/6/sh/hUWvQWQnxR8mQsYzcEEtojaEhjFPNpYwkv0+haBaper/iPYhy+xZeRgXucNurg6O+xdKddVJe0J2MFFHMiJPBM7EI7i2gpZn6BS+BDfSeCd1BvzY97HB7k7dhjForcAslLZ7XpfAxZwIVOYwSdpixZOG/vwFb7FXwboCKRpjVtWGqwAkOZkTo685v9v/JAMD/B89sdKuftDxSSAgq5AN7cAM9ic90TcoHEEx7KGdp4grJMCFvN79mRczLLSgBoKv6hc438M+3IWc6PG9RQ/4Oq+Hyqp8kNldQEKvcTp3EYP7RH37DmZi9m032//yjz+ErNotB6rB5i/OYjvMidaRF10spgvck3MYtmwimkBZOXbAYE3+CZ3MIpzo+XvNPvxLS7kkaLdAwNLnCisQDfy3bUTa7kvaB7zos4r/YD/IvDf2ZtYpd37syosAWSlsl/gozxKiomcyI6RAhnNB3mNB+niLlYE8mMVv2YyO8cuJeWt5jfcwF+hYBn3aN7HKewULaYV3M33eDD7Q2VW/sqOjPyXeTwXMzlaZ6WHRl5hHr8r2nTqY1zC1IrtQNWXbu7jFF7M/9zABDLswXVRn/f/Ox/MzmdVdBWrikv453wiznZJQLaNNI0r+HjRb3/BPOZHLhdl/ZgzeaXg5wlcyV1cNsD4TZJSg9qdKLrKTk9r13GdwHS6aOID0d7e8iC/IkUTT3ALAK0cz0y6aOSIiMNM9exWHqeJNL/lfgCmcxQj6GQyJ0SbP7qNR2kCGnmFH7GswqsXFZ8AoOjh3DRf5uTImf3PfIb/KXiHbIrzOa0CljDXl04e5WweKPjNJI7h61HXaHTyOJ/jvsJfVX71qvwIi4fcR3EMlzOSTMQxgWc4g3sKfjOSj3AFoyPGVF8ypLmf0/knPfnfNXEh8xgT7XrOkOZBPsETBTFRDdWrImcBivUVYgBYxS/pIs17+VCkcBqZwxeYzH+Qyc1WrObX9JLmYI6MXVZ14A2uYhEv83fIP062OWdwNGOjxbSMq3iNBTxOqIZKX6gKEkCf3Je9gO8BC2kjzdxIK7z35wV+0rdMOMCrfA94icm8syIeaa5dr3Eb1/Zt2JLqax1O5LhIb5zO8DDLmc+1vN4XU3WpogQA+SQAd3E/cD6fjvSUdwPj+l5yWhDTQm5i99hlVLMC3XyfC1nTr5qNKW54J2QNsJDz+APNtFdf1c+qwqgLxgRm8BG+FGXgZxF38oXs5FM+AUATu/N5DotdQjWqnQv4aXZCOL9iFOBDfJadI1wF3+B3ZPgLb2Z/rMKqRNW1AKDoy3+RHzOJMWzDfgkHMYUP8yo/4Mm1r6QM0M2D3MhiUhyYf+OASuFenmU5P2IBFDT9oZH3chrvTDyeFfyc72fHIaq16ld/7NkRlxQZDuMKZkRIZpdzFWneYDXkL8sUgTa+zgm+QKxEepjPZ/gVaQIh395KMYkmtuC7ERZlr+HXfJLFVV59gCo/g/x9YAR7cHWEF3YtYhHdXMAdUHRfgikcz4UVstdxtXuEs/hL34M++QTQwtc5mMBWERr/3+JyXiZT5dUHqIUzyF4ODRzNaewTJYC7uY7/hHV6pjM4iVOZErt0qt59XMctaytbrnSncRonRNm1qZ3vcQOPQk1UnmocA1hXigC9/BhoA2ayScIBHMhIFvJX1qx9bDjAi1zKRI5MPJpa0sOTXMvPoF/76kg+l/iOUYGnWc18Li0ciKx2NXEWuUtjFKNzi4WT1suzfIJ7aaKnoJeaZhSf5jxSpF0j+Jb10MhTnMKfslN8qb4yTZPmAk5nVOLX7ut8kt/TwNK+iGpBbZxF4d1hB47nrEG/Krp07uE1XuPS7IKQ/P1qNnuQ4nj2j11CVaaHy3mcldyV7fvny/M9fIwUezIr8Yie4BLuYFn2hxqpNtREFwCK+oePcwObMIbpCb8E+gBgOa/xn7xckJCe5mmglxG8o4aumnJbym+4kWfX/iJ399+Dkzgq8WhW8QDd/JEfQC1V/axaOx8CNNBCF8dwCS20JNxT7ORCvkUDq7NPg+fvXAfwXSaTZlTs8qlwPayiids4i6UFaT3FSFJM4/qEh3kzrKSRhziZl0nTWYPVpfbOKH/vncxcAidxbMIBzOcFuvha9hn1fAIYzU6keD+fj10+Fe4Z/o0lvM4/oCABtHAOB5Bmp4QT6DLO5QnaeaRva9qaqy610gVYK3/RLGYxEGjhiERfCbklWwLLaeT3BeloJQ8AK2iikXfyjtilVIE6uI03eJZfrN16LV963ezEuxKO55c8z1JurdaHfAar5hJAVn4k/n6WMIWZdAGBcUxOKICjGcsS2lnRdwEB8BhnA6cxkUAg0MCmjIhdVlEtZjkpoJnnuICn1vnTRjajhR5GJtaR6+JVumhiOd/gD9lf1WrVr/mzy90/mplOMwHo4mN8KbEzXsUC0tzIpf3+ZEJueVAPY7ks8acYKkmGL/ITWoAUnbzcbxe9GVzL2+ggzTTGJBLRU5zOC7TQyyvZBd41XUVq/uzW3cB/DoeQ5lD2TSyAR7mbwK38N6yzmCXrvcyr26cH3+Bavs9zA/5ZmlOYzXiOYmRC0XRxPfNZzM/o7PtVjVcOoGa7AH3WfoUB4EmeBF5nInMSWimwEzsBo1jOU4SiF4xkI/oNGcbQyIy6ehlpD3+ng8e5kmX9viOYzSaM51Nsn2BEK7iXq/qSUT1U/LoT1v7TEA4K80NvaA9rQm9IQnf4RZgWGkJTKGgD5KJpDZPChPC10BXWhPbQmUg8sfSGNaE99IbnwrvDmDA+pENRmygQCKPD9WFFWBK6EomoK7SHNSET/j1MzUYT+rfSalqdJbv8pNy+jKKLcXye2YkceBn308s9XNv3i6JHW+Bt7ESgk735bOwyKqN/cikraGYlf2BVXzkUVbjpnM9hiQ3Vwg+5jSYaeIaHs9HUmxrvAqwrNzuwkl8C0MAUdmEE7y77KPN4Dgc2ZyXd/J2/91X9/GzFP/knAM8xkTZms2vskiqx1dzLGh7m+2T6flWUArdkD1J0sgMfS+zx3g7u4aa+sf61EdWXejznnAApGulhNjeyPYGxZX9kp5ceGvkmF5NiZeET7vmI0jTRxYlcRAO9NDOuyh8j6uBNAq08wik8SyPd64yBZAugjU/yFRrpJU1T2a/Jvpge5+TsxGMdV4J6Pvf8BdjEdjSxO5cktM7sVV6kl8v4r+yP/QbBYDJbk6KD3bg0oemvcrmHC+mkiZX8o2+BT78E0MJFfDTBV6vcx1dYUxhTHVeCeusCFMo3Qbt5BHiFCYxie95f9gNPYxqwjNn0cCsv9+0pWNAhyK5ihFeYxGjmcmjsshqCRfyMDv68viZ2rvofxK60cmRC1X8Jt7CGh7l34JhUt/IzBO8JjyY4Et8ezggT1jfynI/pgPBweCIsTCyq4eoKz4Snw/8NYwYeVc+fV1OYE25PMK7l4eYwrh5H+rVR+YuyOewWHgohZBK5JDNhabg4NG4kAYwMW4Xp4cKQCSFkQiah2N76ufTF9mw4MEwP09Y3rRYIhFQgbB8eCB0JRnhx2KQ+p/o2xBZQgdxT54cxjWmckVDv+wV+xNUs6ftx3S8kf6nOZX9SBDK0cDLbxS6rfn7IA7n34i7m9v4DnEXn0sanmMlkDk9o29T/x0/JcP/a14mpTx2PAfSXIkCG24GpbMYMxrJL2a+XmXyK13iMVjL8g4XFqwULxgWe4In8L0dwCJ1kmBVhZ5xiXfyNFTTRwQ38sbgsCxXccXdiAptyekLvTXiDx0jxU64bOC5ZHkXyF2oDI+nm3XyXTaDM7/vLsJoeGujiHH5AMx30rrf6AKQYQTPQzZl8IdeeTdGSYDLvzI3ot/A0J/EYrQTaix/lGeAMWkgxlmt4P12MKvtS7F46aOF2zmIVPbQPHJcsjwHkK9w43kmaQzgjoQM/xous4qvZ7TAG/nKKksGW7AgEehnJOQlugfZtfkkz0MCbPNjX3B8o3qJoT+EI4B1MSiTGF/gKS1iYXeE3cHSyCzCg/AThcn4LLKaNZrqYzCFl3lpkR3YksIi/0c5vWd1/qCpVPIs+n/n5P9qE/5W7BwfSvIutShbVYu6mI78gKU03P+Ch/uVVEFehBg5mGt00cBx7l7X0sp7jATK08AQ/oaN/fCpm2WxEILepdw87cD1bkWZimUutlwbmcwqPFi2KXcmKwr/Ur9I1kM7VvgxNfJXj1j7WSqCFSW9hTWE7y/I1uZU7OYNlRbeKDJkNVPpGJtGU+2UXm3Edu9MDZd8cvYOlNHIz59NDAxl6vbw3zhLaiIKLu4XZpNiPSxJYrd7D06wqqDBNfJ8rC//CBu+6MJ0pBb/uYDeuYPygj/5bLqAz10tPs7Rwf95BHH8LrmR2Lv0EWtgmof18/sS5vMkb2dd29I9SA7ELsBEFTe5OHgeWM5KRuU0iu5nJsWXpFjQyd53fHMNoAinSdHELzxZWugEG3F4qrAbAQiYyIftCi0Ec+8/ZDUwGKoeioxQ6nN3oBnqYxsEJLap+gp/Tk0uTTTy2dtWhFX+wLKm3pN9lvy1XsTmdNDErsb1rejiPO2gFUrTz7NpNNNf3ZQ5t2cvAn1b0WROZTgropZULOSih84dXWESKFm7hK4OLWutjeb0l/apSE5vQSDcTuYZ96SWdSIm+wSpSQCuPcyrP00ggk30p2aCiHpQNJIA0aQK9nMCXSZMBUkxMZHvTDNDLl7mJZlKsYungotb6WF7DUFSx3sPmTOFsJiYawmp+w1KaaefbBQuFgNJ9tQOkj+M4gG562TnxDc7v5qcE/sgzpT/P+uQYwDAUTcn9DpjANLalE8iwRSLz8iP5cC6E5dyXX7AUeIQFG7vvb2QYsdhubJYb9+ilmZMSfUPPCh6igxQpGvgR/z5Q/BoqS7FkAqRpyw1JdfAhrk5wa6tAR36IL003/8bN6x2cTNFLe9+7bvIaGEHDgJmgh/Fcw/v6ZtWB1oTW8GfdyWksyh2xqzZf0BWPZVky69SdcRzAV9k2UjBP8sJ6Z92bmc8XWLjOb6fyVbbstzN/9sSa2PUtTCKW1s1czaPFhetFWzqWZVkEgEZOZ4fc1NhM3l9BZf0mV/Ni0V28mxmcVUG7DwV+xQs0EfhJ31sWVQ6Wa5kEWLtyN8OeXMNkuoHA+Gh307UyA/wu7u6DvSykM1deTSzmU/yJNNntA7xMy8aSLZN1OgQjmEkjAehhHmfGjq4CvcoZ/D03jJmihxfWPsHnZVo+lmwC1kkGu/EeAl3swMdjR1YBnueHtNPCEn7Mm8V/5MVZfpZxoopSwdu5mPF00cqcxN5+WzkW8BIpWriL8za+llHlYoknqigBNDOeNJ3M4AbeXjT+nq659RmBHjIFV1sD3+ByGkjRwfLCVwQoWZZ4JAWpoJEDmVwwL9/Nv3Bs7PhKbDGX8ErBvEOKvxWuXPQyjKXW7jRVo2AVYQ+/XecPl9BKA4FAA3sk+MqMUnuIF2gAmnmam4r3MyguBcXiN1BhcisImnI7ALdyGR8pWIMHkGJ0mXcmeqt6eLPfxGIjq/g0t9ECpMjQuf6HlRSP30mFGeCB482Klu32MoLzE9lca/Ce4tz8Yt0+KXr5R/HTel5slccuQIXp94jOU9kXWBaZyMNrR85zetiZgxNZzJPhTh4puHKaeJo71rfZiJVeKqGw/n8+HroSecNOV/j4QMeXJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJElSZP8f3PAEfSn3wvEAAAAASUVORK5CYII=" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  wood: '<image href="data:image/png;base64,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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  dollar: '<path fill="#fff" d="M13 2v2.1c2.5.3 4.2 1.8 4.6 4.1h-2c-.3-1.2-1.2-2.1-3.1-2.1-2 0-3 .8-3 2 0 1 .5 1.6 3.5 2.2 3.5.7 5.1 2 5.1 4.7 0 2.5-1.8 4.2-5.1 4.6V22h-2v-2.1c-2.9-.3-4.8-2-5.2-4.5h2.1c.3 1.5 1.4 2.5 3.6 2.5 2.2 0 3.4-.9 3.4-2.3 0-1.3-.8-2-3.9-2.7-3.2-.7-4.7-1.8-4.7-4.2 0-2.3 1.8-3.9 4.7-4.3V2h2Z"/>',
  info: '<path fill="#fff" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 5a1 1 0 1 0 2 0 1 1 0 0 0-2 0Zm0 3h2v6h-2v-6Z"/>',
  handicapParking: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  wheelchair: '<path fill="#fff" d="M13 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-5 7h4l1.5 3H17v2h-4.8L10 10H8V8Zm2.5 5.5a4.5 4.5 0 1 0 4.4-5.5h2.1a6.5 6.5 0 1 1-6.3 8h2.1a4.5 4.5 0 0 0-2.3-2.5Z"/>',
  restroom: '<path fill="#fff" d="M7 2.2a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Zm10 0a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8ZM4.5 7h5A1.5 1.5 0 0 1 11 8.5V14H9.2v8H7.6v-8H6.4v8H4.8v-8H3V8.5A1.5 1.5 0 0 1 4.5 7Zm10.7 0h3.6l3.1 8h-2.2l-.7-1.8V22h-1.6v-6h-.8v6H15v-8.8l-.7 1.8h-2.2l3.1-8Z"/><path fill="#fff" d="M12 3h1.2v18H12z" opacity=".95"/>',
  cross: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oFAQceC02LioMAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDc6Mjk6NDMrMDA6MDCCJ6BtAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA3OjI5OjQzKzAwOjAw83oY0QAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNzozMDoxMCswMDowMOD82f0AAAABb3JOVAHPoneaAAAGU0lEQVR42u3WgQmDQBBFwVxI/y1fKjAgBFZ9MxV8lHvs2i+g6j09AJgjABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABD2mR7AaXt6wKE1PYCzXAAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQJgAQtvb0givzcZ5gTQ+4MhfAMc//GfzHHwSA55OAQwIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQIAYQLA863pAde19vQCzrryL/PUbsYFwP94/rcjABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABC29vQCYIwLAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMIEAMK+0/MN+gtaNhoAAAAASUVORK5CYII=" width="24" height="24"/>',
  candle: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oFAQccKardqeUAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDc6Mjc6NDIrMDA6MDA6mZtqAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA3OjI3OjQyKzAwOjAwS8Qj1gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNzoyODo0MSswMDowMNwyQxkAAAABb3JOVAHPoneaAAAKFElEQVR42u3d23IbNxZAUXNq/v+XOQ+p1NiJLbHvAPZaD6lYiqwWmmcDklLk6/0DqPrP0xcAPEcAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwAIEwA2t4/3k9fAk8SAAgTgLL3T/8kSQAgTAC63r/5N2IEAMIEoOr9xZ/IEAAIE4Cm9wdvIUAAIEwAit4b3srSBADCBKDnveM9LEoAIEwAat4H3styBADCBKDl+x3eGSBFACBMAEo+292dAUIEAMIEoOPznd0ZIEMAIEwAKrbt6s4AEQIAYQLQsH1HdwZIEAAIE4CCfbu5M0CAAECYAKxv/07uDLA8AYAwAVjdsV3cGWBxAgBhArC24zu4M8DSBADCBGBl5+zezgALEwAIEwC+5wywLAFYl7HlWwIAYQKwqnP3f6eJRQkAhAnAms7fsZ0BliQAECYAK7pmt3YGWJAAQJgArOe6ndoZYDkCAGECsJprd2lngMUIAIQJwFqu36GdAZYiABAmACu5Z3d2BliIAECYAKzjvp3ZGWAZAgBhArCKe3dlZ4BFCACECcAa7t+RnQGWIAAQJgAreGY3dgZYgABAmADM77md2BlgegIAYQIwu2d3YWeAyQkAhAnA3J7fgZ+/Ag4QAAgTgJmNsfuOcRXsIgAQJgDzGmfnHedK2EgAIEwAZjXWrjvW1fAxAYAwAZiTHZdTCADnkKQpCQCECcCMxtxtx7wqviQAECYAECYA8xn3qD3ulfEHAgBhAgBhAgBhAjCbsb/PHvvq+BcBgDABgDABgDABgDABmMv4P2Qb/wr5iQBAmABAmABAmABAmABAmABAmABA2H+fvgAe8/rlT35/nyQARa8/vE0EcgSg5vXN+0Qgxc8AWl4n/BcsRABKPhtuCQgRgI7PB1sCMgSgYttQS0CEADRsH2gJSBAACBOAArs5fyAA/IlsBAjAXMYfyvGvkJ8IwPr2j6RhXp4AQJgAQJgAzGbrsfzYMf7ez8btBADCBGBtx3dke/rSBIDziMV0BGA+xozTCMDKzkmF4CxMAGY05kiOeVV8SQA4h/GfkgDM6ZNxO28kDfeyBGBWYw3lWFfDxwQAwgRgXq8D7x35c3EjAZjZGIM3xlWwiwDM7bXx7TN8Jm4kALN7dgCN/+S8NuD8nnpFP8O/ACeANby++NNMn4ObOQGs4s5zgOFfxsurQUOXbwEgTAAgTAAgTAAgTAAgzK8Ba777tY9f8aU4AUCYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAECYAKzt+As/eemopXlS0Dl9PpbvQ0/z+d7wuTyd6IQEYHTz7MC/v1JZGJoAjGWecd//FUnCQATgaeuN/LavWA4eJQD36438V+TgUQJwF2P/if+vkhTcQgCuZvD3+XvdhOBSAnCVUQd/toFyJriUAJxt1MGf318rKwOnEoCzGPx7+NbgVAJwnNF/wvuHCJxAAI4x/E/yTcFhArDf+sM/x1foLHDAa457PJy5lm3veDS+yjQB2M6SjUsENvJ8AFsZ/5G5OxsJwDYeYKNzhzYRgC08uGbgLm0gABAmAFv4EdMM3KUNBGAbD67RuUObCMBWHmAjc3c28v8B7GPZxmP4dxCAvSzcSAz/TgJwjOV7nuE/QACOs4TPMfwHCcBZLOS9jP4pBOBclvN6Rv9EAnANy3o+g38BAdhi+1NPWN7jtq+4VHzMMwJtte0B9vrpo9hm+xhb5c0EYI/tz0X3+tdH8zv7926ruosA7Lf3sCkGvzp6YLeGBwjAMUefl7Yag3O+Sy+t2EUE4AznPD31Pz9+pYf32T+WW2ltHiUA5zn7Wer/9DeN/eC/9ifwY3/tExKAs13/Ypbf/b3XDclzv14z+BcRgOs89Sp2K/0W3OBfTACu5wWutzL2txGAO/38wBaDXxn6RwjAU359wBdzYOQHIABj+OcwrBgEAz8gARjTv4dltiQY9ykIwCy+Gqin4mDIpycAKzCI7OR1ASBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMACBMAFjN6+kLmIkAbOGhNT73aBMB2MbDa2zuz0YCsJWH2Ljcm80EYDsPszG5Lzu83k9fwZws21gM/04CsJeFG4XhP0AAjrB4zzP+hwjAMZbvSYb/MAE4zhI+wfCfQgDOYRnvZPhPIwBnsZD3MPynEoAzWcxrGf7TCcDZLOg1DP8lBOAKFvVMRv9CAnAdS3uc4b+YAFzL8u5l9G8hAHewyFsY/RsJwF0s9PeM/u0E4F6W+/eM/kME4BmW/S8G/2EC8KTu4hv8QQjACDo3weAPRgDGsubtMPbDEoBRzX5jDP0UBGAGs9wkQz8dAZjPOLfMwE9PAFZwz0007gsSgIqvb7ThjhIACPPKQBAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABAmABD2P8ED7tF34/alAAAAAElFTkSuQmCC" width="24" height="24"/>',
  candy: '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAQAAABecRxxAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAAqo0jMgAAAAd0SU1FB+oFAQYWFAmYZ0kAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDUtMDFUMDY6MjI6MjArMDA6MDBQ1pEFAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA1LTAxVDA2OjIyOjIwKzAwOjAwIYspuQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNS0wMVQwNjoyMjoyMCswMDowMHaeCGYAAC0+SURBVHja7d13nBXV+cfxz91GVSGKimAsKIhoVGxYUVFRo7E3FDWiwQoIUWP8iViwoLEikViCFHuLBaNRiSUaO9hiQcWKoiiCtG3n98edXXZhd7l1njMz3zevly+33fucM+c898yZM2dARERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERIrE1f07ylW65S1we9b/3DpQEynrAESKyQF04XAq+COdmviFWdwAzGMiNeoMIrHhcLgS19Zd4p53K1PjzncVLpXUcYBIzATD+lPcR656pd3fOecWu/fd4UoAIrHgcLjBbnFGnb/Oz+4wpQCRiHN13X9RVt3fOed+dEckd0JQYs9l/C/Kgu6/MOvu75xzc9OjgGjXQOY08RkzK224ZWy1kqNezVu46DYMB9CXf9I6xxf4mZN4IMo1kI1klDIR6rv+AaxLbbO/1IVzKGvxhZYylNtSkf0IdCUcxF6cksdLfEkvFqhriLcaDNZTrjz4V+bWdePd7e77nIa+DU13ZfnHaFYzbdz/8iz/EndeUk4CInugk6q+WZazDo5q9uKPVAffa0MP6/g88Gc2zvMVWnEgY1ngEjBAVgKIhEafRp3Zhkq25jwcjla0KvCb1fJKVD/+HEBXSvN+oe0ZxzDmWpen+OKf4iJruT64GqdTAVSzPfsX9Y1/phdfR7FhOIDeTGDzgrzcoTwYxVrIjkYAXgo6fwntgCoOYBCt2C20t49uu9+YSWxa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" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  musicNote: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  music: '<path fill="#fff" d="M9 18.5A3.5 3.5 0 1 1 5.5 15H7V6.2L17 4v10.5A3.5 3.5 0 1 1 15 18v-8.4l-6 1.3v7.6Zm8-12-8 1.7v1.2l8-1.7V6.5Z"/>',
  paw: '<image href="data:image/png;base64,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" width="24" height="24"/>',
  snowflake: '<path fill="#fff" d="M11 2h2v4.17l2.12-2.12 1.41 1.41L13 9v2h2l3.54-3.54 1.41 1.41L17.83 11H22v2h-4.17l2.12 2.12-1.41 1.41L15 13h-2v2l3.54 3.54-1.41 1.41L13 17.83V22h-2v-4.17l-2.12 2.12-1.41-1.41L11 15v-2H9l-3.54 3.54-1.41-1.41L6.17 13H2v-2h4.17L4.05 8.88l1.41-1.41L9 11h2V9L7.46 5.46l1.41-1.41L11 6.17V2Z"/>',
  gate: '<path fill="#fff" d="M4 21V10.2A8 8 0 0 1 20 10.2V21h-3.2V10.6a4.8 4.8 0 0 0-9.6 0V21H4Zm4.4-1.2V10.8A3.6 3.6 0 0 1 12 7.3v12.5H8.4Zm4.2-12.5a3.6 3.6 0 0 1 3.6 3.5v8.8h-3.6V7.3Z"/>',
  pin: '<path fill="#fff" d="M12 2a6 6 0 0 1 6 6c0 4.7-6 12-6 12S6 12.7 6 8a6 6 0 0 1 6-6Zm0 2a4 4 0 0 0-4 4c0 2.5 2.5 6.5 4 8.7 1.5-2.2 4-6.2 4-8.7a4 4 0 0 0-4-4Z"/>'
};

// --- Deep-link support ---
// Supports ?loc=<id>, #loc=<id>, and /location/<id> patterns (MapMe compat)
function getDeepLinkedLocationId() {
  const pathMatch = window.location.pathname.match(/^\/location\/([^/?#]+)/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const params = new URLSearchParams(window.location.search);
  if (params.get('loc')) return params.get('loc');
  if (params.get('location')) return params.get('location');
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('loc=')) return hash.slice(4);
  // MapMe-style /location/<uuid> encoded in hash
  const locMatch = hash.match(/^location\/(.+)/);
  if (locMatch) return locMatch[1];
  return null;
}

function openDeepLinkedLocation() {
  const id = getDeepLinkedLocationId();
  if (!id) return;
  const location = appState.locations.find((loc) => loc.id === id || loc.name === id);
  if (!location) return;
  openLocation(location, true);
}

function updateUrlHash(locationId) {
  if (!locationId) {
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#loc=${encodeURIComponent(locationId)}`);
}

window.addEventListener('hashchange', () => {
  if (!map) return;
  openDeepLinkedLocation();
});

function showLoading(text) {
  const overlay = document.getElementById('loading-overlay');
  const textEl = overlay?.querySelector('.loading-text');
  if (overlay) {
    overlay.classList.remove('is-hidden');
    overlay.hidden = false;
  }
  if (textEl && text) textEl.textContent = text;
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('is-hidden');
    setTimeout(() => { overlay.hidden = true; }, 400);
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  const msgEl = document.getElementById('error-message');
  if (banner) banner.hidden = false;
  if (msgEl) msgEl.textContent = message;
}

async function init() {
  console.log('[filters] init:start');
  showLoading('Loading map data...');

  let data;
  try {
    data = await fetchMapData();
  } catch (err) {
    console.error('[init] failed to load map data', err);
    hideLoading();
    showError('Unable to load map data. Please refresh the page.');
    const retryBtn = document.getElementById('error-retry');
    if (retryBtn) retryBtn.addEventListener('click', () => { location.reload(); });
    return;
  }

  console.log('[filters] init:data-loaded', {
    categories: Array.isArray(data.categories) ? data.categories.length : 0,
    locations: Array.isArray(data.locations) ? data.locations.length : 0
  });
  appState.mapData = data;
  appState.venueStyleUrl = await resolveVenueStyleUrl(data.map?.style);
  appState.satelliteStyleUrl = resolveSatelliteStyleUrl();
  normalizeData(data);
  window.dispatchEvent(new CustomEvent('fairmap:data-ready'));
  console.log('[filters] init:locations-parsed', {
    locations: appState.locations.length,
    filtered: appState.filteredLocations.length
  });
  updateFilterCount('init:after-normalize');
  scheduleFilterCountRefresh(250, 'init:deferred-250ms');
  initializeSidebarState();
  initHeader();
  initBottomPanel();
  bindUi();
  applyFilters();
  renderBottomPanel();
  const initialMapView = resolveInitialMapView(data);

  showLoading('Initializing map...');

  map = new maplibregl.Map({
    container: 'map',
    style: appState.venueStyleUrl,
    center: initialMapView.center,
    zoom: initialMapView.zoom,
    pitch: 0,
    bearing: DEFAULT_BEARING,
    maxZoom: data.map?.maxZoom || 20,
    maxPitch: 85,
    attributionControl: false,
    antialias: true,
    cooperativeGestures: false,
    dragPan: true,
    touchZoomRotate: true,
    touchPitch: true,
    transformRequest: (url) => {
      // Route all MapTiler requests through our proxy to bypass referer restriction
      if (url && url.includes('api.maptiler.com/')) {
        try {
          const u = new URL(url);
          u.searchParams.delete('key');
          const path = u.pathname.slice(1) + u.search;
          return { url: `${window.location.origin}/api/mt?path=${encodeURIComponent(path)}` };
        } catch (e) {
          // Fallback: simple string replacement
          const path = url.replace(/https?:\/\/api\.maptiler\.com\//, '')
            .replace(/([?&])key=[^&]*&?/, '$1').replace(/[?&]$/, '');
          return { url: `${window.location.origin}/api/mt?path=${encodeURIComponent(path)}` };
        }
      }
    }
  });

  // Only show zoom/compass on desktop — mobile uses pinch-to-zoom
  if (window.innerWidth > 960) {
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  }

  geolocateControl = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    trackUserLocation: true,
    showUserHeading: true,
    showAccuracyCircle: true
  });
  map.addControl(geolocateControl, 'top-right');
  geolocateControl.on('geolocate', (event) => {
    const { longitude, latitude, accuracy } = event.coords || {};
    showLocationAccuracy(Number(longitude), Number(latitude), Number(accuracy));
    if (Number(accuracy) > 25) showLocationStatus(`GPS accuracy is about ${Math.round(accuracy)}m — tap ◎ to improve.`);
  });
  addImproveLocationControl();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '© <a href="https://www.maptiler.com/copyright/" target="_blank">MapTiler</a> | TheFairMap' }), 'bottom-left');

  // Mobile-friendly map controls: one finger pans; two fingers pinch/rotate/zoom/tilt.
  map.cooperativeGestures?.disable?.();
  map.dragPan?.enable?.();
  map.touchZoomRotate?.enable?.();
  map.touchPitch?.enable?.();

  // Parking button — wired from HTML
  document.getElementById('parking-btn')?.addEventListener('click', promptSaveParking);

  map.on('load', async () => {
    flattenShopperMap();
    // Resolve venue overlay tileset metadata before building layers
    appState.venueOverlayConfig = await resolveVenueOverlay();
    await hydrateStyleContent();
    bindMapEvents();
    // Deep-link: open location from URL hash or query param
    openDeepLinkedLocation();
    // Restore saved parking marker
    await hydrateGuestPreferences(getGuestProfile(), { mergeLocal: true });
    const savedParking = getSavedParking();
    if (savedParking) showParkingMarker(savedParking.lng, savedParking.lat);
    hideLoading();
  });

  map.on('error', (e) => {
    console.error('[map] error', e.error);
    hideLoading();
  });
}

function flattenShopperMap() {
  if (!map) return;
  try {
    if (typeof map.getTerrain === 'function' && map.getTerrain()) {
      map.setTerrain(null);
    } else if (typeof map.setTerrain === 'function') {
      map.setTerrain(null);
    }
  } catch (_) {
    // Terrain may be unsupported or already unset.
  }
  const layers = map.getStyle?.()?.layers || [];
  for (const layer of layers) {
    if (layer?.type !== 'fill-extrusion') continue;
    try {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    } catch (_) {
      // Layer may have been removed during a style swap.
    }
  }
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
  const tp = window.__TENANT_PARAM || '';
  const sources = ['/api/locations' + tp, '/data/mapme-full-export.json'];
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
    shape: category.shape || 'circle',
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
      const catalog = normalizeLocationCatalog(loc.catalog);
      return {
        id: String(loc.id || `loc-${idx}`),
        name,
        description: typeof loc.description === 'string' ? loc.description : '',
        address: typeof loc.address === 'string' ? loc.address : '',
        logoUrl: typeof loc.logoUrl === 'string' ? loc.logoUrl : '',
        photos: extractLocationPhotos(loc, catalog),
        catalog,
        catalogStoreType: String(loc.catalogStoreType || loc.catalog_type || loc.catalogType || '').trim().toLowerCase(),
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        zoom: Number(loc.zoom),
        pitch: Number(loc.pitch),
        bearing: Number(loc.bearing),
        categoryId,
        categoryName,
        shape: category?.shape || 'circle',
        color: normalizeColor(category?.color || loc.color || SHAPE_FALLBACK_COLORS[category?.shape] || SHAPE_FALLBACK_COLORS.circle),
        iconType: iconTypeForCategory(categoryId, categoryName),
        search: `${loc.name || ''} ${categoryName} ${loc.address || ''} ${loc.description || ''} ${catalog.map((item) => `${item.name} ${item.description} ${item.price}`).join(' ')}`.toLowerCase()
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
      shape: sample?.shape || 'circle',
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

// ── Search Suggestions ───────────────────────────────────────────────────
const MAX_SUGGESTIONS = 12;

function getActiveSearchQuery() {
  return (
    document.getElementById('search-input')?.value ||
    document.getElementById('mobile-search-input')?.value ||
    document.getElementById('header-search-input')?.value ||
    ''
  ).trim().toLowerCase();
}

function collectSearchMatches(query, locations = appState.locations) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return [];

  const scored = [];
  for (const loc of locations) {
    if (!loc.search.includes(normalized)) continue;
    const name = String(loc.name || '').toLowerCase();
    const address = String(loc.address || '').toLowerCase();
    const categoryName = String(appState.categoriesById.get(loc.categoryId)?.name || loc.categoryName || '').toLowerCase();
    const description = String(loc.description || '').toLowerCase();

    let score = 0;
    if (name.startsWith(normalized)) score += 400;
    else if (name.includes(normalized)) score += 300;
    if (address.includes(normalized)) score += 120;
    if (categoryName.includes(normalized)) score += 90;
    if (description.includes(normalized)) score += 40;

    scored.push({ loc, score });
  }

  scored.sort((a, b) => b.score - a.score || a.loc.name.localeCompare(b.loc.name));
  return scored.map((item) => item.loc);
}

function buildSuggestionItems(query) {
  return collectSearchMatches(query, appState.locations).slice(0, MAX_SUGGESTIONS);
}

function renderSuggestions(dropdownEl, query) {
  if (!dropdownEl) return;
  if (!query || query.length < 1) {
    dropdownEl.innerHTML = '';
    dropdownEl.classList.remove('is-visible');
    return;
  }
  const results = buildSuggestionItems(query);
  dropdownEl.innerHTML = '';
  if (results.length === 0) {
    dropdownEl.innerHTML = '<div class="search-suggestions-empty">No results found</div>';
    dropdownEl.classList.add('is-visible');
    return;
  }
  for (const loc of results) {
    const cat = appState.categoriesById.get(loc.categoryId);
    const color = normalizeColor(cat?.color || loc.color);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-suggestion-item';
    btn.setAttribute('role', 'option');
    btn.innerHTML = `
      <span class="search-suggestion-dot" style="background:${color};"></span>
      <span class="search-suggestion-info">
        <span class="search-suggestion-name">${escapeHtml(loc.name)}</span>
        <span class="search-suggestion-category">${escapeHtml(cat?.name || loc.categoryName)}</span>
      </span>
    `;
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent blur before click fires
      openLocation(loc, true);
      closeSuggestions();
    });
    dropdownEl.appendChild(btn);
  }
  dropdownEl.classList.add('is-visible');
}

function closeSuggestions() {
  document.querySelectorAll('.search-suggestions').forEach((el) => {
    el.classList.remove('is-visible');
    el.innerHTML = '';
  });
}

function buildSearchResultBooth(address) {
  const booth = sanitizeMetaAddress(address);
  if (!booth) return 'Visit location';
  if (/booth|arbor|pavilion|gate|food court|civic center|trade grounds|lot|suite|space/i.test(booth)) return booth;
  return `Booth ${booth}`;
}

function buildSearchResultVisual(loc, color) {
  const photo = Array.isArray(loc.photos) && loc.photos.length ? loc.photos[0] : '';
  if (photo) {
    return `<span class="search-result-thumb"><img src="${escapeAttr(photo)}" alt="${escapeAttr(loc.name)}" loading="lazy"></span>`;
  }
  const initial = escapeHtml((loc.name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="search-result-thumb search-result-thumb-fallback" style="background:${escapeAttr(color)};color:${pickTextColor(color)};">${initial}</span>`;
}

function dismissSearchResults(resetQuery = false) {
  if (resetQuery) {
    ['search-input', 'mobile-search-input', 'header-search-input'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }
  closeSuggestions();
  document.querySelectorAll('.search-results-panel').forEach((panel) => {
    panel.innerHTML = '';
    panel.hidden = true;
  });
  if (resetQuery) applyFilters();
}

function clearSearchResults() {
  dismissSearchResults(true);
}

function renderSearchResultsPanel(panelEl, results) {
  if (!panelEl) return;
  panelEl.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'search-results-summary';
  summary.innerHTML = `
    <span class="search-results-count">${results.length} ${results.length === 1 ? 'match' : 'matches'}</span>
    <span class="search-results-summary-actions">
      <span class="search-results-hint">Tap Visit to open</span>
      <button type="button" class="search-results-close" aria-label="Close search results">Close</button>
    </span>
  `;
  summary.querySelector('.search-results-close')?.addEventListener('click', clearSearchResults);
  panelEl.appendChild(summary);

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-results-empty';
    empty.textContent = 'No vendors match that search yet. Try a booth number, vendor name, or product keyword.';
    panelEl.appendChild(empty);
    panelEl.hidden = false;
    return;
  }

  const list = document.createElement('div');
  list.className = 'search-results-list';

  for (const loc of results) {
    const category = appState.categoriesById.get(loc.categoryId);
    const color = normalizeColor(category?.color || loc.color);
    const booth = buildSearchResultBooth(loc.address);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result-card';
    if (String(loc.id) === String(appState.selectedLocationId)) button.classList.add('is-selected');
    button.innerHTML = `
      ${buildSearchResultVisual(loc, color)}
      <span class="search-result-copy">
        <span class="search-result-name">${escapeHtml(loc.name)}</span>
        <span class="search-result-meta">${escapeHtml(booth)}</span>
      </span>
      <span class="search-result-visit">Visit</span>
    `;
    button.addEventListener('click', () => {
      dismissSearchResults(true);
      openLocation(loc, true);
    });
    list.appendChild(button);
  }

  panelEl.appendChild(list);
  panelEl.hidden = false;
}

function renderSearchResults(query) {
  const sidebarPanel = document.getElementById('sidebar-search-results');
  const mobilePanel = document.getElementById('mobile-search-results');
  const panels = [sidebarPanel, mobilePanel].filter(Boolean);
  if (!panels.length) return;

  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) {
    panels.forEach((panel) => {
      panel.innerHTML = '';
      panel.hidden = true;
    });
    return;
  }

  const results = collectSearchMatches(normalized, appState.filteredLocations);
  panels.forEach((panel) => renderSearchResultsPanel(panel, results));
}

function getSearchFitPadding() {
  const mobile = window.innerWidth <= 960;
  if (mobile) {
    return { top: 88, right: 16, bottom: 180, left: 16 };
  }

  const app = document.getElementById('app');
  const sidebarVisible = app && !app.classList.contains('sidebar-collapsed');
  return { top: 64, right: 40, bottom: 56, left: sidebarVisible ? 400 : 72 };
}

function areSearchLocationsVisible(locations) {
  if (!map || !locations.length) return false;
  const bounds = map.getBounds();
  return locations.every((loc) => bounds.contains([loc.lng, loc.lat]));
}

function maybeFitMapToSearchResults(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!map || !normalized) {
    appState.lastSearchFitSignature = '';
    return;
  }

  const locations = appState.filteredLocations.filter(
    (loc) => Number.isFinite(loc.lng) && Number.isFinite(loc.lat)
  );
  const signature = `${normalized}|${locations.map((loc) => loc.id).join(',')}`;
  if (signature === appState.lastSearchFitSignature) return;
  appState.lastSearchFitSignature = signature;

  if (!locations.length) return;

  if (locations.length === 1) {
    const [loc] = locations;
    const isVisible = map.getBounds().contains([loc.lng, loc.lat]);
    if (isVisible && map.getZoom() >= 16) return;
    map.flyTo({
      center: [loc.lng, loc.lat],
      zoom: Math.max(16, Math.min(Number.isFinite(loc.zoom) ? loc.zoom : 17.25, 18.25)),
      duration: 700,
      essential: true
    });
    return;
  }

  if (areSearchLocationsVisible(locations)) return;

  const bounds = new maplibregl.LngLatBounds(
    [locations[0].lng, locations[0].lat],
    [locations[0].lng, locations[0].lat]
  );
  for (const loc of locations.slice(1)) {
    bounds.extend([loc.lng, loc.lat]);
  }

  map.fitBounds(bounds, {
    padding: getSearchFitPadding(),
    maxZoom: 16.5,
    duration: 800,
    essential: true
  });
}

function bindSearchSuggestions(inputEl, dropdownEl) {
  if (!inputEl || !dropdownEl) return;
  inputEl.addEventListener('input', () => {
    renderSuggestions(dropdownEl, inputEl.value.trim());
  });
  inputEl.addEventListener('focus', () => {
    const q = inputEl.value.trim();
    if (q) renderSuggestions(dropdownEl, q);
  });
  inputEl.addEventListener('blur', () => {
    // Small delay to allow mousedown on suggestion to fire
    setTimeout(() => dropdownEl.classList.remove('is-visible'), 150);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSuggestions();
      inputEl.blur();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = dropdownEl.querySelectorAll('.search-suggestion-item');
      if (!items.length) return;
      const active = dropdownEl.querySelector('.search-suggestion-item.is-active');
      let idx = Array.from(items).indexOf(active);
      if (e.key === 'ArrowDown') idx = idx < items.length - 1 ? idx + 1 : 0;
      else idx = idx > 0 ? idx - 1 : items.length - 1;
      items.forEach((it) => it.classList.remove('is-active'));
      items[idx].classList.add('is-active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') {
      const active = dropdownEl.querySelector('.search-suggestion-item.is-active');
      if (active) {
        e.preventDefault();
        active.click();
      }
    }
  });
}

function bindUi() {
  const searchInput = document.getElementById('search-input');
  const mobileSearchInput = document.getElementById('mobile-search-input');
  const headerSearchInput = document.getElementById('header-search-input');
  const syncSearch = (value, source) => {
    if (searchInput && source !== searchInput) searchInput.value = value;
    if (mobileSearchInput && source !== mobileSearchInput) mobileSearchInput.value = value;
    if (headerSearchInput && source !== headerSearchInput) headerSearchInput.value = value;
    // Close suggestions on other inputs when syncing
    document.querySelectorAll('.search-suggestions').forEach((el) => el.classList.remove('is-visible'));
  };

  // Bind search suggestions
  bindSearchSuggestions(headerSearchInput, document.getElementById('header-search-suggestions'));
  bindSearchSuggestions(searchInput, document.getElementById('sidebar-search-suggestions'));

  searchInput.addEventListener('input', () => {
    syncSearch(searchInput.value, searchInput);
    applyFilters();
  });
  mobileSearchInput?.addEventListener('input', () => {
    syncSearch(mobileSearchInput.value, mobileSearchInput);
    applyFilters();
  });

  document.getElementById('select-all-btn')?.addEventListener('click', () => {
    appState.categories.forEach((cat) => appState.activeCategories.add(cat.id));
    applyFilters();
  });
  document.getElementById('deselect-all-btn')?.addEventListener('click', () => {
    appState.activeCategories.clear();
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
  document.getElementById('mobile-peek-bar')?.addEventListener('click', () => setMobileSidebarOpen(true));
  document.getElementById('mobile-sheet-collapse')?.addEventListener('click', () => setMobileSidebarOpen(false));
  document.getElementById('style-venue-btn').addEventListener('click', () => setMapStyle('venue'));
  document.getElementById('style-satellite-btn').addEventListener('click', () => setMapStyle('satellite'));
  document.getElementById('venue-overlay-toggle')?.addEventListener('click', toggleVenueOverlay);
  document.getElementById('mobile-scrim').addEventListener('click', closeMobileSidebar);
  document.getElementById('detail-scrim').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-close').addEventListener('click', closeDetailPanel);
  bindMobileGestures();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSuggestions();
      closeDetailPanel();
      closeMobileSidebar();
    }
  });

  // Close suggestions when clicking outside search areas
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.header-search-wrap') && !event.target.closest('.sidebar-search-wrap')) {
      closeSuggestions();
    }
  });

  window.addEventListener('resize', () => {
    const mobile = window.innerWidth <= 960;
    const mobileCollapse = document.getElementById('mobile-sheet-collapse');
    if (!mobile) {
      const mobileScrim = document.getElementById('mobile-scrim');
      mobileScrim.hidden = true;
      mobileScrim.classList.remove('is-open');
      if (mobileCollapse) mobileCollapse.hidden = true;
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
      if (mobileCollapse) mobileCollapse.hidden = !app.classList.contains('mobile-sidebar-open');
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
  const mobileCollapse = document.getElementById('mobile-sheet-collapse');
  if (mobileCollapse) mobileCollapse.hidden = !mobile;
  updateSidebarToggle(appState.sidebarOpen);
  updateMobileCategoriesButton();
  updateMapStyleButtons();
  updateMapBrandOverlayPosition();
}

function updateMapBrandOverlayPosition() {
  // Positioning handled entirely by CSS (left:0; right:0; justify-content:center)
}

async function loadMarkerIcons() {
  // Legacy icon-only images (kept for fallback)
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

// Build composite marker: colored circle + white border + bold white icon — single atomic image
// Uses generic ICON_SVGS path (24×24 viewBox)
function buildCompositeMarkerSvg(iconType, bgColor) {
  const markup = ICON_SVGS[iconType] || ICON_SVGS.pin;
  const tinted = markup.replace(/fill=\"#[0-9a-f]{3,8}\"/gi, `fill="#ffffff"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <circle cx="40" cy="40" r="36" fill="${bgColor}" stroke="#ffffff" stroke-width="4"/>
    <g transform="translate(16,16) scale(2)">${tinted}</g>
  </svg>`;
}

// Build composite using actual MapMe category SVG content (100×100 viewBox paths)
function buildCompositeFromCategorySvg(svgContent, bgColor) {
  // Extract inner paths from the MapMe SVG (nested SVG with viewBox 0 0 100 100)
  const pathMatch = svgContent.match(/<svg[^>]*viewBox="0 0 100 100"[^>]*>([\s\S]*?)<\/svg>/i);
  const innerPaths = pathMatch ? pathMatch[1] : '';
  if (!innerPaths) return null;
  // Force all fills to white
  const whitePaths = innerPaths.replace(/fill="[^"]*"/gi, 'fill="#ffffff"');
  // 80×80 canvas: icon from 100×100 viewBox scaled to fit inside circle (r=36 → diameter 72)
  // Scale 100→48 = 0.48, offset to center: (80-48)/2 = 16
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <circle cx="40" cy="40" r="36" fill="${bgColor}" stroke="#ffffff" stroke-width="4"/>
    <g transform="translate(16,16) scale(0.48)">${whitePaths}</g>
  </svg>`;
}

function compositeImageId(categoryId, iconType, color) {
  // Use categoryId when available (unique per category SVG), fall back to iconType
  const key = categoryId || iconType;
  return `composite-${color.replace('#', '')}-${key}`;
}

// Cache fetched SVG file contents
const _svgFileCache = new Map();

async function fetchSvgFile(filename) {
  if (_svgFileCache.has(filename)) return _svgFileCache.get(filename);
  try {
    const res = await fetch(`/data/${filename}`);
    if (!res.ok) { _svgFileCache.set(filename, null); return null; }
    const text = await res.text();
    _svgFileCache.set(filename, text);
    return text;
  } catch { _svgFileCache.set(filename, null); return null; }
}

async function buildLogoMarkerImage(logoUrl, size = 80) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const r = size / 2;
      // White border
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // Clip to inner circle and draw logo
      ctx.save();
      ctx.beginPath();
      ctx.arc(r, r, r - 3, 0, Math.PI * 2);
      ctx.clip();
      const scale = Math.min((size - 6) / img.width, (size - 6) / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, r - w / 2, r - h / 2, w, h);
      ctx.restore();
      resolve(ctx.getImageData(0, 0, size, size));
    };
    img.onerror = reject;
    img.src = logoUrl;
  });
}

async function ensureCompositeImages(locations) {
  const seen = new Set();
  for (const loc of locations) {
    // Per-vendor logo marker
    if (loc.logoUrl) {
      const logoId = `logo-${loc.id}`;
      if (!seen.has(logoId) && !map.hasImage(logoId)) {
        seen.add(logoId);
        try {
          const imageData = await buildLogoMarkerImage(loc.logoUrl);
          map.addImage(logoId, imageData, { pixelRatio: 2 });
        } catch (_) { /* fall through to category icon */ }
      }
      if (map.hasImage(logoId)) continue;
    }

    const color = loc.color || '#7a7a7a';
    const iconType = loc.iconType || 'pin';
    const id = compositeImageId(loc.categoryId, iconType, color);
    if (seen.has(id) || map.hasImage(id)) continue;
    seen.add(id);

    // Try actual MapMe category SVG first
    const svgFile = appState.categoryIconFiles.get(loc.categoryId);
    let svg = null;
    if (svgFile) {
      const svgContent = await fetchSvgFile(svgFile);
      if (svgContent) svg = buildCompositeFromCategorySvg(svgContent, color);
    }
    // Fallback to generic icon
    if (!svg) svg = buildCompositeMarkerSvg(iconType, color);

    const image = await loadSvgImage(svg);
    map.addImage(id, image, { pixelRatio: 2 });
  }
}

function resolveMarkerImageId(loc) {
  const fallbackId = compositeImageId(loc.categoryId, loc.iconType || 'pin', loc.color || '#7a7a7a');
  if (!loc.logoUrl) return fallbackId;
  const logoId = `logo-${loc.id}`;
  if (map?.hasImage?.(logoId)) return logoId;
  return fallbackId;
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

function findFirstSymbolLayer() {
  // Find the first symbol (label) layer in the base map style so we can
  // insert the venue raster overlay beneath it. Road names stay readable
  // above the coloured pavilion tiles. 3D building extrusions are hidden.
  const layers = map.getStyle().layers || [];
  for (const layer of layers) {
    if (layer.type === 'symbol') return layer.id;
  }
  return undefined; // fallback: add on top
}

function addVenueOverlay() {
  // Only add venue overlay when in venue map mode (not satellite)
  if (appState.activeMapStyle === 'satellite') return;
  // Raster overlay from MapMe's custom MapTiler tileset, proxied via /api/tile
  // (the live /api/mt and /api/venue-tile paths 404; /api/tile returns image/png)
  // Shows colored pavilion rows and booth numbers matching MapMe viewer
  if (map.getSource('venue-overlay')) return;
  const cfg = appState.venueOverlayConfig;
  const defaultBounds = [-95.87783605142862, 32.55078690554766, -95.85260241651899, 32.57611879608321];
  map.addSource('venue-overlay', {
    type: 'raster',
    tiles: [`${window.location.origin}/api/tile?z={z}&x={x}&y={y}`],
    tileSize: 256,
    minzoom: cfg?.minzoom ?? 14,
    maxzoom: cfg?.maxzoom ?? 22,
    bounds: cfg?.bounds ?? defaultBounds,
    attribution: 'Map data © First Monday Trade Days'
  });
  // Insert below the first symbol layer so base-map labels stay on top
  const beforeId = findFirstSymbolLayer();
  map.addLayer({
    id: 'venue-overlay-layer',
    type: 'raster',
    source: 'venue-overlay',
    paint: {
      // Fade in as user zooms closer — full detail at booth-level zoom
      'raster-opacity': [
        'interpolate', ['linear'], ['zoom'],
        14, 0.0,
        15, 0.72,
        16, 0.88,
        18, 0.94
      ]
    }
  }, beforeId);
  // Sync toggle button state
  const btn = document.getElementById('venue-overlay-toggle');
  if (btn) btn.classList.add('is-active');
}

function toggleVenueOverlay() {
  if (!map) return;
  const layer = map.getLayer('venue-overlay-layer');
  if (!layer) return;
  const current = map.getLayoutProperty('venue-overlay-layer', 'visibility');
  const next = current === 'none' ? 'visible' : 'none';
  map.setLayoutProperty('venue-overlay-layer', 'visibility', next);
  const btn = document.getElementById('venue-overlay-toggle');
  if (btn) btn.classList.toggle('is-active', next === 'visible');
}

function buildLayers() {
  if (map.getSource(SOURCE_ID)) return;

  addVenueOverlay();

  map.addSource(SOURCE_ID, {
    type: 'geojson',
    data: toFeatureCollection([]),
    generateId: true,
    cluster: false
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

  // Composite markers: colored circle + white icon baked into a single image
  // This prevents icons from spilling over adjacent markers' circles
  map.addLayer({
    id: LAYER_MARKERS,
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'isVisualMarker'], true]],
    layout: {
      'icon-image': ['coalesce', ['get', 'iconImage'], 'pin-white'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-padding': 0,
      'symbol-sort-key': ['to-number', ['id'], 0],
      'icon-size':
        ['interpolate', ['linear'], ['zoom'],
          13, 0.48,
          15, 0.62,
          16, 0.72,
          17, 0.8,
          18, 0.9,
          20, 1.05
        ]
    }
  });

  map.addLayer({
    id: 'visual-marker-labels',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'isVisualMarker'], true]],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        14, 11,
        16, 13,
        19, 16
      ],
      'text-letter-spacing': 0.06,
      'text-transform': 'uppercase',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport'
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.72)',
      'text-halo-width': 2
    },
    minzoom: 14
  });

  // LAYER_ICONS kept as alias for click/hover event compatibility
  // (no separate layer needed — LAYER_MARKERS now renders full composite)

  map.addLayer({
    id: LAYER_HOVER,
    type: 'circle',
    source: SOURCE_ID,
    filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'isVisualMarker'], true], ['!=', ['get', 'shape'], 'none'], ['==', ['id'], -1]],
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
    filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'isVisualMarker'], true], ['!=', ['get', 'shape'], 'none'], ['==', ['get', 'id'], '']],
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
    { name: 'Arbor 1',      lng: -95.86195, lat: 32.56064 },
    { name: 'Arbor 2',      lng: -95.86155, lat: 32.56053 },
    { name: 'Trade Center', lng: -95.86177, lat: 32.56135 },
    { name: 'Food Court',   lng: -95.86230, lat: 32.56030 },
    { name: 'Boardwalk',    lng: -95.86086, lat: 32.56071 },
    { name: 'PARKING',      lng: -95.86415, lat: 32.55695 }
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
      'text-ignore-placement': true,
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport'
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.7)',
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

  map.on('mouseenter', LAYER_CLUSTERS, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', LAYER_CLUSTERS, () => {
    map.getCanvas().style.cursor = '';
  });

  map.on('mouseenter', LAYER_MARKERS, onMarkerMouseEnter);
  map.on('mouseleave', LAYER_MARKERS, onMarkerMouseLeave);
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
  const query = getActiveSearchQuery();

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
  renderSearchResults(query);
  maybeFitMapToSearchResults(query);
  renderBottomPanel();
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

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'category-row';
  row.title = `Show ${category.name} locations`;
  row.innerHTML = `
    <span class="category-dot" style="background:${category.color};"></span>
    <span class="category-name">${escapeHtml(category.name)}</span>
    <span class="category-count">${visibleCounts.get(category.id) || 0}</span>
  `;
  row.addEventListener('click', () => {
    appState.sidebarView = 'locations';
    appState.selectedCategoryId = category.id;
    renderOverview(query);
  });

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

  // Render My Favorites first (special group)
  const favIds = getFavorites();
  const favLocations = favIds.map(id => appState.locations.find(l => String(l.id) === id)).filter(Boolean);
  {
    const section = document.createElement('section');
    section.className = 'category-group favorites-group';
    const expanded = appState.groupExpanded.get('favorites') === true;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'category-group-header';
    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'group-expand-btn';
    expandBtn.setAttribute('aria-expanded', String(expanded));
    expandBtn.innerHTML = `
      <svg class="category-group-chevron${expanded ? ' is-open' : ''}" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
      <span class="category-group-icon"></span>
      <span class="category-group-name">My Favorites</span>
      <span class="category-group-count">${favLocations.length}</span>
    `;
    expandBtn.querySelector('.category-group-icon').innerHTML = makeGroupIcon('#f5a623', '<path fill="#fff" d="m12 2 2.9 6.1L22 9.2l-5 4.8 1.2 7-6.2-3.4L5.8 21 7 14 2 9.2l7.1-1.1L12 2Z"/>');
    expandBtn.addEventListener('click', async () => {
      const opening = !expanded;
      if (opening) {
        const profile = getGuestProfile() || await showGuestProfileModal('recover-favorites');
        if (profile) await hydrateGuestPreferences(profile, { mergeLocal: true });
      }
      appState.groupExpanded.set('favorites', opening);
      renderOverview(query);
    });
    groupHeader.appendChild(expandBtn);
    section.appendChild(groupHeader);

    const groupBody = document.createElement('div');
    groupBody.className = 'category-group-body';
    groupBody.hidden = !expanded;
    // Saved parking shortcut
    const parking = getSavedParking();
    if (parking) {
      const parkRow = document.createElement('button');
      parkRow.type = 'button';
      parkRow.className = 'category-location-row parking-fav-row';
      parkRow.innerHTML = `
        <span class="category-location-dot parking-dot" style="--dot-color:#2563eb;">&#128663;</span>
        <span class="category-location-main">
          <span class="category-location-name">My Car</span>
          <span class="category-location-address">Saved parking location</span>
        </span>
      `;
      parkRow.addEventListener('click', () => {
        map.flyTo({ center: [parking.lng, parking.lat], zoom: 18 });
        showParkingMarker(parking.lng, parking.lat);
        parkingMarker.togglePopup();
      });
      groupBody.appendChild(parkRow);
    }

    if (favLocations.length === 0 && !parking) {
      const empty = document.createElement('p');
      empty.className = 'category-empty';
      empty.textContent = 'Tap the star on any vendor to save it here.';
      groupBody.appendChild(empty);
    } else {
      for (const loc of favLocations) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'category-location-row';
        row.innerHTML = `
          <span class="category-location-dot" style="--dot-color:${escapeAttr(normalizeColor(loc.color))};"></span>
          <span class="category-location-main">
            <span class="category-location-name">${escapeHtml(loc.name)}</span>
            <span class="category-location-address">${escapeHtml(sanitizeMetaAddress(loc.address) || loc.categoryName || '')}</span>
          </span>
        `;
        row.addEventListener('click', () => openLocation(loc, true));
        groupBody.appendChild(row);
      }
    }
    section.appendChild(groupBody);
    wrap.appendChild(section);
  }

  for (const group of groups) {
    if (group.id === 'favorites') continue; // already rendered above
    const groupVisible = group.categories.reduce((sum, category) => sum + (visibleCounts.get(category.id) || 0), 0);
    const groupTotal = group.categories.reduce((sum, category) => sum + (category.count || 0), 0);
    const autoExpand = Boolean(query) && groupVisible > 0;
    const expanded = autoExpand || appState.groupExpanded.get(group.id) === true;

    const section = document.createElement('section');
    section.className = 'category-group';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'category-group-header';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'group-expand-btn';
    expandBtn.setAttribute('aria-expanded', String(expanded));
    expandBtn.innerHTML = `
      <svg class="category-group-chevron${expanded ? ' is-open' : ''}" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
      <span class="category-group-icon"></span>
      <span class="category-group-name">${escapeHtml(group.label)}</span>
      <span class="category-group-count">${groupVisible}/${groupTotal}</span>
    `;
    expandBtn.querySelector('.category-group-icon').innerHTML = group.icon;
    expandBtn.addEventListener('click', () => {
      appState.groupExpanded.set(group.id, !expanded);
      renderOverview(query);
    });

    groupHeader.appendChild(expandBtn);
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
  const locations = appState.locations.filter((loc) => loc.categoryId === category.id);
  if (locations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'category-empty';
    empty.textContent = 'No locations in this category.';
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
  closeSuggestions();
  appState.selectedLocationId = location.id;
  updateUrlHash(location.id);
  syncSelectedLayer();

  renderDetail(location);

  if (fly) {
    const flyZoom = Number.isFinite(location.zoom) ? Math.min(location.zoom, 18.5) : 18;
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: flyZoom,
      bearing: DEFAULT_BEARING,
      duration: 800
    });
  }
  showAnchorPopup(location, [location.lng, location.lat], true);

  if (window.innerWidth <= 960) {
    closeMobileSidebar();
  }

  const currentQuery = getActiveSearchQuery();
  renderOverview(currentQuery);
  renderSearchResults(currentQuery);
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
  const catalog = Array.isArray(location.catalog) ? location.catalog : [];
  const mediaUrls = Array.isArray(location.photos) ? location.photos : [];
  const hero = mediaUrls.length
    ? renderDetailHero(mediaUrls, `${location.name} photo`)
    : '';
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${location.lat},${location.lng}`)}`;
  const metaLine = [sanitizeMetaAddress(location.address), categoryName].filter(Boolean).join(' | ');
  const activeRoute = appState.activeRoute && String(appState.activeRoute.locationId) === String(location.id)
    ? appState.activeRoute
    : null;
  const routeSummaryHtml = activeRoute ? `
    <section class="detail-route-summary" style="margin:14px 0 0;padding:12px 14px;border-radius:16px;background:rgba(22,163,74,0.10);border:1px solid rgba(22,163,74,0.22);">
      <div style="font-size:0.72rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#166534;">Walking Guide Active</div>
      <div style="margin-top:5px;font-size:0.95rem;font-weight:700;color:#14532d;">${escapeHtml(formatRouteEta(activeRoute.etaMinutes))} · ${escapeHtml(formatRouteDistance(activeRoute.distanceMeters))}</div>
      <div style="margin-top:4px;font-size:0.82rem;line-height:1.45;color:#166534;">Starting from ${escapeHtml(activeRoute.originLabel)}. This path is approximate on the First Monday grounds.</div>
    </section>
  ` : '';

  // Photo gallery (multiple images)
  let mediaHtml = '';
  if (mediaUrls.length > 1) {
    const thumbs = mediaUrls.slice(0, 5).map((p, i) =>
      `<button class="detail-thumb${i === 0 ? ' active' : ''}" onclick="switchDetailPhoto('${escapeAttr(p)}')" style="background-image:url('${escapeAttr(p)}')"></button>`
    ).join('');
    mediaHtml = `<div class="detail-media">
      ${renderDetailHero(mediaUrls, location.name, 'detail-hero-img')}
      <div class="detail-thumbs">${thumbs}</div>
    </div>`;
  } else if (hero) {
    mediaHtml = `<div class="detail-media">${hero}</div>`;
  }

  // Video embed
  let videoHtml = '';
  if (location.videoUrl) {
    const embedUrl = buildVideoEmbedUrl(location.videoUrl);
    if (embedUrl) {
      videoHtml = `<div class="detail-video-wrap">
        <iframe src="${escapeAttr(embedUrl)}" frameborder="0" allowfullscreen loading="lazy" title="Video"></iframe>
      </div>`;
    }
  }

  // Website + social links
  let linksHtml = '';
  const linkBtns = [];
  if (location.website) {
    linkBtns.push(`<a class="detail-btn secondary" href="${escapeAttr(location.website)}" target="_blank" rel="noopener noreferrer">🌐 Website</a>`);
  }
  if (location.socialLinks) {
    const nets = { facebook: '📘 Facebook', instagram: '📸 Instagram', twitter: '𝕏 X/Twitter', tiktok: '🎵 TikTok' };
    for (const [key, label] of Object.entries(nets)) {
      if (location.socialLinks[key]) {
        linkBtns.push(`<a class="detail-btn social-btn" href="${escapeAttr(location.socialLinks[key])}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      }
    }
  }
  if (linkBtns.length) linksHtml = `<div class="detail-social-links">${linkBtns.join('')}</div>`;

  const catalogHtml = catalog.length ? `
    <section class="detail-product-section">
      <div class="detail-product-header">
        <div class="detail-product-kicker">Products</div>
        <div class="detail-product-count">${catalog.length} item${catalog.length === 1 ? '' : 's'}</div>
      </div>
      <div class="detail-product-list">
        ${catalog.map((item) => `
          <article class="detail-product-card" data-product-id="${escapeAttr(item.id)}">
            ${item.image ? `
              <div class="detail-product-thumb">
                <img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}" loading="lazy">
              </div>
            ` : `
              <div class="detail-product-thumb detail-product-thumb-fallback" aria-hidden="true">ITEM</div>
            `}
            <div class="detail-product-copy">
              <div class="detail-product-top">
                <strong>${escapeHtml(item.name)}</strong>
                ${item.price ? `<span class="detail-product-price">${escapeHtml(item.price)}</span>` : ''}
              </div>
              ${item.description ? `<div class="detail-product-desc">${escapeHtml(item.description)}</div>` : ''}
              ${item.link ? `<a class="detail-product-link" href="${escapeAttr(item.link)}" target="_blank" rel="noopener noreferrer">View product</a>` : ''}
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  ` : '';

  const faved = isFavorite(location.id);
  content.innerHTML = `
    ${mediaHtml}
    <header class="detail-header mapme-detail-header">
      <div class="detail-title-row">
        <h2 class="detail-title">${escapeHtml(location.name)}</h2>
        <div class="detail-title-actions">
          <button id="detail-share-icon-btn" class="detail-icon-btn detail-share-icon-btn" type="button" aria-label="Share ${escapeAttr(location.name)}" title="Share this vendor" data-loc-id="${escapeAttr(String(location.id))}">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11C16.5 7.69 17.21 8 18 8c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92S20.92 20.61 20.92 19 19.61 16.08 18 16.08Z"/></svg>
          </button>
          <button id="detail-fav-btn" class="detail-fav-btn${faved ? ' is-faved' : ''}" type="button" aria-label="${faved ? 'Remove from favorites' : 'Add to favorites'}" data-loc-id="${escapeAttr(String(location.id))}">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="m12 2 2.9 6.1L22 9.2l-5 4.8 1.2 7-6.2-3.4L5.8 21 7 14 2 9.2l7.1-1.1L12 2Z"/></svg>
          </button>
        </div>
      </div>
      ${metaLine ? `<p class="detail-meta">${escapeHtml(metaLine)}</p>` : ''}
      <div class="detail-badge" style="background:${color};color:${pickTextColor(color)};">${escapeHtml(categoryName)}</div>
    </header>
    ${routeSummaryHtml}
    <section class="detail-body">
      <div class="detail-description">${description}</div>
      ${catalogHtml}
      ${videoHtml}
    </section>
    ${linksHtml}
    <div class="detail-actions">
      <button class="detail-btn primary" type="button" onclick="routeToLocation('${escapeAttr(location.id)}')">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:5px;flex-shrink:0"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2ZM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7Z"/></svg>
        ${activeRoute ? 'Refresh Walking Path' : 'Walking Path'}
      </button>
      ${activeRoute ? `
        <button class="detail-btn" type="button" onclick="clearActiveRoute(true)">
          Clear Route
        </button>
      ` : `
        <a class="detail-btn" href="${directionsUrl}" target="_blank" rel="noreferrer noopener">
          Open in Google
        </a>
      `}
      <button class="detail-btn" type="button" onclick="shareLocation('${escapeAttr(location.id)}','${escapeAttr(location.name)}',${location.lat},${location.lng})">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:5px;flex-shrink:0"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92Z"/></svg>
        Share
      </button>
    </div>
  `;
  content.scrollTop = 0;

  const pendingProductId = String(window.__FAIRMAP_PENDING_PRODUCT_ID || '').trim();
  if (pendingProductId) {
    window.__FAIRMAP_PENDING_PRODUCT_ID = '';
    requestAnimationFrame(() => {
      const target = content.querySelector(`[data-product-id="${CSS.escape(pendingProductId)}"]`);
      if (!target) return;
      target.classList.add('is-product-highlight');
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      window.setTimeout(() => target.classList.remove('is-product-highlight'), 2200);
    });
  }

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

  // Favorite star handler
  const favBtn = document.getElementById('detail-fav-btn');
  if (favBtn) {
    favBtn.addEventListener('click', async () => {
      const profile = await ensureGuestProfile('favorites');
      if (!profile) return;
      const nowFaved = toggleFavorite(location.id);
      favBtn.classList.toggle('is-faved', nowFaved);
      favBtn.setAttribute('aria-label', nowFaved ? 'Remove from favorites' : 'Add to favorites');
      persistGuestFavorites();
      // Refresh overview if visible
      const q = document.getElementById('search-input')?.value.trim().toLowerCase() || '';
      renderOverview(q);
    });
  }

  const shareIconBtn = document.getElementById('detail-share-icon-btn');
  if (shareIconBtn) {
    shareIconBtn.addEventListener('click', () => shareLocation(location.id, location.name, location.lat, location.lng));
  }
}

function closeDetailPanel() {
  const panel = document.getElementById('detail-panel');
  const scrim = document.getElementById('detail-scrim');
  const app = document.getElementById('app');
  if (!panel || panel.hidden || appState.detailClosing) return;
  appState.popupPinned = false;
  removeAnchorPopup();
  updateUrlHash(null);
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
  const mobileCollapse = document.getElementById('mobile-sheet-collapse');
  if (mobileCollapse) mobileCollapse.hidden = !open;
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
  if (!sidebar || !detailPanel) return;

  const isMobile = () => window.innerWidth <= 960;
  const OPEN_DRAG_THRESHOLD_VIEWPORT = 0.12;
  const CLOSE_DRAG_THRESHOLD_PANEL = 0.25;
  const CLOSE_VELOCITY_THRESHOLD = 0.3;
  const SIDEBAR_PEEK_HEIGHT = 54;
  const OPEN_SNAP_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  const CLOSE_SNAP_EASING = 'cubic-bezier(0.32, 0, 0.67, 0)';

  const canDragPointer = (event) => event.isPrimary && event.button === 0;
  const getSidebarClosedOffset = () => Math.max(sidebar.getBoundingClientRect().height - SIDEBAR_PEEK_HEIGHT, 0);
  const isInteractiveTarget = (node) => Boolean(node?.closest('button, a, input, textarea, select, label'));
  const canStartSidebarDrag = (event) => {
    const rect = sidebar.getBoundingClientRect();
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    if (event.clientY < rect.top || event.clientY > visibleBottom) return false;
    if (isInteractiveTarget(event.target)) return false;
    return event.clientY <= rect.top + 220;
  };
  const canStartDetailDrag = (event) => {
    const rect = detailPanel.getBoundingClientRect();
    if (event.clientY < rect.top || event.clientY > rect.bottom) return false;
    if (isInteractiveTarget(event.target)) return false;
    return event.clientY <= rect.top + 150;
  };

  const applySnapTransition = (panel, easing) => {
    panel.style.transition = `transform 340ms ${easing}`;
    panel.style.transform = '';
    const clear = () => {
      panel.style.transition = '';
      panel.removeEventListener('transitionend', clear);
    };
    panel.addEventListener('transitionend', clear);
    setTimeout(clear, 420);
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
    let startTime = 0;
    let startOffset = 0;
    let currentOffset = 0;

    const resetDragStyle = () => {
      panel.style.transition = '';
      panel.style.transform = '';
      document.body.style.userSelect = '';
    };

    const finish = (event, cancelled = false) => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      if (!cancelled) {
        const elapsed = Math.max(Number(event?.timeStamp || 0) - startTime, 1);
        const distance = Number(event?.clientY || startY) - startY;
        const velocity = distance / elapsed;
        finalize(startOffset, currentOffset, velocity);
      } else {
        resetDragStyle();
      }
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
      finish(event, false);
    };

    const onPointerCancel = (event) => {
      if (event.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      finish(event, true);
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
      startTime = Number(event.timeStamp || 0);
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

  // Tap-to-toggle: tap the sheet handle or peek bar to expand/collapse
  const sidebarHandle = sidebar.querySelector('[data-sheet-handle="sidebar"]');
  if (sidebarHandle) {
    sidebarHandle.addEventListener('click', () => {
      const app = document.getElementById('app');
      const isOpen = app.classList.contains('mobile-sidebar-open');
      applySnapTransition(sidebar, isOpen ? CLOSE_SNAP_EASING : OPEN_SNAP_EASING);
      setMobileSidebarOpen(!isOpen);
    });
  }

  bindSheetDrag({
    panel: detailPanel,
    target: detailPanel,
    requiresOpen: true,
    canStartDrag: canStartDetailDrag,
    getStartOffset: () => 0,
    getBounds: () => ({ min: -window.innerHeight * 0.12, max: detailPanel.getBoundingClientRect().height }),
    finalize: (_, endOffset, velocity) => {
      const panelHeight = detailPanel.getBoundingClientRect().height;
      if (velocity > CLOSE_VELOCITY_THRESHOLD || endOffset >= panelHeight * CLOSE_DRAG_THRESHOLD_PANEL) {
        applySnapTransition(detailPanel, CLOSE_SNAP_EASING);
        closeDetailPanel();
        return;
      }
      applySnapTransition(detailPanel, OPEN_SNAP_EASING);
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
  // Hide booth overlay toggle when in satellite mode (no venue tiles)
  const overlayBtn = document.getElementById('venue-overlay-toggle');
  if (overlayBtn) overlayBtn.style.display = isVenue ? '' : 'none';
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

function isStallDebugEnabled() {
  const params = new URLSearchParams(window.location.search || '');
  const value = String(params.get('debugStalls') || '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

async function loadStallDebugData() {
  if (!isStallDebugEnabled()) return null;
  if (appState.stallDebugData || appState.stallDebugLoading) return appState.stallDebugData;
  appState.stallDebugLoading = true;
  try {
    // Usage: /map.html?tenant=firstmonday&debugStalls=1
    const res = await fetch('/data/stall-anchors/firstmonday-pavilion-2.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`stall anchors ${res.status}`);
    appState.stallDebugData = await res.json();
  } catch (error) {
    console.warn('[stall-debug] failed to load stall anchors', error);
    appState.stallDebugData = null;
  } finally {
    appState.stallDebugLoading = false;
  }
  return appState.stallDebugData;
}

async function renderStallDebugLayer() {
  if (!map || !isStallDebugEnabled()) return;
  const data = await loadStallDebugData();
  const anchors = Array.isArray(data?.anchors) ? data.anchors : [];
  if (!anchors.length) return;

  const sourceId = 'stall-debug-anchors';
  const circleLayerId = 'stall-debug-dots';
  const labelLayerId = 'stall-debug-labels';
  const featureCollection = {
    type: 'FeatureCollection',
    features: anchors
      .filter(a => Number.isFinite(Number(a.lng)) && Number.isFinite(Number(a.lat)))
      .map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(a.lng), Number(a.lat)] },
        properties: {
          key: String(a.key || ''),
          confidence: String(a.confidence || ''),
          source: String(a.source || '')
        }
      }))
  };

  if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
  if (map.getLayer(circleLayerId)) map.removeLayer(circleLayerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);

  map.addSource(sourceId, { type: 'geojson', data: featureCollection });
  map.addLayer({
    id: circleLayerId,
    type: 'circle',
    source: sourceId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 3, 19, 5, 21, 7],
      'circle-color': ['case', ['==', ['get', 'confidence'], 'low'], '#f97316', '#16a34a'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.88
    }
  });
  map.addLayer({
    id: labelLayerId,
    type: 'symbol',
    source: sourceId,
    layout: {
      'text-field': ['get', 'key'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 19, 11, 21, 13],
      'text-offset': [0, 1.05],
      'text-anchor': 'top',
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#111827',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5
    }
  });

  if (!document.getElementById('stall-debug-badge')) {
    const badge = document.createElement('div');
    badge.id = 'stall-debug-badge';
    badge.className = 'stall-debug-badge';
    badge.textContent = `Pavilion 2 stall debug: ${featureCollection.features.length} anchors`;
    document.body.appendChild(badge);
  }
}

async function hydrateStyleContent() {
  flattenShopperMap();
  await loadMarkerIcons();
  await ensureCompositeImages(appState.locations);
  buildLayers();
  flattenShopperMap();
  ensureRouteLayers();
  await renderStallDebugLayer();
  appState.hoveredFeatureId = null;
  applyFilters();
  fitShopperGroundsOverview();
  scheduleFilterCountRefresh(120, 'hydrateStyleContent');
  syncSelectedLayer();
  if (appState.activeRoute?.routeCoords?.length) {
    map.getSource(ROUTE_SOURCE_ID)?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: appState.activeRoute.routeCoords
        },
        properties: {
          locationId: appState.activeRoute.locationId
        }
      }]
    });
    map.getSource(ROUTE_POINT_SOURCE_ID)?.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: appState.activeRoute.origin },
          properties: { kind: 'start', label: appState.activeRoute.originLabel }
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: appState.activeRoute.destination },
          properties: { kind: 'end', label: appState.activeRoute.locationName || appState.activeRoute.locationId }
        }
      ]
    });
  }
}

function syncSelectedLayer() {
  if (!map?.getLayer(LAYER_SELECTED)) return;
  map.setFilter(LAYER_SELECTED, ['==', ['get', 'id'], appState.selectedLocationId || '']);
}

function toFeatureCollection(locations) {
  return {
    type: 'FeatureCollection',
    features: locations.map((loc) => {
      const isVisualMarker = normalizeCategoryLabel(loc.categoryName) === 'visual markers';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
        properties: {
          id: loc.id,
          name: loc.name,
          categoryName: loc.categoryName,
          isVisualMarker,
          color: loc.color,
          shape: loc.shape || 'circle',
          iconType: loc.iconType,
          iconImage: resolveMarkerImageId(loc)
        }
      };
    })
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
  if (value.includes('first aid')) return 'firstAid';
  if (value.includes('health') || value.includes('wellness')) return 'heartPulse';
  if (value.includes('faith') || value.includes('inspire') || value.includes('christian')) return 'cross';
  if (value.includes('candle') || value.includes('scent')) return 'candle';
  if (value.includes('candy') || value.includes('snack') || value.includes('popcorn')) return 'candy';
  if (value.includes('bed') && value.includes('bath')) return 'bedBath';
  if ((value.includes('bath') && (value.includes('body') || value.includes('beauty'))) || value.includes('beauty')) return 'soap';
  if (value.includes('knife') || value.includes('knives')) return 'knife';
  if (value.includes('coffee') || value.includes('tea')) return 'coffeeCup';
  if (value.includes('food') || value.includes('drink') || value.includes('gourmet')) return 'fork';
  if ((value.includes('clothing') && value.includes('kids')) || value.includes('kids clothing') || value.includes('kids clothes')) return 'kid';
  if ((value.includes('clothing') && value.includes('women')) || value.includes("women's") || value.includes('womens')) return 'dress';
  if (value.includes('clothing') || value.includes('men')) return 'shirt';
  if (value.includes('jewelry') || value.includes('watch')) return 'gem';
  if (value.includes('kitchen') || value.includes('dining')) return 'kitchenDining';
  if (value === 'home' || value.includes('home')) return 'homeIcon';
  if (value.includes('western')) return 'cowboyHat';
  if (value.includes('handmade') || value.includes('artisan')) return 'hand';
  if (value.includes('furniture')) return 'chair';
  if (value.includes('antique') || value.includes('vintage') || value.includes('collect')) return 'antiqueVintage';
  if (value.includes('art') || value.includes('photo')) return 'palette';
  if (value.includes('floral') || value.includes('flower')) return 'floral';
  if (value.includes('garden') || value.includes('patio')) return 'leaf';
  if (value.includes('purse') || value.includes('tote') || value.includes('bag')) return 'bag';
  if (value === 'pet' || value.includes('pet')) return 'paw';
  if (value.includes('sunglass') || value.includes('fashion')) return 'glasses';
  if (value.includes('wood')) return 'wood';
  if (value.includes('texas')) return 'texas';
  if (value.includes('atm')) return 'dollar';
  if (value.includes('amenit') || value.includes('market')) return 'info';
  if (value.includes('handicap')) return 'handicapParking';
  if (value.includes('restroom')) return 'restroom';
  if (value.includes('gate') || value.includes('entrance')) return 'gate';
  if (value.includes('parking')) return 'info';
  if (value.includes('scooter')) return 'scooter';
  if (value === 'music') return 'musicNote';
  if (value.includes('entertain') || value.includes('rental') || value.includes('music')) return 'music';
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

  // Prefer a working 2D style. The custom MapTiler style includes 3D buildings
  // and is flattened after load; OpenFreeMap is the no-key fallback.
  if (window.MAPTILER_KEY) {
    return `${MAPTILER_CUSTOM_STYLE}?key=${window.MAPTILER_KEY}`;
  }

  return STYLE_FALLBACK;
}

async function resolveVenueStyleUrl(rawStyle) {
  // Prefer proxied style endpoint — keeps MapTiler key server-side
  const proxyUrl = `${window.location.origin}/api/map-style`;
  try {
    const res = await fetch(proxyUrl, { method: 'HEAD' });
    if (res.ok) return proxyUrl;
  } catch (_) { /* fall through */ }
  // Fallback: direct MapTiler URL or generic open style
  if (window.MAPTILER_KEY) return `${MAPTILER_CUSTOM_STYLE}?key=${window.MAPTILER_KEY}`;
  return resolveStyleUrl(rawStyle);
}

async function resolveVenueOverlay() {
  // Fetch tileset metadata (bounds, zoom, tile URL template) from proxied style.json
  // so the overlay source is configured dynamically rather than hardcoded.
  try {
    const res = await fetch(`${window.location.origin}/api/venue-tile-style`);
    if (!res.ok) return null;
    const meta = await res.json();
    return {
      bounds: meta.bounds || null,
      minzoom: meta.minzoom ?? 14,
      maxzoom: meta.maxzoom ?? 22,
      name: meta.name || 'venue-overlay'
    };
  } catch (err) {
    console.warn('[venue-overlay] failed to resolve tileset metadata, using defaults', err);
    return null;
  }
}

function resolveSatelliteStyleUrl() {
  // Use MapTiler satellite when key available, ESRI as fallback
  if (window.MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/satellite/style.json?key=${window.MAPTILER_KEY}`;
  }
  return SATELLITE_STYLE_FALLBACK;
}

function resolveShopperBounds(locations) {
  const pts = (locations || []).filter((loc) => Number.isFinite(Number(loc.lng)) && Number.isFinite(Number(loc.lat)));
  if (!pts.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const loc of pts) {
    const lng = Number(loc.lng);
    const lat = Number(loc.lat);
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

function resolveInitialMapView(data) {
  // Shopper default is a flat grounds overview — never inherit a booth's
  // 3D pitch/zoom (Bee King's Honey is stored at zoom 20 / pitch 60).
  const bounds = resolveShopperBounds(data?.locations);
  const hasCenter = Array.isArray(data?.map?.center) && data.map.center.length === 2;
  const center = bounds
    ? [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2]
    : (hasCenter ? [Number(data.map.center[0]), Number(data.map.center[1])] : DEFAULT_CENTER);
  return { center, zoom: DEFAULT_ZOOM, pitch: DEFAULT_PITCH };
}

function fitShopperGroundsOverview() {
  if (!map || appState.shopperOverviewFitted) return;
  if (getDeepLinkedLocationId()) {
    appState.shopperOverviewFitted = true;
    return;
  }
  const locations = (appState.filteredLocations.length ? appState.filteredLocations : appState.locations)
    .filter((loc) => Number.isFinite(loc.lng) && Number.isFinite(loc.lat));
  if (locations.length < 2) {
    appState.shopperOverviewFitted = true;
    return;
  }
  const bounds = new maplibregl.LngLatBounds(
    [locations[0].lng, locations[0].lat],
    [locations[0].lng, locations[0].lat]
  );
  for (const loc of locations.slice(1)) {
    bounds.extend([loc.lng, loc.lat]);
  }
  map.fitBounds(bounds, {
    padding: getSearchFitPadding(),
    maxZoom: SHOPPER_OVERVIEW_MAX_ZOOM,
    duration: 0,
    pitch: 0,
    essential: true
  });
  flattenShopperMap();
  appState.shopperOverviewFitted = true;
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

function printMap() {
  const dir = document.getElementById('print-directory');
  if (dir && appState.locations.length) {
    const sorted = appState.locations.slice().sort((a, b) => a.name.localeCompare(b.name));

    // Category legend
    const cats = appState.categories.filter(c => !HIDDEN_CATEGORY_NAMES.has(c.name.toLowerCase()));
    let legendHtml = '<div style="margin-bottom:16px;"><h3 style="font-size:13px;margin-bottom:6px;">Category Legend</h3><div style="display:flex;flex-wrap:wrap;gap:8px;">';
    cats.forEach(cat => {
      const count = sorted.filter(l => l.categoryId === cat.id).length;
      if (count > 0) {
        legendHtml += `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:2px 8px;border-radius:10px;background:#f3f4f6;">
          <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};display:inline-block;"></span>
          ${escapeHtml(cat.name)} (${count})
        </span>`;
      }
    });
    legendHtml += '</div></div>';

    let rows = sorted.map(loc => {
      const cat = appState.categoriesById.get(loc.categoryId);
      const catName = cat?.name || loc.categoryName || '';
      const catColor = cat?.color || '#707070';
      const addr = loc.address || '';
      return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${catColor};margin-right:4px;"></span>${escapeHtml(loc.name)}</td><td>${escapeHtml(catName)}</td><td>${escapeHtml(addr)}</td></tr>`;
    }).join('');

    dir.innerHTML = `<h2>${escapeHtml(appState.mapData?.map?.name || 'TheFairMap')} — Vendor Directory</h2>
      <p style="font-size:11px;color:#666;margin-bottom:8px;">${sorted.length} locations</p>
      ${legendHtml}
      <table><thead><tr><th>Name</th><th>Category</th><th>Address / Booth</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  window.print();
}

async function shareLocation(locId, name, lat, lng) {
  const shareUrl = `${window.location.origin}/location/${encodeURIComponent(locId)}`;
  const shareData = {
    title: `${name} — TheFairMap`,
    text: `Meet me at ${name} on TheFairMap:`,
    url: shareUrl
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    showShareToast('Vendor map link copied!');
  } catch {
    // Fallback: select from a temporary input
    const tmp = document.createElement('input');
    tmp.value = shareUrl;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showShareToast('Vendor map link copied!');
  }
}

function showShareToast(msg) {
  let toast = document.getElementById('share-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'share-toast';
    toast.className = 'share-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('is-visible');
  setTimeout(() => toast.classList.remove('is-visible'), 2200);
}

function switchDetailPhoto(url) {
  const img = document.getElementById('detail-hero-img');
  if (img) {
    img.dataset.fallbackIndex = '0';
    img.src = url;
    document.querySelectorAll('.detail-thumb').forEach(t => {
      t.classList.toggle('active', t.style.backgroundImage.includes(url));
    });
  }
}

function renderDetailHero(urls, altText, id = '') {
  if (!Array.isArray(urls) || !urls.length) return '';
  const [primary, ...fallbacks] = urls;
  const idAttr = id ? ` id="${escapeAttr(id)}"` : '';
  const fallbackAttrs = fallbacks.length
    ? ` data-fallbacks='${escapeAttr(JSON.stringify(fallbacks))}' data-fallback-index="0" onerror="advanceDetailHeroFallback(this)"`
    : ` onerror="hideBrokenDetailHero(this)"`;
  return `<img class="detail-hero"${idAttr} src="${escapeAttr(primary)}" alt="${escapeAttr(altText)}" loading="lazy"${fallbackAttrs}>`;
}

function advanceDetailHeroFallback(img) {
  if (!img) return;
  let fallbacks = [];
  try {
    fallbacks = JSON.parse(img.dataset.fallbacks || '[]');
  } catch {
    fallbacks = [];
  }
  const index = Number.parseInt(img.dataset.fallbackIndex || '0', 10);
  const nextUrl = fallbacks[index];
  if (nextUrl) {
    img.dataset.fallbackIndex = String(index + 1);
    img.src = nextUrl;
    document.querySelectorAll('.detail-thumb').forEach((thumb) => {
      thumb.classList.toggle('active', thumb.style.backgroundImage.includes(nextUrl));
    });
    return;
  }
  hideBrokenDetailHero(img);
}

function hideBrokenDetailHero(img) {
  const mediaWrap = img?.closest('.detail-media');
  if (mediaWrap) {
    mediaWrap.remove();
    return;
  }
  img?.remove();
}

function buildVideoEmbedUrl(url) {
  if (!url) return null;
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

function extractLocationPhotos(location, catalog = []) {
  const candidates = [];
  if (Array.isArray(location.photos)) candidates.push(...location.photos);
  if (Array.isArray(location.images)) candidates.push(...location.images);
  if (typeof location.photo === 'string') candidates.push(location.photo);
  if (typeof location.image === 'string') candidates.push(location.image);
  if (Array.isArray(location.media)) candidates.push(...location.media);
  if (typeof location.logoUrl === 'string') candidates.push(location.logoUrl);
  if (Array.isArray(catalog)) {
    for (const item of catalog) {
      if (typeof item?.image === 'string') candidates.push(item.image);
    }
  }

  const urls = [];
  for (const item of candidates) {
    if (!item) continue;
    const url = typeof item === 'string' ? item : item.url || item.src;
    if (typeof url !== 'string') continue;
    const cleaned = url.trim();
    if (!cleaned) continue;
    if (
      /^https?:\/\//i.test(cleaned) ||
      cleaned.startsWith('/uploads/') ||
      cleaned.startsWith('/vendor-logos/') ||
      cleaned.startsWith('/vendor-catalog/')
    ) {
      urls.push(cleaned);
    }
  }
  return Array.from(new Set(urls));
}

function normalizeLocationCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').trim();
      if (!name) return null;
      return {
        id: String(item.id || `product-${index + 1}`),
        name,
        itemType: String(item.itemType || item.item_type || item.type || item.category || '').trim().toLowerCase(),
        description: String(item.description || '').trim(),
        price: String(item.price || '').trim(),
        image: String(item.image || item.imageUrl || '').trim(),
        link: String(item.link || item.url || '').trim()
      };
    })
    .filter(Boolean);
}

// ── Header: date + cycle number ──────────────────────────────────────────
function computeFairCycle() {
  // First Monday Trade Days has run since 1850. Cycle = months since epoch.
  // We use a simpler formula: cycle number relative to a known anchor.
  // March 2026 = cycle 1816 (per build report filename).
  const now = new Date();
  const anchorYear = 2026;
  const anchorMonth = 2; // March (0-indexed)
  const anchorCycle = 1816;
  const monthsDiff = (now.getFullYear() - anchorYear) * 12 + (now.getMonth() - anchorMonth);
  return anchorCycle + monthsDiff;
}

function initHeader() {
  const dateEl = document.getElementById('header-date');
  const cycleEl = document.getElementById('header-cycle');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
  if (cycleEl) {
    cycleEl.textContent = `Cycle #${computeFairCycle()}`;
  }

  // Sync header search with sidebar search
  const headerSearch = document.getElementById('header-search-input');
  const sidebarSearch = document.getElementById('search-input');
  if (headerSearch) {
    headerSearch.addEventListener('input', () => {
      if (sidebarSearch) sidebarSearch.value = headerSearch.value;
      applyFilters();
    });
  }
}

// ── Bottom Panel: vendor list + recent updates ──────────────────────────
function initBottomPanel() {
  const tabVendors = document.getElementById('tab-vendors');
  const tabUpdates = document.getElementById('tab-updates');
  const vendorList = document.getElementById('vendor-list');
  const updatesList = document.getElementById('updates-list');
  if (!tabVendors || !tabUpdates) return;

  tabVendors.addEventListener('click', () => {
    tabVendors.classList.add('is-active');
    tabUpdates.classList.remove('is-active');
    if (vendorList) vendorList.hidden = false;
    if (updatesList) updatesList.hidden = true;
  });

  tabUpdates.addEventListener('click', () => {
    tabUpdates.classList.add('is-active');
    tabVendors.classList.remove('is-active');
    if (vendorList) vendorList.hidden = true;
    if (updatesList) updatesList.hidden = false;
  });
}

function renderBottomPanel() {
  const vendorList = document.getElementById('vendor-list');
  const updatesList = document.getElementById('updates-list');
  if (!vendorList) return;

  // Render vendor cards — show a horizontal scrolling list of all locations
  vendorList.innerHTML = '';
  const locations = appState.filteredLocations.length ? appState.filteredLocations : appState.locations;
  for (const loc of locations.slice(0, 100)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'vendor-card';
    const category = appState.categoriesById.get(loc.categoryId);
    const color = normalizeColor(category?.color || loc.color);
    card.innerHTML = `
      <div class="vendor-card-name">${escapeHtml(loc.name)}</div>
      <div class="vendor-card-category">
        <span class="vendor-card-dot" style="background:${color};"></span>
        ${escapeHtml(category?.name || loc.categoryName || 'Uncategorized')}
      </div>
    `;
    card.addEventListener('click', () => openLocation(loc, true));
    vendorList.appendChild(card);
  }

  // Render recent updates (simulated from location data)
  if (updatesList) {
    updatesList.innerHTML = '';
    const recentLocations = appState.locations.slice(0, 15);
    for (const loc of recentLocations) {
      const item = document.createElement('div');
      item.className = 'update-item';
      item.innerHTML = `
        <span class="update-dot"></span>
        <span class="update-text"><strong>${escapeHtml(loc.name)}</strong> added to the map</span>
      `;
      updatesList.appendChild(item);
    }
    if (recentLocations.length === 0) {
      updatesList.innerHTML = '<div style="padding:12px;color:#667085;font-size:12px;">No recent updates.</div>';
    }
  }
}

// ── Embedded map touch behavior ────────────────────────────────────────────
function initSmartScrollOverlay() {
  // Old behavior intentionally blocked one-finger touch inside embeds and showed
  // the old two-finger prompt. Guests asked for normal mobile map panning,
  // so keep dragPan enabled and disable the cooperative gesture prompt.
  const mapEl = document.getElementById('map');
  if (map && map.cooperativeGestures) map.cooperativeGestures.disable();
  if (map && map.dragPan) map.dragPan.enable();
  if (map && map.touchZoomRotate) map.touchZoomRotate.enable();
  if (map && map.touchPitch) map.touchPitch.enable();
  if (mapEl) mapEl.style.touchAction = 'none';
}


// ── High-res export & print legend ─────────────────────────────────────────
function exportMapImage() {
  if (!map) return;
  const canvas = map.getCanvas();
  canvas.toBlob((blob) => {
    if (!blob) { alert('Could not export map image.'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thefairmap-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

window.__FAIRMAP_STATE = appState;
window.__FAIRMAP_OPEN_LOCATION = openLocation;

document.addEventListener('DOMContentLoaded', () => {
  init();
  initSmartScrollOverlay();
  loadGuestNotices();
});
