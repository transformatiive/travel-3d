import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildTerrain } from './terrain.js';
import { buildRoute, buildHiker, STOPS } from './route.js';
import { buildMarkers } from './markers.js';
import { buildLakes } from './water.js';
import { buildScatter } from './scatter.js';
import { buildGrass } from './grass.js';
import { createPhotoMode } from './photo.js';

// ---------- região (screenshot: vale de Zermatt / Sunnegga / Rothorn) ----------
const BOUNDS = { lonMin: 7.74, lonMax: 7.81, latMin: 45.98, latMax: 46.03 };
const EYE_HEIGHT = 1.9; // altura dos olhos (POV)

// ---------- renderer / cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 6000, 26000);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 60000);
camera.position.set(0, 4000, 5000);

// ---------- céu e luz ----------
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);
const sun = new THREE.Vector3();
const skyU = sky.material.uniforms;
skyU.turbidity.value = 6;
skyU.rayleigh.value = 1.8;
skyU.mieCoefficient.value = 0.004;
skyU.mieDirectionalG.value = 0.8;
const sunElev = 38, sunAzim = 135;
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunElev), THREE.MathUtils.degToRad(sunAzim));
skyU.sunPosition.value.copy(sun);

// ambiente PMREM a partir do céu físico (reflexos na água, luz ambiente)
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(sky, 0.02).texture;
scene.add(sky); // fromScene retira o objeto da cena principal — voltar a adicionar
scene.environment = envTexture;
scene.environmentIntensity = 0.22;

// sombras dinâmicas do sol: frustum ortográfico que segue a câmara
const sunLight = new THREE.DirectionalLight(0xfff2dd, 2.4);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
const SHADOW_SPAN = 1500;
sunLight.shadow.camera.left = -SHADOW_SPAN;
sunLight.shadow.camera.right = SHADOW_SPAN;
sunLight.shadow.camera.top = SHADOW_SPAN;
sunLight.shadow.camera.bottom = -SHADOW_SPAN;
sunLight.shadow.camera.near = 100;
sunLight.shadow.camera.far = 30000;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 3;
scene.add(sunLight, sunLight.target);
scene.add(new THREE.HemisphereLight(0xbdd7f2, 0x4c4438, 0.45));

const shadowFocus = new THREE.Vector3();
function updateShadowFrustum() {
  // centrar o frustum de sombras no ponto de interesse atual
  shadowFocus.copy(mode === 'orbit' ? controls.target : camera.position);
  sunLight.position.copy(shadowFocus).addScaledVector(sun, 12000);
  sunLight.target.position.copy(shadowFocus);
}

// ---------- pós-processamento (GTAO + bloom) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.blendIntensity = 0.9;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.5, 0.9
);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let fxEnabled = true;

// ---------- estado ----------
let terrain = null;
let route = null;
let hiker = null;
let markers = null;
let lakes = null;
let grass = null;
let photo = null;
let photoBusy = false;
let mode = 'orbit'; // 'orbit' | 'tour' | 'pov'
let tourT = 0;
const TOUR_SECONDS = 160;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 30;
controls.maxDistance = 22000;

// ---------- POV (pointer lock + cursores, agarrado ao terreno) ----------
const pov = {
  yaw: 0,
  pitch: 0,
  pos: new THREE.Vector3(),
  keys: new Set(),
  speedWalk: 5.5,  // m/s (ligeiramente rápido para não ser aborrecido)
  speedRun: 16
};

document.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  pov.keys.add(e.code);
  if (e.code === 'Escape' && mode === 'tour') setMode('orbit');
});
document.addEventListener('keyup', (e) => pov.keys.delete(e.code));

