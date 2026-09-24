import { STOCK_BAS } from '../db/types';

export type StockTone = 'ok' | 'low' | 'out';

export interface StockState {
  tone: StockTone;
  label: string;
}

export function stockState(stock: number): StockState {
  if (stock <= 0) return { tone: 'out', label: 'Fini' };
  if (stock <= STOCK_BAS) return { tone: 'low', label: `Reste ${stock}` };
  return { tone: 'ok', label: `Reste ${stock}` };
}
