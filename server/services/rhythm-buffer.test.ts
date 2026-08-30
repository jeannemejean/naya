import { describe, it, expect } from "vitest";
import { nextBufferMin } from "./rhythm-buffer";

const NOW = new Date("2026-08-28T12:00:00Z");
const sig = (signal: string, n: number) => Array.from({ length: n }, () => ({ signal }));

describe("nextBufferMin", () => {
  it("ne bouge pas en dessous de 5 signaux", () => {
    expect(nextBufferMin({ current: 10, signals: sig("felt_overloaded", 4), lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("augmente de 5 quand au moins 60 % des retours disent surchargé", () => {
    const signals = [...sig("felt_overloaded", 3), ...sig("on_track", 2)]; // 60 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(15);
  });

  it("diminue de 5 quand au moins 80 % des retours disent que ça allait", () => {
    const signals = [...sig("on_track", 4), ...sig("tasks_wrong", 1)]; // 80 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(5);
  });

  it("ne bouge pas quand aucun seuil n'est atteint", () => {
    const signals = [...sig("on_track", 3), ...sig("felt_overloaded", 2)]; // 40 % / 60 %
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("compte tasks_wrong dans le total sans pousser dans aucun sens", () => {
    // 3 surchargé sur 6 = 50 %, sous le seuil : les tasks_wrong diluent, c'est voulu.
    const signals = [...sig("felt_overloaded", 3), ...sig("tasks_wrong", 3)];
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: null, now: NOW })).toBe(10);
  });

  it("respecte le verrou hebdomadaire", () => {
    const signals = sig("felt_overloaded", 6);
    const ilYA3Jours = new Date("2026-08-25T12:00:00Z");
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: ilYA3Jours, now: NOW })).toBe(10);
  });

  it("autorise l'ajustement passé 7 jours", () => {
    const signals = sig("felt_overloaded", 6);
    const ilYA8Jours = new Date("2026-08-20T12:00:00Z");
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: ilYA8Jours, now: NOW })).toBe(15);
  });

  it("autorise l'ajustement à exactement 7 jours (le verrou n'est actif que sous 7 jours)", () => {
    const signals = sig("felt_overloaded", 6);
    const ilYAExactement7Jours = new Date("2026-08-21T12:00:00Z");
    expect(nextBufferMin({ current: 10, signals, lastAdjustedAt: ilYAExactement7Jours, now: NOW })).toBe(15);
  });

  it("plafonne à 30", () => {
    expect(nextBufferMin({ current: 30, signals: sig("felt_overloaded", 6), lastAdjustedAt: null, now: NOW })).toBe(30);
  });

  it("plancher à 0", () => {
    expect(nextBufferMin({ current: 0, signals: sig("on_track", 6), lastAdjustedAt: null, now: NOW })).toBe(0);
  });
});