renderer.domElement.addEventListener('click', () => {
  if (mode === 'pov' && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('mousemove', (e) => {
  if (mode !== 'pov' || document.pointerLockElement !== renderer.domElement) return;
  pov.yaw -= e.movementX * 0.0022;
  pov.pitch -= e.movementY * 0.0022;
  pov.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pov.pitch));
});

function updatePOV(dt) {
  // rodar também com Q/E para quem não usa o rato
  if (pov.keys.has('KeyQ')) pov.yaw += 1.6 * dt;
  if (pov.keys.has('KeyE')) pov.yaw -= 1.6 * dt;

  const forward = new THREE.Vector3(-Math.sin(pov.yaw), 0, -Math.cos(pov.yaw));
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const move = new THREE.Vector3();
  if (pov.keys.has('KeyW') || pov.keys.has('ArrowUp')) move.add(forward);
  if (pov.keys.has('KeyS') || pov.keys.has('ArrowDown')) move.sub(forward);
  if (pov.keys.has('KeyA') || pov.keys.has('ArrowLeft')) move.sub(right);
  if (pov.keys.has('KeyD') || pov.keys.has('ArrowRight')) move.add(right);

  if (move.lengthSq() > 0) {
    const speed = (pov.keys.has('ShiftLeft') || pov.keys.has('ShiftRight')) ? pov.speedRun : pov.speedWalk;
    move.normalize().multiplyScalar(speed * dt);
    pov.pos.x += move.x;
    pov.pos.z += move.z;
    // manter dentro do terreno
    const hw = terrain.size.width / 2 - 50, hd = terrain.size.depth / 2 - 50;
    pov.pos.x = Math.max(-hw, Math.min(hw, pov.pos.x));
    pov.pos.z = Math.max(-hd, Math.min(hd, pov.pos.z));
  }

  // >>> câmara acompanha SEMPRE a altitude do chão: nível dos olhos <<<
  const groundY = terrain.heightAt(pov.pos.x, pov.pos.z);
  const targetY = groundY + EYE_HEIGHT;
  // suavizar ligeiramente para degraus do heightmap não "martelarem" a câmara
  pov.pos.y += (targetY - pov.pos.y) * Math.min(1, dt * 12);

  camera.position.copy(pov.pos);
  const dir = new THREE.Vector3(
    -Math.sin(pov.yaw) * Math.cos(pov.pitch),
    Math.sin(pov.pitch),
    -Math.cos(pov.yaw) * Math.cos(pov.pitch)
  );
  camera.lookAt(pov.pos.clone().add(dir));
}

// ---------- modos ----------
const hints = {
  orbit: '<b>Órbita:</b> arrastar = rodar · scroll = zoom · botão direito = mover · clique numa paragem para voar até lá',
  tour: '<b>Tour aéreo:</b> a seguir a rota dos 5 lagos · <kbd>Esc</kbd> para sair',
  pov: '<b>POV:</b> clique no mapa para capturar o rato · <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd>/<kbd>WASD</kbd> andar · rato = olhar 360° · <kbd>Shift</kbd> correr · <kbd>Q</kbd>/<kbd>E</kbd> rodar · <kbd>Esc</kbd> liberta o rato'
};

function setMode(next) {
  mode = next;
  document.body.classList.toggle('pov', mode === 'pov');
  controls.enabled = mode === 'orbit';
  document.getElementById('controls-hint').innerHTML = hints[mode];
  document.getElementById('mode-label').textContent =
    mode === 'orbit' ? 'órbita' : mode === 'tour' ? 'tour aéreo' : 'POV a pé';
  for (const [id, m] of [['btn-tour', 'tour'], ['btn-pov', 'pov'], ['btn-orbit', 'orbit']]) {
    document.getElementById(id).classList.toggle('active', mode === m);
  }
  if (mode === 'pov') {
    // começar no ponto da câmara projetado no chão (ou no início da rota na 1ª vez)
    if (!pov.initialized) {
      const start = route.curve.getPoint(0);
      pov.pos.set(start.x, terrain.heightAt(start.x, start.z) + EYE_HEIGHT, start.z);
      const ahead = route.curve.getPoint(0.02);
      pov.yaw = Math.atan2(-(ahead.x - start.x), -(ahead.z - start.z));
      pov.pitch = 0;
      pov.initialized = true;
    }
    renderer.domElement.requestPointerLock();
  } else if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  if (mode === 'tour') tourT = 0;
  if (hiker) hiker.visible = mode === 'tour';
  if (route) {
    route.tubeFar.visible = mode !== 'pov';
    route.dots.visible = mode !== 'pov';
    route.tubeNear.visible = mode === 'pov';
  }
  if (grass) grass.mesh.visible = mode === 'pov'; // relva só faz sentido ao nível do chão
}

document.addEventListener('pointerlockchange', () => {
  // sair do pointer lock em POV não muda de modo; basta clicar para recapturar
});

document.getElementById('btn-tour').addEventListener('click', () => setMode('tour'));
document.getElementById('btn-pov').addEventListener('click', () => setMode('pov'));
document.getElementById('btn-orbit').addEventListener('click', () => setMode('orbit'));

// ---------- tour aéreo ----------
const camTarget = new THREE.Vector3();
function updateTour(dt) {
  tourT += dt / TOUR_SECONDS;
  if (tourT >= 1) { tourT = 1; setMode('orbit'); return; }

  const p = route.curve.getPoint(tourT);
  const ahead = route.curve.getPoint(Math.min(1, tourT + 0.004));
  hiker.position.copy(p);

  const back = p.clone().sub(ahead).setY(0);
  if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
  back.normalize();
  const desired = p.clone().addScaledVector(back, 240);
  desired.y = Math.max(p.y + 110, terrain.heightAt(desired.x, desired.z) + 60);

  camera.position.lerp(desired, Math.min(1, dt * 1.5));
  camTarget.lerp(p.clone().setY(p.y + 20), Math.min(1, dt * 3));
  camera.lookAt(camTarget);

  // realçar paragem atual na lista
  let nearest = 0, best = Infinity;
  route.stopPoints.forEach((sp, i) => {
    const d = sp.distanceToSquared(p);
    if (d < best) { best = d; nearest = i; }
  });
  highlightStop(nearest);
}

// ---------- UI: itinerário ----------
function highlightStop(i) {
  document.querySelectorAll('.stop').forEach((el, j) => el.classList.toggle('active', i === j));
}

function flyToStop(i) {
  setMode('orbit');
  const p = route.stopPoints[i];
  const dst = p.clone().add(new THREE.Vector3(320, 0, 420));
  dst.y = Math.max(p.y + 220, terrain.heightAt(dst.x, dst.z) + 120);
  animateCamera(dst, p.clone().setY(p.y + 30));
  highlightStop(i);
}

let camAnim = null;
function animateCamera(toPos, toTarget) {
  camAnim = {
    fromPos: camera.position.clone(), toPos,
    fromTarget: controls.target.clone(), toTarget,
    t: 0
  };
}
function updateCamAnim(dt) {
  if (!camAnim) return;
  camAnim.t = Math.min(1, camAnim.t + dt / 1.8);
  const e = camAnim.t < 0.5 ? 2 * camAnim.t * camAnim.t : 1 - Math.pow(-2 * camAnim.t + 2, 2) / 2;
  camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, e);
  controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, e);
  if (camAnim.t >= 1) camAnim = null;
}

