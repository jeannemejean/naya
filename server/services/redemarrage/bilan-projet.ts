// Séance de redémarrage : la proposition groupée d'UN projet. Naya a écouté le récit ; elle propose
// en une fois ce qui change (tâches faites ou abandonnées, note, statut, créneaux réguliers pour le
// travail fait hors de Naya, envois aux marques, prochaines étapes). L'utilisatrice valide tout ou
// ligne par ligne ; tout ce qui est écrit tient dans UNE action annulable 24 h.
import type { Changement } from "@shared/agent";
import { storage } from "../../storage";
import { outilAValider, type BilanExecution, type Empreinte } from "../agent/propositions";
import { depot, type LigneJournal } from "../agent/depot";
import { creerTache, modifierTache } from "../taches/ecrire-tache";
import { creerRituelEtMaterialiser, validerRituel, dateLocale } from "../ritual-create";
import { lireRituel, retirerRituel } from "../ritual-store";
import { creerEnvoi } from "../envois/store";
import { formatRythmeServeur } from "./format";
import { SCHEMA_OPERATION } from "./schema-operations";

export type OperationBilan =
  | { type: "cocher_tache"; taskId: number }
  | { type: "archiver_tache"; taskId: number }
  | { type: "note_projet"; texte: string }
  | { type: "statut_projet"; statut: "active" | "paused" | "incubating" }
  | { type: "creer_creneau"; titre: string; days: string; startTime: string; durationMinutes: number; intervalWeeks: number }
  | { type: "arreter_creneau"; ritualId: number }
  | { type: "creer_envoi"; marque: string; objet: string; canal?: string; envoyeLe: string; prochaineRelance?: string; contact?: string }
  | { type: "creer_tache"; titre: string; dureeMinutes?: number; date?: string };

export interface ArgsBilanProjet { projectId: number; operations: OperationBilan[]; lignesRetenues?: number[] }

export const DUREE_BILAN_MS = 7 * 86_400_000;
const OPERATIONS_MAX = 40;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUTS: Record<string, string> = { active: "actif", paused: "en pause", incubating: "en incubation" };
const erreur = (e: string) => ({ erreur: e });
const court = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

async function tacheDuProjet(userId: string, id: unknown, projectId: number): Promise<any | undefined> {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
  const t: any = await storage.getTask(id);
  return t && t.userId === userId && (t.projectId == null || t.projectId === projectId) ? t : undefined;
}



