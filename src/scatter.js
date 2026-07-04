import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Vegetação e rochas procedurais colocadas com regras reais:
// - árvores (larícios/abetos) abaixo da linha de árvore (~2150 m) em zonas
//   que a imagem de satélite mostra como verde-escuro (floresta)
// - rochedos acima dos ~2250 m em terreno cinzento e não muito inclinado
// Determinístico (PRNG com semente) para o modo foto reproduzir a mesma cena.

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slopeAt(terrain, x, z) {
  const d = 12;
  const h0 = terrain.heightAt(x - d, z), h1 = terrain.heightAt(x + d, z);
  const h2 = terrain.heightAt(x, z - d), h3 = terrain.heightAt(x, z + d);
  return Math.hypot(h1 - h0, h3 - h2) / (2 * d); // tangente do declive
}

function makeTreeGeometries() {
  // árvore de coníferas low-poly: tronco + 3 camadas de copa
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 6);
  trunk.translate(0, 1.6, 0);
  const cones = [];
  const layers = [
    [3.4, 5.2, 2.6], // [raio, altura do cone, y base]
    [2.6, 4.4, 5.2],
    [1.7, 3.6, 7.6]
  ];
  for (const [r, h, y] of layers) {
    const c = new THREE.ConeGeometry(r, h, 7);
    c.translate(0, y + h / 2, 0);
    cones.push(c);
  }
  return { trunk, canopyLayers: cones };
}

function mergeGeoms(geoms) {
  // merge manual simples (posições + normais) — todas non-indexed
  const nonIndexed = geoms.map((g) => g.toNonIndexed());
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

export function buildScatter(terrain, routeCurve) {
  // manter o trilho limpo: sem rochas/árvores em cima do caminho
  const routePts = [];
  if (routeCurve) for (let i = 0; i <= 220; i++) routePts.push(routeCurve.getPoint(i / 220));
  function nearRoute(x, z, r2) {
    for (const p of routePts) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
  const rnd = mulberry32(19052);
  const { width, depth } = terrain.size;
  const sat = terrain.satSample;

  const TREE_LINE = 2250; // altitude (m) acima da qual não há floresta
  const group = new THREE.Group();

  // ---------- candidatos ----------
  const trees = [];
  const rocks = [];
  const ATTEMPTS = 450000;
  for (let i = 0; i < ATTEMPTS; i++) {
    const x = (rnd() - 0.5) * (width - 200);
    const z = (rnd() - 0.5) * (depth - 200);
    const h = terrain.heightAt(x, z);
    const alt = h + terrain.hMin;
    const [r, g, b] = sat(x, z);

    if (alt < TREE_LINE && trees.length < 70000) {
      // floresta: pixel esverdeado-escuro, declive moderado
      const greenish = g > r + 3 && g > b + 2 && g < 145;
      if (greenish && slopeAt(terrain, x, z) < 1.25 && !nearRoute(x, z, 36)) {
        trees.push({ x, z, h, shade: 0.75 + rnd() * 0.5, s: 0.7 + rnd() * 0.9 });
      }
    } else if (alt > 2250 && alt < 2900 && rocks.length < 6000) {
      // rochedos: pixel acinzentado, com alguma probabilidade
      const gray = Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && r > 70 && r < 170;
      if (gray && rnd() < 0.35 && slopeAt(terrain, x, z) < 1.2 && !nearRoute(x, z, 144)) {
        rocks.push({ x, z, h, tone: 0.6 + rnd() * 0.5, s: 0.4 + rnd() * 1.4, ry: rnd() * Math.PI });
      }
    }
  }

  const dummy = new THREE.Object3D();

  // ---------- árvores ----------
  if (trees.length) {
    const { trunk, canopyLayers } = makeTreeGeometries();
    const canopy = mergeGeoms(canopyLayers);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2c4a26, roughness: 0.95 });

    const trunkInst = new THREE.InstancedMesh(trunk, trunkMat, trees.length);
    const canopyInst = new THREE.InstancedMesh(canopy, canopyMat, trees.length);
    const shade = new THREE.Color();
    trees.forEach((t, i) => {
      dummy.position.set(t.x, t.h - 0.2, t.z);
      dummy.scale.setScalar(t.s);
      dummy.rotation.y = t.shade * 7;
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      canopyInst.setMatrixAt(i, dummy.matrix);
      canopyInst.setColorAt(i, shade.setScalar(t.shade));
    });
    trunkInst.castShadow = canopyInst.castShadow = true;
    canopyInst.receiveShadow = true;
    group.add(trunkInst, canopyInst);
  }

  // ---------- rochas ----------
  if (rocks.length) {
    // IcosahedronGeometry é non-indexed: soldar vértices primeiro, senão a
    // deformação aleatória rasga as faces (cada cópia desloca-se diferente)
    const rockGeo = mergeVertices(new THREE.IcosahedronGeometry(1.4, 1));
    const rp = rockGeo.attributes.position;
    const rrnd = mulberry32(7331);
    for (let i = 0; i < rp.count; i++) {
      const k = 0.75 + rrnd() * 0.5;
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * (0.55 + rrnd() * 0.3), rp.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8880, roughness: 1 });
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    const tone = new THREE.Color();
    rocks.forEach((r, i) => {
      dummy.position.set(r.x, r.h + 0.1, r.z);
      dummy.scale.setScalar(r.s);
      dummy.rotation.set(0, r.ry, 0);
      dummy.updateMatrix();
      rockInst.setMatrixAt(i, dummy.matrix);
      rockInst.setColorAt(i, tone.setScalar(r.tone));
    });
    rockInst.castShadow = rockInst.receiveShadow = true;
    group.add(rockInst);
  }

  return { group, counts: { trees: trees.length, rocks: rocks.length } };
}