function buildStopList() {
  const wrap = document.getElementById('stops');
  STOPS.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'stop';
    el.innerHTML = `
      <div class="dot ${s.lake ? 'lake' : ''}">${s.lake ? i : '▲'}</div>
      <div class="info"><b>${s.name}</b><small>${s.alt} m — ${s.desc}</small></div>`;
    el.addEventListener('click', () => flyToStop(i));
    wrap.appendChild(el);
  });
}

// ---------- HUD ----------
const altValue = document.getElementById('alt-value');
const needle = document.getElementById('needle');
function updateHUD() {
  if (!terrain) return;
  const alt = camera.position.y + terrain.hMin;
  altValue.textContent = Math.round(alt);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const heading = Math.atan2(dir.x, -dir.z); // 0 = norte
  needle.style.transform = `rotate(${(-heading * 180) / Math.PI}deg)`;
}

// ---------- arranque ----------
async function init() {
  const bar = document.getElementById('bar');
  const status = document.getElementById('load-status');

  try {
    terrain = await buildTerrain(BOUNDS, (done, total) => {
      bar.style.width = `${((done / total) * 100).toFixed(1)}%`;
      status.textContent = `terreno e satélite: ${done}/${total} tiles`;
    });
  } catch (err) {
    status.textContent = 'erro ao carregar dados de terreno — verifique a ligação e recarregue';
    console.error(err);
    return;
  }

  scene.add(terrain.mesh);

  route = buildRoute(terrain);
  scene.add(route.group);

  hiker = buildHiker();
  hiker.position.copy(route.curve.getPoint(0));
  scene.add(hiker);

  markers = buildMarkers(STOPS, route.stopPoints);
  scene.add(markers);

  lakes = buildLakes(terrain);
  scene.add(lakes.group);

  const scatter = buildScatter(terrain);
  scene.add(scatter.group);
  console.log('vegetação:', scatter.counts);

  grass = buildGrass(terrain);
  scene.add(grass.mesh);

  buildStopList();

  // enquadramento inicial: sobre o vale a olhar para a zona dos lagos
  const mid = route.curve.getPoint(0.45);
  controls.target.copy(mid);
  camera.position.set(mid.x - 2500, mid.y + 2600, mid.z + 4200);

  document.getElementById('loading').classList.add('done');
  setMode('orbit');
  window.__travel3d = { terrain, route }; // handle de debug/testes
}

