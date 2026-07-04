import * as THREE from 'three';
import { TEX, loadTex } from './textures.js';

/**
 * Ponte dei Salti (Lavertezzo): ponte de pedra medieval com dois arcos.
 * Silhueta lateral extrudida (topo em dupla corcova + dois arcos em D),
 * posicionada entre os extremos reais do OSM.
 */
export function buildBridge(terrain, cfg) {
  const A = terrain.toWorld(cfg.a.lat, cfg.a.lon);
  const B = terrain.toWorld(cfg.b.lat, cfg.b.lon);
  const span = Math.hypot(B.x - A.x, B.z - A.z);
  const L = Math.max(40, span * 1.15); // comprimento total com encontros

  // leito do rio sob a ponte (mínimo local) — base dos arcos
  const mid = new THREE.Vector3((A.x + B.x) / 2, 0, (A.z + B.z) / 2);
  let bed = Infinity;
  for (let dx = -12; dx <= 12; dx += 6)
    for (let dz = -12; dz <= 12; dz += 6)
      bed = Math.min(bed, terrain.heightAt(mid.x + dx, mid.z + dz));

  // geometria no plano XY: x ao longo da ponte, y para cima (base em y=0)
  const r1 = L * 0.17, r2 = L * 0.23;       // raios dos dois arcos
  const c1 = L * 0.30, c2 = L * 0.68;       // centros dos arcos
  const deck = (x) => {
    const a1 = r1 * r1 - (x - c1) * (x - c1);
    const a2 = r2 * r2 - (x - c2) * (x - c2);
    const arch = Math.max(a1 > 0 ? Math.sqrt(a1) : 0, a2 > 0 ? Math.sqrt(a2) : 0);
    return Math.max(arch + 1.6, 3.2);
  };

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * L;
    shape.lineTo(x, deck(x));
  }
  shape.lineTo(L, 0);
  shape.lineTo(0, 0);
  // arcos (furos em D, base ligeiramente acima da base da forma)
  for (const [c, r] of [[c1, r1], [c2, r2]]) {
    const hole = new THREE.Path();
    hole.moveTo(c - r, 0.05);
    hole.absarc(c, 0.05, r, Math.PI, 0, true);
    hole.lineTo(c - r, 0.05);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.4, bevelEnabled: false });
  geo.translate(-L / 2, 0, -1.7);
  // UVs à escala do mundo para a textura de pedra
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);

  const mat = new THREE.MeshStandardMaterial({ color: 0xc7c9c4, roughness: 1 });
  loadTex(TEX.rockDiff, {}, (t) => { mat.map = t; mat.needsUpdate = true; });
  loadTex(TEX.rockNor, { srgb: false }, (t) => { mat.normalMap = t; mat.needsUpdate = true; });

  const bridge = new THREE.Mesh(geo, mat);
  bridge.castShadow = bridge.receiveShadow = true;

  const group = new THREE.Group();
  group.add(bridge);
  group.position.set(mid.x, bed - 0.5, mid.z);
  group.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);

  // ponto do tabuleiro para elevar a rota por cima da ponte
  const deckY = bed - 0.5 + deck(L / 2);
  return { group, mid, deckY, halfLen: L / 2 };
}
