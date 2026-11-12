export interface LienFil { objectifId: number; objectifTitre: string; etapeId: number | null; etapeTitre: string | null;
  etapeFaites: number; etapePrevues: number; cible: string | null }
export interface TacheCle { tacheId: number; titre: string; pourquoi: string | null; lien: LienFil | null; score: number }
export interface ObjectifOublie { objectifId: number; titre: string; joursSansTache: number; reprise: { titre: string; pourquoi: string } }
export interface Indicateur { cle: string; libelle: string; valeur: number | string | null; precedente: number | string | null; indisponible?: string }
export interface MatinFil {
  tachesCles: TacheCle[]; objectifsOublies: ObjectifOublie[]; allegement: { propositionId: number } | null;
  nonRattachees: number; rienNeCloche: boolean;
  pannes?: { nom: string; dernierSucces: string | null }[];
  chantiersBloques?: { libelle: string; joursSansMouvement: number; prochainPas: string }[];
  creation?: { alertes: string[]; aValider: { libelle: string; lien: string }[] };
  indicateurs?: Indicateur[];
  cloture?: { tacheId: number; titre: string; ouverteDepuis: number }[];
  reconciliation?: { source: string; libelle: string; lien: string }[];
}
