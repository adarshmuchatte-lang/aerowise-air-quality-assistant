const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js";
const stage = document.querySelector("#globe-stage");
const fallback = document.querySelector("#globe-fallback");
let activeMode = "earth";

function finishIntro() {
  const screen = document.querySelector("#entry-screen");
  if (!screen) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seen = false;
  try { seen = sessionStorage.getItem("aerowise-intro-seen") === "1"; } catch {}
  if (reduced || seen) {
    screen.classList.add("done");
    screen.setAttribute("aria-hidden", "true");
    return;
  }
  const finish = () => {
    screen.classList.add("done");
    screen.setAttribute("aria-hidden", "true");
    try { sessionStorage.setItem("aerowise-intro-seen", "1"); } catch {}
  };
  document.querySelector("#entry-skip")?.addEventListener("click", finish, { once: true });
  window.setTimeout(finish, 2050);
}

function showFallback(reason = "") {
  if (fallback) fallback.hidden = false;
  if (stage) stage.hidden = true;
  window.AeroWiseScene = { update: () => {}, setMode: (mode) => { activeMode = mode; } };
  const caption = document.querySelector("#globe-caption");
  if (caption) caption.textContent = "2D PLANET FALLBACK / 3D UNAVAILABLE";
  if (reason) console.info("AeroWise globe fallback:", reason);
  finishIntro();
}

