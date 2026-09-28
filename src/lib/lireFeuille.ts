/**
 * Appelle l’Edge Function lire-feuille (clé Gemini côté serveur uniquement).
 */
import { supabase } from './supabase';
import {
  MSG_LECTURE_ECHEC,
  MSG_LECTURE_IA_OFF,
  MSG_LECTURE_QUOTA_JOUR,
  MSG_LECTURE_SURCHARGE,
  type LectureFeuilleErreur,
  type LectureFeuilleReponse,
  type LigneLectureIa,
  type SectionFeuille,
} from './feuilleTypes';

export type LireFeuilleResult = LectureFeuilleReponse | LectureFeuilleErreur;

function messagePourCode(code: string | undefined, fallback?: string): string {
  if (code === 'quota') return MSG_LECTURE_QUOTA_JOUR;
  if (code === 'ia_off') return MSG_LECTURE_IA_OFF;
  if (code === 'surcharge' || code === 'abus') return MSG_LECTURE_SURCHARGE;
  return fallback || MSG_LECTURE_ECHEC;
}

function normaliserLigne(l: Partial<LigneLectureIa>): LigneLectureIa {
  const montant =
    l.montant_lu != null
      ? Number(l.montant_lu)
      : l.prix_lu != null
        ? Number(l.prix_lu)
        : null;
  return {
    texte_lu: String(l.texte_lu || ''),
    article_id: l.article_id ?? null,
    article_nom: l.article_nom ?? null,
    quantite: Math.max(1, Math.round(Number(l.quantite) || 1)),
    montant_lu: montant,
    prix_lu: montant,
    tarif: l.tarif === 'gros' || l.tarif === 'detail' ? l.tarif : null,
    confiance: l.confiance === 'haute' || l.confiance === 'moyenne' ? l.confiance : 'basse',
    quantite_suggeree: l.quantite_suggeree ?? null,
    chiffre_ambigu: !!l.chiffre_ambigu,
    variantes: Array.isArray(l.variantes) ? l.variantes : undefined,
  };
}

export async function lireFeuillePhoto(opts: {
  imageBase64: string;
  mime?: string;
}): Promise<LireFeuilleResult> {
  try {
    const { data, error } = await supabase.functions.invoke('lire-feuille', {
      body: {
        image_base64: opts.imageBase64,
        mime: opts.mime || 'image/jpeg',
      },
    });

    if (error) {
      let body: {
        ok?: boolean;
        code?: string;
        message?: string;
        retry_delay?: string | null;
      } | null = null;
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === 'function') {
          body = (await ctx.json()) as {
            ok?: boolean;
            code?: string;
            message?: string;
            retry_delay?: string | null;
          };
        }
      } catch {
        /* ignore */
      }
      if (body && body.ok === false) {
        return {
          ok: false,
          code: (body.code as LectureFeuilleErreur['code']) || 'surcharge',
          message: messagePourCode(body.code, body.message),
          retry_delay: body.retry_delay ?? null,
        };
      }
      return { ok: false, code: 'surcharge', message: MSG_LECTURE_SURCHARGE };
    }

    if (data && data.ok === true) {
      let sections: SectionFeuille[] = [];
      if (Array.isArray(data.sections) && data.sections.length) {
        sections = data.sections.map((s: SectionFeuille) => ({
          date_lue: s.date_lue ?? null,
          date_iso: s.date_iso ?? null,
          date_doute: !!s.date_doute,
          total_ecrit: s.total_ecrit ?? null,
          lignes: (s.lignes || []).map(normaliserLigne),
        }));
      } else if (Array.isArray(data.lignes)) {
        sections = [
          {
            date_lue: null,
            date_iso: data.date_suggeree ?? null,
            date_doute: false,
            total_ecrit: data.total_ecrit ?? null,
            lignes: data.lignes.map(normaliserLigne),
          },
        ];
      }
      const premiere = sections[0];
      return {
        ok: true,
        sections,
        lignes: premiere?.lignes || [],
        date_suggeree: premiere?.date_iso ?? data.date_suggeree ?? null,
        total_ecrit: premiere?.total_ecrit ?? null,
        modele: data.modele ?? null,
        essais: data.essais,
      };
    }

    return {
      ok: false,
      code: (data?.code as LectureFeuilleErreur['code']) || 'ia',
      message: messagePourCode(data?.code, data?.message),
      retry_delay: data?.retry_delay ?? null,
    };
  } catch {
    return { ok: false, code: 'reseau', message: MSG_LECTURE_ECHEC };
  }
}
