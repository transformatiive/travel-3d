# Travel 3D — Itinerários de viagem em mundo aberto

App web (browser) que mostra itinerários de viagem em 3D com gráficos estilo gameplay, construída com **Three.js**.

Primeiro itinerário: **5-Seen-Wanderung (rota dos 5 lagos)** — Zermatt, Suíça
`Blauherd → Stellisee → Grindjisee → Grünsee → Moosjisee → Leisee → Sunnegga`

## Como funciona

- **Terreno real**: elevação descarregada em runtime dos tiles *Terrarium* (Mapzen/AWS Open Data, sem chave de API) e convertida numa malha 3D de alta densidade.
- **Textura de satélite**: tiles do *ESRI World Imagery* compostos num atlas e drapejados sobre o terreno — a mesma zona geográfica do screenshot de referência (vale de Zermatt, Sunnegga, Rothorn, Findeln).
- **Rota**: curva Catmull-Rom pelos 7 pontos do itinerário (+ pontos intermédios), colada ao terreno, renderizada como tubo laranja com marcadores.
- **Gráficos**: céu físico (scattering de Rayleigh/Mie), tone mapping ACES, nevoeiro atmosférico, etiquetas 3D dos lagos.

## Modos de navegação

| Modo | Controlo |
|---|---|
| 🥾 **POV** (a pé) | Setas do cursor / WASD para andar, rato para olhar em 360°, `Shift` corre, `Q`/`E` roda. A câmara segue **sempre** a altitude do terreno ao nível dos olhos (1,70 m) — sobe e desce com o chão. |
| ▶ **Tour aéreo** | Câmara cinematográfica segue automaticamente a rota completa (~2,5 min). `Esc` sai. |
| 🛰 **Órbita** | Arrastar roda, scroll faz zoom; clicar numa paragem do itinerário voa até lá. |

## Desenvolvimento

```bash
npm install
npm run dev      # servidor de desenvolvimento (Vite)
npm run build    # build de produção -> dist/
npm start        # serve dist/ com Express (usado no Railway)
```

## Deploy no Railway

O repositório inclui `railway.json` (Nixpacks): `npm ci && npm run build` no build e `npm start` no arranque, com a porta lida de `process.env.PORT`. Basta apontar um serviço Railway para este repositório.

## Próximos itinerários

Os dados do itinerário estão isolados em `src/route.js` (paragens + pontos intermédios) e a região em `BOUNDS` no `src/main.js` — acrescentar uma nova rota é definir esses dois blocos.
