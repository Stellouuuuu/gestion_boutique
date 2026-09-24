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
