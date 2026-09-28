// Supabase Edge Function: lire-feuille
// Secrets: GEMINI_API_KEY, GEMINI_MODEL, IA_ACTIVE, PHOTO_QUOTA_JOUR, GEMINI_BASE_URL (simulation)
// RÈGLE DURE : 1 seul appel Gemini max, aucun retry, aucun fallback HF.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  LIRE_FEUILLE_VERSION,
  PLAFOND_APPELS_IA_JOUR,
  appelIaUnique,
  modeleUnique,
} from './cascade.ts';

const QUOTA_PHOTOS = Number(Deno.env.get('PHOTO_QUOTA_JOUR') || '40');
const PLAFOND_IA = Number(Deno.env.get('PLAFOND_APPELS_IA_JOUR') || String(PLAFOND_APPELS_IA_JOUR));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MSG_ECHEC =
  'La lecture est très demandée en ce moment. Réessayez dans quelques minutes, ou saisissez vos ventes à la main.';

const MSG_QUOTA_JOUR =
  'La lecture des photos est indisponible jusqu’à demain. Saisissez vos ventes à la main.';

const MSG_IA_OFF =
  'La lecture photo est désactivée pour le moment. Saisissez vos ventes à la main.';

function jsonOut(body: Record<string, unknown>, status = 200) {
  return Response.json(
    { ...body, version: LIRE_FEUILLE_VERSION },
    { status, headers: CORS }
  );
}

type Article = { id: string; nom: string; prix_detail: number | null; prix_gros: number | null };

type LigneBrute = {
  texte_lu?: string;
  quantite?: number;
  montant_lu?: number | null;
  tarif?: string | null;
  chiffre_ambigu?: boolean;
  article_id?: string | null;
};

type SectionBrute = {
  date_lue?: string | null;
  date_iso?: string | null;
  total_ecrit?: number | null;
  lignes?: LigneBrute[];
};

type ParsedIa = {
  sections?: SectionBrute[];
  /** Ancien format (une seule liste) — converti en 1 section. */
  lignes?: LigneBrute[];
  date_suggeree?: string | null;
  total_ecrit?: number | null;
};

type EssaiLog = {
  provider: string;
  modele: string;
  essai: number;
  http: number | null;
  duree_ms: number;
  ok: boolean;
  detail?: string;
};

const ABBREV: Record<string, string> = {
  grd: 'grand',
  gd: 'grand',
  gr: 'grand',
  gde: 'grande',
  pt: 'petit',
  pte: 'petite',
  shamp: 'shampooing',
  shampo: 'shampooing',
  shampoing: 'shampooing',
  bte: 'boite',
  bt: 'boite',
  mch: 'meche',
  mec: 'meche',
};

function normaliser(s: string): string {
  let t = String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t
    .split(' ')
    .map((w) => ABBREV[w] || w)
    .join(' ');
}

