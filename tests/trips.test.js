// Trail details panel, favorites, and the trip planner.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, reply } = require('./helpers/app-harness');
const { GOLDEN, overpassData, geocodeResults, elevationReply } = require('./helpers/fixtures');

const PLAN_KEY = 'wilderpath:plan-draft';
const FAVORITES_KEY = 'wilderpath:favorites';
const TRIPS_KEY = 'wilderpath:trips';

// Loads the app and searches Golden so trail cards are on screen.
async function appWithTrails(options = {}) {
  const app = loadApp({ ...options, routes: { geocode: () => geocodeResults(), overpass: () => overpassData(), elevation: elevationReply, ...options.routes } });
  await app.search('Golden');
  await app.waitFor(() => app.$$('#result-list .result-card').length, { message: 'trail cards' });
  return app;
}

const click = (app, selector) => app.$(selector).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));

describe('trail details panel', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('opens when a trail card is clicked', async () => {
    app = await appWithTrails();
    click(app, '.result-card');
    const sheet = app.$('#trail-sheet');
    assert.equal(sheet.hidden, false);
    assert.equal(app.$('#trail-sheet-title').textContent, 'Bear Creek Trail (241)');
    assert.match(sheet.textContent, /Moderate/);
    assert.match(sheet.textContent, /Hiking boots recommended/);
    assert.ok(app.$('.result-card').classList.contains('selected'));
  });

  it('shows trail facts and safe links', async () => {
    app = await appWithTrails();
    click(app, '.result-card');
    const facts = Object.fromEntries(app.$$('.sheet-facts div').map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
    assert.equal(facts.Surface, 'Dirt');
    assert.equal(facts.Dogs, 'On leash');
    assert.equal(facts['Managed by'], 'Jefferson County Open Space');
    const links = app.$$('.sheet-links a').map(link => link.href);
    assert.ok(links.includes('https://www.google.com/maps/dir/?api=1&destination=39.7601,-105.2301'), 'directions go to the trailhead');
    assert.ok(links.includes('https://www.openstreetmap.org/way/1'));
    assert.ok(links.includes('https://example.com/bear'));
  });

  it('loads elevation once and shows the climb', async () => {
    app = await appWithTrails();
    click(app, '.result-card');
    await app.waitFor(() => app.$('.sheet-elevation').textContent.includes('climbing'), { message: 'elevation' });
    assert.match(app.$('.sheet-elevation').textContent, /ft – .* ft · ~.* ft of climbing/);
    click(app, '[data-sheet-action="close"]');
    click(app, '.result-card');
    assert.equal(app.calls('elevation').length, 1, 'elevation is cached per trail');
  });

  it('says when elevation is unavailable', async () => {
    app = await appWithTrails({ routes: { elevation: () => reply(500) } });
    click(app, '.result-card');
    await app.waitFor(() => app.$('.sheet-elevation').textContent.includes('unavailable'));
  });

  it('closes with the close button and with Escape', async () => {
    app = await appWithTrails();
    click(app, '.result-card');
    click(app, '[data-sheet-action="close"]');
    assert.equal(app.$('#trail-sheet').hidden, true);
    click(app, '.result-card');
    app.document.dispatchEvent(new app.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(app.$('#trail-sheet').hidden, true);
  });

  it('opens from a click on the trail’s map marker', async () => {
    app = await appWithTrails();
    const marker = app.L.groups[0].layers.find(layer => layer.kind === 'marker' && layer.options.title === 'Mesa Loop');
    marker.fire('click');
    assert.equal(app.$('#trail-sheet-title').textContent, 'Mesa Loop');
  });
});

describe('favorites', () => {
  let app;
  afterEach(() => app.close());

  it('asks for a destination before saving', () => {
    app = loadApp();
    click(app, '#save-place');
    assert.equal(app.$('#toast').textContent, 'Search a destination first.');
  });

  it('saves and removes the current destination', () => {
    app = loadApp();
    app.run('setPlace')({ ...GOLDEN });
    click(app, '#save-place');
    assert.equal(app.storage(FAVORITES_KEY).length, 1);
    assert.equal(app.storage(FAVORITES_KEY)[0].name, GOLDEN.name);
    assert.equal(app.$('#save-place').textContent, '★');
    assert.equal(app.$('#favorite-count').textContent, '1');
    assert.match(app.$('#saved-list').textContent, /Golden/);

    click(app, '#save-place');
    assert.equal(app.storage(FAVORITES_KEY).length, 0);
    assert.equal(app.$('#save-place').textContent, '☆');
  });

  it('opens a saved favorite and removes one with ×', () => {
    app = loadApp({ storage: { [FAVORITES_KEY]: [{ ...GOLDEN, savedAt: '2026-01-01' }] } });
    assert.equal(app.$('#favorite-count').textContent, '1');
    click(app, '.saved-item-open');
    assert.equal(app.$('#results-title').textContent, 'Around Golden');
    click(app, '.remove-saved');
    assert.equal(app.storage(FAVORITES_KEY).length, 0);
    assert.match(app.$('#saved-list').textContent, /saved places will live here/);
  });

  it('shows only the first 10 until “Show all” is clicked', () => {
    const favorites = Array.from({ length: 12 }, (_, index) => ({ ...GOLDEN, name: `Place ${index}`, shortName: `Place ${index}` }));
    app = loadApp({ storage: { [FAVORITES_KEY]: favorites } });
    assert.equal(app.$$('.saved-item').length, 10);
    click(app, '[data-toggle-saved]');
    assert.equal(app.$$('.saved-item').length, 12);
  });

  it('survives corrupt saved data', () => {
    app = loadApp({ storage: { [FAVORITES_KEY]: 'oops{' } });
    assert.equal(app.$('#favorite-count').textContent, '0');
  });
});

describe('trip planner', () => {
  let app;
  beforeEach(async () => { app = await appWithTrails(); });
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('adds a trail from the details panel to a new day', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    assert.equal(app.$('#toast').textContent, 'Added to Day 1.');
    assert.equal(app.$('#plan-badge').hidden, false);
    assert.equal(app.$('#plan-badge').textContent, '1');
    const plan = app.storage(PLAN_KEY);
    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].destination.shortName, 'Golden');
    assert.equal(plan.days[0].trails[0].name, 'Bear Creek Trail (241)');
    assert.equal(plan.days[0].trails[0].lines, undefined, 'map geometry is not stored in the plan');
    assert.match(app.$('#trail-sheet').textContent, /On Day 1 of your trip/);
  });

  it('sends directions to the trail start when opened from the planner', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    assert.deepEqual(app.storage(PLAN_KEY).days[0].trails[0].start, [39.7601, -105.2301]);
    click(app, '[data-sheet-action="close"]');
    click(app, '#plan-trip');
    click(app, '[data-plan-trail="0:0"]');
    const directions = app.$$('.sheet-links a').find(link => link.textContent.startsWith('Directions'));
    assert.equal(directions.href, 'https://www.google.com/maps/dir/?api=1&destination=39.7601,-105.2301');
  });

  it('removes a trail from the trip', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    click(app, '[data-sheet-action="remove"]');
    assert.equal(app.$('#plan-badge').hidden, true);
    assert.equal(app.storage(PLAN_KEY).days[0].trails.length, 0);
  });

  it('suggests the day whose destination is nearby', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    app.$$('.result-card')[1].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    assert.equal(app.$('#sheet-day').value, '0', 'Mesa Loop is near Day 1’s destination');
  });

  it('totals miles and hiking time in the planner', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    click(app, '#plan-trip');
    assert.equal(app.$('#planner').open, true);
    const stats = Object.fromEntries(app.$$('.plan-stat').map(stat => [stat.querySelector('span').textContent, stat.querySelector('strong').textContent]));
    assert.equal(stats.DAY, '1');
    assert.equal(stats.TRAIL, '1');
    assert.equal(stats['TRAIL MI'], '0.9');
    assert.match(app.$('#plan-days').textContent, /Bear Creek Trail \(241\)/);
  });

  it('adds and removes days', () => {
    click(app, '#plan-trip');
    click(app, '#plan-add-day');
    assert.equal(app.storage(PLAN_KEY).days.length, 2);
    click(app, '[data-remove-day="1"]');
    assert.equal(app.storage(PLAN_KEY).days.length, 1);
    assert.equal(app.$('[data-remove-day="0"]').disabled, true, 'the last day cannot be removed');
  });

  it('estimates road miles between different destinations', () => {
    const plan = { id: 'p', name: '', startDate: '', days: [
      { destination: { ...GOLDEN }, trails: [] },
      { destination: { name: 'Boulder', shortName: 'Boulder', lat: 40.015, lon: -105.2705 }, trails: [] },
    ] };
    app.run('setPlan')(plan);
    const legs = app.run('roadLegs')(app.run('plan'));
    assert.equal(legs.length, 1);
    assert.equal(legs[0].from, 'Golden');
    // ~29 km straight line × 1.3 road factor ≈ 23 mi.
    assert.ok(legs[0].miles > 20 && legs[0].miles < 26, `got ${legs[0].miles}`);
  });

  it('refuses to save an empty plan', () => {
    app.run('setPlan')(app.run('newPlan')({ withDay: false }));
    app.run('plan').days.push({ destination: null, trails: [] });
    app.run('savePlanToLog')();
    assert.equal(app.$('#toast').textContent, 'Add a destination or trail before saving.');
    assert.equal(app.window.localStorage.getItem(TRIPS_KEY), null);
  });

  it('saves the plan to the trip log and updates it on re-save', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    click(app, '#plan-trip');
    click(app, '#plan-save');
    let trips = app.storage(TRIPS_KEY);
    assert.equal(trips.length, 1);
    assert.equal(trips[0].name, 'Golden trip');
    assert.equal(app.$('#plan-status').textContent, 'Saved to your trip log.');
    click(app, '#plan-save');
    trips = app.storage(TRIPS_KEY);
    assert.equal(trips.length, 1, 're-saving replaces the entry');
    assert.equal(app.$('#plan-status').textContent, 'Trip log updated.');
    assert.equal(app.$('#trip-count').textContent, '1');
  });

  it('restores a saved draft on reload', () => {
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    const draft = app.window.localStorage.getItem(PLAN_KEY);
    app.close();
    app = loadApp({ storage: { [PLAN_KEY]: draft } });
    assert.equal(app.$('#plan-badge').textContent, '1');
    assert.equal(app.L.groups[2].layers.length, 1, 'day stop drawn on the map');
  });
});
