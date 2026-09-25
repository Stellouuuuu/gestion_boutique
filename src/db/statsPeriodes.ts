/**
 * Périodes glissantes pour les statistiques (§E) :
 * 30 jours / 3 mois / 12 mois, en heure Porto-Novo (UTC+1).
 */
import { fromLocal, partsLocal, toAncre } from './periodes.ts';

export type StatsPeriodeKind = '30j' | '3mois' | '12mois';

export interface StatsPeriodeBounds {
  kind: StatsPeriodeKind;
  /** Début inclusif, ISO UTC. */
  debutIso: string;
  /** Fin exclusive, ISO UTC. */
  finIso: string;
  label: string;
  /** Nombre de jours calendaires (arrondi) couverts. */
  nbJours: number;
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

/** Aujourd’hui 00:00 local → demain 00:00 = fin exclusive de « aujourd’hui inclus ». */
function debutJour(now: Date): Date {
  const p = partsLocal(now);
  return fromLocal(p.y, p.m, p.day);
}

function finExclusiveAujourdhui(now: Date): Date {
  const p = partsLocal(now);
  return fromLocal(p.y, p.m, p.day + 1);
}

export function buildStatsPeriode(kind: StatsPeriodeKind, now = new Date()): StatsPeriodeBounds {
  const fin = finExclusiveAujourdhui(now);
  const pFin = partsLocal(fin);
  // fin est demain 00:00 → le dernier jour inclus est hier relatif à fin, i.e. aujourd’hui
  const lastIncl = fromLocal(pFin.y, pFin.m, pFin.day - 1);

  if (kind === '30j') {
    const lp = partsLocal(lastIncl);
    const debut = fromLocal(lp.y, lp.m, lp.day - 29);
    const a = partsLocal(debut);
    const b = partsLocal(lastIncl);
    return {
      kind,
      debutIso: debut.toISOString(),
      finIso: fin.toISOString(),
      label: `30 derniers jours (${a.day} ${MOIS[a.m]} → ${b.day} ${MOIS[b.m]})`,
      nbJours: 30,
    };
  }

  if (kind === '3mois') {
    const lp = partsLocal(lastIncl);
    const debut = fromLocal(lp.y, lp.m - 2, 1);
    const a = partsLocal(debut);
    return {
      kind,
      debutIso: debut.toISOString(),
      finIso: fin.toISOString(),
      label: `3 mois (${MOIS[a.m]} → ${MOIS[lp.m]} ${lp.y})`,
      nbJours: Math.round((fin.getTime() - debut.getTime()) / 86_400_000),
    };
  }

  // 12 mois : du 1er du mois il y a 11 mois jusqu’à demain 00:00
  const lp = partsLocal(lastIncl);
  const debut = fromLocal(lp.y, lp.m - 11, 1);
  const a = partsLocal(debut);
  return {
    kind,
    debutIso: debut.toISOString(),
    finIso: fin.toISOString(),
    label: `12 mois (${MOIS[a.m]} ${a.y} → ${MOIS[lp.m]} ${lp.y})`,
    nbJours: Math.round((fin.getTime() - debut.getTime()) / 86_400_000),
  };
}

/** Période précédente de même durée (pour comparer l’évolution). */
export function statsPeriodePrecedente(p: StatsPeriodeBounds): StatsPeriodeBounds {
  const debut = new Date(p.debutIso);
  const fin = new Date(p.finIso);
  const duree = fin.getTime() - debut.getTime();
  const prevFin = debut;
  const prevDebut = new Date(debut.getTime() - duree);
  const a = partsLocal(prevDebut);
  const b = partsLocal(new Date(prevFin.getTime() - 1));
  return {
    kind: p.kind,
    debutIso: prevDebut.toISOString(),
    finIso: prevFin.toISOString(),
    label: `période précédente (${a.day} ${MOIS[a.m]} → ${b.day} ${MOIS[b.m]})`,
    nbJours: p.nbJours,
  };
}

export function labelStatsKind(kind: StatsPeriodeKind): string {
  if (kind === '30j') return '30 jours';
  if (kind === '3mois') return '3 mois';
  return '12 mois';
}

/** Ancre YYYY-MM-DD du jour local (utile tests). */
export function ancreAujourdhui(now = new Date()): string {
  return toAncre(debutJour(now));
}
