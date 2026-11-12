// Rattachement explicite d'une tâche à une étape (jalon) et à un objectif, au moment où elle
// est créée. Remplace le repli « premier objectif actif » (auto-planner.ts, avant le fil) :
// une tâche qu'on ne sait pas rattacher reste sans objectif. Jamais une étape `locked`.
import { chargerCarte, etapesActives, type CarteFil, type EtapeCarte, type ObjectifCarte } from "./carte";
import { filActifPour } from "./interrupteur";

export type Canal = "contenu" | "prospection" | "autre";

export interface BrouillonTache {
  projectId: number | null; goalId?: number | null; milestoneId?: number | null;
  contentId?: number | null; leadId?: number | null; campaignId?: number | null; taskType?: string | null; type?: string | null;
}

export interface Rattachement { goalId: number | null; milestoneId: number | null }

const AUCUN: Rattachement = { goalId: null, milestoneId: null };

// Types de tâche de l'atelier de contenu (@shared/atelier : TYPE_ATELIER, TYPE_VALIDATION).
const TACHES_CONTENU = new Set(["post_publish", "canva_task", "atelier_contenu", "atelier_validation"]);
// `prospection_validation` = TYPE_TACHE_VALIDATION (prospection-verification.ts).
const TACHES_PROSPECTION = new Set(["linkedin_message", "outreach_action", "email", "prospection_validation"]);

/** Canal d'une tâche : contenu, prospection, ou autre. Le contenu l'emporte s'il y a les deux. */
export function canalDe(b: BrouillonTache): Canal {
  if (b.contentId != null || (b.taskType && TACHES_CONTENU.has(b.taskType)) || b.type === "content") return "contenu";
  if (b.leadId != null || (b.taskType && TACHES_PROSPECTION.has(b.taskType))) return "prospection";
  return "autre";
}

/** Première étape en cours de la chaîne de l'objectif, ou null (jamais `locked`). */
const etapeEnCours = (o: ObjectifCarte): number | null => etapesActives(o.etapes)[0]?.id ?? null;

const versObjectif = (o: ObjectifCarte): Rattachement => ({ goalId: o.id, milestoneId: etapeEnCours(o) });

const correspond = (o: ObjectifCarte, mode: string) => o.successMode === mode || o.goalType === mode;

/**
 * L'UNIQUE objectif du périmètre qui correspond au premier mode trouvé dans `modes`.
 * Plusieurs objectifs pour ce mode : ambigu, donc aucun (on ne passe pas au mode suivant).
 */
function uniqueObjectif(objectifs: ObjectifCarte[], modes: string[]): ObjectifCarte | null {
  for (const mode of modes) {
    const trouves = objectifs.filter((o) => correspond(o, mode));
    if (trouves.length === 1) return trouves[0];
    if (trouves.length > 1) return null;
  }
  return null;
}

function trouverEtape(carte: CarteFil, id: number): EtapeCarte | undefined {
  for (const o of carte.objectifs) {
    const e = o.etapes.find((x) => x.id === id);
    if (e) return e;
  }
  for (const chaine of Array.from(carte.chainesSansObjectif.values())) {
    const e = chaine.find((x) => x.id === id);
    if (e) return e;
  }
  return undefined;
}

/**
 * Règles, dans l'ordre (PUR) :
 * 1. `milestoneId` explicite et non `locked` : son objectif. Une étape verrouillée, ou absente
 *    de la carte (objectif non actif, autre utilisatrice), est ignorée.
 * 2. `goalId` explicite : l'étape en cours de sa chaîne, sinon `milestoneId: null`.
 * 3. Canal contenu : l'unique objectif actif du projet en `visibility` (à défaut `consistency`).
 *    Sans projet (atelier de contenu, qui couvre la semaine entière) : sur toute la carte.
 * 4. Canal prospection : l'unique objectif actif du projet en `revenue`.
 * 5. Sinon, ou si plusieurs objectifs correspondent : rien.
 * 6. Jamais une étape `locked` (etapesActives ne renvoie que active|unlocked).
 */
export function choisirRattachement(b: BrouillonTache, carte: CarteFil): Rattachement {
  if (b.milestoneId != null) {
    const e = trouverEtape(carte, b.milestoneId);
    if (e && e.statut !== "locked") return { goalId: e.objectifId, milestoneId: e.id };
  }
  if (b.goalId != null) {
    const o = carte.objectifs.find((x) => x.id === b.goalId);
    return { goalId: b.goalId, milestoneId: o ? etapeEnCours(o) : null };
  }
  const canal = canalDe(b);
  if (canal === "autre") return AUCUN;
  const perimetre = b.projectId != null ? carte.objectifs.filter((o) => o.projetId === b.projectId) : carte.objectifs;
  const o = canal === "contenu"
    ? uniqueObjectif(perimetre, ["visibility", "consistency"])
    : uniqueObjectif(perimetre, ["revenue"]);
  return o ? versObjectif(o) : AUCUN;
}

