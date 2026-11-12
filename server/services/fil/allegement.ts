// Fil conducteur, jour de moins bien (spec §4) : quand l'énergie du jour est basse, Naya PROPOSE
// une journée allégée. Rien n'est appliqué d'office : c'est une proposition de l'agent
// (agent_propositions), valable jusqu'à la fin du jour. Validée, elle reporte les tâches non
// essentielles aux jours travaillés suivants, et s'annule pendant 24 h (une action de journal,
// annulée ligne à ligne : une tâche déplacée à la main depuis reste où Jeanne l'a mise).
//
// Ce qu'on garde : les tâches clés, au moins une tâche par objectif prioritaire (urgence ≥ la
// médiane des urgences des objectifs actifs), les tâches à heure fixe et les rituels.
import { storage } from "../../storage";
import type { Task } from "@shared/schema";
import type { TacheCle } from "@shared/fil";
import type { Changement } from "@shared/agent";
import { modifierTache } from "../taches/ecrire-tache";
import { DAY_ABBRS, parseWorkDays } from "../campagne/placement";
import { wallClockToInstant } from "../../utils/timezone";
import { depot, type LigneJournal } from "../agent/depot";
import { outilAValider, type BilanExecution, type Empreinte, type OutilPropose } from "../agent/propositions";
import { dateLocale, dateValide, heureCourte, jourCourt } from "../agent/outils/directs";
import type { CarteFil } from "./carte";
import { filActifPour } from "./interrupteur";
import { lienDeTache } from "./lien";
import { urgenceObjectif } from "./priorite";

const ELEMENTS_MAX = 100;
const erreur = (code: string) => ({ erreur: code });
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

type TacheLue = Pick<Task, "id" | "completed" | "archivedAt" | "priority" | "goalId" | "milestoneId" | "scheduledDate"> & {
  schedulingMode?: string | null; ritualId?: number | null; type?: string | null; estimatedDuration?: number | null;
};

/** Ne bouge jamais : heure fixe, ou rituel. */
function estIntouchable(t: TacheLue): boolean {
  return t.schedulingMode === "fixed" || t.ritualId != null;
}

