export type ColorScheme = 'light' | 'dark';

export interface Palette {
  bg: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  indigo: string;
  indigoSoft: string;
  mech: string;
  mechSoft: string;
  prod: string;
  prodSoft: string;
  sun: string;
  sunInk: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  bad: string;
  badSoft: string;
  /** Text color to use on a solid indigo/ok/bad button (white in light mode, dark ink in dark mode). */
  onSolid: string;
}

const light: Palette = {
  bg: '#F3F4F8',
  card: '#FFFFFF',
  ink: '#1B1E3A',
  muted: '#5C6180',
  line: '#D9DCE8',
  indigo: '#27306B',
  indigoSoft: '#E4E7F6',
  mech: '#8A2E62',
  mechSoft: '#F6E3EE',
  prod: '#0F6B63',
  prodSoft: '#DDF1EE',
  sun: '#F2B233',
  sunInk: '#3A2A00',
  ok: '#1E7A3C',
  okSoft: '#DDF3E4',
  warn: '#A65A00',
  warnSoft: '#FDEBD3',
  bad: '#B3261E',
  badSoft: '#FBE1DF',
  onSolid: '#FFFFFF',
};

const dark: Palette = {
  bg: '#12142A',
  card: '#1C1F3B',
  ink: '#EEF0FA',
  muted: '#A9AECB',
  line: '#30355C',
  indigo: '#9EA9F2',
  indigoSoft: '#262B52',
  mech: '#E59AC4',
  mechSoft: '#3A2033',
  prod: '#6FD1C4',
  prodSoft: '#16373A',
  sun: '#F2B233',
  sunInk: '#2A1E00',
  ok: '#6FD68F',
  okSoft: '#173825',
  warn: '#F4B35E',
  warnSoft: '#3A2A12',
  bad: '#FF8A80',
  badSoft: '#3F1B1B',
  onSolid: '#12142A',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

export const CAT_LABEL = { meches: 'Mèches', produits: 'Produits' } as const;
