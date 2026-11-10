// Pure helper functions: formatting, distances, difficulty, weather, links.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/app-harness');

describe('helper functions', () => {
  let app;
  let fn;
  before(() => {
    app = loadApp();
    fn = name => app.run(name);
  });
  after(() => app.close());

  it('formats distances in miles', () => {
    assert.equal(fn('formatDistance')(1609.344), '1.0 mi');
    assert.equal(fn('formatDistance')(1609.344 * 12.4), '12 mi');
    assert.equal(fn('formatDistance')(0), 'Nearby');
    assert.equal(fn('formatDistance')(NaN), 'Nearby');
  });

  it('formats durations in hours and minutes', () => {
    assert.equal(fn('formatDuration')(45 * 60), '45 min');
    assert.equal(fn('formatDuration')(90 * 60), '1 hr 30 min');
    assert.equal(fn('formatDuration')(5), '1 min');
  });

  it('measures distances between points', () => {
    // Denver to Boulder is about 39 km in a straight line.
    const meters = fn('distanceBetween')([39.7392, -104.9903], [40.015, -105.2705]);
    assert.ok(meters > 37000 && meters < 41000, `got ${meters}`);
    assert.equal(fn('distanceBetween')([40, -105], [40, -105]), 0);
    const leg = fn('distanceBetween')([40, -105], [40.01, -105]);
    assert.ok(Math.abs(fn('lineLength')([[40, -105], [40.01, -105], [40.02, -105]]) - leg * 2) < 1);
  });

  it('escapes HTML', () => {
    assert.equal(fn('escapeHtml')(`<a href="x">Tom's & co</a>`), '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;');
  });

  it('merges trail-number name variants into one key', () => {
    const key = fn('trailNameKey');
    assert.equal(key('Bear Creek Trail (241)'), 'bear creek');
    assert.equal(key('Bear Creek Trail #241'), 'bear creek');
    assert.equal(key('Bear  Creek trl'), 'bear creek');
    assert.notEqual(key('Bear Creek'), key('Bear Peak'));
  });

  it('describes difficulty and estimates hiking time', () => {
    assert.equal(fn('difficultyInfo')('mountain_hiking').label, 'Moderate');
    assert.equal(fn('difficultyInfo')(undefined).label, 'Not rated');
    // Book time: 2 mph plus 30 min per 1,000 ft.
    assert.equal(Math.round(fn('hikeMinutes')(1609.344 * 4)), 120);
    assert.equal(Math.round(fn('hikeMinutes')(1609.344 * 4, 2000)), 180);
    assert.equal(fn('detailFor')('hiking', 1609.344 * 4), 'Easy · 4.0 mi · ~2 hr 0 min');
    assert.equal(fn('detailFor')('', 0), 'Trail · Route details vary');
  });

  it('only allows http(s) website links', () => {
    assert.equal(fn('safeUrl')('example.com/trail'), 'https://example.com/trail');
    assert.equal(fn('safeUrl')('http://example.com'), 'http://example.com/');
    assert.equal(fn('safeUrl')('javascript:alert(1)'), null);
    assert.equal(fn('safeUrl')('not a url'), null);
  });

  it('maps weather codes to labels', () => {
    assert.equal(fn('describeWeather')(0).label, 'Clear skies');
    assert.equal(fn('describeWeather')(63).label, 'Rain possible');
    assert.equal(fn('describeWeather')(75).label, 'Snow likely');
    assert.equal(fn('describeWeather')(95).label, 'Storm risk');
    assert.equal(fn('describeWeather')(12345).label, 'Mixed conditions');
  });

  it('suggests gear for the weather', () => {
    const gear = () => app.$$('#gear-list li').map(li => li.textContent);
    fn('renderGear')(null);
    assert.deepEqual(gear(), ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit']);
    fn('renderGear')({ code: 95, high: 50, low: 30, rain: 80, wind: 25 });
    assert.deepEqual(gear(), ['Warm layers', 'Rain shell', 'Wind layer', 'Check storm alerts']);
    fn('renderGear')({ code: 0, high: 90, low: 60, rain: 0, wind: 0 });
    assert.equal(gear()[0], 'Extra water');
    fn('renderGear')({ code: 0, high: 40, low: 20, rain: 0, wind: 0 });
    assert.equal(gear()[3], 'Gloves & warm hat');
  });

  it('prefers the town over a same-named county', () => {
    const results = [
      { addresstype: 'county', display_name: 'Ouray County, Colorado, United States' },
      { addresstype: 'town', display_name: 'Ouray, Ouray County, Colorado, United States' },
    ];
    assert.equal(fn('preferTown')(results, 'Ouray, Colorado').addresstype, 'town');
    assert.equal(fn('preferTown')(results, 'Ouray County').addresstype, 'county');
  });

  it('snaps cache keys to a ~1 km grid', () => {
    assert.equal(fn('trailCacheKey')({ lat: 39.7555, lon: -105.2211 }), '39.76,-105.22');
    assert.equal(fn('trailCacheKey')({ lat: 39.7561, lon: -105.2189 }), '39.76,-105.22');
  });

  it('builds the trail query with radius and timeout', () => {
    const query = fn('trailQuery')('39.76', '-105.22');
    assert.match(query, /\[timeout:45\]/);
    assert.match(query, /around:8000,39\.76,-105\.22/);
    assert.match(query, /nwr\(around:8000,39\.76,-105\.22\)\[highway=trailhead\];out center/);
  });

  it('calculates the fuel cost', () => {
    app.$('#road-miles').value = '140';
    app.$('#mpg').value = '28';
    app.$('#fuel-price').value = '3.50';
    fn('readFuelInputs')();
    assert.equal(app.$('#fuel-total').textContent, '$17.50');
    app.$('#mpg').value = '0'; // falls back to 1 instead of dividing by zero
    fn('readFuelInputs')();
    assert.equal(app.$('#fuel-total').textContent, '$490.00');
  });

  it('splits a trail into its open ends', () => {
    const trail = { lines: [[[1, 1], [2, 2]], [[2, 2], [3, 3]]] };
    assert.deepEqual(plain(fn('trailEnds')(trail)), [[1, 1], [3, 3]]);
  });
});
