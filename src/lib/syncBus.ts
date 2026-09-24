/**
 * Bus léger : les écritures locales (vente, etc.) préviennent la synchro
 * sans coupler la couche DB au provider React.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onLocalDataChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyLocalDataChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Un listener cassé ne doit pas bloquer l'enregistrement local.
    }
  }
}
