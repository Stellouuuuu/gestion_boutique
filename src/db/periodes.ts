/**
 * Périodes locales Africa/Porto-Novo (UTC+1, pas d’heure d’été).
 * Une vente à 23 h 30 locale compte pour ce jour-là.
 */

export type PeriodeKind = 'jour' | 'semaine' | 'mois' | 'annee';

export interface PeriodeBounds {
  kind: PeriodeKind;
  /** Début inclusif, ISO UTC. */
  debutIso: string;
  /** Fin exclusive, ISO UTC. */
  finIso: string;
  label: string;
  /** Ancre locale YYYY-MM-DD (premier jour de la période). */
  ancre: string;
}

const OFFSET_MS = 60 * 60 * 1000; // UTC+1

/** Instant UTC → parties de date en heure Porto-Novo. */
export function partsLocal(d: Date): { y: number; m: number; day: number; dow: number; h: number; min: number } {
  const t = new Date(d.getTime() + OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth(),
    day: t.getUTCDate(),
    dow: t.getUTCDay(), // 0=dim … 6=sam en local
    h: t.getUTCHours(),
    min: t.getUTCMinutes(),
  };
}

/** Construit un instant UTC à partir d’une date/heure locale Porto-Novo. */
export function fromLocal(y: number, m: number, day: number, h = 0, min = 0, s = 0): Date {
  return new Date(Date.UTC(y, m, day, h, min, s) - OFFSET_MS);
}

export function toAncre(d: Date): string {
  const p = partsLocal(d);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function parseAncre(ancre: string): { y: number; m: number; day: number } {
  const [ys, ms, ds] = ancre.split('-').map(Number);
  return { y: ys, m: ms - 1, day: ds };
}

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

function labelJour(y: number, m: number, day: number): string {
  return `${day} ${MOIS[m]} ${y}`;
}

function labelSemaine(debut: Date, finExcl: Date): string {
  const a = partsLocal(debut);
  const finIncl = new Date(finExcl.getTime() - 1);
  const b = partsLocal(finIncl);
  if (a.m === b.m && a.y === b.y) {
    return `Semaine du ${a.day} au ${b.day} ${MOIS[a.m]}`;
  }
  if (a.y === b.y) {
    return `Semaine du ${a.day} ${MOIS[a.m]} au ${b.day} ${MOIS[b.m]}`;
  }
  return `Semaine du ${a.day} ${MOIS[a.m]} ${a.y} au ${b.day} ${MOIS[b.m]} ${b.y}`;
}

/** Lundi 00:00 local de la semaine contenant `ancre`. */
function lundiDe(ancre: string): Date {
  const { y, m, day } = parseAncre(ancre);
  const d = fromLocal(y, m, day);
  const dow = partsLocal(d).dow; // 0=dim
  const delta = dow === 0 ? -6 : 1 - dow; // revenir au lundi
  const p = partsLocal(d);
  return fromLocal(p.y, p.m, p.day + delta);
}

export function buildPeriode(kind: PeriodeKind, ancre: string): PeriodeBounds {
  const { y, m, day } = parseAncre(ancre);
  if (kind === 'jour') {
    const debut = fromLocal(y, m, day);
    const fin = fromLocal(y, m, day + 1);
    return {
      kind,
      debutIso: debut.toISOString(),
      finIso: fin.toISOString(),
      label: labelJour(y, m, day),
      ancre: toAncre(debut),
    };
  }
  if (kind === 'semaine') {
    const debut = lundiDe(ancre);
    const p = partsLocal(debut);
    const fin = fromLocal(p.y, p.m, p.day + 7);
    return {
      kind,
      debutIso: debut.toISOString(),
      finIso: fin.toISOString(),
      label: labelSemaine(debut, fin),
      ancre: toAncre(debut),
    };
  }
  if (kind === 'mois') {
    const debut = fromLocal(y, m, 1);
    const fin = fromLocal(y, m + 1, 1);
    return {
      kind,
      debutIso: debut.toISOString(),
      finIso: fin.toISOString(),
      label: `${MOIS[m].charAt(0).toUpperCase()}${MOIS[m].slice(1)} ${y}`,
      ancre: toAncre(debut),
    };
  }
  // année
  const debut = fromLocal(y, 0, 1);
  const fin = fromLocal(y + 1, 0, 1);
  return {
    kind,
    debutIso: debut.toISOString(),
    finIso: fin.toISOString(),
    label: String(y),
    ancre: toAncre(debut),
  };
}

export function shiftPeriode(p: PeriodeBounds, delta: number): PeriodeBounds {
  const { y, m, day } = parseAncre(p.ancre);
  if (p.kind === 'jour') {
    const d = fromLocal(y, m, day + delta);
    return buildPeriode('jour', toAncre(d));
  }
  if (p.kind === 'semaine') {
    const d = fromLocal(y, m, day + delta * 7);
    return buildPeriode('semaine', toAncre(d));
  }
  if (p.kind === 'mois') {
    const d = fromLocal(y, m + delta, 1);
    return buildPeriode('mois', toAncre(d));
  }
  return buildPeriode('annee', toAncre(fromLocal(y + delta, 0, 1)));
}

export function periodePrecedente(p: PeriodeBounds): PeriodeBounds {
  return shiftPeriode(p, -1);
}

export function periodeAujourdhui(kind: PeriodeKind, now = new Date()): PeriodeBounds {
  return buildPeriode(kind, toAncre(now));
}

/** Nom de fichier d’export : Boutique-Maman_Septembre-2026 */
export function nomFichierPeriode(prefix: string, p: PeriodeBounds, ext: string): string {
  const safe = p.label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${prefix}_${safe}.${ext}`;
}
