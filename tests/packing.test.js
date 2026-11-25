// Packing checklist: one list per trip that holds your own gear and the forecast suggestions you pick,
// checking items off, and saved lists you can load into any trip.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/app-harness');
const { GOLDEN, forecastFor } = require('./helpers/fixtures');

const PLAN_KEY = 'wilderpath:plan-draft';
const TRIPS_KEY = 'wilderpath:trips';
const LISTS_KEY = 'wilderpath:packing-lists';

const click = (app, selector) => app.$(selector).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
const toggle = (app, selector, checked = true) => {
  const box = app.$(selector);
  box.checked = checked;
  box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
};
const submit = (app, selector) => app.$(selector).dispatchEvent(new app.window.Event('submit', { cancelable: true }));
function addItem(app, name) {
  app.$('#pack-item-input').value = name;
  submit(app, '#pack-add-form');
}
function saveList(app, name) {
  app.$('#pack-list-name').value = name;
  submit(app, '#pack-save-form');
}
function pickList(app, id, host = '#gear-panel') {
  const select = app.$(`${host} [data-pack="select"]`);
  select.value = id;
  select.dispatchEvent(new app.window.Event('change', { bubbles: true }));
}
const checklist = app => app.$$('#pack-list li:not(.pack-empty) .pack-check span').map(span => span.textContent);
const plannerList = app => app.$$('#plan-packing [data-pack="list"] li:not(.pack-empty) .pack-check span').map(span => span.textContent);
const progress = app => app.$('#pack-progress').textContent;
const toast = app => app.$('#toast').textContent;
const itemBox = (app, name) => app.$$('#pack-list [data-pack-id]').find(box => box.closest('li').textContent.includes(name));
const checkItem = (app, name, checked = true) => toggle(app, `#pack-list [data-pack-id="${itemBox(app, name).dataset.packId}"]`, checked);
const suggestion = (app, name) => app.$(`[data-suggestion="${name}"]`);
const pickSuggestion = (app, name) => suggestion(app, name).dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
const listOptions = app => app.$$('#pack-saved-select option').map(option => option.textContent);
const tripPacking = app => app.storage(PLAN_KEY)?.packing;
const openTripsTab = app => click(app, '.saved-tab[data-tab="trips"]');

