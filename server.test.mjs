import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createServer, configuredPort, startupErrorMessage } from "../server.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const liveAirFixture = {
  latitude: 28.61,
  longitude: 77.21,
  timezone: "Asia/Kolkata",
  current_units: { us_aqi: "USAQI", pm2_5: "μg/m³" },
  current: { time: "2026-11-25T15:00", us_aqi: 112, european_aqi: 54, pm2_5: 28.5, pm10: 40, nitrogen_dioxide: 10, ozone: 72, carbon_monoxide: 300, sulphur_dioxide: 4 },
  hourly_units: { us_aqi: "USAQI", pm2_5: "μg/m³" },
  hourly: {
    time: Array.from({ length: 24 }, (_, i) => "2026-11-25T" + String(i).padStart(2, "0") + ":00"),
    us_aqi: Array.from({ length: 24 }, (_, i) => 112 - i),
    european_aqi: Array.from({ length: 24 }, (_, i) => 54 - Math.floor(i / 2)),
    pm2_5: Array.from({ length: 24 }, (_, i) => 28.5 - i * .2)
  }
};

async function harness(t, options = {}) {
  const defaultFetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "geocoding-api.open-meteo.com") {
      const name = parsed.searchParams.get("name");
      return jsonResponse({ results: name === "No Such City" ? [] : [{ name: "Delhi", admin1: "Delhi", country: "India", latitude: 28.61, longitude: 77.21 }] });
    }
    return jsonResponse(liveAirFixture);
  };
  const server = createServer({
    fetchImpl: options.fetchImpl || defaultFetch,
    env: options.env || {},
    providerTimeoutMs: options.providerTimeoutMs || 100,
    aiTimeoutMs: 100,
    logger: { error() {} }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  return { base };
}

async function getJson(url) {
  const response = await fetch(url);
  return { response, body: await response.json() };
}

test("server starts and serves the homepage with a useful content type", async (t) => {
  const { base } = await harness(t);
  const response = await fetch(base + "/");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(html, /AeroWise/);
  assert.match(html, /app\.js/);
});

test("static JavaScript and CSS assets are served", async (t) => {
  const { base } = await harness(t);
  const script = await fetch(base + "/app.js");
  const css = await fetch(base + "/styles.css");
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.match(await script.text(), /loadForecast|refreshLiveData/);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
});

test("health endpoint reports services without exposing a key", async (t) => {
  const { base } = await harness(t, { env: { OPENAI_API_KEY: "secret-test-key" } });
  const { response, body } = await getJson(base + "/api/health");
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.aiEnabled, true);
  assert.deepEqual(body.services, { airQuality: "Open-Meteo", geocoding: "Open-Meteo" });
  assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
});

test("city search returns coordinates and handles invalid and missing cities", async (t) => {
  const { base } = await harness(t);
  const found = await getJson(base + "/api/geocode?name=Delhi");
  assert.equal(found.response.status, 200);
  assert.equal(found.body.results[0].latitude, 28.61);
  assert.equal(found.body.results[0].longitude, 77.21);
  const missing = await getJson(base + "/api/geocode");
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.code, "INVALID_CITY_QUERY");
  const unknown = await getJson(base + "/api/geocode?name=No%20Such%20City");
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.code, "CITY_NOT_FOUND");
});

test("air-quality and forecast endpoints return their documented shapes", async (t) => {
  const { base } = await harness(t);
  const air = await getJson(base + "/api/air-quality?latitude=28.6&longitude=77.2");
  assert.equal(air.response.status, 200);
  assert.equal(air.body.mode, "live");
  assert.equal(air.body.source, "Open-Meteo Air Quality API");
  assert.equal(air.body.current.us_aqi, 112);
  assert.equal(air.body.hourly.time.length, 24);
  assert.equal(air.body.observedAt, "2026-11-25T15:00");
  const forecast = await getJson(base + "/api/forecast?latitude=28.6&longitude=77.2");
  assert.equal(forecast.response.status, 200);
  assert.equal(forecast.body.mode, "live");
  assert.equal(forecast.body.hourly.us_aqi[0], 112);
  assert.equal("current" in forecast.body, false);
});

test("coordinates are range-checked while zero remains valid", async (t) => {
  const { base } = await harness(t);
  const missing = await getJson(base + "/api/air-quality");
  const invalid = await getJson(base + "/api/forecast?latitude=91&longitude=0");
  const zero = await getJson(base + "/api/air-quality?latitude=0&longitude=0");
  assert.equal(missing.response.status, 400);
  assert.equal(missing.body.code, "MISSING_COORDINATES");
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.code, "INVALID_COORDINATES");
  assert.equal(zero.response.status, 200);
});

