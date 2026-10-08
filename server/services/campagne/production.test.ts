// Production d'un post : étapes dérivées du format, jour choisi à rebours de la publication,
// tâches générées par le modèle filtrées (plus de sous-tâches de contenu, plus de prospection).
import { describe, it, expect } from "vitest";
import {
  etapesProductionPourPost, genreProduction, jourDeProduction,
  estTacheContenuGeneree, estTacheProspection, postAProduire, mapFormatToPostFormat,
  ANCIENS_PREFIXES_PRODUCTION, estAncienneSousTacheContenu,
} from "./production";

const resume = (post: any) => etapesProductionPourPost(post).map((e) => `J-${e.joursAvant} ${e.titre} (${e.duree})`);

describe("genreProduction", () => {
  it("lit postFormat d'abord, contentType en repli", () => {
    expect(genreProduction({ title: "x", postFormat: "carousel" })).toBe("carrousel");
    expect(genreProduction({ title: "x", postFormat: "feed_image", contentType: "carousel" })).toBe("carrousel");
    expect(genreProduction({ title: "x", postFormat: "reel" })).toBe("video");
    expect(genreProduction({ title: "x", postFormat: "feed_video" })).toBe("video");
    expect(genreProduction({ title: "x", postFormat: "short" })).toBe("video");
    expect(genreProduction({ title: "x", postFormat: "story" })).toBe("story");
    expect(genreProduction({ title: "x", postFormat: "feed_image", contentType: "story" })).toBe("story");
    expect(genreProduction({ title: "x", postFormat: "text" })).toBe("texte");
    expect(genreProduction({ title: "x", postFormat: "feed_image", contentType: "article" })).toBe("long");
    expect(genreProduction({ title: "x", postFormat: null, contentType: "email" })).toBe("long");
    expect(genreProduction({ title: "x", postFormat: "feed_image", contentType: "post" })).toBe("image");
    expect(genreProduction({ title: "x" })).toBe("image");
  });
});

describe("etapesProductionPourPost", () => {
  it("post image publié automatiquement : texte J-2, visuel J-1, relecture J-1, pas de tâche « Publier »", () => {
    expect(resume({ title: "Mon post", postFormat: "feed_image", autoPost: true })).toEqual([
      "J-2 Rédiger le texte — Mon post (30)",
      "J-1 Préparer le visuel — Mon post (45)",
      "J-1 Relire et valider le post — Mon post (15)",
    ]);
  });

  it("sans publication automatique, « Publier » le jour même", () => {
    const etapes = etapesProductionPourPost({ title: "Mon post", postFormat: "feed_image", autoPost: false });
    const derniere = etapes[etapes.length - 1];
    expect(derniere).toMatchObject({ titre: "Publier — Mon post", joursAvant: 0, publication: true });
    expect(etapes.filter((e) => e.publication)).toHaveLength(1);
  });

  it("carrousel : structurer J-3, rédiger J-2, designer J-1, relire J-1", () => {
    expect(resume({ title: "C", postFormat: "carousel", autoPost: true })).toEqual([
      "J-3 Structurer le carrousel — C (30)",
      "J-2 Rédiger les slides — C (45)",
      "J-1 Designer les slides — C (60)",
      "J-1 Relire et valider le post — C (15)",
    ]);
  });

  it("vidéo / reel : script J-4, tournage J-3, montage J-2, relire J-1", () => {
    expect(resume({ title: "V", postFormat: "reel", autoPost: true })).toEqual([
      "J-4 Écrire le script — V (45)",
      "J-3 Tourner — V (60)",
      "J-2 Monter — V (60)",
      "J-1 Relire et valider le post — V (15)",
    ]);
  });

  it("story, texte seul, article : étapes propres, toujours la relecture en dernier", () => {
    expect(resume({ title: "S", postFormat: "story", autoPost: true })).toEqual([
      "J-1 Préparer la story — S (30)",
      "J-1 Relire et valider le post — S (15)",
    ]);
    expect(resume({ title: "T", postFormat: "text", autoPost: true })).toEqual([
      "J-2 Rédiger le texte — T (30)",
      "J-1 Relire et valider le post — T (15)",
    ]);
    expect(resume({ title: "A", contentType: "article", autoPost: true })).toEqual([
      "J-4 Construire le plan — A (30)",
      "J-3 Rédiger le texte — A (90)",
      "J-2 Mettre en forme — A (30)",
      "J-1 Relire et valider le post — A (15)",
    ]);
  });

  it("étapes ordonnées à rebours (joursAvant décroissant), libellés en français, clé stable", () => {
    for (const postFormat of ["feed_image", "carousel", "reel", "story", "text"]) {
      const e = etapesProductionPourPost({ title: "P", postFormat, autoPost: false });
      for (let i = 1; i < e.length; i++) expect(e[i].joursAvant).toBeLessThanOrEqual(e[i - 1].joursAvant);
      for (const x of e) {
        expect(x.titre.startsWith(`${x.cle} — `)).toBe(true);
        expect(x.description.length).toBeGreaterThan(0);
        expect(estAncienneSousTacheContenu(x.titre)).toBe(false);
      }
    }
  });

  it("titre vide ou très long : un titre utilisable", () => {
    expect(etapesProductionPourPost({ title: "  ", autoPost: true })[0].titre).toBe("Rédiger le texte — post sans titre");
    const long = "x".repeat(300);
    expect(etapesProductionPourPost({ title: long, autoPost: true })[0].titre.length).toBeLessThanOrEqual(140);
  });
});

