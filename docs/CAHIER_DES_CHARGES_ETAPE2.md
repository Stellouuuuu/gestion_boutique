# Boutique de Maman : Étape 2 (comptes, données en ligne, iPhone)

À lire avec `CAHIER_DES_CHARGES.md`. L'étape 1 (app hors ligne SQLite) est faite. Cette étape ajoute :
1. des **comptes** : inscription, connexion, plusieurs personnes pour une même boutique ;
2. le **stockage en ligne** (Supabase), partagé entre plusieurs téléphones et **sans perdre le fonctionnement hors ligne** ;
3. une **version iPhone gratuite** (app web installée sur l'écran d'accueil).

**Contrainte absolue : zéro coût.** Supabase en offre gratuite, builds EAS gratuits, APK installé à la main sur Android (pas de Play Store), hébergement web gratuit (Cloudflare Pages) pour l'iPhone. Pas de SMS payant, pas de service payant.

---

## 1. Principes

- **Le téléphone reste la source immédiate.** Chaque vente s'enregistre d'abord dans SQLite, instantanément, même sans réseau. La synchronisation se fait ensuite, en arrière-plan.
- **Supabase est la référence partagée** entre tous les appareils d'une même boutique.
- **Le stock n'est plus une colonne modifiée à la main : il est calculé** comme la somme des mouvements. Deux téléphones qui vendent en même temps ne peuvent donc jamais s'écraser l'un l'autre.
  - `vente` : −quantité
  - `entree` : +quantité
  - `correction` : ±quantité. C'est un **delta signé**, ce qui remplace la règle « quantite > 0 » de l'étape 1 pour ce type.
  - les mouvements annulés sont ignorés.
- **Tous les identifiants sont des UUID** générés sur le téléphone, pour pouvoir créer hors ligne sans conflit.
- **Rien n'est jamais supprimé** : articles `actif = false`, mouvements `annule = true`.

## 2. Comptes et boutiques

- **Boutique** : ensemble d'articles et de mouvements. Une personne peut appartenir à une ou plusieurs boutiques ; dans l'app, on travaille toujours dans une seule, sans sélecteur visible s'il n'y en a qu'une.
- **Rôles** :
  - `proprietaire` : tout, y compris Gérer les articles et inviter des personnes.
  - `vendeuse` : vendre, ajouter de la marchandise, voir les restes et le point du jour. N'a pas accès à « Gérer les articles ».
- Le PIN de l'étape 1 est conservé comme garde supplémentaire sur l'espace Gérer (un téléphone peut être prêté).

### Identifiant : numéro de téléphone + mot de passe

Les SMS coûtent de l'argent. On n'envoie donc **aucun SMS ni email** :
- l'utilisatrice saisit son **numéro de téléphone** (indicatif +229 par défaut, modifiable) et un **mot de passe** (6 caractères minimum, avec un bouton pour l'afficher) ;
- l'app le transforme en identifiant Supabase `229XXXXXXXX@boutique-maman.app`. Ce n'est pas un vrai email, et aucun email ne part jamais ;
- dans Supabase, désactiver **« Confirm email »** (Authentication → Providers → Email) ;
- mot de passe oublié : pas d'email possible. Le propriétaire du projet le réinitialise depuis le tableau de bord Supabase. L'écran de connexion affiche « Mot de passe oublié ? Demandez à Stella. », texte configurable.

### Compte de Maman créé à l'avance

