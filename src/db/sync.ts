import type { SQLiteDatabase } from 'expo-sqlite';
import { supabase } from '../lib/supabase';
import { fillCreeParForPush } from './syncPush';
import {
  clearDerniereSynchroErreur,
  getDernierPull,
  setDernierPull,
  setDerniereSynchroErreur,
  setDerniereSynchroOk,
  SYNC_PUSH_ORDER,
  type SyncTable,
} from './syncStatus';

const BATCH = 200;
const PULL_SKEW_MS = 2 * 60 * 1000; // 2 minutes de marge

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function minusSkew(iso: string | null): string {
  if (!iso) return '1970-01-01T00:00:00.000Z';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '1970-01-01T00:00:00.000Z';
  return new Date(t - PULL_SKEW_MS).toISOString();
}

function boolFromSqlite(v: unknown): boolean {
  return v === 1 || v === true;
}

/** Envoi des lignes a_envoyer = 1, dans l'ordre parents → enfants. */
async function pushTable(db: SQLiteDatabase, table: SyncTable): Promise<void> {
  if (table === 'articles') {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le
       FROM articles WHERE a_envoyer = 1`
    );
    for (const lot of chunks(rows, BATCH)) {
      if (lot.length === 0) continue;
      const payload = lot.map((r) => ({
        id: r.id,
        boutique_id: r.boutique_id,
        nom: r.nom,
        categorie: r.categorie,
        prix_detail: r.prix_detail,
        prix_gros: r.prix_gros,
        prix_achat: r.prix_achat,
        actif: boolFromSqlite(r.actif),
        cree_le: r.cree_le,
      }));
      const { error } = await supabase.from('articles').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      const ids = lot.map((r) => r.id as string);
      await db.runAsync(
        `UPDATE articles SET a_envoyer = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }
    return;
  }

  if (table === 'mouvements') {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal,
              montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le
       FROM mouvements WHERE a_envoyer = 1`
    );
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const authUid = user?.id ?? null;

    for (const lot of chunks(rows, BATCH)) {
      if (lot.length === 0) continue;
      const payload = [];
      for (const r of lot) {
        const { cree_par, filled } = fillCreeParForPush(
          { id: String(r.id), cree_par: (r.cree_par as string | null) ?? null },
          authUid
        );
        if (filled) {
          await db.runAsync('UPDATE mouvements SET cree_par = ? WHERE id = ?', [
            cree_par,
            r.id as string,
          ]);
        }
        payload.push({
          id: r.id,
          boutique_id: r.boutique_id,
          article_id: r.article_id,
          type: r.type,
          quantite: r.quantite,
          tarif: r.tarif,
          prix_unitaire: r.prix_unitaire ?? 0,
          montant_normal: r.montant_normal ?? 0,
          montant_paye: r.montant_paye ?? 0,
          cout_unitaire: r.cout_unitaire,
          annule: boolFromSqlite(r.annule),
          annule_le: r.annule_le,
          cree_par,
          cree_le: r.cree_le,
        });
      }
      const { error } = await supabase.from('mouvements').upsert(payload, { onConflict: 'id' });
      if (error) throw error;
      const ids = lot.map((r) => r.id as string);
      await db.runAsync(
        `UPDATE mouvements SET a_envoyer = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }
    return;
  }

  if (table === 'inventaires') {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, boutique_id, perimetre, statut, fait_par, commence_le, termine_le, note
       FROM inventaires WHERE a_envoyer = 1`
    );
    for (const lot of chunks(rows, BATCH)) {
      if (lot.length === 0) continue;
      const { error } = await supabase.from('inventaires').upsert(lot, { onConflict: 'id' });
      if (error) throw error;
      const ids = lot.map((r) => r.id as string);
      await db.runAsync(
        `UPDATE inventaires SET a_envoyer = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
      );
    }
    return;
  }

  // inventaire_lignes
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, inventaire_id, boutique_id, article_id, stock_attendu, stock_compte, compte_le, mouvement_id
     FROM inventaire_lignes WHERE a_envoyer = 1`
  );
  for (const lot of chunks(rows, BATCH)) {
    if (lot.length === 0) continue;
    const { error } = await supabase.from('inventaire_lignes').upsert(lot, { onConflict: 'id' });
    if (error) throw error;
    const ids = lot.map((r) => r.id as string);
    await db.runAsync(
      `UPDATE inventaire_lignes SET a_envoyer = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }
}

