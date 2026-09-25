# Boutique de Maman — règles agents

## Production

De vraies données existent. Ces règles s’appliquent à **chaque** modification future.

### Données

- Ne **JAMAIS** supprimer ni vider de données, ni en ligne (Supabase) ni dans le téléphone (SQLite), sans accord **explicite** de Stella (« OK, supprime » ou équivalent clair).
- Les fichiers `articles-boutique-maman.xlsx` et `assets/data/articles.json` sont la vraie liste d’articles : ne pas les écraser ni les supprimer.

### Supabase

- Uniquement des migrations qui **AJOUTENT** ou **MODIFIENT** (`alter table add column`, nouvelles tables, nouvelles policies).
- **Jamais** de `drop table` / `drop column` / `delete` / `truncate` sur la production.
- Chaque migration SQL est d’abord **montrée** et **testée** sur le projet Supabase de TEST (`.env.test`), jamais appliquée directement en production.

### SQLite local

- Les montées de version du schéma sont des migrations qui **conservent toutes les lignes**.
- Interdiction de `DROP` + recreate des tables métier.
- Les lignes `a_envoyer = 1` doivent **toujours** être préservées puis envoyées (synchro).

### Scripts d’essai

- Tous les essais et scripts de test (`demo-donnees`, `verifier-*` qui touchent Supabase) tournent sur le projet Supabase de **TEST** (`.env.test`), jamais sur la production (`.env` / `.env.admin`).
- Chaque script de test refuse de s’exécuter s’il détecte les clés / l’URL de production.
- Le script `creer-compte-maman.mjs` reste réservé à la création du vrai compte (`.env.admin`), lancé manuellement.

### Livraison APK / web

- L’APK se construit toujours avec le **même profil EAS** (`preview`) et la **même clé de signature**, pour s’installer par-dessus l’ancienne version **sans perte** de données locales.
- Avant chaque livraison : `npm test`, `npx tsc --noEmit`, `npx expo lint`, et un test « mise à jour par-dessus une version avec des ventes en attente → aucune vente perdue ».
- Déploiement web : `npm run deploy:web` ; vérifier que **https://gestion-boutique.pages.dev/** est à jour (pas seulement une URL de prévisualisation `*.pages.dev`).

### Identifiant téléphone

- `telVersIdentifiant()` dans `src/lib/identifiant.ts` et `scripts/creer-compte-maman.mjs` (et `scripts/lib/tel.mjs`) doivent rester **identiques** au caractère près.

---

## Expo / React Native

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

### Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

### Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

### Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

### Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

### Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
