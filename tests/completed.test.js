// Marking trails as completed and seeing it on the map, cards, details panel, planner and saved lists.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/app-harness');
const { overpassData, geocodeResults, elevationReply } = require('./helpers/fixtures');

const COMPLETED_KEY = 'wilderpath:completed';

async function appWithTrails(options = {}) {
  const app = loadApp({ ...options, routes: { geocode: () => geocodeResults(), overpass: () => overpassData(), elevation: elevationReply } });
  await app.search('Golden');
  await app.waitFor(() => app.$$('#result-list .result-card').length, { message: 'trail cards' });
  return app;
}

const click = (app, selector) => app.$(selector).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
const toggle = (app, selector, checked = true) => {
  const box = app.$(selector);
  box.checked = checked;
  box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
};
const trailLayers = (app, id) => app.L.groups[0].layers.filter(layer => layer.featureId === id);

describe('completed trails', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('marks a trail completed from the details panel and shows it everywhere', async () => {
    app = await appWithTrails();
    click(app, '.result-card');
    const id = app.$('.result-card').dataset.itemId;
    toggle(app, '#sheet-completed');

    const stored = app.storage(COMPLETED_KEY);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, id);
    assert.ok(stored[0].completedAt);
    assert.ok(app.$('#sheet-completed').checked, 'panel checkbox stays checked');
    assert.ok(app.$('.result-card').classList.contains('completed'));
    assert.ok(app.$(`[data-complete-id="${id}"]`).checked, 'card checkbox is checked');
    assert.match(app.$('#result-count').textContent, /1 DONE/);
    const marker = trailLayers(app, id).find(layer => layer.setIcon);
    assert.match(marker.options.icon.html, /completed/);
    assert.equal(app.$('#completed-count').textContent, '1');
  });

  it('can be checked from the trail card and unchecked again', async () => {
    app = await appWithTrails();
    const id = app.$('.result-card').dataset.itemId;
    toggle(app, `[data-complete-id="${id}"]`);
    assert.equal(app.storage(COMPLETED_KEY).length, 1);
    const line = trailLayers(app, id).find(layer => layer.kind === 'polyline');
    assert.equal(line.style.color, '#2f7d9a');
    toggle(app, `[data-complete-id="${id}"]`, false);
    assert.equal(app.storage(COMPLETED_KEY).length, 0);
    assert.notEqual(line.style.color, '#2f7d9a');
    assert.ok(!app.$('.result-card').classList.contains('completed'));
  });

  it('lists completed trails in the saved tab, and removing unmarks them', async () => {
    app = await appWithTrails();
    const id = app.$('.result-card').dataset.itemId;
    toggle(app, `[data-complete-id="${id}"]`);
    click(app, '.saved-tab[data-tab="completed"]');
    assert.match(app.$('#saved-list').textContent, /Bear Creek Trail/);
    assert.match(app.$('#saved-list').textContent, /Completed/);
    click(app, '#saved-list [data-remove-index="0"]');
    assert.equal(app.storage(COMPLETED_KEY).length, 0);
    assert.ok(!app.$(`[data-complete-id="${id}"]`).checked);
  });

  it('shows completion in favorites, the planner and the trip log', async () => {
    app = await appWithTrails();
    click(app, '#save-place');
    click(app, '.result-card');
    click(app, '[data-sheet-action="add"]');
    click(app, '#plan-trip');
    toggle(app, '[data-complete-trail="0:0"]');
    assert.ok(app.$('.plan-trail').classList.contains('completed'));
    assert.ok(app.$('#sheet-completed').checked, 'details panel follows the planner checkbox');
    click(app, '#plan-save');
    click(app, '.saved-tab[data-tab="trips"]');
    assert.match(app.$('#saved-list').textContent, /1\/1 completed/);
    click(app, '.saved-tab[data-tab="favorites"]');
    assert.match(app.$('#saved-list').textContent, /1 trail completed/);
  });
});
