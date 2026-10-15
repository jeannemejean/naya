// La grille de placement doit voir les TROUS d'une journée, pas seulement la fin de sa
// dernière tâche. Constaté le 15 oct. 2026 : le 21 octobre, libre de 9 h à 15 h 20 mais avec
// une tâche finissant à 17 h 45, était jugé « plein » pour une heure d'atelier — l'atelier de
// la semaine du 26 octobre est parti… au 16 octobre, et un autre à 18 h 11.
import { describe, it, expect } from "vitest";
import { grilleCreneaux } from "./placement";

const prefs = { workDayStart: "09:00", workDayEnd: "18:00", lunchBreakStart: "12:00", lunchBreakEnd: "13:00" };
const t = (heure: string, duree: number, jour = "2026-10-21") => ({ scheduledDate: jour, scheduledTime: heure, estimatedDuration: duree });

describe("grilleCreneaux — les trous d'une journée", () => {
  it("une journée libre le matin mais occupée tard a de la place, et le créneau donné est le premier trou", () => {
    const g = grilleCreneaux(prefs, [t("15:20", 90), t("17:00", 45)]);
    expect(g.aDeLaPlace("2026-10-21", 60)).toBe(true);
    expect(g.attribuer("2026-10-21", 60)).toBe("09:00");
  });

  it("deux attributions de suite ne se chevauchent pas (tampon de 15 min)", () => {
    const g = grilleCreneaux(prefs, []);
    expect(g.attribuer("2026-10-21", 60)).toBe("09:00");
    expect(g.attribuer("2026-10-21", 30)).toBe("10:15");
  });

  it("un trou trop petit est sauté, la pause déjeuner aussi", () => {
    const g = grilleCreneaux(prefs, [t("09:00", 120), t("11:30", 30)]);
    // 11:15–11:30 trop court ; 12:00–13:00 déjeuner ; premier trou d'une heure : 13:00
    expect(g.attribuer("2026-10-21", 60)).toBe("13:00");
  });

  it("un créneau qui chevaucherait une tâche existante n'est jamais donné", () => {
    const g = grilleCreneaux(prefs, [t("09:30", 30)]);
    expect(g.attribuer("2026-10-21", 45)).toBe("10:15");
  });

  it("journée réellement pleine : pas de place", () => {
    const g = grilleCreneaux(prefs, [t("09:00", 165), t("13:00", 285)]);
    expect(g.aDeLaPlace("2026-10-21", 30)).toBe(false);
  });

  it("occuper (publication fixe) et caler (heure réelle écrite) bloquent leur plage, où qu'elle soit", () => {
    const g = grilleCreneaux(prefs, []);
    g.occuper("2026-10-21", "09:00", 15);
    g.caler("2026-10-21", "09:30", 60);
    expect(g.attribuer("2026-10-21", 30)).toBe("10:45");
  });

  it("une plage calée tard dans la journée ne bloque pas le matin", () => {
    const g = grilleCreneaux(prefs, []);
    g.caler("2026-10-21", "16:00", 30);
    expect(g.attribuer("2026-10-21", 60)).toBe("09:00");
    expect(g.attribuer("2026-10-21", 60)).toBe("10:15");
  });

  it("une heure refusée par la base reste réservée : la tâche suivante ne retombe pas dessus", () => {
    const g = grilleCreneaux(prefs, []);
    expect(g.attribuer("2026-10-21", 90)).toBe("09:00"); // la base dit : pris, prends 10:30
    g.caler("2026-10-21", "10:30", 90);
    expect(g.attribuer("2026-10-21", 30)).toBe("13:00");
  });
});