test("provider timeouts, HTTP errors, and invalid JSON become clear JSON errors", async (t) => {
  const timeoutHarness = await harness(t, {
    providerTimeoutMs: 15,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  const timeout = await getJson(timeoutHarness.base + "/api/air-quality?latitude=0&longitude=0");
  assert.equal(timeout.response.status, 504);
  assert.equal(timeout.body.code, "PROVIDER_TIMEOUT");

  const errorHarness = await harness(t, { fetchImpl: async () => jsonResponse({ error: "private provider detail" }, 503) });
  const upstreamError = await getJson(errorHarness.base + "/api/air-quality?latitude=0&longitude=0");
  assert.equal(upstreamError.response.status, 502);
  assert.equal(upstreamError.body.code, "PROVIDER_ERROR");
  assert.equal(upstreamError.body.error.includes("private provider detail"), false);

  const badJsonHarness = await harness(t, {
    fetchImpl: async () => new Response("<html>not json</html>", { status: 200, headers: { "Content-Type": "text/html" } })
  });
  const badJson = await getJson(badJsonHarness.base + "/api/air-quality?latitude=0&longitude=0");
  assert.equal(badJson.response.status, 502);
  assert.equal(badJson.body.code, "PROVIDER_BAD_CONTENT");
});

test("deterministic demo fixture is separately served and labeled", async (t) => {
  const { base } = await harness(t);
  const { response, body } = await getJson(base + "/api/demo");
  assert.equal(response.status, 200);
  assert.equal(body.mode, "demo");
  assert.equal(body.source, "AeroWise deterministic demo fixture");
  assert.equal(body.current.us_aqi, 106);
  assert.equal(body.hourly.us_aqi.length, 48);
  assert.notEqual(body.current.time, null);
});

test("recommendations use live context and clearly mark demo or general advice", async (t) => {
  const { base } = await harness(t);
  const live = await fetch(base + "/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city: "Delhi", air: { ...liveAirFixture, mode: "live" }, preferences: { routine: "office commute by car" } })
  });
  const liveBody = await live.json();
  assert.equal(live.status, 200);
  assert.equal(liveBody.locationSpecific, true);
  assert.match(liveBody.context, /Delhi/);
  assert.equal(liveBody.recommendations.length, 3);

  const general = await fetch(base + "/api/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city: "Delhi", air: { mode: "unavailable" } })
  });
  const generalBody = await general.json();
  assert.equal(generalBody.mode, "general");
  assert.equal(generalBody.locationSpecific, false);
  assert.match(generalBody.context, /General suggestions/);
});

test("assistant works without an API key using honest built-in guidance", async (t) => {
  const { base } = await harness(t);
  const response = await fetch(base + "/api/advice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "How should I plan a walk?", city: "Delhi", air: { mode: "unavailable" } })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "local");
  assert.match(body.answer, /general guidance/);
  assert.match(body.answer, /strenuous outdoor plans/);
});

test("configured assistant calls the Responses API and returns its text", async (t) => {
  let authHeader;
  const { base } = await harness(t, {
    env: { OPENAI_API_KEY: "test-only-key", OPENAI_MODEL: "test-model" },
    fetchImpl: async (_url, init) => {
      authHeader = init.headers.Authorization;
      return jsonResponse({ output_text: "Keep outdoor plans flexible." });
    }
  });
  const response = await fetch(base + "/api/advice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What should I do?" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "ai");
  assert.equal(body.answer, "Keep outdoor plans flexible.");
  assert.equal(authHeader, "Bearer test-only-key");
  assert.equal(JSON.stringify(body).includes("test-only-key"), false);
});

test("port configuration accepts valid values and rejects invalid values", () => {
  assert.equal(configuredPort({ PORT: "4174" }), 4174);
  assert.equal(configuredPort({ PORT: "0" }), 0);
  assert.throws(() => configuredPort({ PORT: "not-a-port" }), /PORT must be an integer/);
});

test("port conflicts report a Windows check and alternate-port command", async () => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const port = occupied.address().port;
  const candidate = createServer({ logger: { error() {} } });
  const conflict = await new Promise((resolve) => {
    candidate.once("error", resolve);
    candidate.listen(port, "127.0.0.1");
  });
  assert.equal(conflict.code, "EADDRINUSE");
  assert.match(startupErrorMessage(conflict, port), new RegExp("Port " + port + " is already in use"));
  assert.match(startupErrorMessage(conflict, port), /Get-NetTCPConnection/);
  assert.match(startupErrorMessage(conflict, port), /PORT=4174/);
  await new Promise((resolve) => occupied.close(resolve));
});
