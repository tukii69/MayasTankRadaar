const els = {
  keyBtn: document.querySelector('#keyBtn'),
  keyDialog: document.querySelector('#keyDialog'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  saveKeyBtn: document.querySelector('#saveKeyBtn'),
  clearKeyBtn: document.querySelector('#clearKeyBtn'),
  statusText: document.querySelector('#statusText'),
  lastUpdated: document.querySelector('#lastUpdated'),
  positionInfo: document.querySelector('#positionInfo'),
  fuelChips: document.querySelector('#fuelChips'),
  radiusChips: document.querySelector('#radiusChips'),
  openOnly: document.querySelector('#openOnly'),
  searchBtn: document.querySelector('#searchBtn'),
  princessBtn: document.querySelector('#princessBtn'),
  mapOpenBtn: document.querySelector('#mapOpenBtn'),
  mapCloseBtn: document.querySelector('#mapCloseBtn'),
  mapSection: document.querySelector('#mapSection'),
  bestPrice: document.querySelector('#bestPrice'),
  stationCount: document.querySelector('#stationCount'),
  fuelLabel: document.querySelector('#fuelLabel'),
  results: document.querySelector('#results'),
  stationDialog: document.querySelector('#stationDialog'),
  stationDetails: document.querySelector('#stationDetails'),
  closeStationDialog: document.querySelector('#closeStationDialog'),
};

const API_BASE = 'https://creativecommons.tankerkoenig.de/json/list.php';
const DETAIL_API_BASE = 'https://creativecommons.tankerkoenig.de/json/detail.php';
const KEY_STORAGE = 'mayas_tankradar_api_key';
const LAST_POSITION_STORAGE = 'mayas_tankradar_last_position';
const FUEL_STORAGE = 'mayas_tankradar_fuel';
const RADIUS_STORAGE = 'mayas_tankradar_radius';
const FUEL_LABELS = { diesel: 'Diesel', e10: 'Super E10', e5: 'Super E5' };

let fuelType = localStorage.getItem(FUEL_STORAGE) || 'diesel';
let radiusKm = localStorage.getItem(RADIUS_STORAGE) || '5';
let lastPosition = null;
let rawStations = [];
let currentStations = [];
let currentByKey = new Map();
let markerByKey = new Map();
let map = null;
let markersLayer = null;
let lastRequestAt = 0;
let selectedStationKey = null;

init();

function init() {
  setActiveChip(els.fuelChips, 'fuel', fuelType);
  setActiveChip(els.radiusChips, 'radius', radiusKm);
  els.fuelLabel.textContent = FUEL_LABELS[fuelType];

  const savedKey = localStorage.getItem(KEY_STORAGE) || '';
  els.apiKeyInput.value = savedKey;
  updateKeyButton(savedKey);

  const savedPos = localStorage.getItem(LAST_POSITION_STORAGE);
  if (savedPos) {
    try {
      const parsed = JSON.parse(savedPos);
      if (parsed && parsed.lat && parsed.lng && !parsed.demo) {
        lastPosition = parsed;
        updatePositionInfo(lastPosition);
      } else {
        localStorage.removeItem(LAST_POSITION_STORAGE);
      }
    } catch (_) {
      localStorage.removeItem(LAST_POSITION_STORAGE);
    }
  }

  els.fuelChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-fuel]');
    if (!chip) return;
    fuelType = chip.dataset.fuel;
    localStorage.setItem(FUEL_STORAGE, fuelType);
    setActiveChip(els.fuelChips, 'fuel', fuelType);
    els.fuelLabel.textContent = FUEL_LABELS[fuelType];
    if (lastPosition && getApiKey()) fetchPrices(lastPosition, { force: true });
  });

  els.radiusChips.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-radius]');
    if (!chip) return;
    radiusKm = chip.dataset.radius;
    localStorage.setItem(RADIUS_STORAGE, radiusKm);
    setActiveChip(els.radiusChips, 'radius', radiusKm);
    if (lastPosition && getApiKey()) fetchPrices(lastPosition, { force: true });
  });

  els.openOnly.addEventListener('change', () => renderStations(rawStations));
  els.searchBtn.addEventListener('click', useCurrentLocation);
  els.princessBtn.addEventListener('click', openCheapestRoute);
  els.mapOpenBtn.addEventListener('click', openMapSection);
  els.mapCloseBtn.addEventListener('click', () => els.mapSection.classList.add('hidden'));

  els.results.addEventListener('click', (event) => {
    const detailButton = event.target.closest('[data-open-details]');
    const card = event.target.closest('[data-station-key]');
    if (!detailButton && !card) return;
    if (event.target.closest('a')) return;
    const key = detailButton?.dataset.openDetails || card?.dataset.stationKey;
    if (key) openStationDetails(key);
  });

  els.keyBtn.addEventListener('click', () => {
    els.apiKeyInput.value = localStorage.getItem(KEY_STORAGE) || '';
    els.keyDialog.showModal();
  });

  els.saveKeyBtn.addEventListener('click', () => {
    const key = els.apiKeyInput.value.trim();
    if (key) localStorage.setItem(KEY_STORAGE, key);
    updateKeyButton(key);
    setStatus('Key gespeichert. Preise suchen drücken.');
    if (lastPosition) fetchPrices(lastPosition, { force: true });
  });

  els.clearKeyBtn.addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE);
    els.apiKeyInput.value = '';
    updateKeyButton('');
    rawStations = [];
    currentStations = [];
    currentByKey = new Map();
    renderEmpty('API-Key gelöscht. Bitte wieder Key eintragen.');
    setStatus('Key gelöscht. Ohne Key keine echten Preise.');
  });

  els.closeStationDialog.addEventListener('click', () => els.stationDialog.close());
  els.stationDialog.addEventListener('click', (event) => {
    const focusBtn = event.target.closest('[data-focus-map]');
    if (!focusBtn) return;
    els.stationDialog.close();
    openMapSection();
    window.setTimeout(() => focusStationOnMap(focusBtn.dataset.focusMap), 120);
  });

  if (savedKey && lastPosition) {
    setStatus('Gespeicherter Standort gefunden. Preise werden geladen …');
    window.setTimeout(() => fetchPrices(lastPosition, { force: true }), 250);
  } else if (savedKey) {
    setStatus('Key ist gespeichert. Preise suchen drücken.');
  } else {
    renderEmpty('Noch keine Preise. Key eintragen und Preise suchen.');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js?v=7').then((registration) => registration.update()).catch(() => {});
  }
}