describe('packing checklist', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('starts with forecast suggestions to pick and an empty checklist', () => {
    app = loadApp();
    assert.deepEqual(app.$$('#gear-list li').map(li => li.textContent), ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit']);
    assert.ok(app.$$('#gear-list [data-suggestion]').every(button => button.getAttribute('aria-pressed') === 'false'));
    assert.ok(app.$('#pack-list .pack-empty'), 'shows an empty hint');
    assert.equal(progress(app), '0/0 PACKED');
    assert.ok(!app.$('#pack-add-suggestions').hidden);
    assert.ok(app.$('#pack-saved-select').disabled, 'no saved lists yet');
    assert.ok(app.$('#pack-load').disabled);
    assert.equal(app.storage(PLAN_KEY), null, 'looking at the checklist does not start a plan');
  });

  it('adds a forecast suggestion to the same checklist as your own gear', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    pickSuggestion(app, 'Offline map');
    assert.deepEqual(checklist(app), ['Headlamp', 'Offline map']);
    assert.equal(suggestion(app, 'Offline map').getAttribute('aria-pressed'), 'true');
    assert.ok(suggestion(app, 'Offline map').classList.contains('is-added'));
    assert.ok(!itemBox(app, 'Offline map').checked, 'added, not yet packed');
    assert.equal(progress(app), '0/2 PACKED');
    assert.match(toast(app), /Added Offline map/);
    assert.deepEqual(plain(tripPacking(app).items.map(item => item.name)), ['Headlamp', 'Offline map']);
  });

  it('takes a suggestion off the checklist when it is picked again', () => {
    app = loadApp();
    pickSuggestion(app, 'Offline map');
    checkItem(app, 'Offline map');
    pickSuggestion(app, 'Offline map');
    assert.deepEqual(checklist(app), []);
    assert.equal(suggestion(app, 'Offline map').getAttribute('aria-pressed'), 'false');
  });

  it('marks a suggestion as added when you typed the same item yourself', () => {
    app = loadApp();
    addItem(app, 'first-aid KIT');
    assert.equal(suggestion(app, 'First-aid kit').getAttribute('aria-pressed'), 'true');
    pickSuggestion(app, 'First-aid kit');
    assert.deepEqual(checklist(app), [], 'picking it again removes your item, so it is never listed twice');
  });

  it('adds all forecast suggestions at once, skipping ones already on the list', () => {
    app = loadApp();
    pickSuggestion(app, 'Sun protection');
    click(app, '#pack-add-suggestions');
    assert.deepEqual(checklist(app), ['Sun protection', 'Water & snacks', 'Offline map', 'First-aid kit']);
    assert.ok(app.$('#pack-add-suggestions').hidden, 'nothing left to add');
    assert.match(toast(app), /Added 3 forecast suggestions/);
  });

  it('adds your own gear, trimmed and without repeats', () => {
    app = loadApp();
    addItem(app, '  Trekking   poles ');
    addItem(app, 'Headlamp');
    addItem(app, 'trekking poles');
    assert.match(toast(app), /already on your list/);
    assert.equal(app.$('#pack-item-input').value, 'trekking poles', 'a rejected item stays in the box to fix');
    addItem(app, '   ');
    assert.deepEqual(checklist(app), ['Trekking poles', 'Headlamp']);
    assert.equal(progress(app), '0/2 PACKED');
  });

  it('keeps what you are typing when you check a box', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    app.$('#pack-item-input').value = 'half typ';
    checkItem(app, 'Headlamp');
    assert.equal(app.$('#pack-item-input').value, 'half typ');
  });

  it('checks items off, counts progress and keeps it after a reload', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    pickSuggestion(app, 'Offline map');
    checkItem(app, 'Headlamp');
    assert.equal(progress(app), '1/2 PACKED');
    assert.ok(itemBox(app, 'Headlamp').closest('li').classList.contains('is-packed'));
    const storage = { [PLAN_KEY]: app.window.localStorage.getItem(PLAN_KEY) };
    app.close();

    app = loadApp({ storage });
    assert.deepEqual(checklist(app), ['Headlamp', 'Offline map']);
    assert.ok(itemBox(app, 'Headlamp').checked);
    assert.ok(!itemBox(app, 'Offline map').checked);
    assert.equal(suggestion(app, 'Offline map').getAttribute('aria-pressed'), 'true');
    assert.equal(progress(app), '1/2 PACKED');
  });

  it('says when everything is packed and can uncheck it all', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    pickSuggestion(app, 'Offline map');
    // Each change re-renders the list, so look up the next unchecked box every time.
    for (let box; (box = app.$('#pack-list input:not(:checked)'));) {
      box.checked = true;
      box.dispatchEvent(new app.window.Event('change', { bubbles: true }));
    }
    assert.equal(progress(app), 'ALL PACKED ✓');
    click(app, '#pack-reset');
    assert.equal(progress(app), '0/2 PACKED');
    assert.deepEqual(checklist(app), ['Headlamp', 'Offline map'], 'unchecking keeps your items');
  });

  it('does not start a plan when there is nothing to uncheck', () => {
    app = loadApp();
    click(app, '#pack-reset');
    assert.equal(app.storage(PLAN_KEY), null);
  });

  it('removes an item', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    addItem(app, 'Bear spray');
    click(app, `[data-remove-pack="${itemBox(app, 'Headlamp').dataset.packId}"]`);
    assert.deepEqual(checklist(app), ['Bear spray']);
    assert.equal(tripPacking(app).items.length, 1);
  });

  it('keeps picked suggestions when the forecast changes', async () => {
    app = loadApp({ routes: { forecast: () => forecastFor(app.$('#trip-date').value, { code: 63, high: 58, low: 41, rain: 70 }) } });
    pickSuggestion(app, 'Offline map');
    checkItem(app, 'Offline map');
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => suggestion(app, 'Rain shell'), { message: 'rain suggestion' });
    assert.deepEqual(app.$$('#gear-list li').map(li => li.textContent), ['Warm layers', 'Rain shell', 'Sun protection', 'First-aid kit']);
    assert.deepEqual(checklist(app), ['Offline map'], 'no longer suggested, still on your list');
    assert.ok(itemBox(app, 'Offline map').checked);
    assert.equal(progress(app), 'ALL PACKED ✓');
  });

  it('saves a reusable list and updates it when saved under the same name', () => {
    app = loadApp();
    saveList(app, 'Winter kit');
    assert.match(toast(app), /Add some gear/, 'an empty list is not saved');
    assert.equal(app.storage(LISTS_KEY), null);

    addItem(app, 'Microspikes');
    pickSuggestion(app, 'First-aid kit');
    checkItem(app, 'Microspikes');
    saveList(app, ' Winter kit ');
    let lists = app.storage(LISTS_KEY);
    assert.equal(lists.length, 1);
    assert.equal(lists[0].name, 'Winter kit');
    assert.deepEqual(plain(lists[0].items), ['Microspikes', 'First-aid kit'], 'picked suggestions are saved too; checkmarks are not');
    assert.deepEqual(listOptions(app), ['Choose a saved list (1)', 'Winter kit · 2 items']);
    assert.equal(app.$('#pack-saved-select').value, lists[0].id, 'the new list is selected');

    addItem(app, 'Hand warmers');
    saveList(app, 'winter KIT');
    lists = app.storage(LISTS_KEY);
    assert.equal(lists.length, 1, 'same name updates instead of duplicating');
    assert.equal(lists[0].items.length, 3);
    assert.match(toast(app), /Updated/);
  });

  it('names an unnamed list after the destination', () => {
    app = loadApp();
    app.run('currentPlace = { shortName: "Golden" }');
    addItem(app, 'Headlamp');
    saveList(app, '');
    assert.equal(app.storage(LISTS_KEY)[0].name, 'Golden kit');
  });

  it('loads a saved list unchecked, replacing the checklist', () => {
    const lists = [
      { id: 'desert', name: 'Desert day', items: ['Sun hoodie', 'Electrolytes'], savedAt: '2026-06-01T00:00:00Z' },
      { id: 'winter', name: 'Winter kit', items: ['Microspikes'], savedAt: '2026-01-01T00:00:00Z' },
    ];
    app = loadApp({ storage: { [LISTS_KEY]: lists } });
    addItem(app, 'Headlamp');
    let asked = '';
    app.window.confirm = message => { asked = message; return true; };

    pickList(app, 'desert');
    assert.ok(!app.$('#pack-load').disabled);
    click(app, '#pack-load');
    assert.match(asked, /Replace this trip's gear/);
    assert.deepEqual(checklist(app), ['Sun hoodie', 'Electrolytes']);
    assert.equal(app.$$('#pack-list input:checked').length, 0, 'a loaded list starts unchecked');
    assert.equal(app.$('#pack-list-name').value, 'Desert day', 'saving again updates the loaded list');
    assert.match(toast(app), /Loaded “Desert day”/);
  });

  it('asks before loading a list would clear checkmarks, even on the same items', () => {
    app = loadApp({ storage: { [LISTS_KEY]: [{ id: 'kit', name: 'Kit', items: ['Headlamp'] }] } });
    addItem(app, 'Headlamp');
    checkItem(app, 'Headlamp');
    let asked = false;
    app.window.confirm = () => { asked = true; return false; };
    pickList(app, 'kit');
    click(app, '#pack-load');
    assert.ok(asked);
    assert.ok(itemBox(app, 'Headlamp').checked, 'cancelling keeps the checkmark');
  });

  it('loads without asking when nothing would be lost', () => {
    app = loadApp({ storage: { [LISTS_KEY]: [{ id: 'kit', name: 'Kit', items: ['Headlamp', 'Map'] }] } });
    addItem(app, 'Headlamp');
    app.window.confirm = () => { throw new Error('should not ask'); };
    pickList(app, 'kit');
    click(app, '#pack-load');
    assert.deepEqual(checklist(app), ['Headlamp', 'Map']);
  });

  it('keeps the checklist when you cancel loading a list', () => {
    app = loadApp({ storage: { [LISTS_KEY]: [{ id: 'winter', name: 'Winter kit', items: ['Microspikes'] }] } });
    addItem(app, 'Headlamp');
    app.window.confirm = () => false;
    pickList(app, 'winter');
    click(app, '#pack-load');
    assert.deepEqual(checklist(app), ['Headlamp']);
  });

  it('deletes a saved list but keeps the checklist', () => {
    app = loadApp({ storage: { [LISTS_KEY]: [{ id: 'winter', name: 'Winter kit', items: ['Microspikes'] }] } });
    addItem(app, 'Headlamp');
    pickList(app, 'winter');
    click(app, '#pack-delete-list');
    assert.deepEqual(plain(app.storage(LISTS_KEY)), []);
    assert.deepEqual(listOptions(app), ['No saved lists yet']);
    assert.deepEqual(checklist(app), ['Headlamp']);
  });

  it('ignores broken or tampered storage', () => {
    app = loadApp({ storage: {
      [PLAN_KEY]: { id: 'p', name: '', days: [], packing: { items: [{ id: 'a', name: '<b>Tent</b>', checked: true }, null, { name: '' }, { name: '<B>TENT</B>' }, 'oops'] } },
      [LISTS_KEY]: [{ name: 'Good', items: ['Map', 'map', 7] }, { name: '', items: ['x'] }, { name: 'No items' }, null],
    } });
    assert.deepEqual(checklist(app), ['<b>Tent</b>'], 'shown as text, not markup');
    assert.equal(app.$('#pack-list b'), null);
    assert.deepEqual(listOptions(app), ['Choose a saved list (1)', 'Good · 2 items']);

    app.close();
    app = loadApp({ storage: { [PLAN_KEY]: { id: 'p', name: '', days: [], packing: 'broken' }, [LISTS_KEY]: '{"a":1}' } });
    assert.deepEqual(checklist(app), []);
    assert.deepEqual(listOptions(app), ['No saved lists yet']);
  });

  it('keeps items with a repeated stored id independent', () => {
    app = loadApp({ storage: { [PLAN_KEY]: { id: 'p', name: '', days: [], packing: { items: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] } } } });
    checkItem(app, 'B');
    assert.ok(itemBox(app, 'B').checked);
    assert.ok(!itemBox(app, 'A').checked);
  });
});

