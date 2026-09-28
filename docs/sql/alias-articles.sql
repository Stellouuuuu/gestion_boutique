-- =============================================================================
-- Migration ADDITIVE — alias manuscrits (TEST d’abord, PRODUCTION après accord)
-- Idempotent. Ne droppe rien.
-- =============================================================================

create table if not exists alias_articles (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  texte_norm text not null,
  article_id uuid not null references articles(id) on delete cascade,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  primary key (boutique_id, texte_norm)
);

create index if not exists idx_alias_articles_boutique
  on alias_articles (boutique_id, modifie_le);

drop trigger if exists trg_alias_articles_modifie on alias_articles;
create trigger trg_alias_articles_modifie
  before update on alias_articles
  for each row execute function toucher_modifie_le();

alter table alias_articles enable row level security;

drop policy if exists aa_lire on alias_articles;
create policy aa_lire on alias_articles for select using (est_membre(boutique_id));

drop policy if exists aa_creer on alias_articles;
create policy aa_creer on alias_articles for insert with check (est_membre(boutique_id));

drop policy if exists aa_modifier on alias_articles;
create policy aa_modifier on alias_articles for update
  using (est_membre(boutique_id)) with check (est_membre(boutique_id));

drop policy if exists aa_supprimer on alias_articles;
create policy aa_supprimer on alias_articles for delete using (est_membre(boutique_id));
