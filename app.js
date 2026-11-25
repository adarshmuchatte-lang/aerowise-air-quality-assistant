import { buildAirViewModel, formatReading, numericReading } from "./air-model.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const state = {
  city: { name: "New Delhi", admin1: "Delhi", country: "India", latitude: 28.6139, longitude: 77.209 },
  air: null,
  mode: "loading",
  preferences: { household: "general household", routine: "mixed routine", hasPurifier: false },
  plannedSwap: false,
  selectedHour: 0,
  airRequest: null,
  searchRequest: null,
  requestId: 0,
  searchId: 0,
  toastTimer: null,
  aiEnabled: false
};

const factors = { car: 0.16152, bus: 0.10151, active: 0 };
const pollutantUi = {
  pm2_5: { value: "#pm25-value", meter: "#meter-pm25", divisor: 100 },
  pm10: { value: "#pm10-value", meter: "#meter-pm10", divisor: 150 },
  nitrogen_dioxide: { value: "#no2-value", meter: "#meter-no2", divisor: 100 },
  ozone: { value: "#ozone-value", meter: "#meter-ozone", divisor: 150 },
  carbon_monoxide: { value: "#co-value", meter: "#meter-co", divisor: 1500 },
  sulphur_dioxide: { value: "#so2-value", meter: "#meter-so2", divisor: 100 }
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
window.showToast = showToast;

function cityKey(city = state.city) {
  return Number(city.latitude).toFixed(4) + ":" + Number(city.longitude).toFixed(4);
}

function cityLabel(city = state.city) {
  return [city.name, city.admin1, city.country].filter((value, index, list) => value && list.indexOf(value) === index).join(", ");
}

function timedSignal(externalSignal, durationMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), durationMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener("abort", onAbort);
    }
  };
}

async function apiJson(url, options = {}, timeoutMs = 14000) {
  const timed = timedSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) },
      signal: timed.signal
    });
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    let body;
    if (!contentType.includes("json")) throw new Error("AeroWise returned an unreadable response.");
    try { body = await response.json(); } catch { throw new Error("AeroWise returned incomplete data."); }
    if (!response.ok) throw new Error(body.error || "The data service could not complete that request.");
    return body;
  } finally {
    timed.cleanup();
  }
}

function setDataState(mode, message = "") {
  state.mode = mode;
  const pill = $("#data-status");
  const labels = {
    loading: "LOADING LIVE",
    refreshing: "REFRESHING",
    live: "LIVE DATA",
    stale: "STALE DATA",
    demo: "DEMO DATA",
    unavailable: "DATA UNAVAILABLE"
  };
  pill.dataset.state = mode;
  $("#data-status-text").textContent = labels[mode] || "DATA UNAVAILABLE";
  const banner = $("#state-banner");
  const showingDemoWhileRefreshing = mode === "refreshing" && state.air?.mode === "demo";
  const shouldShow = mode === "stale" || mode === "demo" || mode === "unavailable" || showingDemoWhileRefreshing;
  banner.hidden = !shouldShow;
  if (shouldShow) {
    $("#state-message").textContent = message || (
      showingDemoWhileRefreshing ? "Live refresh in progress. DEMO DATA remains visible; it is not a real measurement." :
      mode === "demo" ? "Example readings are shown. They are not live environmental measurements." :
      mode === "stale" ? "The latest refresh failed. This location is showing its last valid reading." :
      "Live air data is unavailable. Retry, or choose demo mode."
    );
  }
}

function displayedDataMode() {
  return state.mode === "refreshing" && state.air ? (state.air.mode || "live") : state.mode;
}

function updateLocationLabels() {
  const label = cityLabel();
  $("#location-input").value = label;
  $("#globe-city").textContent = state.city.name;
  $("#instrument-city").textContent = state.city.name.toUpperCase();
  window.aerowiseData = {
    latitude: Number(state.city.latitude),
    longitude: Number(state.city.longitude),
    mode: state.mode
  };
  if (window.AeroWiseScene) window.AeroWiseScene.update(window.aerowiseData);
}

function formatClock(value) {
  if (!value) return "—";
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  if (!match) return String(value);
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  return (hour % 12 || 12) + ":" + minute + " " + suffix;
}

function currentView() {
  return buildAirViewModel(state.air);
}

