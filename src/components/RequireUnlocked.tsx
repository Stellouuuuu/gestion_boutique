import { PropsWithChildren, useEffect } from 'react';
import { router } from 'expo-router';
import { useAdminSession } from '../lib/AdminSession';

/** Redirige vers le code PIN si la section "Gérer les articles" n'a pas été déverrouillée. */
export function RequireUnlocked({ children }: PropsWithChildren) {
  const { unlocked } = useAdminSession();

  useEffect(() => {
    if (!unlocked) router.replace('/admin/pin');
  }, [unlocked]);

  if (!unlocked) return null;
  return <>{children}</>;
}
