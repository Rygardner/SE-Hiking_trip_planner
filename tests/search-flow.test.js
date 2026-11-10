// Searching a place end to end: geocoding, the trail list and its loading state, weather and driving route.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, reply, deferred, plain } = require('./helpers/app-harness');
const { GOLDEN, BOULDER, overpassData, geocodeResults, forecastFor } = require('./helpers/fixtures');

const cards = app => app.$$('#result-list .result-card');
const isLoading = app => app.$('.sidebar').classList.contains('loading');
const hasSpinner = app => Boolean(app.$('#result-list .spinner'));

describe('location search', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('finds the place, then lists nearby trails closest first', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => overpassData() } });
    await app.search('Golden, CO');
    await app.waitFor(() => cards(app).length, { message: 'trail cards' });

    assert.equal(app.$('#results-title').textContent, 'Around Golden');
    assert.equal(app.$('#location-input').value, 'Golden');
    assert.equal(app.$('#map-place').textContent, GOLDEN.name.toUpperCase());
    assert.equal(app.$('#result-count').textContent, '2 TRAILS');
    assert.deepEqual(cards(app).map(card => card.querySelector('strong').textContent), ['Bear Creek Trail (241)', 'Mesa Loop']);
    assert.match(cards(app)[0].textContent, /Moderate · 0\.9 mi/);
    assert.ok(!isLoading(app));

    // One marker per trail, plus a line for each.
    const trailLayer = app.L.groups[0];
    assert.equal(trailLayer.layers.filter(layer => layer.kind === 'marker').length, 2);
    assert.equal(trailLayer.layers.filter(layer => layer.kind === 'polyline').length, 2);
    assert.deepEqual(plain(app.L.flyTo.at(-1).center), [GOLDEN.lat, GOLDEN.lon]);
  });

  it('sends the search text to the geocoder', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => overpassData() } });
    await app.search('Golden, CO');
    await app.waitFor(() => cards(app).length);
    const url = new URL(app.calls('geocode')[0].url);
    assert.equal(url.searchParams.get('q'), 'Golden, CO');
  });

  it('ignores a blank search', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults() } });
    await app.search('   ');
    await app.settle();
    assert.equal(app.calls('geocode').length, 0);
  });

  it('tells the user when nothing matches', async () => {
    app = loadApp({ routes: { geocode: () => [] } });
    await app.search('Nowhereville');
    await app.waitFor(() => app.$('#toast').textContent);
    assert.equal(app.$('#toast').textContent, 'No match found. Try a nearby town or landmark.');
    assert.ok(!isLoading(app));
    assert.equal(app.calls('overpass').length, 0);
  });

  it('tells the user when the geocoder is down', async () => {
    app = loadApp({ routes: { geocode: () => reply(503) } });
    await app.search('Golden');
    await app.waitFor(() => app.$('#toast').textContent);
    assert.equal(app.$('#toast').textContent, 'Location search is unavailable. Please try again.');
    assert.ok(!isLoading(app));
  });

  it('escapes trail names from map data', async () => {
    const data = overpassData();
    data.elements[3].tags.name = '<img src=x onerror="alert(1)">';
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => data } });
    await app.search('Golden');
    await app.waitFor(() => cards(app).length === 2);
    assert.equal(app.$('#result-list img'), null);
    assert.ok(cards(app).some(card => card.textContent.includes('<img src=x')));
  });

  it('says so when no trails are nearby', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => ({ elements: [] }) } });
    await app.search('Golden');
    await app.waitFor(() => app.$('#result-list').textContent.includes('No mapped hiking trails'), { message: 'empty message' });
    assert.equal(app.$('#result-count').textContent, '0 TRAILS');
    assert.ok(!isLoading(app));
  });
});

describe('trail list loading state', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('shows a spinner until the trail API answers', async () => {
    const gate = deferred();
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => gate.promise } });
    await app.search('Golden');
    await app.waitFor(() => hasSpinner(app), { message: 'spinner' });
    assert.equal(app.$('#result-count').textContent, 'SEARCHING…');
    assert.match(app.$('#result-list').textContent, /Looking for trails nearby/);
    assert.equal(app.$('#result-list [role="status"]') !== null, true);
    assert.ok(isLoading(app), 'sidebar stays in loading state while trails load');

    gate.resolve(overpassData());
    await app.waitFor(() => cards(app).length, { message: 'trail cards' });
    assert.ok(!hasSpinner(app));
    assert.ok(!isLoading(app));
  });

  it('replaces the spinner with an error after every retry fails', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => reply(502) } });
    await app.search('Golden');
    await app.waitFor(() => app.$('#result-count').textContent === 'MAP DATA OFFLINE', { message: 'offline message' });
    assert.ok(!hasSpinner(app));
    assert.match(app.$('#result-list').textContent, /Trail data could not load/);
    assert.ok(!isLoading(app));
    assert.equal(app.calls('overpass').length, 4);
  });

  it('uses cached trails without calling the API again', async () => {
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => overpassData() } });
    await app.search('Golden');
    await app.waitFor(() => cards(app).length);
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => cards(app).length);
    assert.equal(app.calls('overpass').length, 1);
  });

  it('does not let an older failed search overwrite a newer one', async () => {
    const goldenGate = deferred();
    const boulderGate = deferred();
    app = loadApp({
      routes: {
        overpass: async ({ options }) => {
          if (options.body.includes('39.76')) { await goldenGate.promise; return reply(502); }
          await boulderGate.promise;
          return overpassData();
        },
      },
    });
    const setPlace = app.run('setPlace');
    setPlace({ ...GOLDEN });
    setPlace({ ...BOULDER });
    await app.waitFor(() => app.calls('overpass').length === 2);

    // Golden fails all four attempts while Boulder is still loading.
    goldenGate.resolve();
    await app.waitFor(() => app.calls('overpass').length === 5, { message: 'Golden retries' });
    await app.settle();
    assert.ok(hasSpinner(app), 'Boulder spinner should still show');
    assert.equal(app.$('#result-count').textContent, 'SEARCHING…');
    assert.equal(app.$('#results-title').textContent, 'Around Boulder');
    assert.ok(isLoading(app), 'Boulder is still loading');

    boulderGate.resolve();
    await app.waitFor(() => cards(app).length, { message: 'Boulder trails' });
    assert.ok(!isLoading(app));
  });

  it('does not let an older successful search overwrite a newer one', async () => {
    const goldenGate = deferred();
    app = loadApp({
      routes: {
        overpass: async ({ options }) => {
          if (options.body.includes('39.76')) { await goldenGate.promise; return overpassData(); }
          return { elements: [] };
        },
      },
    });
    const setPlace = app.run('setPlace');
    setPlace({ ...GOLDEN });
    setPlace({ ...BOULDER });
    await app.waitFor(() => app.$('#result-count').textContent === '0 TRAILS');
    goldenGate.resolve();
    await app.settle();
    assert.equal(cards(app).length, 0, 'Golden trails should not appear for Boulder');
    assert.equal(app.$('#results-title').textContent, 'Around Boulder');
  });
});

