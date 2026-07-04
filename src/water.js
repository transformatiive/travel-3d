import * as THREE from 'three';
import { LAKES } from './lakes.js';

// textura de normais procedural (ondulação) partilhada por todos os lagos
function makeWaterNormalTexture(size = 256) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      h[y * size + x] =
        Math.sin(u * 3 + v * 1.7) * 0.5 +
        Math.sin(u * 7 - v * 4.3 + 1.3) * 0.3 +
        Math.sin(-u * 11 + v * 9 + 4.1) * 0.2;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const s = 2.2; // força das normais
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) * s;
      const dy = (h[yp * size + x] - h[ym * size + x]) * s;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ponto-em-polígono (ray casting) no plano XZ
function insidePolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z, xj = pts[j].x, zj = pts[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// grelha regular sobre a bounding box do polígono; mantém células com o centro
// dentro do lago. Triangulação trivial e sempre bem orientada (normal +Y).
function clipGridToPolygon(pts, N) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const dx = (maxX - minX) / N, dz = (maxZ - minZ) / N;
  if (!(dx > 0 && dz > 0)) return null;

  const verts = [], uvs = [], idx = [];
  const vertIndex = new Map();
  const getVert = (i, j) => {
    const key = i * (N + 2) + j;
    if (vertIndex.has(key)) return vertIndex.get(key);
    const x = minX + i * dx, z = minZ + j * dz;
    verts.push(x, 0, z);
    uvs.push(x / 6, z / 6);
    const vi = verts.length / 3 - 1;
    vertIndex.set(key, vi);
    return vi;
  };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const cx = minX + (i + 0.5) * dx, cz = minZ + (j + 0.5) * dz;
      if (!insidePolygon(cx, cz, pts)) continue;
      const a = getVert(i, j), b = getVert(i + 1, j), c = getVert(i + 1, j + 1), d = getVert(i, j + 1);
      idx.push(a, c, b, a, d, c); // CCW visto de cima (normal +Y)
    }
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Superfícies de água animadas com o contorno real (OSM) de cada lago. */
export function buildLakes(terrain) {
  const group = new THREE.Group();
  const normalTex = makeWaterNormalTexture();
  const materials = [];

  for (const lake of LAKES) {
    let world = lake.pts.map(([lat, lon]) => terrain.toWorld(lat, lon));
    // OSM fecha o polígono repetindo o 1º nó — remover duplicados consecutivos
    // (pontos repetidos rebentam a triangulação do Shape em leques gigantes)
    world = world.filter((p, i) => i === 0 || p.distanceTo(world[i - 1]) > 0.5);
    if (world.length > 1 && world[0].distanceTo(world[world.length - 1]) < 0.5) world.pop();
    if (world.length < 3) continue;
    // nível da água: mediana das alturas na margem, ligeiramente acima do fundo
    const ys = world.map((p) => p.y).sort((a, b) => a - b);
    const level = ys[Math.floor(ys.length / 2)] + 0.4;

    // malha em grelha recortada pelo polígono — a triangulação earcut de
    // contornos OSM irregulares produz triângulos invertidos/esticados
    const geo = clipGridToPolygon(world, 34);
    if (!geo) continue;

    const mat = new THREE.MeshPhysicalMaterial({
      color: lake.color,
      roughness: 0.08,
      metalness: 0,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.4, 0.4),
      transparent: true,
      opacity: 0.9,
      envMapIntensity: 1.4,
      side: THREE.DoubleSide
    });
    materials.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = level;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // animação: deslizar as normais (duas direções ligeiramente diferentes por lago)
  function update(t) {
    normalTex.offset.set(t * 0.008, t * 0.005);
  }

  return { group, update, materials };
}
