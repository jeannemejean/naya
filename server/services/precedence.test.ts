import { describe, it, expect } from "vitest";
import { respecterPrecedences, type TachePlanifiable, type Calendrier } from "./precedence";

const cal: Calendrier = { joursTravailles: new Set(["mon", "tue", "wed", "thu", "fri"]), debutJournee: "09:00", finJournee: "18:00", tamponMin: 10 };
const t = (id: number, d: string | null, h: string | null, dur: number | null = 60, completed = false): TachePlanifiable =>
  ({ id, scheduledDate: d, scheduledTime: h, estimatedDuration: dur, completed });
// 2026-10-06 = mardi, 2026-10-09 = vendredi, 2026-10-10 = samedi, 2026-10-12 = lundi
const run = (taches: TachePlanifiable[], deps: Array<[number, number]>, c = cal) =>
  respecterPrecedences({ taches, dependances: deps.map(([taskId, dependsOnTaskId]) => ({ taskId, dependsOnTaskId })), calendrier: c });

describe("respecterPrecedences", () => {
  it("cas réel 531/533 : l'envoi planifié la veille du modèle part après le modèle", () => {
    const r = run([t(531, "2026-10-06", "15:06", 45), t(533, "2026-10-07", "14:00", 60)], [[531, 533]]);
    expect(r).toEqual([{ id: 531, scheduledDate: "2026-10-07", scheduledTime: "15:10" }]);
  });

  it("cas réel 551/550 : même jour, le dépendant passe après la fin du prérequis + tampon", () => {
    const r = run([t(551, "2026-10-08", "10:55", 30), t(550, "2026-10-08", "11:25", 45)], [[551, 550]]);
    expect(r).toEqual([{ id: 551, scheduledDate: "2026-10-08", scheduledTime: "12:20" }]);
  });

  it("ne déplace rien quand l'ordre est déjà bon", () => {
    expect(run([t(1, "2026-10-06", "09:00", 60), t(2, "2026-10-06", "11:00", 60)], [[2, 1]])).toEqual([]);
  });

  it("débordement de la journée → prochain jour travaillé à l'ouverture (week-end sauté)", () => {
    const r = run([t(2, "2026-10-09", "09:00", 60), t(1, "2026-10-09", "16:30", 60)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-12", scheduledTime: "09:00" }]);
  });

  it("prérequis un samedi → le dépendant ne tombe pas un week-end", () => {
    const r = run([t(2, "2026-10-09", "10:00", 30), t(1, "2026-10-10", "10:00", 30)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-12", scheduledTime: "09:00" }]);
  });

  it("cascade A → B → C", () => {
    const r = run(
      [t(1, "2026-10-07", "14:00", 60), t(2, "2026-10-06", "09:00", 60), t(3, "2026-10-06", "10:00", 60)],
      [[2, 1], [3, 2]],
    );
    expect(r).toEqual([
      { id: 2, scheduledDate: "2026-10-07", scheduledTime: "15:10" },
      { id: 3, scheduledDate: "2026-10-07", scheduledTime: "16:20" },
    ]);
  });

  it("prérequis terminé → aucune contrainte", () => {
    expect(run([t(2, "2026-10-06", "09:00"), t(1, "2026-10-07", "09:00", 60, true)], [[2, 1]])).toEqual([]);
  });

  it("prérequis non planifié → aucune contrainte", () => {
    expect(run([t(2, "2026-10-06", "09:00"), t(1, null, null)], [[2, 1]])).toEqual([]);
  });

  it("auto-référence et cycle : aucun déplacement, pas de boucle", () => {
    expect(run([t(533, "2026-10-07", "14:00")], [[533, 533]])).toEqual([]);
    expect(run([t(1, "2026-10-06", "09:00"), t(2, "2026-10-06", "10:00")], [[1, 2], [2, 1]])).toEqual([]);
  });

  it("durée absente ou nulle traitée comme 30 min", () => {
    const r = run([t(2, "2026-10-06", "09:00", 30), t(1, "2026-10-06", "09:00", 0)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-06", scheduledTime: "09:40" }]);
  });

  it("une tâche non contrainte n'est jamais déplacée", () => {
    const r = run([t(1, "2026-10-07", "09:00"), t(2, "2026-10-06", "09:00"), t(9, "2026-10-06", "08:00")], [[2, 1]]);
    expect(r.map((d) => d.id)).toEqual([2]);
  });

  it("prérequis dont la fin dépasse déjà la journée → jour travaillé suivant", () => {
    const r = run([t(2, "2026-10-06", "09:00", 30), t(1, "2026-10-06", "17:30", 90)], [[2, 1]]);
    expect(r).toEqual([{ id: 2, scheduledDate: "2026-10-07", scheduledTime: "09:00" }]);
  });
});
