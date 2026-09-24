# Boutique de Maman : compte, bilans, inventaires, statistiques, export

À lire avec `CAHIER_DES_CHARGES.md` et `CAHIER_DES_CHARGES_ETAPE2.md`. Ce document ajoute :
- **A.** Mon compte (connexion, déconnexion, mot de passe)
- **B.** Le prix d'achat (pour calculer le bénéfice)
- **C.** Les bilans : jour, semaine, mois, année
- **D.** Les inventaires (comptage réel) et leur historique
- **E.** Les statistiques pour vendre mieux
- **F.** L'export (Excel, PDF, sauvegarde)

**Même règle qu'avant : zéro coût.** Uniquement des bibliothèques gratuites, et tout est calculé dans le téléphone à partir de SQLite, sans serveur payant.

---

## 0. Ordre de travail (s'insère dans le §6 de l'étape 2)

1. **Tout de suite, pendant l'étape 2 (schéma local UUID)** : ajouter `prix_achat` et `cout_unitaire` (§B) ainsi que les tables `inventaires` / `inventaire_lignes` (§D) au schéma local, pour ne pas le refaire plus tard. Exécuter le SQL du §7 dans Supabase.
2. **Étape 3 (synchro)** : synchroniser aussi `inventaires` et `inventaire_lignes`.
3. **Étape 4** : écran Mon compte (§A).
4. Étapes 5 et 6 (web + APK), puis **ma mère commence à utiliser l'app**.
5. **Nouvelle étape 7** : Bilans (§C) + Export (§F).
6. **Nouvelle étape 8** : Inventaires (§D).
7. **Nouvelle étape 9** : Statistiques (§E). Elles deviennent utiles après quelques semaines de ventes réelles.

## Accès et navigation

- L'accueil garde ses **4 gros boutons** inchangés.
- En dessous, pour la **propriétaire uniquement**, un 5e bouton plus sobre (fond carte, pas indigo) : **« Mes bilans »**, avec le sous-titre « Semaine, mois, bénéfice ».
- « Mes bilans » ouvre un écran avec 4 onglets en haut, gros et lisibles :
  - **Bilans**
  - **Statistiques**
  - **Inventaires**
  - **Exporter**
- La vendeuse ne voit ni ce bouton ni ces écrans, et ce n'est pas seulement caché dans l'interface : il faut aussi le vérifier par le rôle.
- « Mes bilans » est en lecture seule. **Pas de PIN** : rien ne s'y modifie, sauf lancer un inventaire, qui a sa propre confirmation.

---

## A. Mon compte

Dans l'espace Gérer (PIN), une section **« Mon compte »** avec :
- le nom, le numéro de téléphone (affiché lisiblement : `01 97 00 00 00`) et le nom de la boutique ;
- **« Changer mon mot de passe »** : ancien mot de passe, nouveau, confirmation (`supabase.auth.updateUser`). C'est important car il n'y a pas de récupération par email ;
- **« Se déconnecter »** : bouton rouge contour, en bas, avec confirmation. **La déconnexion est refusée s'il reste des données non envoyées**, avec l'explication « 3 ventes ne sont pas encore sauvegardées en ligne. Connectez-vous à Internet et réessayez. »

**Page de connexion** : elle existe déjà (téléphone + mot de passe, et « Rejoindre une boutique avec un code »). **Il n'y a volontairement pas d'inscription libre** : les boutiques sont créées par `scripts/creer-compte-maman.mjs`. Si un jour d'autres commerçantes veulent l'app, on ajoutera « Créer ma boutique » (la fonction `creer_boutique` existe déjà dans Supabase).

## B. Prix d'achat et bénéfice

- `articles.prix_achat` : prix payé au fournisseur pour une pièce (nullable). Il se modifie dans la fiche article, et l'Excel de départ le remplit.
- `mouvements.cout_unitaire` : **copie du prix d'achat au moment du mouvement**. Si le prix d'achat change plus tard, les anciens bénéfices restent justes.
  - Pour une **vente** : `cout_unitaire = articles.prix_achat` au moment de la vente (null si inconnu).
  - Pour une **entrée** : sur l'écran « Nouvelle marchandise », sous la quantité, un champ facultatif « Prix d'achat par pièce », prérempli avec le prix d'achat actuel. Si elle le change, on met à jour `articles.prix_achat` et on enregistre `cout_unitaire`. Ce champ doit rester discret : l'entrée doit pouvoir se faire sans le toucher.
