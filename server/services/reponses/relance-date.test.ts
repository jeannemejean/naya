import { describe, it, expect } from "vitest";
import { detecterRelance, premierJourTravaille } from "./relance-date";

const SEMAINE = new Set(["mon", "tue", "wed", "thu", "fri"]);
// Lundi 9 novembre 2026, 10:00 à Paris.
const REF = new Date("2026-11-09T09:00:00Z");
const lire = (texte: string, o: { reference?: Date; fuseau?: string; jours?: Set<string> } = {}) =>
  detecterRelance(texte, {
    reference: o.reference ?? REF, fuseau: o.fuseau ?? "Europe/Paris", joursTravail: o.jours ?? SEMAINE,
  })?.date ?? null;

describe("detecterRelance — table des formulations", () => {
  const cas: Array<[string, string | null]> = [
    // Années
    ["On se reparle début 2027.", "2027-01-04"],          // 1er janvier férié, 2-3 = week-end
    ["Revenez vers moi en 2027.", "2027-01-04"],
    ["Recontactez-moi courant 2027 !", "2027-01-04"],
    ["Revenez vers moi mi-2027.", "2027-07-01"],
    ["Revenez vers moi fin 2027.", "2027-12-01"],
    ["Get back to me early 2027.", "2027-01-04"],
    ["Let's reconnect in 2027.", "2027-01-04"],
    ["Revenez vers moi l'année prochaine.", "2027-01-04"],
    ["Recontactez-moi début de l'année prochaine.", "2027-01-04"],
    ["Recontactez-moi début d'année prochaine.", "2027-01-04"],
    ["Please reach out next year.", "2027-01-04"],
    ["Revenez vers moi en fin d'année.", "2026-12-01"],
    ["Revenez vers moi début d'année.", "2027-01-04"],
    // Mois
    ["Revenez vers moi en septembre.", "2027-09-01"],
    ["Revenez vers moi début septembre.", "2027-09-01"],
    ["Revenez vers moi mi-janvier.", "2027-01-15"],
    ["Revenez vers moi fin janvier 2027.", "2027-01-20"],
    ["Recontactez-moi en mars prochain.", "2027-03-01"],
    ["Recontactez-moi septembre prochain.", "2027-09-01"],
    ["Pas avant février, désolée.", "2027-02-01"],
    ["Revenez vers moi fin novembre.", "2026-11-20"],
    ["Revenez vers moi en décembre.", "2026-12-01"],
    ["Could you circle back in March?", "2027-03-01"],
    ["Please follow up late January.", "2027-01-20"],
    ["Not before May, sorry.", "2027-05-03"],                // 1er mai 2027 = samedi
    // Dates précises
    ["Rappelez-moi le 15 janvier.", "2027-01-15"],
    ["Recontactez-moi après le 16 janvier 2027.", "2027-01-18"], // samedi → lundi
    ["Get back to me on January 12th.", "2027-01-12"],
    ["Revenez vers moi le 15/02.", "2027-02-15"],
    ["Rappelez-moi après le 14 janvier.", "2027-01-15"],     // « après » : le lendemain
    ["Get back to me after January 14.", "2027-01-15"],
    // Numériques douteux → rien
    ["Revenez vers moi dans 2/3 semaines.", null],          // une fraction de durée, pas le 2 mars
    ["Revenez vers moi dans 2/3 mois.", null],
    ["Let's talk after 1/15.", null],                       // anglais : mois/jour
    ["Reach out around 3/14.", null],
    ["Revenez vers moi le 05/02.", null],                   // 5 février ou 2 mai ?
    ["Revenez vers moi le 15/13.", null],                   // pas de 13e mois
    ["Revenez vers moi le 31/02.", null],
    // Durées
    ["Revenez vers moi dans 3 mois.", "2027-02-09"],
    ["Recontactez-moi d'ici six semaines.", "2026-12-21"],
    ["Revenez vers moi dans un mois.", "2026-12-09"],
    ["Reach out in two weeks.", "2026-11-23"],
    ["Try me again in 6 months.", "2027-05-10"],              // 9 mai 2027 = dimanche
    ["Revenez vers moi dans un an.", "2027-11-09"],
    // Périodes
    ["Revenez vers moi après les fêtes.", "2027-01-04"],
    ["Let's talk after the holidays.", "2027-01-04"],
    ["On en reparle à la rentrée.", "2027-09-01"],
    ["Revenez vers moi après l'été.", "2027-09-01"],
    ["Recontactez-moi au printemps.", "2027-04-01"],
    ["Revenez vers moi cet été.", "2027-07-01"],
    ["Reach out in the fall.", "2027-10-01"],
    ["Revenez vers moi la semaine prochaine.", "2026-11-16"],
    ["Revenez vers moi le mois prochain.", "2026-12-01"],
    ["Recontactez-moi au T1 2027.", "2027-01-04"],
    ["Revenez vers moi au prochain trimestre.", "2027-01-04"],
    ["Let's touch base in Q2.", "2027-04-01"],
    ["Revenez vers moi au T4.", null],                      // dit en plein T4 : ce trimestre ou l'an prochain ?
    ["Let's reconnect in Q4.", null],
    ["Revenez vers moi au T1.", "2027-01-04"],
    // Intention dans la phrase voisine
    ["Ce n'est pas le moment pour nous. Plutôt en septembre.", "2027-09-01"],
    ["Début 2027. Revenez vers moi à ce moment-là.", "2027-01-04"],
    // Rien : pas d'intention, vague, ambigu, passé
    ["Merci, nous avons lancé en septembre.", null],
    ["Ça a été un plaisir. Bonne journée.", null],
    ["Revenez vers moi dans quelques mois.", null],
    ["Reach out in a few weeks.", null],
    ["Revenez vers moi avant septembre.", null],
    ["Revenez vers moi en septembre ou en octobre.", null],
    ["Revenez vers moi en novembre.", null],                // mois en cours déjà entamé
    ["Revenez vers moi en 2025.", null],
    ["Revenez vers moi en 2026.", null],
    ["Revenez vers moi en 2031.", null],                    // au-delà de 3 ans
    ["Revenez vers moi plus tard.", null],
    ["Ça a été un plaisir, revenez vers moi en septembre.", "2027-09-01"],
    ["Revenez vers moi dans sept mois.", "2027-06-09"],
    ["Je reviendrai vers vous si besoin.", null],
    ["", null],
  ];
  it.each(cas)("%s → %s", (texte, attendu) => {
    expect(lire(texte)).toBe(attendu);
  });
});

