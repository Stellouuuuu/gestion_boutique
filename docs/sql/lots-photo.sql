-- =============================================================================
-- Migration ADDITIVE — lots photo (TEST d’abord, PRODUCTION après accord)
-- Idempotent. Ne droppe rien.
-- =============================================================================

-- Lots issus d’une photo de feuille manuscrite
create table if not exists lots_photo (
  id uuid primary key,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  date_feuille date not null,
  nb_lignes integer not null default 0,
  total integer not null default 0,
  photo_path text,
  lecture_ia jsonb,
  resultat_valide jsonb,
  cree_par uuid references auth.users(id),
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  annule boolean not null default false
);

create index if not exists idx_lots_photo_boutique_modifie
  on lots_photo (boutique_id, modifie_le);

-- Colonnes sur mouvements (ventes photo)
alter table mouvements add column if not exists source text not null default 'manuel';
alter table mouvements add column if not exists lot_id uuid references lots_photo(id);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'mouvements_source_check'
  ) then
    alter table mouvements
      add constraint mouvements_source_check check (source in ('manuel','photo'));
  end if;
end $$;

create index if not exists idx_mouvements_lot on mouvements (lot_id);

-- Trigger modifie_le
drop trigger if exists trg_lots_photo_modifie on lots_photo;
create trigger trg_lots_photo_modifie
  before update on lots_photo
  for each row execute function toucher_modifie_le();

-- RLS
alter table lots_photo enable row level security;

drop policy if exists lp_lire on lots_photo;
create policy lp_lire on lots_photo for select using (est_membre(boutique_id));

drop policy if exists lp_creer on lots_photo;
create policy lp_creer on lots_photo for insert with check (est_membre(boutique_id));

drop policy if exists lp_modifier on lots_photo;
create policy lp_modifier on lots_photo for update
  using (est_membre(boutique_id)) with check (est_membre(boutique_id));

-- Compteur anti-abus (photos / jour / boutique) — table de quotas
create table if not exists quotas_photo (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  jour date not null,
  nb integer not null default 0,
  primary key (boutique_id, jour)
);

alter table quotas_photo enable row level security;
-- Lecture/écriture réservée au service role (Edge Function) : pas de policy pour authenticated.

-- Storage bucket privé (à créer aussi via dashboard ou API si besoin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feuilles-photo',
  'feuilles-photo',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- Policies storage : chemin = {boutique_id}/{lot_id}.jpg
drop policy if exists feuilles_photo_lire on storage.objects;
create policy feuilles_photo_lire on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feuilles-photo'
    and est_membre((storage.foldername(name))[1]::uuid)
  );

drop policy if exists feuilles_photo_creer on storage.objects;
create policy feuilles_photo_creer on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feuilles-photo'
    and est_membre((storage.foldername(name))[1]::uuid)
  );

-- Voir aussi docs/sql/alias-articles.sql (surnoms manuscrits).
