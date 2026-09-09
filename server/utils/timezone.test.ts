import { describe, it, expect } from "vitest";
import { parisWallClockToInstant, parisDayBoundsUTC, parisHourOf, parisTodayString, localWallClock, wallClockToInstant } from "./timezone";

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

// ─────────────────────────────────────────────────────────────────────────
// Round 2 : `computeTaskPromptInsight` (server/routes.ts) faisait
// `p.scheduledFor.getHours()` et `sharedFormatDate(now)` — tous deux lisent l'heure/le
// jour du PROCESS (UTC en prod), pas celui de Paris. Même défaut que ci-dessus, sens
// inverse (extraire une heure murale depuis un instant, plutôt que l'inverse).
// ─────────────────────────────────────────────────────────────────────────

describe("parisHourOf — l'heure murale de Paris d'un instant (jamais celle du process)", () => {
  it("12:05 UTC un 15 juillet (été, UTC+2) est 14h à Paris — pas 12h", () => {
    // C'est exactement l'instant que produit parisWallClockToInstant("2026-07-15","14:05").
    const instant = parisWallClockToInstant("2026-07-15", "14:05");
    expect(parisHourOf(instant)).toBe(14);
  });

  it("13:05 UTC un 15 janvier (hiver, UTC+1) est 14h à Paris", () => {
    const instant = parisWallClockToInstant("2026-01-15", "14:05");
    expect(parisHourOf(instant)).toBe(14);
  });

  it("minuit à Paris → heure 0, jamais 24 (le cas hour12:false)", () => {
    const instant = parisWallClockToInstant("2026-01-15", "00:00");
    expect(parisHourOf(instant)).toBe(0);
  });

  it("23h à Paris reste 23, ne bascule pas sur le jour du process", () => {
    const instant = parisWallClockToInstant("2026-07-15", "23:30");
    expect(parisHourOf(instant)).toBe(23);
  });

  it("RÉGRESSION — la classification matin/après-midi de buildImmediateInsight (seuil MIDI=13, voir insight.ts) doit se faire sur l'heure de Paris : une alarme à 14:05 Paris est un après-midi", () => {
    const MIDI = 13; // seuil documenté dans server/services/result-capture/insight.ts
    const scheduledFor = parisWallClockToInstant("2026-07-15", "14:05"); // 12:05 UTC
    // Avec l'ancien code (`scheduledFor.getHours()` sous TZ=UTC, le fuseau de prod),
    // cette même alarme lirait 12h et basculerait à tort en "matin" — reproduit et
    // vérifié séparément sous `TZ=UTC node -e ...` avant ce correctif (voir rapport).
    expect(parisHourOf(scheduledFor) >= MIDI).toBe(true);
  });
});

