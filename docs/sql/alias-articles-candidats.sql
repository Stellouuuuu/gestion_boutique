-- Additive : alias ambigus (plusieurs articles pour un même texte_norm)
create table if not exists alias_articles_candidats (
  boutique_id uuid not null references boutiques(id) on delete cascade,
  texte_norm text not null,
  article_id uuid not null references articles(id) on delete cascade,
  cree_le timestamptz not null default now(),
  primary key (boutique_id, texte_norm, article_id)
);

create index if not exists idx_alias_candidats_boutique
  on alias_articles_candidats (boutique_id, texte_norm);

alter table alias_articles_candidats enable row level security;

drop policy if exists aac_lire on alias_articles_candidats;
create policy aac_lire on alias_articles_candidats for select using (est_membre(boutique_id));
-- Écriture : service role (seed) ; pas de policy insert pour authenticated.
