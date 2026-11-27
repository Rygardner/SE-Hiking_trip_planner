// Hour-by-hour forecast covering the hike's start time and duration.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, reply, plain } = require('./helpers/app-harness');
const { GOLDEN, overpassData, geocodeResults, forecastFor, hourlyFor, elevationReply } = require('./helpers/fixtures');

const localDate = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toLocaleDateString('en-CA');
};

// A daily + hourly reply for `date`, covering `days` days of hours.
const forecastReply = (date, options = {}) => ({ ...forecastFor(date), ...hourlyFor(date, options) });

const rows = app => app.$$('#hourly-rows tr').map(row => [...row.children].map(cell => cell.textContent));

describe('hourly rows', () => {
  let app;
  afterEach(() => app.close());

  it('covers the start hour through the hour the hike finishes in', () => {
    app = loadApp();
    const data = hourlyFor('2030-06-01');
    const result = plain(app.run('hourlyRows')(data, '2030-06-01', '08:30', 4, '2030-06-01T00'));
    assert.deepEqual(result.map(row => row.time), ['2030-06-01T08', '2030-06-01T09', '2030-06-01T10', '2030-06-01T11', '2030-06-01T12']);
    assert.deepEqual(result[0], { time: '2030-06-01T08', status: 'ok', code: 0, temp: 68, rain: 20, wind: 7 });
  });

  it('marks hours before now as passed', () => {
    app = loadApp();
    const result = app.run('hourlyRows')(hourlyFor('2030-06-01'), '2030-06-01', '08:00', 4, '2030-06-01T10');
    assert.deepEqual([...result].map(row => row.status), ['passed', 'passed', 'ok', 'ok', 'ok']);
  });

  it('marks hours past the end of the forecast as missing, across midnight', () => {
    app = loadApp();
    const result = app.run('hourlyRows')(hourlyFor('2030-06-01'), '2030-06-01', '22:00', 4, '2030-06-01T00');
    assert.deepEqual([...result].map(row => row.status), ['ok', 'ok', 'missing', 'missing', 'missing']);
    assert.match(app.run('formatHour')(result[2].time, '2030-06-01'), /^[A-Z][a-z]{2} 12 AM$/);
    assert.equal(app.run('formatHour')(result[0].time, '2030-06-01'), '10 PM');
  });
});

