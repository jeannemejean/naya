// Séance de redémarrage : l'état (table seances_redemarrage) et son avancement projet par projet.
// Le projet courant avance quand SA proposition est validée ; une proposition annulée ou expirée
// laisse le projet en cours (Naya la refait). Une seule séance en cours par utilisatrice.
import { and, eq } from "drizzle-orm";
import type { PropositionVue } from "@shared/agent";
import { db } from "../../db";
import { seancesRedemarrage, type SeanceRedemarrage } from "@shared/schema";
import type { BilanSilencieux } from "./bilan";

export type EtatProjet = { projectId: number; etat: "a_faire" | "en_cours" | "fait" | "saute"; propositionId?: number };

export interface DepsSeance {
  enCours(userId: string): Promise<SeanceRedemarrage | undefined>;
  creer(v: Partial<SeanceRedemarrage> & { userId: string }): Promise<SeanceRedemarrage>;
  maj(id: number, userId: string, patch: Partial<SeanceRedemarrage>): Promise<SeanceRedemarrage | undefined>;
  derniereActivite(userId: string): Promise<Date | null>;
  bilan(userId: string, depuis: Date, maintenant: Date): Promise<BilanSilencieux>;
  proposition(id: number, userId: string): Promise<any | undefined>;
  evaluer(userId: string, depuis: Date, maintenant: Date): Promise<unknown>;
}

/** Repli quand aucune activité n'est connue : on regarde les 30 derniers jours. */
const REPLI_JOURS = 30;

export const depsSeance: DepsSeance = {
  enCours: async (userId) => (await db.select().from(seancesRedemarrage)
    .where(and(eq(seancesRedemarrage.userId, userId), eq(seancesRedemarrage.statut, "en_cours"))).limit(1))[0],
  creer: async (v) => (await db.insert(seancesRedemarrage).values(v as any).returning())[0],
  maj: async (id, userId, patch) => (await db.update(seancesRedemarrage).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(seancesRedemarrage.id, id), eq(seancesRedemarrage.userId, userId))).returning())[0],
  derniereActivite: async (userId) => (await import("./absence")).derniereActivite(userId),
  bilan: async (userId, depuis, maintenant) => {
    const { bilanSilencieux, depsBilan } = await import("./bilan");
    return bilanSilencieux(depsBilan, userId, depuis, maintenant);
  },
  proposition: async (id, userId) => (await import("../agent/depot")).depot.getProposition(id, userId),
  evaluer: async (userId, depuis, maintenant) => {
    const { evaluationReseaux, depsEvaluation } = await import("./reseaux");
    return evaluationReseaux(depsEvaluation, userId, depuis, maintenant);
  },
};

export { seanceActivePour } from "./seance-interrupteur";

const projetsDe = (s: SeanceRedemarrage) => (Array.isArray(s.projets) ? s.projets : []) as EtatProjet[];

export async function demarrerSeance(userId: string, maintenant: Date, deps: DepsSeance = depsSeance): Promise<SeanceRedemarrage> {
  const existante = await deps.enCours(userId);
  if (existante) return existante;
  const derniere = await deps.derniereActivite(userId);
  const depuis = derniere ?? new Date(maintenant.getTime() - REPLI_JOURS * 86_400_000);
  const bilan = await deps.bilan(userId, depuis, maintenant);
  const projets: EtatProjet[] = bilan.projets.map((p, i) => ({ projectId: p.projectId, etat: i === 0 ? "en_cours" : "a_faire" }));
  try {
    return await deps.creer({
      userId, statut: "en_cours", absenceDepuis: derniere, bilan: bilan as any, projets: projets as any,
      projetCourant: projets[0]?.projectId ?? null,
    });
  } catch (e) {
    // Deux démarrages simultanés : l'index unique n'en laisse passer qu'un.
    const gagnante = await deps.enCours(userId);
    if (gagnante) return gagnante;
    throw e;
  }
}

export async function rattacherProposition(s: SeanceRedemarrage, propositionId: number, deps: DepsSeance = depsSeance) {
  const projets = projetsDe(s).map((p) => (p.projectId === s.projetCourant ? { ...p, propositionId } : p));
  return deps.maj(s.id, s.userId, { projets: projets as any });
}

