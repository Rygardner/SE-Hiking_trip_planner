# Wilderpath Hiking Trip Planner

A browser-based hiking planner for discovering trails, checking trip-day weather, finding nearby stays and recreation, estimating fuel cost, and saving destinations and trip plans.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The app uses plain HTML, CSS, and JavaScript; `requirements.txt` is the product feature brief, so no Python packages are needed.

## Data and privacy

Location search uses OpenStreetMap Nominatim, nearby trail and place data uses Overpass API, map tiles are from OpenStreetMap, and forecasts use Open-Meteo. These services require an internet connection and may rate-limit requests. Favorites and trip logs are saved in this browser's local storage. Location is only accessed when you choose “Use my location.” Live traffic and turn-by-turn routing require a separate provider and are not included; verify road conditions and trail access before departure.