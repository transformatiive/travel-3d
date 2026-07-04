import * as THREE from 'three';

// Relva 3D dinâmica: um anel de tufos instanciados que se recoloca à volta da
// câmara quando ela se move. É o que dá detalhe real ao chão no POV — a
// textura de satélite sozinha fica sempre desfocada a 1-2 m dos olhos.

const COUNT = 6000;
const RADIUS = 60;       // raio do anel de relva à volta da câmara
const REPOSITION_DIST = 18;

function makeBladeTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  let s = 424242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x0 = 8 + rnd() * 112;
    const lean = (rnd() - 0.5) * 30;
    const h = 55 + rnd() * 70;
    const w = 3 + rnd() * 4;
    const g = 120 + rnd() * 90;
    ctx.strokeStyle = `rgb(${g * 0.55}, ${g}, ${g * 0.45})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, 128);
    ctx.quadraticCurveTo(x0 + lean * 0.4, 128 - h * 0.6, x0 + lean, 128 - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildGrass(terrain) {
  const blade = makeBladeTexture();

  // dois planos cruzados por tufo
  const p1 = new THREE.PlaneGeometry(0.55, 0.3);
  const p2 = p1.clone().rotateY(Math.PI / 2);
  p1.translate(0, 0.15, 0); p2.translate(0, 0.15, 0);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([...p1.attributes.position.array, ...p2.attributes.position.array]);
  const nor = new Float32Array([...p1.attributes.normal.array, ...p2.attributes.normal.array]);
  const uv = new Float32Array([...p1.attributes.uv.array, ...p2.attributes.uv.array]);
  const idx = [...p1.index.array, ...Array.from(p2.index.array, (i) => i + 4)];
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);

  const mat = new THREE.MeshStandardMaterial({
    map: blade,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 1
  });

  const inst = new THREE.InstancedMesh(geo, mat, COUNT);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const last = new THREE.Vector3(1e9, 0, 1e9);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function reposition(center) {
    const hw = terrain.size.width / 2 - 30, hd = terrain.size.depth / 2 - 30;
    for (let i = 0; i < COUNT; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 2 + Math.sqrt(rnd()) * RADIUS;
      const x = Math.min(hw, Math.max(-hw, center.x + Math.cos(a) * r));
      const z = Math.min(hd, Math.max(-hd, center.z + Math.sin(a) * r));
      const h = terrain.heightAt(x, z);
      const alt = h + terrain.hMin;
      const [cr, cg, cb] = terrain.satSample(x, z);
      // só em zonas com vegetação rasteira: pixel esverdeado, abaixo dos ~2650 m
      const grassy = cg > cr - 4 && cg > cb + 4 && alt < 2650;
      if (grassy) {
        dummy.position.set(x, h, z);
        dummy.rotation.y = rnd() * Math.PI;
        const s = 0.5 + rnd() * 0.7;
        dummy.scale.set(s, s * (0.7 + rnd() * 0.6), s);
      } else {
        dummy.position.set(0, -1000, 0);
        dummy.scale.setScalar(0.001);
      }
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      // tingir com a cor local do satélite para fundir com o chão
      color.setRGB(cr / 255, cg / 255, cb / 255).multiplyScalar(1.25);
      inst.setColorAt(i, color);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }

  function update(cameraPos) {
    if (cameraPos.distanceTo(last) > REPOSITION_DIST) {
      last.copy(cameraPos);
      reposition(cameraPos);
    }
  }

  return { mesh: inst, update };
}
