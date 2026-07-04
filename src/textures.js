import * as THREE from 'three';

// Texturas reais (fontes com CORS aberto). Carregamento é assíncrono e
// resiliente: os materiais começam sem textura e melhoram quando ela chega.
export const TEX = {
  waterNormals: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/waternormals.jpg',
  grass: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/terrain/grasslight-big.jpg',
  bark: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/hardwood2_diffuse.jpg',
  rockDiff: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cliff_side/cliff_side_diff_1k.jpg',
  rockNor: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/cliff_side/cliff_side_nor_gl_1k.jpg'
};

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

/** Carrega e configura uma textura; chama assign(tex) apenas em sucesso. */
export function loadTex(url, { srgb = true, repeat = true, aniso = 8 } = {}, assign) {
  loader.load(
    url,
    (tex) => {
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = aniso;
      assign(tex);
    },
    undefined,
    () => console.warn('textura falhou:', url)
  );
}
