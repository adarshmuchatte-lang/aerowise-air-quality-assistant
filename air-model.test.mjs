import test from "node:test";
import assert from "node:assert/strict";
import { aqiCategory, buildAirViewModel, formatReading, numericReading } from "../public/air-model.js";

test("numeric reading preserves zero and safely accepts numeric strings", () => {
  assert.equal(numericReading(0), 0);
  assert.equal(numericReading("0"), 0);
  assert.equal(numericReading("12.5"), 12.5);
  assert.equal(numericReading(null), null);
  assert.equal(numericReading(undefined), null);
  assert.equal(numericReading(""), null);
  assert.equal(numericReading("not a number"), null);
});

test("missing pollutants render independently without dropping valid measurements", () => {
  const model = buildAirViewModel({
    current: {
      us_aqi: 0,
      pm2_5: 0,
      pm10: null,
      nitrogen_dioxide: "18.2",
      ozone: undefined,
      carbon_monoxide: "bad",
      sulphur_dioxide: 4
    }
  });
  assert.equal(model.aqi, 0);
  assert.equal(model.scale, "U.S. AQI");
  assert.equal(model.pollutants.pm2_5, 0);
  assert.equal(model.pollutants.pm10, null);
  assert.equal(model.pollutants.nitrogen_dioxide, 18.2);
  assert.equal(model.pollutants.ozone, null);
  assert.equal(model.pollutants.carbon_monoxide, null);
  assert.equal(model.pollutants.sulphur_dioxide, 4);
  assert.equal(model.hasAnyReading, true);
  assert.equal(formatReading(model.pollutants.pm10), "—");
  assert.equal(formatReading(model.pollutants.pm2_5), "0");
});

test("European AQI fallback keeps its own category scale", () => {
  const model = buildAirViewModel({ current: { us_aqi: null, european_aqi: 62, pm2_5: 11 } });
  assert.equal(model.scale, "European AQI");
  assert.equal(model.aqi, 62);
  assert.equal(model.category.label, "Poor");
  assert.equal(aqiCategory(null, "U.S. AQI").level, "unknown");
});

test("empty payload does not invent a green gauge", () => {
  const model = buildAirViewModel({ current: { us_aqi: null, pm2_5: null, pm10: null } });
  assert.equal(model.aqi, null);
  assert.equal(model.category.label, "No reading");
  assert.equal(model.category.level, "unknown");
  assert.equal(model.hasAnyReading, false);
});
