import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(projectRoot, "public");
const demoPath = path.join(projectRoot, "fixtures", "demo-air.json");
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const CURRENT_FIELDS = "us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide";
const HOURLY_FIELDS = "us_aqi,european_aqi,pm2_5";
const DEFAULT_PORT = 4173;
const DEFAULT_PROVIDER_TIMEOUT_MS = 10000;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function text(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache"
  });
  response.end(body);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateCoordinates(url) {
  const latitude = finiteNumber(url.searchParams.get("latitude"));
  const longitude = finiteNumber(url.searchParams.get("longitude"));
  if (latitude === null || longitude === null) {
    throw new HttpError(400, "MISSING_COORDINATES", "Choose a location with valid coordinates.");
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new HttpError(400, "INVALID_COORDINATES", "Those coordinates are outside the valid range.");
  }
  return { latitude, longitude };
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 40000) throw new HttpError(413, "BODY_TOO_LARGE", "That request is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "The request could not be read. Please try again.");
  }
}

async function providerJson(fetchImpl, url, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new HttpError(504, "PROVIDER_TIMEOUT", "The live data service took too long to respond.");
    }
    throw new HttpError(502, "PROVIDER_UNAVAILABLE", "The live data service could not be reached.");
  }
  if (!response.ok) {
    throw new HttpError(502, "PROVIDER_ERROR", "The live data service returned an error.");
  }
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("json")) {
    throw new HttpError(502, "PROVIDER_BAD_CONTENT", "The live data service returned an unreadable response.");
  }
  try {
    return await response.json();
  } catch {
    throw new HttpError(502, "PROVIDER_INVALID_JSON", "The live data service returned incomplete data.");
  }
}

function airUrl(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: CURRENT_FIELDS,
    hourly: HOURLY_FIELDS,
    forecast_days: "2",
    timezone: "auto"
  });
  return AIR_URL + "?" + params.toString();
}

async function getAirData(fetchImpl, latitude, longitude, timeoutMs) {
  const body = await providerJson(fetchImpl, airUrl(latitude, longitude), timeoutMs);
  if (!body || !body.current || !body.hourly || !Array.isArray(body.hourly.time)) {
    throw new HttpError(502, "PROVIDER_INCOMPLETE", "The live forecast did not include the expected fields.");
  }
  return {
    mode: "live",
    source: "Open-Meteo Air Quality API",
    location: {
      latitude: finiteNumber(body.latitude) ?? latitude,
      longitude: finiteNumber(body.longitude) ?? longitude
    },
    timezone: body.timezone || "UTC",
    observedAt: body.current.time || null,
    current: body.current,
    currentUnits: body.current_units || {},
    hourly: body.hourly,
    hourlyUnits: body.hourly_units || {}
  };
}

function safeString(value, fallback, maxLength = 120) {
  return String(value || fallback).trim().slice(0, maxLength);
}

function bestForecastHour(air) {
  const hourly = air && air.hourly || {};
  const scale = finiteNumber(air && air.current && air.current.us_aqi) !== null ? "us_aqi" : "european_aqi";
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const values = Array.isArray(hourly[scale]) ? hourly[scale] : [];
  const now = air && air.current && air.current.time || "";
  let start = times.findIndex((time) => time >= now);
  if (start < 0) start = 0;
  let best = null;
  for (let index = start; index < Math.min(times.length, start + 12); index++) {
    const value = finiteNumber(values[index]);
    if (value !== null && (!best || value < best.value)) best = { time: times[index], value };
  }
  return best;
}

