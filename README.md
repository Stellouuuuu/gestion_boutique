# Boutique de Maman

App Expo / React Native (Expo Router) pour gérer le stock et les ventes d’une boutique de mèches et produits.

## Prérequis

- Node.js 20+
- Compte Supabase (offre gratuite)
- Fichiers `.env` et `.env.admin` (voir `.env.example` / `.env.admin.example`)

## Installation

```bash
npm install
```

Copier les variables d’environnement :

```bash
cp .env.example .env
cp .env.admin.example .env.admin
```

Remplir `.env` avec l’URL et la clé `anon` Supabase. Remplir `.env.admin` avec la clé `service_role` (ordinateur seulement, jamais dans l’app).

## Lancer l’app

```bash
npx expo start
```

Puis `a` (Android), `i` (iOS) ou `w` (web). Sur un appareil physique : scanner le QR code avec Expo Go (modules natifs déjà couverts) ou un development build si besoin.

## Version iPhone (web, gratuite)

Build de production :

```bash
npm run build:web
```

Cela crée le dossier `dist/` (export Expo + renommage `assets/node_modules` → `assets/npm` pour Cloudflare + service worker Workbox). Les en-têtes COOP/COEP nécessaires à `expo-sqlite` sont dans `public/_headers`.

> **Important** : Wrangler Pages refuse d’uploader tout dossier nommé `node_modules`. Le script `scripts/fix-web-dist-for-cloudflare.mjs` (lancé par `build:web`) renomme donc ces assets, sinon le site affiche un écran blanc (fichier `.wasm` servi en HTML).

### Mettre à jour le site en ligne (Cloudflare Pages)

Projet : **gestion-boutique** → https://gestion-boutique.pages.dev/

1. Vérifier que `.env` contient `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` (incluses dans le bundle au build).
2. Se connecter une fois : `npx wrangler login` (navigateur Cloudflare).
3. Déployer :

```bash
npm run deploy:web
```

Équivalent manuel :

```bash
npm run build:web
npx wrangler pages deploy dist --project-name=gestion-boutique
```

4. Contrôler les en-têtes : `curl -sI https://gestion-boutique.pages.dev/ | grep -i cross-origin`
5. Contrôler le wasm (doit être `application/wasm`, **pas** `text/html`) :

```bash
curl -sI "https://gestion-boutique.pages.dev/assets/npm/expo-sqlite/web/wa-sqlite/"*.wasm | head
```

6. Sur iPhone : Safari → ouvrir le site → **Partager** → **Sur l’écran d’accueil**. Si une ancienne version cassée reste en cache : supprimer l’icône, vider les données du site, puis réinstaller.

Smoke test navigateur (Chromium + WebKit) :

```bash
npx playwright install chromium webkit
node scripts/verifier-web-live.mjs
```

### Première création du projet Pages

```bash
npx wrangler pages project create gestion-boutique --production-branch=main
```

(Cloudflare n’accepte que des noms en minuscules avec tirets, pas de `_`.)

Sur le web, Safari peut effacer les données locales : la synchro Supabase reste obligatoire ; l’indicateur d’accueil est le même que sur Android.

## APK Android (installation manuelle)

Profil EAS `preview` → fichier **.apk** (pas le Play Store) :

```bash
npx eas-cli@latest build -p android --profile preview
```

Quand le build est prêt, EAS affiche un lien de téléchargement. Sur le Samsung :

1. Ouvrir le lien (ou partager le fichier `.apk`)
2. Autoriser l’installation depuis des sources inconnues si Android le demande
3. Installer et ouvrir **Boutique de Maman**
4. Se connecter avec le numéro et le mot de passe

Les variables `EXPO_PUBLIC_SUPABASE_*` sont définies dans EAS (environnement `preview`). Les régénérer / mettre à jour avec `eas env:set` si besoin.

## Compte test

- Téléphone : `00 00 00 01`
- Mot de passe : `test1234`

À la première connexion (ou après une mise à jour de schéma local), l’app télécharge les articles depuis Supabase. Le stock est **calculé** à partir des mouvements (pas une colonne modifiée à la main).

## Hors ligne et synchronisation

- Chaque vente s’enregistre **tout de suite** dans SQLite, même sans réseau.
- La synchro vers Supabase part en arrière-plan (ouverture, retour au premier plan, retour du réseau, 3 s après une écriture, toutes les 2 min) : articles → mouvements → inventaires → inventaire_lignes.
- Indicateur discret sur l’accueil : « ✓ Tout est sauvegardé », « N ventes en attente de réseau », ou (après 24 h) « Pas de connexion depuis hier… ».
- **Sans réseau, l’app ne renvoie jamais à Connexion** : le cache boutique local suffit. On ne déconnecte que si Supabase dit explicitement que la session est invalide, ou si on choisit « Se déconnecter » (refusé s’il reste des lignes `a_envoyer`).

## Rôles

- **Propriétaire** : accès à « Gérer les articles » (PIN), invitations, membres, Mon compte (mot de passe, déconnexion).
- **Vendeuse** : ventes, entrées, restes, point du jour. Pas d’accès à Gérer (bouton masqué + contrôle côté app).

## Créer le compte de Maman (ordinateur)

```bash
node --env-file=.env.admin scripts/creer-compte-maman.mjs \
  --fichier articles-boutique-maman.xlsx \
  --tel "01 97 xx xx xx" --mdp "sonmotdepasse" \
  --nom "Maman" --boutique "Boutique de Maman" --essai
```

Relancer sans `--essai` pour créer réellement. Voir `docs/LISEZ-MOI.md` et `docs/CAHIER_DES_CHARGES_ETAPE2.md`.

## Vérifications

```bash
npm test
npx tsc --noEmit
npx expo lint
node --env-file=.env scripts/verifier-etape2.mjs
node --env-file=.env scripts/verifier-etape3.mjs
node --env-file=.env --env-file=.env.admin scripts/verifier-etape4.mjs
```

## Schéma local (v2)

- Clés primaires = UUID (identiques à Supabase), pas de `remote_id`
- Colonnes `prix_achat`, `cout_unitaire`, tables `inventaires` / `inventaire_lignes`
- Colonne `a_envoyer` + table `synchro` pour la synchronisation
