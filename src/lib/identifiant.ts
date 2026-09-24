/**
 * Transforme un numéro de téléphone en identifiant Supabase (pas un vrai email,
 * aucun email n'est jamais envoyé). Règle identique, au caractère près, à
 * `telVersIdentifiant()` dans scripts/creer-compte-maman.mjs : si les deux
 * divergent, Maman ne peut plus se connecter.
 *
 * Chiffres seulement, préfixe 229 ajouté s'il manque.
 */
export function telVersIdentifiant(tel: string): string {
  let d = String(tel).replace(/\D/g, '');
  if (!d.startsWith('229')) d = '229' + d;
  return `${d}@boutique-maman.app`;
}

/**
 * Affichage lisible à partir de l'identifiant / email Supabase, ou d'un numéro brut.
 * Ex. `2290197000000@boutique-maman.app` → `01 97 00 00 00`
 */
export function formatTelAffiche(telOuIdentifiant: string): string {
  let d = String(telOuIdentifiant).split('@')[0].replace(/\D/g, '');
  if (d.startsWith('229') && d.length > 3) d = d.slice(3);
  if (!d) return '';
  return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
}