describe('hourly forecast panel', () => {
  let app;
  afterEach(() => {
    assert.deepEqual(app.errors.map(String), [], 'app threw an uncaught error');
    app.close();
  });

  it('shows conditions, temperature, rain and wind for each hour of the hike', async () => {
    const tomorrow = localDate(1);
    app = loadApp({ routes: { forecast: () => forecastReply(tomorrow, { days: 2, code: 63, rain: 65, wind: 12 }) } });
    app.$('#trip-date').value = tomorrow;
    app.$('#start-time').value = '09:00';
    app.$('#hike-hours').value = '2';
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => !app.$('#hourly-table').hidden, { message: 'hourly table' });
    assert.deepEqual(rows(app), [
      ['9 AM', '☂Rain possible', '69°F', '65%', '12 mph'],
      ['10 AM', '☂Rain possible', '70°F', '65%', '12 mph'],
      ['11 AM', '☂Rain possible', '71°F', '65%', '12 mph'],
    ]);
    assert.equal(app.$('#hourly-where').textContent, 'GOLDEN');
    assert.match(app.$('#hourly-note').textContent, /2-hour hike, starting 9 AM/);
    const url = new URL(app.calls('forecast')[0].url);
    assert.equal(url.searchParams.get('hourly'), 'weather_code,temperature_2m,precipitation_probability,wind_speed_10m');
    assert.equal(app.calls('forecast').length, 1, 'daily and hourly come from one request');
  });

  it('updates when the start time or duration changes', async () => {
    const tomorrow = localDate(1);
    app = loadApp({ routes: { forecast: () => forecastReply(tomorrow, { days: 2 }) } });
    app.$('#trip-date').value = tomorrow;
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => !app.$('#hourly-table').hidden, { message: 'hourly table' });
    assert.equal(rows(app).length, 5, '8 AM through noon for the default 4 hours');
    app.$('#start-time').value = '13:00';
    app.$('#hike-hours').value = '8';
    app.$('#hike-hours').dispatchEvent(new app.window.Event('change'));
    await app.waitFor(() => rows(app)[0]?.[0] === '1 PM', { message: 'new hours' });
    assert.equal(rows(app).length, 9);
    assert.equal(rows(app).at(-1)[0], '9 PM');
  });

  it('says clearly when there is no forecast for the date', async () => {
    app = loadApp({ routes: { forecast: () => forecastReply(localDate(1)) } });
    app.$('#trip-date').value = '2099-07-04';
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#hourly-note').textContent.startsWith('No hourly'), { message: 'no-forecast note' });
    assert.equal(app.$('#hourly-note').textContent, 'No hourly forecast for Sat, Jul 4 yet. Forecasts cover the next 14 days, so check back closer to your trip.');
    assert.equal(app.$('#hourly-table').hidden, true);
  });

  it('labels the hours the forecast does not reach yet', async () => {
    const tomorrow = localDate(1);
    app = loadApp({ routes: { forecast: () => forecastReply(tomorrow, { days: 1 }) } });
    app.$('#trip-date').value = tomorrow;
    app.$('#start-time').value = '20:00';
    app.$('#hike-hours').value = '6';
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => !app.$('#hourly-table').hidden, { message: 'hourly table' });
    const result = rows(app);
    assert.equal(result.length, 7);
    assert.deepEqual(result.slice(4).map(row => row[1]), ['Forecast not available yet', 'Forecast not available yet', 'Forecast not available yet']);
    assert.equal(app.$('#hourly-note').textContent, 'No forecast yet for the last 3 hours of your hike.');
  });

  it('says when the chosen hours have already passed', async () => {
    const yesterday = localDate(-1);
    app = loadApp({ routes: { forecast: () => forecastReply(yesterday, { days: 3 }) } });
    app.$('#trip-date').value = yesterday;
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#hourly-note').textContent.includes('passed'), { message: 'passed note' });
    assert.equal(app.$('#hourly-note').textContent, 'These hours have already passed. Pick a later start time or another day.');
  });

  it('handles the forecast service being down', async () => {
    app = loadApp({ routes: { forecast: () => reply(500) } });
    app.run('setPlace')({ ...GOLDEN });
    await app.waitFor(() => app.$('#hourly-note').textContent.startsWith('Hourly forecast unavailable'), { message: 'error note' });
    assert.equal(app.$('#hourly-table').hidden, true);
  });

  it('switches to the selected trail\'s trailhead', async () => {
    const tomorrow = localDate(1);
    app = loadApp({ routes: { geocode: () => geocodeResults(), overpass: () => overpassData(), elevation: elevationReply, forecast: () => forecastReply(tomorrow, { days: 2 }) } });
    app.$('#trip-date').value = tomorrow;
    await app.search('Golden');
    await app.waitFor(() => app.$$('#result-list .result-card').length, { message: 'trail cards' });
    app.$('.result-card').dispatchEvent(new app.window.MouseEvent('click', { bubbles: true }));
    await app.waitFor(() => app.$('#hourly-where').textContent.startsWith('TRAILHEAD'), { message: 'trailhead label' });
    assert.equal(app.$('#hourly-where').textContent, 'TRAILHEAD · BEAR CREEK TRAIL (241)');
    await app.waitFor(() => !app.$('#hourly-table').hidden, { message: 'hourly table' });
    const last = new URL(app.calls('forecast').at(-1).url);
    assert.equal(last.searchParams.get('latitude'), '39.7601');
  });
});