function recommendationCopy(payload) {
  const air = payload.air && typeof payload.air === "object" ? payload.air : {};
  const current = air.current && typeof air.current === "object" ? air.current : air;
  const mode = air.mode === "live" ? "live" : air.mode === "stale" ? "stale" : air.mode === "demo" ? "demo" : "general";
  const hasUs = finiteNumber(current.us_aqi) !== null;
  const scale = hasUs ? "U.S. AQI" : "European AQI";
  const aqi = finiteNumber(hasUs ? current.us_aqi : current.european_aqi);
  const pm = finiteNumber(current.pm2_5);
  const high = (aqi !== null && (scale === "U.S. AQI" ? aqi > 150 : aqi >= 80)) || (pm !== null && pm >= 35);
  const best = bestForecastHour(air);
  const time = best ? best.time.slice(11, 16) : null;
  const city = safeString(payload.city, "your area");
  const preferences = payload.preferences && typeof payload.preferences === "object" ? payload.preferences : {};
  const routine = safeString(preferences.routine, "mixed routine").toLowerCase();
  const household = safeString(preferences.household, "general household").toLowerCase();
  const hasPurifier = Boolean(preferences.hasPurifier);
  const context = mode === "live"
    ? "Location-specific suggestions for " + city + ", based on the latest modeled forecast."
    : mode === "stale"
      ? "Location-specific suggestions for " + city + ", based on the last valid modeled forecast. This data may be stale."
    : mode === "demo"
      ? "Demo plan — these suggestions use clearly labeled example readings, not live measurements."
      : "General suggestions — live location data is not available yet.";

  let outdoorTitle = high ? "Move strenuous plans to a lower hour" : "Keep outdoor plans flexible";
  let outdoorBody;
  if ((mode === "live" || mode === "stale") && time) {
    outdoorBody = "The modeled " + scale + " is lower around " + time + " in the next 12 hours. That is a relative forecast window, not a guarantee that the air is safe for everyone." + (mode === "stale" ? " This forecast has not refreshed successfully." : "");
  } else if (mode === "demo" && time) {
    outdoorBody = "In the demo forecast, the lowest example index is around " + time + ". Retry live data before using this timing for real plans.";
  } else if (mode === "live") {
    outdoorBody = "A current reading is available, but the provider did not return enough hourly values to compare times.";
  } else {
    outdoorBody = "Check your local air-quality source before choosing a time for longer or strenuous outdoor activity.";
  }

  const homeBody = hasPurifier
    ? "Use your purifier in the room where you spend the most time and follow its filter and room-size instructions."
    : "Keep one comfortable room free of indoor smoke. Use an exhaust fan when cooking if available and safe.";
  const routineTitle = routine.includes("walk") || routine.includes("cycl")
    ? "Choose a calmer route"
    : routine.includes("school") || household.includes("children")
      ? "Make the school trip easier"
      : routine.includes("office")
        ? "Compare one commute option"
        : "Combine a nearby errand";
  const routineBody = routine.includes("walk") || routine.includes("cycl")
    ? "When it suits your route, choose quieter streets and use the forecast to pick a comfortable time."
    : routine.includes("school") || household.includes("children")
      ? "If practical, coordinate a shared school trip or combine drop-off with another errand."
      : routine.includes("office")
        ? "Compare transit, carpooling, or a mixed route for one trip this week."
        : "Combine a couple of short errands into one outing when it works for your day.";

  return {
    mode,
    locationSpecific: (mode === "live" || mode === "stale") && (aqi !== null || pm !== null),
    context,
    recommendations: [
      { category: "timing", title: outdoorTitle, body: outdoorBody },
      { category: "home", title: "Make one room your reset", body: homeBody },
      { category: "routine", title: routineTitle, body: routineBody }
    ]
  };
}

