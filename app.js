const DEFAULT_CENTER = [39.7392, -104.9903];
const STORAGE_KEYS = { favorites: 'wilderpath:favorites', trips: 'wilderpath:trips' };
const map = L.map('map', { zoomControl: false }).setView(DEFAULT_CENTER, 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
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
  weatherSummary: document.querySelector('#weather-summary'),
  weatherTemp: document.querySelector('#weather-temp'),
  weatherIcon: document.querySelector('#weather-icon'),
  gearList: document.querySelector('#gear-list'),
  savedList: document.querySelector('#saved-list'),
  favoriteCount: document.querySelector('#favorite-count'),
  tripCount: document.querySelector('#trip-count'),
  savePlace: document.querySelector('#save-place'),
  logTrip: document.querySelector('#log-trip'),
  toast: document.querySelector('#toast'),
  roadMiles: document.querySelector('#road-miles'),
  mpg: document.querySelector('#mpg'),
  fuelPrice: document.querySelector('#fuel-price'),
  fuelTotal: document.querySelector('#fuel-total'),
  sidebar: document.querySelector('.sidebar'),
};

const layers = L.layerGroup().addTo(map);
let currentPlace = null;
let currentItems = [];
let selectedItemId = null;
let savedTab = 'favorites';
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

function classify(tags = {}) {
  if (tags.route === 'hiking' || tags.highway === 'path' || tags.highway === 'footway' || tags.highway === 'track') return 'trail';
  if (tags.tourism === 'hotel' || tags.tourism === 'motel' || tags.tourism === 'guest_house' || tags.tourism === 'hostel' || tags.tourism === 'camp_site') return 'stay';
  return 'place';
}

function itemName(tags, category) {
  if (tags.name) return tags.name;
  if (category === 'trail') return tags.route === 'hiking' ? 'Hiking route' : `${tags.highway || 'walking'} trail`;
  if (category === 'stay') return 'Local place to stay';
  return tags.tourism === 'attraction' ? 'Local attraction' : 'Recreation spot';
}

function elementId(element) {
  return `${element.type}-${element.id}`;
}

