import { describe, it, expect } from "vitest";
import { placerElements, type Calendrier } from "./placement";

/** Un calendrier jouet : des minutes libres et un nombre de places par jour. */
function calendrier(jours: Record<string, { minutes: number; places: number }>): Calendrier & { journal: string[] } {
  const etat = Object.fromEntries(Object.entries(jours).map(([j, v]) => [j, { ...v }]));
  const journal: string[] = [];
  return {
    journal,
    jours: Object.keys(jours).sort(),
    aDeLaPlace: (j, duree) => (etat[j]?.minutes ?? 0) >= duree,
    placesRestantes: (j) => etat[j]?.places ?? 0,
    async reserver(j, duree) {
      if (etat[j]) etat[j].minutes -= duree;
      journal.push(j);
      return "09:00";
    },
  };
}

describe("placerElements", () => {
  it("la tâche dont l'échéance est la plus proche passe d'abord, avant son échéance", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 60, places: 1 }, "2026-10-28": { minutes: 60, places: 1 } });
    const r = await placerElements([
      { cle: "sans", duree: 60, priorite: 1 },
      { cle: "urgente", duree: 60, priorite: 3, jourMax: "2026-10-27" },
    ], cal);
    expect(r.get("urgente")!.jour).toBe("2026-10-27");
    expect(r.get("sans")!.jour).toBe("2026-10-28");
  });

  it("une journée pleine en nombre de tâches est sautée", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 480, places: 0 }, "2026-10-28": { minutes: 480, places: 3 } });
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 2 }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-28");
  });

  it("une tâche reprise reste dans la semaine qui vient s'il y a un trou, même si les journées sont chargées (essai du 26 oct.)", async () => {
    const jours: Record<string, { minutes: number; places: number }> = {};
    for (const j of ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"]) jours[j] = { minutes: 120, places: 0 };
    jours["2026-11-06"] = { minutes: 480, places: 4 };
    const r = await placerElements([{ cle: "a", duree: 45, priorite: 2 }], calendrier(jours));
    expect(r.get("a")!.jour).toBe("2026-10-27");
  });

  it("pour tenir une échéance, un trou suffit même si la journée est chargée", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 60, places: 0 }, "2026-10-28": { minutes: 480, places: 5 } });
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 2, jourMax: "2026-10-27" }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-27");
  });

  it("les sous-tâches d'une tâche découpée se suivent", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 30, places: 5 }, "2026-10-28": { minutes: 480, places: 5 } });
    const r = await placerElements([
      { cle: "n:1:1", duree: 20, priorite: 2, apres: "n:1:0" },
      { cle: "n:1:0", duree: 60, priorite: 2 },
    ], cal);
    expect(r.get("n:1:0")!.jour).toBe("2026-10-28");
    // La première ne tenait pas le 27 : la suivante ne passe pas avant elle.
    expect(r.get("n:1:1")!.jour).toBe("2026-10-28");
  });

  it("le jour imposé (atelier) est tenu, même plein, et réservé en premier", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 0, places: 0 }, "2026-10-28": { minutes: 480, places: 5 } });
    const r = await placerElements([
      { cle: "libre", duree: 30, priorite: 1 },
      { cle: "atelier", duree: 90, priorite: 1, jourExact: "2026-10-27" },
    ], cal);
    expect(r.get("atelier")!.jour).toBe("2026-10-27");
    expect(cal.journal[0]).toBe("2026-10-27");
  });

  it("un jour refusé à la vérification (rendez-vous, fin de journée) laisse la place au suivant", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 480, places: 5 }, "2026-10-28": { minutes: 480, places: 5 } });
    const reserver = cal.reserver;
    cal.reserver = async (j, d, forcer) => (j === "2026-10-27" && !forcer ? null : reserver(j, d, forcer));
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 1 }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-28");
  });

  it("tous les jours refusés : le premier, forcé", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 480, places: 5 }, "2026-10-28": { minutes: 480, places: 5 } });
    const reserver = cal.reserver;
    cal.reserver = async (j, d, forcer) => (forcer ? reserver(j, d, forcer) : null);
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 1 }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-27");
  });

  it("jamais avant jourMin", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 480, places: 5 }, "2026-10-28": { minutes: 480, places: 5 } });
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 1, jourMin: "2026-10-28" }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-28");
  });

  it("aucune place nulle part : au plus tôt, le re-tassage fera déborder", async () => {
    const cal = calendrier({ "2026-10-27": { minutes: 0, places: 0 }, "2026-10-28": { minutes: 0, places: 0 } });
    const r = await placerElements([{ cle: "a", duree: 30, priorite: 1 }], cal);
    expect(r.get("a")!.jour).toBe("2026-10-27");
  });
});
