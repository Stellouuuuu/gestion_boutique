/**
 * Prépare cree_par avant upsert Supabase.
 * RLS mv_creer exige cree_par = auth.uid() — les ventes locales oubliées
 * (cree_par null) doivent être complétées, sinon l’envoi échoue à jamais.
 */
export function fillCreeParForPush(
  row: { id: string; cree_par: string | null },
  authUid: string | null
): { cree_par: string; filled: boolean } {
  if (row.cree_par) {
    return { cree_par: row.cree_par, filled: false };
  }
  if (!authUid) {
    throw new Error(
      `mouvement ${row.id} : cree_par manquant et session absente (RLS bloquerait l’upsert)`
    );
  }
  return { cree_par: authUid, filled: true };
}
