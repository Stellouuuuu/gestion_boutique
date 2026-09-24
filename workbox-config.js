/** Workbox : généré après `expo export -p web` (voir npm run build:web). */
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*'],
  globIgnores: ['**/*.map', 'sw.js', 'workbox-*.js'],
  swDest: 'dist/sw.js',
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  navigateFallback: '/index.html',
  navigateFallbackDenylist: [/^\/_/, /\/[^/?]+\.[^/]+$/],
  runtimeCaching: [
    {
      // API Supabase : toujours le réseau (synchro, auth).
      urlPattern: ({ url }) =>
        url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in'),
      handler: 'NetworkOnly',
    },
  ],
};
