const THIN_SPACE = ' ';

/** Formate un montant en francs CFA : "5 000 F" (espace fine, sans décimales). */
export function formatFCFA(n: number): string {
  const rounded = Math.round(n).toString();
  const withSeparators = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  return `${withSeparators} F`;
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function formatDateAujourdhui(d: Date = new Date()): string {
  return `${JOURS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export function formatHeure(d: Date): string {
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}h${mm}`;
}