function renderAir() {
  updateLocationLabels();
  const view = currentView();
  const instrument = $("#aqi-instrument");
  const gauge = $("#aqi-gauge");
  instrument.dataset.level = view.category.level;
  $("#aqi-scale").textContent = view.scale;
  $("#chart-legend-label").textContent = view.scale;
  $("#aqi-value").textContent = formatReading(view.aqi, 0);
  $("#aqi-category").textContent = view.category.label.toUpperCase();
  gauge.setAttribute("aria-label", view.aqi === null ? "Air quality index unavailable" : view.scale + " " + Math.round(view.aqi) + ", " + view.category.label);
  const maximum = view.scale === "European AQI" ? 100 : 500;
  const arc = view.aqi === null ? 0 : Math.max(0, Math.min(1, view.aqi / maximum)) * 270;
  gauge.style.setProperty("--gauge-angle", arc.toFixed(1) + "deg");
  gauge.style.setProperty("--gauge-color", view.category.level === "poor" ? "#ff9a70" : view.category.level === "moderate" ? "#ffd36c" : view.category.level === "good" ? "#73efc7" : "#31546a");

  const headlines = {
    good: "A lower-index air window.",
    moderate: "Plan with the hourly signal.",
    poor: "Keep outdoor plans flexible.",
    unknown: state.mode === "loading" || state.mode === "refreshing" ? "Waiting for air data." : "No index was returned."
  };
  $("#air-headline").textContent = headlines[view.category.level] || headlines.unknown;
  $("#air-summary").textContent = view.hasAnyReading
    ? view.category.guidance + " Values are provider-modeled estimates, not readings from a nearby monitor."
    : state.mode === "unavailable"
      ? "No validated reading is available. Use demo mode to explore the interface, or retry live data."
      : "The live forecast is being checked. Missing measurements will stay blank rather than being guessed.";

  for (const [key, selectors] of Object.entries(pollutantUi)) {
    const value = view.pollutants[key];
    $(selectors.value).textContent = formatReading(value, 1);
    const meter = $(selectors.meter);
    meter.style.width = value === null ? "0%" : Math.max(2, Math.min(100, value / selectors.divisor * 100)) + "%";
    meter.parentElement.hidden = value === null;
  }

  const displayMode = displayedDataMode();
  const sourceNames = { live: "Open-Meteo · live model", stale: "Open-Meteo · previous response", demo: "AeroWise · demo fixture", unavailable: "No validated source", loading: "Waiting for provider", refreshing: "Refreshing provider" };
  $("#source-label").textContent = "SOURCE · " + (sourceNames[displayMode] || "Unavailable").toUpperCase();
  $("#instrument-source").textContent = displayMode === "live" ? "LIVE MODEL" : displayMode === "stale" ? "LAST VALID MODEL" : displayMode === "demo" ? "DEMO DATA" : "DATA UNAVAILABLE";
  $("#updated-at").textContent = "LAST UPDATE · " + (state.air?.observedAt ? formatClock(state.air.observedAt) + " · " + (state.air.timezone || "LOCAL") : "—");
  $("#globe-air-label").textContent = displayMode === "live" ? "Live modeled forecast · " + formatClock(state.air?.observedAt) : displayMode === "stale" ? "Previous validated forecast" : displayMode === "demo" ? "Clearly labeled example readings" : "Waiting for verified forecast";
  renderRoom();
}

function forecastPoints() {
  if (!state.air || !state.air.hourly) return [];
  const view = currentView();
  const key = view.scale === "European AQI" ? "european_aqi" : "us_aqi";
  const times = Array.isArray(state.air.hourly.time) ? state.air.hourly.time : [];
  const values = Array.isArray(state.air.hourly[key]) ? state.air.hourly[key] : [];
  const currentTime = state.air.current?.time || state.air.observedAt || "";
  let start = times.findIndex((time) => time >= currentTime);
  if (start < 0) start = 0;
  const points = [];
  for (let index = start; index < Math.min(times.length, start + 12); index++) {
    const value = numericReading(values[index]);
    if (value !== null) points.push({ time: times[index], value, sourceIndex: index });
  }
  return points;
}

