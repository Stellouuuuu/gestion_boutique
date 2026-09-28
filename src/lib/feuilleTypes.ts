/**
 * Shared types for feuille OCR (app + Edge Function).
 */
export type ConfianceLigne = 'haute' | 'moyenne' | 'basse';
export type TarifLigne = 'detail' | 'gros' | null;

export interface LigneLectureIa {
  texte_lu: string;
  article_id: string | null;
  /** Nom catalogue réellement associé (jamais un nom « inventé » par l’IA). */
  article_nom: string | null;
  quantite: number;
  /** Montant total de la ligne (3e colonne), pas le prix unitaire. */
  montant_lu: number | null;
  /** @deprecated utiliser montant_lu */
  prix_lu?: number | null;
  tarif: TarifLigne;
  confiance: ConfianceLigne;
  /** Quantité proposée pour coller au montant (qty × prix ≈ montant_lu). */
  quantite_suggeree?: number | null;
  /** Chiffre ambigu / raturé signalé par l’IA. */
  chiffre_ambigu?: boolean;
  /** 2–3 variantes catalogue quand le rapprochement est incertain. */
  variantes?: Array<{ id: string; nom: string }>;
}

export interface SectionFeuille {
  date_lue: string | null;
  date_iso: string | null;
  /** true si la date a été corrigée / est douteuse (>60 j ou futur). */
  date_doute: boolean;
  total_ecrit: number | null;
  lignes: LigneLectureIa[];
}

export interface LectureFeuilleReponse {
  ok: true;
  /** Sections détectées (une page peut en contenir plusieurs). */
  sections: SectionFeuille[];
  /** Raccourci : première section (compat). */
  lignes: LigneLectureIa[];
  date_suggeree: string | null;
  total_ecrit?: number | null;
  modele?: string | null;
  essais?: unknown;
}

export interface LectureFeuilleErreur {
  ok: false;
  code: 'quota' | 'reseau' | 'auth' | 'abus' | 'ia' | 'surcharge' | 'ia_off' | 'inconnu';
  message: string;
  /** Délai renvoyé par Gemini (ex. "53s") si présent. */
  retry_delay?: string | null;
  version?: string;
}

export const MSG_LECTURE_ECHEC =
  'La lecture ne marche pas pour le moment, vous pouvez saisir vos ventes à la main';

export const MSG_LECTURE_SURCHARGE =
  'La lecture est très demandée en ce moment. Réessayez dans quelques minutes, ou saisissez vos ventes à la main.';

export const MSG_LECTURE_QUOTA_JOUR =
  'La lecture des photos est indisponible jusqu’à demain. Saisissez vos ventes à la main.';

export const MSG_LECTURE_IA_OFF =
  'La lecture photo est désactivée pour le moment. Saisissez vos ventes à la main.';

export const MSG_HORS_LIGNE =
  'Il faut Internet pour lire une photo. Vos ventes à la main marchent toujours.';

/** Doit rester aligné avec supabase/functions/lire-feuille/cascade.ts */
export const LIRE_FEUILLE_VERSION_ATTENDUE = 'lire-feuille-v2-single-call';

export const QUOTA_PHOTOS_JOUR_DEFAUT = 40;
