import * as THREE from 'three';

// céu equirectangular analítico com dados em CPU (o path tracer precisa de
// image.data para construir a CDF de importância — texturas PMREM não servem)
function makeEquirectSky(sunDir, w = 512, h = 256) {
  const data = new Float32Array(w * h * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const phi = (y / (h - 1)) * Math.PI; // 0 = topo
    for (let x = 0; x < w; x++) {
      const theta = (x / w) * Math.PI * 2 - Math.PI;
      d.set(-Math.sin(phi) * Math.sin(theta), Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
      const up = d.y;
      let r, g, b;
      if (up > 0) {
        const t = Math.pow(1 - up, 2.2); // gradiente zénite -> horizonte
        r = 0.16 + t * 0.55; g = 0.32 + t * 0.5; b = 0.75 + t * 0.25;
      } else {
        r = 0.28; g = 0.26; b = 0.24; // "chão" abaixo do horizonte
      }
      const cos = Math.max(0, d.dot(sunDir));
      const disc = Math.pow(cos, 3000) * 220;   // disco solar
      const glow = Math.pow(cos, 12) * 1.4;     // auréola
      r += disc + glow * 1.1; g += disc * 0.95 + glow; b += disc * 0.85 + glow * 0.75;
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

// Modo Foto: path tracing progressivo (three-gpu-pathtracer).
// Não é tempo real — a imagem converge ao longo de segundos com a câmara parada.

let WebGLPathTracer = null;
let ParallelMeshBVHWorker = null;

export async function createPhotoMode({ renderer, scene, camera, sunDir, hideDuringPhoto }) {
  if (!WebGLPathTracer) {
    ({ WebGLPathTracer } = await import('three-gpu-pathtracer'));
    try {
      ({ ParallelMeshBVHWorker } = await import('three-mesh-bvh/worker'));
    } catch { /* sem worker: usa-se o caminho síncrono */ }
  }

  const tracer = new WebGLPathTracer(renderer);
  if (ParallelMeshBVHWorker) {
    try { tracer.setBVHWorker(new ParallelMeshBVHWorker()); } catch { ParallelMeshBVHWorker = null; }
  }
  tracer.bounces = 4;
  tracer.renderScale = Math.min(1, 1 / Math.max(1, window.devicePixelRatio * 0.75));
  tracer.tiles.set(2, 2);
  tracer.filterGlossyFactor = 0.5;

  let active = false;
  const equirectSky = makeEquirectSky(sunDir);

  async function enter() {
    const prevVisibility = hideDuringPhoto.map((o) => [o, o.visible]);
    hideDuringPhoto.forEach((o) => (o.visible = false));
    const prevBackground = scene.background;
    const prevEnvironment = scene.environment;
    scene.background = equirectSky;
    scene.environment = equirectSky;

    try {
      // construir BVH da cena (pode demorar — cena com milhões de triângulos)
      if (ParallelMeshBVHWorker) {
        await tracer.setSceneAsync(scene, camera, {
          onProgress: (p) => onBuildProgress && onBuildProgress(p)
        });
      } else {
        tracer.setScene(scene, camera); // bloqueia a UI durante a construção
      }
    } finally {
      scene.background = prevBackground;
      scene.environment = prevEnvironment;
      prevVisibility.forEach(([o, v]) => (o.visible = v));
    }
    active = true;
  }

  function renderSample() {
    if (!active) return 0;
    tracer.renderSample();
    return tracer.samples;
  }

  function exit() {
    active = false;
  }

  let onBuildProgress = null;
  return {
    enter,
    exit,
    renderSample,
    get active() { return active; },
    set onBuildProgress(fn) { onBuildProgress = fn; },
    updateCamera: () => tracer.updateCamera()
  };
}