// ---------- modo foto (path tracing) ----------
const photoOverlay = document.getElementById('photo-overlay');
const photoStatus = document.getElementById('photo-status');

async function togglePhoto() {
  if (photoBusy) return;
  if (photo && photo.active) {
    photo.exit();
    photoOverlay.classList.remove('open');
    return;
  }
  photoBusy = true;
  photoOverlay.classList.add('open');
  photoStatus.textContent = 'a preparar path tracing (pode demorar ~10-30 s)…';
  try {
    if (!photo) {
      photo = await createPhotoMode({
        renderer, scene, camera, sunDir: sun.clone(),
        hideDuringPhoto: [sky, markers, hiker, route.tubeFar, route.tubeNear, route.dots, grass.mesh]
      });
      photo.onBuildProgress = (p) => {
        photoStatus.textContent = `a construir BVH da cena: ${(p * 100).toFixed(0)}%`;
      };
    }
    await photo.enter();
    photoStatus.textContent = 'a convergir…';
  } catch (err) {
    console.error('modo foto falhou:', err);
    photoStatus.textContent = 'o modo foto não é suportado neste dispositivo';
    setTimeout(() => photoOverlay.classList.remove('open'), 2500);
    photo = null;
  }
  photoBusy = false;
}
document.getElementById('btn-photo').addEventListener('click', togglePhoto);
document.getElementById('photo-exit').addEventListener('click', togglePhoto);

document.getElementById('btn-fx').addEventListener('click', (e) => {
  fxEnabled = !fxEnabled;
  e.target.classList.toggle('active', fxEnabled);
});

// ---------- loop ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  if (photo && photo.active) {
    const samples = photo.renderSample();
    photoStatus.textContent = `path tracing — ${samples} amostras (a imagem vai limpando)`;
    return;
  }

  if (terrain) {
    if (mode === 'tour') updateTour(dt);
    else if (mode === 'pov') updatePOV(dt);
    else { updateCamAnim(dt); controls.update(); }
    if (hiker && mode !== 'tour') hiker.rotation.y += dt * 0.8;
    // tamanho aparente das etiquetas ~constante: encolher quando a câmara está perto
    if (markers) {
      for (const s of markers.children) {
        const d = camera.position.distanceTo(s.position);
        const k = Math.min(1, Math.max(0.1, d / 1600));
        s.scale.set(s.userData.baseH * s.userData.aspect * k, s.userData.baseH * k, 1);
      }
    }
    if (lakes) lakes.update(t);
    if (grass && mode === 'pov') grass.update(camera.position);
    updateShadowFrustum();
    updateHUD();
  }
  if (fxEnabled) composer.render();
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