function mediane(valeurs: number[]): number {
  const v = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Le plan d'une journée allégée (pur). Candidates : les tâches non faites, non archivées, hors
 * marqueurs de jalon. Gardées : tâches clés, heure fixe, rituels, et pour chaque objectif
 * prioritaire sans tâche gardée, sa meilleure tâche (priorité la plus forte, puis la plus courte,
 * puis l'ordre reçu). Le reste part aux `joursSuivants`, en tourniquet ; sans jour suivant, rien
 * ne bouge (tout est gardé). `aujourdhui` sert à l'urgence ; par défaut, le jour des tâches
 * (à défaut de tâche datée, le premier jour suivant).
 */
export function planAllegement(
  taches: Task[], cles: TacheCle[], carte: CarteFil, joursSuivants: string[], aujourdhui?: string,
): { garder: number[]; deplacer: { tacheId: number; vers: string }[] } {
  const candidates = (taches as TacheLue[]).filter((t) => !t.completed && !t.archivedAt && t.type !== "milestone");
  const jour = aujourdhui
    ?? candidates.map((t) => String(t.scheduledDate ?? "").slice(0, 10)).find((x) => dateValide(x))
    ?? joursSuivants[0] ?? new Date(0).toISOString().slice(0, 10);

  const idsCles = new Set(cles.map((c) => c.tacheId));
  const gardees = new Set<number>(candidates.filter((t) => idsCles.has(t.id) || estIntouchable(t)).map((t) => t.id));

  // Objectifs prioritaires : urgence ≥ médiane (même urgence que les tâches clés).
  const urgences = carte.objectifs.map((o) => ({ id: o.id, u: urgenceObjectif(o, jour) }));
  const seuil = urgences.length ? mediane(urgences.map((x) => x.u)) : Infinity;
  const objectifDe = new Map(candidates.map((t) => [t.id, lienDeTache(carte, t)?.objectifId ?? null]));
  for (const { id: objectifId } of urgences.filter((x) => x.u >= seuil)) {
    const siennes = candidates.filter((t) => objectifDe.get(t.id) === objectifId);
    if (!siennes.length || siennes.some((t) => gardees.has(t.id))) continue;
    const meilleure = siennes.reduce((m, t) => {
      const pm = m.priority ?? 3, pt = t.priority ?? 3;
      if (pt !== pm) return pt < pm ? t : m;
      return (t.estimatedDuration ?? Infinity) < (m.estimatedDuration ?? Infinity) ? t : m;
    });
    gardees.add(meilleure.id);
  }

  const garder = candidates.filter((t) => gardees.has(t.id)).map((t) => t.id);
  if (!joursSuivants.length) return { garder: candidates.map((t) => t.id), deplacer: [] };
  const deplacer = candidates.filter((t) => !gardees.has(t.id))
    .map((t, i) => ({ tacheId: t.id, vers: joursSuivants[i % joursSuivants.length] }));
  return { garder, deplacer };
}

/** Les `n` jours travaillés après `date` (préférence `workDays`, lun.–ven. par défaut). */
export function joursTravaillesSuivants(date: string, workDays: string | null | undefined, n: number): string[] {
  const travailles = parseWorkDays(workDays);
  const res: string[] = [];
  const d = new Date(`${date}T12:00:00Z`);
  for (let i = 0; i < 366 && res.length < n && travailles.size > 0; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (travailles.has(DAY_ABBRS[d.getUTCDay()])) res.push(d.toISOString().slice(0, 10));
  }
  return res;
}

// ── alleger_journee ────────────────────────────────────────────────────────────────────

type ArgsAllegement = { date: string; deplacer: { tacheId: number; vers: string }[] };

function lendemain(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function placement(date: unknown, heure: unknown): string {
  if (typeof date !== "string" || !date) return "à planifier";
  const j = jourCourt(date.slice(0, 10));
  return typeof heure === "string" && heure ? `${j} à ${heureCourte(heure.slice(0, 5))}` : j;
}

// Les champs d'horaire, ceux que l'annulation compare puis réécrit.
const horaire = (t: any) => ({
  scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, scheduledEndTime: t.scheduledEndTime ?? null,
});

async function tacheDe(userId: string, id: unknown): Promise<any | undefined> {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
  const t = await storage.getTask(id);
  return t && (t as any).userId === userId ? t : undefined;
}

export const OUTIL_ALLEGEMENT: OutilPropose = outilAValider<ArgsAllegement>({
  nom: "alleger_journee",
  description:
    "Propose d'alléger une journée de moins bien : les tâches non essentielles sont reportées aux jours " +
    "travaillés suivants. Rien n'est fait avant que l'utilisatrice valide ; annulable 24 h ensuite.",
  schema: {
    type: "object",
    properties: {
      date: { type: "string", description: "Le jour à alléger, AAAA-MM-JJ." },
      deplacer: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tacheId: { type: "integer", description: "Id de la tâche." },
            vers: { type: "string", description: "Jour d'arrivée, AAAA-MM-JJ." },
          },
          required: ["tacheId", "vers"],
        },
      },
    },
    required: ["date", "deplacer"],
  },
  // Valable jusqu'à minuit (fuseau de l'utilisatrice) du jour allégé.
  expireA: (ctx, args) => wallClockToInstant(ctx.fuseau, lendemain(args.date), "00:00"),
  async apercu(ctx, args) {
    if (!filActifPour(ctx.userId)) return erreur("fil_inactif");
    if (!dateValide(args.date)) return erreur("date_invalide");
    if (args.date < dateLocale(ctx)) return erreur("jour_passe");
    if (!args.deplacer.length) return erreur("rien_a_deplacer");
    if (args.deplacer.length > ELEMENTS_MAX) return erreur("trop_de_taches");
    if (new Set(args.deplacer.map((x) => x.tacheId)).size !== args.deplacer.length) return erreur("doublon");
    const changements: Changement[] = [];
    const empreinte: Empreinte = [];
    for (const x of args.deplacer) {
      if (!dateValide(x.vers) || x.vers <= args.date) return erreur("date_invalide");
      const t = await tacheDe(ctx.userId, x.tacheId);
      if (!t || String(t.scheduledDate ?? "").slice(0, 10) !== args.date || t.completed || t.archivedAt) return erreur("introuvable");
      if (estIntouchable(t)) return erreur("tache_fixe");
      changements.push({ libelle: `« ${t.title} »`, avant: placement(t.scheduledDate, t.scheduledTime), apres: placement(x.vers, t.scheduledTime) });
      // Cochée, déplacée ou renommée depuis l'aperçu : la proposition est périmée.
      empreinte.push({
        table: "tasks", id: t.id,
        champs: { title: t.title, scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, completed: !!t.completed },
      });
    }
    return { resume: `Alléger ta journée du ${jourCourt(args.date)} : ${pluriel(changements.length, "tâche")} reportée${changements.length > 1 ? "s" : ""}`, changements, empreinte };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    const deplacees: { id: number; avant: Record<string, unknown> }[] = [];
    for (const x of args.deplacer) {
      try {
        // Même chemin que le web : jour travaillé, créneau libre, filet anti-chevauchement.
        const r = await modifierTache(ctx.userId, x.tacheId, { scheduledDate: x.vers });
        if (!r.ok) { bilan.echecs.push(`Tâche n° ${x.tacheId} : ${r.message === "task_not_found" ? "introuvable" : r.message}`); continue; }
        deplacees.push({ id: x.tacheId, avant: horaire(r.avant) });
        bilan.reussis.push(`« ${r.tache.title} » reportée au ${placement(r.tache.scheduledDate, r.tache.scheduledTime)}`);
      } catch (e: any) {
        console.error(`[fil] allègement, tâche ${x.tacheId} :`, e?.message ?? e);
        bilan.echecs.push(`Tâche n° ${x.tacheId} : erreur imprévue`);
      }
    }
    if (!deplacees.length) return bilan;
    // `apres` relu une fois TOUT déplacé : le filet anti-chevauchement d'un déplacement peut
    // avoir décalé une tâche déplacée avant elle ; sinon l'annulation la croirait modifiée.
    const lignes: LigneJournal[] = [];
    for (const x of deplacees) {
      const t = await tacheDe(ctx.userId, x.id);
      if (t) lignes.push({ table: "tasks", id: x.id, avant: x.avant, apres: horaire(t) });
    }
    try {
      const a = await depot.ajouterAction(ctx.userId, "alleger_journee",
        `Journée du ${jourCourt(args.date)} allégée : ${pluriel(lignes.length, "tâche")} reportée${lignes.length > 1 ? "s" : ""}`, lignes);
      bilan.actionId = a.id;
    } catch (e: any) {
      console.error("[fil] allègement, journal :", e?.message ?? e);
      bilan.echecs.push("Le report est fait, mais il ne pourra pas être annulé d'un geste.");
    }
    return bilan;
  },
});
