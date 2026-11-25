
const DEFAULT_CENTER = [39.7392, -104.9903];
const STORAGE_KEYS = { favorites: 'wilderpath:favorites', trips: 'wilderpath:trips', completed: 'wilderpath:completed' };

const map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, 8);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  referrerPolicy: 'strict-origin-when-cross-origin',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

const elements = {
  searchForm: document.querySelector('#search-form'),
  locationInput: document.querySelector('#location-input'),
  nearMe: document.querySelector('#near-me'),
  tripDate: document.querySelector('#trip-date'),
  startTime: document.querySelector('#start-time'),
  hikeHours: document.querySelector('#hike-hours'),
  daylightNote: document.querySelector('#daylight-note'),
  mapPlace: document.querySelector('#map-place'),
  resultTitle: document.querySelector('#results-title'),
  resultCount: document.querySelector('#result-count'),
  resultList: document.querySelector('#result-list'),
  difficultyChips: document.querySelector('#filter-difficulty'),
  filterLength: document.querySelector('#filter-length'),
  filterTime: document.querySelector('#filter-time'),
  filterClear: document.querySelector('#filter-clear'),
  weatherSummary: document.querySelector('#weather-summary'),
  weatherTemp: document.querySelector('#weather-temp'),
  weatherIcon: document.querySelector('#weather-icon'),
  gearList: document.querySelector('#gear-list'),
  savedList: document.querySelector('#saved-list'),
  favoriteCount: document.querySelector('#favorite-count'),
  tripCount: document.querySelector('#trip-count'),
  completedCount: document.querySelector('#completed-count'),
  savePlace: document.querySelector('#save-place'),
  planTrip: document.querySelector('#plan-trip'),
  findHotels: document.querySelector('#find-hotels'),
  planBadge: document.querySelector('#plan-badge'),
  trailSheet: document.querySelector('#trail-sheet'),
  planner: document.querySelector('#planner'),
  plannerClose: document.querySelector('#planner-close'),
  planName: document.querySelector('#plan-name'),
  planStart: document.querySelector('#plan-start'),
  planSummary: document.querySelector('#plan-summary'),
  planDays: document.querySelector('#plan-days'),
  planAddDay: document.querySelector('#plan-add-day'),
  planNew: document.querySelector('#plan-new'),
  planSave: document.querySelector('#plan-save'),
  planStatus: document.querySelector('#plan-status'),
  toast: document.querySelector('#toast'),
  roadMiles: document.querySelector('#road-miles'),
  mpg: document.querySelector('#mpg'),
  fuelPrice: document.querySelector('#fuel-price'),
  fuelTotal: document.querySelector('#fuel-total'),
  sidebar: document.querySelector('.sidebar'),
};

const layers = L.layerGroup().addTo(map);
const planLayer = L.layerGroup().addTo(map);
const highlightLayer = L.layerGroup().addTo(map);
let currentPlace = null;
let userPosition = null;
let currentItems = [];
let selectedItemId = null;
let savedTab = 'favorites';
const SAVED_PREVIEW_LIMIT = 10;
let showAllSaved = false;
let toastTimer;

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

function saveStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 2500);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return 'Nearby';
  const miles = meters / 1609.344;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

function getCoords(element) {
  if (element.type === 'way' && element.geometry?.length) {
    return element.geometry.map(point => [point.lat, point.lon]);
  }
  if (element.center) return [[element.center.lat, element.center.lon]];
  if (element.lat && element.lon) return [[element.lat, element.lon]];
  return [];
}

function distanceBetween(a, b) {
  const radians = value => value * Math.PI / 180;
  const latitudeDelta = radians(b[0] - a[0]);
  const longitudeDelta = radians(b[1] - a[1]);
  const factor = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(factor), Math.sqrt(1 - factor));
}

function lineLength(points) {
  return points.slice(1).reduce((total, point, index) => total + distanceBetween(points[index], point), 0);
}

function itemName(tags) {
  if (tags.name) return tags.name;
  return tags.route === 'hiking' ? 'Hiking route' : 'Unnamed trail';
}

function elementId(element) {
  return `${element.type}-${element.id}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

// ─── Completed trails ───────────────────────────────────────────────
// Stored as trail summaries (same shape as planned trails) so the list can reopen them anywhere.

function completedTrails() {
  return readStorage(STORAGE_KEYS.completed);
}

function completedIds() {
  return new Set(completedTrails().map(trail => trail.id));
}

function isCompleted(trailId) {
  return completedTrails().some(trail => trail.id === trailId);
}

function setTrailCompleted(trail, done) {
  const completed = completedTrails().filter(item => item.id !== trail.id);
  if (done) completed.unshift({ ...planTrail(trail), completedAt: new Date().toISOString() });
  saveStorage(STORAGE_KEYS.completed, completed);
  refreshCompletedViews();
  showToast(done ? `Marked ${trail.name} as completed.` : `${trail.name} marked not completed.`);
}

// Completion shows on the map, trail cards, details panel, planner and saved lists.
function refreshCompletedViews() {
  highlightSelection();
  if (currentItems.length) renderResults();
  renderSaved();
  if (elements.planner.open) renderPlanner();
  if (sheetTrail) renderTrailSheet();
}

// Completed trails near a place, e.g. a favorite destination.
function completedNear(place) {
  return completedTrails().filter(trail => trail.center && distanceBetween([place.lat, place.lon], trail.center) <= TRAIL_SEARCH_RADIUS).length;
}

function completedLabel(count, total) {
  return total === undefined ? `${count} ${count === 1 ? 'trail' : 'trails'} completed` : `${count}/${total} completed`;
}

function markerIcon(selected = false, completed = false) {
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker${selected ? ' selected' : ''}${completed ? ' completed' : ''}"><span>${completed ? '✓' : '↗'}</span></div>`,
    iconSize: [25, 25],
    iconAnchor: [12, 24],
    popupAnchor: [0, -23],
  });
}

// Selects a trail, highlights it, and opens its details panel. `fly` moves the map to it.
function focusItem(id, { fly = true } = {}) {
  const item = currentItems.find(candidate => candidate.id === id);
  if (!item) return;
  selectedItemId = id;
  highlightLayer.clearLayers();
  renderResults();
  highlightSelection();
  if (fly) map.flyTo(item.center, Math.max(map.getZoom(), 13), { duration: 0.55 });
  openTrailDetails(item);
}

const TRAIL_STYLE = { color: '#54774b', weight: 3, opacity: 0.72 };
const SELECTED_TRAIL_STYLE = { color: '#d7765a', weight: 5, opacity: 0.95 };
const COMPLETED_TRAIL_STYLE = { color: '#2f7d9a', weight: 3, opacity: 0.85 };

function trailStyle(selected, completed) {
  if (selected) return SELECTED_TRAIL_STYLE;
  return completed ? COMPLETED_TRAIL_STYLE : TRAIL_STYLE;
}

function highlightSelection() {
  const done = completedIds();
  layers.eachLayer(layer => {
    const selected = layer.featureId === selectedItemId;
    const completed = done.has(layer.featureId);
    if (layer.setIcon) {
      layer.setIcon(markerIcon(selected, completed));
      layer.setZIndexOffset(selected ? 1000 : 0);
      return;
    }
    layer.setStyle(trailStyle(selected, completed));
    if (selected) layer.bringToFront();
  });
}

// ─── Trail filters ──────────────────────────────────────────────────
// Missing data is its own choice in every filter ("Not rated", "Length unknown", "Time unknown"),
// so an unrated trail is never lumped in with easy ones.

const DIFFICULTY_GROUPS = [
  { id: 'easy', label: 'Easy', scales: ['hiking'] },
  { id: 'moderate', label: 'Moderate', scales: ['mountain_hiking'] },
  { id: 'challenging', label: 'Challenging', scales: ['demanding_mountain_hiking'] },
  { id: 'difficult', label: 'Difficult+', scales: ['alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'] },
  { id: 'unrated', label: 'Not rated', scales: [] },
];
// [min, max) in miles and in minutes.
const LENGTH_RANGES = { short: [0, 2], medium: [2, 5], long: [5, 10], epic: [10, Infinity] };
const TIME_RANGES = { quick: [0, 60], short: [60, 120], half: [120, 240], long: [240, Infinity] };
const FILTER_KEY = 'wilderpath:trail-filters';
const DEFAULT_FILTERS = { difficulty: [], length: 'any', time: 'any' };
let trailFilters = readFilters();

function readFilters() {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY)) || {};
    const groups = DIFFICULTY_GROUPS.map(group => group.id);
    return {
      difficulty: Array.isArray(stored.difficulty) ? stored.difficulty.filter(id => groups.includes(id)) : [],
      length: stored.length in LENGTH_RANGES || stored.length === 'unknown' ? stored.length : 'any',
      time: stored.time in TIME_RANGES || stored.time === 'unknown' ? stored.time : 'any',
    };
  } catch { return { ...DEFAULT_FILTERS }; }
}

function saveFilters() {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(trailFilters)); }
  catch { /* Filters still work for this visit. */ }
}

// ─── Your own difficulty ratings ────────────────────────────────────
// Stored by trail id as an OSM sac_scale value. A rating of yours wins over the map's.
const RATING_KEY = 'wilderpath:difficulty-ratings';

function readRatings() {
  try {
    const ratings = JSON.parse(localStorage.getItem(RATING_KEY));
    return ratings && typeof ratings === 'object' && !Array.isArray(ratings) ? ratings : {};
  } catch { return {}; }
}

function mappedDifficulty(trail) {
  return trail.difficulty || trail.tags?.sac_scale || '';
}

function userDifficulty(trail) {
  const rating = readRatings()[trail.id];
  return DIFFICULTY[rating] ? rating : '';
}

function trailDifficulty(trail) {
  return userDifficulty(trail) || mappedDifficulty(trail);
}

// An empty value removes your rating and goes back to the map's.
function setUserDifficulty(trail, value) {
  const ratings = readRatings();
  if (DIFFICULTY[value]) ratings[trail.id] = value;
  else delete ratings[trail.id];
  try { localStorage.setItem(RATING_KEY, JSON.stringify(ratings)); }
  catch { return showToast('Could not save your rating in this browser.'); }
  if (currentItems.length) {
    drawItems(filteredItems());
    highlightSelection();
    renderResults();
  }
  renderSaved();
  if (elements.planner.open) renderPlanner();
  if (sheetTrail) renderTrailSheet();
  const hidden = currentItems.some(item => item.id === trail.id) && !matchesFilters(trail);
  const message = DIFFICULTY[value] ? `Rated ${trail.name} as ${DIFFICULTY[value].label}.` : `Removed your rating for ${trail.name}.`;
  showToast(hidden ? `${message} Your filters now hide it.` : message);
}

function difficultyGroup(sacScale) {
  return DIFFICULTY_GROUPS.find(group => group.scales.includes(sacScale))?.id || 'unrated';
}

// null means the trail has no usable mapped length, so its time can't be estimated either.
function trailMiles(trail) {
  return trail.length > 0 ? metersToMiles(trail.length) : null;
}

function trailMinutes(trail) {
  return trail.length > 0 ? hikeMinutes(trail.length, trailElevation(trail)?.climbFt) : null;
}

function inRange(value, choice, ranges) {
  if (choice === 'any') return true;
  if (choice === 'unknown') return value === null;
  const [min, max] = ranges[choice] || [];
  return value !== null && value >= min && value < max;
}

