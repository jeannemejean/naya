// Le matin du fil conducteur (spec §3 et §4) : le bloc `fil` du mot du matin, recalculé à chaque
// appel, sans IA bloquante. Il couvre TOUS les objectifs actifs : le filtre de projet de la barre
// latérale (`activeProjectId`) n'est jamais lu ici.
//
// - tachesCles : `classerTachesCles` sur les tâches du jour (Europe/Paris), tous projets, hors
//   rituels et marqueurs de jalon. Échéances prises en compte : la date limite de la tâche
//   (`dueDate`) et la date cible des étapes (`targetDate` des jalons de la carte). Les dates
//   limites d'appels d'offres et les relances ne sont pas reliées à une tâche en base : pas
//   reprises ici.
// - objectifsOublies : `chargerObjectifsOublies`, chacun avec sa reprise. L'IA (`tacheDeReprise`)
//   est lancée en arrière-plan, au plus UNE fois par objectif et par jour (mémoire du processus :
//   un redémarrage peut la relancer une fois de plus). En attendant, ou si l'IA est bloquée ou
//   échoue, une reprise de secours déterministe : « 20 min sur l'étape « X » ».
// - allegement : seulement si l'énergie mise à jour AUJOURD'HUI vaut low|depleted, une fois par
//   jour (toute proposition `alleger_journee` du jour, quel que soit son statut, compte), et
//   seulement si le plan déplace au moins une tâche. En attente : son id ; traitée : null.
// - nonRattachees : tâches du jour à faire, sans objectif (ni `goalId`, ni étape d'un objectif de
//   la carte), hors rituels, heure fixe et marqueurs de jalon.
import type { Task } from "@shared/schema";
import type { MatinFil, ObjectifOublie, TacheCle } from "@shared/fil";
import { storage } from "../../storage";
import { depot } from "../agent/depot";
import { proposerHorsConversation } from "../agent/propositions";
import { chargerCarte, etapesActives, type CarteFil } from "./carte";
import { filActifPour } from "./interrupteur";
import { lienDeTache } from "./lien";
import { classerTachesCles, type EcheanceProche } from "./priorite";
import { chargerObjectifsOublies, tacheDeReprise, type ObjectifOublieBrut, type RepriseProposee } from "./oublis";
import { bornerPourquoi } from "./rattachement";
import { joursTravaillesSuivants, planAllegement } from "./allegement";

const JOURS_REPORT = 3;
const HEURES_RECHERCHE_ALLEGEMENT = 48;

type PrefsMatin = {
  currentEnergyLevel?: string | null; energyUpdatedDate?: string | null; workDays?: string | null;
} & Record<string, unknown>;

export interface DepsMatin {
  depuis(userId: string): Promise<Date | null>;
  carte(userId: string, depuis: Date | null): Promise<CarteFil>;
  /** Les tâches d'un jour, TOUS projets confondus. */
  tachesDuJour(userId: string, jour: string): Promise<Task[]>;
  preferences(userId: string): Promise<PrefsMatin | undefined>;
  echeances(userId: string, carte: CarteFil, taches: Task[]): Promise<EcheanceProche[]>;
  oublies(userId: string, carte: CarteFil, maintenant: Date): Promise<ObjectifOublieBrut[]>;
  reprise(userId: string, objectifId: number): Promise<RepriseProposee | null>;
  /** Propositions `alleger_journee` créées pour ce jour, quel que soit leur statut. */
  allegementsDuJour(userId: string, jour: string, maintenant: Date): Promise<{ id: number; statut: string; expireA: Date }[]>;
  proposerAllegement(userId: string, args: { date: string; deplacer: { tacheId: number; vers: string }[] }, maintenant: Date): Promise<{ id: number } | { erreur: string }>;
}

// ── Dépendances par défaut ─────────────────────────────────────────────────────────────

const JOUR_ISO = /^\d{4}-\d{2}-\d{2}/;

