/**
 * Expression SQL du stock (même règle que la vue Supabase `stock_articles`) :
 * vente = −quantité, entrée/correction = +quantité (delta signé), annulés ignorés.
 * Utiliser avec un alias de table articles (ex. `a`) : stockExpr('a.id').
 */
export function stockExpr(articleIdRef = 'articles.id'): string {
  return `COALESCE((
    SELECT SUM(
      CASE
        WHEN m.annule = 1 THEN 0
        WHEN m.type = 'vente' THEN -m.quantite
        ELSE m.quantite
      END
    )
    FROM mouvements m
    WHERE m.article_id = ${articleIdRef}
  ), 0)`;
}

/** Colonnes article + stock calculé (alias `a`). */
export const ARTICLE_SELECT_WITH_STOCK = `a.*, ${stockExpr('a.id')} AS stock`;

export type MouvementPourStock = {
  type: 'vente' | 'entree' | 'correction';
  quantite: number;
  annule: boolean | number;
};

/** Même règle en JS (tests et calculs hors SQL). */
export function stockDepuisMouvements(mouvements: MouvementPourStock[]): number {
  let stock = 0;
  for (const m of mouvements) {
    if (m.annule === 1 || m.annule === true) continue;
    stock += m.type === 'vente' ? -m.quantite : m.quantite;
  }
  return stock;
}