function matchesFilters(trail, filters = trailFilters) {
  return (!filters.difficulty.length || filters.difficulty.includes(difficultyGroup(trailDifficulty(trail))))
    && inRange(trailMiles(trail), filters.length, LENGTH_RANGES)
    && inRange(trailMinutes(trail), filters.time, TIME_RANGES);
}

function filtersActive(filters = trailFilters) {
  return filters.difficulty.length > 0 || filters.length !== 'any' || filters.time !== 'any';
}

function filteredItems() {
  return currentItems.filter(item => matchesFilters(item));
}

function difficultyBadge(trail) {
  const sacScale = trailDifficulty(trail);
  const group = difficultyGroup(sacScale);
  if (group === 'unrated') return '<span class="difficulty-badge unrated" title="No difficulty rating is mapped for this trail. It is not necessarily easy.">? Not rated</span>';
  if (userDifficulty(trail)) return `<span class="difficulty-badge ${group} user-rated" title="Your rating">✎ ${escapeHtml(DIFFICULTY[sacScale].label)}</span>`;
  return `<span class="difficulty-badge ${group}">${escapeHtml(DIFFICULTY[sacScale].label)}</span>`;
}

function trailStatsMarkup(trail) {
  const miles = trailMiles(trail);
  if (miles === null) return '<span class="missing-info">Length &amp; time unknown</span>';
  return `${miles.toFixed(1)} mi <b>·</b> ~${escapeHtml(formatDuration(trailMinutes(trail) * 60))}`;
}

function renderFilters() {
  elements.difficultyChips.innerHTML = DIFFICULTY_GROUPS.map(group => {
    const pressed = trailFilters.difficulty.includes(group.id);
    return `<button class="filter-chip ${group.id}" type="button" data-difficulty="${group.id}" aria-pressed="${pressed}">${escapeHtml(group.label)}</button>`;
  }).join('');
  elements.filterLength.value = trailFilters.length;
  elements.filterTime.value = trailFilters.time;
  elements.filterClear.hidden = !filtersActive();
}

// Filters change both the list and the map pins/lines.
function applyFilters() {
  saveFilters();
  renderFilters();
  if (!currentItems.length) return;
  drawItems(filteredItems());
  highlightSelection();
  renderResults();
}

function clearFilters() {
  trailFilters = { ...DEFAULT_FILTERS, difficulty: [] };
  applyFilters();
}

function renderResults() {
  const matching = filteredItems();
  const items = matching.slice(0, 45);
  const done = completedIds();
  const doneCount = items.filter(item => done.has(item.id)).length;
  const shown = filtersActive() && currentItems.length ? `${matching.length} OF ${currentItems.length}` : `${items.length}`;
  const noun = (filtersActive() ? currentItems.length : items.length) === 1 ? 'TRAIL' : 'TRAILS';
  elements.resultCount.textContent = `${shown} ${noun}${doneCount ? ` · ${doneCount} DONE` : ''}`;
  if (!currentItems.length) {
    elements.resultList.innerHTML = '<div class="empty-results"><span class="empty-sun">✳</span><p>No mapped hiking trails showed up nearby. Try another search or a wider area.</p></div>';
    return;
  }
  if (!items.length) {
    elements.resultList.innerHTML = '<div class="empty-results"><span class="empty-sun">⌀</span><p>No trails here match these filters.<br /><button class="text-button" type="button" data-clear-filters>Clear filters</button></p></div>';
    return;
  }
  elements.resultList.innerHTML = items.map(item => {
    const completed = done.has(item.id);
    return `
    <div class="result-card-wrap">
      <button class="result-card${item.id === selectedItemId ? ' selected' : ''}${completed ? ' completed' : ''}" type="button" data-item-id="${escapeHtml(item.id)}">
        <span class="result-card-top"><strong>${escapeHtml(item.name)}</strong><span class="result-type">${completed ? '✓ DONE' : escapeHtml(item.distance.toUpperCase())}</span></span>
        <span class="result-meta">${difficultyBadge(item)} ${trailStatsMarkup(item)}</span>
      </button>
      <label class="result-done" title="${completed ? 'Completed' : 'Mark as completed'}"><input type="checkbox" data-complete-id="${escapeHtml(item.id)}"${completed ? ' checked' : ''} aria-label="Mark ${escapeHtml(item.name)} as completed" /></label>
    </div>`;
  }).join('');
}

// Shown in the trails list while the trail search API calls are still running.
function renderLoading() {
  elements.resultCount.textContent = 'SEARCHING…';
  elements.resultList.innerHTML = '<div class="empty-results loading-results" role="status"><span class="spinner" aria-hidden="true"></span><p>Looking for trails nearby…<br />This can take a little while.</p></div>';
}

function drawItems(items) {
  layers.clearLayers();
  const done = completedIds();
  for (const item of items.slice(0, 100)) {
    const completed = done.has(item.id);
    // Every trail gets a pin at its midpoint; mapped paths also get their line.
    const trailLayers = [L.marker(item.center, { icon: markerIcon(false, completed), title: item.name })];
    if (item.lines.length) trailLayers.unshift(L.polyline(item.lines, { ...trailStyle(false, completed), lineCap: 'round' }));
    for (const layer of trailLayers) {
      layer.featureId = item.id;
      layer.on('click', () => focusItem(item.id, { fly: false }));
      layer.addTo(layers);
    }
  }
}

// OSM sac_scale values, from easiest to hardest.
const DIFFICULTY = {
  hiking: { label: 'Easy', note: 'Well-marked path. Trail runners are fine.' },
  mountain_hiking: { label: 'Moderate', note: 'Some steep or uneven sections. Hiking boots recommended.' },
  demanding_mountain_hiking: { label: 'Challenging', note: 'Exposed spots; you may need hands for balance.' },
  alpine_hiking: { label: 'Difficult', note: 'Scrambling and route-finding. Experience needed.' },
  demanding_alpine_hiking: { label: 'Very difficult', note: 'Alpine terrain. Climbing experience required.' },
  difficult_alpine_hiking: { label: 'Expert', note: 'Technical alpine terrain.' },
};

function difficultyInfo(sacScale) {
  return DIFFICULTY[sacScale] || { label: 'Not rated', note: 'No difficulty rating is mapped for this trail. That doesn’t mean it’s easy, so check a local source before you go.' };
}

const metersToMiles = meters => meters / 1609.344;
const metersToFeet = meters => meters * 3.28084;

// "Book time": 2 mph on the flat plus 30 minutes per 1,000 ft of climbing.
function hikeMinutes(lengthMeters, climbFeet = 0) {
  return metersToMiles(lengthMeters) / 2 * 60 + climbFeet / 1000 * 30;
}

const OVERPASS_ENDPOINTS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];
// The server gets OVERPASS_TIMEOUT seconds; the browser waits a bit longer, then tries the next endpoint.
const OVERPASS_TIMEOUT = 45;
const OVERPASS_CLIENT_TIMEOUT_MS = (OVERPASS_TIMEOUT + 5) * 1000;
// If every endpoint fails, wait and try them all again (Overpass 502s are often brief overloads).
const OVERPASS_RETRIES = 1;
const OVERPASS_RETRY_DELAY_MS = 5000;
const TRAIL_SEARCH_RADIUS = 8000;
// v6 adds trailheads mapped as areas (e.g. a parking lot), not just points; older caches lack them, so drop them.
const TRAIL_CACHE_KEY = 'wilderpath:trail-cache:v6';
for (const oldKey of ['wilderpath:trail-cache', 'wilderpath:trail-cache:v2', 'wilderpath:trail-cache:v3', 'wilderpath:trail-cache:v4', 'wilderpath:trail-cache:v5']) localStorage.removeItem(oldKey);
const TRAIL_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const TRAIL_CACHE_LIMIT = 25;