- **Bénéfice d'une vente** = `montant_paye − quantite × cout_unitaire`. Il n'est calculé que si `cout_unitaire` est connu.
- Partout où un bénéfice est affiché, s'il manque des prix d'achat, on l'indique honnêtement : « Bénéfice estimé : 45 000 F (sur 80 % des ventes, 12 articles n'ont pas de prix d'achat) ». Un lien mène à la liste « À compléter ».
- La fiche article affiche un avertissement si prix d'achat ≥ prix détail (« Vendu à perte ? »).

## C. Bilans (jour, semaine, mois, année)

L'onglet **Bilans** propose un sélecteur de période en haut (4 gros boutons : **Jour · Semaine · Mois · Année**) et des flèches **◀ ▶** pour passer à la période précédente ou suivante. Le titre est lisible : « Semaine du 22 au 28 septembre », « Septembre 2026 », « 2026 ».

- Les semaines vont du **lundi au dimanche**.
- Toutes les dates sont en heure locale (`Africa/Porto-Novo`, UTC+1). Une vente à 23 h 30 compte pour ce jour-là.

Contenu d'un bilan, dans cet ordre :
1. **Argent encaissé** (gros chiffre), avec la comparaison à la période précédente : « +12 % par rapport à août », en vert ou orange, jamais en rouge agressif.
2. **Bénéfice estimé** (voir §B).
3. Mèches / Produits : montant et nombre de pièces vendues.
4. Détail / Gros : montant de chaque.
5. Réductions accordées : total, et nombre de ventes concernées.
6. Marchandise arrivée : nombre de pièces, et coût total si les prix d'achat sont connus.
7. **Stock en fin de période** : valeur au prix d'achat et au prix détail. Il se calcule en rejouant les mouvements jusqu'à la fin de la période (`cree_le <= fin`). On peut donc voir le stock de n'importe quel mois passé : c'est « l'inventaire » de la période.
8. Un bouton **« Voir le détail »** ouvre la liste des mouvements de la période, filtrable par Ventes / Entrées / Corrections et par Mèches / Produits.
9. Un bouton **« Voir le stock à cette date »** ouvre la liste des articles avec leur reste à la fin de la période.

Aucune donnée n'est stockée en plus : tout se calcule depuis `mouvements`, et reste donc toujours juste, même après une annulation.

## D. Inventaires (comptage réel)

C'est le moment où ma mère **recompte vraiment** ce qu'il y a en boutique, pour corriger les écarts dus aux oublis, à la casse ou aux vols. Je recommande un inventaire par mois, et l'app le rappelle doucement (voir plus bas).

### Déroulement
1. Onglet Inventaires, bouton **« Commencer un inventaire »**, avec une confirmation qui explique : « Vous allez recompter les articles un par un. Vous pouvez vous arrêter et reprendre plus tard. »
2. Choix du périmètre : **Tout**, **Mèches seulement** ou **Produits seulement**.
3. La liste des articles (même liste A-Z avec recherche). Pour chaque article, elle saisit le **nombre compté** avec le même stepper − / + que pour la vente, prérempli avec le stock attendu : elle n'a qu'à valider si c'est juste. L'article passe alors en « ✓ compté ».
4. En haut, une barre de progression : « 87 / 316 comptés ».
5. **L'inventaire est sauvegardé au fur et à mesure** (statut `en_cours`). Elle peut fermer l'app et reprendre, et l'accueil affiche « Inventaire en cours : reprendre ».
6. Des ventes peuvent avoir lieu pendant l'inventaire. Le stock attendu d'un article est donc figé **au moment où on le compte**, pas au début.
7. **« Terminer l'inventaire »** ouvre un résumé des écarts. Par exemple :
   - « 12 articles avec un écart. Manque : 7 pièces (valeur 14 500 F). En trop : 2 pièces. »
   - la liste des écarts, puis le bouton « Valider et corriger le stock » ou « Revenir ».
8. La validation crée, pour chaque écart, un mouvement `correction` (delta signé) lié à la ligne d'inventaire. Les articles non comptés ne sont **pas** modifiés.
9. Un inventaire peut être **abandonné** (confirmation). Il reste alors dans l'historique avec le statut « abandonné », sans correction.