Le compte de ma mère, sa boutique, ses articles (avec prix détail et gros) et son stock de départ sont créés **à l'avance** par `scripts/creer-compte-maman.mjs`, à partir de `articles-boutique-maman.xlsx`. Lis ce script : il fixe le format des données en ligne.
- Le script utilise la clé `service_role`. Il se lance uniquement sur l'ordinateur, et `.env.admin` doit être dans `.gitignore`.
- La fonction `telVersIdentifiant()` du script (chiffres seulement, préfixe 229 ajouté s'il manque, puis `@boutique-maman.app`) doit être **réutilisée à l'identique** dans l'app. Mets-la dans un module partagé (`src/lib/identifiant.ts`) et ajoute un test : `"01 97 00 00 00"` et `"2290197000000"` donnent le même identifiant.
- À la connexion, si la boutique a déjà des articles en ligne, l'app les **télécharge** avec leurs mouvements. Elle **n'importe pas** `articles.json`. `articles.json` ne sert plus que de secours pour une boutique vide.

### Écrans

1. **Connexion** (première ouverture) : téléphone + mot de passe, en gros. En dessous, un lien : « Rejoindre une boutique avec un code » (pour les vendeuses). **Pas de « Créer ma boutique » pour l'instant** : les boutiques sont créées par le script.
2. Après la première connexion : choix du code PIN de l'espace Gérer, puis téléchargement des données avec un message « Chargement de vos articles… ».
3. **Rejoindre une boutique** : code d'invitation à 6 caractères (sans 0/O ni 1/I), votre nom, téléphone, mot de passe. L'utilisatrice devient `vendeuse`.
4. **Connexion** : téléphone + mot de passe.
5. Dans **Gérer** (propriétaire) :
   - « Inviter quelqu'un » : affiche le code en très grand, avec un bouton Partager (WhatsApp) ;
   - la liste des membres, avec la possibilité de retirer quelqu'un (confirmation, « Non » en premier) ;
   - « Se déconnecter ». Si des données ne sont pas encore envoyées, l'app refuse la déconnexion et explique pourquoi.
- **On reste connecté** : la session est gardée (expo-secure-store sur mobile, localStorage sur web). Elle ne doit presque jamais avoir à se reconnecter.
- Aucun bouton de déconnexion en dehors de Gérer.

## 3. Base Supabase (SQL à exécuter dans l'éditeur SQL)

```sql
create extension if not exists pgcrypto;

create table boutiques (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  code_invitation text unique not null,
  cree_le timestamptz not null default now()
);

create table membres (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('proprietaire','vendeuse')),
  nom text not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (boutique_id, user_id)
);

create table articles (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  nom text not null,
  categorie text not null check (categorie in ('meches','produits')),
  prix_detail integer check (prix_detail is null or prix_detail >= 0),
  prix_gros integer check (prix_gros is null or prix_gros >= 0),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table mouvements (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  article_id uuid not null references articles(id),
  type text not null check (type in ('vente','entree','correction')),
  quantite integer not null check (quantite <> 0),
  tarif text check (tarif in ('detail','gros')),
  prix_unitaire integer not null default 0,
  montant_normal integer not null default 0,
  montant_paye integer not null default 0,
  annule boolean not null default false,
  annule_le timestamptz,
  cree_par uuid references auth.users(id),
  cree_le timestamptz not null,          -- heure du téléphone au moment de la vente
  modifie_le timestamptz not null default now()  -- heure serveur, sert à la synchro
);
create index on articles (boutique_id, modifie_le);
create index on mouvements (boutique_id, modifie_le);
create index on mouvements (article_id);

-- modifie_le toujours posé par le serveur
create or replace function toucher_modifie_le() returns trigger language plpgsql as $$
begin new.modifie_le := now(); return new; end $$;
create trigger t_articles before insert or update on articles for each row execute function toucher_modifie_le();
create trigger t_mouvements before insert or update on mouvements for each row execute function toucher_modifie_le();

-- stock calculé
create view stock_articles with (security_invoker = true) as
select a.id as article_id, a.boutique_id,
  coalesce(sum(case when m.annule then 0
                    when m.type = 'vente' then -m.quantite
                    else m.quantite end), 0)::int as stock
from articles a left join mouvements m on m.article_id = a.id
group by a.id, a.boutique_id;

-- droits
create or replace function est_membre(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where boutique_id = b and user_id = auth.uid() and actif) $$;
create or replace function est_proprietaire(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membres where boutique_id = b and user_id = auth.uid() and actif and role = 'proprietaire') $$;

alter table boutiques enable row level security;
alter table membres enable row level security;
alter table articles enable row level security;
alter table mouvements enable row level security;

create policy b_lire on boutiques for select using (est_membre(id));
create policy m_lire on membres for select using (est_membre(boutique_id));
create policy m_modifier on membres for update using (est_proprietaire(boutique_id));

create policy a_lire on articles for select using (est_membre(boutique_id));
create policy a_creer on articles for insert with check (est_proprietaire(boutique_id));
create policy a_modifier on articles for update using (est_proprietaire(boutique_id));

create policy mv_lire on mouvements for select using (est_membre(boutique_id));
create policy mv_creer on mouvements for insert with check (est_membre(boutique_id) and cree_par = auth.uid());
create policy mv_modifier on mouvements for update using (est_membre(boutique_id));
-- aucune policy delete : rien ne se supprime

-- créer une boutique (le créateur devient propriétaire)
create or replace function creer_boutique(p_nom_boutique text, p_mon_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid; c text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  loop
    c := upper(substr(translate(encode(gen_random_bytes(8),'base64'),'+/=01OoIiLl',''),1,6));
    exit when length(c) = 6 and not exists (select 1 from boutiques where code_invitation = c);
  end loop;
  insert into boutiques (nom, code_invitation) values (p_nom_boutique, c) returning id into b;
  insert into membres (boutique_id, user_id, role, nom) values (b, auth.uid(), 'proprietaire', p_mon_nom);
  return b;
end $$;

-- rejoindre avec un code
create or replace function rejoindre_boutique(p_code text, p_mon_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select id into b from boutiques where code_invitation = upper(trim(p_code));
  if b is null then raise exception 'code_invalide'; end if;
  insert into membres (boutique_id, user_id, role, nom) values (b, auth.uid(), 'vendeuse', p_mon_nom)
  on conflict (boutique_id, user_id) do update set actif = true;
  return b;
end $$;
```

La clé `anon` va dans l'app (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`). **Jamais** la clé `service_role`.

## 4. Synchronisation

Les tables SQLite locales reprennent les colonnes ci-dessus, plus `a_envoyer` (0/1). La table `synchro` garde `dernier_pull` par table.

- **Envoi** : `upsert` vers Supabase de toutes les lignes `a_envoyer = 1`, **les articles avant les mouvements**, par paquets de 200. Si c'est un succès, `a_envoyer = 0`. Une erreur n'interrompt pas l'app et on réessaie plus tard.
- **Réception** : `select … where boutique_id = X and modifie_le > dernier_pull - 2 minutes`, puis upsert local (idempotent grâce aux UUID). Ensuite, `dernier_pull` prend le plus grand `modifie_le` reçu.
- **Conflits** :
  - mouvements : ils ne font qu'être ajoutés, donc pas de conflit. `annule` ne passe que de false à true, donc true gagne toujours ;
  - articles : la dernière modification gagne.
- **Quand** : à l'ouverture, au retour de l'app au premier plan, 3 s après chaque enregistrement, toutes les 2 min si connecté, et au retour du réseau (`@react-native-community/netinfo`).
- **Stock local** = même calcul que la vue `stock_articles`, fait en SQL dans SQLite.
- **Indicateur discret** sur l'accueil, sous les chiffres du jour, sans jamais bloquer :
  - « ✓ Tout est sauvegardé » (vert) ;
  - « 3 ventes en attente de réseau » (gris, pas rouge : ce n'est pas une erreur) ;
  - au-delà de 24 h sans synchro : « Pas de connexion depuis hier, vos ventes sont gardées dans le téléphone » (orange).
- **Migration** : les données SQLite de l'étape 1 (ids entiers) sont converties en UUID au premier lancement. Elles sont rattachées à la boutique créée et marquées `a_envoyer = 1`. Rien ne doit être perdu.
- La sauvegarde / restauration JSON par WhatsApp reste disponible dans Gérer, en secours.

## 5. Version iPhone gratuite (web)

- `npx expo export -p web` → dossier `dist/`, hébergé gratuitement sur **Cloudflare Pages** (ou Netlify).
- expo-sqlite sur le web a besoin de ces en-têtes. Créer `public/_headers` :
  ```
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
  ```
- Ajouter un **manifest** (nom « Boutique », icônes du dossier `assets/images`, `display: standalone`, `theme_color: #27306B`) et les balises `apple-touch-icon` et `apple-mobile-web-app-capable`, pour une installation propre sur l'écran d'accueil de l'iPhone.
- Ajouter un **service worker** (Workbox) qui met l'app en cache, pour qu'elle s'ouvre sans réseau.
- Sur iPhone, Safari peut effacer les données locales d'un site : la synchro Supabase est donc **obligatoire** sur le web. Afficher l'indicateur de synchro de la même façon.
- Écrire dans le README comment installer l'app : Safari → Partager → « Sur l'écran d'accueil ».

## 6. Ordre de travail

1. SQL Supabase + client Supabase + écrans Connexion et Rejoindre + téléchargement initial d'une boutique créée par le script.
2. Passage aux UUID + migration des données locales + stock calculé.
3. Synchronisation + indicateur.
4. Invitations et membres dans Gérer, rôle vendeuse.
5. Build web + Cloudflare Pages + manifest + service worker.
6. Nouvel APK Android (`eas build -p android --profile preview`).

## 7. Tests obligatoires

- Deux appareils sur la même boutique (ex. le web + l'émulateur, ou deux navigateurs) : une vente sur l'un apparaît sur l'autre en moins de 2 min, et le stock est juste des deux côtés.
- Vente hors ligne (mode avion), puis retour du réseau : la vente arrive dans Supabase, sans doublon.
- Deux ventes simultanées du même article sur deux appareils : le stock final est juste.
- Une vendeuse ne peut pas modifier un article, et c'est vérifié côté Supabase (RLS), pas seulement dans l'interface.
- Un compte d'une autre boutique ne voit aucune donnée de la première.
- La migration des données de l'étape 1 ne perd aucune vente.
