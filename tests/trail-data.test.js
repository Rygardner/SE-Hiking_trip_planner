// Turning Overpass data into trails, the trail cache, and Overpass retries.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, reply, plain } = require('./helpers/app-harness');
const { GOLDEN, overpassData } = require('./helpers/fixtures');

const CACHE_KEY = 'wilderpath:trail-cache:v5';

describe('buildTrails', () => {
  let app;
  let trails;
  beforeEach(() => {
    app = loadApp();
    trails = plain(app.run('buildTrails')(overpassData().elements));
  });
  afterEach(() => app.close());

  it('merges ways and routes with the same trail name', () => {
    assert.deepEqual(trails.map(trail => trail.name).sort(), ['Bear Creek Trail (241)', 'Mesa Loop']);
    const bear = trails.find(trail => trail.name.startsWith('Bear'));
    assert.deepEqual(bear.osm, ['way/1', 'way/2', 'relation/3']);
    assert.equal(bear.lines.length, 2);
    assert.equal(bear.difficulty, 'mountain_hiking');
  });

  it('keeps detail tags from every merged piece', () => {
    const bear = trails.find(trail => trail.name.startsWith('Bear'));
    assert.deepEqual(bear.tags, { sac_scale: 'mountain_hiking', surface: 'dirt', dog: 'leashed', website: 'example.com/bear', operator: 'Jefferson County Open Space' });
  });

  it('drops routes that have no mapped path', () => {
    assert.ok(!trails.some(trail => trail.name === 'Lonely Route'));
  });

  it('attaches a trailhead only when one is close to a trail end', () => {
    const bear = trails.find(trail => trail.name.startsWith('Bear'));
    const mesa = trails.find(trail => trail.name === 'Mesa Loop');
    assert.deepEqual(bear.trailhead, [39.7601, -105.2301]);
    assert.equal(mesa.trailhead, null);
  });

  it('sends directions to the trailhead, else to the trail end nearest the search', () => {
    const start = app.run('trailStart');
    const bear = trails.find(trail => trail.name.startsWith('Bear'));
    const mesa = trails.find(trail => trail.name === 'Mesa Loop');
    assert.deepEqual(plain(start(bear, GOLDEN)), [39.7601, -105.2301]);
    assert.deepEqual(plain(start(mesa, GOLDEN)), [39.8, -105.3]);
  });

  it('ignores elements with no coordinates', () => {
    assert.deepEqual(plain(app.run('buildTrails')([{ type: 'way', id: 9, tags: { name: 'Ghost' } }])), []);
  });
});

describe('trail cache', () => {
  let app;
  afterEach(() => app.close());

  it('saves and reads back trails', () => {
    app = loadApp();
    app.run('setCachedTrails')('39.76,-105.22', [{ id: 'way-1' }]);
    assert.deepEqual(plain(app.run('getCachedTrails')('39.76,-105.22')), [{ id: 'way-1' }]);
    assert.equal(app.run('getCachedTrails')('0.00,0.00'), null);
  });

  it('ignores entries older than a week', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    app = loadApp({ storage: { [CACHE_KEY]: { old: { savedAt: eightDaysAgo, trails: [{ id: 'x' }] } } } });
    assert.equal(app.run('getCachedTrails')('old'), null);
  });

  it('keeps only the 25 newest places', () => {
    const cache = {};
    for (let index = 0; index < 25; index += 1) cache[`place-${index}`] = { savedAt: Date.now() - (index + 1) * 1000, trails: [] };
    app = loadApp({ storage: { [CACHE_KEY]: cache } });
    app.run('setCachedTrails')('newest', []);
    const saved = app.storage(CACHE_KEY);
    assert.equal(Object.keys(saved).length, 25);
    assert.ok(saved.newest);
    assert.ok(!saved['place-24'], 'oldest entry should be dropped');
  });

  it('survives corrupt cache data', () => {
    app = loadApp({ storage: { [CACHE_KEY]: '{not json' } });
    assert.equal(app.run('getCachedTrails')('39.76,-105.22'), null);
  });

  it('clears caches from older app versions on load', () => {
    app = loadApp({ storage: { 'wilderpath:trail-cache:v4': {}, 'wilderpath:trail-cache': {} } });
    assert.equal(app.window.localStorage.getItem('wilderpath:trail-cache:v4'), null);
    assert.equal(app.window.localStorage.getItem('wilderpath:trail-cache'), null);
  });
});

describe('fetchOverpass', () => {
  let app;
  afterEach(() => app.close());

  async function rejection(promise) {
    try { await promise; } catch (error) { return error; }
    assert.fail('expected the call to fail');
  }

  it('posts the query to the first endpoint', async () => {
    app = loadApp({ routes: { overpass: () => ({ elements: [] }) } });
    await app.run('fetchOverpass')('my query');
    const [call] = app.calls('overpass');
    assert.match(call.url, /overpass\.kumi\.systems/);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.body, 'data=my%20query');
  });

  it('falls back to the second endpoint when the first fails', async () => {
    app = loadApp({ routes: { overpass: (_, count) => (count === 1 ? reply(502) : { elements: [{ id: 1 }] }) } });
    const data = await app.run('fetchOverpass')('q');
    assert.equal(data.elements.length, 1);
    assert.deepEqual(app.calls('overpass').map(call => new URL(call.url).host), ['overpass.kumi.systems', 'overpass-api.de']);
  });

  it('retries every endpoint once more after a full round fails', async () => {
    app = loadApp({ routes: { overpass: (_, count) => (count <= 2 ? reply(502) : { elements: [] }) } });
    await app.run('fetchOverpass')('q');
    assert.equal(app.calls('overpass').length, 3);
  });

  it('gives up after two rounds and reports the last error', async () => {
    app = loadApp({ routes: { overpass: () => reply(504) } });
    const error = await rejection(app.run('fetchOverpass')('q'));
    assert.match(error.message, /Trail search returned 504/);
    assert.equal(app.calls('overpass').length, 4);
  });

  it('treats network errors like failed responses', async () => {
    app = loadApp({ routes: { overpass: () => { throw new TypeError('Failed to fetch'); } } });
    const error = await rejection(app.run('fetchOverpass')('q'));
    assert.match(error.message, /Failed to fetch/);
    assert.equal(app.calls('overpass').length, 4);
  });
});
