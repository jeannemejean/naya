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

// ── Indicateurs : la ligne courte du mot du matin (pure, partagée serveur, web et mobile) ──

/** Longueur maximale de la ligne des indicateurs. */
export const LIGNE_INDICATEURS_MAX = 140;

/** Le nombre porté par une valeur : 12 → 12 ; « 1 / 2 » → 1 ; rien de lisible → null. */
export function nombreIndicateur(v: number | string | null): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(",", ".")) : null;
}

/** Le sens depuis la valeur précédente : ↑ ↓ =, ou null quand on ne peut pas comparer. */
export function sensIndicateur(i: Indicateur): "↑" | "↓" | "=" | null {
  if (i.indisponible) return null;
  const a = nombreIndicateur(i.valeur), p = nombreIndicateur(i.precedente);
  if (a == null || p == null) return null;
  return a > p ? "↑" : a < p ? "↓" : "=";
}

const COURTS: Record<string, string> = {
  prospection_envois_4s: "envois", prospection_reponses_4s: "réponses", prospection_interesses_4s: "intéressés",
  prospection_rdv_4s: "rdv", pipeline_en_discussion: "en discussion", pipeline_relances_echues: "relances échues",
  pipeline_signes: "signés", ao_a_venir: "AO à venir", ao_premiers_jets_sans_decision: "premiers jets AO",
  ao_en_redaction_ou_deposes: "AO en cours",
};

// Au singulier quand la valeur vaut exactement 1 (« 1 réponse », pas « 1 réponses »).
const SINGULIERS: Record<string, string> = {
  prospection_envois_4s: "envoi", prospection_reponses_4s: "réponse", prospection_interesses_4s: "intéressé",
  pipeline_relances_echues: "relance échue", pipeline_signes: "signé", ao_premiers_jets_sans_decision: "premier jet AO",
};

function court(i: Indicateur): string | null {
  if (i.valeur === 1 && SINGULIERS[i.cle]) return SINGULIERS[i.cle];
  if (COURTS[i.cle]) return COURTS[i.cle];
  // « Abonnés Instagram JMD » → « abonnés Instagram JMD ». Les posts par compte restent au détail.
  if (i.cle.startsWith("audience_abonnes_")) return i.libelle.charAt(0).toLowerCase() + i.libelle.slice(1);
  return null;
}

/**
 * Une ligne courte pour le mot du matin (≤ 140 caractères), dans l'ordre reçu : « 42 envois ↑ ·
 * 5 réponses = · rdv indisponible · 1 / 2 signés ↑ ». Un indicateur qui ne tient plus est laissé
 * au détail ; une source indisponible est dite, jamais remplacée par un chiffre.
 */
export function ligneIndicateurs(ind: Indicateur[]): string {
  let ligne = "";
  for (const i of ind) {
    const c = court(i);
    if (!c) continue;
    const sens = sensIndicateur(i);
    const morceau = i.indisponible || i.valeur == null ? `${c} indisponible` : `${i.valeur} ${c}${sens ? ` ${sens}` : ""}`;
    const suite = ligne ? `${ligne} · ${morceau}` : morceau;
    if (suite.length <= LIGNE_INDICATEURS_MAX) ligne = suite;
  }
  return ligne;
}
