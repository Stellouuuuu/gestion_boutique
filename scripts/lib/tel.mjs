/**
 * Identique à src/lib/identifiant.ts — ne pas diverger.
 */
export function telVersIdentifiant(tel) {
  let d = String(tel).replace(/\D/g, '');
  if (d.startsWith('229')) d = d.slice(3);
  if (d.length === 8) d = '01' + d;
  if (!d.startsWith('229')) d = '229' + d;
  return `${d}@boutique-maman.app`;
}
