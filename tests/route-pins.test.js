// Route pins: click the map for each point (start, stops, destination), saved with the trip,
// with Google Maps directions through all of them.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/app-harness');

const PLAN_KEY = 'wilderpath:plan-draft';
const TRIPS_KEY = 'wilderpath:trips';
const A = [39.75551, -105.22111];
const B = [39.7, -105.3];
const C = [39.68, -105.4];

const click = (app, selector) => app.$(selector).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
const markers = app => app.run('routeLayer').layers.filter(layer => layer.kind === 'marker');
const lines = app => app.run('routeLayer').layers.filter(layer => layer.kind === 'polyline');
const rows = app => app.$$('#route-list li').map(row => [row.querySelector('.route-label').textContent, row.querySelector('.route-value').textContent]);
const directions = app => app.$('#route-directions');

function addPoints(app, ...points) {
  click(app, '#route-toggle');
  points.forEach(point => app.L.theMap.click(point));
  click(app, '#route-toggle'); // Done
}

describe('route pins', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('ignores map clicks until adding is turned on', () => {
    app = loadApp();
    app.L.theMap.click(A);
    assert.equal(markers(app).length, 0);
    assert.equal(directions(app).getAttribute('aria-disabled'), 'true');
    assert.equal(directions(app).hasAttribute('href'), false);
  });

  it('adds a pin for every click while adding is on, labelled start, stops and destination', () => {
    app = loadApp();
    click(app, '#route-toggle');
    assert.equal(app.$('#route-toggle').textContent, 'Done');
    assert.ok(app.$('#map').classList.contains('placing-pin'));
    app.L.theMap.click(A);
    assert.deepEqual(rows(app), [['Start', '39.7555, -105.2211']]);
    assert.equal(directions(app).getAttribute('aria-disabled'), 'true', 'one point is not a route');
    app.L.theMap.click(B);
    app.L.theMap.click(C);
    assert.deepEqual(rows(app).map(row => row[0]), ['Start', 'Stop 1', 'Destination']);
    const labels = markers(app).map(marker => marker.options.icon.html.match(/<b>(\d+)<\/b><span>([^<]+)/).slice(1));
    assert.deepEqual(labels, [['1', 'Start'], ['2', 'Stop 1'], ['3', 'Destination']]);
    assert.ok(markers(app).every(marker => marker.options.draggable));
    assert.equal(lines(app).length, 1, 'a line joins the pins in order');
    click(app, '#route-toggle');
    assert.equal(app.$('#map').classList.contains('placing-pin'), false);
    app.L.theMap.click([39, -105]);
    assert.equal(markers(app).length, 3, 'clicks after Done do nothing');
  });

  it('links Google Maps directions through every stop', () => {
    app = loadApp();
    addPoints(app, A, C);
    assert.equal(directions(app).href, 'https://www.google.com/maps/dir/?api=1&origin=39.75551,-105.22111&destination=39.68,-105.4&travelmode=driving');
    addPoints(app, [39.6, -105.5]);
    assert.equal(directions(app).href, 'https://www.google.com/maps/dir/?api=1&origin=39.75551,-105.22111&destination=39.6,-105.5&waypoints=39.68,-105.4&travelmode=driving');
    addPoints(app, B);
    assert.match(directions(app).href, /waypoints=39\.68,-105\.4%7C39\.6,-105\.5&/);
  });

  it('names pins from a reverse lookup', async () => {
    const names = ({ url }) => {
      if (!url.includes('/reverse')) return [];
      return { name: Number(new URL(url).searchParams.get('lat')) === A[0] ? 'Golden Trailhead' : 'Evergreen Lake' };
    };
    app = loadApp({ routes: { geocode: names } });
    addPoints(app, A, C);
    await app.waitFor(() => rows(app)[1][1] === 'Evergreen Lake', { message: 'pin names' });
    assert.equal(rows(app)[0][1], 'Golden Trailhead');
    assert.equal(app.storage(PLAN_KEY).route.points[0].label, 'Golden Trailhead');
  });

  it('moves a pin when it is dragged', () => {
    app = loadApp();
    addPoints(app, A, C);
    const marker = markers(app)[1];
    marker.setLatLng([39.5, -105.6]);
    marker.fire('dragend');
    assert.deepEqual(plain(app.run('plan').route.points[1]), { lat: 39.5, lon: -105.6, label: '' });
    assert.equal(rows(app)[1][1], '39.5000, -105.6000');
  });

  it('removes one pin, renumbering the rest, or clears them all', () => {
    app = loadApp();
    addPoints(app, A, B, C);
    click(app, '[data-route-remove="1"]');
    assert.deepEqual(rows(app), [['Start', '39.7555, -105.2211'], ['Destination', '39.6800, -105.4000']]);
    assert.equal(markers(app).length, 2);
    click(app, '#route-clear-all');
    assert.equal(markers(app).length, 0);
    assert.equal(lines(app).length, 0);
    assert.deepEqual(plain(app.run('plan').route), { points: [] });
  });

  it('stops adding with Escape', () => {
    app = loadApp();
    click(app, '#route-toggle');
    app.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape' }));
    app.L.theMap.click(A);
    assert.equal(markers(app).length, 0);
  });

  it('stops at the most points a Google Maps link can take', () => {
    app = loadApp();
    click(app, '#route-toggle');
    for (let index = 0; index < 12; index += 1) app.L.theMap.click([39 + index / 100, -105]);
    assert.equal(markers(app).length, 10);
    assert.equal(app.$('#route-toggle').disabled, true);
    assert.match(app.$('#route-hint').textContent, /most a Google Maps link can take/);
  });

  it('saves the route with the trip and brings it back when the trip is reopened', () => {
    app = loadApp();
    addPoints(app, A, B, C);
    app.run('savePlanToLog()');
    assert.deepEqual(app.storage(TRIPS_KEY)[0].route.points.map(point => [point.lat, point.lon]), [A, B, C]);

    click(app, '#plan-new');
    assert.equal(markers(app).length, 0, 'a new plan starts without pins');

    click(app, '[data-tab="trips"]');
    click(app, '[data-saved-index="0"]');
    assert.equal(markers(app).length, 3);
    assert.match(app.$('#plan-route').textContent, /1 · 39\.7555, -105\.2211 → 2 · 39\.7000, -105\.3000 → 3 · 39\.6800, -105\.4000/);
    assert.equal(app.$('#plan-route a').href, directions(app).href);
  });

  it('loads trips saved without pins, or with the older start/destination pins', () => {
    const old = { id: 'old', name: 'Old', startDate: '', days: [{ destination: null, trails: [] }], savedAt: '2026-01-01' };
    const pinned = { ...old, id: 'pinned', route: { start: { lat: 39.1, lon: -105.1, label: 'Here' }, end: { lat: 39.2, lon: -105.2, label: 'There' } } };
    app = loadApp({ storage: { [TRIPS_KEY]: [old, pinned] } });
    click(app, '[data-tab="trips"]');
    click(app, '[data-saved-index="0"]');
    assert.deepEqual(plain(app.run('plan').route), { points: [] });
    assert.equal(app.$('#plan-route').hidden, true);
    click(app, '[data-saved-index="1"]');
    assert.deepEqual(rows(app), [['Start', 'Here'], ['Destination', 'There']]);
  });
});