const depsParDefaut: DepsMatin = {
  // Lecture seule : la mise en route (et sa proposition unique de rattachement) reste au planificateur.
  depuis: async (userId) => ((await storage.getUserPreferences(userId)) as any)?.filConducteurDepuis ?? null,
  carte: chargerCarte,
  tachesDuJour: (userId, jour) => storage.getTasksInRange(userId, jour, jour),
  preferences: async (userId) => (await storage.getUserPreferences(userId)) as PrefsMatin | undefined,
  async echeances(userId, carte, taches) {
    const res: EcheanceProche[] = [];
    for (const t of taches) {
      if (t.dueDate) res.push({ tacheId: t.id, date: new Date(t.dueDate).toISOString().slice(0, 10) });
    }
    const etapes = new Set(carte.objectifs.flatMap((o) => o.etapes.map((e) => e.id)));
    const projets = [...new Set(carte.objectifs.map((o) => o.projetId))];
    const jalons = await Promise.all(projets.map((p) => storage.getMilestones(p, userId).catch(() => [])));
    for (const m of jalons.flat()) {
      if (etapes.has(m.id) && typeof m.targetDate === "string" && JOUR_ISO.test(m.targetDate)) {
        res.push({ etapeId: m.id, date: m.targetDate.slice(0, 10) });
      }
    }
    return res;
  },
  oublies: chargerObjectifsOublies,
  reprise: tacheDeReprise,
  async allegementsDuJour(userId, jour, maintenant) {
    const depuis = new Date(maintenant.getTime() - HEURES_RECHERCHE_ALLEGEMENT * 3600_000);
    const liste = await depot.propositionsCreeesDepuis(userId, ["alleger_journee"], depuis);
    return liste.filter((p) => (p.arguments as any)?.date === jour)
      .map((p) => ({ id: p.id, statut: p.statut ?? "", expireA: new Date(p.expireA) }));
  },
  async proposerAllegement(userId, args, maintenant) {
    const r = await proposerHorsConversation(userId, "alleger_journee", args, maintenant);
    return "erreur" in r ? r : { id: r.id };
  },
};

// ── Reprises des objectifs oubliés : une génération par objectif et par jour ───────────

type EntreeReprise = { valeur: RepriseProposee | null; prete: boolean };
const reprises = new Map<string, EntreeReprise>();

/** Pour les tests. */
export function viderReprisesEnMemoire(): void {
  reprises.clear();
}

function repriseEnMemoire(userId: string, objectifId: number, jour: string, generer: () => Promise<RepriseProposee | null>): RepriseProposee | null {
  const cle = `${userId}:${objectifId}:${jour}`;
  const connue = reprises.get(cle);
  if (connue) return connue.prete ? connue.valeur : null;
  // Les jours passés ne servent plus.
  reprises.forEach((_v, k) => { if (!k.endsWith(`:${jour}`)) reprises.delete(k); });
  const entree: EntreeReprise = { valeur: null, prete: false };
  reprises.set(cle, entree);
  void generer()
    .then((v) => { entree.valeur = v; })
    .catch((e: any) => console.error(`[fil] reprise de l'objectif ${objectifId} :`, e?.message ?? e))
    .finally(() => { entree.prete = true; });
  return null;
}

function repriseDeSecours(carte: CarteFil, o: ObjectifOublieBrut): { titre: string; pourquoi: string } {
  const objectif = carte.objectifs.find((x) => x.id === o.objectifId);
  const etape = objectif ? etapesActives(objectif.etapes)[0] : undefined;
  const jours = `${o.joursSansTache} jour${o.joursSansTache > 1 ? "s" : ""}`;
  if (etape) {
    return {
      titre: `20 min sur l'étape « ${etape.titre} »`,
      pourquoi: bornerPourquoi(`Rien n'a avancé sur « ${o.titre} » depuis ${jours} : un premier pas sur « ${etape.titre} » remet l'objectif en route.`),
    };
  }
  return {
    titre: `20 min sur l'objectif « ${o.titre} »`,
    pourquoi: bornerPourquoi(`Rien n'a avancé sur « ${o.titre} » depuis ${jours} : 20 minutes suffisent pour le remettre en route.`),
  };
}