function setActiveChip(container, type, value) {
  container.querySelectorAll(`[data-${type}]`).forEach((chip) => {
    chip.classList.toggle('active', chip.dataset[type] === value);
  });
}

function setStatus(text) {
  els.statusText.textContent = text;
}

function updateKeyButton(key) {
  els.keyBtn.textContent = key ? 'Key ✓' : 'Key';
  els.keyBtn.style.color = key ? 'var(--green)' : 'var(--muted)';
}

function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

function useCurrentLocation() {
  const key = getApiKey();
  if (!key) {
    setStatus('Key fehlt. Oben auf „Key“ drücken und eintragen.');
    els.keyDialog.showModal();
    return;
  }

  if (!navigator.geolocation) {
    setStatus('Dein Browser unterstützt keine Standorterkennung.');
    return;
  }

  setStatus('Standort wird abgefragt …');
  els.searchBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy || 0),
      };
      localStorage.setItem(LAST_POSITION_STORAGE, JSON.stringify(lastPosition));
      updatePositionInfo(lastPosition);
      fetchPrices(lastPosition, { force: true });
    },
    (err) => {
      els.searchBtn.disabled = false;
      const messages = {
        1: 'Standort verweigert. In Safari/iPhone Standort erlauben.',
        2: 'Standort konnte nicht bestimmt werden.',
        3: 'Standort-Abfrage hat zu lange gedauert.',
      };
      setStatus(messages[err.code] || 'Standortfehler. Bitte erneut versuchen.');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

async function fetchPrices(pos, options = {}) {
  const now = Date.now();
  if (!options.force && now - lastRequestAt < 60000) {
    setStatus('Bitte kurz warten. Maximal ca. 1 Anfrage pro Minute.');
    return;
  }

  const key = getApiKey();
  if (!key) {
    setStatus('Key fehlt. Ohne Key keine echten Preise.');
    return;
  }

  lastRequestAt = now;
  els.searchBtn.disabled = true;
  els.princessBtn.disabled = true;
  setStatus('Echte Preise werden geladen …');

  const params = new URLSearchParams({
    lat: String(pos.lat),
    lng: String(pos.lng),
    rad: radiusKm,
    sort: 'price',
    type: fuelType,
    apikey: key,
  });

  try {
    const response = await fetch(`${API_BASE}?${params.toString()}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || 'API-Fehler');

    rawStations = data.stations || [];
    renderStations(rawStations);
    els.lastUpdated.textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    setStatus('Echte Preise geladen. PrinzessinPreis springt zur günstigsten Tankstelle.');
  } catch (err) {
    console.error(err);
    renderEmpty('Keine Daten geladen. Key, Standort oder Internet prüfen.');
    setStatus(`Fehler: ${err.message}. Prüfe Key, Internet und Standort.`);
  } finally {
    els.searchBtn.disabled = false;
    els.princessBtn.disabled = currentStations.length === 0;
  }
}

function updatePositionInfo(pos) {
  els.positionInfo.textContent = `±${pos?.accuracy || '?'} m`;
}

function renderStations(stations) {
  rawStations = Array.isArray(stations) ? stations : [];

  const list = rawStations
    .filter((station) => {
      const price = getStationPrice(station);
      const hasPrice = typeof price === 'number' && Number.isFinite(price);
      const openAllowed = !els.openOnly.checked || station.isOpen !== false;
      return hasPrice && openAllowed;
    })
    .sort((a, b) => getStationPrice(a) - getStationPrice(b) || Number(a.dist || 0) - Number(b.dist || 0))
    .map((station, index) => prepareStation(station, index));

  currentStations = list;
  currentByKey = new Map(list.map((station) => [station.__key, station]));

  els.stationCount.textContent = String(list.length);
  els.bestPrice.textContent = list.length ? formatPrice(getStationPrice(list[0])) : '—';
  els.princessBtn.disabled = list.length === 0;

  if (!list.length) {
    renderEmpty('Keine passenden Tankstellen gefunden.');
    renderMap([]);
    return;
  }

  els.results.innerHTML = list.map(stationCardTemplate).join('');
  renderMap(list);
}

function renderEmpty(message) {
  els.stationCount.textContent = '0';
  els.bestPrice.textContent = '—';
  els.princessBtn.disabled = true;
  els.results.innerHTML = `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function prepareStation(station, index) {
  const fallbackKey = `${station.lat || 'x'}-${station.lng || 'y'}-${station.name || 'station'}-${index}`;
  return { ...station, __key: String(station.__key || station.id || station.uuid || fallbackKey), __rank: index + 1 };
}

function stationCardTemplate(station, index) {
  const title = station.brand || station.name || 'Tankstelle';
  const address = getShortAddress(station);
  const price = getStationPrice(station);
  const openText = station.isOpen !== false ? 'Geöffnet' : 'Zu';
  const openClass = station.isOpen !== false ? 'open' : 'closed';
  const rankText = index === 0 ? 'Best' : `#${index + 1}`;
  const routeUrl = getGoogleRouteUrl(station);

  return `
    <article class="station-card ${index === 0 ? 'best' : ''}" data-station-key="${escapeHtml(station.__key)}">
      <div class="station-topline">
        <h3 class="station-title">${escapeHtml(title)}</h3>
        <strong class="card-price">${formatPrice(price)}</strong>
      </div>
      <p class="station-address">${escapeHtml(address || station.name || 'Adresse öffnen')}</p>
      <div class="info-row">
        <span class="pill">${rankText}</span>
        <span class="pill">${formatDistance(station.dist)}</span>
        <span class="pill ${openClass}">${openText}</span>
      </div>
      <div class="card-actions">
        <a class="route-btn" href="${routeUrl}" target="_blank" rel="noopener">Route</a>
        <button class="details-btn" type="button" data-open-details="${escapeHtml(station.__key)}">Details</button>
      </div>
    </article>`;
}

function openCheapestRoute() {
  if (!currentStations.length) {
    setStatus('Erst Preise laden, dann funktioniert PrinzessinPreis.');
    return;
  }

  const cheapest = currentStations[0];
  const selector = `[data-station-key="${cssEscape(cheapest.__key)}"]`;
  const card = document.querySelector(selector);

  if (!card) {
    setStatus('Günstigste Tankstelle gefunden, aber Karte ist noch nicht sichtbar. Bitte kurz neu laden.');
    return;
  }

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('princess-focus');
  window.setTimeout(() => card.classList.add('princess-focus'), 80);
  window.setTimeout(() => card.classList.remove('princess-focus'), 2400);

  setStatus(`PrinzessinPreis: ${cheapest.brand || cheapest.name || 'günstigste Tankstelle'} markiert.`);
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

async function openStationDetails(key) {
  const station = currentByKey.get(String(key));
  if (!station) return;

  selectedStationKey = String(key);
  renderStationDetails(station, { loading: Boolean(station.id) });
  els.stationDialog.showModal();

  if (!station.id) return;

  try {
    const detailStation = await fetchStationDetail(station);
    if (!detailStation || selectedStationKey !== String(key)) return;
    const merged = { ...station, ...detailStation, __key: station.__key, price: station.price, dist: station.dist };
    currentByKey.set(station.__key, merged);
    renderStationDetails(merged);
  } catch (err) {
    console.error(err);
    if (selectedStationKey === String(key)) renderStationDetails(station, { error: 'Detaildaten konnten nicht nachgeladen werden.' });
  }
}

async function fetchStationDetail(station) {
  const key = getApiKey();
  if (!key) return null;

  const params = new URLSearchParams({ id: station.id, apikey: key });
  const response = await fetch(`${DETAIL_API_BASE}?${params.toString()}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || 'Detail-API-Fehler');
  return data.station || null;
}

function renderStationDetails(station, state = {}) {
  const title = station.brand || station.name || 'Tankstelle';
  const price = getStationPrice(station);
  const address = getAddress(station);
  const openText = station.isOpen !== false ? 'Geöffnet' : 'Geschlossen';
  const googleUrl = getGoogleRouteUrl(station);
  const appleUrl = getAppleRouteUrl(station);
  const coords = station.lat && station.lng ? `${Number(station.lat).toFixed(6)}, ${Number(station.lng).toFixed(6)}` : '—';

  els.stationDetails.innerHTML = `
    <h2 class="detail-title">${escapeHtml(title)}</h2>
    <p class="detail-address">${escapeHtml(address || station.name || '')}</p>
    <div class="detail-price">${formatPrice(price)}</div>
    <div class="info-row">
      <span class="pill ${station.isOpen !== false ? 'open' : 'closed'}">${openText}</span>
      <span class="pill">${FUEL_LABELS[fuelType]}</span>
      <span class="pill">${formatDistance(station.dist)}</span>
    </div>

    <div class="station-actions">
      <a href="${googleUrl}" target="_blank" rel="noopener">Route</a>
      <a href="${appleUrl}" target="_blank" rel="noopener">Apple</a>
      <button type="button" data-focus-map="${escapeHtml(station.__key)}">Karte</button>
    </div>

    ${state.loading ? '<p class="loading-line">Detaildaten werden geladen …</p>' : ''}
    ${state.error ? `<p class="loading-line">${escapeHtml(state.error)}</p>` : ''}

    <div class="detail-grid">
      ${detailItem('Name', station.name || title)}
      ${detailItem('Marke', station.brand || '—')}
      ${detailItem('Adresse', address || '—')}
      ${detailItem('Entfernung', formatDistance(station.dist))}
      ${detailItem('Preis', formatPrice(price))}
      ${detailItem('Spritart', FUEL_LABELS[fuelType])}
      ${detailItem('Status', openText)}
      ${detailItem('ID', station.id || '—')}
      ${detailItem('Koordinaten', coords)}
      ${detailItem('Öffnungszeiten', formatOpeningTimes(station.openingTimes, station.wholeDay), true)}
    </div>`;
}

function detailItem(label, value, allowHtml = false) {
  const safeValue = allowHtml ? String(value ?? '') : escapeHtml(value);
  return `<div class="detail-item"><strong>${escapeHtml(label)}</strong><span>${safeValue}</span></div>`;
}

function formatOpeningTimes(openingTimes, wholeDay) {
  if (wholeDay) return '24 Stunden geöffnet';
  if (!Array.isArray(openingTimes) || !openingTimes.length) return 'Keine Öffnungszeiten vorhanden';
  return `<ul class="opening-list">${openingTimes.map((entry) => `<li>${escapeHtml(entry.text || `${entry.start || entry.from || ''} – ${entry.end || entry.to || ''}`)}</li>`).join('')}</ul>`;
}

function openMapSection() {
  els.mapSection.classList.remove('hidden');
  renderMap(currentStations);
  window.setTimeout(() => {
    map?.invalidateSize();
    els.mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function ensureMap() {
  if (typeof L === 'undefined') {
    document.querySelector('.map-card').innerHTML = '<div class="empty-state"><p>Karte konnte nicht geladen werden. Internet prüfen.</p></div>';
    return false;
  }

  if (!map) {
    const center = lastPosition ? [lastPosition.lat, lastPosition.lng] : [51.1657, 10.4515];
    map = L.map('map', { zoomControl: true }).setView(center, lastPosition ? 13 : 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  return true;
}

function renderMap(stations = currentStations) {
  if (els.mapSection.classList.contains('hidden') && !map) return;
  if (!ensureMap()) return;

  markersLayer.clearLayers();
  markerByKey = new Map();
  const bounds = [];

  if (lastPosition?.lat && lastPosition?.lng) {
    const userLatLng = [Number(lastPosition.lat), Number(lastPosition.lng)];
    L.circleMarker(userLatLng, { radius: 8, weight: 3, fillOpacity: 0.85 }).addTo(markersLayer).bindPopup('Dein Standort');
    bounds.push(userLatLng);
  }

  stations.forEach((station) => {
    if (!station.lat || !station.lng) return;
    const latLng = [Number(station.lat), Number(station.lng)];
    const marker = L.marker(latLng).addTo(markersLayer);
    marker.bindPopup(`
      <strong>${escapeHtml(station.brand || station.name || 'Tankstelle')}</strong>
      <div class="map-popup-price">${formatPrice(getStationPrice(station))}</div>
      <div>${escapeHtml(formatDistance(station.dist))}</div>
    `);
    marker.on('click', () => openStationDetails(station.__key));
    markerByKey.set(station.__key, marker);
    bounds.push(latLng);
  });

  if (bounds.length >= 2) map.fitBounds(bounds, { padding: [34, 34] });
  else if (bounds.length === 1) map.setView(bounds[0], 14);
  window.setTimeout(() => map.invalidateSize(), 70);
}

function focusStationOnMap(key) {
  const station = currentByKey.get(String(key));
  if (!station || !ensureMap()) return;
  if (station.lat && station.lng) map.setView([Number(station.lat), Number(station.lng)], 16);
  markerByKey.get(String(key))?.openPopup();
}

function getStationPrice(station) {
  if (typeof station.price === 'number') return station.price;
  const fuelValue = station[fuelType];
  return typeof fuelValue === 'number' ? fuelValue : null;
}

function getAddress(station) {
  return `${station.street || ''} ${station.houseNumber || ''}, ${station.postCode || ''} ${station.place || ''}`.replace(/\s+/g, ' ').replace(' ,', ',').trim();
}

function getShortAddress(station) {
  const street = `${station.street || ''} ${station.houseNumber || ''}`.replace(/\s+/g, ' ').trim();
  return street || station.name || getAddress(station);
}

function getGoogleRouteUrl(station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`;
}

function getAppleRouteUrl(station) {
  return `http://maps.apple.com/?daddr=${station.lat},${station.lng}&dirflg=d`;
}

function formatPrice(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Number(value).toFixed(3).replace('.', ',')}€`;
}

function formatDistance(value) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) return '— km';
  return `${distance.toFixed(1)} km`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
