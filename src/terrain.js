import * as THREE from 'three';
import { TILE, tileRange, lonToMercX, latToMercY, metersPerPixel } from './geo.js';
import { TEX, loadTex } from './textures.js';

// Elevação real: tiles Terrarium (Mapzen/AWS Open Data, sem chave)
const ELEV_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// Imagem de satélite: ESRI World Imagery (uso livre para visualização, sem chave)
const SAT_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const Z_ELEV = 13; // resolução da malha de elevação
const Z_SAT = 16;  // resolução da textura de satélite (Z_ELEV + 3 => 8x)

// ruído de valor multi-oitava para a detail texture (relva/gravilha)
function makeDetailTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const grid = 64;
  const vals = new Float32Array((grid + 1) * (grid + 1));
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < vals.length; i++) vals[i] = rnd();
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x) % grid, yi = Math.floor(y) % grid;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const a = vals[yi * (grid + 1) + xi], b = vals[yi * (grid + 1) + xi + 1];
    const cc = vals[(yi + 1) * (grid + 1) + xi], d = vals[(yi + 1) * (grid + 1) + xi + 1];
    return a + (b - a) * smooth(xf) + (cc - a + (a - b + d - cc) * smooth(xf)) * smooth(yf);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n =
        noise((x / size) * 16, (y / size) * 16) * 0.5 +
        noise((x / size) * 37, (y / size) * 37) * 0.3 +
        noise((x / size) * 64, (y / size) * 64) * 0.2;
      const v = (0.35 + n * 0.3) * 255; // centrado em ~0.5 para não escurecer em média
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16; // manter o grain em ângulos rasantes (senão o mip médio apaga-o)
  return tex;
}

function loadImage(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (retries > 0) {
        setTimeout(() => loadImage(url, retries - 1).then(resolve, reject), 800);
      } else {
        reject(new Error(`falha ao carregar ${url}`));
      }
    };
    img.src = url;
  });
}

/**
 * Constrói o terreno da região `bounds` ({lonMin, lonMax, latMin, latMax}).
 * Devolve { mesh, heightAt(x,z), toWorld(lat,lon), size }.
 */
