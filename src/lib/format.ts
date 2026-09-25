const THIN_SPACE = ' ';

/** Formate un montant en francs CFA : "5 000 F" (espace fine, sans décimales). */
export function formatFCFA(n: number): string {
  const rounded = Math.round(n).toString();
  const withSeparators = rounded.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  return `${withSeparators} F`;
}

/** Axe court pour graphiques : "12 k", "1,2 M". */
export function formatAxeCourt(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const s = m >= 10 ? String(Math.round(m)) : m.toFixed(1).replace('.', ',');
    return `${n < 0 ? '-' : ''}${s} M`;
  }
  if (abs >= 1000) {
    const k = abs / 1000;
    const s = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace('.', ',');
    return `${n < 0 ? '-' : ''}${s} k`;
  }
  return String(Math.round(n));
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
