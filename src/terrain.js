import * as THREE from 'three';
import { TILE, tileRange, lonToMercX, latToMercY, metersPerPixel } from './geo.js';

// Elevação real: tiles Terrarium (Mapzen/AWS Open Data, sem chave)
const ELEV_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// Imagem de satélite: ESRI World Imagery (uso livre para visualização, sem chave)
const SAT_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const Z_ELEV = 13; // resolução da malha de elevação
const Z_SAT = 16;  // resolução da textura de satélite (Z_ELEV + 3 => 8x)

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
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.95,
    metalness: 0.0
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  return { mesh, heightAt, toWorld, size: { width, depth }, hMin };
}
