/**
 * Tâche de VÉRIFICATION de prospection dans le planning.
 *
 * Demande de Jeanne : plus aucune tâche de prospection manuelle — Naya trouve, audite et
 * rédige. Il reste une seule décision humaine, la validation des messages préparés
 * (prospection-validation.ts). Elle mérite sa place dans la journée : UNE tâche courte par
 * campagne et par jour, « Valider les messages préparés par Naya — n prospects (campagne) »,
 * qui ouvre directement l'écran de la campagne.
 *
 * Idempotent : appelé à la fin d'un enrichissement (prospects passés à `messages_ready`),
 * après une validation, et chaque matin par l'auto-planner. Il crée, met à jour le nombre,
 * ramène à aujourd'hui une tâche restée ouverte, ou la clôt quand il n'y a plus rien à
 * valider — jamais de doublon.
 */
import { storage } from "../storage";
import { ETAPE_EN_ATTENTE_DE_VALIDATION, estValide } from "./prospection-validation";

/** `tasks.taskType` qui identifie ces tâches. */
export const TYPE_TACHE_VALIDATION = "prospection_validation";
/** `tasks.source` : ni « generated » (régénérable) ni « manual ». */
const SOURCE_TACHE_VALIDATION = "prospection";
/** Fenêtre de recherche des tâches ouvertes à reprendre. */
const RETROSPECTIVE_JOURS = 30;

export interface ProspectPourValidation {
  id: number;
  prospectionCampaignId?: number | null;
  stage?: string | null;
  validatedAt?: Date | null;
  archivedAt?: Date | null;
}

/** Prospects d'une campagne dont Naya a préparé les messages et que personne n'a validés. */
export function prospectsAValider<T extends ProspectPourValidation>(leads: T[], campaignId: number): T[] {
  return leads.filter(
    (l) =>
      l.prospectionCampaignId === campaignId &&
      l.stage === ETAPE_EN_ATTENTE_DE_VALIDATION &&
      !estValide(l.validatedAt ?? null) &&
      !l.archivedAt,
  );
}

export function titreValidation(n: number, nomCampagne: string): string {
  return `Valider les messages préparés par Naya — ${n} prospect${n > 1 ? "s" : ""} (${nomCampagne})`;
}

/** Relire un message prend une minute ou deux : 15 min, jusqu'à 30 pour un gros lot. */
export function dureeValidation(n: number): number {
  return Math.min(30, Math.max(15, Math.ceil(n * 1.5)));
}

/** Écran où l'on valide : l'onglet Prospects de la campagne (CampaignWorkspace). */
export function lienValidation(campaignId: number): string {
  return `/outreach/campaigns/${campaignId}?onglet=prospects`;
}

export interface CampagnePourValidation {
  id: number;
  name: string;
  projectId?: number | null;
  /** campaigns.id (campagne marketing liée) — c'est ce que référence `tasks.campaignId`. */
  linkedCampaignId?: number | null;
  status?: string | null;
}

export interface TachePourValidation {
  id: number;
  title?: string | null;
  completed?: boolean | null;
  archivedAt?: Date | null;
  scheduledDate?: string | null;
  taskType?: string | null;
  actionData?: unknown;
}

export interface PlanValidation {
  creer: Record<string, unknown> | null;
  maj: { id: number; data: Record<string, unknown> }[];
  clore: number[];
}

function campagneDeLaTache(t: TachePourValidation): number | null {
  const id = (t.actionData as any)?.prospectionCampaignId;
  return typeof id === "number" ? id : null;
}

function actionData(campagne: CampagnePourValidation, n: number) {
  return { prospectionCampaignId: campagne.id, aValider: n, lien: lienValidation(campagne.id) };
}

