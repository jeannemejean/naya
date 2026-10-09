import { describe, it, expect } from "vitest";
import { joursEtapesEnOrdre, rangEtape } from "./production";

// Semaine d'octobre 2026 : le 10 et le 11 sont un samedi et un dimanche.
const travaille = (d: string) => !["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"].includes(d);
const image = { postFormat: "feed_image", title: "Coulisses" };
const carrousel = { postFormat: "carousel", title: "Sélection" };
const t = (id: number, cle: string, date: string | null, completed = false) =>
  ({ id, title: `${cle} — Coulisses`, scheduledDate: date, completed });

describe("rangEtape", () => {
  it("suit l'ordre de production du format", () => {
    expect(rangEtape(image, "Rédiger le texte — X")).toBe(0);
    expect(rangEtape(image, "Préparer le visuel — X")).toBe(1);
    expect(rangEtape(image, "Relire et valider le post — X")).toBe(2);
    expect(rangEtape(image, "Publier — X")).toBe(3);
    expect(rangEtape(carrousel, "Designer les slides — X")).toBe(2);
    expect(rangEtape(image, "Faire la compta")).toBe(-1);
  });
});

describe("joursEtapesEnOrdre — le cas constaté en prod le 9 oct.", () => {
  // Post le mercredi 14 : Relire le 9, Rédiger le 12, Visuel le 14 (après la publication).
  const r = joursEtapesEnOrdre({
    post: image,
    jourPost: "2026-10-14",
    aujourdhui: "2026-10-09",
    estTravaille: travaille,
    etapes: [
      t(808, "Relire et valider le post", "2026-10-09"),
      t(806, "Rédiger le texte", "2026-10-12"),
      t(807, "Préparer le visuel", "2026-10-14"),
      t(809, "Publier", "2026-10-14"),
    ],
  });
  it("garde Rédiger où il est (admissible)", () => expect(r.has(806)).toBe(false));
  it("ramène le visuel à la veille du post", () => expect(r.get(807)).toBe("2026-10-13"));
  it("met Relire après le visuel, la veille", () => expect(r.get(808)).toBe("2026-10-13"));
  it("ne touche pas à Publier, déjà le jour du post", () => expect(r.has(809)).toBe(false));
});

describe("joursEtapesEnOrdre — propriétés", () => {
  const verifier = (etapes: ReturnType<typeof t>[], jourPost: string, aujourdhui: string) => {
    const r = joursEtapesEnOrdre({ post: image, etapes, jourPost, aujourdhui, estTravaille: travaille });
    const jour = (e: ReturnType<typeof t>) => r.get(e.id) ?? e.scheduledDate!;
    const prep = etapes.filter((e) => !e.completed && !e.title.startsWith("Publier"))
      .sort((a, b) => rangEtape(image, a.title) - rangEtape(image, b.title));
    for (let i = 1; i < prep.length; i++) expect(jour(prep[i]) >= jour(prep[i - 1])).toBe(true);
    for (const e of prep) {
      expect(jour(e) >= aujourdhui).toBe(true);
      expect(jour(e) < jourPost || jourPost <= aujourdhui).toBe(true);
      expect(travaille(jour(e))).toBe(true);
    }
    return r;
  };

  it("une étape en retard revient à aujourd'hui, les suivantes après elle", () => {
    verifier([t(1, "Rédiger le texte", "2026-10-05"), t(2, "Préparer le visuel", "2026-10-06"), t(3, "Relire et valider le post", "2026-10-07")], "2026-10-14", "2026-10-09");
  });
  it("n'utilise jamais un week-end : veille du lundi = vendredi", () => {
    const r = verifier([t(1, "Rédiger le texte", "2026-10-12"), t(2, "Préparer le visuel", "2026-10-12")], "2026-10-12", "2026-10-08");
    expect(r.get(1)).toBe("2026-10-09");
    expect(r.get(2)).toBe("2026-10-09");
  });
  it("le jour du post, s'il n'y a plus de veille : tout le jour même", () => {
    const r = verifier([t(1, "Rédiger le texte", "2026-10-08"), t(2, "Relire et valider le post", "2026-10-08")], "2026-10-09", "2026-10-09");
    expect(r.get(1)).toBe("2026-10-09");
    expect(r.get(2)).toBe("2026-10-09");
  });
  it("une étape faite ne contraint pas les suivantes", () => {
    const r = verifier([t(1, "Rédiger le texte", "2026-10-13", true), t(2, "Préparer le visuel", "2026-10-12")], "2026-10-14", "2026-10-09");
    expect(r.has(2)).toBe(false);
  });
  it("Publier est ramené au jour du post", () => {
    const r = joursEtapesEnOrdre({ post: image, etapes: [t(9, "Publier", "2026-10-15")], jourPost: "2026-10-14", aujourdhui: "2026-10-09", estTravaille: travaille });
    expect(r.get(9)).toBe("2026-10-14");
  });
  it("un post passé : rien ne bouge", () => {
    expect(joursEtapesEnOrdre({ post: image, etapes: [t(1, "Rédiger le texte", "2026-10-01")], jourPost: "2026-10-05", aujourdhui: "2026-10-09", estTravaille: travaille }).size).toBe(0);
  });
});