function localAssistantAnswer(payload) {
  const question = safeString(payload.question, "What should I keep in mind today?", 800);
  const city = safeString(payload.city, "your area");
  const air = payload.air && typeof payload.air === "object" ? payload.air : {};
  const current = air.current && typeof air.current === "object" ? air.current : air;
  const mode = air.mode === "live" || air.mode === "stale" || air.mode === "demo" ? air.mode : "general";
  const aqi = finiteNumber(current.us_aqi) ?? finiteNumber(current.european_aqi);
  const scale = finiteNumber(current.us_aqi) !== null ? "U.S. AQI" : "European AQI";
  const routine = safeString(payload.preferences && payload.preferences.routine, "mixed routine");
  const opening = (mode === "live" || mode === "stale") && aqi !== null
    ? "For " + city + ", the modeled " + scale + " is " + Math.round(aqi) + (mode === "stale" ? " in the last valid reading, which may be stale. " : ". ")
    : mode === "demo"
      ? "This is a demo-only answer for " + city + "; it is based on example readings. "
      : "I don't have a live reading for " + city + " right now, so this is general guidance. ";
  const lower = question.toLowerCase();
  if (/walk|run|exercise|outside|outdoor/.test(lower)) {
    const best = bestForecastHour(air);
    const timing = best && mode !== "general" ? " The lowest modeled value in the next 12 hours is around " + best.time.slice(11, 16) + "." : "";
    return opening + "Keep strenuous outdoor plans flexible, check local public-health advice, and choose a lower-traffic route when practical." + timing;
  }
  if (/home|room|indoor|window|purif|cook/.test(lower)) {
    return opening + "Focus on one room where you spend the most time, avoid adding smoke indoors, and use a kitchen exhaust fan when cooking if you have one.";
  }
  if (/commute|car|travel|trip|bus|school|office/.test(lower)) {
    return opening + "Your usual routine is " + routine + ". If it fits your route, compare transit, sharing a ride, or combining errands for one trip.";
  }
  return opening + "Check the hourly trend before longer outdoor plans, keep one room free of indoor smoke, and follow local health guidance.";
}

async function aiAnswer(fetchImpl, env, payload, timeoutMs) {
  const question = safeString(payload.question, "What should I keep in mind today?", 800);
  const context = {
    city: safeString(payload.city, "Unknown location"),
    air: payload.air && typeof payload.air === "object" ? payload.air : {},
    preferences: payload.preferences && typeof payload.preferences === "object" ? payload.preferences : {}
  };
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        store: false,
        max_output_tokens: 400,
        instructions: "You are AeroWise, a practical air-quality planning guide. Use only the supplied location, readings, and preferences. Never invent measurements, alerts, citations, or health outcomes. If air.mode is not live, say clearly that the answer is general or based on demo data. Give concise, practical guidance and avoid diagnosis or guarantees.",
        input: JSON.stringify({ question, context })
      })
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new HttpError(504, "AI_TIMEOUT", "The assistant took too long to respond.");
    }
    throw new HttpError(502, "AI_UNAVAILABLE", "The assistant is unavailable right now.");
  }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  let body;
  try {
    if (!contentType.includes("json")) throw new Error("bad content type");
    body = await response.json();
  } catch {
    throw new HttpError(502, "AI_BAD_RESPONSE", "The assistant returned an unreadable response.");
  }
  if (!response.ok) throw new HttpError(502, "AI_PROVIDER_ERROR", "The assistant is unavailable right now.");
  const answer = typeof body.output_text === "string" ? body.output_text : (body.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n");
  if (!answer.trim()) throw new HttpError(502, "AI_EMPTY_RESPONSE", "The assistant could not form an answer. Please try again.");
  return answer.trim();
}

function makeDemoData(fixture, now = new Date()) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  const time = (offset) => new Date(start.getTime() + offset * 3600000).toISOString().slice(0, 16);
  const times = Array.from({ length: fixture.hourly.us_aqi.length }, (_, index) => time(index));
  return {
    mode: "demo",
    source: "AeroWise deterministic demo fixture",
    timezone: "UTC",
    observedAt: time(0),
    current: { time: time(0), ...fixture.current },
    currentUnits: fixture.currentUnits,
    hourly: { time: times, ...fixture.hourly },
    hourlyUnits: fixture.hourlyUnits
  };
}

