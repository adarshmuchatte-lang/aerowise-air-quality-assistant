export function numericReading(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function aqiCategory(value, scale) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { label: "No reading", level: "unknown", guidance: "No current index was supplied for this location." };
  }
  if (scale === "European AQI") {
    if (value < 20) return { label: "Good", level: "good", guidance: "Conditions are in the lower European AQI bands." };
    if (value < 40) return { label: "Fair", level: "good", guidance: "Conditions are in the fair European AQI band." };
    if (value < 60) return { label: "Moderate", level: "moderate", guidance: "Check the hourly trend when planning longer outdoor activity." };
    if (value < 80) return { label: "Poor", level: "poor", guidance: "Consider a lower-forecast hour for strenuous outdoor plans." };
    return { label: "Very poor", level: "poor", guidance: "Keep plans flexible and follow local public-health guidance." };
  }
  if (value <= 50) return { label: "Good", level: "good", guidance: "Conditions are in the lower U.S. AQI band." };
  if (value <= 100) return { label: "Moderate", level: "moderate", guidance: "Consider the hourly trend when planning longer outdoor activity." };
  if (value <= 150) return { label: "Unhealthy for sensitive groups", level: "moderate", guidance: "People who are more sensitive may want to reduce prolonged outdoor exertion." };
  if (value <= 200) return { label: "Unhealthy", level: "poor", guidance: "Consider a lower-forecast hour for strenuous outdoor plans." };
  if (value <= 300) return { label: "Very unhealthy", level: "poor", guidance: "Keep plans flexible and follow local public-health guidance." };
  return { label: "Hazardous", level: "poor", guidance: "Follow local public-health guidance and keep plans flexible." };
}

const pollutantKeys = ["pm2_5", "pm10", "nitrogen_dioxide", "ozone", "carbon_monoxide", "sulphur_dioxide"];

export function buildAirViewModel(payload) {
  const current = payload && payload.current && typeof payload.current === "object" ? payload.current : {};
  const usAqi = numericReading(current.us_aqi);
  const europeanAqi = numericReading(current.european_aqi);
  const useUsScale = usAqi !== null;
  const aqi = useUsScale ? usAqi : europeanAqi;
  const scale = useUsScale ? "U.S. AQI" : europeanAqi !== null ? "European AQI" : "AQI";
  const pollutants = {};
  for (const key of pollutantKeys) pollutants[key] = numericReading(current[key]);
  return {
    aqi,
    scale,
    category: aqiCategory(aqi, scale),
    pollutants,
    hasAnyReading: aqi !== null || Object.values(pollutants).some((value) => value !== null)
  };
}

export function formatReading(value, digits = 1) {
  const parsed = numericReading(value);
  return parsed === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(parsed);
}
