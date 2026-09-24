export type Categorie = 'meches' | 'produits';
export type TypeMouvement = 'vente' | 'entree' | 'correction';
export type Tarif = 'detail' | 'gros';
export type PerimetreInventaire = 'tout' | 'meches' | 'produits';
export type StatutInventaire = 'en_cours' | 'termine' | 'abandonne';

export interface Article {
  id: string;
  boutique_id: string;
  nom: string;
  categorie: Categorie;
  prix_detail: number | null;
  prix_gros: number | null;
  prix_achat: number | null;
  /** Stock calculé depuis les mouvements (pas une colonne stockée). */
  stock: number;
  actif: number; // 0 | 1
  cree_le: string;
  modifie_le: string;
  a_envoyer: number; // 0 | 1
}

export interface Mouvement {
  id: string;
  boutique_id: string;
  article_id: string;
  type: TypeMouvement;
  quantite: number;
  tarif: Tarif | null;
  prix_unitaire: number;
  montant_normal: number;
  montant_paye: number;
  cout_unitaire: number | null;
  annule: number; // 0 | 1
  annule_le: string | null;
  cree_par: string | null;
  cree_le: string;
  modifie_le: string;
  a_envoyer: number; // 0 | 1
}

export interface Inventaire {
  id: string;
  boutique_id: string;
  perimetre: PerimetreInventaire;
  statut: StatutInventaire;
  fait_par: string | null;
  commence_le: string;
  termine_le: string | null;
  note: string | null;
  modifie_le: string;
  a_envoyer: number;
}

export interface InventaireLigne {
  id: string;
  inventaire_id: string;
  boutique_id: string;
  article_id: string;
  stock_attendu: number;
  stock_compte: number;
  compte_le: string;
  mouvement_id: string | null;
  modifie_le: string;
  a_envoyer: number;
}

/** Seuil de stock bas (pastille orange / filtre "À racheter"). */
export const STOCK_BAS = 2;
