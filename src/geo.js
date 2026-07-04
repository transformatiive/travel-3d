// Helpers de projeção Web Mercator <-> mundo 3D.
// O terreno é construído em espaço de "pixels mercator" de um zoom de referência,
// escalado para metros aproximados na latitude central.

export const TILE = 256;

export function lonToMercX(lon, z) {
  return ((lon + 180) / 360) * Math.pow(2, z) * TILE;
}

export function latToMercY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    Math.pow(2, z) * TILE
  );
}

// metros reais por pixel mercator no zoom z, na latitude dada
export function metersPerPixel(lat, z) {
  return (40075016.686 / (TILE * Math.pow(2, z))) * Math.cos((lat * Math.PI) / 180);
}

export function tileRange(bounds, z) {
  const x0 = Math.floor(lonToMercX(bounds.lonMin, z) / TILE);
  const x1 = Math.floor(lonToMercX(bounds.lonMax, z) / TILE);
  const y0 = Math.floor(latToMercY(bounds.latMax, z) / TILE); // latMax = norte = y menor
  const y1 = Math.floor(latToMercY(bounds.latMin, z) / TILE);
  return { x0, x1, y0, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}