function dist(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

function rapprocher(
  texte: string,
  catalogue: Article[],
  opts?: { montant?: number | null; quantite?: number }
): {
  id: string | null;
  score: number;
  variantes: Array<{ id: string; nom: string; score: number }>;
} {
  const q = normaliser(texte);
  if (!q) return { id: null, score: 0, variantes: [] };
  const unit =
    opts?.montant != null && opts?.quantite && opts.quantite > 0
      ? opts.montant / opts.quantite
      : opts?.montant != null
        ? opts.montant
        : null;

  const scored: Array<{ id: string; nom: string; score: number }> = [];
  for (const a of catalogue) {
    const n = normaliser(a.nom);
    let score = 0;
    if (n === q) score = 1;
    else if (n.includes(q) || q.includes(n)) {
      score = Math.min(n.length, q.length) / Math.max(n.length, q.length) + 0.15;
    } else {
      const d = dist(q, n);
      score = 1 - d / Math.max(q.length, n.length, 1);
    }
    // Départage par prix unitaire attendu
    if (unit != null && a.prix_detail != null && a.prix_detail > 0) {
      const ecart = Math.abs(a.prix_detail - unit) / Math.max(unit, a.prix_detail);
      if (ecart <= 0.15) score = Math.min(1, score + 0.25);
      else if (ecart <= 0.3) score = Math.min(1, score + 0.08);
      else if (score < 0.9) score *= 0.85;
    }
    scored.push({ id: a.id, nom: a.nom, score: Math.min(1, score) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3).filter((s) => s.score >= 0.55);
  const best = scored[0];
  if (!best || best.score < 0.72) {
    return { id: null, score: best?.score ?? 0, variantes: top };
  }
  // Incertain si 2e proche
  const second = scored[1];
  const incertain =
    second && second.score >= 0.72 && best.score - second.score < 0.08;
  if (incertain) {
    return { id: best.id, score: best.score, variantes: top };
  }
  return { id: best.id, score: best.score, variantes: top.slice(0, 1) };
}

function confiance(
  score: number,
  id: string | null,
  ambigu: boolean
): 'haute' | 'moyenne' | 'basse' {
  if (ambigu || !id) return 'basse';
  if (score >= 0.9) return 'haute';
  if (score >= 0.72) return 'moyenne';
  return 'basse';
}

/** Propose une qté entière telle que |q×prix − montant| / montant ≤ 20 % (meilleure). */
function quantitePourMontant(
  montant: number,
  prix: number | null | undefined
): number | null {
  if (!prix || prix <= 0 || !montant || montant <= 0) return null;
  const q = Math.max(1, Math.round(montant / prix));
  const ecart = Math.abs(q * prix - montant) / montant;
  if (ecart > 0.2) return null;
  return q;
}

function parseDateLue(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!m) return null;
  const j = Number(m[1]);
  const mo = Number(m[2]);
  let a = Number(m[3]);
  if (a < 100) a += 2000;
  if (mo < 1 || mo > 12 || j < 1 || j > 31) return null;
  return `${a}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

/** Si date future ou > 60 j d’écart → date plausible + doute. */
function assainirDate(iso: string | null): { iso: string | null; doute: boolean } {
  if (!iso) return { iso: null, doute: false };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const d = new Date(iso + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return { iso: null, doute: true };
  const diffJ = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diffJ > 0) {
    // Futur : même jour/mois année courante, ou hier si encore futur
    const candid = new Date(today.getFullYear(), d.getMonth(), d.getDate(), 12);
    if (candid > today) candid.setFullYear(candid.getFullYear() - 1);
    return { iso: candid.toISOString().slice(0, 10), doute: true };
  }
  if (diffJ < -60) {
    // Trop vieux : même JJ/MM année courante (ou précédente si futur)
    let candid = new Date(today.getFullYear(), d.getMonth(), d.getDate(), 12);
    if (candid > today) candid = new Date(today.getFullYear() - 1, d.getMonth(), d.getDate(), 12);
    const diff2 = Math.round((candid.getTime() - today.getTime()) / 86400000);
    if (Math.abs(diff2) <= 60) return { iso: candid.toISOString().slice(0, 10), doute: true };
    return { iso: today.toISOString().slice(0, 10), doute: true };
  }
  return { iso, doute: false };
}

const PROMPT = `Tu lis une photo de feuille de ventes manuscrite (boutique de mèches et produits capillaires).

Tu extrais UNIQUEMENT ce qui est écrit. Tu ne corriges pas les noms d’articles, tu ne les remplaces pas par un nom de catalogue, tu n’inventes pas de synonymes.

STRUCTURE
- Une page peut contenir plusieurs sections. Une section commence à une date manuscrite (formats usuels : JJ/MM/AA, ou « Ce JJ/MM/AA ») et se termine au « Total » suivant de cette section.
- Ignore les titres de type inventaire (avant / après) et tout texte AU-DESSUS de la date de la section (reste d’une autre page, sous-total précédent).
- Ignore les lignes clairement barrées / rayées.
- Si plusieurs sections sont visibles, renvoie-les toutes dans "sections" (ordre haut → bas).

COLONNES (par ligne de vente)
- Colonne 1 = texte manuscrit de l’article, tel quel (faute d’orthographe comprise).
- Colonne 2 = quantité. Entier si lisible. Si le chiffre est une fraction, une lettre collée au chiffre, raturé ou repassé → chiffre_ambigu=true ; mets la meilleure estimation entière possible (≥ 1) sans règle magique du type « telle lettre = tel nombre ».
- Colonne 3 = MONTANT TOTAL de la ligne en FCFA (pas le prix unitaire). Les séparateurs de milliers (point, tiret, espace) sont à convertir en nombre entier.
- total_ecrit = le total manuscrit de CETTE section (même conversion des séparateurs).

DATE
- date_lue = texte de la date tel quel.
- Année à 2 chiffres : préfixe 20 (ex. AA → 20AA).
- date_iso = YYYY-MM-DD correspondant, ou null si illisible.
- Si le mois ou le jour est surchargé / douteux → date_iso au mieux et on s’en remettra au contrôle humain.

Ne renvoie PAS d’identifiant catalogue ni de nom « corrigé ». Le serveur fera le rapprochement.

Réponds UNIQUEMENT en JSON :
{"sections":[{"date_lue":"JJ/MM/AA","date_iso":"YYYY-MM-DD","total_ecrit":0,"lignes":[{"texte_lu":"...","quantite":1,"montant_lu":0,"tarif":null,"chiffre_ambigu":false}]}]}
tarif : "detail", "gros" ou null si la feuille ne l’indique pas. quantite ≥ 1. montant_lu entier ≥ 0. N’invente aucune ligne absente de la photo.`;

async function httpGemini(model: string, imageB64: string, mime: string) {
  // Mode simulation : AUCUN appel réseau vers Google.
  const sim = (Deno.env.get('SIMULATE_GEMINI') || '').trim().toLowerCase();
  if (sim === '503' || sim === 'surcharge') {
    console.log('[lire-feuille] SIMULATE_GEMINI=503 — 0 appel Google');
    return { ok: false, http: 503, body: '{"error":{"code":503,"message":"simulated"}}' };
  }
  if (sim === '429' || sim === 'quota') {
    console.log('[lire-feuille] SIMULATE_GEMINI=429 — 0 appel Google');
    return { ok: false, http: 429, body: '{"error":{"code":429,"message":"simulated quota"}}' };
  }
  if (sim === 'ok') {
    console.log('[lire-feuille] SIMULATE_GEMINI=ok — 0 appel Google');
    const fake = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  sections: [
                    {
                      date_lue: null,
                      date_iso: null,
                      total_ecrit: null,
                      lignes: [],
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    };
    return { ok: true, http: 200, body: JSON.stringify(fake) };
  }

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY manquant');
  const base =
    (Deno.env.get('GEMINI_BASE_URL') || '').replace(/\/+$/, '') ||
    'https://generativelanguage.googleapis.com/v1beta';
  // Garde-fou : refuser generativelanguage si SIMULATE_GEMINI est partiellement défini
  if (base.includes('generativelanguage.googleapis.com') && Deno.env.get('FORCE_NO_GEMINI') === 'true') {
    throw new Error('FORCE_NO_GEMINI : appel Google interdit');
  }
  const url = `${base}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime, data: imageB64 } },
        ],
      },
    ],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  return { ok: res.ok, http: res.status, body: raw };
}

