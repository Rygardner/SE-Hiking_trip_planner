# My Trailside Hiking Trip Planner

A browser-based hiking planner for discovering trails, checking trip-day weather, finding nearby stays and recreation, estimating fuel cost, and saving destinations and trip plans.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The app uses plain HTML, CSS, and JavaScript; `requirements.txt` is the product feature brief, so no Python packages are needed.

## Data and privacy

Location search uses OpenStreetMap Nominatim, nearby trail and place data uses Overpass API, map tiles are from OpenStreetMap and forecasts and trail elevation use Open-Meteo. These services require an internet connection and may rate-limit requests. Favorites, the trip planner draft, and saved trips are saved in this browser's local storage. Location is only accessed when you choose “Use my location.” Turn-by-turn directions are not included; verify road conditions and trail access before departure.


https://discord.gg/yueVPwj7j
