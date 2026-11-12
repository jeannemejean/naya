// Priorité des tâches clés du jour : les 2–3 tâches qui font avancer les objectifs, tous objectifs
// confondus. Pure : aucune base, aucune IA, pas d'horloge (la date du jour est passée en argument).
//
// Candidates : les tâches fournies, non faites (`completed`) et non archivées (`archivedAt`).
//
// score = 40 × urgence de l'objectif (0..1)
//       + 25 si la tâche est sur l'étape ACTIVE de l'objectif (etapesActives) et qu'il reste au plus
//            2 tâches pour la franchir (prevues - faites, prevues > 0) : elle débloque la suite
//       + 25 si une échéance liée (tâche ou étape) tombe d'ici 2 jours, retard compris
//       + 10 si priority === 1
// Une tâche sans objectif a une urgence de 0 (elle ne peut gagner que par la priorité ou l'échéance).
//
// Normalisation de l'urgence : `computeGoalUrgencyScore` (goal-urgency.ts) rend DÉJÀ un score borné
// dans [0, 1] (0,6 × urgence temporelle + 0,4 × travail restant, plafonné à 1) ; on le reprend tel
// quel, borné par sécurité à [0, 1]. Deux adaptations : l'avancement est la somme faites/prevues des
// étapes de l'objectif ; et la fonction lit Date.now(), donc l'échéance est décalée de l'écart entre
// « maintenant » et midi du jour passé en argument, pour que le résultat ne dépende que de `aujourdhui`.
//
// Énergie `low` ou `depleted` : une tâche `deep_work` passe derrière les autres à score égal à 10
// points près (elle est classée avec score - 10, et perd les égalités). Le score rendu reste le vrai.
//
// Sélection : 3 tâches au plus, dont 2 au plus sur un même objectif tant qu'un autre objectif a une
// candidate (le plafond saute quand il ne reste que cet objectif). Une tâche sans objectif n'entre
// que s'il y a moins de 2 candidates rattachées à un objectif. Le résultat est trié par score.
import type { Task } from "@shared/schema";
import type { TacheCle } from "@shared/fil";
import { computeGoalUrgencyScore } from "../goal-urgency";
import { etapesActives, type CarteFil, type EtapeCarte, type ObjectifCarte } from "./carte";
import { lienDeTache } from "./lien";

export interface EcheanceProche { tacheId?: number; etapeId?: number; date: string /* YYYY-MM-DD */ }

const MAX_TACHES = 3;
const MAX_PAR_OBJECTIF = 2;
const JOURS_ECHEANCE = 2;
const MARGE_DEEP_WORK = 10;
const JOUR_MS = 86400000;

type TacheLue = Pick<Task, "id" | "title" | "priority" | "completed" | "archivedAt" | "taskEnergyType" | "goalId" | "milestoneId" | "pourquoi">;
type Candidate = { tache: TacheLue; objectif: ObjectifCarte | null; etape: EtapeCarte | null; score: number; classement: number; cle: TacheCle };

function urgence(o: ObjectifCarte, aujourdhui: string): number {
  const decalage = Date.now() - Date.parse(`${aujourdhui}T12:00:00Z`);
  const echeance = o.dueDate ? new Date(o.dueDate.getTime() + decalage) : null;
  const faites = o.etapes.reduce((s, e) => s + e.faites, 0);
  const prevues = o.etapes.reduce((s, e) => s + e.prevues, 0);
  const u = computeGoalUrgencyScore({ id: o.id, title: o.titre, goalType: o.goalType, successMode: o.successMode,
    dueDate: echeance, completedTasks: faites, totalTasks: prevues });
  return Math.min(1, Math.max(0, u));
}

export function classerTachesCles(
  taches: Task[], carte: CarteFil, echeances: EcheanceProche[], energie: string | null, aujourdhui: string,
): TacheCle[] {
  const limite = new Date(Date.parse(`${aujourdhui}T12:00:00Z`) + JOURS_ECHEANCE * JOUR_MS).toISOString().slice(0, 10);
  const proche = (e: EcheanceProche) => e.date <= limite;
  const urgences = new Map<number, number>();
  const energieBasse = energie === "low" || energie === "depleted";

  const candidates: Candidate[] = [];
  for (const tache of taches as TacheLue[]) {
    if (tache.completed || tache.archivedAt) continue;
    const lien = lienDeTache(carte, tache);
    const objectif = lien ? carte.objectifs.find((o) => o.id === lien.objectifId) ?? null : null;
    const etape = objectif && lien?.etapeId != null ? objectif.etapes.find((e) => e.id === lien.etapeId) ?? null : null;

    let score = 0;
    if (objectif) {
      if (!urgences.has(objectif.id)) urgences.set(objectif.id, urgence(objectif, aujourdhui));
      score += 40 * urgences.get(objectif.id)!;
    }
    if (objectif && etape && etapesActives(objectif.etapes).some((e) => e.id === etape.id)
        && etape.prevues > 0 && etape.prevues - etape.faites <= 2) score += 25;
    if (echeances.some((e) => proche(e) && ((e.tacheId != null && e.tacheId === tache.id) || (e.etapeId != null && e.etapeId === tache.milestoneId)))) score += 25;
    if (tache.priority === 1) score += 10;

    const deep = energieBasse && tache.taskEnergyType === "deep_work";
    const arrondi = Math.round(score * 10) / 10;
    candidates.push({
      tache, objectif, etape, score: arrondi, classement: score - (deep ? MARGE_DEEP_WORK + 1e-6 : 0),
      cle: { tacheId: tache.id, titre: tache.title, pourquoi: tache.pourquoi ?? etape?.pourquoi ?? null, lien, score: arrondi },
    });
  }
  // Tri stable : à classement égal, l'ordre reçu est conservé ; une deep_work déclassée perd l'égalité.
  candidates.sort((a, b) => b.classement - a.classement);

  const avecObjectif = candidates.filter((c) => c.objectif);
  const choisies: Candidate[] = [];
  const parObjectif = new Map<number, number>();
  const prendre = (c: Candidate) => {
    choisies.push(c);
    if (c.objectif) parObjectif.set(c.objectif.id, (parObjectif.get(c.objectif.id) ?? 0) + 1);
  };
  for (const c of avecObjectif) {
    if (choisies.length >= MAX_TACHES) break;
    if ((parObjectif.get(c.objectif!.id) ?? 0) < MAX_PAR_OBJECTIF) prendre(c);
  }
  // Plafond levé : il ne reste pas d'autre objectif à servir, on complète avec le même.
  for (const c of avecObjectif) {
    if (choisies.length >= MAX_TACHES) break;
    if (!choisies.includes(c)) prendre(c);
  }
  if (avecObjectif.length < 2) {
    for (const c of candidates) {
      if (choisies.length >= MAX_TACHES) break;
      if (!c.objectif) prendre(c);
    }
  }
  return choisies.sort((a, b) => b.classement - a.classement).map((c) => c.cle);
}
