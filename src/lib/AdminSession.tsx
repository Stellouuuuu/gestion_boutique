import { createContext, PropsWithChildren, useContext, useState } from 'react';

interface AdminSessionValue {
  unlocked: boolean;
  unlock: () => void;
  lock: () => void;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

/**
 * Déverrouillage de "Gérer les articles" : en mémoire seulement, remis à zéro à chaque
 * relance de l'app (le code doit être retapé), mais pas entre les écrans admin/fiche
 * pendant une même visite.
 */
export function AdminSessionProvider({ children }: PropsWithChildren) {
  const [unlocked, setUnlocked] = useState(false);
  return (
    <AdminSessionContext.Provider
      value={{ unlocked, unlock: () => setUnlocked(true), lock: () => setUnlocked(false) }}
    >
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession doit être utilisé dans un AdminSessionProvider');
  return ctx;
}
