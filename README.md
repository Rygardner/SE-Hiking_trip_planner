# My Trailside Hiking Trip Planner

A browser-based hiking planner for discovering trails, checking trip-day weather, finding nearby stays and recreation, estimating fuel cost, and saving destinations and trip plans.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The app uses plain HTML, CSS, and JavaScript; `requirements.txt` is the product feature brief, so no Python packages are needed.

## Data and privacy

Location search uses OpenStreetMap Nominatim, nearby trail and place data uses Overpass API, map tiles are from OpenStreetMap and forecasts and trail elevation use Open-Meteo. These services require an internet connection and may rate-limit requests. Favorites, the trip planner draft, saved trips, your packing checklist and saved packing lists are saved in this browser's local storage. Location is only accessed when you choose “Use my location.” Verify road conditions and trail access before departure.

## Packing checklist

Each trip plan has one packing checklist. It's saved to the trip log with the plan and comes back when you reopen that trip. A new plan starts with an empty checklist.

- **Forecast suggestions** in the sidebar's *Pack for the day* are based on the forecast for the place you've searched on the hike date. Select one to add it to your checklist (select it again to take it off), or use **Add all suggestions**. Items you've picked stay on the checklist even when the forecast changes.
- **Your own gear** goes into the same checklist: type it in and select **Add**.
- The trip planner's **Packing checklist** section shows and edits the same list. It has its own forecast suggestions, based on each trip day's destination on that day's date (from the trip's start date). Suggestions from all days are merged, so a trip with a cold day and a hot day suggests gear for both. A note says which days the forecast covers. Days more than 14 days out, or without a destination, get the basic suggestions until a forecast is available.

Check things off as you pack, and the progress count shows what's left. **Save list** keeps the checklist's items as a reusable list (for example, "Winter kit") that any trip can use. Saving under an existing name updates that list. **Load** fills the current trip's checklist from a saved list, unchecked, and asks first if that would remove items or clear checkmarks. **Uncheck everything** clears the ticks but keeps your items.


https://discord.gg/yueVPwj7j