// Searches snap to a ~1 km grid so nearby lookups share one cached result.
function trailCacheKey(place) {
  return `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
}

function readTrailCache() {
  try { return JSON.parse(localStorage.getItem(TRAIL_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function getCachedTrails(key) {
  const entry = readTrailCache()[key];
  return entry && Date.now() - entry.savedAt < TRAIL_CACHE_TTL ? entry.trails : null;
}

function setCachedTrails(key, trails) {
  const cache = readTrailCache();
  cache[key] = { savedAt: Date.now(), trails };
  const newest = Object.entries(cache).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, TRAIL_CACHE_LIMIT);
  try { localStorage.setItem(TRAIL_CACHE_KEY, JSON.stringify(Object.fromEntries(newest))); }
  catch (error) { console.warn('Trail cache is full, skipping save:', error); }
}

function trailQuery(lat, lon) {
  const area = `around:${TRAIL_SEARCH_RADIUS},${lat},${lon}`;
  // Paths need full geometry to draw. Hiking routes skip it; they only add details to paths with the same name.
  return `[out:json][timeout:${OVERPASS_TIMEOUT}];way(${area})[highway=path][name];out geom qt 150;relation(${area})[route=hiking];out center qt 30;nwr(${area})[highway=trailhead];out center qt 200;`;
}

// TEMP timing: sends a line to tests/timing_server.py (written to tests/trail_api_timing.txt). Remove when done.
function logTrailTiming(message) {
  console.log(`[trail-timing] ${message}`);
  fetch('/__trail-timing', { method: 'POST', body: message }).catch(() => {});
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchOverpass(query) {
  let lastError;
  for (let attempt = 0; attempt <= OVERPASS_RETRIES; attempt++) {
    if (attempt > 0) {
      logTrailTiming(`RETRY ${attempt}/${OVERPASS_RETRIES}       all endpoints failed, waiting ${OVERPASS_RETRY_DELAY_MS} ms`); // TEMP timing
      await wait(OVERPASS_RETRY_DELAY_MS);
    }
    try {
      return await fetchOverpassOnce(query);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Tries each endpoint in order and returns the first successful response.
async function fetchOverpassOnce(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const attemptStart = performance.now(); // TEMP timing
    logTrailTiming(`API CALL START  ${endpoint}`); // TEMP timing
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(OVERPASS_CLIENT_TIMEOUT_MS),
      });
      logTrailTiming(`API RESPONSE    ${endpoint} status=${response.status} after ${(performance.now() - attemptStart).toFixed(0)} ms`); // TEMP timing
      if (!response.ok) throw new Error(`Trail search returned ${response.status}`);
      const json = await response.json();
      logTrailTiming(`API DONE        ${endpoint} ${json.elements?.length ?? 0} elements, total ${(performance.now() - attemptStart).toFixed(0)} ms`); // TEMP timing
      return json;
    } catch (error) {
      logTrailTiming(`API FAILED      ${endpoint} after ${(performance.now() - attemptStart).toFixed(0)} ms: ${error.name}: ${error.message}`); // TEMP timing
      lastError = error;
    }
  }
  throw lastError;
}

const roundPoint = ([lat, lon]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))];

// OSM tags shown in the trail details panel.
const DETAIL_TAGS = ['sac_scale', 'trail_visibility', 'surface', 'dog', 'bicycle', 'horse', 'operator', 'description', 'website', 'wheelchair', 'fee', 'access'];

// "Bear Creek Trail (241)", "Bear Creek Trail #241" and the "Bear Creek Trail" route are one trail.
function trailNameKey(name) {
  return name.toLowerCase()
    .replace(/\(\s*\d+\s*\)|#\s*\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(trail|trl)$/, '');
}

// OSM splits long trails into many ways; merge them by name so each trail is listed once.
function buildTrails(overpassElements) {
  const trails = new Map();
  const trailheads = [];
  for (const element of overpassElements) {
    const tags = element.tags || {};
    // Trailheads can be mapped as a point or as an area (sent as its center).
    if (tags.highway === 'trailhead') {
      const [point] = getCoords(element);
      if (point) trailheads.push(roundPoint(point));
      continue;
    }
    const points = getCoords(element).map(roundPoint);
    if (!points.length) continue;
    const key = tags.name ? `name:${trailNameKey(tags.name)}` : elementId(element);
    const trail = trails.get(key) || { id: elementId(element), name: itemName(tags), difficulty: '', tags: {}, osm: [], lines: [], point: null };
    trail.difficulty ||= tags.sac_scale || '';
    for (const tag of DETAIL_TAGS) if (tags[tag] && !trail.tags[tag]) trail.tags[tag] = tags[tag];
    if (trail.osm.length < 5) trail.osm.push(`${element.type}/${element.id}`);
    if (points.length > 1) trail.lines.push(points);
    else trail.point ||= points[0];
    trails.set(key, trail);
  }
  // Hiking routes only come with a center point; keep them only when they matched a mapped path,
  // otherwise they show up as a pin in an empty spot.
  const mapped = [...trails.values()].filter(trail => trail.lines.length);
  for (const trail of mapped) trail.trailhead = nearestTrailhead(trailEnds(trail), trailheads);
  return mapped;
}

// A trail is split into several lines; its ends are line ends that touch no other line of the trail.
// Checking every point, not just other line ends, keeps a spur that branches off mid-line from
// turning the junction into a fake "end" in the middle of the trail.
function trailEnds(trail) {
  const linesAt = new Map(); // point → how many lines pass through it
  for (const line of trail.lines) {
    for (const key of new Set(line.map(point => point.join()))) linesAt.set(key, (linesAt.get(key) || 0) + 1);
  }
  const open = trail.lines
    .filter(line => line[0].join() !== line[line.length - 1].join()) // a closed loop has no end
    .flatMap(line => [line[0], line[line.length - 1]])
    .filter(point => linesAt.get(point.join()) === 1);
  // Loops have no real end; fall back to every line end so a nearby trailhead or point can still be picked.
  return open.length ? open : trail.lines.flatMap(line => [line[0], line[line.length - 1]]);
}

const TRAILHEAD_MAX_METERS = 400;

function nearestTrailhead(ends, trailheads) {
  let best = null;
  let bestDistance = TRAILHEAD_MAX_METERS;
  for (const end of ends) {
    for (const trailhead of trailheads) {
      const distance = distanceBetween(end, trailhead);
      if (distance < bestDistance) [best, bestDistance] = [trailhead, distance];
    }
  }
  return best;
}

// Where to send driving directions: a mapped trailhead, else the trail end nearest the searched place.
function trailStart(trail, place) {
  if (trail.trailhead) return trail.trailhead;
  const ends = trail.lines.length ? trailEnds(trail) : [];
  if (!ends.length) return trail.point;
  const origin = [place.lat, place.lon];
  return ends.reduce((best, end) => (distanceBetween(origin, end) < distanceBetween(origin, best) ? end : best));
}

function trailToItem(trail, place) {
  const longest = trail.lines.reduce((best, line) => (line.length > best.length ? line : best), []);
  const center = longest.length ? longest[Math.floor(longest.length / 2)] : trail.point;
  const length = trail.lines.reduce((total, line) => total + lineLength(line), 0);
  const distance = distanceBetween([place.lat, place.lon], center);
  return { ...trail, center, start: trailStart(trail, place), length, distanceValue: distance, distance: `${formatDistance(distance)} away` };
}

async function loadNearby(place) {
  elements.sidebar.classList.add('loading');
  elements.resultTitle.textContent = `Around ${place.shortName}`;
  currentItems = [];
  selectedItemId = null;
  layers.clearLayers();
  highlightLayer.clearLayers();
  closeTrailDetails();
  renderLoading();
  const cacheKey = trailCacheKey(place);
  const loadStart = performance.now(); // TEMP timing
  logTrailTiming(`=== LOAD START  "${place.shortName}" key=${cacheKey}`); // TEMP timing
  try {
    let trails = getCachedTrails(cacheKey);
    if (!trails) {
      const [lat, lon] = cacheKey.split(',');
      const data = await fetchOverpass(trailQuery(lat, lon));
      const buildStart = performance.now(); // TEMP timing
      trails = buildTrails(data.elements || []);
      setCachedTrails(cacheKey, trails);
      logTrailTiming(`BUILD+CACHE     ${trails.length} trails in ${(performance.now() - buildStart).toFixed(0)} ms`); // TEMP timing
    } else {
      logTrailTiming(`CACHE HIT       no API call made, ${trails.length} trails`); // TEMP timing
    }
    if (place !== currentPlace) return;
    const renderStart = performance.now(); // TEMP timing
    currentItems = trails.map(trail => trailToItem(trail, place)).sort((a, b) => a.distanceValue - b.distanceValue);
    drawItems(filteredItems());
    renderResults();
    logTrailTiming(`RENDER          ${(performance.now() - renderStart).toFixed(0)} ms`); // TEMP timing
    logTrailTiming(`=== LOAD DONE   total ${(performance.now() - loadStart).toFixed(0)} ms`); // TEMP timing
  } catch (error) {
    logTrailTiming(`=== LOAD FAILED total ${(performance.now() - loadStart).toFixed(0)} ms: ${error.message}`); // TEMP timing
    console.error('Trail search failed:', error);
    // A newer search has taken over the list; don't cover it with this old search's error.
    if (place !== currentPlace) return;
    elements.resultList.innerHTML = '<div class="empty-results"><span class="empty-sun">!</span><p>Trail data could not load right now. Check your connection and try again.</p></div>';
    elements.resultCount.textContent = 'MAP DATA OFFLINE';
  } finally {
    // Only the latest search may turn off the loading indicator.
    if (place === currentPlace) elements.sidebar.classList.remove('loading');
  }
}

function formatDuration(seconds) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

// Daily forecast for today plus the next 13 days, in the place's own time zone.
function forecastUrl(place) {
  const params = new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '14',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

async function loadWeather(place) {
  elements.weatherSummary.textContent = 'Checking forecast…';
  try {
    const response = await fetch(forecastUrl(place));
    if (!response.ok) throw new Error(`Forecast returned ${response.status}`);
    const data = await response.json();
    if (place !== currentPlace) return;
    const date = elements.tripDate.value;
    const index = data.daily.time.indexOf(date);
    // Forecasts only cover today plus the next 13 days; don't fall back to another day's weather.
    if (index < 0) {
      elements.weatherSummary.textContent = 'Weather not available for this date';
      elements.weatherTemp.textContent = '--°';
      elements.weatherIcon.textContent = '◌';
      elements.daylightNote.textContent = 'Forecasts cover the next 14 days. Check back closer to your trip.';
      renderGear(null);
      return;
    }
    const code = data.daily.weather_code[index];
    const high = Math.round(data.daily.temperature_2m_max[index]);
    const low = Math.round(data.daily.temperature_2m_min[index]);
    const rain = data.daily.precipitation_probability_max[index] ?? 0;
    const wind = Math.round(data.daily.wind_speed_10m_max[index] ?? 0);
    renderDaylight(data.daily.sunrise[index], data.daily.sunset[index]);
    const forecast = describeWeather(code);
    elements.weatherSummary.textContent = `${forecast.label} · ${low}°–${high}°F`;
    elements.weatherTemp.textContent = `${high}°`;
    elements.weatherIcon.textContent = forecast.icon;
    renderGear({ code, high, low, rain, wind });
  } catch (error) {
    console.error('Weather lookup failed:', error);
    elements.weatherSummary.textContent = 'Forecast unavailable';
    elements.weatherTemp.textContent = '--°';
    elements.daylightNote.textContent = 'Local daylight details unavailable.';
    renderGear(null);
  }
}

function renderDaylight(sunriseValue, sunsetValue) {
  const sunrise = new Date(sunriseValue);
  const sunset = new Date(sunsetValue);
  const [hours, minutes] = elements.startTime.value.split(':').map(Number);
  const start = new Date(sunrise);
  start.setHours(hours, minutes, 0, 0);
  const finish = new Date(start.getTime() + Number(elements.hikeHours.value) * 60 * 60 * 1000);
  const formatTime = value => value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (start < sunrise) {
    elements.daylightNote.textContent = `Starts before sunrise at ${formatTime(sunrise)}.`;
  } else if (finish > sunset) {
    elements.daylightNote.textContent = `Finishes after sunset at ${formatTime(sunset)}. Consider an earlier start.`;
  } else {
    elements.daylightNote.textContent = `Daylight ${formatTime(sunrise)}–${formatTime(sunset)} · estimated finish ${formatTime(finish)}.`;
  }
}

function describeWeather(code) {
  if (code === 0) return { label: 'Clear skies', icon: '☀' };
  if ([1, 2].includes(code)) return { label: 'Partly cloudy', icon: '◐' };
  if (code === 3) return { label: 'Overcast', icon: '☁' };
  if ([45, 48].includes(code)) return { label: 'Foggy', icon: '≋' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Rain possible', icon: '☂' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snow likely', icon: '❄' };
  if ([95, 96, 99].includes(code)) return { label: 'Storm risk', icon: '⚡' };
  return { label: 'Mixed conditions', icon: '◌' };
}

// Four suggestions for a day's weather; without a forecast, the basics.
function gearFor(weather) {
  const gear = ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit'];
  if (weather) {
    if (weather.low < 45) gear[0] = 'Warm layers';
    else if (weather.high > 82) gear[0] = 'Extra water';
    if (weather.rain >= 35 || [45, 48, 71, 73, 75, 77, 85, 86].includes(weather.code)) gear[1] = 'Rain shell';
    if (weather.wind >= 20) gear[2] = 'Wind layer';
    if ([95, 96, 99].includes(weather.code)) gear[3] = 'Check storm alerts';
    else if (weather.low < 35) gear[3] = 'Gloves & warm hat';
  }
  return gear;
}

function renderGear(weather) {
  suggestedGear = gearFor(weather);
  renderPacking();
}

// ─── Packing checklist ──────────────────────────────────────────────
// Each trip plan carries one checklist in plan.packing.items. Your own gear and forecast suggestions you
// pick go into that same list. It's saved to the trip log with the plan and comes back when you reopen the trip.
// Named lists (reusable kits) are shared across trips in PACKING_LISTS_KEY and keep only item names,
// so a loaded list always starts unchecked.
// The checklist shows in the sidebar and in the trip planner; both are marked with data-pack-host
// and their parts with data-pack="…", so one set of handlers drives both.
// Forecast suggestions differ: the sidebar's follow the searched place and hike date, while the planner's
// come from the forecast for each trip day's destination on that day's date.
const PACKING_LISTS_KEY = 'wilderpath:packing-lists';
const PACK_ITEM_MAX = 60;
const PACK_LIST_NAME_MAX = 40;
const PACK_ITEMS_LIMIT = 100;
const PACK_LISTS_LIMIT = 20;
let suggestedGear = [];
const packHosts = [...document.querySelectorAll('[data-pack-host]')];

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanItemName = value => cleanText(value, PACK_ITEM_MAX);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const emptyPacking = () => ({ items: [] });

// Drops blanks and case-insensitive repeats, keeping the first.
function uniqueNames(names) {
  const unique = [];
  for (const name of names.map(cleanItemName)) if (name && !unique.some(other => sameName(other, name))) unique.push(name);
  return unique;
}

// Plans come from storage and old trip logs, so tidy whatever is there.
function cleanPacking(stored) {
  if (!stored || typeof stored !== 'object') return emptyPacking();
  const storedItems = Array.isArray(stored.items) ? stored.items.filter(item => item && typeof item === 'object') : [];
  const usedIds = new Set();
  const items = uniqueNames(storedItems.map(item => item.name)).map(name => {
    const item = storedItems.find(candidate => sameName(cleanItemName(candidate.name), name));
    // Ids find the item a checkbox belongs to, so a repeated or missing one gets a new id.
    const id = typeof item.id === 'string' && item.id && !usedIds.has(item.id) ? item.id : newId();
    usedIds.add(id);
    return { id, name, checked: item.checked === true };
  });
  return { items: items.slice(0, PACK_ITEMS_LIMIT) };
}

function readPackingLists() {
  try {
    const stored = JSON.parse(localStorage.getItem(PACKING_LISTS_KEY));
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(list => list && typeof list === 'object' && cleanText(list.name, PACK_LIST_NAME_MAX) && Array.isArray(list.items))
      .map(list => ({ id: typeof list.id === 'string' && list.id ? list.id : newId(), name: cleanText(list.name, PACK_LIST_NAME_MAX), items: uniqueNames(list.items).slice(0, PACK_ITEMS_LIMIT), savedAt: list.savedAt || null }))
      .slice(0, PACK_LISTS_LIMIT);
  } catch { return []; }
}

function savePackingLists(lists) {
  try { localStorage.setItem(PACKING_LISTS_KEY, JSON.stringify(lists)); return true; }
  catch { showToast('Could not save packing lists in this browser.'); return false; }
}

// The checklist of the trip being planned. Without a plan it's empty; editing starts a plan.
function tripPacking() {
  return plan?.packing || emptyPacking();
}

// A plan started from the checklist gets one day with no destination, so packing never puts a stop on the map.
function ensurePackingPlan() {
  if (!plan) plan = { ...newPlan({ withDay: false }), days: [newDay(null)] };
  plan.packing ||= emptyPacking();
  return plan.packing;
}

function editPacking() {
  return ensurePackingPlan();
}

function myItemNamed(name, packing = tripPacking()) {
  return packing.items.find(item => sameName(item.name, name));
}

function hostSuggestions(host) {
  return host.dataset.packHost === 'planner' ? planSuggestedGear : suggestedGear;
}

// Forecast suggestions are buttons: pick one to put it on the checklist, pick it again to take it off.
function renderSuggestions(host, packing) {
  const list = packPart(host, 'suggestions');
  if (!list) return;
  const gear = hostSuggestions(host);
  list.innerHTML = gear.map(name => {
    const added = Boolean(myItemNamed(name, packing));
    const title = added ? 'On your checklist. Select to remove it.' : 'Add to your checklist';
    return `<li><button class="suggestion${added ? ' is-added' : ''}" type="button" data-suggestion="${escapeHtml(name)}" aria-pressed="${added}" title="${title}">${escapeHtml(name)}</button></li>`;
  }).join('');
  packPart(host, 'add-all').hidden = !gear.some(name => !myItemNamed(name, packing));
  const note = packPart(host, 'forecast-note');
  if (note) note.textContent = planForecastNote;
}

// ─── Forecast suggestions for the trip plan ─────────────────────────
const FORECAST_CACHE_MS = 30 * 60 * 1000;
const forecastCache = new Map(); // "lat,lon" → { at, promise }
let planSuggestedGear = gearFor(null);
let planForecastNote = '';
let planForecastKey = '';

// One request per destination, shared by its days and reused for a while.
function fetchForecast(place) {
  const key = `${place.lat},${place.lon}`;
  const cached = forecastCache.get(key);
  if (cached && Date.now() - cached.at < FORECAST_CACHE_MS) return cached.promise;
  const promise = fetch(forecastUrl(place)).then(response => {
    if (!response.ok) throw new Error(`Forecast returned ${response.status}`);
    return response.json();
  });
  forecastCache.set(key, { at: Date.now(), promise });
  promise.catch(() => forecastCache.delete(key));
  return promise;
}

function weatherOn(data, date) {
  const index = data?.daily?.time?.indexOf(date) ?? -1;
  if (index < 0) return null;
  const daily = data.daily;
  return {
    code: daily.weather_code[index],
    high: Math.round(daily.temperature_2m_max[index]),
    low: Math.round(daily.temperature_2m_min[index]),
    rain: daily.precipitation_probability_max[index] ?? 0,
    wind: Math.round(daily.wind_speed_10m_max[index] ?? 0),
  };
}

function planDayIsoDate(target, index) {
  if (!target.startDate) return '';
  const date = new Date(`${target.startDate}T12:00`);
  date.setDate(date.getDate() + index);
  return date.toLocaleDateString('en-CA');
}

const dayList = days => (days.length === 1 ? `Day ${days[0]}` : `Days ${days.slice(0, -1).join(', ')} and ${days.at(-1)}`);

function setPlanForecast(gear, note) {
  planSuggestedGear = uniqueNames(gear);
  planForecastNote = note;
  renderPacking();
}

// Looks up each trip day's weather and merges the suggestions, so a cold day and a rainy day
// together suggest both warm layers and a rain shell. Only refetches when destinations or dates change.
function refreshPlanForecast() {
  if (!plan) return;
  const targets = plan.days
    .map((day, index) => ({ day: index + 1, place: day.destination, date: planDayIsoDate(plan, index) }))
    .filter(target => target.place);
  const key = JSON.stringify([plan.startDate, targets.map(target => [target.place.lat, target.place.lon, target.date])]);
  if (key === planForecastKey) return;
  planForecastKey = key;
  if (!targets.length) return setPlanForecast(gearFor(null), 'Add a destination to get forecast suggestions for this trip. Until then, these are the basics.');
  if (!plan.startDate) return setPlanForecast(gearFor(null), 'Set a start date to get forecast suggestions for this trip. Until then, these are the basics.');
  setPlanForecast(planSuggestedGear, 'Checking the forecast for your trip…');
  Promise.all(targets.map(target => fetchForecast(target.place)
    .then(data => ({ ...target, weather: weatherOn(data, target.date) }))
    .catch(error => { console.error('Trip forecast failed:', error); return { ...target, weather: null, failed: true }; })))
    .then(results => {
      if (key !== planForecastKey) return; // the trip changed while we were waiting
      const today = new Date().toLocaleDateString('en-CA');
      const covered = results.filter(result => result.weather);
      const failed = results.filter(result => result.failed).map(result => result.day);
      const missing = results.filter(result => !result.weather && !result.failed);
      const past = missing.filter(result => result.date < today).map(result => result.day);
      const later = missing.filter(result => result.date >= today).map(result => result.day);
      const notes = [];
      if (covered.length) {
        const places = [...new Set(covered.map(result => result.place.shortName))];
        notes.push(`From the forecast for ${dayList(covered.map(result => result.day))} (${places.join(', ')}).`);
      }
      if (past.length) notes.push(`${dayList(past)} ${past.length === 1 ? 'has' : 'have'} already passed.`);
      if (later.length) notes.push(`No forecast yet for ${dayList(later)}: forecasts cover the next 14 days.`);
      if (failed.length) notes.push(`The forecast for ${dayList(failed)} is unavailable right now.`);
      if (!covered.length) notes.push('These are the basics until a forecast is available.');
      setPlanForecast(covered.length ? covered.flatMap(result => gearFor(result.weather)) : gearFor(null), notes.join(' '));
    });
}

function packCounts(packing = tripPacking()) {
  return { total: packing.items.length, packed: packing.items.filter(item => item.checked).length };
}

function packProgressText({ total, packed }) {
  return total > 0 && packed === total ? 'ALL PACKED ✓' : `${packed}/${total} PACKED`;
}

function packPart(host, part) {
  return host.querySelector(`[data-pack="${part}"]`);
}

function packItemsMarkup(packing) {
  return packing.items.map(item => `
    <li${item.checked ? ' class="is-packed"' : ''}>
      <label class="pack-check"><input type="checkbox" data-pack-id="${escapeHtml(item.id)}"${item.checked ? ' checked' : ''} /><span>${escapeHtml(item.name)}</span></label>
      <button class="pack-remove" type="button" data-remove-pack="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)} from your checklist">×</button>
    </li>`).join('') || '<li class="pack-empty">Pick forecast suggestions or add your own gear.</li>';
}

function savedListsMarkup(lists) {
  if (!lists.length) return '<option value="">No saved lists yet</option>';
  return `<option value="">Choose a saved list (${lists.length})</option>`
    + lists.map(list => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)} · ${list.items.length} ${list.items.length === 1 ? 'item' : 'items'}</option>`).join('');
}