function svgNode(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function showSelectedHour(point, index) {
  state.selectedHour = index;
  $("#selected-hour-value").textContent = formatReading(point.value, 0) + " " + currentView().scale;
  $("#selected-hour-time").textContent = formatClock(point.time);
  const selected = $("#selected-hour");
  selected.classList.add("has-selection");
  selected.querySelector("span:nth-child(2)").textContent = "SELECTED FORECAST POINT";
  $("#forecast-chart").querySelectorAll(".chart-point").forEach((item) => {
    item.classList.toggle("selected", Number(item.dataset.index) === index);
  });
}

function drawChart() {
  const chart = $("#forecast-chart");
  const ticks = $("#chart-ticks");
  const points = forecastPoints();
  chart.replaceChildren();
  ticks.replaceChildren();
  const displayMode = displayedDataMode();
  if (!points.length) {
    const message = svgNode("text", { x: 500, y: 125, "text-anchor": "middle", class: "chart-empty-label" });
    message.textContent = state.mode === "loading" || state.mode === "refreshing" ? "Waiting for hourly forecast…" : "No hourly forecast values are available.";
    chart.append(message);
    $("#forecast-status").textContent = displayMode === "demo" ? "DEMO FORECAST UNAVAILABLE" : "HOURLY FORECAST UNAVAILABLE";
    $("#forecast-peak").textContent = "LOWEST POINT · —";
    $("#selected-hour-value").textContent = "—";
    $("#selected-hour-time").textContent = "—";
    $("#selected-hour").classList.remove("has-selection");
    for (const label of ["NOW", "—", "—", "—", "—", "—"]) {
      const tick = document.createElement("span");
      tick.textContent = label;
      ticks.append(tick);
    }
    return;
  }

  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const padding = Math.max(10, (max - min) * 0.22);
  const low = Math.max(0, min - padding);
  const high = max + padding;
  const xAt = (index) => 22 + (956 * index / Math.max(1, points.length - 1));
  const yAt = (value) => 214 - ((value - low) / Math.max(1, high - low)) * 174;
  const coordinates = points.map((point, index) => [xAt(index), yAt(point.value)]);
  const pathData = coordinates.map((point, index) => (index ? "L" : "M") + point[0].toFixed(1) + "," + point[1].toFixed(1)).join(" ");
  const gradient = svgNode("linearGradient", { id: "forecast-fill", x1: "0", x2: "0", y1: "0", y2: "1" });
  gradient.append(svgNode("stop", { offset: "0%", "stop-color": "#66e7ff", "stop-opacity": ".2" }));
  gradient.append(svgNode("stop", { offset: "100%", "stop-color": "#66e7ff", "stop-opacity": "0" }));
  const defs = svgNode("defs");
  defs.append(gradient);
  chart.append(defs);
  for (let index = 0; index < 4; index++) {
    const y = 36 + index * 57;
    chart.append(svgNode("line", { x1: 20, y1: y, x2: 980, y2: y, class: "chart-grid-line" }));
  }
  const area = pathData + " L 978,214 L 22,214 Z";
  chart.append(svgNode("path", { d: area, class: "chart-area" }));
  chart.append(svgNode("path", { d: pathData, class: "chart-line" }));
  const pointsGroup = svgNode("g", { class: "chart-points" });
  points.forEach((point, index) => {
    const circle = svgNode("circle", {
      cx: coordinates[index][0],
      cy: coordinates[index][1],
      r: 10,
      class: "chart-point",
      "data-index": index,
      role: "button",
      tabindex: "0",
      "aria-label": formatClock(point.time) + ": " + Math.round(point.value) + " " + currentView().scale
    });
    circle.addEventListener("click", () => showSelectedHour(point, index));
    circle.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showSelectedHour(point, index);
      }
    });
    pointsGroup.append(circle);
  });
  chart.append(pointsGroup);

  const lowest = points.reduce((best, point) => point.value < best.value ? point : best, points[0]);
  $("#forecast-status").textContent = points.length + " hourly points · " + (displayMode === "demo" ? "DEMO DATA" : displayMode === "stale" ? "STALE DATA" : "PROVIDER FORECAST");
  $("#forecast-peak").textContent = "LOWEST POINT · " + formatClock(lowest.time);
  const indexes = Array.from({ length: 6 }, (_, index) => Math.round((points.length - 1) * index / 5));
  indexes.forEach((pointIndex, index) => {
    const tick = document.createElement("span");
    tick.textContent = index === 0 ? "NOW" : formatClock(points[pointIndex].time);
    ticks.append(tick);
  });
  const initialIndex = Math.min(state.selectedHour, points.length - 1);
  showSelectedHour(points[initialIndex], initialIndex);
}

