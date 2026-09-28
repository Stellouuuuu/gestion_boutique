# Photos d’exemple — feuilles manuscrites de Maman

Dépose ici 5–10 photos (JPEG/PNG) de vraies feuilles de ventes.

Ces fichiers servent **uniquement** aux essais sur le projet Supabase de TEST
(`.env.test`) : calibrer le prompt Gemini et mesurer le taux de lignes bien lues.

Ne jamais committer de photos contenant des données personnelles sensibles
si tu préfères les garder hors git (ajoute `*.jpg` localement au besoin).

Commande d’évaluation (après `.env.test` + Edge Function `lire-feuille` déployée) :

```bash
node --env-file=.env.test scripts/evaluer-feuilles.mjs
```

Crée au besoin le compte `01 99 00 00 01` / `test1234` et la boutique « Boutique test feuilles »,
envoie chaque photo, écrit `resultats.json` ici.