function renderSavedListPicker(host, lists, selectedId) {
  const select = packPart(host, 'select');
  select.innerHTML = savedListsMarkup(lists);
  if (lists.some(list => list.id === selectedId)) select.value = selectedId;
  select.disabled = !lists.length;
  packPart(host, 'load').disabled = !select.value;
  packPart(host, 'delete').disabled = !select.value;
}

// Only lists, counts and pickers are redrawn; the text boxes are left alone so typing isn't lost.
function renderPacking({ selectList } = {}) {
  const packing = tripPacking();
  const lists = readPackingLists();
  const tripName = plan ? (plan.name.trim() || defaultPlanName(plan)) : '';
  for (const host of packHosts) {
    const counts = packCounts(packing);
    const progress = packPart(host, 'progress');
    progress.textContent = packProgressText(counts);
    progress.classList.toggle('all-packed', counts.total > 0 && counts.packed === counts.total);
    packPart(host, 'list').innerHTML = packItemsMarkup(packing);
    const select = packPart(host, 'select');
    renderSavedListPicker(host, lists, selectList ?? select.value);
    const trip = packPart(host, 'trip');
    if (trip) trip.textContent = tripName ? `Packing for ${tripName}` : 'Your gear is saved with your trip plan.';
    renderSuggestions(host, packing);
  }
}

function persistPacking() {
  persistPlan(); // saves the plan and redraws the planner and the checklist
}

function addPackItem(value) {
  const name = cleanItemName(value);
  if (!name) return false;
  if (myItemNamed(name)) { notify(`${name} is already on your list.`); return false; }
  const packing = editPacking();
  if (packing.items.length >= PACK_ITEMS_LIMIT) { notify(`Your list is full (${PACK_ITEMS_LIMIT} items).`); return false; }
  packing.items.push({ id: newId(), name, checked: false });
  persistPacking();
  return true;
}

function removePackItem(id) {
  const packing = editPacking();
  packing.items = packing.items.filter(item => item.id !== id);
  persistPacking();
}

function setPackItemChecked(id, checked) {
  const item = editPacking().items.find(candidate => candidate.id === id);
  if (!item) return;
  item.checked = checked;
  persistPacking();
}

