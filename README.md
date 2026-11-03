# Wilderpath Hiking Trip Planner

A browser-based hiking planner for discovering trails, checking trip-day weather, finding nearby stays and recreation, estimating fuel cost, and saving destinations and trip plans.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The app uses plain HTML, CSS, and JavaScript; `requirements.txt` is the product feature brief, so no Python packages are needed.

### Driving routes (optional)

Driving routes use [OpenRouteService](https://openrouteservice.org/). Get a free key, then copy `config.example.js` to `config.js` and paste the key in. `config.js` is gitignored. Without a key the app still works; it just skips the route. Because this is a browser-only app, the key is visible to anyone who opens the page.

## Data and privacy

Location search uses OpenStreetMap Nominatim, nearby trail and place data uses Overpass API, map tiles are from OpenStreetMap, forecasts and trail elevation use Open-Meteo, and driving routes use OpenRouteService. These services require an internet connection and may rate-limit requests. Favorites, the trip planner draft, and saved trips are saved in this browser's local storage. Location is only accessed when you choose “Use my location.” Live traffic and turn-by-turn directions are not included; verify road conditions and trail access before departure.


https://discord.gg/yueVPwj7j
