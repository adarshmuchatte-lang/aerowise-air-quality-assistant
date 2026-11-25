# AeroWise 3.0 — 3D Air Intelligence OS

AeroWise turns a location's modeled air-quality forecast into a clear daily plan. The hackathon build combines live Open-Meteo data, a procedural 3D Earth, hourly forecast, household recommendations, a conceptual indoor-air room, a commute CO₂e calculator, and an assistant that still works without an AI key.

## Run locally on Windows

Requires Node.js 20 or newer. The server and tests use Node's built-in modules, so there is no package installation step.

```powershell
cd "C:\path\to\AeroWise-project"
npm start
```

Open <http://127.0.0.1:4173>. Keep the terminal open while using the app. Stop the server with `Ctrl+C`.

If port 4173 is already in use, AeroWise prints a Windows command to identify the process and a command to use port 4174 instead:

```powershell
$env:PORT = "4174"
npm start
```

If you already have a different process using 4173, leave it alone or choose another port. To inspect it, run `Get-NetTCPConnection -LocalPort 4173 -State Listen` and then `Get-Process -Id <PID>` with the PID shown.

## What was broken and what changed

The original browser script defined `$` as `document.querySelector`, then called `$(document).addEventListener(...)` during `init()`. Passing the `document` object to `querySelector` throws an invalid-selector `DOMException`. That stopped initialization before the forecast loader ran, so the static “Checking your air…” placeholders remained on screen. This was not caused by a missing API key or an Open-Meteo outage.

The app now initializes without that selector error and sends geocoding and forecast requests through its own server routes. Open-Meteo is an unauthenticated public provider for these endpoints; the server also reports provider timeouts, HTTP failures, malformed responses, and missing data as useful JSON errors. It does not silently fill missing pollutant fields with invented numbers.

## Data and modes

- **Live data:** current provider model output and hourly forecast for the selected coordinates.
- **Stale data:** the last valid reading for the same city stays on screen if a refresh fails, with a visible stale label.
- **Demo data:** the deterministic fixture in `fixtures/demo-air.json` is clearly labeled. The page only switches to demo automatically when there is no valid reading to preserve, or when you explicitly select **Demo View**.
- **Unavailable:** if neither live data nor the fixture can load, readings stay blank and the page shows a retry action.

Open-Meteo forecast cells are modeled estimates, not readings from a nearby regulatory monitor. AQI uses U.S. AQI when returned, otherwise the interface labels and uses European AQI. The globe's haze, particles, colors, and city markers are illustrative visualizations; they do not depict measured pollution plumes or monitoring stations.

## Features

- Search for a city, select a result, or choose **Use my location** to request browser location access after a user click.
- Interactive Three.js Earth with drag rotation, Shift + scroll zoom, reset, and planet, air-field, cities, forecast, and layer modes. A lightweight 2D Earth view appears if the Three.js module cannot load.
- AQI instrument, independently displayed pollutants, hourly forecast chart, and location-specific daily recommendations.
- Preferences for household and routine, a conceptual indoor-air room, and a locally saved daily plan.
- Commute comparison using a simple distance and trips-per-week model. Its default direct-use factors are UK 2026 estimates: petrol car 0.16152 kg CO₂e per vehicle-km and local bus 0.10151 kg CO₂e per passenger-km. The calculator is not a measurement of local air-quality change. [Source: UK Government 2026 greenhouse-gas reporting conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026).
- Shareable local update, browser/device-local saved plan, and assistant.
- Responsive layout, keyboard-accessible forecast points, and reduced-motion support.

## Optional AI answers

The assistant works with built-in guidance by default. To enable generated responses, set `OPENAI_API_KEY` in the server's environment. The key stays on the server. `.env.example` is a reference only: the project intentionally does not load `.env` files by itself.

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_MODEL = "gpt-4.1-mini"
npm start
```

Remove the key from the current PowerShell session when finished:

```powershell
Remove-Item Env:OPENAI_API_KEY
Remove-Item Env:OPENAI_MODEL
```

## Server routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Server status and whether optional AI is configured; never returns the key. |
| `GET` | `/api/geocode?name=Delhi` | City search and coordinates. |
| `GET` | `/api/air-quality?latitude=28.6&longitude=77.2` | Current and hourly air-quality model data. |
| `GET` | `/api/forecast?latitude=28.6&longitude=77.2` | Hourly forecast data. |
| `GET` | `/api/demo` | The fixed demo fixture. |
| `POST` | `/api/recommendations` | Contextual plan from the selected air response and preferences. |
| `POST` | `/api/advice` | Optional AI answer or built-in guidance. |

Requests validate city names, coordinates, and JSON bodies. Provider calls have a timeout and return a stable error code on failure. Static files are served from `public/`.

## Tests and checks

Run the automated Node test suite from this directory:

```powershell
npm test
```

The suite covers server routes, provider failures/timeouts, coordinates, recommendations, AI-key and no-key assistant behavior, demo data, AQI scales, zero readings, and missing pollutant values. The project also uses `node --check` for the server and browser JavaScript modules.

## Demo limitations

A working internet connection is needed for live Open-Meteo data, Google Fonts, and the Three.js CDN module. If the 3D module is unavailable, the 2D planet fallback remains usable; if live air data is unavailable, demo mode remains clearly labeled. The indoor room is a conceptual habit visualizer and does not measure indoor conditions. AeroWise is a planning aid, not an official alert service or medical tool. Follow local public-health guidance for health decisions.
