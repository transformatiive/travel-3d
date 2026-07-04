import * as THREE from 'three';

function makeLabelTexture(text, sub, color) {
  const pad = 24;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '600 44px "Segoe UI", system-ui, sans-serif';
  const w = Math.max(ctx.measureText(text).width, 160) + pad * 2;
  c.width = Math.ceil(w);
  c.height = 132;
  const g = c.getContext('2d');

  // balão
  g.fillStyle = 'rgba(10, 16, 26, 0.82)';
  g.strokeStyle = color;
  g.lineWidth = 4;
  const r = 20;
  g.beginPath();
  g.roundRect(2, 2, c.width - 4, 96, r);
  g.fill();
  g.stroke();
  // seta
  g.beginPath();
  g.moveTo(c.width / 2 - 14, 98);
  g.lineTo(c.width / 2 + 14, 98);
  g.lineTo(c.width / 2, 128);
  g.closePath();
  g.fillStyle = color;
  g.fill();

  g.fillStyle = '#f2f6fa';
  g.font = '600 40px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, c.width / 2, 46);
  g.fillStyle = 'rgba(200, 214, 230, 0.9)';
  g.font = '400 26px "Segoe UI", system-ui, sans-serif';
  g.fillText(sub, c.width / 2, 82);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

/** Cria sprites de etiqueta para cada paragem. Devolve um Group. */
export function buildMarkers(stops, stopPoints) {
  const group = new THREE.Group();
  stops.forEach((s, i) => {
    const color = s.lake ? '#5ec8f2' : '#ffb340';
    const { tex, aspect } = makeLabelTexture(s.name, `${s.alt} m`, color);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false });
    const sprite = new THREE.Sprite(mat);
    const h = 64;
    sprite.scale.set(h * aspect, h, 1);
    const p = stopPoints[i];
    sprite.position.set(p.x, p.y + 80, p.z);
    sprite.renderOrder = 10;
    sprite.userData = { stopIndex: i, baseH: h, aspect };
    group.add(sprite);
  });
  return group;
}