function seededRandom(seed = 17) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeEarthTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 768;
  const ctx = canvas.getContext("2d");
  const ocean = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  ocean.addColorStop(0, "#103954");
  ocean.addColorStop(.42, "#0b2b47");
  ocean.addColorStop(1, "#071d36");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const random = seededRandom(42);
  for (let i = 0; i < 7200; i++) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const alpha = random() * .11;
    const color = random() > .5 ? "82,176,184" : "24,75,112";
    ctx.fillStyle = "rgba(" + color + "," + alpha + ")";
    ctx.fillRect(x, y, random() * 18 + 1, random() * 2 + .3);
  }

  const continents = [
    [[-168,65],[-150,71],[-133,58],[-125,51],[-124,43],[-117,33],[-108,29],[-105,23],[-98,19],[-90,20],[-84,28],[-80,25],[-78,34],[-72,42],[-63,46],[-58,53],[-72,59],[-85,63],[-102,70],[-121,74],[-141,71]],
    [[-81,12],[-72,10],[-62,7],[-52,3],[-47,-6],[-50,-17],[-56,-24],[-61,-33],[-68,-43],[-74,-51],[-78,-38],[-77,-25],[-81,-10]],
    [[-9,36],[-2,43],[4,47],[10,45],[14,51],[22,55],[29,59],[37,56],[45,59],[53,57],[63,61],[74,58],[81,63],[92,71],[109,72],[126,66],[139,59],[151,57],[160,62],[173,57],[163,49],[151,45],[145,38],[137,35],[130,31],[123,25],[120,17],[111,9],[105,1],[99,5],[96,16],[89,21],[81,8],[77,8],[73,18],[68,23],[61,25],[55,26],[49,30],[43,36],[35,39],[29,41],[23,38],[18,35],[13,37],[8,42],[1,41],[-6,43]],
    [[-17,36],[-5,36],[10,35],[21,32],[32,30],[39,17],[44,10],[42,-5],[35,-17],[29,-26],[18,-35],[10,-34],[5,-26],[-1,-15],[-7,-3],[-13,7],[-17,20]],
    [[-52,82],[-34,78],[-23,70],[-41,60],[-53,62],[-65,70]],
    [[112,-11],[129,-11],[143,-16],[153,-27],[148,-39],[135,-43],[121,-35],[115,-25]],
    [[47,-13],[50,-16],[49,-25],[45,-24],[43,-17]],
    [[130,32],[136,35],[142,42],[145,39],[141,34]],
    [[-9,58],[-3,59],[0,54],[-5,50],[-9,53]],
    [[95,5],[109,4],[119,-3],[128,-4],[135,-7],[128,-10],[119,-8],[112,-2],[104,-3]],
    [[-180,-72],[-140,-73],[-90,-72],[-30,-73],[30,-72],[90,-73],[150,-72],[180,-73],[180,-90],[-180,-90]]
  ];
  const project = (point) => [(point[0] + 180) / 360 * canvas.width, (90 - point[1]) / 180 * canvas.height];
  for (let index = 0; index < continents.length; index++) {
    const points = continents[index].map(project);
    const fill = ctx.createLinearGradient(0, points[0][1] - 40, 0, points[0][1] + 260);
    fill.addColorStop(0, index === 10 ? "#174557" : "#5e9881");
    fill.addColorStop(.55, index === 10 ? "#10374a" : "#3d806e");
    fill.addColorStop(1, index === 10 ? "#0d2c3e" : "#275e5c");
    ctx.beginPath();
    points.forEach((point, pointIndex) => pointIndex ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = index === 10 ? "rgba(107,211,202,.2)" : "rgba(157,228,184,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (let latitude = -60; latitude <= 75; latitude += 15) {
    const y = (90 - latitude) / 180 * canvas.height;
    ctx.strokeStyle = "rgba(112,207,215,.07)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeCloudTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const random = seededRandom(111);
  for (let index = 0; index < 390; index++) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const width = 12 + random() * 64;
    const height = 3 + random() * 12;
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, width);
    cloud.addColorStop(0, "rgba(184,231,233," + (.07 + random() * .17) + ")");
    cloud.addColorStop(1, "rgba(185,232,238,0)");
    ctx.fillStyle = cloud;
    ctx.beginPath();
    ctx.ellipse(x, y, width, height, random() * .3, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function latLonVector(THREE, latitude, longitude, radius) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const lon = THREE.MathUtils.degToRad(longitude);
  return new THREE.Vector3(radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.cos(lon));
}

function init(THREE) {
  if (!stage || !stage.clientWidth) return showFallback("Canvas stage is unavailable.");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: window.innerWidth > 720, powerPreference: "high-performance" });
  } catch (error) {
    return showFallback(error.message);
  }
  const mobile = window.matchMedia("(max-width: 650px)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.55));
  renderer.setSize(stage.clientWidth, stage.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, stage.clientWidth / stage.clientHeight, .1, 100);
  camera.position.set(0, 0, 6.15);
  const root = new THREE.Group();
  scene.add(root);
  const planetRadius = 1.68;
  const earthTexture = makeEarthTexture(THREE);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius, 72, 56),
    new THREE.MeshStandardMaterial({ map: earthTexture, roughness: .88, metalness: .04, emissive: new THREE.Color(0x06131b), emissiveMap: earthTexture, emissiveIntensity: .38 })
  );
  root.add(earth);
  const cloudTexture = makeCloudTexture(THREE);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius * 1.009, 64, 48),
    new THREE.MeshStandardMaterial({ map: cloudTexture, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
  );
  root.add(clouds);
  scene.add(new THREE.HemisphereLight(0x9bd6e7, 0x06101b, 1.18));
  const key = new THREE.DirectionalLight(0xb4efff, 2.05);
  key.position.set(-3.4, 2.5, 4.1);
  scene.add(key);
  const rim = new THREE.PointLight(0x31b8ca, 8, 12);
  rim.position.set(3.3, -.6, -2.4);
  scene.add(rim);
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(planetRadius * 1.095, 64, 48),
    new THREE.ShaderMaterial({
      vertexShader: "varying vec3 vNormal; varying vec3 vViewPosition; void main(){ vec4 mvPosition=modelViewMatrix*vec4(position,1.0); vNormal=normalize(normalMatrix*normal); vViewPosition=-mvPosition.xyz; gl_Position=projectionMatrix*mvPosition; }",
      fragmentShader: "varying vec3 vNormal; varying vec3 vViewPosition; void main(){ float f=pow(0.72-dot(normalize(vNormal),normalize(vViewPosition)),3.0); float r=pow(0.64-dot(normalize(vNormal),normalize(vViewPosition)),5.0); vec3 c=mix(vec3(0.12,0.62,0.74),vec3(0.32,0.94,0.72),clamp(r*2.4,0.0,1.0)); gl_FragColor=vec4(c,clamp(f*0.64+r*0.16,0.0,0.72)); }",
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    })
  );
  root.add(atmosphere);

  const cityData = [
    { name: "New Delhi", admin1: "Delhi", country: "India", latitude: 28.6139, longitude: 77.209 },
    { name: "Mumbai", admin1: "Maharashtra", country: "India", latitude: 19.076, longitude: 72.8777 },
    { name: "London", admin1: "England", country: "United Kingdom", latitude: 51.5072, longitude: -.1276 },
    { name: "New York", admin1: "New York", country: "United States", latitude: 40.7128, longitude: -74.006 },
    { name: "Los Angeles", admin1: "California", country: "United States", latitude: 34.0522, longitude: -118.2437 },
    { name: "Tokyo", admin1: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503 },
    { name: "Nairobi", admin1: "Nairobi County", country: "Kenya", latitude: -1.2921, longitude: 36.8219 },
    { name: "São Paulo", admin1: "São Paulo", country: "Brazil", latitude: -23.5505, longitude: -46.6333 }
  ];
  const markerGroup = new THREE.Group();
  root.add(markerGroup);
  const markerObjects = [];
  for (const city of cityData) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(.035, 12, 10), new THREE.MeshBasicMaterial({ color: 0x69e9da, transparent: true, opacity: .84 }));
    marker.position.copy(latLonVector(THREE, city.latitude, city.longitude, planetRadius * 1.014));
    marker.userData.city = city;
    markerGroup.add(marker);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.046, .052, 32), new THREE.MeshBasicMaterial({ color: 0x6bf5dc, transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(latLonVector(THREE, city.latitude, city.longitude, planetRadius * 1.016));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ring.position.clone().normalize());
    markerGroup.add(ring);
    markerObjects.push({ city: city, marker: marker, ring: ring });
  }
  let activeMarker = null;
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xafff90, transparent: true, opacity: 1 });
  const selectedDot = new THREE.Mesh(new THREE.SphereGeometry(.059, 16, 12), selectedMaterial);
  const selectedRing = new THREE.Mesh(new THREE.RingGeometry(.074, .082, 48), new THREE.MeshBasicMaterial({ color: 0x9bff91, transparent: true, opacity: .78, side: THREE.DoubleSide, depthWrite: false }));
  const selectedGlow = new THREE.Mesh(new THREE.SphereGeometry(.1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x66e7ff, transparent: true, opacity: .18, blending: THREE.AdditiveBlending, depthWrite: false }));
  root.add(selectedGlow, selectedDot, selectedRing);

  const targetRotation = { x: THREE.MathUtils.degToRad(28.6), y: THREE.MathUtils.degToRad(-77.2) };
  let currentLocationKey = null;
  function pointSelected(latitude, longitude) {
    const position = latLonVector(THREE, latitude, longitude, planetRadius * 1.022);
    selectedDot.position.copy(position);
    selectedRing.position.copy(position.clone().multiplyScalar(1.001));
    selectedRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    selectedGlow.position.copy(position.clone().multiplyScalar(1.005));
    activeMarker = markerObjects.find((item) => Math.abs(item.city.latitude - latitude) < .2 && Math.abs(item.city.longitude - longitude) < .2) || null;
    markerObjects.forEach((item) => {
      const active = activeMarker && item.marker === activeMarker.marker;
      item.marker.material.color.set(active ? 0x9bff91 : 0x69e9da);
      item.marker.scale.setScalar(active ? 1.65 : 1);
      item.ring.material.opacity = active ? .88 : .34;
    });
    targetRotation.y = -THREE.MathUtils.degToRad(longitude);
    targetRotation.x = THREE.MathUtils.degToRad(latitude);
  }

  const starRandom = seededRandom(801);
  const starPositions = new Float32Array(850 * 3);
  for (let i = 0; i < 850; i++) {
    const radius = 4.1 + starRandom() * 8.5;
    const theta = starRandom() * Math.PI * 2;
    const z = starRandom() * 2 - 1;
    const planar = Math.sqrt(1 - z * z);
    starPositions[i * 3] = radius * planar * Math.cos(theta);
    starPositions[i * 3 + 1] = radius * z;
    starPositions[i * 3 + 2] = radius * planar * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x98c9db, size: .013, transparent: true, opacity: .65, sizeAttenuation: true }));
  scene.add(stars);

  const particleCount = mobile ? 240 : 420;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleRandom = seededRandom(54);
  for (let i = 0; i < particleCount; i++) {
    const theta = particleRandom() * Math.PI * 2;
    const y = (particleRandom() * 2 - 1) * 2.55;
    const radius = 1.92 + particleRandom() * 1.35;
    const planar = Math.sqrt(Math.max(0, 1 - Math.min(.99, (y / 3.1) ** 2)));
    particlePositions[i * 3] = Math.cos(theta) * radius * planar;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = Math.sin(theta) * radius * planar;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ color: 0x68eed6, size: .022, transparent: true, opacity: .37, sizeAttenuation: true, depthWrite: false }));
  scene.add(particles);
  const orbit = new THREE.Mesh(new THREE.RingGeometry(2.19, 2.198, 180), new THREE.MeshBasicMaterial({ color: 0x4ce7d6, transparent: true, opacity: .28, side: THREE.DoubleSide, depthWrite: false }));
  orbit.rotation.set(1.15, .18, -.12);
  scene.add(orbit);
  const orbitTwo = new THREE.Mesh(new THREE.RingGeometry(2.56, 2.565, 180), new THREE.MeshBasicMaterial({ color: 0x4c9fc2, transparent: true, opacity: .18, side: THREE.DoubleSide, depthWrite: false }));
  orbitTwo.rotation.set(.64, -.45, .5);
  scene.add(orbitTwo);

  const gridGroup = new THREE.Group();
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const points = [];
    for (let longitude = -180; longitude <= 180; longitude += 3) points.push(latLonVector(THREE, latitude, longitude, planetRadius * 1.003));
    gridGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x76d9de, transparent: true, opacity: .17 })));
  }
  for (let longitude = -180; longitude < 180; longitude += 30) {
    const points = [];
    for (let latitude = -87; latitude <= 87; latitude += 3) points.push(latLonVector(THREE, latitude, longitude, planetRadius * 1.003));
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x76d9de, transparent: true, opacity: .14 })));
  }
  root.add(gridGroup);
  gridGroup.visible = false;
  const modeConfig = {
    earth: { clouds: true, particles: false, markers: true, grid: false, orbit: true, color: 0x68eed6, caption: "ATMOSPHERE / STYLIZED EARTH" },
    particles: { clouds: false, particles: true, markers: false, grid: false, orbit: true, color: 0xffc76b, caption: "PARTICLE FIELD / ILLUSTRATIVE" },
    cities: { clouds: false, particles: false, markers: true, grid: false, orbit: false, color: 0x66e7ff, caption: "CITY FORECAST POINTS / NOT MONITORS" },
    forecast: { clouds: true, particles: false, markers: true, grid: true, orbit: true, color: 0x9bff91, caption: "FORECAST GRID / SELECTED LOCATION" },
    grid: { clouds: false, particles: false, markers: false, grid: true, orbit: false, color: 0x8ab9d8, caption: "ATMOSPHERIC REFERENCE GRID / CONCEPTUAL" }
  };
  function setMode(mode) {
    if (!modeConfig[mode]) return;
    activeMode = mode;
    const config = modeConfig[mode];
    clouds.visible = config.clouds;
    particles.visible = config.particles;
    markerGroup.visible = config.markers;
    gridGroup.visible = config.grid;
    orbit.visible = config.orbit;
    orbitTwo.visible = config.orbit;
    particles.material.color.set(config.color);
    const caption = document.querySelector("#globe-caption");
    if (caption) caption.textContent = config.caption;
    document.querySelectorAll("[data-globe-mode]").forEach((button) => {
      const active = button.dataset.globeMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function applyData(data = {}) {
    const latitude = Number(data.latitude ?? 28.6139);
    const longitude = Number(data.longitude ?? 77.209);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const key = latitude.toFixed(4) + ":" + longitude.toFixed(4);
    if (key === currentLocationKey) return;
    currentLocationKey = key;
    pointSelected(latitude, longitude);
    const coordinate = document.querySelector("#globe-coordinate");
    if (coordinate) coordinate.innerHTML = Math.abs(latitude).toFixed(2) + "° " + (latitude >= 0 ? "N" : "S") + "&nbsp;&nbsp; " + Math.abs(longitude).toFixed(2) + "° " + (longitude >= 0 ? "E" : "W") + "<span>SELECTED FORECAST GRID</span>";
  }

  const drag = { active: false, x: 0, y: 0, moved: false };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.createElement("div");
  tooltip.className = "globe-tooltip";
  tooltip.hidden = true;
  stage.appendChild(tooltip);
  function projectPointer(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([earth].concat(markerObjects.map((item) => item.marker)), false);
    return hits[0] && hits[0].object.userData.city ? hits[0] : null;
  }
  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag.active = true; drag.moved = false; drag.x = event.clientX; drag.y = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("wheel", (event) => {
    if (!event.shiftKey) return;
    event.preventDefault();
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + event.deltaY * .003, 4.9, 8.2);
  }, { passive: false });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (drag.active) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      targetRotation.y += dx * .006;
      targetRotation.x = THREE.MathUtils.clamp(targetRotation.x + dy * .004, -1.18, 1.18);
      drag.x = event.clientX; drag.y = event.clientY;
      tooltip.hidden = true;
      return;
    }
    const intersection = projectPointer(event);
    if (intersection && intersection.object.userData.city && modeConfig[activeMode].markers) {
      const city = intersection.object.userData.city;
      tooltip.textContent = city.name + " · select forecast point";
      tooltip.hidden = false;
      tooltip.style.left = (event.offsetX + 14) + "px";
      tooltip.style.top = (event.offsetY + 12) + "px";
      renderer.domElement.style.cursor = "pointer";
    } else {
      tooltip.hidden = true;
      renderer.domElement.style.cursor = "grab";
    }
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!drag.active) return;
    drag.active = false;
    if (!drag.moved) {
      const intersection = projectPointer(event);
      const city = intersection && intersection.object.userData.city;
      if (city && modeConfig[activeMode].markers) window.dispatchEvent(new CustomEvent("aerowise:select-location", { detail: city }));
    }
  });
  renderer.domElement.addEventListener("pointerleave", () => { tooltip.hidden = true; });
  document.querySelectorAll("[data-globe-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.globeMode)));
  document.querySelector("#globe-reset")?.addEventListener("click", () => {
    targetRotation.x = THREE.MathUtils.degToRad(Number(window.aerowiseData?.latitude ?? 28.6));
    targetRotation.y = -THREE.MathUtils.degToRad(Number(window.aerowiseData?.longitude ?? 77.2));
    if (typeof window.showToast === "function") window.showToast("Planet view recentered on your selected location.");
  });
  window.AeroWiseScene = { update: applyData, setMode: setMode, cityData: cityData };
  applyData(window.aerowiseData || {});
  setMode(activeMode);
  finishIntro();

  const resize = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const isMobile = window.matchMedia("(max-width: 650px)").matches;
    camera.position.z = isMobile ? 6.75 : 6.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.2 : 1.55));
    renderer.setSize(width, height, false);
  };
  new ResizeObserver(resize).observe(stage);
  window.addEventListener("resize", resize, { passive: true });
  let visible = true;
  let lastTime = 0;
  let frame = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  visibility.observe(stage);
  document.addEventListener("visibilitychange", () => {
    const rect = stage.getBoundingClientRect();
    visible = !document.hidden && rect.bottom > 0 && rect.top < window.innerHeight;
  });
  function animate(time) {
    frame = requestAnimationFrame(animate);
    if (!visible) return;
    const delta = Math.min((time - (lastTime || time)) / 1000, .05);
    lastTime = time;
    if (!reducedMotion) {
      root.rotation.x += (targetRotation.x - root.rotation.x) * Math.min(1, delta * 2.8);
      root.rotation.y += (targetRotation.y - root.rotation.y) * Math.min(1, delta * 2.3);
      root.rotation.y += delta * .012;
      clouds.rotation.y += delta * .015;
      particles.rotation.y -= delta * .009;
      orbit.rotation.z += delta * .006;
      stars.rotation.y += delta * .0015;
      selectedRing.scale.setScalar(1 + Math.sin(time * .0022) * .09);
      selectedGlow.scale.setScalar(1 + Math.sin(time * .0018) * .22);
    }
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(animate);
  window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frame);
    renderer.dispose();
    earthTexture.dispose();
    cloudTexture.dispose();
  }, { once: true });
}

try {
  const THREE = await import(THREE_CDN);
  init(THREE);
} catch (error) {
  showFallback(error.message || "Three.js could not be loaded.");
}