describe("parisTodayString — le jour calendaire de Paris (jamais celui du process)", () => {
  it("23:30 UTC un 15 janvier (hiver, UTC+1) = 00:30 le 16 à Paris → \"aujourd'hui\" est déjà le 16", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");
    expect(parisTodayString(now)).toBe("2026-01-16");
  });

  it("22:30 UTC un 15 janvier = 23:30 à Paris, encore le 15", () => {
    const now = new Date("2026-01-15T22:30:00.000Z");
    expect(parisTodayString(now)).toBe("2026-01-15");
  });

  it("22:30 UTC un 15 juillet (été, UTC+2) = 00:30 le 16 à Paris → déjà le 16", () => {
    const now = new Date("2026-07-15T22:30:00.000Z");
    expect(parisTodayString(now)).toBe("2026-07-16");
  });

  it("21:30 UTC un 15 juillet = 23:30 à Paris, encore le 15", () => {
    const now = new Date("2026-07-15T21:30:00.000Z");
    expect(parisTodayString(now)).toBe("2026-07-15");
  });

  it("RÉGRESSION — démontre le bug de la route today : à 23:30 UTC, le jour calendaire UTC et le jour calendaire de Paris diffèrent", () => {
    const now = new Date("2026-01-15T23:30:00.000Z");
    // Équivalent de l'ancien `sharedFormatDate(now)` SI le process tournait en UTC
    // (c'est le cas en prod) : `getFullYear/getMonth/getDate` sous TZ=UTC donnent la
    // même chose que `toISOString().slice(0,10)`, sans dépendre du fuseau du runner.
    const utcCalendarDay = now.toISOString().slice(0, 10);
    expect(utcCalendarDay).toBe("2026-01-15");
    expect(parisTodayString(now)).toBe("2026-01-16");
    expect(parisTodayString(now)).not.toBe(utcCalendarDay);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Round 3 : défaut Critique remonté en revue. `parisWallClockToInstant` échantillonnait
// le décalage Europe/Paris UNE SEULE FOIS, à `candidateUTC` (l'heure murale traitée
// comme si elle était déjà en UTC) — jamais à l'instant réel corrigé. Ça casse en
// silence pour toute heure murale dans [01:00, 02:00) les jours de transition : une
// heure qui EXISTE et n'est PAS ambiguë (contrairement à ce que le commentaire
// d'origine, ligne 60-63, laissait entendre en ne parlant que du trou).
//
// La bonne assertion est l'ALLER-RETOUR : reformater l'instant produit en heure de
// Paris doit redonner l'heure murale demandée. Une valeur UTC écrite à la main (comme
// dans les blocs ci-dessus, à 03:30 — hors zone dangereuse) ne l'aurait pas détecté.
// `parisWallClockOf` ci-dessous est un reformatage indépendant de l'implémentation
// testée : il n'appelle ni `parisWallClockToInstant` ni `parisHourOf`.
// ─────────────────────────────────────────────────────────────────────────

function parisWallClockOf(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const byType: Record<string, string> = {};
  for (const p of parts) byType[p.type] = p.value;
  return `${byType.hour}:${byType.minute}`;
}

describe("parisWallClockToInstant — zone dangereuse [01:00, 02:00) les jours de transition DST", () => {
  const SPRING = ["2025-03-30", "2026-03-29"]; // passage à l'heure d'été, transition à 01:00 UTC
  const FALL = ["2025-10-26", "2026-10-25"]; // retour à l'heure d'hiver, transition à 01:00 UTC

  for (const day of [...SPRING, ...FALL]) {
    it(`${day} 01:30 — aller-retour : reformater le résultat en heure de Paris redonne 01:30`, () => {
      const got = parisWallClockToInstant(day, "01:30");
      expect(parisWallClockOf(got)).toBe("01:30");
    });

    it(`${day} 00:30 — borne juste AVANT la zone dangereuse, aller-retour`, () => {
      const got = parisWallClockToInstant(day, "00:30");
      expect(parisWallClockOf(got)).toBe("00:30");
    });

    it(`${day} 01:59 — borne juste à la fin de la zone dangereuse, aller-retour`, () => {
      const got = parisWallClockToInstant(day, "01:59");
      expect(parisWallClockOf(got)).toBe("01:59");
    });
  }

  // Valeurs UTC explicites pour 01:30, dérivées indépendamment (décalage de la veille,
  // bien avant toute transition, jamais ambigu) — ceinture-et-bretelles en plus de
  // l'aller-retour ci-dessus.
  it("2026-03-29 01:30 (été à venir, CET encore) → 2026-03-29T00:30:00.000Z", () => {
    expect(parisWallClockToInstant("2026-03-29", "01:30").toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });

  it("2026-10-25 01:30 (hiver à venir, CEST encore) → 2026-10-24T23:30:00.000Z", () => {
    expect(parisWallClockToInstant("2026-10-25", "01:30").toISOString()).toBe("2026-10-24T23:30:00.000Z");
  });
});

describe("parisWallClockToInstant — comportement figé pour l'heure AMBIGUË (retour à l'heure d'hiver, 02:00-02:59, existe deux fois)", () => {
  // Ce cas n'a PAS de réponse unique correcte : 02:30 Paris le jour du retour à l'heure
  // d'hiver désigne deux instants réels (une fois en CEST, une fois en CET, une heure
  // plus tard). La fonction résout de façon déterministe vers la SECONDE occurrence
  // (celle après le rétropassage, en CET) — ce test fige ce choix pour qu'un futur
  // changement d'algorithme soit visible plutôt que silencieux.
  it("2026-10-25 02:30 → résout vers la 2e occurrence (CET, après le rétropassage) : 2026-10-25T01:30:00.000Z", () => {
    const got = parisWallClockToInstant("2026-10-25", "02:30");
    expect(got.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    // Vérifie explicitement le régime : offset +1h (CET), pas +2h (CEST) — la 2e passe.
    expect(parisWallClockOf(got)).toBe("02:30"); // l'aller-retour tient aussi pour ce choix
  });

  it("2025-10-26 02:30 → même choix déterministe (2e occurrence) une autre année", () => {
    const got = parisWallClockToInstant("2025-10-26", "02:30");
    expect(got.toISOString()).toBe("2025-10-26T01:30:00.000Z");
  });
});

describe("parisWallClockToInstant — comportement figé pour l'heure INEXISTANTE (passage à l'heure d'été, 02:00-02:59, n'existe jamais)", () => {
  // 02:30 Paris le jour du passage à l'heure d'été n'existe pas (les horloges sautent de
  // 02:00 à 03:00). La fonction résout de façon déterministe comme si le trou d'une
  // heure était traversé tel quel : le résultat reformate en heure de Paris à l'heure
  // demandée + la taille du trou (1h). Ce test fige ce choix.
  it("2026-03-29 02:30 (n'existe pas) → se comporte comme 03:30 (heure demandée + 1h de trou)", () => {
    const got = parisWallClockToInstant("2026-03-29", "02:30");
    expect(got.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(parisWallClockOf(got)).toBe("03:30"); // PAS 02:30 — cette heure n'existe pas
  });

  it("2025-03-30 02:30 (n'existe pas) → même choix déterministe une autre année", () => {
    const got = parisWallClockToInstant("2025-03-30", "02:30");
    expect(parisWallClockOf(got)).toBe("03:30");
  });
});

describe("localWallClock — heure murale + jour de semaine dans un fuseau IANA arbitraire (jamais celui du process)", () => {
  it("Europe/Paris, été (UTC+2) : 12:05 UTC un mercredi → 14:05 murale, jour 'wed'", () => {
    const instant = new Date("2026-07-15T12:05:00.000Z");
    expect(localWallClock("Europe/Paris", instant)).toEqual({ minuteOfDay: 14 * 60 + 5, dayAbbr: "wed" });
  });

  it("Europe/Paris, hiver (UTC+1) : 13:05 UTC un jeudi → 14:05 murale, jour 'thu'", () => {
    const instant = new Date("2026-01-15T13:05:00.000Z");
    expect(localWallClock("Europe/Paris", instant)).toEqual({ minuteOfDay: 14 * 60 + 5, dayAbbr: "thu" });
  });

  it("UTC : l'heure murale est l'heure UTC telle quelle", () => {
    const instant = new Date("2026-08-30T09:15:00.000Z"); // dimanche
    expect(localWallClock("UTC", instant)).toEqual({ minuteOfDay: 9 * 60 + 15, dayAbbr: "sun" });
  });

  it("minuit murale → minuteOfDay 0, jamais 24 (même piège hour12 que parisHourOf)", () => {
    // 23:00 UTC un mercredi de janvier = 00:00 Paris le jeudi (UTC+1).
    const instant = new Date("2026-01-14T23:00:00.000Z");
    expect(localWallClock("Europe/Paris", instant)).toEqual({ minuteOfDay: 0, dayAbbr: "thu" });
  });

  it("indépendant du fuseau du process qui exécute le test : le fuseau vient uniquement du paramètre", () => {
    // Ce test tourne aussi bien sous TZ=UTC (CI) que TZ=Europe/Paris (poste local) —
    // le résultat ne doit varier qu'avec le paramètre `timeZone`, jamais avec l'env du runner.
    const instant = new Date("2026-07-15T12:05:00.000Z");
    expect(localWallClock("Europe/Paris", instant).dayAbbr).toBe("wed");
    expect(localWallClock("UTC", instant).dayAbbr).toBe("wed");
    expect(localWallClock("UTC", instant).minuteOfDay).toBe(12 * 60 + 5);
  });
});

describe("wallClockToInstant", () => {
  it("convertit une heure murale de New York en heure d'été", () => {
    // 2026-07-15 09:00 EDT = UTC-4 → 13:00 UTC
    expect(wallClockToInstant("America/New_York", "2026-07-15", "09:00").toISOString())
      .toBe("2026-07-15T13:00:00.000Z");
  });

  it("convertit une heure murale de New York en heure d'hiver", () => {
    // 2026-01-15 09:00 EST = UTC-5 → 14:00 UTC
    expect(wallClockToInstant("America/New_York", "2026-01-15", "09:00").toISOString())
      .toBe("2026-01-15T14:00:00.000Z");
  });

  it("gère un décalage à la demi-heure", () => {
    // Asia/Kolkata = UTC+5:30, pas de changement d'heure
    expect(wallClockToInstant("Asia/Kolkata", "2026-07-15", "09:00").toISOString())
      .toBe("2026-07-15T03:30:00.000Z");
  });

  it("gère minuit sans produire 24 h", () => {
    expect(wallClockToInstant("Asia/Hong_Kong", "2026-07-15", "00:00").toISOString())
      .toBe("2026-07-14T16:00:00.000Z");
  });

  it("reste correct dans la zone dangereuse d'une bascule non européenne", () => {
    // Bascule US le 2026-11-01 à 02:00 locale. 01:30 existe et n'est pas ambiguë
    // côté algorithme : l'aller-retour doit redonner l'heure demandée.
    const instant = wallClockToInstant("America/New_York", "2026-11-01", "01:30");
    const relu = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(instant);
    expect(relu).toBe("01:30");
  });
});
