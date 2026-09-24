# Boutique de Maman : cahier des charges

App mobile (Android et iOS) de gestion de stock pour une boutique au Bénin qui vend des **mèches** et des **produits** (accessoires, soins, outils de coiffure).
L'utilisatrice principale est ma mère. Elle n'est pas à l'aise avec la technologie. **La simplicité et la protection contre les erreurs passent avant tout le reste.**

Fichiers fournis avec ce document :
- `maquette-boutique.html` : maquette cliquable. Ouvre-la dans un navigateur. C'est la **référence pour les écrans, les textes, les couleurs et le comportement**. Reproduis-la fidèlement.
- `articles.json` : les 316 vrais articles (115 mèches, 201 produits), repris de ses fiches papier. 43 n'ont pas de prix (`prix_detail: null`). `prix_gros` est vide pour tous, ce sera rempli plus tard dans l'app.

---

## 1. Stack technique

- **React Native + Expo** (SDK récent), TypeScript, Expo Router.
- **Stockage local d'abord** : `expo-sqlite`. L'app doit fonctionner à 100 % sans Internet. Une vente ne doit jamais échouer à cause du réseau.
- **Sauvegarde en ligne** (étape 2, voir §8) : Supabase, synchronisation en arrière-plan quand le réseau est disponible.
- Build avec **EAS** : APK Android d'abord pour les tests, puis Play Store et App Store.
- Langue : français uniquement. Monnaie : francs CFA, affichés `5 000 F` (espace fine comme séparateur des milliers, sans décimales).
- Doit marcher sur **tous les téléphones**, y compris les petits Android d'entrée de gamme (écran de 360 px de large) : mise en page fluide, pas de tailles fixes qui débordent, et respect de la taille de police choisie dans le téléphone (tester avec la police système réglée au maximum).

## 2. Données

```
Article    id, nom, categorie ('meches' | 'produits'), prix_detail (int|null), prix_gros (int|null),
           stock (int), actif (bool), cree_le, modifie_le
Mouvement  id, article_id, type ('vente' | 'entree' | 'correction'), quantite (int > 0),
           tarif ('detail' | 'gros' | null), prix_unitaire (int), montant_normal (int),
           montant_paye (int), annule (bool), annule_le, cree_le
```

- Le **stock** d'un article est modifié uniquement par les mouvements. Chaque changement laisse une trace, aucun stock n'est modifié en silence.
- **Réduction** = `montant_normal - montant_paye`. On la garde pour pouvoir l'afficher.
- **Supprimer un article** = le passer à `actif = false` (suppression douce). L'historique est conservé.
- **Annuler** une vente ou une entrée = la marquer `annule = true` et rétablir le stock. On ne supprime jamais une ligne.
- Au premier lancement, importer `articles.json` avec un stock à 0. Ma mère ou moi saisirons l'inventaire de départ.

## 3. Écrans (voir la maquette)

1. **Accueil** : « Bonjour Maman », la date, 2 chiffres (vendu aujourd'hui en F, nombre d'articles finis), puis 4 gros boutons empilés :
   - **J'ai vendu** (bouton principal, fond indigo)
   - **Nouvelle marchandise** (bordure verte)
   - **Voir les restes**
   - **Point du jour**

   Tout en bas, séparé par un trait pointillé, un petit bouton discret : « Gérer les articles (code) ».
2. **Choisir un article** (pour une vente ou une entrée) : onglets Mèches / Produits, champ de recherche (sans tenir compte des accents ni des majuscules), barre de lettres A à Z pour sauter dans la liste, liste alphabétique avec le nom, le prix et une pastille de stock (vert = ok, orange ≤ 2, rouge = « Fini »).
3. **Quantité et confirmation** :
   - le nom de l'article en grand ;
   - les boutons − et + d'au moins 80 px ;
   - pour une vente, le choix **Détail / En gros** (Détail par défaut, « En gros » désactivé si pas de prix de gros) ;
   - un résumé du type « 2 × 2 500 F = 5 000 F » et « Après : il restera X » ;
   - le gros bouton « Oui, j'ai vendu » (ou « Oui, ajouter au stock ») ;
   - un bouton secondaire « Non, choisir un autre article ».
