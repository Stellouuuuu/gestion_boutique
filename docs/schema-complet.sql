-- =============================================================================
-- Schéma Supabase COMPLET — Boutique de Maman
-- À coller en une seule fois dans l’éditeur SQL du projet de TEST (boutique-test).
-- Idempotent autant que possible (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- Après exécution : Auth → Providers → Email → désactiver « Confirm email ».
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists boutiques (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  code_invitation text unique not null,
  cree_le timestamptz not null default now()
);

create table if not exists membres (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('proprietaire','vendeuse')),
  nom text not null,
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  primary key (boutique_id, user_id)
);

create table if not exists articles (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  nom text not null,
  categorie text not null check (categorie in ('meches','produits')),
  prix_detail integer check (prix_detail is null or prix_detail >= 0),
  prix_gros integer check (prix_gros is null or prix_gros >= 0),
  prix_achat integer check (prix_achat is null or prix_achat >= 0),
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create table if not exists mouvements (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  article_id uuid not null references articles(id),
  type text not null check (type in ('vente','entree','correction')),
  quantite integer not null check (quantite <> 0),
  tarif text check (tarif in ('detail','gros')),
  prix_unitaire integer not null default 0,
  montant_normal integer not null default 0,
  montant_paye integer not null default 0,
  cout_unitaire integer check (cout_unitaire is null or cout_unitaire >= 0),
  annule boolean not null default false,
  annule_le timestamptz,
  cree_par uuid references auth.users(id),
  cree_le timestamptz not null,
  modifie_le timestamptz not null default now()
);

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

create index if not exists idx_articles_synchro on articles (boutique_id, modifie_le);
create index if not exists idx_mouvements_synchro on mouvements (boutique_id, modifie_le);
create index if not exists idx_mouvements_article on mouvements (article_id);
create index if not exists idx_mouvements_date on mouvements (boutique_id, cree_le);
create index if not exists idx_inventaires_synchro on inventaires (boutique_id, modifie_le);
create index if not exists idx_invlignes_synchro on inventaire_lignes (boutique_id, modifie_le);

-- ---------------------------------------------------------------------------
-- Triggers modifie_le
-- ---------------------------------------------------------------------------

create or replace function toucher_modifie_le() returns trigger language plpgsql as $$
begin new.modifie_le := now(); return new; end $$;

drop trigger if exists t_articles on articles;
create trigger t_articles before insert or update on articles
  for each row execute function toucher_modifie_le();

drop trigger if exists t_mouvements on mouvements;
create trigger t_mouvements before insert or update on mouvements
  for each row execute function toucher_modifie_le();

drop trigger if exists t_inventaires on inventaires;
create trigger t_inventaires before insert or update on inventaires
  for each row execute function toucher_modifie_le();

drop trigger if exists t_inventaire_lignes on inventaire_lignes;
create trigger t_inventaire_lignes before insert or update on inventaire_lignes
  for each row execute function toucher_modifie_le();

-- ---------------------------------------------------------------------------
-- Vue stock
-- ---------------------------------------------------------------------------

create or replace view stock_articles with (security_invoker = true) as
select a.id as article_id, a.boutique_id,
  coalesce(sum(case when m.annule then 0
                    when m.type = 'vente' then -m.quantite
                    else m.quantite end), 0)::int as stock
from articles a left join mouvements m on m.article_id = a.id
group by a.id, a.boutique_id;

-- ---------------------------------------------------------------------------
-- Helpers RLS
-- ---------------------------------------------------------------------------

create or replace function est_membre(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membres
    where boutique_id = b and user_id = auth.uid() and actif
  )
$$;

create or replace function est_proprietaire(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from membres
    where boutique_id = b and user_id = auth.uid() and actif and role = 'proprietaire'
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table boutiques enable row level security;
alter table membres enable row level security;
alter table articles enable row level security;
alter table mouvements enable row level security;
alter table inventaires enable row level security;
alter table inventaire_lignes enable row level security;

drop policy if exists b_lire on boutiques;
create policy b_lire on boutiques for select using (est_membre(id));

drop policy if exists b_modifier on boutiques;
create policy b_modifier on boutiques
  for update
  using (est_proprietaire(id))
  with check (est_proprietaire(id));

drop policy if exists m_lire on membres;
create policy m_lire on membres for select using (est_membre(boutique_id));

drop policy if exists m_modifier on membres;
drop policy if exists m_modifier_soi on membres;
create policy m_modifier on membres
  for update
  using (est_proprietaire(boutique_id) or (user_id = auth.uid() and actif))
  with check (est_proprietaire(boutique_id) or user_id = auth.uid());

drop policy if exists a_lire on articles;
create policy a_lire on articles for select using (est_membre(boutique_id));
drop policy if exists a_creer on articles;
create policy a_creer on articles for insert with check (est_proprietaire(boutique_id));
drop policy if exists a_modifier on articles;
create policy a_modifier on articles for update using (est_proprietaire(boutique_id));

drop policy if exists mv_lire on mouvements;
create policy mv_lire on mouvements for select using (est_membre(boutique_id));
drop policy if exists mv_creer on mouvements;
create policy mv_creer on mouvements
  for insert with check (est_membre(boutique_id) and cree_par = auth.uid());
drop policy if exists mv_modifier on mouvements;
create policy mv_modifier on mouvements for update using (est_membre(boutique_id));
-- aucune policy delete : rien ne se supprime côté client

drop policy if exists inv_lire on inventaires;
create policy inv_lire on inventaires for select using (est_membre(boutique_id));
drop policy if exists inv_creer on inventaires;
create policy inv_creer on inventaires for insert with check (est_proprietaire(boutique_id));
drop policy if exists inv_modifier on inventaires;
create policy inv_modifier on inventaires for update using (est_proprietaire(boutique_id));

drop policy if exists invl_lire on inventaire_lignes;
create policy invl_lire on inventaire_lignes for select using (est_membre(boutique_id));
drop policy if exists invl_creer on inventaire_lignes;
create policy invl_creer on inventaire_lignes for insert with check (est_proprietaire(boutique_id));
drop policy if exists invl_modifier on inventaire_lignes;
create policy invl_modifier on inventaire_lignes for update using (est_proprietaire(boutique_id));

-- ---------------------------------------------------------------------------
-- RPCs inscription
-- ---------------------------------------------------------------------------

create or replace function creer_boutique(p_nom_boutique text, p_mon_nom text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare b uuid; c text;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  if length(trim(p_nom_boutique)) < 1 then raise exception 'nom_boutique_requis'; end if;
  if length(trim(p_mon_nom)) < 1 then raise exception 'nom_requis'; end if;
  loop
    c := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=01OoIiLl', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from boutiques where code_invitation = c);
  end loop;
  insert into boutiques (nom, code_invitation) values (trim(p_nom_boutique), c) returning id into b;
  insert into membres (boutique_id, user_id, role, nom)
    values (b, auth.uid(), 'proprietaire', trim(p_mon_nom));
  return b;
end $$;

create or replace function rejoindre_boutique(p_code text, p_mon_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if auth.uid() is null then raise exception 'non connecté'; end if;
  select id into b from boutiques where code_invitation = upper(trim(p_code));
  if b is null then raise exception 'code_invalide'; end if;
  insert into membres (boutique_id, user_id, role, nom)
    values (b, auth.uid(), 'vendeuse', trim(p_mon_nom))
  on conflict (boutique_id, user_id) do update set actif = true;
  return b;
end $$;

grant execute on function creer_boutique(text, text) to authenticated;
grant execute on function rejoindre_boutique(text, text) to authenticated;