function parseGeminiBody(raw: string): ParsedIa {
  const data = JSON.parse(raw);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('réponse IA vide');
  return JSON.parse(text) as ParsedIa;
}

/** UN SEUL appel — aucun retry, aucun autre modèle, aucun Hugging Face. */
async function callGeminiOnce(
  imageB64: string,
  mime: string
): Promise<{
  parsed: ParsedIa;
  modele: string;
  essais: EssaiLog[];
  nbAppels: number;
}> {
  const model = modeleUnique(Deno.env.get('GEMINI_MODEL'), Deno.env.get('GEMINI_MODELS'));
  const r = await appelIaUnique<ParsedIa>({
    model,
    call: (m) => httpGemini(m, imageB64, mime),
    parse: (body) => parseGeminiBody(body),
  });
  if (r.ok) {
    return { parsed: r.parsed, modele: r.modele, essais: r.essais, nbAppels: r.nbAppels };
  }
  const err = new Error(r.message);
  (err as { code?: string; essais?: EssaiLog[]; nbAppels?: number }).code = r.code;
  (err as { essais?: EssaiLog[] }).essais = r.essais;
  (err as { nbAppels?: number }).nbAppels = r.nbAppels;
  throw err;
}

function normaliserSections(parsed: ParsedIa): SectionBrute[] {
  if (Array.isArray(parsed.sections) && parsed.sections.length) return parsed.sections;
  return [
    {
      date_lue: null,
      date_iso: parsed.date_suggeree || null,
      total_ecrit: parsed.total_ecrit ?? null,
      lignes: parsed.lignes || [],
    },
  ];
}

