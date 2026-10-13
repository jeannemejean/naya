import { describe, it, expect } from "vitest";
import { heurePublicationLibre, peutDeplacerPublication } from "./publication-libre";

const min = (h: number, m = 0) => h * 60 + m;

describe("heurePublicationLibre — « Publier » ne se pose jamais sur un rendez-vous ou une tâche terminée", () => {
  it("créneau libre : inchangé", () => {
    expect(heurePublicationLibre({ debut: min(11), duree: 15, occupes: [{ start: min(9), end: min(10) }] })).toBe(min(11));
  });
  it("le cas du 13 octobre : Publier 11:00 sur « serrure » 10:00–11:30 → 11:30", () => {
    expect(heurePublicationLibre({ debut: min(11), duree: 15, occupes: [{ start: min(10), end: min(11, 30) }] })).toBe(min(11, 30));
  });
  it("enchaîne les blocs qui se suivent", () => {
    expect(heurePublicationLibre({
      debut: min(11), duree: 15,
      occupes: [{ start: min(10), end: min(11, 30) }, { start: min(11, 30), end: min(12) }, { start: min(12, 15), end: min(13) }],
    })).toBe(min(12));
  });
  it("aucune place avant minuit : null (on ne change pas de jour)", () => {
    expect(heurePublicationLibre({ debut: min(23, 30), duree: 15, occupes: [{ start: min(23), end: min(24) }] })).toBeNull();
  });
});

describe("peutDeplacerPublication", () => {
  const maintenant = { jour: "2026-10-13", minute: min(9) };
  it("post à venir, pas encore parti : oui", () => {
    expect(peutDeplacerPublication({ publishedAt: null, postStatus: "pending" }, "2026-10-13", min(11), maintenant)).toBe(true);
  });
  it("post publié ou en cours de publication : jamais", () => {
    expect(peutDeplacerPublication({ publishedAt: new Date(), postStatus: "posted" }, "2026-10-13", min(11), maintenant)).toBe(false);
    for (const st of ["posting", "uploading", "processing"]) {
      expect(peutDeplacerPublication({ publishedAt: null, postStatus: st }, "2026-10-13", min(11), maintenant)).toBe(false);
    }
  });
  it("créneau passé : on ne réécrit pas l'histoire", () => {
    expect(peutDeplacerPublication({ publishedAt: null, postStatus: "pending" }, "2026-10-12", min(11), maintenant)).toBe(false);
    expect(peutDeplacerPublication({ publishedAt: null, postStatus: "pending" }, "2026-10-13", min(8), maintenant)).toBe(false);
  });
});

import { chevauchements } from "./publication-libre";
describe("chevauchements — ce qui resterait après le re-tassage (surveillance)", () => {
  it("trouve les paires qui se recouvrent le même jour, ignore les tâches sans heure", () => {
    const r = chevauchements([
      { id: 717, scheduledDate: "2026-10-13", scheduledTime: "16:45", estimatedDuration: 60 },
      { id: 718, scheduledDate: "2026-10-13", scheduledTime: "17:25", estimatedDuration: 15 },
      { id: 900, scheduledDate: "2026-10-14", scheduledTime: "17:25", estimatedDuration: 15 },
      { id: 901, scheduledDate: "2026-10-13", scheduledTime: null, estimatedDuration: 15 },
      { id: 902, scheduledDate: "2026-10-13", scheduledTime: "17:45", estimatedDuration: 15 },
    ]);
    expect(r).toEqual([{ jour: "2026-10-13", a: 717, b: 718 }]);
  });
});
