# Lecture de feuille photo — déploiement TEST puis PRODUCTION

## Prérequis TEST

1. Projet Supabase `boutique-test` créé.
2. Coller `docs/schema-complet.sql` puis `docs/sql/lots-photo.sql` dans l’éditeur SQL.
3. Coller aussi `docs/sql/alias-articles.sql` et `docs/sql/quotas-photo-appels-ia.sql`.
4. Copier `.env.test.example` → `.env.test` avec URL + anon + service_role du **test**.
5. Déposer des photos dans `docs/exemples-feuilles/`.

### Sur le projet TEST

1. Va sur https://aistudio.google.com/apikey et crée une clé API (compte Google).
2. Installe la CLI : `npm i -g supabase` (ou `npx supabase`).
3. Lie le projet test : `npx supabase link --project-ref <REF_TEST>`  
   (Settings → General → Reference ID).
4. Enregistre le secret **uniquement** sur ce projet :

```bash
npx supabase secrets set GEMINI_API_KEY=ta_cle_gemini --project-ref <REF_TEST>
npx supabase secrets set AI_PROVIDER=gemini --project-ref <REF_TEST>
# Ordre d’essai (max 4 appels IA / photo, tous modèles confondus)
npx supabase secrets set GEMINI_MODELS=gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite --project-ref <REF_TEST>
# Optionnel secours Hugging Face — 1 appel max s’il reste de la marge dans le plafond de 4 :
# npx supabase secrets set HF_API_TOKEN=hf_xxx --project-ref <REF_TEST>
npx supabase secrets set PHOTO_QUOTA_JOUR=40 --project-ref <REF_TEST>
```

5. Déploie la fonction :

```bash
npx supabase functions deploy lire-feuille --project-ref <REF_TEST>
```

La clé **n’est jamais** dans l’app ni dans git — seulement dans les secrets Supabase.

### Règles cascade IA (dure)

- **Max 4 appels** Gemini/HF par photo — jamais de rebouclage « tant que le budget le permet ».
- **429** : pas de nouvel essai sur ce modèle ; modèle suivant une fois. Si tous en 429 → arrêt immédiat, message « indisponible jusqu’à demain ».
- **404** : modèle retiré (log une fois), suivant.
- **503** : au plus 1 retry après 3 s, puis suivant.

### Sur la PRODUCTION (après accord explicite)

Même commandes avec `--project-ref <REF_PROD>` et la **même** ou une autre clé Gemini.
Puis coller `docs/sql/lots-photo.sql`, `alias-articles.sql` et `quotas-photo-appels-ia.sql` dans l’éditeur SQL **production**.

## Variables d’environnement fonction

| Secret | Rôle |
|--------|------|
| `GEMINI_API_KEY` | Clé Google AI Studio |
| `GEMINI_MODELS` | Liste csv, défaut `gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite` |
| `GEMINI_MODEL` | Un seul modèle (si `GEMINI_MODELS` absent) |
| `AI_PROVIDER` | `gemini` (défaut) ou `huggingface` |
| `HF_API_TOKEN` | Secours Hugging Face (compte dans le plafond de 4) |
| `HF_VISION_MODEL` | Défaut `Qwen/Qwen2-VL-2B-Instruct` |
| `PHOTO_QUOTA_JOUR` | Anti-abus photos / jour / boutique (défaut 40) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont injectés automatiquement par Supabase Functions.

## Évaluation

```bash
node --env-file=.env.test scripts/evaluer-feuilles.mjs
node --env-file=.env.test scripts/evaluer-feuilles.mjs --une-photo 1f4330f9
```

Affichage compact : modèle, codes HTTP, nombre d’essais (pas le détail de chaque essai).

Le compteur `quotas_photo.nb_appels_ia` (jour / boutique) est visible dans **Mon compte**.
