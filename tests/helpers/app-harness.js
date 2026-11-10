// Loads the real index.html + app.js into jsdom with Leaflet and every network call mocked.
// Tests drive the app through the DOM or call its functions with app.run('name').
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
// Drop the <script> tags: Leaflet comes from a CDN and app.js is run by hand below.
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const APP_SOURCE = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Which mock handler answers which URL.
const ROUTES = {
  overpass: /overpass/,
  geocode: /nominatim\.openstreetmap\.org/,
  forecast: /open-meteo\.com\/v1\/forecast/,
  elevation: /open-meteo\.com\/v1\/elevation/,
  route: /openrouteservice\.org/,
};

// Minimal stand-in for the parts of Leaflet that app.js uses.
function createFakeLeaflet() {
  const groups = [];
  const flyTo = [];
  class Layer {
    constructor(kind, latlngs, options = {}) {
      Object.assign(this, { kind, latlngs, options, handlers: {} });
    }
    addTo(target) { target.add?.(this); return this; }
    on(event, handler) { this.handlers[event] = handler; return this; }
    fire(event) { this.handlers[event]?.(); }
  }
  // highlightSelection tells markers from lines by checking for setIcon, so keep them separate.
  class Marker extends Layer {
    setIcon(icon) { this.options.icon = icon; }
    setZIndexOffset(offset) { this.options.zIndexOffset = offset; }
  }
  class Path extends Layer {
    setStyle(style) { this.style = style; }
    bringToFront() {}
  }
  const map = { setView: () => map, flyTo: (center, zoom) => flyTo.push({ center, zoom }), getZoom: () => 8, add() {} };
  return {
    groups,
    flyTo,
    map: () => map,
    tileLayer: () => new Layer('tile'),
    control: { zoom: () => ({ addTo() {} }) },
    divIcon: options => ({ ...options }),
    marker: (latlng, options) => new Marker('marker', latlng, options),
    polyline: (latlngs, options) => new Path('polyline', latlngs, options),
    circleMarker: (latlng, options) => new Path('circleMarker', latlng, options),
    layerGroup() {
      const group = { layers: [], add(layer) { group.layers.push(layer); }, addTo: () => group, clearLayers() { group.layers.length = 0; }, eachLayer(fn) { group.layers.forEach(fn); } };
      groups.push(group);
      return group;
    },
  };
}

// A handler result is JSON for a 200 reply, or reply(status, body) for anything else. Throwing simulates a network error.
function reply(status, body = {}) {
  return { __reply: true, status, body };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadApp({ storage = {}, config = { orsApiKey: '' }, routes = {} } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  // Uncaught errors in app code (e.g. inside event handlers) show up here.
  virtualConsole.on('jsdomError', error => errors.push(error));

  const dom = new JSDOM(HTML, { url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));

  // Browser APIs jsdom lacks.
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  window.Element.prototype.scrollIntoView = () => {};
  window.structuredClone ||= structuredClone;
  window.confirm = () => true;
  // Run timers right away so retry waits and toasts don't slow the tests down.
  const realSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);

  window.L = createFakeLeaflet();
  window.WILDERPATH_CONFIG = config;

  const handlers = { ...routes };
  const fetchCalls = [];
  window.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes('/__trail-timing')) return new Response(null, { status: 204 });
    const name = Object.keys(ROUTES).find(key => ROUTES[key].test(url));
    const call = { name, url, options };
    fetchCalls.push(call);
    const handler = handlers[name];
    if (!handler) return new Response('{}', { status: 404 });
    const result = await handler(call, fetchCalls.filter(other => other.name === name).length);
    const { status, body } = result?.__reply ? result : { status: 200, body: result };
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

  const context = dom.getInternalVMContext();
  vm.runInContext(APP_SOURCE, context, { filename: 'app.js' });

  const app = {
    window,
    document: window.document,
    L: window.L,
    routes: handlers,
    fetchCalls,
    errors,
    // Evaluates code inside the app's global scope, so top-level const/let are reachable.
    run: code => vm.runInContext(code, context),
    $: selector => window.document.querySelector(selector),
    $$: selector => [...window.document.querySelectorAll(selector)],
    calls: name => fetchCalls.filter(call => call.name === name),
    storage: key => JSON.parse(window.localStorage.getItem(key)),
    async waitFor(check, { timeout = 2000, message = 'condition' } = {}) {
      const start = Date.now();
      for (;;) {
        const value = check();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${message}`);
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    },
    // Lets pending promises and zero-delay timers finish.
    async settle(rounds = 20) {
      for (let index = 0; index < rounds; index += 1) await new Promise(resolve => setTimeout(resolve, 1));
    },
    async search(query) {
      app.$('#location-input').value = query;
      app.$('#search-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    },
    close: () => window.close(),
  };
  return app;
}

// Copies a value out of the app's realm so assert.deepStrictEqual can compare it.
const plain = value => JSON.parse(JSON.stringify(value));

module.exports = { loadApp, reply, deferred, plain };