function toggleSuggestion(name) {
  const mine = myItemNamed(name);
  if (mine) {
    removePackItem(mine.id);
    notify(`Removed ${name} from your checklist.`);
  } else if (addPackItem(name)) {
    notify(`Added ${name} to your checklist.`);
  }
}

function addAllSuggestions(gear) {
  const missing = gear.filter(name => !myItemNamed(name));
  if (!missing.length) return;
  const packing = editPacking();
  const room = PACK_ITEMS_LIMIT - packing.items.length;
  missing.slice(0, room).forEach(name => packing.items.push({ id: newId(), name, checked: false }));
  persistPacking();
  notify(room < missing.length ? `Your list is full (${PACK_ITEMS_LIMIT} items).` : `Added ${missing.length} forecast ${missing.length === 1 ? 'suggestion' : 'suggestions'} to your checklist.`);
}

function uncheckAllGear() {
  if (!tripPacking().items.length) return; // nothing to clear, and no reason to start a plan
  editPacking().items.forEach(item => { item.checked = false; });
  persistPacking();
}

// Saving under a name you've used before updates that list.
function savePackingList(nameValue, host) {
  const packing = tripPacking();
  if (!packing.items.length) return notify('Add some gear before saving a list.');
  const name = cleanText(nameValue, PACK_LIST_NAME_MAX) || (currentPlace ? `${currentPlace.shortName} kit` : 'My packing list');
  const lists = readPackingLists();
  const existing = lists.find(list => sameName(list.name, name));
  const saved = { id: existing?.id || newId(), name, items: packing.items.map(item => item.name), savedAt: new Date().toISOString() };
  const next = [saved, ...lists.filter(list => list !== existing)];
  if (next.length > PACK_LISTS_LIMIT) return notify(`You can keep up to ${PACK_LISTS_LIMIT} lists. Delete one to save another.`);
  if (!savePackingLists(next)) return;
  if (host) packPart(host, 'name').value = name;
  renderPacking({ selectList: saved.id });
  notify(existing ? `Updated “${name}”.` : `Saved “${name}” to your lists.`);
}

// Loading replaces this trip's gear with the list's items, all unchecked.
function loadPackingList(id, host) {
  const list = readPackingLists().find(candidate => candidate.id === id);
  if (!list) return notify('Choose a saved list first.');
  const current = tripPacking().items;
  const loses = current.some(item => item.checked || !list.items.some(other => sameName(other, item.name)));
  if (loses && !confirm(`Replace this trip's gear with “${list.name}”? Checkmarks are cleared and items not on that list are removed.`)) return;
  ensurePackingPlan();
  plan.packing = { items: list.items.map(name => ({ id: newId(), name, checked: false })) };
  persistPacking();
  if (host) packPart(host, 'name').value = list.name;
  notify(`Loaded “${list.name}”.`);
}

function deletePackingList(id) {
  const lists = readPackingLists();
  const list = lists.find(candidate => candidate.id === id);
  if (!list || !confirm(`Delete the saved list “${list.name}”? Your trip's checklist is kept.`)) return;
  if (!savePackingLists(lists.filter(candidate => candidate !== list))) return;
  renderPacking({ selectList: '' });
  notify(`Deleted “${list.name}”.`);
}

for (const host of packHosts) {
  host.addEventListener('change', event => {
    const { packId } = event.target.dataset || {};
    if (packId !== undefined) return setPackItemChecked(packId, event.target.checked);
    if (event.target.dataset?.pack === 'select') renderSavedListPicker(host, readPackingLists(), event.target.value);
  });
  host.addEventListener('click', event => {
    const removeId = event.target.closest('[data-remove-pack]')?.dataset.removePack;
    if (removeId !== undefined) return removePackItem(removeId);
    const suggestionName = event.target.closest('[data-suggestion]')?.dataset.suggestion;
    if (suggestionName !== undefined) return toggleSuggestion(suggestionName);
    const part = event.target.closest('button[data-pack]')?.dataset.pack;
    if (part === 'add-all') return addAllSuggestions(hostSuggestions(host));
    const listId = packPart(host, 'select').value;
    if (part === 'load') loadPackingList(listId, host);
    if (part === 'delete') deletePackingList(listId);
    if (part === 'reset') {
      uncheckAllGear();
      notify('Checklist cleared.');
    }
  });
  host.addEventListener('submit', event => {
    const part = event.target.dataset?.pack;
    if (part !== 'add' && part !== 'save') return;
    event.preventDefault();
    if (part === 'save') return savePackingList(packPart(host, 'name').value, host);
    const input = packPart(host, 'input');
    if (addPackItem(input.value)) input.value = '';
    input.focus();
  }, true); // capture, so it also sees submit events that don't bubble
}

function shortName(displayName) {
  return displayName.split(',')[0].trim() || displayName;
}

const TOWN_TYPES = ['city', 'town', 'village', 'hamlet', 'municipality'];

// "Ouray, Colorado" ranks Ouray County above the town of Ouray, and the county's center is miles away.
// Unless the user asked for a county, prefer a town with the same name inside that county.
function preferTown(results, query) {
  const [top] = results;
  if (top.addresstype !== 'county' || /\bcounty\b/i.test(query)) return top;
  const countyName = shortName(top.display_name);
  const baseName = countyName.replace(/\s+county$/i, '').toLowerCase();
  return results.find(result => TOWN_TYPES.includes(result.addresstype)
    && shortName(result.display_name).toLowerCase() === baseName
    && result.display_name.includes(countyName)) || top;
}

// Returns the best match for a search, or null when nothing matches.
async function geocode(query) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error(`Location search returned ${response.status}`);
  const results = await response.json();
  if (!results.length) return null;
  const result = preferTown(results, query);
  return { name: result.display_name, shortName: shortName(result.display_name), lat: Number(result.lat), lon: Number(result.lon) };
}

async function searchLocation(query) {
  if (!query.trim()) return;
  elements.sidebar.classList.add('loading');
  try {
    const place = await geocode(query);
    if (!place) {
      showToast('No match found. Try a nearby town or landmark.');
      elements.sidebar.classList.remove('loading');
      return;
    }
    // loadNearby (via setPlace) now owns the loading indicator and clears it when trails finish.
    setPlace(place);
  } catch (error) {
    console.error('Location search failed:', error);
    showToast('Location search is unavailable. Please try again.');
    elements.sidebar.classList.remove('loading');
  }
}