export interface EtatSynchro {
  seance: SeanceRedemarrage | undefined;
  propositionEnAttente?: PropositionVue;
  termineeMaintenant: boolean;
}

// Passe au projet suivant (ou termine) à partir de la liste à jour.
async function avancer(s: SeanceRedemarrage, projets: EtatProjet[], maintenant: Date, deps: DepsSeance): Promise<EtatSynchro> {
  const suivant = projets.find((p) => p.etat === "a_faire" || p.etat === "en_cours");
  if (suivant) {
    const maj = projets.map((p) => (p === suivant ? { ...p, etat: "en_cours" as const } : p));
    return { seance: await deps.maj(s.id, s.userId, { projets: maj as any, projetCourant: suivant.projectId }), termineeMaintenant: false };
  }
  const depuis = new Date((s.bilan as any)?.depuis ?? maintenant);
  const evaluation = await deps.evaluer(s.userId, depuis, maintenant).catch((e: any) => {
    console.error("[redemarrage] évaluation des réseaux :", e?.message ?? e);
    return null;
  });
  const fin = await deps.maj(s.id, s.userId, {
    projets: projets as any, projetCourant: null, statut: "terminee", termineeAt: maintenant, evaluation: evaluation as any,
  });
  return { seance: fin, termineeMaintenant: true };
}

/** Met la séance à jour d'après la proposition du projet courant. */
export async function synchroniser(userId: string, maintenant: Date, deps: DepsSeance = depsSeance): Promise<EtatSynchro> {
  const s = await deps.enCours(userId);
  if (!s) return { seance: undefined, termineeMaintenant: false };
  const projets = projetsDe(s);
  const courant = projets.find((p) => p.projectId === s.projetCourant);
  if (!courant) return avancer(s, projets, maintenant, deps);
  if (courant.propositionId == null) return { seance: s, termineeMaintenant: false };
  const p = await deps.proposition(courant.propositionId, userId);
  if (p?.statut === "en_attente" && new Date(p.expireA).getTime() > maintenant.getTime()) {
    return {
      seance: s, termineeMaintenant: false,
      propositionEnAttente: { id: p.id, resume: p.resume ?? "", changements: p.changements ?? [], expireA: new Date(p.expireA).toISOString(), selectionnable: true },
    };
  }
  if (p?.statut === "validee") {
    return avancer(s, projets.map((x) => (x === courant ? { ...x, etat: "fait" as const } : x)), maintenant, deps);
  }
  // Annulée, expirée ou disparue : le projet reste en cours, à reproposer.
  const { propositionId: _retiree, ...sans } = courant;
  const maj = await deps.maj(s.id, userId, { projets: projets.map((x) => (x === courant ? sans : x)) as any });
  return { seance: maj, termineeMaintenant: false };
}

/** Passe le projet courant sans rien changer. */
export async function passerProjet(userId: string, maintenant: Date, deps: DepsSeance = depsSeance): Promise<EtatSynchro> {
  const s = await deps.enCours(userId);
  if (!s) return { seance: undefined, termineeMaintenant: false };
  const projets = projetsDe(s).map((p) => (p.projectId === s.projetCourant ? { ...p, etat: "saute" as const } : p));
  return avancer(s, projets, maintenant, deps);
}

export async function abandonnerSeance(userId: string, deps: DepsSeance = depsSeance): Promise<boolean> {
  const s = await deps.enCours(userId);
  if (!s) return false;
  await deps.maj(s.id, userId, { statut: "abandonnee" });
  return true;
}

export interface VueSeance {
  id: number;
  statut: string;
  position: number;
  total: number;
  projetCourant: { projectId: number; nom: string } | null;
  propositionEnAttente?: PropositionVue;
}

export function vueSeance(s: SeanceRedemarrage, propositionEnAttente?: PropositionVue): VueSeance {
  const projets = projetsDe(s);
  const bilan = (s.bilan ?? { projets: [] }) as BilanSilencieux;
  const i = projets.findIndex((p) => p.projectId === s.projetCourant);
  const b = bilan.projets.find((p) => p.projectId === s.projetCourant);
  return {
    id: s.id, statut: s.statut, position: i >= 0 ? i + 1 : projets.length, total: projets.length,
    projetCourant: b ? { projectId: b.projectId, nom: b.nom } : null,
    ...(propositionEnAttente ? { propositionEnAttente } : {}),
  };
}
