'use strict';

// Everything the game needs from the network is declared here so the
// loading screen can show real progress. Add new images to the manifest
// and read them from IMAGES by key.
const ASSET_MANIFEST = {
  images: {
    biker: 'assets/biker.png',
    astro: 'assets/astro.png',
  },
};

const IMAGES = {};

// Loads every asset in the manifest, calling onProgress(loaded, total) as
// items arrive. Resolves once everything has either loaded or failed —
// failures are logged and the game falls back to drawn placeholders.
function loadAssets(onProgress) {
  const entries = Object.entries(ASSET_MANIFEST.images);
  const total = entries.length;
  let done = 0;
  if (onProgress) onProgress(0, total);
  return Promise.all(entries.map(([key, url]) => new Promise(resolve => {
    const img = new Image();
    const settle = ok => {
      if (!ok) console.warn('Failed to load asset:', url);
      done++;
      if (onProgress) onProgress(done, total);
      resolve();
    };
    img.onload = () => settle(true);
    img.onerror = () => settle(false);
    img.src = url;
    IMAGES[key] = img;
  })));
}