// ── Le matin ───────────────────────────────────────────────────────────────────────────

const estRituelOuMarqueur = (t: Task) => (t as any).ritualId != null || t.type === "milestone";

// Date locale du serveur : c'est ainsi que /api/user/energy écrit `energyUpdatedDate`.
const jourServeur = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Deux appels simultanés du même matin ne proposent pas deux allègements.
const allegementsEnCours = new Map<string, Promise<{ propositionId: number } | null>>();

async function allegementDuJour(
  userId: string, aujourdhui: string, maintenant: Date, taches: Task[], cles: TacheCle[], carte: CarteFil,
  workDays: string | null | undefined, deps: DepsMatin,
): Promise<{ propositionId: number } | null> {
  const existantes = await deps.allegementsDuJour(userId, aujourdhui, maintenant);
  if (existantes.length > 0) {
    const ouverte = existantes.find((p) => p.statut === "en_attente" && p.expireA.getTime() > maintenant.getTime());
    return ouverte ? { propositionId: ouverte.id } : null;
  }
  const plan = planAllegement(taches, cles, carte, joursTravaillesSuivants(aujourdhui, workDays, JOURS_REPORT), aujourdhui);
  if (plan.deplacer.length === 0) return null;
  const r = await deps.proposerAllegement(userId, { date: aujourdhui, deplacer: plan.deplacer }, maintenant);
  if ("erreur" in r) {
    console.error(`[fil] allègement refusé pour ${userId} :`, r.erreur);
    return null;
  }
  return { propositionId: r.id };
}

export async function construireMatin(userId: string, aujourdhui: string, maintenant: Date, deps: DepsMatin = depsParDefaut): Promise<MatinFil> {
  const [depuis, prefs, tachesJour] = await Promise.all([
    deps.depuis(userId), deps.preferences(userId), deps.tachesDuJour(userId, aujourdhui),
  ]);
  const carte = await deps.carte(userId, depuis);
  const taches = tachesJour.filter((t) => !estRituelOuMarqueur(t));

  const majLe = prefs?.energyUpdatedDate ?? null;
  const energie = majLe && (majLe === aujourdhui || majLe === jourServeur(maintenant)) ? (prefs?.currentEnergyLevel ?? null) : null;

  const [echeances, oubliesBruts] = await Promise.all([
    deps.echeances(userId, carte, taches).catch((e: any) => { console.error("[fil] échéances :", e?.message ?? e); return [] as EcheanceProche[]; }),
    deps.oublies(userId, carte, maintenant),
  ]);
  const tachesCles = classerTachesCles(taches, carte, echeances, energie, aujourdhui);

  const objectifsOublies: ObjectifOublie[] = oubliesBruts.map((o) => {
    const ia = repriseEnMemoire(userId, o.objectifId, aujourdhui, () => deps.reprise(userId, o.objectifId));
    return { ...o, reprise: ia ? { titre: ia.titre, pourquoi: ia.pourquoi } : repriseDeSecours(carte, o) };
  });

  const nonRattachees = taches.filter((t) => !t.completed && !t.archivedAt && t.schedulingMode !== "fixed"
    && t.goalId == null && lienDeTache(carte, t) == null).length;

  let allegement: { propositionId: number } | null = null;
  if (energie === "low" || energie === "depleted") {
    const cle = `${userId}:${aujourdhui}`;
    let enCours = allegementsEnCours.get(cle);
    if (!enCours) {
      enCours = allegementDuJour(userId, aujourdhui, maintenant, taches, tachesCles, carte, prefs?.workDays, deps)
        .finally(() => allegementsEnCours.delete(cle));
      allegementsEnCours.set(cle, enCours);
    }
    allegement = await enCours.catch((e: any) => { console.error("[fil] allègement :", e?.message ?? e); return null; });
  }

  const fil: MatinFil = { tachesCles, objectifsOublies, allegement, nonRattachees, rienNeCloche: false };
  fil.rienNeCloche = tachesCles.length > 0 && objectifsOublies.length === 0 && nonRattachees === 0 && !signalLot4(fil);
  return fil;
}

