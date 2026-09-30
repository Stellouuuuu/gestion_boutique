/** Workbox : généré après `expo export -p web` (voir npm run build:web). */
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*'],
  globIgnores: ['**/*.map', 'sw.js', 'workbox-*.js', 'index.html'],
  swDest: 'dist/sw.js',
  // Activer le nouveau SW dès qu’il est installé (sinon l’ancien precache
  // garde entry-*.js périmé et le correctif OPFS n’arrive jamais).
  // Le verrou Web Locks côté app gère le cas multi-onglet / OPFS.
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Pas de navigateFallback precache : les navigations passent NetworkFirst
  // pour récupérer le HTML (et donc le nouveau entry-*.js) après un déploiement.
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'html-navigations',
        networkTimeoutSeconds: 5,
      },
    },
    {
      // API Supabase : toujours le réseau (synchro, auth).
      urlPattern: ({ url }) =>
        url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in'),
      handler: 'NetworkOnly',
    },
  ],
};
