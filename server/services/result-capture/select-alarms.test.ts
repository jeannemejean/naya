import { describe, it, expect } from "vitest";
import { selectAlarmsToPost, type AlarmCandidateTask } from "./select-alarms";
import { parisWallClockToInstant } from "../../utils/timezone";

const DAY = "2026-09-08"; // un mardi ordinaire, loin de toute bascule DST
const NOW = parisWallClockToInstant(DAY, "12:00");

const task = (overrides: Partial<AlarmCandidateTask> = {}): AlarmCandidateTask => ({
  id: 1,
  title: "Tâche",
  completed: false,
  scheduledDate: DAY,
  scheduledEndTime: "14:00",
  ...overrides,
});

describe("selectAlarmsToPost", () => {
  it("une tâche sans heure de fin → aucune alarme", () => {
    const t = task({ scheduledEndTime: null });
    expect(selectAlarmsToPost([t], NOW, false)).toEqual([]);
  });

  it("une tâche déjà terminée → aucune alarme", () => {
    const t = task({ completed: true, scheduledEndTime: "14:00" });
    expect(selectAlarmsToPost([t], NOW, false)).toEqual([]);
  });

  it("une heure déjà passée → aucune alarme", () => {
    // NOW = 12:00 à Paris ; 09:00 est révolue.
    const t = task({ scheduledEndTime: "09:00" });
    expect(selectAlarmsToPost([t], NOW, false)).toEqual([]);
  });

  it("une heure exactement à `now` → décide (exclut, cohérent avec le reste de la couture)", () => {
    // Borne stricte `>`, comme la route aujourd'hui : `unansweredStreak` traite
    // `scheduledFor <= now` comme échue, et `replaceTaskPromptsForDay` ne supprime
    // (donc ne conserve comme "à reprogrammer") que `gt(scheduledFor, now)`. Une
    // alarme pile sur `now` doit donc être traitée comme déjà passée ici aussi —
    // sinon elle serait posée par cette fonction ET immédiatement comptée comme
    // "échue sans réponse" par `unansweredStreak` au prochain calcul de la soupape.
    const t = task({ scheduledEndTime: "12:00" });
    expect(selectAlarmsToPost([t], NOW, false)).toEqual([]);
  });

  it("aucune heure de fin, tâche terminée, heure passée : aucune ne produit d'erreur ni d'alarme, ensemble", () => {
    const tasks = [
      task({ id: 1, scheduledEndTime: null }),
      task({ id: 2, completed: true }),
      task({ id: 3, scheduledEndTime: "09:00" }),
      task({ id: 4, scheduledEndTime: "18:00" }), // future : celle-ci doit passer
    ];
    const result = selectAlarmsToPost(tasks, NOW, false);
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe(4);
  });

  it("reduceFrequency vrai → exactement une alarme, la dernière de la journée", () => {
    const tasks = [
      task({ id: 1, scheduledEndTime: "15:00" }),
      task({ id: 2, scheduledEndTime: "19:00" }),
      task({ id: 3, scheduledEndTime: "17:00" }),
    ];
    const result = selectAlarmsToPost(tasks, NOW, true);
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe(2);
  });

  it("reduceFrequency vrai mais aucune alarme future → aucune alarme, et surtout pas d'erreur", () => {
    const tasks = [
      task({ id: 1, scheduledEndTime: "09:00" }),
      task({ id: 2, scheduledEndTime: "10:00" }),
    ];
    expect(() => selectAlarmsToPost(tasks, NOW, true)).not.toThrow();
    expect(selectAlarmsToPost(tasks, NOW, true)).toEqual([]);
  });

  it("est idempotente : appelée deux fois sur les mêmes entrées, même résultat", () => {
    const tasks = [
      task({ id: 1, scheduledEndTime: "15:00" }),
      task({ id: 2, scheduledEndTime: "19:00" }),
      task({ id: 3, scheduledEndTime: null }),
      task({ id: 4, completed: true, scheduledEndTime: "16:00" }),
    ];
    const first = selectAlarmsToPost(tasks, NOW, false);
    const second = selectAlarmsToPost(tasks, NOW, false);
    expect(second).toEqual(first);
  });

  it("est idempotente aussi sous la soupape (reduceFrequency vrai)", () => {
    const tasks = [
      task({ id: 1, scheduledEndTime: "15:00" }),
      task({ id: 2, scheduledEndTime: "19:00" }),
    ];
    const first = selectAlarmsToPost(tasks, NOW, true);
    const second = selectAlarmsToPost(tasks, NOW, true);
    expect(second).toEqual(first);
  });
});