function setPlace(place) {
  currentPlace = place;
  elements.locationInput.value = place.shortName;
  elements.mapPlace.textContent = place.name.toUpperCase();
  elements.mapPlace.title = place.name;
  elements.resultTitle.textContent = `Around ${place.shortName}`;
  map.flyTo([place.lat, place.lon], 12, { duration: 0.6 });
  loadNearby(place);
  loadWeather(place);
  updateSaveButton();
  updateHotelsLink();
  if (window.innerWidth <= 800) document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Opens Google Hotels for the current place, checking in on the hike date for one night.
function updateHotelsLink() {
  if (!currentPlace) return;
  const params = new URLSearchParams({ q: `hotels near ${currentPlace.name}` });
  const checkIn = elements.tripDate.value;
  if (checkIn) {
    const checkOut = new Date(`${checkIn}T12:00`);
    checkOut.setDate(checkOut.getDate() + 1);
    params.set('checkin', checkIn);
    params.set('checkout', checkOut.toLocaleDateString('en-CA'));
  }
  elements.findHotels.href = `https://www.google.com/travel/search?${params}`;
  elements.findHotels.hidden = false;
}

function readFuelInputs() {
  const miles = Math.max(0, Number(elements.roadMiles.value) || 0);
  const mpg = Math.max(1, Number(elements.mpg.value) || 1);
  const price = Math.max(0, Number(elements.fuelPrice.value) || 0);
  elements.fuelTotal.textContent = `$${(miles * price / mpg).toFixed(2)}`;
}

function placeIsFavorite() {
  return currentPlace && readStorage(STORAGE_KEYS.favorites).some(item => item.name === currentPlace.name);
}

function updateSaveButton() {
  const saved = placeIsFavorite();
  elements.savePlace.classList.toggle('is-saved', Boolean(saved));
  elements.savePlace.textContent = saved ? '★' : '☆';
  elements.savePlace.setAttribute('aria-label', saved ? 'Remove favorite' : 'Save this destination');
}

function toggleFavorite() {
  if (!currentPlace) return showToast('Search a destination first.');
  const favorites = readStorage(STORAGE_KEYS.favorites);
  const index = favorites.findIndex(item => item.name === currentPlace.name);
  if (index >= 0) {
    favorites.splice(index, 1);
    showToast('Removed from favorites.');
  } else {
    favorites.unshift({ ...currentPlace, savedAt: new Date().toISOString() });
    showToast('Destination saved to favorites.');
  }
  saveStorage(STORAGE_KEYS.favorites, favorites);
  updateSaveButton();
  renderSaved();
}

// Trip log entries are either saved plans (with `days`) or one-place logs from before the planner.
function tripLogMeta(item) {
  if (!item.days) return `${item.date || 'Date not set'} · ${item.hours} hr plan`;
  const totals = planTotals(item);
  const days = `${item.days.length} ${item.days.length === 1 ? 'day' : 'days'}`;
  const parts = [item.startDate || 'Date not set', days, `${totals.trails} trails`, `${totals.miles.toFixed(1)} mi`];
  if (totals.trails) parts.push(completedLabel(planCompletedCount(item), totals.trails));
  const gear = packCounts(cleanPacking(item.packing));
  if (gear.total) parts.push(`${gear.packed}/${gear.total} packed`);
  return parts.join(' · ');
}

function planCompletedCount(target) {
  const done = completedIds();
  return target.days.reduce((sum, day) => sum + day.trails.filter(trail => done.has(trail.id)).length, 0);
}

function favoriteMeta(place) {
  const count = completedNear(place);
  return count ? `Favorite destination · ${completedLabel(count)}` : 'Favorite destination';
}

function completedMeta(trail) {
  const date = trail.completedAt ? new Date(trail.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return [date && `Completed ${date}`, trailSummary(trail)].filter(Boolean).join(' · ');
}

const SAVED_TABS = {
  favorites: { key: STORAGE_KEYS.favorites, where: 'favorites', empty: 'Your saved places will live here.' },
  trips: { key: STORAGE_KEYS.trips, where: 'trip log', empty: 'Your completed plans will show up here.' },
  completed: { key: STORAGE_KEYS.completed, where: 'completed trails', empty: 'Check off a trail to track the hikes you’ve finished.' },
};

function renderSaved() {
  const favorites = readStorage(STORAGE_KEYS.favorites);
  const trips = readStorage(STORAGE_KEYS.trips);
  const completed = completedTrails();
  elements.favoriteCount.textContent = favorites.length;
  elements.tripCount.textContent = trips.length;
  elements.completedCount.textContent = completed.length;
  const items = { favorites, trips, completed }[savedTab];
  const tab = SAVED_TABS[savedTab];
  if (!items.length) {
    elements.savedList.innerHTML = `<p class="empty-saved">${escapeHtml(tab.empty)}</p>`;
    return;
  }
  const visible = showAllSaved ? items : items.slice(0, SAVED_PREVIEW_LIMIT);
  const rows = visible.map((item, index) => {
    const title = item.days || savedTab === 'completed' ? item.name : item.shortName;
    const metadata = { favorites: favoriteMeta, trips: tripLogMeta, completed: completedMeta }[savedTab](item);
    const removeLabel = savedTab === 'completed' ? `Mark ${title} as not completed` : `Remove ${title} from ${tab.where}`;
    const mark = savedTab === 'completed' ? '<span class="saved-check" aria-hidden="true">✓</span>' : '';
    return `<div class="saved-item">${mark}<button class="saved-item-open" type="button" data-saved-index="${index}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(metadata)}</span></button><button class="remove-saved" type="button" data-remove-index="${index}" aria-label="${escapeHtml(removeLabel)}">×</button></div>`;
  });
  if (items.length > SAVED_PREVIEW_LIMIT) {
    const label = showAllSaved ? 'Show less' : `Show all ${items.length}`;
    rows.push(`<button class="show-more-saved" type="button" data-toggle-saved>${label}</button>`);
  }
  elements.savedList.innerHTML = rows.join('');
}

function selectSavedItem(index) {
  const items = readStorage(SAVED_TABS[savedTab].key);
  const item = items[index];
  if (!item) return;
  if (savedTab === 'completed') return openPlannedTrail(item);
  if (item.days) {
    setPlan(structuredClone(item));
    openPlanner();
    return;
  }
  setPlace(item);
}

// ─── Trail details panel ────────────────────────────────────────────

const ELEVATION_POINT_LIMIT = 100; // Open-Meteo accepts up to 100 points per request.
const elevationCache = new Map(); // trail id → 'loading' | 'error' | { lowFt, highFt, climbFt }
let sheetTrail = null;

const VISIBILITY = { excellent: 'Excellent', good: 'Good', intermediate: 'Some gaps', bad: 'Hard to follow', horrible: 'Very hard to follow', no: 'No visible path' };
const PERMISSION = { yes: 'Allowed', designated: 'Allowed', permissive: 'Allowed', no: 'Not allowed', private: 'Private', leashed: 'On leash', unleashed: 'Off leash OK', dismount: 'Walk bikes', limited: 'Limited' };

const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);
const tagText = value => PERMISSION[value] || capitalize(value.replaceAll('_', ' ').replaceAll(';', ', '));
const formatFeet = feet => `${Math.round(feet).toLocaleString()} ft`;

// Only allow http(s) links from map data.
function safeUrl(value) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function openTrailDetails(trail) {
  sheetTrail = trail;
  elements.trailSheet.hidden = false;
  renderTrailSheet();
  if (trail.lines?.length && !elevationCache.has(trail.id)) loadElevation(trail);
}

function closeTrailDetails() {
  sheetTrail = null;
  elements.trailSheet.hidden = true;
  elements.trailSheet.innerHTML = '';
  delete elements.trailSheet.dataset.trailId;
}

function trailElevation(trail) {
  const cached = elevationCache.get(trail.id);
  return typeof cached === 'object' ? cached : trail.elevation || null;
}

function samplePoints(line, count) {
  if (line.length <= count) return line;
  return Array.from({ length: count }, (_, index) => line[Math.round(index * (line.length - 1) / (count - 1))]);
}

// Samples points along the trail and asks Open-Meteo for their elevation.
// Segment direction in OSM is arbitrary, so "climbing" is the larger of total up and total down.
async function loadElevation(trail) {
  elevationCache.set(trail.id, 'loading');
  const lines = [...trail.lines].sort((a, b) => b.length - a.length).slice(0, 25);
  const totalPoints = lines.reduce((sum, line) => sum + line.length, 0);
  const spare = ELEVATION_POINT_LIMIT - lines.length * 2;
  const samples = lines.map(line => samplePoints(line, 2 + Math.floor(spare * line.length / totalPoints)));
  const points = samples.flat();
  try {
    const params = new URLSearchParams({
      latitude: points.map(point => point[0]).join(','),
      longitude: points.map(point => point[1]).join(','),
    });
    const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);
    if (!response.ok) throw new Error(`Elevation returned ${response.status}`);
    const { elevation } = await response.json();
    if (!Array.isArray(elevation) || elevation.length !== points.length) throw new Error('Elevation data incomplete');
    let offset = 0;
    let up = 0;
    let down = 0;
    for (const sample of samples) {
      const heights = elevation.slice(offset, offset + sample.length);
      offset += sample.length;
      for (let index = 1; index < heights.length; index += 1) {
        const change = heights[index] - heights[index - 1];
        if (change > 0) up += change;
        else down -= change;
      }
    }
    const result = {
      lowFt: Math.round(metersToFeet(Math.min(...elevation))),
      highFt: Math.round(metersToFeet(Math.max(...elevation))),
      climbFt: Math.round(metersToFeet(Math.max(up, down))),
    };
    elevationCache.set(trail.id, result);
    updatePlannedElevation(trail.id, result);
    // Climbing changes the time estimate, which the cards and the time filter use.
    if (currentItems.some(item => item.id === trail.id)) {
      if (trailFilters.time !== 'any') { drawItems(filteredItems()); highlightSelection(); }
      renderResults();
    }
  } catch (error) {
    console.error('Elevation lookup failed:', error);
    elevationCache.set(trail.id, 'error');
  }
  if (sheetTrail?.id === trail.id) renderTrailSheet();
}

function elevationText(trail) {
  const elevation = trailElevation(trail);
  if (elevation) return `${formatFeet(elevation.lowFt)} – ${formatFeet(elevation.highFt)} · ~${formatFeet(elevation.climbFt)} of climbing`;
  const status = elevationCache.get(trail.id);
  if (status === 'loading') return 'Checking elevation…';
  if (status === 'error') return 'Elevation unavailable right now.';
  return 'Elevation not loaded for this trail.';
}

