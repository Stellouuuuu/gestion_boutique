/**
 * Miroir de supabase/functions/lire-feuille/cascade.ts pour les tests Node.
 * Un seul appel, aucun retry.
 */
export const LIRE_FEUILLE_VERSION = 'lire-feuille-v2-single-call';
export const PLAFOND_APPELS_IA_JOUR = 10;
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export type AppelIaResultat = {
  ok: boolean;
  http: number | null;
  body: string;
};

export type EssaiUnique = {
  provider: string;
  modele: string;
  essai: number;
  http: number | null;
  duree_ms: number;
  ok: boolean;
  detail?: string;
};

export type AppelUniqueOk<T> = {
  ok: true;
  parsed: T;
  modele: string;
  essais: EssaiUnique[];
  nbAppels: number;
};

export type AppelUniqueErr = {
  ok: false;
  code: 'quota' | 'surcharge' | 'ia';
  message: string;
  essais: EssaiUnique[];
  nbAppels: number;
};

export function modeleUnique(envModel?: string | null, envCsv?: string | null): string {
  const one = (envModel || '').trim();
  if (one) return one;
  const csv = (envCsv || '').trim();
  if (csv) {
    const first = csv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (first) return first;
  }
  return DEFAULT_GEMINI_MODEL;
}

export async function appelIaUnique<T>(opts: {
  model: string;
  provider?: string;
  call: (model: string) => Promise<AppelIaResultat>;
  parse: (body: string, raw: AppelIaResultat) => T;
}): Promise<AppelUniqueOk<T> | AppelUniqueErr> {
  const provider = opts.provider || 'gemini';
  const t0 = Date.now();
  let r: AppelIaResultat;
  try {
    r = await opts.call(opts.model);
  } catch (e) {
    const detail = String((e as Error)?.message || e).slice(0, 200);
    return {
      ok: false,
      code: 'surcharge',
      message: detail || 'IA indisponible',
      essais: [
        {
          provider,
          modele: opts.model,
          essai: 1,
          http: null,
          duree_ms: Date.now() - t0,
          ok: false,
          detail,
        },
      ],
      nbAppels: 1,
    };
  }
  const essai: EssaiUnique = {
    provider,
    modele: opts.model,
    essai: 1,
    http: r.http,
    duree_ms: Date.now() - t0,
    ok: r.ok,
    detail: r.ok ? undefined : r.body.slice(0, 200),
  };
  if (!r.ok) {
    const code = r.http === 429 ? 'quota' : 'surcharge';
    return {
      ok: false,
      code,
      message: r.body.slice(0, 200) || `HTTP ${r.http}`,
      essais: [essai],
      nbAppels: 1,
    };
  }
  try {
    const parsed = opts.parse(r.body, r);
    return {
      ok: true,
      parsed,
      modele: `${provider}:${opts.model}`,
      essais: [essai],
      nbAppels: 1,
    };
  } catch (e) {
    return {
      ok: false,
      code: 'ia',
      message: String((e as Error)?.message || e).slice(0, 200),
      essais: [essai],
      nbAppels: 1,
    };
  }
}