function renderRecommendations(payload) {
  const grid = $("#recommendation-grid");
  grid.replaceChildren();
  const context = payload.context || "General guidance.";
  $("#recommendation-context").textContent = context;
  for (const [index, item] of (payload.recommendations || []).entries()) {
    const card = document.createElement("article");
    card.className = "recommendation-card";
    const number = document.createElement("span");
    number.className = "recommendation-number";
    number.textContent = "0" + (index + 1);
    const type = document.createElement("span");
    type.className = "recommendation-type";
    type.textContent = item.category || "AIR PLAN";
    const heading = document.createElement("h3");
    heading.textContent = item.title || "A small next step";
    const body = document.createElement("p");
    body.textContent = item.body || "Keep plans flexible and check local guidance.";
    card.append(number, type, heading, body);
    grid.append(card);
  }
  if (!payload.recommendations?.length) {
    const empty = document.createElement("div");
    empty.className = "recommendation-empty";
    const text = document.createElement("p");
    text.textContent = "No recommendations are available yet. Retry the plan.";
    empty.append(text);
    grid.append(empty);
  }
}

async function updatePlan({ announce = false } = {}) {
  state.preferences = {
    household: $("#household-select").value,
    routine: $("#routine-select").value,
    hasPurifier: $("#purifier-select").checked
  };
  try { localStorage.setItem("aerowise-preferences", JSON.stringify(state.preferences)); } catch { /* Browser storage may be disabled. */ }
  const button = $("#update-plan");
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = "UPDATING PLAN…";
  try {
    const result = await apiJson("/api/recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city: cityLabel(), air: state.air ? { ...state.air, mode: state.mode } : { mode: "unavailable" }, preferences: state.preferences })
    });
    renderRecommendations(result);
    syncSavedPlan();
    if (announce) showToast("Your air plan is updated.");
  } catch (error) {
    console.warn("[AeroWise] Recommendation service:", error.message);
    renderRecommendations({
      context: state.air ? "Local fallback plan · " + (state.mode === "demo" ? "demo data" : "last available data") : "General guidance · no validated location data yet.",
      recommendations: [
        { category: "TIMING", title: "Keep plans flexible", body: "Check a trusted local air-quality source before longer outdoor activity." },
        { category: "AT HOME", title: "Reduce indoor smoke", body: "Use an exhaust fan while cooking if one is available and safe." },
        { category: "ROUTINE", title: "Compare one shared trip", body: "If it suits your route, compare transit, carpooling, or combining errands." }
      ]
    });
    syncSavedPlan();
  } finally {
    button.disabled = false;
    button.textContent = previous;
  }
}

function syncSavedPlan() {
  const button = $("#save-plan");
  if (!button) return;
  button.setAttribute("aria-pressed", String(state.plannedSwap));
  button.innerHTML = state.plannedSwap ? 'SAVED TO MY DAY <span>✓</span>' : 'ADD THIS PLAN TO MY DAY <span>↗</span>';
  $("#plan-saved-copy").textContent = state.plannedSwap
    ? "Saved on this device · " + state.city.name
    : "The plan is stored on this device only.";
}

function toggleSavedPlan() {
  state.plannedSwap = !state.plannedSwap;
  try {
    if (state.plannedSwap) {
      localStorage.setItem("aerowise-saved-plan", JSON.stringify({
        city: state.city.name,
        mode: state.mode,
        savedAt: new Date().toISOString()
      }));
    } else {
      localStorage.removeItem("aerowise-saved-plan");
    }
  } catch { /* Browser storage may be disabled. */ }
  syncSavedPlan();
  showToast(state.plannedSwap ? "Your plan is saved on this device." : "Your saved plan was removed.");
}

