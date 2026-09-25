import type { SQLiteDatabase, SQLiteBindParams } from 'expo-sqlite';
import type { BilansDb, BilanPeriode, MouvementBilan, PeriodeBounds, StockArticleFin } from './bilans.ts';
import { calculerBilan, listMouvementsPeriode, listStockFinPeriode } from './bilans.ts';
import { nomFichierPeriode } from './periodes.ts';
import * as XLSX from 'xlsx';

function bind(params: unknown[]): SQLiteBindParams {
  return params as SQLiteBindParams;
}

export interface ExportExcelResult {
  filename: string;
  /** Contenu binaire base64 (partage / téléchargement). */
  base64: string;
  bilan: BilanPeriode;
}

function sheet(data: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(data);
}

export async function buildExcelRapport(
  db: BilansDb,
  periode: PeriodeBounds,
  boutiqueNom = 'Boutique-Maman'
): Promise<ExportExcelResult> {
  const bilan = await calculerBilan(db, periode);
  const ventes = await listMouvementsPeriode(db, periode, { types: ['vente'] });
  const entrees = await listMouvementsPeriode(db, periode, { types: ['entree'] });
  const corrections = await listMouvementsPeriode(db, periode, { types: ['correction'] });
  const annulees = await listMouvementsPeriode(db, periode, {
    types: ['vente', 'entree', 'correction'],
    inclureAnnules: true,
  }).then((rows) => rows.filter((r) => r.annule === 1));
  const stock = await listStockFinPeriode(db, periode);

  const resume: unknown[][] = [
    ['Bilan', periode.label],
    ['Argent encaissé', bilan.argentEncaisse],
    ['Bénéfice estimé', bilan.benefice.montant],
    ['Bénéfice détail', bilan.benefice.label],
    ['Mèches montant', bilan.mechesMontant],
    ['Mèches pièces', bilan.mechesPieces],
    ['Produits montant', bilan.produitsMontant],
    ['Produits pièces', bilan.produitsPieces],
    ['Détail', bilan.detailMontant],
    ['Gros', bilan.grosMontant],
    ['Réductions total', bilan.reductionsTotal],
    ['Réductions nb', bilan.reductionsNb],
    ['Entrées pièces', bilan.entreesPieces],
    ['Entrées coût', bilan.entreesCout ?? ''],
    ['Stock pièces', bilan.stockPieces],
    ['Stock valeur achat', bilan.stockValeurAchat ?? ''],
    ['Stock valeur détail', bilan.stockValeurDetail],
  ];

  const ventesRows: unknown[][] = [
    [
      'Date',
      'Article',
      'Catégorie',
      'Tarif',
      'Quantité',
      'Prix unitaire',
      'Montant normal',
      'Montant payé',
      'Réduction',
      'Bénéfice',
    ],
    ...ventes.map((v) => rowVente(v)),
  ];
  const entreesRows: unknown[][] = [
    ['Date', 'Article', 'Quantité', 'Prix d’achat', 'Coût'],
    ...entrees.map((e) => [
      e.cree_le,
      e.article_nom,
      e.quantite,
      e.cout_unitaire ?? '',
      e.cout_unitaire != null ? e.quantite * e.cout_unitaire : '',
    ]),
  ];
  const corrRows: unknown[][] = [
    ['Date', 'Article', 'Quantité (delta)', 'Catégorie'],
    ...corrections.map((c) => [c.cree_le, c.article_nom, c.quantite, c.article_categorie]),
  ];
  const stockRows: unknown[][] = [
    ['Article', 'Catégorie', 'Reste', 'Prix d’achat', 'Prix détail', 'Valeur achat', 'Valeur détail'],
    ...stock.map((s: StockArticleFin) => [
      s.nom,
      s.categorie,
      s.stock,
      s.prix_achat ?? '',
      s.prix_detail ?? '',
      s.valeur_achat ?? '',
      s.valeur_detail,
    ]),
  ];
  const annuleesRows: unknown[][] = [
    ['Date', 'Type', 'Article', 'Quantité', 'Montant'],
    ...annulees.map((a) => [a.cree_le, a.type, a.article_nom, a.quantite, a.montant_paye]),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(resume), 'Résumé');
  XLSX.utils.book_append_sheet(wb, sheet(ventesRows), 'Ventes');
  XLSX.utils.book_append_sheet(wb, sheet(entreesRows), 'Entrées');
  XLSX.utils.book_append_sheet(wb, sheet(corrRows), 'Corrections');
  XLSX.utils.book_append_sheet(wb, sheet(stockRows), 'Stock fin de période');
  XLSX.utils.book_append_sheet(wb, sheet(annuleesRows), 'Annulées');

  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
  const filename = nomFichierPeriode(sanitizeNom(boutiqueNom), periode, 'xlsx');
  return { filename, base64, bilan };
}

function rowVente(v: MouvementBilan): unknown[] {
  const benef =
    v.cout_unitaire != null ? v.montant_paye - v.quantite * v.cout_unitaire : '';
  return [
    v.cree_le,
    v.article_nom,
    v.article_categorie,
    v.tarif ?? '',
    v.quantite,
    v.prix_unitaire,
    v.montant_normal,
    v.montant_paye,
    v.montant_normal - v.montant_paye,
    benef,
  ];
}

function sanitizeNom(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'Boutique';
}