describe('packing checklist per trip', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  const openPlanner = () => click(app, '#plan-trip');

  it('does not give the trip a destination or map stop when you start packing', () => {
    app = loadApp();
    app.run('setPlace')({ ...GOLDEN });
    addItem(app, 'Headlamp');
    const plan = app.storage(PLAN_KEY);
    assert.equal(plan.days.length, 1);
    assert.equal(plan.days[0].destination, null);
    assert.equal(app.L.groups[1].layers.length, 0, 'no plan stops drawn');
  });

  it('is part of the trip planner and shares the same checklist with the sidebar', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    pickSuggestion(app, 'Offline map');
    openPlanner();
    assert.deepEqual(plannerList(app), ['Headlamp', 'Offline map'], 'picked suggestions show in the planner too');
    assert.equal(app.$('#plan-packing [data-pack="progress"]').textContent, '0/2 PACKED');

    const input = app.$('#plan-packing [data-pack="input"]');
    input.value = 'Bear spray';
    submit(app, '#plan-packing [data-pack="add"]');
    assert.equal(input.value, '');
    assert.deepEqual(checklist(app), ['Headlamp', 'Offline map', 'Bear spray'], 'added in the planner, shown in the sidebar');

    toggle(app, `#plan-packing [data-pack-id="${tripPacking(app).items[2].id}"]`);
    assert.ok(itemBox(app, 'Bear spray').checked, 'checked in the planner, checked in the sidebar');
    assert.equal(app.$('#plan-packing [data-pack="progress"]').textContent, '1/3 PACKED');
    assert.equal(progress(app), '1/3 PACKED', 'both places count the same list');
  });

  it('reports planner checklist actions inside the planner', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    openPlanner();
    app.$('#plan-packing [data-pack="name"]').value = 'Kit';
    submit(app, '#plan-packing [data-pack="save"]');
    assert.match(app.$('#plan-status').textContent, /Saved “Kit”/);
    assert.equal(app.$('#pack-list-name').value, '', 'the sidebar name box is left alone');
  });

  it('updates the trip name next to the checklist as you type it', () => {
    app = loadApp();
    addItem(app, 'Headlamp');
    openPlanner();
    app.$('#plan-name').value = 'Desert loop';
    app.$('#plan-name').dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.$('#pack-trip').textContent, 'Packing for Desert loop');
  });

  it('saves the checklist with the trip and brings it back when the trip is reopened', () => {
    app = loadApp();
    openPlanner();
    app.$('#plan-name').value = 'Desert loop';
    app.$('#plan-name').dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.run('plan.days[0].destination = { name: "Golden", shortName: "Golden", lat: 39.7, lon: -105.2 }');
    addItem(app, 'Sun hoodie');
    pickSuggestion(app, 'Offline map');
    checkItem(app, 'Sun hoodie');
    click(app, '#plan-save');
    const [trip] = app.storage(TRIPS_KEY);
    assert.deepEqual(plain(trip.packing.items.map(item => [item.name, item.checked])), [['Sun hoodie', true], ['Offline map', false]]);

    click(app, '#plan-new');
    assert.deepEqual(checklist(app), [], 'a new trip starts with an empty checklist');
    assert.equal(suggestion(app, 'Offline map').getAttribute('aria-pressed'), 'false');

    openTripsTab(app);
    assert.match(app.$('#saved-list').textContent, /1\/2 packed/, 'the trip log shows packing progress');
    click(app, '.saved-item-open');
    assert.deepEqual(checklist(app), ['Sun hoodie', 'Offline map']);
    assert.ok(itemBox(app, 'Sun hoodie').checked);
    assert.equal(suggestion(app, 'Offline map').getAttribute('aria-pressed'), 'true');
    assert.match(app.$('#pack-trip').textContent, /Desert loop/);
  });

  it('keeps each trip\'s checklist separate', () => {
    const trips = [
      { id: 'a', name: 'Winter trip', startDate: '', days: [{ destination: null, trails: [] }], packing: { items: [{ id: '1', name: 'Microspikes', checked: false }] } },
      { id: 'b', name: 'Summer trip', startDate: '', days: [{ destination: null, trails: [] }], packing: { items: [{ id: '2', name: 'Sun hat', checked: true }] } },
    ];
    app = loadApp({ storage: { [TRIPS_KEY]: trips } });
    openTripsTab(app);
    app.$$('.saved-item-open')[0].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(checklist(app), ['Microspikes']);
    app.$$('.saved-item-open')[1].dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(checklist(app), ['Sun hat']);
    assert.equal(app.storage(TRIPS_KEY)[0].packing.items[0].name, 'Microspikes', 'opening another trip leaves the log alone');
  });

  it('opens trips saved before checklists belonged to plans with an empty checklist', () => {
    app = loadApp({ storage: { [TRIPS_KEY]: [{ id: 'old', name: 'Old trip', startDate: '', days: [{ destination: null, trails: [] }] }] } });
    openTripsTab(app);
    click(app, '.saved-item-open');
    assert.deepEqual(checklist(app), []);
    assert.equal(progress(app), '0/0 PACKED');
  });



});