async function shareUpdate() {
  const view = currentView();
  const best = forecastPoints().reduce((lowest, point) => !lowest || point.value < lowest.value ? point : lowest, null);
  const status = state.mode === "live" ? "LIVE MODELED DATA"
    : state.mode === "stale" ? "STALE MODELED DATA"
      : state.mode === "demo" ? "DEMO DATA · EXAMPLE ONLY"
        : "DATA UNAVAILABLE";
  const reading = view.aqi === null ? "AQI unavailable" : view.scale + " " + Math.round(view.aqi) + " · " + view.category.label;
  const timing = best ? " Lowest forecast point: " + formatClock(best.time) + "." : "";
  const message = "AeroWise air update for " + cityLabel() + ": " + reading + ". " + status + "." + timing + " Provider values are modeled estimates, not a nearby monitor reading.";
  try {
    if (navigator.share) {
      await navigator.share({ title: "AeroWise air update", text: message });
      showToast("Air update shared.");
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(message);
      showToast("Air update copied. You can paste it into a message.");
    } else {
      showToast(message);
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Could not share the air update just now.");
  }
}

function renderSearchResults(results, message) {
  const list = $("#search-results");
  list.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = message || "No matching places. Try a city and country.";
    list.append(empty);
    list.hidden = false;
    return;
  }
  for (const city of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    button.setAttribute("role", "option");
    const title = document.createElement("strong");
    title.textContent = city.name;
    const detail = document.createElement("small");
    detail.textContent = [city.admin1, city.country].filter(Boolean).join(", ");
    button.append(title, detail);
    button.addEventListener("click", () => chooseLocation(city));
    list.append(button);
  }
  list.hidden = false;
}

async function searchCities(query) {
  state.searchRequest?.abort();
  const controller = new AbortController();
  state.searchRequest = controller;
  const id = ++state.searchId;
  try {
    const body = await apiJson("/api/geocode?name=" + encodeURIComponent(query), { signal: controller.signal }, 9000);
    if (id !== state.searchId) return;
    renderSearchResults(body.results || [], body.results?.length ? "" : "No matching cities found.");
  } catch (error) {
    if (id !== state.searchId) return;
    console.warn("[AeroWise] City search:", error.message);
    renderSearchResults([], error.message.includes("No matching city") ? error.message : "City search is unavailable. Check your connection and retry.");
  } finally {
    if (state.searchRequest === controller) state.searchRequest = null;
  }
}

async function chooseLocation(location) {
  const latitude = numericReading(location.latitude);
  const longitude = numericReading(location.longitude);
  if (latitude === null || longitude === null) {
    showToast("That place did not include usable coordinates.");
    return;
  }
  state.city = {
    name: location.name || "Selected location",
    admin1: location.admin1 || "",
    country: location.country || "",
    latitude,
    longitude
  };
  state.air = null;
  state.selectedHour = 0;
  $("#search-results").hidden = true;
  renderAir();
  drawChart();
  $("#recommendation-context").textContent = "Waiting for verified air data for " + cityLabel() + ".";
  $("#recommendation-grid").replaceChildren();
  await loadForecast();
}

async function loadForecast() {
  state.airRequest?.abort();
  const controller = new AbortController();
  state.airRequest = controller;
  const id = ++state.requestId;
  const hasSameLocationData = Boolean(state.air && (state.mode === "live" || state.mode === "stale") && state.air.location &&
    Number(state.air.location.latitude).toFixed(4) === Number(state.city.latitude).toFixed(4) &&
    Number(state.air.location.longitude).toFixed(4) === Number(state.city.longitude).toFixed(4));
  setDataState(state.air ? "refreshing" : "loading", "Refreshing the live forecast…");
  $("#refresh-button").classList.add("spinning");
  renderAir();
  drawChart();
  try {
    const query = new URLSearchParams({ latitude: String(state.city.latitude), longitude: String(state.city.longitude) });
    const data = await apiJson("/api/air-quality?" + query, { signal: controller.signal }, 14000);
    if (id !== state.requestId) return;
    data.mode = "live";
    if (!data.current || typeof data.current !== "object") throw new Error("The live response did not include current readings.");
    state.air = data;
    state.selectedHour = 0;
    setDataState("live");
    renderAir();
    drawChart();
    await updatePlan();
  } catch (error) {
    if (id !== state.requestId) return;
    if (controller.signal.aborted && state.airRequest !== controller) return;
    console.warn("[AeroWise] Live air request:", error.message);
    if (hasSameLocationData && state.air) {
      state.air.mode = "stale";
      setDataState("stale", "The latest refresh failed. Showing the last valid reading for " + cityLabel() + ".");
      renderAir();
      drawChart();
      await updatePlan();
    } else if (state.air && state.mode === "demo") {
      setDataState("demo", "Live data could not be reached. DEMO DATA remains visible; it is not a real measurement.");
      renderAir();
      drawChart();
      await updatePlan();
    } else {
      setDataState("loading", "Live service unavailable. Loading the clearly labeled demo fixture…");
      await loadDemo({ requestId: id, reason: error.message });
    }
  } finally {
    if (id === state.requestId) {
      $("#refresh-button").classList.remove("spinning");
      if (state.airRequest === controller) state.airRequest = null;
    }
  }
}

