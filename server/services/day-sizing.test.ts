import { describe, it, expect } from "vitest";
import { maxTasksForDay } from "./day-sizing";

/**
 * TDD — extrait de generateForUser (auto-planner.ts) pour être testable isolément.
 *
 * Le plafond dur de 8 était calibré pour des journées SANS tampon. Avec la respiration,
 * un créneau coûte plus cher (AVG_TASK_MIN + bufferMin) : le plafond doit être réduit
 * proportionnellement, sinon il absorbe tout le changement et la journée garde 8 tâches
 * qui doivent maintenant aussi caser le tampon (finding IMPORTANT 2 de la revue finale).
 */
describe("maxTasksForDay", () => {
  it("cas par défaut (480 min dispo, énergie pleine, tampon 10 min) → 7, une de moins qu'avant", () => {
    expect(maxTasksForDay({ availableMin: 480, energyFactor: 1.0, bufferMin: 10 })).toBe(7);
  });

  it("bufferMin: 0 → 8, comportement identique à avant la feature (le cap n'a pas bougé)", () => {
    expect(maxTasksForDay({ availableMin: 480, energyFactor: 1.0, bufferMin: 0 })).toBe(8);
  });

  it("énergie basse (0.6) : le terme temporel devient contraignant, pas le cap", () => {
    // cap(bufferMin=10) = round(8*45/55) = 7 ; terme temps = floor(480*0.6/55) = 5 < 7.
    expect(maxTasksForDay({ availableMin: 480, energyFactor: 0.6, bufferMin: 10 })).toBe(5);
  });

  it("énergie épuisée (0.4) : encore moins de tâches", () => {
    expect(maxTasksForDay({ availableMin: 480, energyFactor: 0.4, bufferMin: 10 })).toBe(3);
  });

  it("un tampon énorme ne fait jamais tomber à 0 : le plancher de 1 tient", () => {
    expect(maxTasksForDay({ availableMin: 480, energyFactor: 1.0, bufferMin: 500 })).toBe(1);
  });

  it("journée très disponible, tampon nul : c'est bien le cap (8) qui devient contraignant", () => {
    // terme temps = floor(1000/45) = 22, largement au-dessus du cap → le cap gagne.
    expect(maxTasksForDay({ availableMin: 1000, energyFactor: 1.0, bufferMin: 0 })).toBe(8);
  });
});
