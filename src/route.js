import * as THREE from 'three';

// Itinerário: 5-Seen-Wanderung (rota dos 5 lagos), Zermatt.
// Blauherd -> Stellisee -> Grindjisee -> Grünsee -> Moosjisee -> Leisee -> Sunnegga
// Coordenadas reais (OpenStreetMap)
export const STOPS = [
  { id: 'blauherd',  name: 'Blauherd',   alt: 2571, lake: false, lat: 46.0166, lon: 7.7883, desc: 'Início — estação do teleférico' },
  { id: 'stellisee', name: 'Stellisee',  alt: 2537, lake: true,  lat: 46.0134, lon: 7.8004, desc: 'Lago 1 — reflexo do Matterhorn' },
  { id: 'grindjisee', name: 'Grindjisee', alt: 2334, lake: true, lat: 46.0115, lon: 7.7912, desc: 'Lago 2 — flores raras' },
  { id: 'grunsee',   name: 'Grünsee',    alt: 2300, lake: true,  lat: 46.0056, lon: 7.7857, desc: 'Lago 3 — paisagem lunar' },
  { id: 'moosjisee', name: 'Moosjisee',  alt: 2140, lake: true,  lat: 46.0104, lon: 7.7796, desc: 'Lago 4 — água turquesa glaciar' },
  { id: 'leisee',    name: 'Leisee',     alt: 2232, lake: true,  lat: 46.0150, lon: 7.7724, desc: 'Lago 5 — praia e zona de banho' },
  { id: 'sunnegga',  name: 'Sunnegga',   alt: 2288, lake: false, lat: 46.0171, lon: 7.7700, desc: 'Fim — funicular para Zermatt' }
];

// pontos intermédios aproximados para dar forma ao trilho entre paragens
const VIA = {
  'blauherd->stellisee': [[46.0152, 7.7955]],
  'stellisee->grindjisee': [[46.0121, 7.7962]],
  'grindjisee->grunsee': [[46.0085, 7.7885]],
  'grunsee->moosjisee': [[46.0068, 7.7822]],
  'moosjisee->leisee': [[46.0128, 7.7758]],
  'leisee->sunnegga': []
};

/**
 * Constrói a curva do trilho agarrada ao terreno e o tubo visível.
 * Devolve { curve, tube, stopPoints } — stopPoints[i] é o Vector3 de cada paragem.
 */
export function buildRoute(terrain) {
  const raw = [];
  const stopPoints = [];
  for (let i = 0; i < STOPS.length; i++) {
    const p = terrain.toWorld(STOPS[i].lat, STOPS[i].lon);
    stopPoints.push(p.clone());
    raw.push(p);
    if (i < STOPS.length - 1) {
      const key = `${STOPS[i].id}->${STOPS[i + 1].id}`;
      for (const [lat, lon] of VIA[key] || []) raw.push(terrain.toWorld(lat, lon));
    }
  }

  // primeira passagem: curva pelos waypoints; segunda: reamostrar e colar ao terreno
  const roughCurve = new THREE.CatmullRomCurve3(raw, false, 'centripetal', 0.5);
  const N = 900;
  const glued = [];
  for (let i = 0; i <= N; i++) {
    const p = roughCurve.getPoint(i / N);
    p.y = terrain.heightAt(p.x, p.z) + 1.2;
    glued.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(glued, false, 'catmullrom', 0.0);

  const tubeMat = new THREE.MeshBasicMaterial({ color: 0xff6a00, toneMapped: false });

  // versão "grossa" legível de longe (órbita / tour aéreo)
  const tubeFar = new THREE.Mesh(new THREE.TubeGeometry(curve, 1200, 3.0, 8, false), tubeMat);

  // versão fina à escala humana, para o modo POV (uma fita de trilho no chão)
  const tubeNearMat = new THREE.MeshBasicMaterial({
    color: 0xff8c2a, toneMapped: false, transparent: true, opacity: 0.55, depthWrite: false
  });
  const tubeNear = new THREE.Mesh(new THREE.TubeGeometry(curve, 1600, 0.28, 6, false), tubeNearMat);
  tubeNear.position.y = -1.1; // a curva está a +1.2 do chão: baixar até ficar meio enterrada, como uma marca de trilho
  tubeNear.visible = false;

  // tracejado por cima do tubo para leitura de direção (esferas espaçadas)
  const dotGeo = new THREE.SphereGeometry(2.6, 10, 10);
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, 90);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 90; i++) {
    const p = curve.getPoint(i / 89);
    m.setPosition(p.x, p.y + 1.5, p.z);
    dots.setMatrixAt(i, m);
  }

  const group = new THREE.Group();
  group.add(tubeFar, tubeNear, dots);

  return { curve, group, stopPoints, tubeFar, tubeNear, dots };
}

/** Marcador animado do "caminhante" que percorre a rota durante o tour. */
export function buildHiker() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(4, 10, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xe63946, emissive: 0xe63946, emissiveIntensity: 0.5 })
  );
  body.position.y = 12;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(12, 1.6, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2;
  g.add(body, ring);
  return g;
}