describe('forecast suggestions in the trip planner', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  const GJ = { name: 'Grand Junction, Mesa County, Colorado, United States', shortName: 'Grand Junction', lat: 39.0639, lon: -108.5506 };
  const plannerSuggestions = () => app.$$('#plan-packing [data-pack="suggestions"] li').map(li => li.textContent);
  const note = () => app.$('#plan-packing [data-pack="forecast-note"]').textContent;
  const today = () => app.$('#trip-date').value;
  const dayAfter = date => { const next = new Date(`${date}T12:00`); next.setDate(next.getDate() + 1); return next.toLocaleDateString('en-CA'); };
  // A forecast reply whose weather depends on the requested place: cold and wet at Golden, hot and windy at Grand Junction.
  const WEATHER = { [GOLDEN.lat]: { code: 63, high: 50, low: 30, rain: 80, wind: 5 }, [GJ.lat]: { code: 0, high: 95, low: 65, rain: 0, wind: 25 } };
  function forecastByPlace({ url }) {
    const lat = Number(new URL(url).searchParams.get('latitude'));
    const weather = WEATHER[lat];
    const dates = [today(), dayAfter(today())];
    const daily = forecastFor(dates[0], weather).daily;
    for (const key of Object.keys(daily)) daily[key] = key === 'time' ? dates : dates.map(() => daily[key][0]);
    return { daily };
  }
  function planTrip(days, { startDate } = {}) {
    app.$('#plan-trip').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    app.run('plan').days = days.map(place => ({ destination: place && { ...place }, trails: [] }));
    if (startDate !== undefined) app.run('plan').startDate = startDate;
    app.run('persistPlan()');
  }

  it('suggests gear from the forecast for the trip day\'s destination and date', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN]);
    await app.waitFor(() => note().startsWith('From the forecast'), { message: 'trip forecast' });
    assert.deepEqual(plannerSuggestions(), ['Warm layers', 'Rain shell', 'Sun protection', 'Gloves & warm hat']);
    assert.equal(note(), 'From the forecast for Day 1 (Golden).');
    const url = new URL(app.calls('forecast').at(-1).url);
    assert.equal(url.searchParams.get('latitude'), String(GOLDEN.lat));
  });

  it('adds a planner suggestion to the trip checklist, shown in the sidebar too', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN]);
    await app.waitFor(() => app.$('#plan-packing [data-suggestion="Rain shell"]'), { message: 'rain suggestion' });
    app.$('#plan-packing [data-suggestion="Rain shell"]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(plannerList(app), ['Rain shell']);
    assert.deepEqual(checklist(app), ['Rain shell']);
    assert.equal(app.$('#plan-packing [data-suggestion="Rain shell"]').getAttribute('aria-pressed'), 'true');
    assert.match(app.$('#plan-status').textContent, /Added Rain shell/);
  });

  it('merges suggestions from every trip day without repeats', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN, GJ]);
    await app.waitFor(() => note().startsWith('From the forecast'), { message: 'trip forecast' });
    assert.deepEqual(plannerSuggestions(), ['Warm layers', 'Rain shell', 'Sun protection', 'Gloves & warm hat', 'Extra water', 'Offline map', 'Wind layer', 'First-aid kit']);
    assert.equal(note(), 'From the forecast for Days 1 and 2 (Golden, Grand Junction).');
  });

  it('adds every planner suggestion at once', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GJ]);
    await app.waitFor(() => note().startsWith('From the forecast'), { message: 'trip forecast' });
    app.$('#plan-packing [data-pack="add-all"]').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(plannerList(app), ['Extra water', 'Offline map', 'Wind layer', 'First-aid kit'], 'the trip forecast, not the sidebar\'s');
    assert.ok(app.$('#plan-packing [data-pack="add-all"]').hidden);
  });

  it('asks once per destination and does not ask again for checklist changes', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN, GOLDEN]);
    await app.waitFor(() => note().startsWith('From the forecast'), { message: 'trip forecast' });
    assert.equal(app.calls('forecast').length, 1);
    const input = app.$('#plan-packing [data-pack="input"]');
    input.value = 'Headlamp';
    submit(app, '#plan-packing [data-pack="add"]');
    await app.settle();
    assert.equal(app.calls('forecast').length, 1);
  });

  it('updates the suggestions when a day\'s destination changes', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN]);
    await app.waitFor(() => note().includes('Golden'), { message: 'Golden forecast' });
    app.run('plan').days[0].destination = { ...GJ };
    app.run('persistPlan()');
    await app.waitFor(() => note().includes('Grand Junction'), { message: 'Grand Junction forecast' });
    assert.deepEqual(plannerSuggestions(), ['Extra water', 'Offline map', 'Wind layer', 'First-aid kit']);
  });

  it('says when a trip day is past the 14-day forecast and shows the basics', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN], { startDate: '2099-07-04' });
    await app.waitFor(() => note().startsWith('No forecast yet'), { message: 'no-forecast note' });
    assert.equal(note(), 'No forecast yet for Day 1: forecasts cover the next 14 days. These are the basics until a forecast is available.');
    assert.deepEqual(plannerSuggestions(), ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit']);
  });

  it('says when trip days have already passed', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN, GOLDEN], { startDate: '2020-05-01' });
    await app.waitFor(() => note().includes('passed'), { message: 'past note' });
    assert.equal(note(), 'Days 1 and 2 have already passed. These are the basics until a forecast is available.');
  });

  it('covers the days it can and names the ones it can\'t', async () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([GOLDEN, GOLDEN, GJ]); // day 3 is two days out, past this reply's two forecast days
    await app.waitFor(() => note().startsWith('From the forecast'), { message: 'trip forecast' });
    assert.equal(note(), 'From the forecast for Days 1 and 2 (Golden). No forecast yet for Day 3: forecasts cover the next 14 days.');
  });

  it('shows the basics without asking for a forecast when the trip has no destination or start date', () => {
    app = loadApp({ routes: { forecast: forecastByPlace } });
    planTrip([null]);
    assert.match(note(), /Add a destination/);
    assert.deepEqual(plannerSuggestions(), ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit']);
    planTrip([GOLDEN], { startDate: '' });
    assert.match(note(), /Set a start date/);
    assert.equal(app.calls('forecast').length, 0);
  });

  it('falls back to the basics when the forecast is unavailable', async () => {
    app = loadApp({ routes: { forecast: () => { throw new Error('offline'); } } });
    planTrip([GOLDEN]);
    await app.waitFor(() => note().includes('unavailable'), { message: 'unavailable note' });
    assert.equal(note(), 'The forecast for Day 1 is unavailable right now. These are the basics until a forecast is available.');
    assert.deepEqual(plannerSuggestions(), ['Water & snacks', 'Offline map', 'Sun protection', 'First-aid kit']);
  });
});
