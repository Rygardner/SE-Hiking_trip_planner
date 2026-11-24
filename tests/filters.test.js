// Filtering trails by difficulty, length and estimated time, and labelling trails with missing data.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app-harness');
const { geocodeResults } = require('./helpers/fixtures');

const MILE = 1 / 69.05; // ~1 mile of latitude, in degrees.
const way = (id, name, miles, tags = {}) => ({
  type: 'way', id, tags: { name, highway: 'path', ...tags },
  geometry: [{ lat: 39.76, lon: -105.22 + id * 0.01 }, { lat: 39.76 + miles * MILE, lon: -105.22 + id * 0.01 }],
});
// Easy and short, moderate and long, unrated, and a trail whose mapped length is zero.
const trailData = () => ({
  elements: [
    way(1, 'Easy Stroll', 1, { sac_scale: 'hiking' }),
    way(2, 'Ridge Climb', 6, { sac_scale: 'mountain_hiking' }),
    way(3, 'Mystery Path', 3),
    way(4, 'Stub Trail', 0, { sac_scale: 'hiking' }),
  ],
});

const cards = app => app.$$('#result-list .result-card');
const names = app => cards(app).map(card => card.querySelector('strong').textContent).sort();
const card = (app, name) => cards(app).find(item => item.querySelector('strong').textContent === name);
const chip = (app, id) => app.$(`[data-difficulty="${id}"]`);
const choose = (app, selector, value) => {
  app.$(selector).value = value;
  app.$(selector).dispatchEvent(new app.window.Event('change', { bubbles: true }));
};

async function loadTrails(storage) {
  const app = loadApp({ storage, routes: { geocode: () => geocodeResults(), overpass: () => trailData() } });
  await app.search('Golden, CO');
  await app.waitFor(() => cards(app).length, { message: 'trail cards' });
  return app;
}