### Historique des inventaires
- Une liste de tous les inventaires : date, périmètre, statut, nombre d'articles comptés, nombre d'écarts, valeur des écarts.
- Un appui sur un inventaire ouvre sa fiche : chaque ligne avec attendu, compté et écart, avec un filtre « Écarts seulement ».
- En bas de l'onglet, un résumé des écarts cumulés sur l'année : « Pertes depuis janvier : 23 pièces, 41 000 F ». C'est utile pour repérer une fuite.
- Rappel : si le dernier inventaire terminé a plus de 35 jours, une ligne discrète s'affiche sur l'accueil de « Mes bilans » : « Dernier inventaire il y a 42 jours ». Elle n'apparaît jamais sur l'accueil principal.

## E. Statistiques pour vendre mieux

Onglet **Statistiques**, période par défaut : les 30 derniers jours, modifiable (30 jours / 3 mois / 12 mois).

Chaque bloc = **un graphique simple + une phrase en français clair qui dit quoi faire**. Pas de jargon : le but est de l'aider à décider, pas de faire joli.

1. **Évolution des ventes** : barres par jour (30 jours) ou par mois (12 mois), avec une ligne pour la moyenne. Phrase : « Vos ventes de septembre sont 12 % au-dessus d'août. »
2. **À racheter en priorité** (liste, pas de graphique) : articles finis ou presque finis (≤ 2) qui se vendent bien. Ils sont triés par nombre vendu sur 30 jours. Phrase : « Bella : il en reste 1, vous en vendez environ 3 par semaine. »
3. **Meilleures ventes** : top 10 par argent encaissé, et top 10 par bénéfice si les prix d'achat sont connus, en barres horizontales.
4. **Argent qui dort** : articles en stock **sans aucune vente depuis 60 jours**, avec la valeur immobilisée au prix d'achat. Phrase : « 18 articles n'ont rien vendu depuis 2 mois : 85 000 F de marchandise qui dort. Pensez à une promotion. »
5. **Meilleurs jours de la semaine** : barres lundi → dimanche (moyenne encaissée). Phrase : « Le samedi rapporte 2 fois plus que le mardi. »
6. **Mèches et produits** : part de chaque catégorie dans l'argent et dans le bénéfice (deux barres empilées à 100 %, pas de camembert).
7. **Détail et gros** : part du gros dans les ventes.
8. **Réductions** : total accordé sur la période et % du chiffre, pour qu'elle voie si elle en fait trop.
9. **Marge par article** (si prix d'achat) : articles à marge faible (< 15 %) ou vendus à perte. Phrase : « 4 articles se vendent presque au prix d'achat. »

Techniquement :
- une bibliothèque de graphiques gratuite compatible Expo **et** web, par exemple `react-native-gifted-charts` (avec `react-native-svg`) ou `victory-native`. Vérifier qu'elle marche sur le web ;
- les couleurs du thème : mèches `#8A2E62`, produits `#0F6B63`, indigo pour le reste ;
- les chiffres des axes lisibles (`12 k`, `1,2 M`) et les montants complets au toucher ;
- tous les calculs en SQL dans SQLite, avec les index `mouvements(cree_le)` et `mouvements(article_id, cree_le)`. Ça doit rester fluide avec 50 000 mouvements.

## F. Exporter

L'onglet **Exporter**, réservé à la propriétaire, propose :

1. **Rapport Excel** : choix de la période (même sélecteur que les bilans), puis bouton « Créer le fichier Excel ». Le fichier `.xlsx` est généré dans le téléphone avec `xlsx` (SheetJS) + `expo-file-system`, puis s'ouvre la feuille de partage (`expo-sharing`) pour l'envoyer par WhatsApp, e-mail ou Drive. Il contient ces onglets :
   - **Résumé** : les chiffres du bilan (§C) ;
   - **Ventes** : date, heure, article, catégorie, détail/gros, quantité, prix unitaire, montant normal, montant payé, réduction, bénéfice, vendeuse ;
   - **Entrées** : date, article, quantité, prix d'achat, coût ;
   - **Corrections et inventaires** ;
   - **Stock fin de période** : article, catégorie, reste, prix d'achat, prix détail, valeurs ;
   - les lignes annulées sont exclues, ou dans un onglet « Annulées » à part.
2. **Rapport PDF** (résumé d'une page, facile à lire ou imprimer) : `expo-print` (gratuit) à partir d'un gabarit HTML aux couleurs de l'app, puis partage.
3. **Sauvegarde complète** : fichier JSON de toutes les données (déjà prévu), avec la restauration à côté (confirmation, « Non » en premier).

Fichiers nommés clairement : `Boutique-Maman_Septembre-2026.xlsx`, `Boutique-Maman_Semaine-39-2026.pdf`. Sur le web (iPhone), le partage passe par le téléchargement ou la feuille de partage de Safari : vérifier que ça marche.

---

## 7. SQL à exécuter dans Supabase (maintenant)

```sql
-- B. prix d'achat
alter table articles add column if not exists prix_achat integer
  check (prix_achat is null or prix_achat >= 0);
alter table mouvements add column if not exists cout_unitaire integer
  check (cout_unitaire is null or cout_unitaire >= 0);

-- D. inventaires
create table if not exists inventaires (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  perimetre text not null check (perimetre in ('tout','meches','produits')),
  statut text not null default 'en_cours' check (statut in ('en_cours','termine','abandonne')),
  fait_par uuid references auth.users(id),
  commence_le timestamptz not null,
  termine_le timestamptz,
  note text,
  modifie_le timestamptz not null default now()
);
create table if not exists inventaire_lignes (
  id uuid primary key,
  inventaire_id uuid not null references inventaires(id) on delete cascade,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  article_id uuid not null references articles(id),
  stock_attendu integer not null,
  stock_compte integer not null check (stock_compte >= 0),
  compte_le timestamptz not null,
  mouvement_id uuid references mouvements(id),
  modifie_le timestamptz not null default now(),
  unique (inventaire_id, article_id)
);
create index if not exists idx_inventaires_synchro on inventaires (boutique_id, modifie_le);
create index if not exists idx_invlignes_synchro on inventaire_lignes (boutique_id, modifie_le);
create index if not exists idx_mouvements_date on mouvements (boutique_id, cree_le);

create trigger t_inventaires before insert or update on inventaires
  for each row execute function toucher_modifie_le();
create trigger t_inventaire_lignes before insert or update on inventaire_lignes
  for each row execute function toucher_modifie_le();

alter table inventaires enable row level security;
alter table inventaire_lignes enable row level security;
create policy inv_lire on inventaires for select using (est_membre(boutique_id));
create policy inv_creer on inventaires for insert with check (est_proprietaire(boutique_id));
create policy inv_modifier on inventaires for update using (est_proprietaire(boutique_id));
create policy invl_lire on inventaire_lignes for select using (est_membre(boutique_id));
create policy invl_creer on inventaire_lignes for insert with check (est_proprietaire(boutique_id));
create policy invl_modifier on inventaire_lignes for update using (est_proprietaire(boutique_id));
```

## 8. Tests obligatoires

- **Bilans** : avec des données de test couvrant 3 mois, les totaux jour, semaine, mois et année sont justes et cohérents (la somme des jours = la semaine, la somme des mois = l'année).
  - Une vente annulée n'est comptée nulle part.
  - Une vente à 23 h 30 heure locale tombe dans le bon jour.
- **Stock en fin de période** : il est égal au stock actuel quand la période est « aujourd'hui ».
- **Bénéfice** :
  - changer le prix d'achat d'un article ne modifie pas le bénéfice des ventes passées ;
  - une vente sans prix d'achat est exclue du bénéfice et signalée.
- **Inventaire** :
  - interrompu puis repris, rien n'est perdu ;
  - une vente pendant l'inventaire ne fausse pas l'écart ;
  - un inventaire abandonné ne touche pas le stock ;
  - à la validation, un seul mouvement de correction est créé par écart.
- **Export** : le fichier Excel s'ouvre dans Excel et Google Sheets, avec les accents corrects, et les totaux de l'onglet Résumé égaux à ceux de l'écran. Le PDF s'ouvre sur Android et sur iPhone.
- **Rôle** : une vendeuse ne voit pas « Mes bilans ». Et en appelant Supabase directement, elle ne peut pas créer d'inventaire.
- **Performance** : avec 50 000 mouvements générés, chaque onglet s'affiche en moins de 2 secondes sur un Android d'entrée de gamme (ou avec le processeur ralenti ×4 dans Chrome).