describe('weather', () => {
  let app;
  afterEach(() => app.close());

  it('shows the forecast and gear for the trip date', async () => {
    app = loadApp({ routes: { forecast: () => forecastFor(app.$('#trip-date').value, { code: 63, high: 58, low: 41, rain: 70 }) } });
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#weather-summary').textContent.includes('Rain'));
    assert.equal(app.$('#weather-summary').textContent, 'Rain possible · 41°–58°F');
    assert.equal(app.$('#weather-temp').textContent, '58°');
    assert.match(app.$('#daylight-note').textContent, /Daylight .* estimated finish/);
    const gear = app.$$('#gear-list li').map(li => li.textContent);
    assert.deepEqual(gear.slice(0, 2), ['Warm layers', 'Rain shell']);
    const url = new URL(app.calls('forecast')[0].url);
    assert.equal(url.searchParams.get('latitude'), String(GOLDEN.lat));
    assert.equal(url.searchParams.get('temperature_unit'), 'fahrenheit');
  });

  it('warns when the hike would end after sunset', async () => {
    app = loadApp({ routes: { forecast: () => forecastFor(app.$('#trip-date').value) } });
    app.$('#start-time').value = '17:00';
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#daylight-note').textContent.includes('sunset'));
    assert.match(app.$('#daylight-note').textContent, /Finishes after sunset/);
  });

  it('does not show another day’s weather for dates past the forecast', async () => {
    app = loadApp({ routes: { forecast: () => forecastFor('2000-01-01') } });
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#weather-summary').textContent !== 'Checking forecast…');
    assert.equal(app.$('#weather-summary').textContent, 'Weather not available for this date');
    assert.equal(app.$('#weather-temp').textContent, '--°');
  });

  it('handles the forecast service being down', async () => {
    app = loadApp({ routes: { forecast: () => reply(500) } });
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#weather-summary').textContent === 'Forecast unavailable');
    assert.equal(app.$('#weather-temp').textContent, '--°');
  });
});

describe('driving route', () => {
  let app;
  afterEach(() => app.close());

  const routeReply = () => ({
    features: [{
      geometry: { coordinates: [[-104.99, 39.74], [-105.22, 39.75]] },
      properties: { summary: { distance: 1609.344 * 20, duration: 30 * 60 } },
    }],
  });

  it('asks for an API key when none is configured', () => {
    app = loadApp();
    app.run('setPlace')({ ...GOLDEN });
    assert.match(app.$('#route-note').textContent, /Add an OpenRouteService key/);
    assert.equal(app.calls('route').length, 0);
  });

  it('asks for the user’s location when it is unknown', () => {
    app = loadApp({ config: { orsApiKey: 'test-key' } });
    app.run('setPlace')({ ...GOLDEN });
    assert.match(app.$('#route-note').textContent, /Go to my location/);
  });

  it('draws the route and fills in round-trip road miles', async () => {
    app = loadApp({ config: { orsApiKey: 'test-key' }, routes: { route: routeReply } });
    app.run('userPosition = { lat: 39.7392, lon: -104.9903 }');
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#route-note').textContent.startsWith('Drive'));
    assert.equal(app.$('#route-note').textContent, 'Drive 30 min · 20 mi each way. Road miles set to the round trip.');
    assert.equal(app.$('#road-miles').value, '40');
    assert.equal(app.$('#fuel-total').textContent, '$5.00'); // 40 mi / 28 mpg × $3.50
    const url = new URL(app.calls('route')[0].url);
    assert.equal(url.searchParams.get('start'), '-104.9903,39.7392');
    assert.equal(url.searchParams.get('end'), `${GOLDEN.lon},${GOLDEN.lat}`);
    assert.equal(app.L.groups[1].layers.length, 1, 'route line drawn');
  });

  it('falls back to manual miles when routing fails', async () => {
    app = loadApp({ config: { orsApiKey: 'test-key' }, routes: { route: () => reply(403) } });
    app.run('userPosition = { lat: 39.7392, lon: -104.9903 }');
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#route-note').textContent.includes('unavailable'));
    assert.equal(app.$('#route-note').textContent, 'Driving route unavailable. Enter road miles by hand.');
  });
});