/**
 * Rattachement d'une tâche avant sa création. La carte est chargée si elle n'est pas fournie
 * (préférer `rattacheurDuPassage`, qui la charge une fois pour tout un passage). L'avancement
 * de la carte ne sert pas ici : `depuis` vaut null par défaut.
 */
export async function rattacherAvantCreation(
  userId: string, b: BrouillonTache, carte?: CarteFil,
): Promise<Rattachement> {
  return choisirRattachement(b, carte ?? (await chargerCarte(userId, null)));
}

/**
 * Rattacheur d'un passage (placement d'atelier, de campagne, synchronisation…). Renvoie les
 * champs à ajouter à la tâche : `{}` hors interrupteur, pour une tâche qui a déjà un objectif,
 * ou si la carte est illisible — la tâche est alors créée exactement comme avant. La carte est
 * chargée au premier besoin, puis réutilisée pour tout le passage.
 */
export function rattacheurDuPassage(
  userId: string, env: NodeJS.ProcessEnv = process.env,
): (b: BrouillonTache) => Promise<Partial<Rattachement>> {
  const actif = filActifPour(userId, env);
  let carte: Promise<CarteFil> | null = null;
  return async (b) => {
    if (!actif || b.goalId != null) return {};
    try {
      carte ??= chargerCarte(userId, null);
      return await rattacherAvantCreation(userId, b, await carte);
    } catch (e: any) {
      console.error(`[fil] rattachement impossible user=${userId}:`, e?.message ?? e);
      return {};
    }
  };
}

// Formules creuses, comparées une fois normalisées (minuscules, sans accents ni ponctuation).
const FORMULES_CREUSES = new Set([
  "pour avancer", "pour avancer ton objectif", "pour avancer sur ton objectif", "pour faire avancer ton objectif",
  "pour atteindre ton objectif", "pour progresser", "pour progresser vers ton objectif", "pour avancer le projet",
  "pour faire avancer le projet", "ca fait avancer le projet", "ca fait avancer ton objectif", "cela fait avancer ton objectif",
  "cette tache fait avancer ton objectif", "cette tache te rapproche de ton objectif", "pour te rapprocher de ton objectif",
  "pour avancer vers ton objectif", "c est important pour ton objectif", "important pour ton objectif",
  "to move forward", "to move your goal forward", "to advance your goal", "to make progress", "to make progress on your goal",
  "to reach your goal", "to achieve your goal", "to move the project forward", "this moves your goal forward",
  "this task moves your goal forward", "this helps you reach your goal", "it moves the project forward",
]);

const normaliser = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

/** Vrai si le « pourquoi » ne dit rien : absent, moins de 25 caractères, ou formule creuse connue. */
export function estPourquoiCreux(p: string | null | undefined): boolean {
  const t = (p ?? "").trim();
  if (t.length < 25) return true;
  return FORMULES_CREUSES.has(normaliser(t));
}

/**
 * Tâche générée par `generateDailyTasks` (fil actif) : `goalIndex` désigne un objectif de la
 * liste envoyée au modèle, `etapeIndex` une des étapes en cours listées pour cet objectif.
 * Sans `goalIndex` valide, plus de repli sur le premier objectif : les règles de canal
 * s'appliquent (et ne trouvent rien pour une tâche générique). `pourquoi` creux → null.
 */
export function rattachementTacheGeneree(args: {
  tache: { goalIndex?: unknown; etapeIndex?: unknown; pourquoi?: unknown; type?: string | null; taskType?: string | null };
  objectifs: Array<{ id: number }>;
  etapesParObjectif: Map<number, Array<{ id: number }>>;
  projectId: number | null;
  carte: CarteFil | null;
}): Rattachement & { pourquoi: string | null } {
  const { tache, objectifs, etapesParObjectif, projectId, carte } = args;
  const pourquoi = typeof tache.pourquoi === "string" && !estPourquoiCreux(tache.pourquoi) ? tache.pourquoi.trim() : null;
  const gi = tache.goalIndex;
  const objectif = typeof gi === "number" && Number.isInteger(gi) ? objectifs[gi] : undefined;
  if (objectif) {
    const etapes = etapesParObjectif.get(objectif.id) ?? [];
    const ei = tache.etapeIndex;
    const etape = typeof ei === "number" && Number.isInteger(ei) ? etapes[ei] : undefined;
    if (etape) return { goalId: objectif.id, milestoneId: etape.id, pourquoi };
    const r = carte ? choisirRattachement({ projectId, goalId: objectif.id }, carte) : { goalId: objectif.id, milestoneId: null };
    return { ...r, pourquoi };
  }
  const r = carte ? choisirRattachement({ projectId, type: tache.type ?? null, taskType: tache.taskType ?? null }, carte) : AUCUN;
  return { ...r, pourquoi };
}
