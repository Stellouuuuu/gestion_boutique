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

/**
 * Numéro partiellement masqué pour la liste des comptes récents.
 * Ex. `01 97 00 00 12` → `01 97 •• •• 12`
 */
export function masquerTel(telOuIdentifiant: string): string {
  const affiche = formatTelAffiche(telOuIdentifiant);
  const parts = affiche.split(/\s+/).filter(Boolean);
  if (parts.length >= 4) {
    return [...parts.slice(0, 2), '••', '••', parts[parts.length - 1]].join(' ');
  }
  if (parts.length === 3) {
    return [parts[0], '••', parts[2]].join(' ');
  }
  if (affiche.length <= 4) return affiche;
  return `${affiche.slice(0, 2)} •• •• ${affiche.slice(-2)}`;
}

/** Chiffres du téléphone à partir d’un email Supabase ou d’une saisie. */
export function telDigitsDepuis(telOuIdentifiant: string): string {
  let d = String(telOuIdentifiant).split('@')[0].replace(/\D/g, '');
  if (d.startsWith('229') && d.length > 3) d = d.slice(3);
  return d;
}