/** Décide quoi écrire pour UNE campagne. PUR. */
export function planTacheValidation(e: {
  campagne: CampagnePourValidation;
  aValider: number;
  taches: TachePourValidation[];
  jour: string;
}): PlanValidation {
  const plan: PlanValidation = { creer: null, maj: [], clore: [] };
  const siennes = e.taches.filter(
    (t) => t.taskType === TYPE_TACHE_VALIDATION && campagneDeLaTache(t) === e.campagne.id && !t.archivedAt,
  );
  const ouvertes = siennes
    .filter((t) => !t.completed)
    .sort((a, b) => String(b.scheduledDate ?? "").localeCompare(String(a.scheduledDate ?? "")) || b.id - a.id);

  if (e.aValider <= 0) {
    plan.clore = ouvertes.map((t) => t.id);
    return plan;
  }

  const titre = titreValidation(e.aValider, e.campagne.name);
  const [gardee, ...doublons] = ouvertes;
  plan.clore = doublons.map((t) => t.id);

  if (gardee) {
    const anciennes = (gardee.actionData as any)?.aValider;
    const inchangee = gardee.title === titre && gardee.scheduledDate === e.jour && anciennes === e.aValider;
    if (!inchangee) {
      plan.maj.push({
        id: gardee.id,
        data: {
          title: titre,
          scheduledDate: e.jour,
          estimatedDuration: dureeValidation(e.aValider),
          actionData: actionData(e.campagne, e.aValider),
        },
      });
    }
    return plan;
  }

  // Déjà cochée aujourd'hui : une seule tâche par campagne et par jour.
  if (siennes.some((t) => t.completed && t.scheduledDate === e.jour)) return plan;

  plan.creer = {
    title: titre,
    description:
      "Naya a trouvé ces prospects, audité leur profil et rédigé leurs messages. Relis-les et valide " +
      "ceux qui peuvent partir : rien n'est envoyé sans ton accord.",
    type: "admin",
    category: "conversion",
    priority: 2,
    completed: false,
    estimatedDuration: dureeValidation(e.aValider),
    source: SOURCE_TACHE_VALIDATION,
    schedulingMode: "flexible",
    scheduledDate: e.jour,
    taskEnergyType: "admin",
    setupCost: "low",
    canBeFragmented: false,
    recommendedTimeOfDay: "morning",
    projectId: e.campagne.projectId ?? null,
    campaignId: e.campagne.linkedCampaignId ?? null,
    taskType: TYPE_TACHE_VALIDATION,
    actionData: actionData(e.campagne, e.aValider),
  };
  return plan;
}

function jourMoins(jour: string, n: number): string {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Jour courant à Paris (YYYY-MM-DD), pour les appels hors auto-planner. */
export function aujourdhuiParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

/**
 * Aligne les tâches de validation de l'utilisatrice sur l'état réel de ses prospects.
 * Seules les campagnes ACTIVES appellent une validation ; une campagne en pause ou
 * terminée voit sa tâche ouverte close.
 */
export async function synchroniserValidationsProspection(
  userId: string,
  jour: string = aujourdhuiParis(),
  opts: { campaignId?: number } = {},
): Promise<{ creees: number; majs: number; closes: number }> {
  const [campagnes, leads, taches] = await Promise.all([
    storage.getProspectionCampaigns(userId),
    storage.getLeads(userId),
    storage.getTasksInRange(userId, jourMoins(jour, RETROSPECTIVE_JOURS), jour),
  ]);
  const compte = { creees: 0, majs: 0, closes: 0 };

  for (const c of campagnes as any[]) {
    if (opts.campaignId != null && c.id !== opts.campaignId) continue;
    const active = (c.status ?? "active") === "active";
    const n = active ? prospectsAValider(leads as any[], c.id).length : 0;
    const plan = planTacheValidation({ campagne: c, aValider: n, taches: taches as any[], jour });

    if (plan.creer) {
      await storage.createTask({ ...plan.creer, userId } as any);
      compte.creees++;
    }
    for (const m of plan.maj) {
      await storage.updateTask(m.id, m.data as any);
      compte.majs++;
    }
    for (const id of plan.clore) {
      await storage.updateTask(id, { completed: true, completedAt: new Date() } as any);
      compte.closes++;
    }
  }
  return compte;
}
