import { supabase } from '../lib/supabase';

export interface BoutiqueInfo {
  id: string;
  nom: string;
  codeInvitation: string;
}

export interface MembreListe {
  userId: string;
  nom: string;
  role: 'proprietaire' | 'vendeuse';
  actif: boolean;
}

export async function fetchBoutique(boutiqueId: string): Promise<BoutiqueInfo | null> {
  const { data, error } = await supabase
    .from('boutiques')
    .select('id, nom, code_invitation')
    .eq('id', boutiqueId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, nom: data.nom, codeInvitation: data.code_invitation };
}

export async function listMembres(boutiqueId: string): Promise<MembreListe[]> {
  const { data, error } = await supabase
    .from('membres')
    .select('user_id, nom, role, actif')
    .eq('boutique_id', boutiqueId)
    .eq('actif', true)
    .order('cree_le', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    userId: m.user_id,
    nom: m.nom,
    role: m.role,
    actif: m.actif,
  }));
}

/** Retire un membre (actif = false). Ne peut pas retirer un propriétaire. */
export async function retirerMembre(boutiqueId: string, userId: string): Promise<void> {
  const { data: row, error: errRead } = await supabase
    .from('membres')
    .select('role')
    .eq('boutique_id', boutiqueId)
    .eq('user_id', userId)
    .maybeSingle();
  if (errRead) throw errRead;
  if (!row) throw new Error('Membre introuvable.');
  if (row.role === 'proprietaire') {
    throw new Error('On ne peut pas retirer la propriétaire.');
  }
  const { error } = await supabase
    .from('membres')
    .update({ actif: false })
    .eq('boutique_id', boutiqueId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function changerMotDePasse(ancien: string, nouveau: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error('Session introuvable.');
  const { error: errCheck } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: ancien,
  });
  if (errCheck) throw new Error('Ancien mot de passe incorrect.');
  const { error } = await supabase.auth.updateUser({ password: nouveau });
  if (error) throw error;
}

/** Met à jour le nom affiché du membre connecté. */
export async function updateMonNom(boutiqueId: string, nom: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Session introuvable.');
  const clean = nom.trim();
  if (!clean) throw new Error('Écrivez votre nom.');
  const { error } = await supabase
    .from('membres')
    .update({ nom: clean })
    .eq('boutique_id', boutiqueId)
    .eq('user_id', user.id);
  if (error) throw error;
}

/** Propriétaire : renomme la boutique. */
export async function updateNomBoutique(boutiqueId: string, nom: string): Promise<void> {
  const clean = nom.trim();
  if (!clean) throw new Error('Écrivez le nom de la boutique.');
  const { error } = await supabase.from('boutiques').update({ nom: clean }).eq('id', boutiqueId);
  if (error) throw error;
}
