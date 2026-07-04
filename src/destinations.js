import { LAKES } from './lakes.js';
import { VERZASCA_RIVER } from './rivers-verzasca.js';

// Cada destino define: região (bounds/satZoom), itinerário (stops/via),
// água (lagos com polígono OSM, lago plano detetado no DEM, ou rios),
// vegetação (linha de árvore / faixa de rochas) e extras 3D próprios.
export const DESTINATIONS = {
  zermatt: {
    name: 'Rota dos <span>5 Lagos</span> — Zermatt',
    tab: 'Zermatt — 5 Lagos',
    subtitle: '≈ 9,8 km · ≈ 3 h · Blauherd → Sunnegga',
    bounds: { lonMin: 7.74, lonMax: 7.81, latMin: 45.98, latMax: 46.03 },
    satZoom: 16,
    treeLine: 2250,
    rockBand: [2250, 2900],
    tourSeconds: 160,
    stops: [
      { id: 'blauherd', name: 'Blauherd', alt: 2571, lake: false, lat: 46.0166, lon: 7.7883, desc: 'Início — estação do teleférico' },
      { id: 'stellisee', name: 'Stellisee', alt: 2537, lake: true, lat: 46.0134, lon: 7.8004, desc: 'Lago 1 — reflexo do Matterhorn' },
      { id: 'grindjisee', name: 'Grindjisee', alt: 2334, lake: true, lat: 46.0115, lon: 7.7912, desc: 'Lago 2 — flores raras' },
      { id: 'grunsee', name: 'Grünsee', alt: 2300, lake: true, lat: 46.0056, lon: 7.7857, desc: 'Lago 3 — paisagem lunar' },
      { id: 'moosjisee', name: 'Moosjisee', alt: 2140, lake: true, lat: 46.0104, lon: 7.7796, desc: 'Lago 4 — água turquesa glaciar' },
      { id: 'leisee', name: 'Leisee', alt: 2232, lake: true, lat: 46.0150, lon: 7.7724, desc: 'Lago 5 — praia e zona de banho' },
      { id: 'sunnegga', name: 'Sunnegga', alt: 2288, lake: false, lat: 46.0171, lon: 7.7700, desc: 'Fim — funicular para Zermatt' }
    ],
    via: {
      'blauherd->stellisee': [[46.0152, 7.7955]],
      'stellisee->grindjisee': [[46.0121, 7.7962]],
      'grindjisee->grunsee': [[46.0085, 7.7885]],
      'grunsee->moosjisee': [[46.0068, 7.7822]],
      'moosjisee->leisee': [[46.0128, 7.7758]],
      'leisee->sunnegga': []
    },
    lakes: LAKES
  },

  lugano: {
    name: 'Trilho do <span>Monte San Salvatore</span> — Lugano',
    tab: 'Lugano — S. Salvatore',
    subtitle: '≈ 12 km · ≈ 4 h · Paradiso → Morcote',
    bounds: { lonMin: 8.88, lonMax: 8.98, latMin: 45.91, latMax: 46.01 },
    satZoom: 15,
    treeLine: 1500,
    rockBand: [1000, 2000],
    tourSeconds: 170,
    stops: [
      { id: 'paradiso', name: 'Paradiso', alt: 274, lake: false, lat: 45.98973, lon: 8.9462, desc: 'Início — funicular do San Salvatore' },
      { id: 'salvatore', name: 'Monte San Salvatore', alt: 912, lake: false, lat: 45.97711, lon: 8.9473, desc: 'Miradouro 360° sobre o lago' },
      { id: 'ciona', name: 'Ciona', alt: 684, lake: false, lat: 45.96674, lon: 8.94006, desc: 'Aldeia na crista' },
      { id: 'carona', name: 'Carona', alt: 602, lake: false, lat: 45.95746, lon: 8.93579, desc: 'Aldeia histórica' },
      { id: 'sangrato', name: 'Parco San Grato', alt: 690, lake: false, lat: 45.95011, lon: 8.93141, desc: 'Jardim botânico panorâmico' },
      { id: 'morcote', name: 'Morcote', alt: 272, lake: true, lat: 45.92268, lon: 8.91505, desc: 'Fim — "a pérola do Ceresio"' }
    ],
    via: {
      'paradiso->salvatore': [[45.9840, 8.9435]],
      'salvatore->ciona': [[45.9720, 8.9430]],
      'ciona->carona': [],
      'carona->sangrato': [[45.9530, 8.9330]],
      'sangrato->morcote': [[45.9400, 8.9210], [45.9300, 8.9165]]
    },
    lakes: [],
    // Lago di Lugano: detetado automaticamente no DEM (superfície plana a 271 m)
    flatWater: { altitude: 271, color: 0x1d4e63 }
  },

  verzasca: {
    name: 'Valle <span>Verzasca</span> — Ponte dei Salti',
    tab: 'Verzasca — Lavertezzo',
    subtitle: '≈ 5 km · ≈ 2 h · Sentierone por Lavertezzo',
    bounds: { lonMin: 8.79, lonMax: 8.875, latMin: 46.246, latMax: 46.274 },
    satZoom: 16,
    treeLine: 2000,
    rockBand: [450, 2400],
    tourSeconds: 120,
    stops: [
      { id: 'aquino', name: 'Aquino', alt: 560, lake: false, lat: 46.2650, lon: 8.8180, desc: 'Início — margem do rio' },
      { id: 'pozz', name: 'Pozz di Vacch', alt: 542, lake: true, lat: 46.2603, lon: 8.8340, desc: 'Pozas de água esmeralda' },
      { id: 'ponte', name: 'Ponte dei Salti', alt: 540, lake: false, lat: 46.26001, lon: 8.8359, desc: 'Ponte medieval de arco duplo' },
      { id: 'lavertezzo', name: 'Lavertezzo', alt: 536, lake: false, lat: 46.2592, lon: 8.8386, desc: 'Aldeia — Osteria Vittoria' },
      { id: 'sentierone', name: 'Sentierone (jusante)', alt: 520, lake: true, lat: 46.2540, lon: 8.8470, desc: 'Fim — rochas polidas e pozas' }
    ],
    via: {
      'aquino->pozz': [[46.2635, 8.8225], [46.2620, 8.8280], [46.2612, 8.8320]],
      'pozz->ponte': [[46.259837, 8.835759]],   // entrada da ponte (extremo real)
      'ponte->lavertezzo': [[46.260180, 8.836077]], // saída da ponte
      'lavertezzo->sentierone': [[46.2570, 8.8425]]
    },
    lakes: [],
    rivers: { polys: VERZASCA_RIVER, color: 0x2fa8a0 },
    bridge: {
      // extremos reais da Ponte dei Salti (OSM way 24341688)
      a: { lat: 46.259837, lon: 8.835759 },
      b: { lat: 46.260180, lon: 8.836077 }
    }
  }
};

export function currentDestination() {
  const key = new URLSearchParams(location.search).get('dest');
  return DESTINATIONS[key] ? key : 'zermatt';
}