async function pullArticles(db: SQLiteDatabase, boutiqueId: string, since: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le')
    .eq('boutique_id', boutiqueId)
    .gt('modifie_le', since);
  if (error) throw error;
  if (!data?.length) return null;

  let maxMod: string | null = null;
  for (const a of data) {
    if (!maxMod || a.modifie_le > maxMod) maxMod = a.modifie_le;
    const local = await db.getFirstAsync<{ a_envoyer: number; modifie_le: string }>(
      'SELECT a_envoyer, modifie_le FROM articles WHERE id = ?',
      [a.id]
    );
    if (local?.a_envoyer === 1) continue; // push prioritaire, ne pas écraser
    await db.runAsync(
      `INSERT INTO articles
         (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         nom = excluded.nom,
         categorie = excluded.categorie,
         prix_detail = excluded.prix_detail,
         prix_gros = excluded.prix_gros,
         prix_achat = excluded.prix_achat,
         actif = excluded.actif,
         modifie_le = excluded.modifie_le,
         a_envoyer = 0`,
      [
        a.id,
        a.boutique_id,
        a.nom,
        a.categorie,
        a.prix_detail,
        a.prix_gros,
        a.prix_achat,
        a.actif ? 1 : 0,
        a.cree_le,
        a.modifie_le,
      ]
    );
  }
  return maxMod;
}

async function pullMouvements(
  db: SQLiteDatabase,
  boutiqueId: string,
  since: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('mouvements')
    .select(
      'id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye, cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le'
    )
    .eq('boutique_id', boutiqueId)
    .gt('modifie_le', since);
  if (error) throw error;
  if (!data?.length) return null;

  let maxMod: string | null = null;
  for (const m of data) {
    if (!maxMod || m.modifie_le > maxMod) maxMod = m.modifie_le;
    const local = await db.getFirstAsync<{ a_envoyer: number; annule: number }>(
      'SELECT a_envoyer, annule FROM mouvements WHERE id = ?',
      [m.id]
    );
    if (local?.a_envoyer === 1) {
      // Fusion annule : true gagne toujours, même si on poussera ensuite.
      if (m.annule && !local.annule) {
        await db.runAsync(
          'UPDATE mouvements SET annule = 1, annule_le = ?, modifie_le = ? WHERE id = ?',
          [m.annule_le ?? new Date().toISOString(), m.modifie_le, m.id]
        );
      }
      continue;
    }
    const annule = m.annule || local?.annule === 1 ? 1 : 0;
    await db.runAsync(
      `INSERT INTO mouvements
         (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
          cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         annule = CASE WHEN excluded.annule = 1 OR mouvements.annule = 1 THEN 1 ELSE 0 END,
         annule_le = COALESCE(excluded.annule_le, mouvements.annule_le),
         quantite = excluded.quantite,
         tarif = excluded.tarif,
         prix_unitaire = excluded.prix_unitaire,
         montant_normal = excluded.montant_normal,
         montant_paye = excluded.montant_paye,
         cout_unitaire = excluded.cout_unitaire,
         modifie_le = excluded.modifie_le,
         a_envoyer = 0`,
      [
        m.id,
        m.boutique_id,
        m.article_id,
        m.type,
        m.quantite,
        m.tarif,
        m.prix_unitaire ?? 0,
        m.montant_normal ?? 0,
        m.montant_paye ?? 0,
        m.cout_unitaire,
        annule,
        m.annule_le,
        m.cree_par,
        m.cree_le,
        m.modifie_le,
      ]
    );
  }
  return maxMod;
}