export function createServer(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || process.env;
  const logger = options.logger || console;
  const providerTimeoutMs = options.providerTimeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
  const aiTimeoutMs = options.aiTimeoutMs || 16000;

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, {
          ok: true,
          services: { airQuality: "Open-Meteo", geocoding: "Open-Meteo" },
          aiEnabled: Boolean(env.OPENAI_API_KEY)
        });
      }

      if (request.method === "GET" && url.pathname === "/api/geocode") {
        const name = (url.searchParams.get("name") || "").trim();
        if (name.length < 2 || name.length > 100) {
          throw new HttpError(400, "INVALID_CITY_QUERY", "Enter a city name with 2 to 100 characters.");
        }
        const params = new URLSearchParams({ name, count: "8", language: "en", format: "json" });
        const body = await providerJson(fetchImpl, GEO_URL + "?" + params.toString(), providerTimeoutMs);
        const results = Array.isArray(body.results) ? body.results.filter((item) =>
          typeof item.name === "string" &&
          finiteNumber(item.latitude) !== null &&
          finiteNumber(item.longitude) !== null
        ) : [];
        if (!results.length) throw new HttpError(404, "CITY_NOT_FOUND", "No matching city was found. Try another spelling.");
        return json(response, 200, { results });
      }

      if (request.method === "GET" && (url.pathname === "/api/air-quality" || url.pathname === "/api/forecast")) {
        const coordinates = validateCoordinates(url);
        const data = await getAirData(fetchImpl, coordinates.latitude, coordinates.longitude, providerTimeoutMs);
        if (url.pathname === "/api/forecast") {
          return json(response, 200, {
            mode: data.mode,
            source: data.source,
            timezone: data.timezone,
            hourly: data.hourly,
            hourlyUnits: data.hourlyUnits
          });
        }
        return json(response, 200, data);
      }

      if (request.method === "GET" && url.pathname === "/api/demo") {
        const fixture = JSON.parse(await readFile(demoPath, "utf8"));
        return json(response, 200, makeDemoData(fixture));
      }

      if (request.method === "POST" && url.pathname === "/api/recommendations") {
        const payload = await readRequestJson(request);
        return json(response, 200, recommendationCopy(payload));
      }

      if (request.method === "POST" && url.pathname === "/api/advice") {
        const payload = await readRequestJson(request);
        if (!env.OPENAI_API_KEY) {
          return json(response, 200, { mode: "local", answer: localAssistantAnswer(payload) });
        }
        try {
          const answer = await aiAnswer(fetchImpl, env, payload, aiTimeoutMs);
          return json(response, 200, { mode: "ai", answer });
        } catch (error) {
          logger.error("[AeroWise AI]", error.code || error.name || "error");
          throw error;
        }
      }

      if (url.pathname.startsWith("/api/")) {
        throw new HttpError(404, "API_NOT_FOUND", "That AeroWise service is not available.");
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "This page does not accept that request.");
      }
      let decoded;
      try {
        decoded = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      } catch {
        return text(response, 400, "Invalid path.");
      }
      const requested = path.resolve(publicRoot, "." + decoded);
      if (requested !== publicRoot && !requested.startsWith(publicRoot + path.sep)) {
        return text(response, 403, "Forbidden.");
      }
      try {
        const file = await readFile(requested);
        response.writeHead(200, {
          "Content-Type": mimeTypes[path.extname(requested)] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache"
        });
        return request.method === "HEAD" ? response.end() : response.end(file);
      } catch {
        return text(response, 404, "Not found");
      }
    } catch (error) {
      if (!(error instanceof HttpError)) {
        logger.error("[AeroWise server]", error.code || error.name || "error");
      }
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
      const message = error instanceof HttpError ? error.message : "AeroWise could not complete that request.";
      if (url.pathname.startsWith("/api/")) return json(response, status, { error: message, code });
      return text(response, status, message);
    }
  });
}

export function configuredPort(env = process.env) {
  const raw = env.PORT || String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer from 0 to 65535.");
  }
  return port;
}

export function startupErrorMessage(error, port) {
  if (error?.code === "EADDRINUSE") {
    return "Port " + port + " is already in use. Check it with: Get-NetTCPConnection -LocalPort " + port + " -State Listen; Get-Process -Id <PID>. To use another port: $env:PORT=4174; npm start";
  }
  return "AeroWise could not start: " + (error?.message || "Unknown server error.");
}

function start() {
  const port = configuredPort();
  const server = createServer();
  server.on("error", (error) => {
    console.error(startupErrorMessage(error, port));
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.log("AeroWise is ready at http://127.0.0.1:" + address.port);
  });
}

const directPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === directPath) start();