describe('trail filters', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('labels unrated trails and unknown lengths differently from easy trails', async () => {
    app = await loadTrails();
    assert.equal(card(app, 'Easy Stroll').querySelector('.difficulty-badge').className, 'difficulty-badge easy');
    const mystery = card(app, 'Mystery Path').querySelector('.difficulty-badge');
    assert.equal(mystery.className, 'difficulty-badge unrated');
    assert.match(mystery.textContent, /Not rated/);
    assert.match(card(app, 'Stub Trail').textContent, /Length & time unknown/);
    assert.match(card(app, 'Easy Stroll').textContent, /1\.0 mi · ~30 min/);
  });

  it('shows unrated and unknown values in the details panel', async () => {
    app = await loadTrails();
    card(app, 'Stub Trail').click();
    const stats = app.$$('.sheet-stats div').map(div => div.querySelector('strong').textContent);
    assert.deepEqual(stats, ['Unknown', 'Unknown', 'Easy']);
    card(app, 'Mystery Path').click();
    assert.match(app.$('.sheet-stats').textContent, /Not rated/);
    assert.match(app.$('.sheet-note').textContent, /doesn’t mean it’s easy/);
  });

  it('filters by difficulty and keeps "Not rated" separate from Easy', async () => {
    app = await loadTrails();
    chip(app, 'easy').click();
    assert.deepEqual(names(app), ['Easy Stroll', 'Stub Trail']);
    assert.equal(chip(app, 'easy').getAttribute('aria-pressed'), 'true');
    assert.equal(app.$('#result-count').textContent, '2 OF 4 TRAILS');

    chip(app, 'easy').click();
    chip(app, 'unrated').click();
    assert.deepEqual(names(app), ['Mystery Path']);

    chip(app, 'moderate').click();
    assert.deepEqual(names(app), ['Mystery Path', 'Ridge Climb']);
  });

  it('filters by length, with unknown length as its own choice', async () => {
    app = await loadTrails();
    choose(app, '#filter-length', 'short');
    assert.deepEqual(names(app), ['Easy Stroll']);
    choose(app, '#filter-length', 'long');
    assert.deepEqual(names(app), ['Ridge Climb']);
    choose(app, '#filter-length', 'unknown');
    assert.deepEqual(names(app), ['Stub Trail']);
  });

  it('filters by estimated time and hides filtered trails from the map', async () => {
    app = await loadTrails();
    choose(app, '#filter-time', 'quick'); // 1 mi at 2 mph = 30 min
    assert.deepEqual(names(app), ['Easy Stroll']);
    const markers = app.L.groups[0].layers.filter(layer => layer.kind === 'marker');
    assert.equal(markers.length, 1);
    choose(app, '#filter-time', 'unknown');
    assert.deepEqual(names(app), ['Stub Trail']);
  });

  it('combines filters, shows an empty state, and clears', async () => {
    app = await loadTrails();
    chip(app, 'easy').click();
    choose(app, '#filter-length', 'long');
    assert.equal(cards(app).length, 0);
    assert.match(app.$('#result-list').textContent, /No trails here match these filters/);
    assert.ok(!app.$('#filter-clear').hidden);

    app.$('#result-list [data-clear-filters]').click();
    assert.equal(cards(app).length, 4);
    assert.equal(app.$('#result-count').textContent, '4 TRAILS');
    assert.ok(app.$('#filter-clear').hidden);
    assert.equal(app.$('#filter-length').value, 'any');
  });

  it('lets you rate an unrated trail, and the rating drives labels and filters', async () => {
    app = await loadTrails();
    chip(app, 'easy').click();
    assert.deepEqual(names(app), ['Easy Stroll', 'Stub Trail']);
    chip(app, 'easy').click();

    card(app, 'Mystery Path').click();
    assert.equal(app.$('#sheet-rating').value, '');
    choose(app, '#sheet-rating', 'hiking');

    assert.deepEqual(app.storage('wilderpath:difficulty-ratings'), { 'way-3': 'hiking' });
    const badge = card(app, 'Mystery Path').querySelector('.difficulty-badge');
    assert.equal(badge.className, 'difficulty-badge easy user-rated');
    assert.match(app.$('.sheet-stats').textContent, /Easy.*YOUR RATING/);
    assert.match(app.$('.sheet-note').textContent, /Map data: not rated/);
    chip(app, 'easy').click();
    assert.deepEqual(names(app), ['Easy Stroll', 'Mystery Path', 'Stub Trail']);
  });

  it('overrides a mapped rating and can go back to it', async () => {
    app = await loadTrails();
    card(app, 'Ridge Climb').click();
    assert.match(app.$('#sheet-rating option[value=""]').textContent, /Use map rating · Moderate/);
    choose(app, '#sheet-rating', 'alpine_hiking');
    assert.match(card(app, 'Ridge Climb').textContent, /Difficult/);
    assert.match(app.$('.sheet-note').textContent, /Map data: Moderate/);

    choose(app, '#sheet-rating', '');
    assert.deepEqual(app.storage('wilderpath:difficulty-ratings'), {});
    assert.equal(card(app, 'Ridge Climb').querySelector('.difficulty-badge').className, 'difficulty-badge moderate');
  });

  it('shows your rating in saved trail summaries', () => {
    app = loadApp({ storage: { 'wilderpath:difficulty-ratings': { 'way-9': 'mountain_hiking', 'way-8': 'not_a_scale' } } });
    const summary = app.run('trailSummary');
    assert.equal(summary({ id: 'way-9', difficulty: '', length: 0 }), 'Length & time unknown · Moderate (your rating)');
    assert.equal(summary({ id: 'way-8', difficulty: '', length: 0 }), 'Length & time unknown · Not rated');
  });

  it('remembers filters between visits and ignores bad saved values', async () => {
    app = await loadTrails({ 'wilderpath:trail-filters': { difficulty: ['unrated', 'bogus'], length: 'nope', time: 'short' } });
    assert.equal(chip(app, 'unrated').getAttribute('aria-pressed'), 'true');
    assert.equal(app.$('#filter-length').value, 'any');
    assert.equal(app.$('#filter-time').value, 'short');
    assert.deepEqual(names(app), ['Mystery Path']); // 3 mi ≈ 1 hr 30 min
    chip(app, 'unrated').click();
    assert.deepEqual(app.storage('wilderpath:trail-filters'), { difficulty: [], length: 'any', time: 'short' });
  });
});