async function loadDemo({ requestId = state.requestId, reason = "", allowReplace = false } = {}) {
  try {
    const data = await apiJson("/api/demo", {}, 5000);
    if (requestId !== state.requestId) return;
    if (state.air && state.mode === "live" && !allowReplace) return;
    state.air = data;
    state.selectedHour = 0;
    setDataState("demo", reason
      ? "Live air data could not load. Clearly labeled DEMO DATA is shown as an example. " + "Retry live data at any time."
      : "DEMO DATA is a fixed example forecast, not a real-time environmental measurement.");
    renderAir();
    drawChart();
    await updatePlan();
  } catch (error) {
    if (requestId !== state.requestId) return;
    console.warn("[AeroWise] Demo fixture:", error.message);
    state.air = null;
    setDataState("unavailable", "Live air data and the local demo fixture could not load. Check the server, then retry.");
    renderAir();
    drawChart();
    await updatePlan();
  }
}

async function onLocationSubmit(event) {
  event.preventDefault();
  const query = $("#location-input").value.trim();
  if (query.length < 2) return showToast("Enter at least two letters to search for a city.");
  $("#search-results").hidden = false;
  renderSearchResults([], "Searching for cities…");
  await searchCities(query);
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    showToast("This browser does not provide location access. Search for a city instead.");
    return;
  }
  const button = $("#use-location");
  button.disabled = true;
  button.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(async (position) => {
    await chooseLocation({
      name: "My location",
      admin1: "",
      country: "",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    });
    button.disabled = false;
    button.innerHTML = '<span class="crosshair">⌖</span> Use my location';
  }, (error) => {
    button.disabled = false;
    button.innerHTML = '<span class="crosshair">⌖</span> Use my location';
    const messages = {
      1: "Location permission was not granted. You can search for a city instead.",
      2: "Your location could not be determined. Search for a city instead.",
      3: "Location lookup timed out. Search for a city instead."
    };
    showToast(messages[error.code] || "Location is unavailable. Search for a city instead.");
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}

function renderRoom() {
  const scene = $("#room-scene");
  const windowOpen = scene.dataset.window === "open";
  const ventilationOn = scene.dataset.ventilation === "on";
  const purifierOn = scene.dataset.purifier === "on";
  const windowToggle = $("#window-toggle");
  const ventilationToggle = $("#ventilation-toggle");
  const purifierToggle = $("#room-purifier-toggle");
  windowToggle.setAttribute("aria-pressed", String(windowOpen));
  windowToggle.setAttribute("aria-label", windowOpen ? "Close window" : "Open window");
  ventilationToggle.setAttribute("aria-pressed", String(ventilationOn));
  ventilationToggle.setAttribute("aria-label", ventilationOn ? "Turn ventilation off" : "Turn ventilation on");
  purifierToggle.setAttribute("aria-pressed", String(purifierOn));
  purifierToggle.setAttribute("aria-label", purifierOn ? "Turn purifier off" : "Turn purifier on");
  $("#window-state-copy").textContent = windowOpen ? "Open · outdoor air enters this concept scene" : "Closed · outdoor airflow is reduced in this concept";
  $("#ventilation-state-copy").textContent = ventilationOn ? "On · conceptual airflow is visible" : "Off · no airflow animation";
  $("#purifier-state-copy").textContent = purifierOn ? "On · illustrative only, no measured effect" : "Off · room scene only";
  const view = currentView();
  const poor = view.category.level === "poor";
  const advice = [];
  if (windowOpen) {
    advice.push(poor
      ? "The outdoor forecast is elevated. Close the window if that is safe and comfortable; ventilation does not guarantee cleaner indoor air."
      : "Opening a window can bring in outdoor air. The scene cannot measure indoor or outdoor conditions.");
  } else {
    advice.push(poor
      ? "Outdoor modeled air is elevated. Keeping windows closed may reduce outdoor air entry when safe and comfortable."
      : "Keep one comfortable room smoke-free. Ventilate during cooking if possible and safe.");
  }
  if (ventilationOn) advice.push("Use a kitchen or bathroom exhaust fan for its intended purpose, when available.");
  if (purifierOn) advice.push("Follow the purifier's filter and room-size instructions; the visualization shows no measured cleaning effect.");
  $("#room-guidance").textContent = advice.join(" ");
}

function updateCalculator() {
  const distance = Math.max(0, numericReading($("#trip-distance").value) || 0);
  const trips = Math.max(0, numericReading($("#trip-count").value) || 0);
  const weeklyKm = distance * 2 * trips;
  const before = weeklyKm * factors[$("#trip-from").value];
  const after = weeklyKm * factors[$("#trip-to").value];
  const saved = before - after;
  const format = (value) => new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  $("#emissions-before").textContent = format(before);
  $("#emissions-after").textContent = format(after);
  $("#emissions-saved").textContent = (saved < 0 ? "−" : "") + format(Math.abs(saved));
  $("#emissions-saved").parentElement.dataset.direction = saved < 0 ? "increase" : saved > 0 ? "saving" : "same";
}

async function askAssistant(questionOverride) {
  const input = $("#assistant-question");
  const answer = $("#assistant-answer");
  const question = (questionOverride || input.value || "What should I keep in mind today?").trim();
  answer.hidden = false;
  answer.classList.remove("error");
  answer.textContent = "Preparing a context-aware answer…";
  $("#assistant-send").disabled = true;
  $("#assistant-status").textContent = "THINKING…";
  try {
    const result = await apiJson("/api/advice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        city: cityLabel(),
        air: state.air ? { ...state.air, mode: state.mode } : { mode: "unavailable" },
        preferences: state.preferences
      })
    }, 20000);
    answer.textContent = result.answer;
    $("#assistant-status").textContent = result.mode === "ai" ? "AI ANSWER · SERVER KEY ACTIVE" : "BUILT-IN GUIDE · NO KEY REQUIRED";
    input.value = "";
  } catch (error) {
    console.warn("[AeroWise] Assistant:", error.message);
    answer.textContent = state.mode === "live"
      ? "The assistant service is unavailable right now. Your live forecast is still shown above. Try again, or use the daily protocol for a quick plan."
      : "The assistant service is unavailable right now. General tip: check local air guidance before strenuous outdoor plans, and keep one room free of indoor smoke.";
    answer.classList.add("error");
    $("#assistant-status").textContent = "ASSISTANT TEMPORARILY UNAVAILABLE";
  } finally {
    $("#assistant-send").disabled = false;
  }
}