describe("jourDeProduction (à rebours, jamais après le post, jamais dans le passé)", () => {
  const ouvre = (d: string) => ![0, 6].includes(new Date(d + "T00:00:00").getDay()) && d !== "2026-10-14";
  const base = { aujourdhui: "2026-10-08", estTravaille: ouvre };

  it("J-2 d'un post le vendredi 16 → mercredi 14 indisponible → mardi 13", () => {
    expect(jourDeProduction({ ...base, cible: "2026-10-14", jourPost: "2026-10-16" })).toBe("2026-10-13");
  });

  it("cible un dimanche → recule au vendredi", () => {
    expect(jourDeProduction({ ...base, cible: "2026-10-11", jourPost: "2026-10-12" })).toBe("2026-10-09");
  });

  it("cible dans le passé → aujourd'hui", () => {
    expect(jourDeProduction({ ...base, cible: "2026-10-05", jourPost: "2026-10-09" })).toBe("2026-10-08");
  });

  it("aucun jour ouvré entre aujourd'hui et la cible → avance, mais jamais après le post", () => {
    // aujourd'hui samedi 10, post lundi 12, cible dimanche 11 → lundi 12 (jour du post)
    expect(jourDeProduction({ ...base, aujourdhui: "2026-10-10", cible: "2026-10-11", jourPost: "2026-10-12" })).toBe("2026-10-12");
    // tout est chômé jusqu'au post : on garde la cible bornée
    expect(jourDeProduction({ ...base, aujourdhui: "2026-10-10", cible: "2026-10-10", jourPost: "2026-10-11" })).toBe("2026-10-10");
  });

  it("respecte un plancher (étape précédente du même post)", () => {
    expect(jourDeProduction({ ...base, cible: "2026-10-12", jourPost: "2026-10-16", plancher: "2026-10-13" })).toBe("2026-10-13");
  });
});