export const appliquerBilanProjet = outilAValider<ArgsBilanProjet>({
  nom: "appliquer_bilan_projet",
  description: "Séance de redémarrage : applique, pour un projet, les changements tirés du récit de l'utilisatrice. Validable ligne par ligne.",
  schema: {
    type: "object",
    properties: {
      projectId: { type: "integer" },
      operations: { type: "array", items: SCHEMA_OPERATION as any },
    },
    required: ["projectId", "operations"],
  },
  dureeMs: DUREE_BILAN_MS,
  selectionnable: true,
  async apercu(ctx, args) {
    const projet: any = await storage.getProject(args.projectId, ctx.userId);
    if (!projet) return erreur("projet_introuvable");
    const ops = args.operations ?? [];
    if (!ops.length) return erreur("aucune_operation");
    if (ops.length > OPERATIONS_MAX) return erreur(`${OPERATIONS_MAX} changements au plus`);
    const changements: Changement[] = [];
    const empreinte: Empreinte = [];
    let projetSurveille = false;
    const surveillerProjet = () => {
      if (projetSurveille) return;
      projetSurveille = true;
      empreinte.push({ table: "projects", id: projet.id, champs: { statusNote: projet.statusNote ?? null, projectStatus: projet.projectStatus ?? null } });
    };
    for (const op of ops) {
      switch (op.type) {
        case "cocher_tache":
        case "archiver_tache": {
          const t = await tacheDuProjet(ctx.userId, op.taskId, projet.id);
          if (!t) return erreur("tache_introuvable");
          changements.push({ libelle: `« ${t.title} »`, avant: "à faire", apres: op.type === "cocher_tache" ? "faite" : "abandonnée (archivée)" });
          empreinte.push({ table: "tasks", id: t.id, champs: { completed: !!t.completed, archivedAt: t.archivedAt ?? null } });
          break;
        }
        case "note_projet": {
          const texte = String(op.texte ?? "").trim();
          if (!texte) return erreur("note_vide");
          surveillerProjet();
          changements.push({ libelle: "Où en est ce projet", avant: projet.statusNote ? court(projet.statusNote) : null, apres: court(texte) });
          break;
        }
        case "statut_projet": {
          if (!STATUTS[op.statut]) return erreur("statut_invalide");
          surveillerProjet();
          changements.push({ libelle: "Statut du projet", avant: STATUTS[projet.projectStatus] ?? projet.projectStatus ?? null, apres: STATUTS[op.statut] });
          break;
        }
        case "creer_creneau": {
          const v = validerRituel({ title: op.titre, days: op.days, startTime: op.startTime, durationMinutes: op.durationMinutes, intervalWeeks: op.intervalWeeks, projectId: projet.id }, dateLocale(ctx.maintenant));
          if (!v.ok) return erreur(`creneau_invalide: ${v.message}`);
          changements.push({ libelle: `Créneau régulier « ${v.donnees.title} »`, avant: null, apres: `${formatRythmeServeur(v.donnees.days, v.donnees.intervalWeeks)}, ${v.donnees.startTime}, ${v.donnees.durationMinutes} min` });
          break;
        }
        case "arreter_creneau": {
          const r = await lireRituel(ctx.userId, op.ritualId);
          if (!r || !r.active) return erreur("creneau_introuvable");
          changements.push({ libelle: `Créneau « ${r.title} »`, avant: "actif", apres: "arrêté" });
          empreinte.push({ table: "recurring_rituals", id: r.id, champs: { active: true } });
          break;
        }
        case "creer_envoi": {
          if (!String(op.marque ?? "").trim() || !String(op.objet ?? "").trim()) return erreur("envoi_incomplet");
          if (!DATE.test(String(op.envoyeLe ?? ""))) return erreur("envoyeLe doit être AAAA-MM-JJ");
          if (op.prochaineRelance != null && !DATE.test(op.prochaineRelance)) return erreur("prochaineRelance doit être AAAA-MM-JJ");
          changements.push({ libelle: `Envoi à ${op.marque.trim()} : ${court(op.objet.trim(), 80)}`, avant: null, apres: op.prochaineRelance ? `relance le ${op.prochaineRelance}` : "sans relance" });
          break;
        }
        case "creer_tache": {
          const titre = String(op.titre ?? "").trim();
          if (!titre || titre.length > 200) return erreur("titre_invalide");
          if (op.date != null && !DATE.test(op.date)) return erreur("date doit être AAAA-MM-JJ");
          changements.push({ libelle: `Nouvelle tâche « ${titre} »`, avant: null, apres: op.date ?? "à placer" });
          break;
        }
        default:
          return erreur("operation_inconnue");
      }
    }
    return { resume: `${projet.name} : ${changements.length} changement${changements.length > 1 ? "s" : ""}`, changements, empreinte };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    const lignes: LigneJournal[] = [];
    const retenues = args.lignesRetenues ? new Set(args.lignesRetenues) : null;
    const projet: any = await storage.getProject(args.projectId, ctx.userId);
    if (!projet) return { reussis: [], echecs: ["Projet introuvable"] };
    for (const [i, op] of (args.operations ?? []).entries()) {
      if (retenues && !retenues.has(i)) continue;
      try {
        switch (op.type) {
          case "cocher_tache":
          case "archiver_tache": {
            let avant: any; let apres: any;
            if (op.type === "cocher_tache") {
              const r = await modifierTache(ctx.userId, op.taskId, { completed: true });
              if (!r.ok) { bilan.echecs.push(`Tâche n° ${op.taskId} : ${r.message}`); break; }
              avant = r.avant; apres = r.tache;
            } else {
              // archivedAt n'est pas dans la liste blanche d'édition : écrit ici, propriété revérifiée.
              avant = await tacheDuProjet(ctx.userId, op.taskId, projet.id);
              if (!avant) { bilan.echecs.push(`Tâche n° ${op.taskId} : introuvable`); break; }
              apres = (await storage.updateTask(op.taskId, { archivedAt: ctx.maintenant } as any)) ?? { ...avant, archivedAt: ctx.maintenant };
            }
            lignes.push(op.type === "cocher_tache"
              ? { table: "tasks", id: op.taskId, avant: { completed: !!avant.completed, completedAt: avant.completedAt ?? null }, apres: { completed: !!apres.completed, completedAt: apres.completedAt ?? null } }
              : { table: "tasks", id: op.taskId, avant: { archivedAt: avant.archivedAt ?? null }, apres: { archivedAt: apres.archivedAt ?? ctx.maintenant } });
            bilan.reussis.push(`« ${apres.title} » ${op.type === "cocher_tache" ? "cochée" : "archivée"}`);
            break;
          }
          case "note_projet":
          case "statut_projet": {
            const actuel: any = await storage.getProject(projet.id, ctx.userId);
            const champ = op.type === "note_projet" ? "statusNote" : "projectStatus";
            const valeur = op.type === "note_projet" ? op.texte.trim() : op.statut;
            await storage.updateProject(projet.id, ctx.userId, { [champ]: valeur } as any);
            lignes.push({ table: "projects", id: projet.id, avant: { [champ]: actuel?.[champ] ?? null }, apres: { [champ]: valeur } });
            bilan.reussis.push(op.type === "note_projet" ? "Note du projet mise à jour" : `Projet ${STATUTS[op.statut]}`);
            break;
          }
          case "creer_creneau": {
            const v = validerRituel({ title: op.titre, days: op.days, startTime: op.startTime, durationMinutes: op.durationMinutes, intervalWeeks: op.intervalWeeks, projectId: projet.id }, dateLocale(ctx.maintenant));
            if (!v.ok) { bilan.echecs.push(`Créneau « ${op.titre} » : ${v.message}`); break; }
            const { ritual } = await creerRituelEtMaterialiser(ctx.userId, v.donnees, ctx.maintenant);
            lignes.push({ table: "recurring_rituals", id: ritual.id, avant: null, apres: { active: true, title: ritual.title } });
            bilan.reussis.push(`Créneau « ${ritual.title} » ajouté`);
            break;
          }
          case "arreter_creneau": {
            await retirerRituel(ctx.userId, op.ritualId);
            lignes.push({ table: "recurring_rituals", id: op.ritualId, avant: { active: true }, apres: { active: false } });
            bilan.reussis.push("Créneau arrêté");
            break;
          }
          case "creer_envoi": {
            const e = await creerEnvoi(ctx.userId, {
              projectId: projet.id, marque: op.marque.trim(), objet: op.objet.trim(), canal: op.canal ?? null, contact: op.contact ?? null,
              envoyeLe: op.envoyeLe, prochaineRelance: op.prochaineRelance ?? null, statut: "envoye",
            });
            lignes.push({ table: "envois", id: e.id, avant: null, apres: { marque: e.marque, objet: e.objet, statut: e.statut } });
            bilan.reussis.push(`Envoi à ${e.marque} noté`);
            break;
          }
          case "creer_tache": {
            const donnees: Record<string, unknown> = { title: op.titre.trim(), type: "planning", category: "planning", priority: 3, source: "redemarrage", projectId: projet.id };
            if (op.date) donnees.scheduledDate = op.date;
            if (op.dureeMinutes) donnees.estimatedDuration = op.dureeMinutes;
            const r = await creerTache(ctx.userId, donnees);
            if (!r.ok) { bilan.echecs.push(`« ${op.titre} » : ${r.message}`); break; }
            const t: any = r.tache;
            lignes.push({ table: "tasks", id: t.id, avant: null, apres: { title: t.title, scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, completed: !!t.completed } });
            bilan.reussis.push(`« ${t.title} » ajoutée`);
            break;
          }
        }
      } catch (e: any) {
        console.error(`[redemarrage] opération ${i} (${op.type}) :`, e?.message ?? e);
        bilan.echecs.push(`Changement ${i + 1} : erreur imprévue`);
      }
    }
    if (lignes.length) {
      const a = await depot.ajouterAction(ctx.userId, "appliquer_bilan_projet", `${projet.name} : bilan appliqué`, lignes);
      bilan.actionId = a.id;
    }
    return bilan;
  },
});