function iaActive(): boolean {
  const v = (Deno.env.get('IA_ACTIVE') || 'false').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'oui' || v === 'yes';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let essais: EssaiLog[] = [];
  let nbAppelsIa = 0;

  try {
    // Interrupteur AVANT auth coûteuse / Gemini
    if (!iaActive()) {
      return jsonOut({ ok: false, code: 'ia_off', message: MSG_IA_OFF }, 503);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonOut({ ok: false, code: 'auth', message: 'Non connecté' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonOut({ ok: false, code: 'auth', message: 'Non connecté' }, 401);
    }

    const { data: membre } = await supabase
      .from('membres')
      .select('boutique_id')
      .eq('user_id', user.id)
      .eq('actif', true)
      .limit(1)
      .maybeSingle();
    if (!membre?.boutique_id) {
      return jsonOut({ ok: false, code: 'auth', message: 'Pas membre d’une boutique' }, 403);
    }
    const boutiqueId = membre.boutique_id as string;

    const jour = new Date().toISOString().slice(0, 10);
    const { data: qrow } = await admin
      .from('quotas_photo')
      .select('nb, nb_appels_ia')
      .eq('boutique_id', boutiqueId)
      .eq('jour', jour)
      .maybeSingle();
    const nbPhotos = qrow?.nb ?? 0;
    const nbAppelsDeja = qrow?.nb_appels_ia ?? 0;

    if (nbPhotos >= QUOTA_PHOTOS) {
      return jsonOut({ ok: false, code: 'abus', message: MSG_ECHEC }, 429);
    }
    // Plafond IA compté AVANT l’appel Gemini
    if (nbAppelsDeja >= PLAFOND_IA) {
      return jsonOut(
        {
          ok: false,
          code: 'quota',
          message: MSG_QUOTA_JOUR,
          nb_appels_ia_jour: nbAppelsDeja,
          plafond: PLAFOND_IA,
        },
        429
      );
    }

    const body = await req.json();
    const imageB64 = body?.image_base64 as string;
    const mime = (body?.mime as string) || 'image/jpeg';
    if (!imageB64 || imageB64.length < 100) {
      return jsonOut({ ok: false, code: 'inconnu', message: 'Image manquante' }, 400);
    }

    // Réserve 1 créneau AVANT Gemini (même si l’appel échoue ensuite)
    const nbAppelsReserve = nbAppelsDeja + 1;
    await admin.from('quotas_photo').upsert({
      boutique_id: boutiqueId,
      jour,
      nb: nbPhotos,
      nb_appels_ia: nbAppelsReserve,
    });

    const { data: arts, error: artErr } = await supabase
      .from('articles')
      .select('id, nom, prix_detail, prix_gros')
      .eq('boutique_id', boutiqueId)
      .eq('actif', true);
    if (artErr) throw artErr;
    const catalogue = (arts || []) as Article[];
    const byId = Object.fromEntries(catalogue.map((a) => [a.id, a]));

    const { data: aliasRows } = await supabase
      .from('alias_articles')
      .select('texte_norm, article_id')
      .eq('boutique_id', boutiqueId);
    const aliases = new Map<string, string>();
    for (const r of aliasRows || []) {
      aliases.set(String(r.texte_norm), String(r.article_id));
    }

    let parsed: ParsedIa;
    let modeleUtilise: string;

    try {
      const r = await callGeminiOnce(imageB64, mime);
      parsed = r.parsed;
      modeleUtilise = r.modele;
      essais = r.essais;
      nbAppelsIa = r.nbAppels;
    } catch (e) {
      const code = (e as { code?: string })?.code === 'quota' ? 'quota' : 'surcharge';
      const detail = String((e as Error)?.message || e).slice(0, 400);
      if ((e as { essais?: EssaiLog[] }).essais) essais = (e as { essais: EssaiLog[] }).essais;
      if ((e as { nbAppels?: number }).nbAppels) nbAppelsIa = (e as { nbAppels: number }).nbAppels;
      console.error('[lire-feuille] échec:', detail, 'appels=', nbAppelsIa, 'version=', LIRE_FEUILLE_VERSION);

      return jsonOut(
        {
          ok: false,
          code,
          message: code === 'quota' ? MSG_QUOTA_JOUR : MSG_ECHEC,
          detail,
          nb_appels_ia: nbAppelsIa,
          nb_appels_ia_jour: nbAppelsReserve,
          essais,
        },
        code === 'quota' ? 429 : 503
      );
    }

    await admin.from('quotas_photo').upsert({
      boutique_id: boutiqueId,
      jour,
      nb: nbPhotos + 1,
      nb_appels_ia: nbAppelsReserve,
    });

    const sectionsOut = normaliserSections(parsed).map((sec) => {
      let dateIso =
        parseDateLue(sec.date_lue) ||
        (sec.date_iso && /^\d{4}-\d{2}-\d{2}$/.test(sec.date_iso) ? sec.date_iso : null);
      const assaini = assainirDate(dateIso);
      dateIso = assaini.iso;

      const lignes = (sec.lignes || []).map((l) => {
        const texte = String(l.texte_lu || '').trim();
        const ambigu = !!l.chiffre_ambigu;
        const montant =
          l.montant_lu != null ? Math.round(Number(l.montant_lu)) : null;
        const qRaw = Number(l.quantite);
        const q = Number.isFinite(qRaw) && qRaw > 0 ? Math.max(1, Math.round(qRaw)) : 1;
        let articleId: string | null = null;
        let score = 0;
        let variantes: Array<{ id: string; nom: string }> = [];
        let confForceBasse = false;
        const aliasId = aliases.get(normaliser(texte));
        if (aliasId && byId[aliasId]) {
          articleId = aliasId;
          score = 0.99;
        } else {
          const m = rapprocher(texte, catalogue, { montant, quantite: q });
          articleId = m.id;
          score = m.score;
          variantes = m.variantes.map((v) => ({ id: v.id, nom: v.nom }));
          if (variantes.length > 1) confForceBasse = true;
        }
        const art = articleId ? byId[articleId] : null;
        const prixCat = art?.prix_detail ?? null;
        let conf = confiance(score, articleId, ambigu || confForceBasse);
        let qSugg: number | null = null;
        if (montant != null && prixCat != null && prixCat > 0) {
          const ecart = Math.abs(q * prixCat - montant) / Math.max(montant, 1);
          if (ecart > 0.2) {
            conf = 'basse';
            qSugg = quantitePourMontant(montant, prixCat);
          }
        }
        const tarif = l.tarif === 'gros' || l.tarif === 'detail' ? l.tarif : null;
        return {
          texte_lu: texte,
          article_id: articleId,
          article_nom: art?.nom ?? null,
          variantes: variantes.length > 1 ? variantes : undefined,
          quantite: q,
          montant_lu: montant,
          prix_lu: montant,
          tarif,
          confiance: conf,
          quantite_suggeree: qSugg,
          chiffre_ambigu: ambigu,
        };
      });

      return {
        date_lue: sec.date_lue ?? null,
        date_iso: dateIso,
        date_doute: assaini.doute,
        total_ecrit:
          sec.total_ecrit != null ? Math.round(Number(sec.total_ecrit)) : null,
        lignes,
      };
    });

    const premiere = sectionsOut[0];
    return jsonOut({
      ok: true,
      sections: sectionsOut,
      lignes: premiere?.lignes || [],
      date_suggeree: premiere?.date_iso || null,
      total_ecrit: premiere?.total_ecrit ?? null,
      modele: modeleUtilise,
      nb_appels_ia: nbAppelsIa,
      essais,
    });
  } catch (e) {
    console.error(e);
    return jsonOut(
      { ok: false, code: 'inconnu', message: MSG_ECHEC, essais, nb_appels_ia: nbAppelsIa },
      500
    );
  }
});
