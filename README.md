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

## Compte test

- Téléphone : `00 00 00 01`
- Mot de passe : `test1234`

À la première connexion (ou après une mise à jour de schéma local), l’app télécharge les articles depuis Supabase. Le stock est **calculé** à partir des mouvements (pas une colonne modifiée à la main). Les ventes fonctionnent hors ligne.

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
```

## Schéma local (v2)

- Clés primaires = UUID (identiques à Supabase), pas de `remote_id`
- Colonnes `prix_achat`, `cout_unitaire`, tables `inventaires` / `inventaire_lignes` (préparées pour les bilans)
- Colonne `a_envoyer` pour la synchronisation (étape 3)