export async function buildTerrain(bounds, onProgress) {
  const latMid = (bounds.latMin + bounds.latMax) / 2;
  const elevRange = tileRange(bounds, Z_ELEV);
  const satFactor = Math.pow(2, Z_SAT - Z_ELEV);
  const satRange = {
    x0: elevRange.x0 * satFactor,
    y0: elevRange.y0 * satFactor,
    nx: elevRange.nx * satFactor,
    ny: elevRange.ny * satFactor
  };

  const totalTiles = elevRange.nx * elevRange.ny + satRange.nx * satRange.ny;
  let loaded = 0;
  const tick = () => onProgress && onProgress(++loaded, totalTiles);

  // ---------- elevação ----------
  const W = elevRange.nx * TILE;
  const H = elevRange.ny * TILE;
  const elevCanvas = document.createElement('canvas');
  elevCanvas.width = W;
  elevCanvas.height = H;
  const elevCtx = elevCanvas.getContext('2d', { willReadFrequently: true });

  const elevJobs = [];
  for (let ty = 0; ty < elevRange.ny; ty++) {
    for (let tx = 0; tx < elevRange.nx; tx++) {
      elevJobs.push(
        loadImage(ELEV_URL(Z_ELEV, elevRange.x0 + tx, elevRange.y0 + ty)).then((img) => {
          elevCtx.drawImage(img, tx * TILE, ty * TILE);
          tick();
        })
      );
    }
  }

  // ---------- satélite ----------
  const satCanvas = document.createElement('canvas');
  satCanvas.width = satRange.nx * TILE;
  satCanvas.height = satRange.ny * TILE;
  const satCtx = satCanvas.getContext('2d');
  satCtx.fillStyle = '#4a5d4e';
  satCtx.fillRect(0, 0, satCanvas.width, satCanvas.height);

  const satJobs = [];
  for (let ty = 0; ty < satRange.ny; ty++) {
    for (let tx = 0; tx < satRange.nx; tx++) {
      satJobs.push(
        loadImage(SAT_URL(Z_SAT, satRange.x0 + tx, satRange.y0 + ty))
          .then((img) => satCtx.drawImage(img, tx * TILE, ty * TILE))
          .catch(() => {}) // um tile de imagem em falta não é fatal
          .then(tick)
      );
    }
  }

  await Promise.all([...elevJobs, ...satJobs]);

  // descodificar terrarium -> metros
  const px = elevCtx.getImageData(0, 0, W, H).data;
  const heights = new Float32Array(W * H);
  let hMin = Infinity;
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const h = r * 256 + g + b / 256 - 32768;
    heights[i] = h;
    if (h < hMin) hMin = h;
  }

  const mpp = metersPerPixel(latMid, Z_ELEV); // metros por pixel de elevação
  const width = W * mpp;
  const depth = H * mpp;

  // amostragem bilinear da elevação em coordenadas de pixel
  function heightAtPixel(fx, fy) {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const dx = Math.min(1, Math.max(0, fx - x0));
    const dy = Math.min(1, Math.max(0, fy - y0));
    const h00 = heights[y0 * W + x0];
    const h10 = heights[y0 * W + x0 + 1];
    const h01 = heights[(y0 + 1) * W + x0];
    const h11 = heights[(y0 + 1) * W + x0 + 1];
    return (
      h00 * (1 - dx) * (1 - dy) +
      h10 * dx * (1 - dy) +
      h01 * (1 - dx) * dy +
      h11 * dx * dy
    );
  }

  // altura do terreno (já normalizada, y=0 no ponto mais baixo) em coordenadas de mundo
  function heightAt(wx, wz) {
    const fx = (wx + width / 2) / mpp;
    const fy = (wz + depth / 2) / mpp;
    return heightAtPixel(fx, fy) - hMin;
  }

  // lat/lon -> coordenadas de mundo (x, z); y vem de heightAt
  const originX = elevRange.x0 * TILE;
  const originY = elevRange.y0 * TILE;
  function toWorld(lat, lon) {
    const fx = lonToMercX(lon, Z_ELEV) - originX;
    const fy = latToMercY(lat, Z_ELEV) - originY;
    const wx = fx * mpp - width / 2;
    const wz = fy * mpp - depth / 2;
    return new THREE.Vector3(wx, heightAtPixel(fx, fy) - hMin, wz);
  }

  // ---------- malha ----------
  const SEG = 768;
  const geo = new THREE.PlaneGeometry(width, depth, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    pos.setY(i, heightAt(wx, wz));
  }
  geo.computeVertexNormals();

  const tex = new THREE.CanvasTexture(satCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0.0
  });

  // detail textures REAIS perto da câmara: relva em zonas verdes, rocha em
  // zonas cinzentas (escolhido pela cor do próprio satélite), com fade por
  // distância — o satélite deixa de ficar desfocado no POV
  const detailTex = makeDetailTexture(); // fallback procedural
  const detailUniforms = {
    uDetail: { value: detailTex },
    uGrass: { value: detailTex },
    uRock: { value: detailTex },
    uHasReal: { value: 0 }
  };
  let loadedCount = 0;
  const onReal = () => { if (++loadedCount === 2) detailUniforms.uHasReal.value = 1; };
  loadTex(TEX.grass, { aniso: 16 }, (t) => { detailUniforms.uGrass.value = t; onReal(); });
  loadTex(TEX.rockDiff, { aniso: 16 }, (t) => { detailUniforms.uRock.value = t; onReal(); });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, detailUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uDetail;\nuniform sampler2D uGrass;\nuniform sampler2D uRock;\nuniform float uHasReal;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float dCam = distance(vWPos, cameraPosition);
          float fade = 1.0 - smoothstep(300.0, 1100.0, dCam);
          if (fade > 0.001) {
            if (uHasReal > 0.5) {
              // quão "verde" é o satélite aqui -> relva vs rocha
              float greenness = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 7.0 + 0.45, 0.0, 1.0);
              vec3 gNear = texture2D(uGrass, vWPos.xz / 3.0).rgb;
              vec3 gFar  = texture2D(uGrass, vWPos.xz / 17.0).rgb;
              vec3 rNear = texture2D(uRock,  vWPos.xz / 5.0).rgb;
              vec3 rFar  = texture2D(uRock,  vWPos.xz / 23.0).rgb;
              vec3 grass = gNear * 0.62 + gFar * 0.38;
              vec3 rock  = rNear * 0.62 + rFar * 0.38;
              // normalizar luminância média (~0.5) para não escurecer o satélite
              vec3 detail = mix(rock * 2.1, grass * 1.9, greenness);
              diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * detail, 0.55 * fade);
            } else {
              float d1 = texture2D(uDetail, vWPos.xz / 1.5).r;
              float d2 = texture2D(uDetail, vWPos.xz / 11.0).r;
              diffuseColor.rgb *= mix(1.0, (d1 * 0.6 + d2 * 0.4) * 2.0, 0.6 * fade);
            }
          }
        }`
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  // amostragem da cor do satélite (para colocar vegetação/rochas) — cópia reduzida
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 1024;
  sampleCanvas.height = Math.round((1024 * satCanvas.height) / satCanvas.width);
  const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(satCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const sdata = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  function satSample(wx, wz) {
    const u = Math.min(0.999, Math.max(0, (wx + width / 2) / width));
    const v = Math.min(0.999, Math.max(0, (wz + depth / 2) / depth));
    const i = ((v * sampleCanvas.height) | 0) * sampleCanvas.width + ((u * sampleCanvas.width) | 0);
    return [sdata[i * 4], sdata[i * 4 + 1], sdata[i * 4 + 2]];
  }

  return { mesh, heightAt, toWorld, satSample, size: { width, depth }, hMin };
}