function enterExperience() {
  const screen = $("#entry-screen");
  if (!screen) return;
  screen.classList.add("done");
  screen.setAttribute("aria-hidden", "true");
  try { sessionStorage.setItem("aerowise-entry-seen", "1"); } catch { /* Session storage may be disabled. */ }
}

function initNav() {
  const menu = $("#menu-toggle");
  const nav = $("#main-nav");
  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  });
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
    nav.querySelectorAll("a").forEach((item) => item.classList.toggle("active", item === link));
  }));
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      const current = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!current) return;
      nav.querySelectorAll("a").forEach((link) => link.classList.toggle("active", link.hash === "#" + current.target.id));
    }, { rootMargin: "-20% 0px -65% 0px", threshold: [0, .1, .4] });
    nav.querySelectorAll("a").forEach((link) => {
      const section = $(link.hash);
      if (section) observer.observe(section);
    });
  }
}

function init() {
  document.body.classList.add("js-ready");
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  $("#today-date").textContent = date.toUpperCase() + " · ENVIRONMENTAL TELEMETRY";
  try {
    const saved = JSON.parse(localStorage.getItem("aerowise-preferences") || "null");
    if (saved && typeof saved === "object") state.preferences = { ...state.preferences, ...saved };
  } catch { /* Ignore old or unavailable storage. */ }
  try {
    const savedPlan = JSON.parse(localStorage.getItem("aerowise-saved-plan") || "null");
    state.plannedSwap = Boolean(savedPlan);
  } catch { /* Ignore old or unavailable storage. */ }
  $("#household-select").value = state.preferences.household;
  $("#routine-select").value = state.preferences.routine;
  $("#purifier-select").checked = Boolean(state.preferences.hasPurifier);

  $("#location-form").addEventListener("submit", onLocationSubmit);
  $("#location-input").addEventListener("input", () => {
    state.searchRequest?.abort();
    state.searchId++;
    $("#search-results").hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".location-form")) $("#search-results").hidden = true;
  });
  $("#refresh-button").addEventListener("click", () => loadForecast());
  $("#retry-live").addEventListener("click", () => loadForecast());
  $("#show-demo").addEventListener("click", () => {
    state.requestId++;
    state.airRequest?.abort();
    loadDemo({ requestId: state.requestId, allowReplace: true });
  });
  $("#use-location").addEventListener("click", useCurrentLocation);
  $("#update-plan").addEventListener("click", () => updatePlan({ announce: true }));
  $("#save-plan").addEventListener("click", toggleSavedPlan);
  $("#share-update").addEventListener("click", shareUpdate);
  $("#window-toggle").addEventListener("click", () => {
    $("#room-scene").dataset.window = $("#room-scene").dataset.window === "open" ? "closed" : "open";
    renderRoom();
  });
  $("#ventilation-toggle").addEventListener("click", () => {
    $("#room-scene").dataset.ventilation = $("#room-scene").dataset.ventilation === "on" ? "off" : "on";
    renderRoom();
  });
  $("#room-purifier-toggle").addEventListener("click", () => {
    $("#room-scene").dataset.purifier = $("#room-scene").dataset.purifier === "on" ? "off" : "on";
    renderRoom();
  });
  ["trip-distance", "trip-count", "trip-from", "trip-to"].forEach((id) => $("#" + id).addEventListener("input", updateCalculator));
  ["trip-from", "trip-to"].forEach((id) => $("#" + id).addEventListener("change", updateCalculator));
  $("#assistant-form").addEventListener("submit", (event) => {
    event.preventDefault();
    askAssistant();
  });
  document.querySelectorAll("[data-ask]").forEach((button) => button.addEventListener("click", () => {
    const question = button.dataset.ask;
    $("#assistant-question").value = question;
    askAssistant(question);
  }));
  $("#assistant-reset").addEventListener("click", () => {
    $("#assistant-question").value = "";
    $("#assistant-answer").hidden = true;
    $("#assistant-answer").textContent = "";
    $("#assistant-status").textContent = "BUILT-IN GUIDE READY";
  });
  $("#entry-skip").addEventListener("click", enterExperience);
  $("#forecast-chart").addEventListener("keydown", (event) => {
    if (event.target.classList.contains("chart-point") && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      const points = forecastPoints();
      const next = Math.max(0, Math.min(points.length - 1, Number(event.target.dataset.index) + (event.key === "ArrowRight" ? 1 : -1)));
      $("#forecast-chart").querySelector('[data-index="' + next + '"]')?.focus();
    }
  });
  initNav();
  renderAir();
  drawChart();
  renderRoom();
  updateCalculator();
  const globeData = { latitude: state.city.latitude, longitude: state.city.longitude, mode: "loading" };
  window.aerowiseData = globeData;
  import("./globe.js").catch((error) => console.info("[AeroWise] 3D view uses its fallback:", error.message));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) enterExperience();
  else {
    try {
      if (sessionStorage.getItem("aerowise-entry-seen") === "1") enterExperience();
      else setTimeout(enterExperience, 1750);
    } catch { setTimeout(enterExperience, 1750); }
  }
  apiJson("/api/health", {}, 5000).then((health) => {
    state.aiEnabled = Boolean(health.aiEnabled);
    $("#assistant-status").textContent = state.aiEnabled ? "OPTIONAL SERVER AI READY" : "BUILT-IN GUIDE READY";
  }).catch((error) => console.warn("[AeroWise] Health check:", error.message));
  loadForecast();
}

init();
