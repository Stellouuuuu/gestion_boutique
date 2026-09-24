/** Schéma local v2 : UUID partout, stock calculé, prêt pour synchro + bilans. */
export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  nom TEXT NOT NULL,
  categorie TEXT NOT NULL CHECK (categorie IN ('meches','produits')),
  prix_detail INTEGER,
  prix_gros INTEGER,
  prix_achat INTEGER,
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mouvements (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id),
  type TEXT NOT NULL CHECK (type IN ('vente','entree','correction')),
  quantite INTEGER NOT NULL CHECK (quantite <> 0),
  tarif TEXT CHECK (tarif IN ('detail','gros')),
  prix_unitaire INTEGER NOT NULL DEFAULT 0,
  montant_normal INTEGER NOT NULL DEFAULT 0,
  montant_paye INTEGER NOT NULL DEFAULT 0,
  cout_unitaire INTEGER,
  annule INTEGER NOT NULL DEFAULT 0,
  annule_le TEXT,
  cree_par TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventaires (
  id TEXT PRIMARY KEY NOT NULL,
  boutique_id TEXT NOT NULL,
  perimetre TEXT NOT NULL CHECK (perimetre IN ('tout','meches','produits')),
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours','termine','abandonne')),
  fait_par TEXT,
  commence_le TEXT NOT NULL,
  termine_le TEXT,
  note TEXT,
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventaire_lignes (
  id TEXT PRIMARY KEY NOT NULL,
  inventaire_id TEXT NOT NULL REFERENCES inventaires(id) ON DELETE CASCADE,
  boutique_id TEXT NOT NULL,
  article_id TEXT NOT NULL REFERENCES articles(id),
  stock_attendu INTEGER NOT NULL,
  stock_compte INTEGER NOT NULL CHECK (stock_compte >= 0),
  compte_le TEXT NOT NULL,
  mouvement_id TEXT REFERENCES mouvements(id),
  modifie_le TEXT NOT NULL,
  a_envoyer INTEGER NOT NULL DEFAULT 0,
  UNIQUE (inventaire_id, article_id)
);

CREATE TABLE IF NOT EXISTS synchro (
  table_name TEXT PRIMARY KEY NOT NULL,
  dernier_pull TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_categorie ON articles(categorie, actif);
CREATE INDEX IF NOT EXISTS idx_articles_boutique ON articles(boutique_id);
CREATE INDEX IF NOT EXISTS idx_articles_modifie ON articles(boutique_id, modifie_le);
CREATE INDEX IF NOT EXISTS idx_mouvements_article ON mouvements(article_id);
CREATE INDEX IF NOT EXISTS idx_mouvements_cree_le ON mouvements(cree_le);
CREATE INDEX IF NOT EXISTS idx_mouvements_article_cree ON mouvements(article_id, cree_le);
CREATE INDEX IF NOT EXISTS idx_mouvements_boutique_modifie ON mouvements(boutique_id, modifie_le);
CREATE INDEX IF NOT EXISTS idx_inventaires_synchro ON inventaires(boutique_id, modifie_le);
CREATE INDEX IF NOT EXISTS idx_invlignes_synchro ON inventaire_lignes(boutique_id, modifie_le);
`;