4. **Réduction** (lien discret « Faire une réduction ») : fenêtre où elle saisit **le montant total payé par la cliente**, pas un pourcentage. Le montant doit être inférieur au prix normal. S'il y a plus de 50 % de réduction, afficher un avertissement qu'il faut confirmer. Changer la quantité ou le tarif enlève la réduction.
5. **Voir les restes** : même liste, avec un filtre « Tout voir / À racheter » (stock ≤ 2), en lecture seule.
6. **Point du jour** : le total encaissé, découpé entre mèches et produits, la liste des ventes (heure, gros ou détail, étiquette jaune « Réduction X F »), la liste des entrées, et un bouton « Erreur ? » sur chaque ligne qui permet d'annuler après confirmation.
7. **Gérer les articles** : protégé par un code PIN à 4 chiffres (à choisir au premier lancement, modifiable). On y trouve :
   - un bouton « Ajouter un article » ;
   - la liste des articles, et un appui sur l'un d'eux ouvre sa fiche : nom, catégorie, prix détail, prix gros, quantité ;
   - en bas de la fiche, loin du bouton Enregistrer, « Supprimer cet article », en rouge contour.

   Si la quantité est changée depuis cette fiche, un mouvement de type `correction` est créé.

## 4. Règles contre les fausses manipulations (obligatoires)

- Toute action qui change le stock passe par un écran de résumé avant validation.
- Après chaque enregistrement, un bandeau « ✓ Vendu : 2 Bella = 5 000 F » avec un bouton **Annuler** reste visible 10 s.
- Vendre plus que le stock affiché est **permis**, parce que le stock papier peut être faux, mais un avertissement orange s'affiche.
- Pas de glisser pour supprimer, pas d'appui long caché, pas de menu à trois points. Chaque action est un bouton visible avec un texte clair.
- Dans une confirmation de suppression, le choix sûr (« Non, garder ») est en premier et reçoit le focus.
- Zones tactiles d'au moins 56 px, texte d'au moins 18 px, contraste AA minimum.
- Double-tap protégé : désactiver le bouton de validation dès le premier appui, pour ne pas enregistrer deux ventes.
- Un article sans prix ne peut pas être vendu. Afficher « Prix à mettre » et un message qui explique quoi faire.

## 5. Design

Reprendre la maquette : police **Atkinson Hyperlegible** (très lisible) pour le texte et **Bricolage Grotesque** pour les titres. Couleurs : indigo `#27306B` (action principale), prune `#8A2E62` (mèches), vert canard `#0F6B63` (produits), jaune `#F2B233` (bandeaux et réductions), vert, orange et rouge pour l'état du stock. Prévoir un mode sombre (les couleurs sont dans la maquette).

## 6. Données de départ à nettoyer

- 43 articles sans prix. Les afficher dans une liste « À compléter » dans l'espace Gérer.
- Certains noms contiennent des infos de lot ou de prix, par exemple « Dallas grand 3/4400 », « Teinte subaru 400/3000 », « Colle petit 500/1350 ». Ne pas les interpréter automatiquement : garder le nom tel quel, ma mère corrigera.

## 7. Étape 1 : ce qu'il faut livrer d'abord

App Expo complète, hors ligne, avec les écrans du §3, les règles du §4, l'import de `articles.json`, et un APK Android installable pour les tests.

## 8. Étape 2 : ensuite

- Synchronisation Supabase (sauvegarde + consultation depuis mon téléphone). Connexion simple, un seul compte boutique.
- **Export** du point du jour ou du mois en PDF ou Excel, à partager par WhatsApp.
- Historique par jour et par mois (chiffre d'affaires, articles les plus vendus).
- Inventaire : un écran pour recompter le stock réel et corriger les écarts, avec des mouvements `correction`.