describe("detecterRelance — fuseau, jours travaillés, extrait", () => {
  it("le jour de référence se lit dans le fuseau de l'utilisatrice", () => {
    // 31 décembre 2026, 23:30 UTC = déjà le 1er janvier 2027 à Paris, encore le 31 à New York.
    const ref = new Date("2026-12-31T23:30:00Z");
    expect(lire("Revenez vers moi dans 2 jours.", { reference: ref, fuseau: "Europe/Paris" })).toBe("2027-01-04"); // 3 janv. = dimanche
    expect(lire("Revenez vers moi dans 2 jours.", { reference: ref, fuseau: "America/New_York" })).toBe("2027-01-04"); // 2 janv. = samedi
    expect(lire("Revenez vers moi dans 1 jour.", { reference: ref, fuseau: "America/New_York" })).toBe("2027-01-04"); // 1er janv. férié
    // Fuseau invalide : repli UTC, pas d'erreur.
    expect(lire("Revenez vers moi en septembre.", { fuseau: "Pas/Un_Fuseau" })).toBe("2027-09-01");
  });

  it("respecte les jours travaillés de l'utilisatrice", () => {
    const mardiJeudi = new Set(["tue", "thu"]);
    expect(lire("Revenez vers moi en septembre.", { jours: mardiJeudi })).toBe("2027-09-02"); // 1er sept. 2027 = mercredi
    expect(lire("Revenez vers moi en septembre.", { jours: new Set() })).toBeNull();
    expect(premierJourTravaille("2027-01-01", SEMAINE)).toBe("2027-01-01".replace("01-01", "01-04"));
  });

  it("rend la phrase du prospect, pour la citer", () => {
    const r = detecterRelance("Merci pour votre message.\nOn se reparle début 2027,   là on est\tsous l'eau.", {
      reference: REF, fuseau: "Europe/Paris", joursTravail: SEMAINE,
    });
    expect(r).toEqual({ date: "2027-01-04", extrait: "On se reparle début 2027, là on est sous l'eau." });
  });
});
