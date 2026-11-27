// Sample API responses shared by the tests.

const GOLDEN = { name: 'Golden, Jefferson County, Colorado, United States', shortName: 'Golden', lat: 39.7555, lon: -105.2211 };
const BOULDER = { name: 'Boulder, Boulder County, Colorado, United States', shortName: 'Boulder', lat: 40.015, lon: -105.2705 };

// Two ways of one trail (name variants), a matching hiking route, a far trail,
// a route with no mapped path (should be dropped) and a trailhead by the first trail's start.
const overpassData = () => ({
  elements: [
    { type: 'way', id: 1, tags: { name: 'Bear Creek Trail (241)', highway: 'path', sac_scale: 'mountain_hiking', surface: 'dirt', dog: 'leashed' },
      geometry: [{ lat: 39.76, lon: -105.23 }, { lat: 39.765, lon: -105.235 }] },
    { type: 'way', id: 2, tags: { name: 'Bear Creek Trail #241', highway: 'path', website: 'example.com/bear' },
      geometry: [{ lat: 39.765, lon: -105.235 }, { lat: 39.77, lon: -105.24 }] },
    { type: 'relation', id: 3, tags: { name: 'Bear Creek Trail', route: 'hiking', operator: 'Jefferson County Open Space' }, center: { lat: 39.765, lon: -105.235 } },
    { type: 'way', id: 4, tags: { name: 'Mesa Loop', highway: 'path' },
      geometry: [{ lat: 39.8, lon: -105.3 }, { lat: 39.801, lon: -105.301 }, { lat: 39.802, lon: -105.3 }] },
    { type: 'relation', id: 5, tags: { name: 'Lonely Route', route: 'hiking' }, center: { lat: 39.9, lon: -105.5 } },
    { type: 'node', id: 6, lat: 39.7601, lon: -105.2301, tags: { highway: 'trailhead' } },
  ],
});

const geocodeResults = (place = GOLDEN) => [
  { display_name: place.name, lat: String(place.lat), lon: String(place.lon), addresstype: 'town' },
];

function forecastFor(date, { code = 0, high = 70, low = 50, rain = 10, wind = 5 } = {}) {
  return {
    daily: {
      time: [date],
      weather_code: [code],
      temperature_2m_max: [high],
      temperature_2m_min: [low],
      precipitation_probability_max: [rain],
      wind_speed_10m_max: [wind],
      sunrise: [`${date}T06:30`],
      sunset: [`${date}T19:30`],
    },
  };
}

// Hourly forecast for whole days starting on `date`, in the test machine's own time zone so "now" lines up.
function hourlyFor(date, { days = 1, code = 0, temp = 60, rain = 20, wind = 7 } = {}) {
  const time = [];
  const start = new Date(`${date}T00:00Z`);
  for (let hour = 0; hour < days * 24; hour += 1) time.push(new Date(start.getTime() + hour * 3600000).toISOString().slice(0, 16));
  return {
    utc_offset_seconds: -new Date().getTimezoneOffset() * 60,
    hourly: {
      time,
      weather_code: time.map(() => code),
      temperature_2m: time.map((_, index) => temp + index % 24),
      precipitation_probability: time.map(() => rain),
      wind_speed_10m: time.map(() => wind),
    },
  };
}

// Returns one made-up elevation (meters) per requested point.
function elevationReply({ url }) {
  const count = new URL(url).searchParams.get('latitude').split(',').length;
  return { elevation: Array.from({ length: count }, (_, index) => 1800 + index * 5) };
}

module.exports = { GOLDEN, BOULDER, overpassData, geocodeResults, forecastFor, hourlyFor, elevationReply };
