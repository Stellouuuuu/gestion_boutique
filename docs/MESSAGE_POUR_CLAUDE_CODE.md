Bravo pour les tests de l'étape 1. Trois nouveautés avant l'étape 2 :

**1. Nouveau document : `docs/CAHIER_DES_CHARGES_BILANS.md`.** Lis-le en entier. Il ajoute :
- Mon compte (changer le mot de passe, se déconnecter) ;
- le prix d'achat et le bénéfice ;
- les bilans jour, semaine, mois et année ;
- les inventaires (comptage réel) et leur historique ;
- les statistiques ;
- l'export Excel, PDF et JSON.

Son §0 dit où chaque partie s'insère dans l'ordre de travail. **Pour l'instant, ne construis pas les écrans de bilans, statistiques, inventaires et export** : ce sont les nouvelles étapes 7 à 9. Prévois seulement le schéma maintenant.

**2. Le SQL du §7 de ce document a déjà été exécuté dans Supabase.** Tables `inventaires` et `inventaire_lignes`, colonnes `articles.prix_achat` et `mouvements.cout_unitaire`.

**3. `scripts/creer-compte-maman.mjs` et `articles-boutique-maman.xlsx` ont été mis à jour.**
- L'Excel a une colonne « Prix d'achat ».
- Le script lit les colonnes par leur titre et remplit `prix_achat` et `cout_unitaire`.

**Étape 2 du §6, avec une simplification :** ma mère n'a jamais utilisé l'app (aucun APK distribué), donc **aucune donnée réelle n'existe hors ligne**. Pas besoin de migrer les données locales de l'étape 1.
- Fais une nouvelle version du schéma SQLite qui supprime les anciennes tables et repart de zéro, puis retélécharge depuis Supabase.
- Utilise l'UUID comme **seule** clé primaire partout (articles.id, mouvements.id, mouvements.article_id), identique à Supabase, sans `remote_id` à côté.
- Inclus dès maintenant `prix_achat`, `cout_unitaire`, `inventaires` et `inventaire_lignes` dans le schéma local.
- Le stock est calculé depuis les mouvements (même règle que la vue `stock_articles`) : plus de colonne stock modifiée à la main.
- Chaque vente copie le prix d'achat actuel dans `cout_unitaire`.
- Garde `a_envoyer` sur chaque ligne pour l'étape 3.
- Ajoute les index `mouvements(cree_le)` et `mouvements(article_id, cree_le)`.

Montre-moi ton plan en quelques lignes, puis enchaîne. À la fin :
- tests : vente, entrée, annulation, correction depuis la fiche → stock juste ; relance de l'app → tout est encore là ; `cout_unitaire` bien rempli sur une vente ;
- un commit git.
