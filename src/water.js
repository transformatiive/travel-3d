import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { LAKES } from './lakes.js';
import { TEX } from './textures.js';

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

// ponto mais próximo no contorno do polígono (para suavizar a margem)
function nearestOnPolygon(x, z, pts) {
  let bx = x, bz = z, bd = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].x, az = pts[j].z, cx = pts[i].x, cz = pts[i].z;
    const dx = cx - ax, dz = cz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    const px = ax + t * dx, pz = az + t * dz;
    const d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  return [bx, bz];
}

// grelha regular sobre a bounding box do polígono; mantém células que tocam o
// lago e projeta os vértices exteriores na margem real — contorno suave.
// Triangulação trivial e sempre bem orientada (normal +Y).
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
  // suavizar a margem: vértices fora do polígono deslizam para o contorno real
  for (let v = 0; v < verts.length; v += 3) {
    const x = verts[v], z = verts[v + 2];
    if (!insidePolygon(x, z, pts)) {
      const [nx, nz] = nearestOnPolygon(x, z, pts);
      verts[v] = nx; verts[v + 2] = nz;
      uvs[(v / 3) * 2] = nx / 6; uvs[(v / 3) * 2 + 1] = nz / 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Superfícies de água com o contorno real (OSM) de cada lago.
 * Shader Water (three.js): reflexos planares em tempo real + normais reais.
 * Mantém-se uma versão MeshPhysical simples para o modo foto (path tracer
 * não suporta ShaderMaterial).
 */
export function buildLakes(terrain, sunDir) {
  const group = new THREE.Group();
  const normalTex = makeWaterNormalTexture(); // fallback procedural
  const realNormals = new THREE.TextureLoader()
    .setCrossOrigin('anonymous')
    .load(TEX.waterNormals, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  realNormals.wrapS = realNormals.wrapT = THREE.RepeatWrapping;
  const materials = [];
  const waters = [];
  const photoMeshes = [];

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
    const geo = clipGridToPolygon(world, 48);
    if (!geo) continue;

    // Water assume geometria no plano XY + rotation.x=-90° (usa essa rotação
    // para calcular o plano de reflexão) — converter XZ -> XY
    const geoXY = geo.clone();
    {
      const p = geoXY.attributes.position;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i), -p.getZ(i), 0);
      geoXY.computeVertexNormals();
    }
    const water = new Water(geoXY, {
      textureWidth: 384,
      textureHeight: 384,
      waterNormals: realNormals,
      sunDirection: sunDir ? sunDir.clone() : new THREE.Vector3(0.5, 1, 0.3).normalize(),
      sunColor: 0xfff2dd,
      waterColor: lake.color,
      distortionScale: 1.6,
      fog: true
    });
    water.material.uniforms.size.value = 6.0; // escala das ondas (~física)
    water.rotation.x = -Math.PI / 2;
    water.position.y = level;
    water.renderOrder = 1;
    group.add(water);
    waters.push(water);

    // versão simples para o modo foto (path tracing)
    const photoMat = new THREE.MeshPhysicalMaterial({
      color: lake.color, roughness: 0.05, metalness: 0,
      normalMap: normalTex, normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true, opacity: 0.85
    });
    materials.push(photoMat);
    const photoMesh = new THREE.Mesh(geo, photoMat);
    photoMesh.position.y = level;
    photoMesh.visible = false;
    group.add(photoMesh);
    photoMeshes.push(photoMesh);
  }

  function update(t) {
    for (const w of waters) w.material.uniforms.time.value = t * 0.5;
    normalTex.offset.set(t * 0.008, t * 0.005);
  }

  // trocar para a versão simples durante o modo foto
  function setPhotoMode(on) {
    waters.forEach((w) => (w.visible = !on));
    photoMeshes.forEach((m) => (m.visible = on));
  }

  return { group, update, materials, setPhotoMode };
}