describe("tâches générées par le modèle", () => {
  it("contenu reconnu (anglais et français) : il ne devient plus de sous-tâches", () => {
    for (const t of [
      { title: "Write post one", type: "other" },
      { title: "Publish video two", type: "other" },
      { title: "Rédiger le carrousel", type: "other" },
      { title: "Planifier", type: "content" },
      { title: "Tourner un reel", type: "planning" },
    ]) expect(estTacheContenuGeneree(t)).toBe(true);
    for (const t of [{ title: "Plan review", type: "planning" }, { title: "Wrap up", type: "admin" }, { title: "Post-campaign review", type: "planning" }]) {
      expect(estTacheContenuGeneree(t)).toBe(false);
    }
  });

  it("prospection reconnue : type outreach ou titre explicite", () => {
    for (const t of [
      { title: "Anything", type: "outreach" },
      { title: "Envoyer 10 DM aux prospects", type: "other" },
      { title: "Send DMs to leads", type: "other" },
      { title: "Prospection LinkedIn", type: "planning" },
      { title: "Cold email campaign", type: "admin" },
      { title: "Contacter 5 agences", type: "admin" },
    ]) expect(estTacheProspection(t)).toBe(true);
    for (const t of [{ title: "Plan review", type: "planning" }, { title: "Analyser les KPIs", type: "admin" }]) {
      expect(estTacheProspection(t)).toBe(false);
    }
  });
});

describe("postAProduire", () => {
  const p = (over: any = {}) => ({ id: 1, title: "t", scheduledFor: new Date("2026-10-12T09:00:00"), publishedAt: null, postStatus: "pending", contentStatus: "idea", ...over });
  it("seulement un post à venir, non publié, non en cours de publication", () => {
    expect(postAProduire(p(), "2026-10-08")).toBe(true);
    expect(postAProduire(p({ scheduledFor: new Date("2026-10-08T16:00:00") }), "2026-10-08")).toBe(true);
    expect(postAProduire(p({ scheduledFor: new Date("2026-10-07T16:00:00") }), "2026-10-08")).toBe(false);
    expect(postAProduire(p({ scheduledFor: null }), "2026-10-08")).toBe(false);
    expect(postAProduire(p({ publishedAt: new Date() }), "2026-10-08")).toBe(false);
    expect(postAProduire(p({ postStatus: "posted" }), "2026-10-08")).toBe(false);
    expect(postAProduire(p({ postStatus: "posting" }), "2026-10-08")).toBe(false);
    expect(postAProduire(p({ contentStatus: "published" }), "2026-10-08")).toBe(false);
  });
});

describe("mapFormatToPostFormat", () => {
  it("traduit le format libre du plan de contenu", () => {
    expect(mapFormatToPostFormat("Carousel")).toBe("carousel");
    expect(mapFormatToPostFormat("carrousel LinkedIn")).toBe("carousel");
    expect(mapFormatToPostFormat("Reel")).toBe("reel");
    expect(mapFormatToPostFormat("Vidéo courte")).toBe("feed_video");
    expect(mapFormatToPostFormat("Story")).toBe("story");
    expect(mapFormatToPostFormat("Text post")).toBe("text");
    expect(mapFormatToPostFormat("Image")).toBe("feed_image");
    expect(mapFormatToPostFormat("")).toBe("feed_image");
  });
});

describe("anciennes sous-tâches anglaises (migration)", () => {
  it("reconnaît les préfixes de decomposeContentTask, pas les nouveaux titres", () => {
    expect(ANCIENS_PREFIXES_PRODUCTION.length).toBeGreaterThan(5);
    expect(estAncienneSousTacheContenu("Angle & structure — X")).toBe(true);
    expect(estAncienneSousTacheContenu("Write copy — X")).toBe(true);
    expect(estAncienneSousTacheContenu("Schedule & publish — X")).toBe(true);
    expect(estAncienneSousTacheContenu("Publish — X")).toBe(true);
    expect(estAncienneSousTacheContenu("Shoot/record — X")).toBe(true);
    expect(estAncienneSousTacheContenu("Rédiger le texte — X")).toBe(false);
    expect(estAncienneSousTacheContenu("Publier — X")).toBe(false);
    expect(estAncienneSousTacheContenu("Plan review")).toBe(false);
  });
});
