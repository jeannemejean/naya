import { describe, it, expect } from "vitest";
import { parisWallClockToInstant, parisDayBoundsUTC } from "./timezone";

// Le process de prod tourne en UTC (pas de TZ configuré, pas de Dockerfile, pas de
// railway.toml). `scheduledEndTime` est une heure murale de Paris ("HH:MM"), donc toute
// conversion en instant DOIT passer par une conversion explicite Europe/Paris → UTC —
// jamais par `new Date(`${date}T${time}:00`)`, qui interprète l'heure murale dans le
// fuseau du PROCESS, pas celui de Paris.
//
// Ces tests ne doivent dépendre EN RIEN du fuseau de la machine qui les exécute : toutes
// les valeurs attendues sont des instants UTC explicites ("...Z"), jamais des `new
// Date("...")` sans suffixe Z (qui seraient, eux, interprétés dans le fuseau local du
// runner — exactement le bug qu'on vérifie ici).

describe("parisWallClockToInstant", () => {
  it("heure d'été (CEST, UTC+2) : 14:00 Paris un 15 juillet → 12:00 UTC", () => {
    const got = parisWallClockToInstant("2026-07-15", "14:00");
    expect(got.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("heure d'hiver (CET, UTC+1) : 14:00 Paris un 15 janvier → 13:00 UTC", () => {
    const got = parisWallClockToInstant("2026-01-15", "14:00");
    expect(got.toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("minuit en hiver — le cas qui casse avec hour12:false (ICU peut rendre « 24 »)", () => {
    const got = parisWallClockToInstant("2026-01-15", "00:00");
    expect(got.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("minuit en été", () => {
    const got = parisWallClockToInstant("2026-07-15", "00:00");
    expect(got.toISOString()).toBe("2026-07-14T22:00:00.000Z");
  });

  it("juste après le passage à l'heure d'été (2026-03-29, transition à 01:00 UTC) : déjà en CEST", () => {
    // Le dimanche 29 mars 2026 à 02:00 CET, les horloges de Paris avancent à 03:00 CEST.
    // 03:30 murale ce jour-là est donc déjà en CEST (UTC+2) → 01:30 UTC.
    const got = parisWallClockToInstant("2026-03-29", "03:30");
    expect(got.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("juste après le retour à l'heure d'hiver (2026-10-25, transition à 01:00 UTC) : déjà en CET", () => {
    // Le dimanche 25 octobre 2026 à 03:00 CEST, les horloges de Paris reculent à 02:00 CET.
    // 03:30 murale ce jour-là est sans ambiguïté déjà en CET (UTC+1) → 02:30 UTC.
    const got = parisWallClockToInstant("2026-10-25", "03:30");
    expect(got.toISOString()).toBe("2026-10-25T02:30:00.000Z");
  });

  it("reste correct autour du nouvel an (changement d'année)", () => {
    const got = parisWallClockToInstant("2026-01-01", "00:30");
    expect(got.toISOString()).toBe("2025-12-31T23:30:00.000Z");
  });
});

describe("parisDayBoundsUTC — la fenêtre d'une journée murale de Paris, en instants UTC", () => {
  it("hiver : bornes [00:00 Paris, 00:00 Paris du lendemain[ converties en UTC (UTC+1)", () => {
    const { start, end } = parisDayBoundsUTC("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-15T23:00:00.000Z");
  });

  it("été : bornes converties en UTC (UTC+2)", () => {
    const { start, end } = parisDayBoundsUTC("2026-07-15");
    expect(start.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-15T22:00:00.000Z");
  });

  it("la borne de fin est exclusive et vaut le début du jour suivant — pas de tâche à 23:59:59.999 comptée dans le mauvais fuseau", () => {
    const { end } = parisDayBoundsUTC("2026-01-15");
    const nextDayStart = parisWallClockToInstant("2026-01-16", "00:00");
    expect(end.getTime()).toBe(nextDayStart.getTime());
  });
});
