/**
 * Les erreurs de supabase-js (auth, .rpc(), postgrest) ne sont pas toujours des
 * instances de `Error` (souvent de simples objets `{ message, code, ... }}`),
 * donc `e instanceof Error` ne suffit pas pour lire le message.
 */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string') {
    return e.message;
  }
  return '';
}
