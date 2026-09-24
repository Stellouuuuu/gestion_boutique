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
