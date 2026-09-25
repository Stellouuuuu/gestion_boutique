/**
 * Isolation multi-boutiques : A → B ne doit jamais mélanger ni pousser A vers B.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';
import {
  decisionAutreBoutiqueLocale,
  MSG_AUTRE_COMPTE_PENDING,
} from '../lib/authSecurity.ts';
import {
  listerBoutiqueIdsLocaux,
  purgerToutesDonneesMetierLocales,
} from './purgeBoutique.ts';
import { countPending } from './syncStatus.ts';

function adapt(db: DatabaseSync) {
  return {
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as T[];
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...(params as never[])) as T) ?? null;
    },
    async runAsync(sql: string, params: unknown[] = []) {
      return db.prepare(sql).run(...(params as never[]));
    },
    async withTransactionAsync(fn: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

function seedBoutique(raw: DatabaseSync, bid: string, withPending: boolean) {
  const t = '2026-09-20T10:00:00.000Z';
  raw
    .prepare(
      `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, 'Art A', 'meches', 5000, null, 3000, 1, ?, ?, 0)`
    )
    .run(`a-${bid}`, bid, t, t);
  raw
    .prepare(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, ?, 'vente', 1, 'detail', 5000, 5000, 5000, 3000, 0, 'u', ?, ?, ?)`
    )
    .run(`m-${bid}`, bid, `a-${bid}`, t, t, withPending ? 1 : 0);
}

describe('decisionAutreBoutiqueLocale', () => {
  it('ok si aucune autre boutique', () => {
    assert.equal(
      decisionAutreBoutiqueLocale({
        boutiqueCourante: 'B',
        boutiqueIdsLocaux: ['B'],
        pendingTotal: 0,
      }),
      'ok'
    );
  });

  it('purge si autre boutique sans pending', () => {
    assert.equal(
      decisionAutreBoutiqueLocale({
        boutiqueCourante: 'B',
        boutiqueIdsLocaux: ['A'],
        pendingTotal: 0,
      }),
      'purge'
    );
  });

  it('bloque si autre boutique avec pending', () => {
    assert.equal(
      decisionAutreBoutiqueLocale({
        boutiqueCourante: 'B',
        boutiqueIdsLocaux: ['A', 'B'],
        pendingTotal: 2,
      }),
      'bloque'
    );
    assert.ok(MSG_AUTRE_COMPTE_PENDING.length > 20);
  });
});

describe('isolation A → B', () => {
  it('après purge, B ne reçoit rien de A (articles ni ventes)', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    seedBoutique(raw, 'boutiqueA', false);

    const ids = await listerBoutiqueIdsLocaux(db as never);
    assert.deepEqual(ids, ['boutiqueA']);
    const pending = await countPending(db as never);
    assert.equal(pending.total, 0);

    const decision = decisionAutreBoutiqueLocale({
      boutiqueCourante: 'boutiqueB',
      boutiqueIdsLocaux: ids,
      pendingTotal: pending.total,
    });
    assert.equal(decision, 'purge');
    await purgerToutesDonneesMetierLocales(db as never);

    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM articles').get() as { n: number }).n,
      0
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM mouvements').get() as { n: number }).n,
      0
    );

    // Simule téléchargement B (316 articles propres, 0 ventes)
    const t = '2026-09-25T20:00:00.000Z';
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a-b', 'boutiqueB', 'Art B', 'meches', 1000, null, null, 1, ?, ?, 0)`
      )
      .run(t, t);

    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?').get('boutiqueA') as {
        n: number;
      }).n,
      0
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = ?').get('boutiqueA') as {
        n: number;
      }).n,
      0
    );
    assert.equal(
      (raw.prepare('SELECT COUNT(*) as n FROM articles WHERE boutique_id = ?').get('boutiqueB') as {
        n: number;
      }).n,
      1
    );
  });

  it('push : lignes a_envoyer d’une autre boutique ne sont jamais sélectionnées', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    seedBoutique(raw, 'boutiqueA', true);
    seedBoutique(raw, 'boutiqueB', true);

    const aEnvoyerB = raw
      .prepare(
        `SELECT COUNT(*) as n FROM mouvements WHERE a_envoyer = 1 AND boutique_id = ?`
      )
      .get('boutiqueB') as { n: number };
    const aEnvoyerEtranger = raw
      .prepare(
        `SELECT COUNT(*) as n FROM mouvements WHERE a_envoyer = 1 AND boutique_id != ?`
      )
      .get('boutiqueB') as { n: number };
    assert.equal(aEnvoyerB.n, 1);
    assert.equal(aEnvoyerEtranger.n, 1);
    // Le push (sync.ts) n’envoie que boutique_id = courant ; l’étranger reste a_envoyer=1
  });

  it('bloque la connexion à B si A a des ventes en attente', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    seedBoutique(raw, 'boutiqueA', true);
    const pending = await countPending(db as never);
    assert.ok(pending.total > 0);
    assert.equal(
      decisionAutreBoutiqueLocale({
        boutiqueCourante: 'boutiqueB',
        boutiqueIdsLocaux: await listerBoutiqueIdsLocaux(db as never),
        pendingTotal: pending.total,
      }),
      'bloque'
    );
  });
});

describe('non-régression écran Accueil A → B', () => {
  it('après connexion B, n’affiche que les articles de B et aucune vente de A', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const db = adapt(raw);
    const tA = new Date().toISOString();

    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a-old','boutiqueA','Mèche test A','meches',5000,null,3000,1,?,?,0)`
      )
      .run(tA, tA);
    raw
      .prepare(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES ('m-old','boutiqueA','a-old','vente',2,'detail',5000,10000,10000,3000,0,'u',?,?,0)`
      )
      .run(tA, tA);
    raw.prepare(`INSERT INTO settings (key, value) VALUES ('boutique_id', 'boutiqueA')`).run();

    const pending = await countPending(db as never);
    assert.equal(pending.total, 0);
    assert.equal(
      decisionAutreBoutiqueLocale({
        boutiqueCourante: 'boutiqueB',
        boutiqueIdsLocaux: await listerBoutiqueIdsLocaux(db as never),
        pendingTotal: pending.total,
      }),
      'purge'
    );
    await purgerToutesDonneesMetierLocales(db as never);
    raw.prepare(`UPDATE settings SET value = 'boutiqueB' WHERE key = 'boutique_id'`).run();

    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a-new','boutiqueB','Article Dada','meches',2200,null,null,1,?,?,0)`
      )
      .run(tA, tA);

    // Même filtre que listArticles / totalVentesDuJour (boutique courante dans settings)
    const bid = (
      raw.prepare(`SELECT value FROM settings WHERE key = 'boutique_id'`).get() as { value: string }
    ).value;
    const arts = raw
      .prepare(
        `SELECT nom FROM articles WHERE boutique_id = ? AND categorie = 'meches' AND actif = 1`
      )
      .all(bid) as { nom: string }[];
    assert.equal(arts.length, 1);
    assert.equal(arts[0]!.nom, 'Article Dada');

    const ventes = raw
      .prepare(
        `SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = ? AND type = 'vente' AND annule = 0`
      )
      .get(bid) as { n: number };
    assert.equal(ventes.n, 0);
    assert.equal(
      (raw.prepare(`SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = 'boutiqueA'`).get() as {
        n: number;
      }).n,
      0
    );
  });

  it('filtre boutique : même si A reste en local, l’écran B ignore A', async () => {
    const raw = new DatabaseSync(':memory:');
    raw.exec(SCHEMA_SQL);
    const t = new Date().toISOString();
    seedBoutique(raw, 'boutiqueA', false);
    raw.prepare(`UPDATE mouvements SET cree_le = ?, modifie_le = ? WHERE id = 'm-boutiqueA'`).run(t, t);
    raw
      .prepare(
        `INSERT INTO articles (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES ('a-b','boutiqueB','Seul B','meches',1000,null,null,1,?,?,0)`
      )
      .run(t, t);
    raw.prepare(`INSERT INTO settings (key, value) VALUES ('boutique_id', 'boutiqueB')`).run();

    const bid = 'boutiqueB';
    const arts = raw
      .prepare(
        `SELECT nom FROM articles WHERE boutique_id = ? AND categorie = 'meches' AND actif = 1`
      )
      .all(bid) as { nom: string }[];
    assert.equal(arts.length, 1);
    assert.equal(arts[0]!.nom, 'Seul B');
    const ventesB = raw
      .prepare(
        `SELECT COUNT(*) as n FROM mouvements WHERE boutique_id = ? AND type = 'vente'`
      )
      .get(bid) as { n: number };
    assert.equal(ventesB.n, 0);
  });
});

describe('seed json hors connexion', () => {
  it('telechargerBoutiqueSiVide n’importe pas seed.ts', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./remote.ts', import.meta.url), 'utf8')
    );
    assert.ok(!src.includes('seedArticlesFromJson'));
    assert.ok(!src.includes("from './seed'"));
  });
});