function popupMarkup(item) {
  const safeName = escapeHtml(item.name);
  return `<strong>${safeName}</strong><span>${escapeHtml(item.label)}${item.distance ? ` · ${escapeHtml(item.distance)}` : ''}</span><br /><button type="button" data-focus-item="${escapeHtml(item.id)}">View details</button>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function markerIcon(category) {
  const glyph = category === 'trail' ? '↗' : category === 'stay' ? '⌂' : '✳';
  return L.divIcon({
    className: '',
    html: `<div class="custom-marker ${category === 'stay' ? 'hotel' : category === 'place' ? 'place' : ''}"><span>${glyph}</span></div>`,
    iconSize: [25, 25],
    iconAnchor: [12, 24],
    popupAnchor: [0, -23],
  });
}

function focusItem(id) {
  const item = currentItems.find(candidate => candidate.id === id);
  if (!item) return;
  selectedItemId = id;
  renderResults();
  map.flyTo(item.center, Math.max(map.getZoom(), item.category === 'trail' ? 13 : 14), { duration: 0.55 });
  const layer = layers.getLayers().find(candidate => candidate.featureId === id);
  if (layer?.openPopup) layer.openPopup();
}

function renderResults() {
  const items = currentItems.slice(0, 45);
  elements.resultCount.textContent = `${items.length} ${items.length === 1 ? 'PLACE' : 'PLACES'}`;
  if (!items.length) {
    elements.resultList.innerHTML = '<div class="empty-results"><span class="empty-sun">✳</span><p>No mapped places showed up nearby. Try another search or a wider area.</p></div>';
    return;
  }
  elements.resultList.innerHTML = items.map(item => `
    <button class="result-card${item.id === selectedItemId ? ' selected' : ''}" type="button" data-item-id="${escapeHtml(item.id)}">
      <span class="result-card-top"><strong>${escapeHtml(item.name)}</strong><span class="result-type">${escapeHtml(item.label)}</span></span>
      <span class="result-meta">${escapeHtml(item.distance)} <b>·</b> ${escapeHtml(item.detail)}</span>
    </button>`).join('');
}

function drawItems(items) {
  layers.clearLayers();
  for (const item of items.slice(0, 100)) {
    if (item.category === 'trail' && item.points.length > 1) {
      const line = L.polyline(item.points, { color: '#54774b', weight: 3, opacity: 0.72, lineCap: 'round' }).addTo(layers);
      line.featureId = item.id;
      line.bindPopup(popupMarkup(item));
      continue;
    }
    if (item.category === 'trail' && item.points.length === 1) item.center = item.points[0];
    const marker = L.marker(item.center, { icon: markerIcon(item.category) }).addTo(layers);
    marker.featureId = item.id;
    marker.bindPopup(popupMarkup(item));
    marker.on('click', () => { selectedItemId = item.id; renderResults(); });
  }
}

function detailFor(tags, category, length) {
  if (category === 'trail') {
    const difficulty = tags.sac_scale || tags.trail_visibility || 'Trail';
    const estimated = length > 0 ? `${(length / 1609.344).toFixed(1)} mi · ~${Math.max(1, Math.round(length / 80))} min` : 'Route details vary';
    return `${difficulty.replaceAll('_', ' ')} · ${estimated}`;
  }
  if (category === 'stay') return tags.tourism.replaceAll('_', ' ');
  return (tags.leisure || tags.tourism || tags.amenity || 'recreation').replaceAll('_', ' ');
}

async function loadNearby(place) {
  elements.sidebar.classList.add('loading');
  elements.resultTitle.textContent = `Around ${place.shortName}`;
  currentItems = [];
  selectedItemId = null;
  renderResults();
  const query = `[out:json][timeout:15];(way(around:7000,${place.lat},${place.lon})[highway~"^(path|footway|track)$"][name];relation(around:8000,${place.lat},${place.lon})[route=hiking];nwr(around:7000,${place.lat},${place.lon})[tourism~"^(hotel|motel|guest_house|hostel|camp_site|attraction)$"];nwr(around:6000,${place.lat},${place.lon})[leisure~"^(park|nature_reserve|picnic_table)$"];);out center geom 100;`;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) throw new Error(`Nearby search returned ${response.status}`);
    const data = await response.json();
    const seen = new Set();
    currentItems = (data.elements || []).map(element => {
      const tags = element.tags || {};
      const category = classify(tags);
      const points = getCoords(element);
      if (!points.length) return null;
      const id = elementId(element);
      if (seen.has(id)) return null;
      seen.add(id);
      const center = points.length > 1 ? points[Math.floor(points.length / 2)] : points[0];
      const length = category === 'trail' ? lineLength(points) : 0;
      const distance = distanceBetween([place.lat, place.lon], center);
      return { id, name: itemName(tags, category), category, points, center, length, distanceValue: distance, distance: `${formatDistance(distance)} away`, label: category === 'trail' ? 'TRAIL' : category === 'stay' ? 'STAY' : 'NEARBY', detail: detailFor(tags, category, length) };
    }).filter(Boolean).sort((a, b) => {
      const rank = { trail: 0, place: 1, stay: 2 };
      return rank[a.category] - rank[b.category] || a.distanceValue - b.distanceValue;
    });
    drawItems(currentItems);
    renderResults();
  } catch (error) {
    console.error('Nearby search failed:', error);
    elements.resultList.innerHTML = '<div class="empty-results"><span class="empty-sun">!</span><p>Nearby map data could not load right now. Check your connection and try again.</p></div>';
    elements.resultCount.textContent = 'MAP DATA OFFLINE';
  } finally {
    elements.sidebar.classList.remove('loading');
  }
}

async function loadWeather(place) {
  elements.weatherSummary.textContent = 'Checking forecast…';
  try {
    const params = new URLSearchParams({
      latitude: place.lat,
      longitude: place.lon,
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
      temperature_unit: 'fahrenheit',
      wind_speed_unit: 'mph',
      timezone: 'auto',
      forecast_days: '14',
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error(`Forecast returned ${response.status}`);
    const data = await response.json();
    const date = elements.tripDate.value;
    let index = data.daily.time.indexOf(date);
    if (index < 0) index = 0;
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

function renderGear(weather) {
  const gear = ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit'];
  if (weather) {
    if (weather.low < 45) gear[0] = 'Warm layers';
    else if (weather.high > 82) gear[0] = 'Extra water';
    if (weather.rain >= 35 || [45, 48, 71, 73, 75, 77, 85, 86].includes(weather.code)) gear[1] = 'Rain shell';
    if (weather.wind >= 20) gear[2] = 'Wind layer';
    if ([95, 96, 99].includes(weather.code)) gear[3] = 'Check storm alerts';
    else if (weather.low < 35) gear[3] = 'Gloves & warm hat';
  }
  elements.gearList.innerHTML = gear.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function shortName(displayName) {
  return displayName.split(',')[0].trim() || displayName;
}

async function searchLocation(query) {
  if (!query.trim()) return;
  elements.sidebar.classList.add('loading');
  try {
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'Accept-Language': 'en' } });
    if (!response.ok) throw new Error(`Location search returned ${response.status}`);
    const results = await response.json();
    if (!results.length) {
      showToast('No match found. Try a nearby town or landmark.');
      return;
    }
    const result = results[0];
    const place = { name: result.display_name, shortName: shortName(result.display_name), lat: Number(result.lat), lon: Number(result.lon) };
    setPlace(place);
  } catch (error) {
    console.error('Location search failed:', error);
    showToast('Location search is unavailable. Please try again.');
  } finally {
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
  if (window.innerWidth <= 800) document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

function logTrip() {
  if (!currentPlace) return showToast('Search a destination before logging a trip.');
  const trips = readStorage(STORAGE_KEYS.trips);
  trips.unshift({ ...currentPlace, date: elements.tripDate.value, hours: Number(elements.hikeHours.value), loggedAt: new Date().toISOString() });
  saveStorage(STORAGE_KEYS.trips, trips.slice(0, 50));
  renderSaved();
  showToast('Trip added to your log.');
}

function renderSaved() {
  const favorites = readStorage(STORAGE_KEYS.favorites);
  const trips = readStorage(STORAGE_KEYS.trips);
  elements.favoriteCount.textContent = favorites.length;
  elements.tripCount.textContent = trips.length;
  const items = savedTab === 'favorites' ? favorites : trips;
  if (!items.length) {
    elements.savedList.innerHTML = `<p class="empty-saved">${savedTab === 'favorites' ? 'Your saved places will live here.' : 'Your completed plans will show up here.'}</p>`;
    return;
  }
  elements.savedList.innerHTML = items.slice(0, 10).map((item, index) => {
    const metadata = savedTab === 'favorites' ? 'Favorite destination' : `${item.date || 'Date not set'} · ${item.hours} hr plan`;
    const action = savedTab === 'favorites'
      ? `<button class="remove-saved" type="button" data-remove-index="${index}" aria-label="Remove ${escapeHtml(item.shortName)} from favorites">×</button>`
      : '<span aria-hidden="true">↗</span>';
    return `<div class="saved-item"><button class="saved-item-open" type="button" data-saved-index="${index}"><strong>${escapeHtml(item.shortName)}</strong><span>${escapeHtml(metadata)}</span></button>${action}</div>`;
  }).join('');
}

function selectSavedItem(index) {
  const items = readStorage(savedTab === 'favorites' ? STORAGE_KEYS.favorites : STORAGE_KEYS.trips);
  const item = items[index];
  if (!item) return;
  if (savedTab === 'favorites') {
    setPlace(item);
  } else {
    setPlace(item);
  }
}

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

elements.nearMe.addEventListener('click', () => {
  if (!navigator.geolocation) return showToast('Location services are not available in this browser.');
  elements.nearMe.textContent = 'Finding you…';
  navigator.geolocation.getCurrentPosition(position => {
    elements.nearMe.innerHTML = '<span aria-hidden="true">◎</span> Use my location';
    const { latitude, longitude } = position.coords;
    setPlace({ name: 'Your location', shortName: 'Your location', lat: latitude, lon: longitude });
  }, () => {
    elements.nearMe.innerHTML = '<span aria-hidden="true">◎</span> Use my location';
    showToast('Could not access your location. Check browser permissions.');
  }, { timeout: 10000, maximumAge: 300000 });
});

elements.resultList.addEventListener('click', event => {
  const button = event.target.closest('[data-item-id]');
  if (button) focusItem(button.dataset.itemId);
});

map.on('popupopen', event => {
  const button = event.popup.getElement()?.querySelector('[data-focus-item]');
  button?.addEventListener('click', () => focusItem(button.dataset.focusItem));
});

elements.savePlace.addEventListener('click', toggleFavorite);
elements.logTrip.addEventListener('click', logTrip);
document.querySelectorAll('.saved-tab').forEach(button => button.addEventListener('click', () => {
  savedTab = button.dataset.tab;
  document.querySelectorAll('.saved-tab').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  renderSaved();
}));
elements.savedList.addEventListener('click', event => {
  const removeButton = event.target.closest('[data-remove-index]');
  if (removeButton) {
    const index = Number(removeButton.dataset.removeIndex);
    const favorites = readStorage(STORAGE_KEYS.favorites);
    const [removed] = favorites.splice(index, 1);
    saveStorage(STORAGE_KEYS.favorites, favorites);
    if (currentPlace?.name === removed?.name) updateSaveButton();
    renderSaved();
    return;
  }
  const button = event.target.closest('[data-saved-index]');
  if (button) selectSavedItem(Number(button.dataset.savedIndex));
});
[elements.roadMiles, elements.mpg, elements.fuelPrice].forEach(input => input.addEventListener('input', readFuelInputs));
elements.tripDate.addEventListener('change', () => { if (currentPlace) loadWeather(currentPlace); });
elements.startTime.addEventListener('change', () => { if (currentPlace) loadWeather(currentPlace); });
elements.hikeHours.addEventListener('change', () => { if (currentPlace) loadWeather(currentPlace); });

initializeDate();
readFuelInputs();
renderSaved();