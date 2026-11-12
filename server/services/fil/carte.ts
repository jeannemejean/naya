// Carte du fil conducteur : objectifs actifs → étapes (les jalons reliés par goalId) → avancement.
// Une chaîne = les jalons d'un même projet qui servent le même objectif (goalId null = la chaîne
// de projet historique). Un projet peut donc avoir plusieurs chaînes, chacune avec son étape en cours.
import { storage } from "../../storage";
import type { ProjectGoal, ProjectMilestone } from "@shared/schema";

export interface EtapeCarte {
  id: number; objectifId: number | null; projetId: number; titre: string; pourquoi: string | null;
  statut: string; ordre: number; faites: number; prevues: number;
}
export interface ObjectifCarte {
  id: number; projetId: number; titre: string; successMode: string; goalType: string;
  cible: string | null; dueDate: Date | null; etapes: EtapeCarte[]; // triées par order
}
export interface CarteFil { objectifs: ObjectifCarte[]; chainesSansObjectif: Map<number, EtapeCarte[]>; depuis: Date | null }

const STATUTS_EN_COURS = new Set(["active", "unlocked"]);

function estEtapeCarte(e: EtapeCarte | ProjectMilestone): e is EtapeCarte {
  return "statut" in e;
}

/**
 * Étapes sur lesquelles on peut travailler : statut active|unlocked, UNE par chaîne (la première
 * rencontrée). L'ordre reçu est conservé — les lecteurs passent des listes triées par `order` —,
 * si bien que le premier élément est exactement celui que `find(active|unlocked)` trouvait avant.
 * Jamais une étape `locked`.
 */
export function etapesActives<T extends EtapeCarte | ProjectMilestone>(etapes: T[]): T[] {
  const vues = new Set<string>();
  const res: T[] = [];
  for (const e of etapes) {
    const statut = estEtapeCarte(e) ? e.statut : e.status;
    if (!STATUTS_EN_COURS.has(statut)) continue;
    const cle = estEtapeCarte(e) ? `${e.projetId}:${e.objectifId ?? "-"}` : `${e.projectId}:${e.goalId ?? "-"}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    res.push(e);
  }
  return res;
}

const FUSEAU = "Europe/Paris";
const jourMois = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, day: "numeric", month: "long" }).format(d);
const mois = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: FUSEAU, month: "long" }).format(d);

/** « 3 nouveaux clients d'ici fin décembre » : la cible et l'échéance, ou null s'il n'y a ni l'une ni l'autre. */
export function libelleCible(o: ObjectifCarte): string | null {
  const cible = o.cible?.trim() || null;
  let echeance: string | null = null;
  if (o.dueDate) {
    const lendemain = new Date(o.dueDate.getTime() + 24 * 3600_000);
    echeance = mois(lendemain) !== mois(o.dueDate) ? `d'ici fin ${mois(o.dueDate)}` : `d'ici le ${jourMois(o.dueDate)}`;
  }
  if (cible && echeance) return `${cible} ${echeance}`;
  return cible ?? echeance;
}

function versEtape(m: ProjectMilestone, av: Map<number, { faites: number; prevues: number }>): EtapeCarte {
  const a = av.get(m.id) ?? { faites: 0, prevues: 0 };
  return {
    id: m.id, objectifId: m.goalId ?? null, projetId: m.projectId, titre: m.title, pourquoi: m.pourquoi ?? null,
    statut: m.status, ordre: m.order ?? 0, faites: a.faites, prevues: a.prevues,
  };
}

const parOrdre = (a: EtapeCarte, b: EtapeCarte) => a.ordre - b.ordre;

/**
 * Objectifs `active` de TOUS les projets de l'utilisatrice, avec leurs étapes et leur avancement
 * compté depuis `depuis`. Les jalons sans objectif restent des chaînes de projet. Les jalons d'un
 * objectif non actif (en pause, atteint) ne figurent pas sur la carte.
 */
export async function chargerCarte(userId: string, depuis: Date | null): Promise<CarteFil> {
  const projets = await storage.getProjects(userId);
  const parProjet = await Promise.all(projets.map(async (p) => {
    const [objectifs, jalons] = await Promise.all([
      storage.getActiveGoalsForProject(p.id).catch(() => [] as ProjectGoal[]),
      storage.getMilestones(p.id, userId).catch(() => [] as ProjectMilestone[]),
    ]);
    return { projetId: p.id, objectifs, jalons };
  }));

  const tousJalons = parProjet.flatMap((x) => x.jalons);
  const avancement = await storage.getAvancementEtapes(userId, tousJalons.map((m) => m.id), depuis);

  const objectifs: ObjectifCarte[] = [];
  const chainesSansObjectif = new Map<number, EtapeCarte[]>();
  for (const { projetId, objectifs: goals, jalons } of parProjet) {
    const etapes = jalons.map((m) => versEtape(m, avancement));
    for (const g of goals) {
      objectifs.push({
        id: g.id, projetId, titre: g.title, successMode: g.successMode, goalType: g.goalType,
        cible: g.targetValue ?? null, dueDate: g.dueDate ?? null,
        etapes: etapes.filter((e) => e.objectifId === g.id).sort(parOrdre),
      });
    }
    const sansObjectif = etapes.filter((e) => e.objectifId == null).sort(parOrdre);
    if (sansObjectif.length > 0) chainesSansObjectif.set(projetId, sansObjectif);
  }
  return { objectifs, chainesSansObjectif, depuis };
}
