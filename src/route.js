import * as THREE from 'three';

/**
 * Constrói a curva do trilho agarrada ao terreno e o tubo visível.
 * stops/via vêm da configuração do destino (destinations.js).
 * Devolve { curve, group, stopPoints } — stopPoints[i] é o Vector3 de cada paragem.
 */
export function buildRoute(terrain, stops, via, lift) {
  const raw = [];
  const stopPoints = [];
  for (let i = 0; i < stops.length; i++) {
    const p = terrain.toWorld(stops[i].lat, stops[i].lon);
    stopPoints.push(p.clone());
    raw.push(p);
    if (i < stops.length - 1) {
      const key = `${stops[i].id}->${stops[i + 1].id}`;
      for (const [lat, lon] of via[key] || []) raw.push(terrain.toWorld(lat, lon));
    }
  }

  // primeira passagem: curva pelos waypoints; segunda: reamostrar e colar ao terreno
  const roughCurve = new THREE.CatmullRomCurve3(raw, false, 'centripetal', 0.5);
  const N = 900;
  const glued = [];
  for (let i = 0; i <= N; i++) {
    const p = roughCurve.getPoint(i / N);
    p.y = terrain.heightAt(p.x, p.z) + 1.2;
    if (lift) p.y = lift(p.x, p.z, p.y); // lift opcional (ex.: passar por cima da ponte)
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