function renderTrailSheet() {
  const trail = sheetTrail;
  if (!trail) return;
  const tags = trail.tags || {};
  const difficulty = difficultyInfo(trailDifficulty(trail));
  const climb = trailElevation(trail)?.climbFt;
  const hasLength = trail.length > 0;
  const unrated = difficultyGroup(trailDifficulty(trail)) === 'unrated';
  const yourRating = userDifficulty(trail);
  const mapLabel = DIFFICULTY[mappedDifficulty(trail)]?.label;
  const facts = [
    currentPlace && trail.center && [`From ${currentPlace.shortName}`, formatDistance(distanceBetween([currentPlace.lat, currentPlace.lon], trail.center))],
    ['Surface', tags.surface && tagText(tags.surface)],
    ['Trail markings', tags.trail_visibility && (VISIBILITY[tags.trail_visibility] || tagText(tags.trail_visibility))],
    ['Dogs', tags.dog && tagText(tags.dog)],
    ['Bikes', tags.bicycle && tagText(tags.bicycle)],
    ['Horses', tags.horse && tagText(tags.horse)],
    ['Wheelchair', tags.wheelchair && tagText(tags.wheelchair)],
    ['Fee', tags.fee && tagText(tags.fee)],
    ['Access', tags.access && tagText(tags.access)],
    ['Managed by', tags.operator],
  ].filter(fact => fact && fact[1]);
  const [lat, lon] = trail.start || trail.center;
  const links = [`<a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">Directions ↗</a>`];
  if (trail.osm?.[0]) links.push(`<a href="https://www.openstreetmap.org/${escapeHtml(trail.osm[0])}" target="_blank" rel="noopener">OpenStreetMap ↗</a>`);
  const website = tags.website && safeUrl(tags.website);
  if (website) links.push(`<a href="${escapeHtml(website)}" target="_blank" rel="noopener">Website ↗</a>`);
  // Re-renders (e.g. when elevation arrives) should keep the day the user already picked.
  const pickedDay = elements.trailSheet.dataset.trailId === trail.id ? elements.trailSheet.querySelector('#sheet-day')?.value : null;
  elements.trailSheet.dataset.trailId = trail.id;

  elements.trailSheet.innerHTML = `
    <header class="sheet-head">
      <div><p class="eyebrow">TRAIL DETAILS</p><h3 id="trail-sheet-title">${escapeHtml(trail.name)}</h3></div>
      <button class="sheet-close" type="button" data-sheet-action="close" aria-label="Close trail details">×</button>
    </header>
    <div class="sheet-stats">
      <div${hasLength ? '' : ' class="missing-stat"'}><strong>${hasLength ? `${metersToMiles(trail.length).toFixed(1)} mi` : 'Unknown'}</strong><span>MAPPED LENGTH</span></div>
      <div${hasLength ? '' : ' class="missing-stat"'}><strong>${hasLength ? `~${formatDuration(hikeMinutes(trail.length, climb) * 60)}` : 'Unknown'}</strong><span>EST. TIME</span></div>
      <div${unrated ? ' class="missing-stat"' : ''}><strong>${unrated ? '? Not rated' : `${yourRating ? '✎ ' : ''}${escapeHtml(difficulty.label)}`}</strong><span>${yourRating ? 'YOUR RATING' : 'DIFFICULTY'}</span></div>
    </div>
    <p class="sheet-note">${escapeHtml(difficulty.note)}${yourRating ? ` <em>Map data: ${escapeHtml(mapLabel || 'not rated')}.</em>` : ''}</p>
    <div class="sheet-rating">
      <label class="field-label" for="sheet-rating">${yourRating ? 'CHANGE YOUR RATING' : 'RATE THIS TRAIL'}</label>
      <select id="sheet-rating" class="input-field">
        <option value=""${yourRating ? '' : ' selected'}>${mapLabel ? `Use map rating · ${escapeHtml(mapLabel)}` : 'No rating'}</option>
        ${Object.entries(DIFFICULTY).map(([value, info]) => `<option value="${value}"${value === yourRating ? ' selected' : ''}>${escapeHtml(info.label)}: ${escapeHtml(info.note)}</option>`).join('')}
      </select>
    </div>
    <label class="sheet-done${isCompleted(trail.id) ? ' is-done' : ''}"><input type="checkbox" id="sheet-completed"${isCompleted(trail.id) ? ' checked' : ''} /> <span>${isCompleted(trail.id) ? 'Completed ✓' : 'Mark as completed'}</span></label>
    <div class="sheet-elevation"><span class="field-label">ELEVATION</span><p>${escapeHtml(elevationText(trail))}</p></div>
    ${facts.length ? `<dl class="sheet-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
    ${tags.description ? `<p class="sheet-description">${escapeHtml(tags.description)}</p>` : ''}
    ${trailPlanMarkup(trail)}
    <div class="sheet-links">${links.join('')}</div>
    <p class="sheet-fine">Length is the total of mapped segments; time uses 2 mph plus 30 min per 1,000 ft of climbing.</p>`;
  const daySelect = elements.trailSheet.querySelector('#sheet-day');
  if (daySelect && pickedDay && [...daySelect.options].some(option => option.value === pickedDay)) daySelect.value = pickedDay;
}

function plannedDayIndex(trailId) {
  return plan ? plan.days.findIndex(day => day.trails.some(trail => trail.id === trailId)) : -1;
}

// Suggests the day whose destination is closest to the trail (within 30 miles).
function suggestDay(trail) {
  if (!plan?.days.length) return 'new';
  let best = plan.days.length - 1;
  let bestDistance = Infinity;
  plan.days.forEach((day, index) => {
    if (!day.destination) return;
    const distance = distanceBetween([day.destination.lat, day.destination.lon], trail.center);
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  });
  if (bestDistance < 48000) return best;
  const openDay = plan.days.findIndex(day => !day.destination);
  return openDay >= 0 ? openDay : 'new';
}

function trailPlanMarkup(trail) {
  const plannedDay = plannedDayIndex(trail.id);
  if (plannedDay >= 0) {
    return `<div class="sheet-plan"><p>On <strong>Day ${plannedDay + 1}</strong> of your trip.</p>
      <div class="sheet-plan-row"><button class="ghost-button" type="button" data-sheet-action="remove">Remove from trip</button><button class="ghost-button" type="button" data-sheet-action="planner">Open planner ↗</button></div></div>`;
  }
  const days = plan?.days || [];
  const suggested = suggestDay(trail);
  const options = days.map((day, index) => `<option value="${index}"${index === suggested ? ' selected' : ''}>Day ${index + 1}${day.destination ? ` · ${escapeHtml(day.destination.shortName)}` : ''}</option>`).join('')
    + `<option value="new"${suggested === 'new' ? ' selected' : ''}>${days.length ? 'New day' : 'Day 1'}</option>`;
  return `<div class="sheet-plan"><label class="field-label" for="sheet-day">ADD TO TRIP</label>
    <div class="sheet-plan-row"><select id="sheet-day" class="input-field">${options}</select><button class="primary-button" type="button" data-sheet-action="add">Add</button></div>
    <button class="text-button" type="button" data-sheet-action="planner">Open planner ↗</button></div>`;
}

// Planned trails keep what the details panel needs, without the full map geometry.
function planTrail(trail) {
  const { id, name, length, difficulty, tags, osm, center, start } = trail;
  return { id, name, length, difficulty, tags, osm, center, start, elevation: trailElevation(trail) };
}

function addTrailToPlan(trail, dayValue) {
  ensurePlan({ withDay: false });
  const index = dayValue === 'new' ? plan.days.push(newDay(currentPlace)) - 1 : Number(dayValue);
  const day = plan.days[index];
  if (!day) return;
  if (!day.destination && currentPlace) day.destination = pickPlace(currentPlace);
  day.trails.push(planTrail(trail));
  persistPlan();
  showToast(`Added to Day ${index + 1}.`);
}

function removeTrailFromPlan(trailId) {
  if (!plan) return;
  plan.days.forEach(day => { day.trails = day.trails.filter(trail => trail.id !== trailId); });
  persistPlan();
}

function updatePlannedElevation(trailId, elevation) {
  if (!plan) return;
  let changed = false;
  plan.days.forEach(day => day.trails.forEach(trail => {
    if (trail.id === trailId && !trail.elevation) { trail.elevation = elevation; changed = true; }
  }));
  if (changed) persistPlan();
}

// Trails from a saved plan may not be in the current search results, so mark them by hand.
function openPlannedTrail(trail) {
  if (currentItems.some(item => item.id === trail.id)) return focusItem(trail.id);
  selectedItemId = trail.id;
  highlightSelection();
  highlightLayer.clearLayers();
  L.circleMarker(trail.center, { radius: 10, color: '#d7765a', weight: 3, fillOpacity: 0.25 }).addTo(highlightLayer);
  map.flyTo(trail.center, 14, { duration: 0.55 });
  openTrailDetails(trail);
}

// ─── Trip planner ───────────────────────────────────────────────────

const PLAN_KEY = 'wilderpath:plan-draft';
// Roads wind, so straight-line distance is scaled up for a rough road estimate.
const ROAD_FACTOR = 1.3;
const LONG_DAY_MINUTES = 8 * 60;
let plan = readPlan();
let planStatusTimer;

function readPlan() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAN_KEY));
    return Array.isArray(stored?.days) ? { ...stored, packing: cleanPacking(stored.packing) } : null;
  } catch { return null; }
}

function newId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function pickPlace(place) {
  return { name: place.name, shortName: place.shortName, lat: place.lat, lon: place.lon };
}

function newDay(destination) {
  return { destination: destination ? pickPlace(destination) : null, trails: [] };
}

function newPlan({ withDay = true } = {}) {
  return { id: newId(), name: '', startDate: elements.tripDate.value, days: withDay ? [newDay(currentPlace)] : [], packing: emptyPacking() };
}

function ensurePlan(options) {
  if (!plan) plan = newPlan(options);
  return plan;
}

function setPlan(next) {
  // Trips saved before checklists belonged to plans have none.
  plan = next && { ...next, packing: cleanPacking(next.packing) };
  persistPlan();
}

function persistPlan() {
  if (plan) localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  else localStorage.removeItem(PLAN_KEY);
  refreshPlanViews();
}

function refreshPlanViews() {
  drawPlanStops();
  const trailCount = plan ? plan.days.reduce((sum, day) => sum + day.trails.length, 0) : 0;
  elements.planBadge.hidden = !trailCount;
  elements.planBadge.textContent = trailCount;
  if (elements.planner.open) renderPlanner();
  if (sheetTrail) renderTrailSheet();
  renderPacking();
}

// The planner is a modal, so the map toast would be hidden behind it.
function notify(message) {
  if (!elements.planner.open) return showToast(message);
  elements.planStatus.textContent = message;
  clearTimeout(planStatusTimer);
  planStatusTimer = setTimeout(() => { elements.planStatus.textContent = ''; }, 3000);
}

function defaultPlanName(target) {
  const first = target.days.find(day => day.destination)?.destination;
  return first ? `${first.shortName} trip` : 'My hiking trip';
}

function dayTotals(day) {
  return day.trails.reduce((totals, trail) => {
    if (!(trail.length > 0)) return totals;
    totals.miles += metersToMiles(trail.length);
    totals.minutes += hikeMinutes(trail.length, trail.elevation?.climbFt);
    return totals;
  }, { miles: 0, minutes: 0 });
}

function roadMilesBetween(a, b) {
  return metersToMiles(distanceBetween([a.lat, a.lon], [b.lat, b.lon])) * ROAD_FACTOR;
}

// Drives between consecutive different destinations, plus to and from home when we know where that is.
function roadLegs(target) {
  const legs = [];
  let previous = userPosition ? { place: { ...userPosition, shortName: 'your location' }, day: -1 } : null;
  target.days.forEach((day, index) => {
    const stop = day.destination;
    if (!stop || (previous && previous.place.lat === stop.lat && previous.place.lon === stop.lon)) return;
    if (previous) legs.push({ toDay: index, from: previous.place.shortName, miles: roadMilesBetween(previous.place, stop) });
    previous = { place: stop, day: index };
  });
  if (userPosition && previous?.day >= 0) legs.push({ toDay: null, miles: roadMilesBetween(previous.place, userPosition) });
  return legs;
}

function planTotals(target) {
  const totals = target.days.map(dayTotals);
  return {
    trails: target.days.reduce((sum, day) => sum + day.trails.length, 0),
    miles: totals.reduce((sum, day) => sum + day.miles, 0),
    minutes: totals.reduce((sum, day) => sum + day.minutes, 0),
    roadMiles: roadLegs(target).reduce((sum, leg) => sum + leg.miles, 0),
  };
}

function dayDate(index) {
  if (!plan.startDate) return '';
  const date = new Date(`${plan.startDate}T12:00`);
  date.setDate(date.getDate() + index);
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

function trailSummary(trail) {
  const label = DIFFICULTY[trailDifficulty(trail)]?.label;
  const difficulty = label ? `${label}${userDifficulty(trail) ? ' (your rating)' : ''}` : 'Not rated';
  if (!(trail.length > 0)) return `Length & time unknown · ${difficulty}`;
  return [`${metersToMiles(trail.length).toFixed(1)} mi`, `~${formatDuration(hikeMinutes(trail.length, trail.elevation?.climbFt) * 60)}`, difficulty].join(' · ');
}

function dayMarkup(day, index, leg) {
  const totals = dayTotals(day);
  const destination = day.destination;
  const date = dayDate(index);
  const canUseMap = currentPlace && destination?.name !== currentPlace.name;
  const done = completedIds();
  const trails = day.trails.map((trail, trailIndex) => `
    <li class="plan-trail${done.has(trail.id) ? ' completed' : ''}">
      <input class="plan-trail-done" type="checkbox" data-complete-trail="${index}:${trailIndex}"${done.has(trail.id) ? ' checked' : ''} aria-label="Mark ${escapeHtml(trail.name)} as completed" title="Completed" />
      <button class="plan-trail-open" type="button" data-plan-trail="${index}:${trailIndex}"><strong>${escapeHtml(trail.name)}</strong><span>${escapeHtml(trailSummary(trail))}</span></button>
      <button class="remove-saved" type="button" data-remove-trail="${index}:${trailIndex}" aria-label="Remove ${escapeHtml(trail.name)} from day ${index + 1}">×</button>
    </li>`).join('');
  const hiking = totals.minutes ? `${totals.miles.toFixed(1)} mi · ~${formatDuration(totals.minutes * 60)} hiking` : 'No hiking planned yet';
  return `
    <li class="plan-day">
      <div class="plan-day-head">
        <div><span class="field-label">DAY ${index + 1}${date ? ` · ${date}` : ''}</span><strong>${destination ? escapeHtml(destination.shortName) : 'Pick a destination'}</strong></div>
        <button class="remove-saved" type="button" data-remove-day="${index}" aria-label="Remove day ${index + 1}"${plan.days.length === 1 ? ' disabled' : ''}>×</button>
      </div>
      ${leg ? `<p class="plan-leg">≈ ${Math.round(leg.miles)} road mi from ${escapeHtml(leg.from)}</p>` : ''}
      <form class="plan-dest-form" data-dest-form="${index}">
        <input class="input-field" name="q" type="search" placeholder="${destination ? 'Change destination' : 'Search a destination'}" aria-label="Destination for day ${index + 1}" autocomplete="off" />
        <button class="ghost-button" type="submit">Set</button>
      </form>
      ${canUseMap ? `<button class="text-button" type="button" data-use-current="${index}">Use map location · ${escapeHtml(currentPlace.shortName)}</button>` : ''}
      ${trails ? `<ul class="plan-trails">${trails}</ul>` : '<p class="plan-hint">No trails yet. Click a trail on the map, then “Add”.</p>'}
      <div class="plan-day-foot">
        <span>${hiking}</span>
        ${totals.minutes > LONG_DAY_MINUTES ? '<span class="plan-warn">Long day. Consider splitting it.</span>' : ''}
        ${destination ? `<button class="text-button" type="button" data-explore-day="${index}">Find trails here ↗</button>` : ''}
      </div>
    </li>`;
}

function renderPlanSummary() {
  const totals = planTotals(plan);
  const stat = (value, label) => `<div class="plan-stat"><strong>${value}</strong><span>${label}</span></div>`;
  const roadNote = userPosition ? 'including to and from your location' : 'use “Go to my location” to include the drive from home';
  elements.planSummary.innerHTML = `
    <div class="plan-stats">
      ${stat(plan.days.length, plan.days.length === 1 ? 'DAY' : 'DAYS')}
      ${stat(totals.trails, totals.trails === 1 ? 'TRAIL' : 'TRAILS')}
      ${stat(totals.miles.toFixed(1), 'TRAIL MI')}
      ${stat((totals.minutes / 60).toFixed(1), 'HIKING HRS')}
      ${stat(Math.round(totals.roadMiles), 'ROAD MI*')}
    </div>
    <p class="plan-note">*Rough estimate: straight-line distance × ${ROAD_FACTOR}, ${roadNote}.${totals.roadMiles > 0 ? ' <button class="text-button" type="button" data-plan-fuel>Use in fuel estimate</button>' : ''}</p>`;
}

function renderPlanner() {
  ensurePlan();
  if (document.activeElement !== elements.planName) elements.planName.value = plan.name;
  elements.planName.placeholder = defaultPlanName(plan);
  elements.planStart.value = plan.startDate || '';
  elements.planStart.min = elements.tripDate.min;
  renderPlanSummary();
  const legs = roadLegs(plan);
  elements.planDays.innerHTML = plan.days.map((day, index) => dayMarkup(day, index, legs.find(leg => leg.toDay === index))).join('')
    || '<li class="plan-hint">No days yet. Add one to get started.</li>';
  refreshPlanForecast();
}

function openPlanner() {
  planForecastKey = ''; // check the trip's forecast again each time the planner opens
  ensurePlan();
  persistPlan();
  renderPlanner();
  if (!elements.planner.open) elements.planner.showModal();
}

function drawPlanStops() {
  planLayer.clearLayers();
  if (!plan) return;
  const stops = new Map();
  const path = [];
  plan.days.forEach((day, index) => {
    const stop = day.destination;
    if (!stop) return;
    const key = `${stop.lat},${stop.lon}`;
    if (!stops.has(key)) stops.set(key, { place: stop, days: [] });
    stops.get(key).days.push(index + 1);
    const last = path.at(-1);
    if (!last || last[0] !== stop.lat || last[1] !== stop.lon) path.push([stop.lat, stop.lon]);
  });
  if (path.length > 1) L.polyline(path, { color: '#d7765a', weight: 2, opacity: 0.85, dashArray: '2 7', interactive: false }).addTo(planLayer);
  for (const { place, days } of stops.values()) {
    const icon = L.divIcon({ className: '', html: `<div class="plan-stop">${days.join(',')}</div>`, iconSize: null });
    L.marker([place.lat, place.lon], { icon, title: `Day ${days.join(', ')}: ${place.shortName}`, zIndexOffset: 500 })
      .on('click', openPlanner)
      .addTo(planLayer);
  }
}

function savePlanToLog() {
  if (!plan.days.some(day => day.destination || day.trails.length)) return notify('Add a destination or trail before saving.');
  if (!plan.name.trim()) plan.name = defaultPlanName(plan);
  const trips = readStorage(STORAGE_KEYS.trips);
  const existing = trips.findIndex(trip => trip.id === plan.id);
  if (existing >= 0) trips.splice(existing, 1);
  trips.unshift({ ...structuredClone(plan), savedAt: new Date().toISOString() });
  saveStorage(STORAGE_KEYS.trips, trips.slice(0, 50));
  persistPlan();
  renderSaved();
  notify(existing >= 0 ? 'Trip log updated.' : 'Saved to your trip log.');
}

function dayAndTrail(value) {
  const [dayIndex, trailIndex] = value.split(':').map(Number);
  return { day: plan.days[dayIndex], trailIndex };
}

elements.trailSheet.addEventListener('click', event => {
  const action = event.target.closest('[data-sheet-action]')?.dataset.sheetAction;
  if (!action || !sheetTrail) return;
  if (action === 'close') closeTrailDetails();
  if (action === 'add') addTrailToPlan(sheetTrail, elements.trailSheet.querySelector('#sheet-day').value);
  if (action === 'remove') removeTrailFromPlan(sheetTrail.id);
  if (action === 'planner') openPlanner();
});

elements.trailSheet.addEventListener('change', event => {
  if (event.target.id === 'sheet-completed' && sheetTrail) setTrailCompleted(sheetTrail, event.target.checked);
  if (event.target.id === 'sheet-rating' && sheetTrail) setUserDifficulty(sheetTrail, event.target.value);
});

elements.planDays.addEventListener('change', event => {
  const value = event.target.dataset?.completeTrail;
  if (value === undefined) return;
  const { day, trailIndex } = dayAndTrail(value);
  const trail = day?.trails[trailIndex];
  if (trail) setTrailCompleted(trail, event.target.checked);
});

elements.planner.addEventListener('click', event => {
  // Clicks on the dialog element itself, outside its box, are backdrop clicks.
  if (event.target === elements.planner) {
    const box = elements.planner.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) elements.planner.close();
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  const { removeDay, removeTrail, planTrail: plannedTrail, useCurrent, exploreDay } = button.dataset;
  if (removeDay !== undefined && plan.days.length > 1) {
    plan.days.splice(Number(removeDay), 1);
    persistPlan();
  } else if (removeTrail !== undefined) {
    const { day, trailIndex } = dayAndTrail(removeTrail);
    day?.trails.splice(trailIndex, 1);
    persistPlan();
  } else if (plannedTrail !== undefined) {
    const { day, trailIndex } = dayAndTrail(plannedTrail);
    const trail = day?.trails[trailIndex];
    if (!trail) return;
    elements.planner.close();
    openPlannedTrail(trail);
  } else if (useCurrent !== undefined && currentPlace) {
    plan.days[Number(useCurrent)].destination = pickPlace(currentPlace);
    persistPlan();
  } else if (exploreDay !== undefined) {
    const destination = plan.days[Number(exploreDay)]?.destination;
    if (!destination) return;
    elements.planner.close();
    setPlace(destination);
  } else if (button.hasAttribute('data-plan-fuel')) {
    elements.roadMiles.value = Math.round(planTotals(plan).roadMiles);
    readFuelInputs();
    notify('Road miles copied to the fuel estimate.');
  }
});

elements.planDays.addEventListener('submit', async event => {
  const form = event.target.closest('[data-dest-form]');
  if (!form) return;
  event.preventDefault();
  const query = form.elements.q.value.trim();
  if (!query) return;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = '…';
  try {
    const place = await geocode(query);
    if (!place) return notify('No match found. Try a nearby town or landmark.');
    const day = plan.days[Number(form.dataset.destForm)];
    if (!day) return;
    day.destination = pickPlace(place);
    persistPlan();
  } catch (error) {
    console.error('Destination search failed:', error);
    notify('Location search is unavailable. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Set';
  }
});

elements.plannerClose.addEventListener('click', () => elements.planner.close());
elements.planName.addEventListener('input', () => {
  plan.name = elements.planName.value;
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  renderPacking(); // the sidebar says which trip you're packing for
});
elements.planName.addEventListener('change', persistPlan);
elements.planStart.addEventListener('change', () => {
  plan.startDate = elements.planStart.value;
  persistPlan();
});
elements.planAddDay.addEventListener('click', () => {
  plan.days.push(newDay(plan.days.at(-1)?.destination || currentPlace));
  persistPlan();
  elements.planDays.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
elements.planNew.addEventListener('click', () => {
  const hasContent = plan.days.some(day => day.destination || day.trails.length) || tripPacking().items.length > 0;
  if (hasContent && !confirm('Clear this plan and start a new one? Trips already saved to your log are kept.')) return;
  setPlan(newPlan());
  notify('Started a new plan.');
});
elements.planSave.addEventListener('click', savePlanToLog);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && sheetTrail && !elements.planner.open) closeTrailDetails();
});

function initializeDate() {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  elements.tripDate.value = localDate;
  elements.tripDate.min = localDate;
}

elements.searchForm.addEventListener('submit', event => {
  event.preventDefault();
  searchLocation(elements.locationInput.value);
});

// GO TO MY LOCATION
// This only moves the map. It does not change the selected destination.

function resetLocationButton() {
  elements.nearMe.innerHTML =
    '<span aria-hidden="true">◎</span> Go to my location';
}

resetLocationButton();

elements.nearMe.addEventListener('click', () => {
  if (!navigator.geolocation) {
    return showToast('Location services are not available in this browser.');
  }

  elements.nearMe.textContent = 'Finding your location…';
  elements.nearMe.disabled = true;

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      userPosition = { lat: latitude, lon: longitude };

      // Center the map on the user's GPS position.
      map.flyTo([latitude, longitude], 12, {
        duration: 0.6
      });

      // Remove any old search text left by the previous feature.
      if (elements.locationInput.value.trim().toLowerCase() === 'your location') {
        elements.locationInput.value = '';
      }

      resetLocationButton();
      elements.nearMe.disabled = false;

      showToast('Map centered on your location.');
    },
    error => {
      console.error('Geolocation failed:', error);

      resetLocationButton();
      elements.nearMe.disabled = false;

      showToast('Could not access your location. Check browser permissions.');
    },
    {
      timeout: 10000,
      maximumAge: 300000
    }
  );
});

elements.difficultyChips.addEventListener('click', event => {
  const id = event.target.closest('[data-difficulty]')?.dataset.difficulty;
  if (!id) return;
  const selected = new Set(trailFilters.difficulty);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  trailFilters.difficulty = DIFFICULTY_GROUPS.map(group => group.id).filter(group => selected.has(group));
  applyFilters();
});
elements.filterLength.addEventListener('change', () => { trailFilters.length = elements.filterLength.value; applyFilters(); });
elements.filterTime.addEventListener('change', () => { trailFilters.time = elements.filterTime.value; applyFilters(); });
elements.filterClear.addEventListener('click', clearFilters);

elements.resultList.addEventListener('click', event => {
  if (event.target.closest('[data-clear-filters]')) return clearFilters();
  const button = event.target.closest('[data-item-id]');
  if (button) focusItem(button.dataset.itemId);
});

elements.resultList.addEventListener('change', event => {
  const id = event.target.dataset?.completeId;
  const item = id && currentItems.find(candidate => candidate.id === id);
  if (item) setTrailCompleted(item, event.target.checked);
});

elements.savePlace.addEventListener('click', toggleFavorite);
elements.planTrip.addEventListener('click', openPlanner);

document.querySelectorAll('.saved-tab').forEach(button => button.addEventListener('click', () => {
  savedTab = button.dataset.tab;
  showAllSaved = false;
  document.querySelectorAll('.saved-tab').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  renderSaved();
}));

elements.savedList.addEventListener('click', event => {
  if (event.target.closest('[data-toggle-saved]')) {
    showAllSaved = !showAllSaved;
    renderSaved();
    return;
  }
  const removeButton = event.target.closest('[data-remove-index]');
  if (removeButton) {
    const key = SAVED_TABS[savedTab].key;
    const items = readStorage(key);
    items.splice(Number(removeButton.dataset.removeIndex), 1);
    saveStorage(key, items);
    updateSaveButton();
    if (savedTab === 'completed') refreshCompletedViews();
    else renderSaved();
    return;
  }
  const button = event.target.closest('[data-saved-index]');
  if (button) selectSavedItem(Number(button.dataset.savedIndex));
});

[elements.roadMiles, elements.mpg, elements.fuelPrice].forEach(input => input.addEventListener('input', readFuelInputs));
elements.tripDate.addEventListener('change', () => { if (currentPlace) { loadWeather(currentPlace); updateHotelsLink(); } });
elements.startTime.addEventListener('change', () => { if (currentPlace) loadWeather(currentPlace); });
elements.hikeHours.addEventListener('change', () => { if (currentPlace) loadWeather(currentPlace); });

initializeDate();
renderGear(null);
renderFilters();
readFuelInputs();
renderSaved();
refreshPlanViews();