/** HTML d’une page PDF résumé (expo-print). */
export function buildPdfHtml(bilan: BilanPeriode, boutiqueNom: string): string {
  const b = bilan;
  const rows = [
    ['Argent encaissé', `${b.argentEncaisse} F`],
    ['Bénéfice', b.benefice.label],
    ['Mèches', `${b.mechesMontant} F · ${b.mechesPieces} pièces`],
    ['Produits', `${b.produitsMontant} F · ${b.produitsPieces} pièces`],
    ['Détail / Gros', `${b.detailMontant} F / ${b.grosMontant} F`],
    ['Réductions', `${b.reductionsTotal} F (${b.reductionsNb})`],
    ['Entrées', `${b.entreesPieces} pièces`],
    [
      'Stock fin',
      `${b.stockPieces} pièces · détail ${b.stockValeurDetail} F` +
        (b.stockValeurAchat != null ? ` · achat ${b.stockValeurAchat} F` : ''),
    ],
  ];
  const tr = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #ddd;color:#555">${escapeHtml(String(k))}</td><td style="padding:8px;border-bottom:1px solid #ddd;font-weight:700;text-align:right">${escapeHtml(String(v))}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(b.periode.label)}</title></head>
<body style="font-family: system-ui, sans-serif; color:#1B1E3A; padding:24px;">
  <h1 style="color:#27306B;margin:0 0 4px">${escapeHtml(boutiqueNom)}</h1>
  <p style="color:#666;margin:0 0 24px">${escapeHtml(b.periode.label)}</p>
  <table style="width:100%;border-collapse:collapse">${tr}</table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SauvegardeJson {
  version: 1;
  exporte_le: string;
  boutique_id: string;
  articles: Record<string, unknown>[];
  mouvements: Record<string, unknown>[];
  inventaires: Record<string, unknown>[];
  inventaire_lignes: Record<string, unknown>[];
}

export async function buildSauvegardeJson(
  db: BilansDb,
  boutiqueId: string
): Promise<{ filename: string; json: string; data: SauvegardeJson }> {
  const [articles, mouvements, inventaires, inventaire_lignes] = await Promise.all([
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM articles WHERE boutique_id = ?', [
      boutiqueId,
    ]),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM mouvements WHERE boutique_id = ?', [
      boutiqueId,
    ]),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM inventaires WHERE boutique_id = ?', [
      boutiqueId,
    ]),
    db.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM inventaire_lignes WHERE boutique_id = ?',
      [boutiqueId]
    ),
  ]);
  const data: SauvegardeJson = {
    version: 1,
    exporte_le: new Date().toISOString(),
    boutique_id: boutiqueId,
    articles,
    mouvements,
    inventaires,
    inventaire_lignes,
  };
  const json = JSON.stringify(data, null, 2);
  const filename = `${sanitizeNom('Boutique-Maman')}_sauvegarde.json`;
  return { filename, json, data };
}

/** Restaure une sauvegarde JSON dans la boutique locale (écrase articles/mouvements de cette boutique). */
export async function restaurerSauvegarde(
  db: Pick<SQLiteDatabase, 'runAsync' | 'withTransactionAsync'>,
  data: SauvegardeJson
): Promise<void> {
  if (data.version !== 1) throw new Error('Sauvegarde inconnue (version).');
  const bid = data.boutique_id;
  const run = async () => {
    await db.runAsync('DELETE FROM inventaire_lignes WHERE boutique_id = ?', [bid]);
    await db.runAsync('DELETE FROM inventaires WHERE boutique_id = ?', [bid]);
    await db.runAsync('DELETE FROM mouvements WHERE boutique_id = ?', [bid]);
    await db.runAsync('DELETE FROM articles WHERE boutique_id = ?', [bid]);
    for (const a of data.articles) {
      await db.runAsync(
        `INSERT INTO articles
           (id, boutique_id, nom, categorie, prix_detail, prix_gros, prix_achat, actif, cree_le, modifie_le, a_envoyer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind([
          a.id,
          a.boutique_id,
          a.nom,
          a.categorie,
          a.prix_detail,
          a.prix_gros,
          a.prix_achat,
          a.actif,
          a.cree_le,
          a.modifie_le,
          a.a_envoyer ?? 0,
        ])
      );
    }
    for (const m of data.mouvements) {
      await db.runAsync(
        `INSERT INTO mouvements
           (id, boutique_id, article_id, type, quantite, tarif, prix_unitaire, montant_normal, montant_paye,
            cout_unitaire, annule, annule_le, cree_par, cree_le, modifie_le, a_envoyer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind([
          m.id,
          m.boutique_id,
          m.article_id,
          m.type,
          m.quantite,
          m.tarif,
          m.prix_unitaire,
          m.montant_normal,
          m.montant_paye,
          m.cout_unitaire,
          m.annule,
          m.annule_le,
          m.cree_par,
          m.cree_le,
          m.modifie_le,
          m.a_envoyer ?? 0,
        ])
      );
    }
    for (const inv of data.inventaires) {
      await db.runAsync(
        `INSERT INTO inventaires
           (id, boutique_id, perimetre, statut, fait_par, commence_le, termine_le, note, modifie_le, a_envoyer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind([
          inv.id,
          inv.boutique_id,
          inv.perimetre,
          inv.statut,
          inv.fait_par,
          inv.commence_le,
          inv.termine_le,
          inv.note,
          inv.modifie_le,
          inv.a_envoyer ?? 0,
        ])
      );
    }
    for (const l of data.inventaire_lignes) {
      await db.runAsync(
        `INSERT INTO inventaire_lignes
           (id, inventaire_id, boutique_id, article_id, stock_attendu, stock_compte, compte_le, mouvement_id, modifie_le, a_envoyer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bind([
          l.id,
          l.inventaire_id,
          l.boutique_id,
          l.article_id,
          l.stock_attendu,
          l.stock_compte,
          l.compte_le,
          l.mouvement_id,
          l.modifie_le,
          l.a_envoyer ?? 0,
        ])
      );
    }
  };
  await db.withTransactionAsync(run);
}