// Signaux du lot 4 (pannes, chantiers, création, clôture, réconciliation) : vides tant qu'ils
// ne sont pas remplis. Les indicateurs ne sont pas un signal.
function signalLot4(f: MatinFil): boolean {
  return !!(f.pannes?.length || f.chantiersBloques?.length || f.creation?.alertes.length
    || f.creation?.aValider.length || f.cloture?.length || f.reconciliation?.length);
}

// ── Branchement dans la route du mot du matin ──────────────────────────────────────────

/**
 * Hors interrupteur : rend `corps` tel quel (même objet), sans rien calculer. Sous interrupteur :
 * `{ ...corps, fil }`. Si le fil plante, la réponse existante part quand même.
 */
export async function ajouterFil<T extends object>(
  userId: string, corps: T, calculer: () => Promise<MatinFil>, env: NodeJS.ProcessEnv = process.env,
): Promise<T | (T & { fil: MatinFil })> {
  if (!filActifPour(userId, env)) return corps;
  try {
    return { ...corps, fil: await calculer() };
  } catch (e: any) {
    console.error("[fil] matin :", e?.message ?? e);
    return corps;
  }
}

/**
 * Le bloc des tâches du prompt du mot du matin. Sans fil : exactement le bloc historique (les 3
 * tâches triées par priorité). Avec fil : les tâches clés avec leur étape, leur objectif et leur
 * pourquoi, les objectifs oubliés, et la consigne « si rien ne cloche, une seule phrase ».
 */
export function blocTachesDuBrief(fil: MatinFil | null, lignesHistoriques: string[]): string {
  if (!fil) {
    return lignesHistoriques.length > 0 ? `\nTÂCHES DU JOUR :\n${lignesHistoriques.join('\n')}` : '\nAucune tâche planifiée pour aujourd\'hui.';
  }
  const lignes: string[] = [];
  if (fil.tachesCles.length > 0) {
    lignes.push("\nTÂCHES CLÉS DU JOUR (tous objectifs, dans cet ordre) :");
    for (const c of fil.tachesCles) {
      const l = c.lien;
      const etape = l?.etapeTitre ? `étape « ${l.etapeTitre} », ${l.etapeFaites} tâche${l.etapeFaites > 1 ? "s" : ""} sur ${l.etapePrevues} faite${l.etapeFaites > 1 ? "s" : ""}` : null;
      const objectif = l ? `objectif « ${l.objectifTitre} »${l.cible ? ` (${l.cible})` : ""}` : null;
      const sert = [etape, objectif].filter(Boolean).join(" ; ");
      lignes.push(`- ${c.titre}${sert ? ` — ${sert}` : ""}${c.pourquoi ? ` — pourquoi : ${c.pourquoi}` : ""}`);
    }
  } else {
    lignes.push("\nAucune tâche clé pour aujourd'hui.");
  }
  if (fil.objectifsOublies.length > 0) {
    lignes.push("\nOBJECTIFS OUBLIÉS (aucune tâche faite depuis) :");
    for (const o of fil.objectifsOublies) {
      lignes.push(`- « ${o.titre} » : ${o.joursSansTache} jours. Reprise proposée : ${o.reprise.titre}`);
    }
  }
  if (fil.nonRattachees > 0) lignes.push(`\nTâches du jour rattachées à aucun objectif : ${fil.nonRattachees}.`);
  lignes.push(fil.rienNeCloche
    ? "\nRien ne cloche aujourd'hui : si rien ne cloche, une seule phrase, sans liste."
    : "\nConsigne : si rien ne cloche, une seule phrase ; sinon, nomme ce qui cloche (objectif oublié, tâches sans objectif) en une phrase.");
  return lignes.join("\n");
}
