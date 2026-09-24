# Boutique de Maman : dossier étape 2

## Où mettre les fichiers dans le projet

Copie chaque fichier à l'emplacement indiqué. Remplace l'ancienne version si le fichier existe déjà.

| Fichier | Rôle |
|---|---|
| `MESSAGE_POUR_CLAUDE_CODE.md` | Le message à coller dans Claude Code / Cursor |
| `docs/CAHIER_DES_CHARGES.md` | Étape 1 (déjà faite), pour référence |
| `docs/CAHIER_DES_CHARGES_ETAPE2.md` | Comptes, Supabase, synchro, iPhone |
| `docs/maquette-boutique.html` | Maquette de référence des écrans |
| `assets/data/articles.json` | Les 316 articles (secours pour une boutique vide) |
| `assets/images/*.png` | Icône de l'app, icône Android, splash, favicon |
| `scripts/creer-compte-maman.mjs` | Crée le compte de Maman dans Supabase |
| `articles-boutique-maman.xlsx` | À remplir avec Maman : prix détail, prix gros, stock de départ |
| `.env.admin.example` | Modèle pour la clé admin du script |

## L'ordre des étapes

1. **Supabase (toi, 5 min)** :
   - crée un compte gratuit et un projet ;
   - dans SQL Editor, colle et exécute le bloc SQL de `docs/CAHIER_DES_CHARGES_ETAPE2.md` §3 ;
   - dans Authentication → Providers → Email, **désactive « Confirm email »** ;
   - dans Settings → API, note l'URL, la clé `anon` et la clé `service_role`.
2. **Dans le projet** :
   - `.env` avec `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` (pour l'app) ;
   - `.env.admin` avec `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (pour le script, sur ton ordinateur seulement) ;
   - vérifie que `.env` et `.env.admin` sont dans `.gitignore`.
3. **Claude Code / Cursor** : colle le contenu de `MESSAGE_POUR_CLAUDE_CODE.md`, et avance une étape à la fois.
4. **Avec Maman** : un soir après la fermeture, remplissez `articles-boutique-maman.xlsx` (prix manquants en rouge, prix gros, stock compté).
5. **Le lendemain matin, avant l'ouverture**, crée son compte :
   ```
   npm install @supabase/supabase-js xlsx
   node --env-file=.env.admin scripts/creer-compte-maman.mjs --fichier articles-boutique-maman.xlsx --tel "01 97 xx xx xx" --mdp "sonmotdepasse" --nom "Maman" --boutique "Boutique de Maman" --essai
   ```
   Si le résumé est bon, relance la même commande **sans `--essai`**. Note le code d'invitation affiché à la fin.
6. **Installation** :
   - sur le Samsung, l'APK (`eas build -p android --profile preview`) ;
   - sur l'iPhone, la version web : Safari → Partager → « Sur l'écran d'accueil ».

   Elle se connecte avec son numéro et son mot de passe.

## À retenir

- Aucun coût : Supabase gratuit, builds EAS gratuits, APK installé à la main, version web hébergée gratuitement.
- Mot de passe oublié : pas d'email de récupération. Tu le réinitialises dans Supabase (Authentication → Users).
- La clé `service_role` ne va **jamais** dans l'app ni sur GitHub.
