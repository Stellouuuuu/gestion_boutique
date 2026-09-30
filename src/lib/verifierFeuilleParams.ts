/**
 * Parsing stable des params de /verifier-feuille.
 * Extrait pour tester qu’on ne dépend pas de l’identité de l’objet params
 * (cause du « Maximum update depth exceeded »).
 */
import type { LigneLectureIa, SectionFeuille } from './feuilleTypes';

export function parseSectionsFeuille(params: {
  sections?: string;
  lignes?: string;
  dateSuggeree?: string;
  totalEcrit?: string;
}): SectionFeuille[] {
  try {
    if (params.sections) {
      const s = JSON.parse(String(params.sections)) as SectionFeuille[];
      if (Array.isArray(s) && s.length) return s;
    }
  } catch {
    /* ignore */
  }
  try {
    const raw = JSON.parse(String(params.lignes || '[]')) as LigneLectureIa[];
    return [
      {
        date_lue: null,
        date_iso:
          params.dateSuggeree && /^\d{4}-\d{2}-\d{2}$/.test(params.dateSuggeree)
            ? params.dateSuggeree
            : null,
        date_doute: false,
        total_ecrit: params.totalEcrit ? Number(params.totalEcrit) : null,
        lignes: raw,
      },
    ];
  } catch {
    return [];
  }
}

/** Clés string à utiliser comme deps useMemo/useEffect (pas l’objet params). */
export function paramsFeuilleStables(params: Record<string, unknown>): {
  sections: string;
  lignes: string;
  dateSuggeree: string;
  totalEcrit: string;
  reponseIa: string;
  photoUri: string;
} {
  return {
    sections: typeof params.sections === 'string' ? params.sections : '',
    lignes: typeof params.lignes === 'string' ? params.lignes : '',
    dateSuggeree: typeof params.dateSuggeree === 'string' ? params.dateSuggeree : '',
    totalEcrit: typeof params.totalEcrit === 'string' ? params.totalEcrit : '',
    reponseIa: typeof params.reponseIa === 'string' ? params.reponseIa : '',
    photoUri: typeof params.photoUri === 'string' ? params.photoUri : '',
  };
}