async function pullInventaires(
  db: SQLiteDatabase,
  boutiqueId: string,
  since: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventaires')
    .select(
      'id, boutique_id, perimetre, statut, fait_par, commence_le, termine_le, note, modifie_le'
    )
    .eq('boutique_id', boutiqueId)
    .gt('modifie_le', since);
  if (error) throw error;
  if (!data?.length) return null;

  let maxMod: string | null = null;
  for (const inv of data) {
    if (!maxMod || inv.modifie_le > maxMod) maxMod = inv.modifie_le;
    const local = await db.getFirstAsync<{ a_envoyer: number }>(
      'SELECT a_envoyer FROM inventaires WHERE id = ?',
      [inv.id]
    );
    if (local?.a_envoyer === 1) continue;
    await db.runAsync(
      `INSERT INTO inventaires
         (id, boutique_id, perimetre, statut, fait_par, commence_le, termine_le, note, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         perimetre = excluded.perimetre,
         statut = excluded.statut,
         fait_par = excluded.fait_par,
         commence_le = excluded.commence_le,
         termine_le = excluded.termine_le,
         note = excluded.note,
         modifie_le = excluded.modifie_le,
         a_envoyer = 0`,
      [
        inv.id,
        inv.boutique_id,
        inv.perimetre,
        inv.statut,
        inv.fait_par,
        inv.commence_le,
        inv.termine_le,
        inv.note,
        inv.modifie_le,
      ]
    );
  }
  return maxMod;
}

async function pullInventaireLignes(
  db: SQLiteDatabase,
  boutiqueId: string,
  since: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('inventaire_lignes')
    .select(
      'id, inventaire_id, boutique_id, article_id, stock_attendu, stock_compte, compte_le, mouvement_id, modifie_le'
    )
    .eq('boutique_id', boutiqueId)
    .gt('modifie_le', since);
  if (error) throw error;
  if (!data?.length) return null;

  let maxMod: string | null = null;
  for (const l of data) {
    if (!maxMod || l.modifie_le > maxMod) maxMod = l.modifie_le;
    const local = await db.getFirstAsync<{ a_envoyer: number }>(
      'SELECT a_envoyer FROM inventaire_lignes WHERE id = ?',
      [l.id]
    );
    if (local?.a_envoyer === 1) continue;
    await db.runAsync(
      `INSERT INTO inventaire_lignes
         (id, inventaire_id, boutique_id, article_id, stock_attendu, stock_compte, compte_le, mouvement_id, modifie_le, a_envoyer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         stock_attendu = excluded.stock_attendu,
         stock_compte = excluded.stock_compte,
         compte_le = excluded.compte_le,
         mouvement_id = excluded.mouvement_id,
         modifie_le = excluded.modifie_le,
         a_envoyer = 0`,
      [
        l.id,
        l.inventaire_id,
        l.boutique_id,
        l.article_id,
        l.stock_attendu,
        l.stock_compte,
        l.compte_le,
        l.mouvement_id,
        l.modifie_le,
      ]
    );
  }
  return maxMod;
}

async function pullTable(
  db: SQLiteDatabase,
  boutiqueId: string,
  table: SyncTable
): Promise<void> {
  const dernier = await getDernierPull(db, table);
  const since = minusSkew(dernier);
  let maxMod: string | null = null;
  if (table === 'articles') maxMod = await pullArticles(db, boutiqueId, since);
  else if (table === 'mouvements') maxMod = await pullMouvements(db, boutiqueId, since);
  else if (table === 'inventaires') maxMod = await pullInventaires(db, boutiqueId, since);
  else maxMod = await pullInventaireLignes(db, boutiqueId, since);
  if (maxMod) await setDernierPull(db, table, maxMod);
}

export interface SyncResult {
  ok: boolean;
  error?: string;
}

/**
 * Cycle complet : push puis pull. Ne lance jamais d'exception vers l'UI —
 * les erreurs sont renvoyées pour journal / retry.
 */
export async function synchroniserBoutique(
  db: SQLiteDatabase,
  boutiqueId: string
): Promise<SyncResult> {
  try {
    for (const table of SYNC_PUSH_ORDER) {
      await pushTable(db, table);
    }
    for (const table of SYNC_PUSH_ORDER) {
      await pullTable(db, boutiqueId, table);
    }
    await setDerniereSynchroOk(db, new Date().toISOString());
    await clearDerniereSynchroErreur(db);
    return { ok: true };
  } catch (e) {
    const message =
      e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : e instanceof Error
          ? e.message
          : String(e);
    await setDerniereSynchroErreur(db, message);
    return { ok: false, error: message };
  }
}
