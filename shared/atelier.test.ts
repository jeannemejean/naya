import { describe, it, expect } from "vitest";
import {
  lundiDe, plusJours, decouperAtelier, planAtelier, etatPost, manquesPourValider, genreDuPost,
  DUREE_ATELIER, libelleSemaine, dureeValidation, echeanceAtelier,
} from "./atelier";

// Lundi 19 oct. 2026 ; semaine de travail du lundi au vendredi.
const ouvre = (d: string) => { const j = new Date(d + "T12:00:00Z").getUTCDay(); return j >= 1 && j <= 5; };

describe("lundiDe", () => {
  it("renvoie le lundi de la semaine (dimanche compris dans la semaine qui finit)", () => {
    expect(lundiDe("2026-10-19")).toBe("2026-10-19");
    expect(lundiDe("2026-10-22")).toBe("2026-10-19");
    expect(lundiDe("2026-10-25")).toBe("2026-10-19");
    expect(lundiDe("2026-10-26")).toBe("2026-10-26");
  });
  it("passe les changements de mois et d'année", () => {
    expect(lundiDe("2027-01-01")).toBe("2026-12-28");
    expect(plusJours("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("libelleSemaine", () => {
  it("dit le lundi en français court", () => {
    expect(libelleSemaine("2026-10-19")).toBe("19 oct.");
    expect(libelleSemaine("2026-12-28")).toBe("28 déc.");
  });
});

describe("genreDuPost et durées", () => {
  it("reconnaît les formats", () => {
    expect(genreDuPost({ postFormat: "carousel" })).toBe("carrousel");
    expect(genreDuPost({ postFormat: "reel" })).toBe("video");
    expect(genreDuPost({ postFormat: "text" })).toBe("texte");
    expect(genreDuPost({ contentType: "newsletter" })).toBe("long");
    expect(genreDuPost({ postFormat: "story" })).toBe("story");
    expect(genreDuPost({})).toBe("image");
  });
  it("donne une durée d'atelier par genre", () => {
    expect(DUREE_ATELIER).toEqual({ image: 15, texte: 10, carrousel: 30, video: 15, story: 10, long: 45 });
  });
});

describe("decouperAtelier", () => {
  it("garde une seule partie sous le plafond", () => {
    expect(decouperAtelier([15, 15, 30])).toEqual([60]);
  });
  it("découpe au-delà de 90 minutes, sans couper un post", () => {
    expect(decouperAtelier([30, 30, 30, 15, 45])).toEqual([90, 60]);
  });
  it("un post plus long que le plafond reste seul", () => {
    expect(decouperAtelier([120, 10])).toEqual([120, 10]);
  });
  it("rien à faire → aucune partie", () => {
    expect(decouperAtelier([])).toEqual([]);
  });
});

describe("dureeValidation", () => {
  it("5 min + 2 min par post, 20 au plus", () => {
    expect(dureeValidation(3)).toBe(11);
    expect(dureeValidation(20)).toBe(20);
  });
});

describe("planAtelier", () => {
  it("pose l'atelier 3 jours travaillés avant le premier post, la validation le lendemain", () => {
    // Premier post jeudi 22 → atelier vendredi 16 ? Non : 3 jours travaillés avant jeudi = lundi 19.
    const p = planAtelier({ joursPosts: ["2026-10-22", "2026-10-23"], durees: [15, 15], aujourdhui: "2026-10-14", estTravaille: ouvre });
    expect(p.echeance).toBe("2026-10-21");
    expect(p.parties).toEqual([{ jour: "2026-10-19", duree: 30 }]);
    expect(p.validation).toEqual({ jour: "2026-10-20", duree: 9 });
  });
  it("saute le week-end en reculant", () => {
    // Premier post mardi 20 → 3 jours travaillés avant : jeudi 15.
    const p = planAtelier({ joursPosts: ["2026-10-20"], durees: [15], aujourdhui: "2026-10-12", estTravaille: ouvre });
    expect(p.parties[0].jour).toBe("2026-10-15");
    expect(p.validation?.jour).toBe("2026-10-16");
    expect(p.echeance).toBe("2026-10-19");
  });
  it("jamais avant aujourd'hui ; sans place pour la validation, pas de tâche de validation", () => {
    const p = planAtelier({ joursPosts: ["2026-10-22"], durees: [15], aujourdhui: "2026-10-21", estTravaille: ouvre });
    expect(p.parties).toEqual([{ jour: "2026-10-21", duree: 15 }]);
    expect(p.validation).toBeNull();
  });
  it("aujourd'hui un samedi : l'atelier va au premier jour travaillé avant l'échéance", () => {
    const p = planAtelier({ joursPosts: ["2026-10-21"], durees: [15], aujourdhui: "2026-10-17", estTravaille: ouvre });
    expect(p.parties[0].jour).toBe("2026-10-19");
    expect(p.validation).toEqual({ jour: "2026-10-20", duree: 7 });
  });
  it("premier post demain matin d'un jour déjà passé : l'échéance est le jour du post", () => {
    const p = planAtelier({ joursPosts: ["2026-10-19"], durees: [15], aujourdhui: "2026-10-19", estTravaille: ouvre });
    expect(p.echeance).toBe("2026-10-19");
    expect(p.parties[0].jour).toBe("2026-10-19");
  });
  it("plusieurs parties sur des jours travaillés successifs, bornées par l'échéance", () => {
    const p = planAtelier({ joursPosts: ["2026-10-23"], durees: [45, 45, 45, 45], aujourdhui: "2026-10-14", estTravaille: ouvre });
    // 3 jours travaillés avant vendredi 23 = mardi 20 ; échéance jeudi 22.
    expect(p.parties).toEqual([{ jour: "2026-10-20", duree: 90 }, { jour: "2026-10-21", duree: 90 }]);
    expect(p.validation).toEqual({ jour: "2026-10-22", duree: 13 });
  });
  it("les parties qui n'ont plus de jour restent sur le dernier jour possible", () => {
    const p = planAtelier({ joursPosts: ["2026-10-21"], durees: [90, 90, 90], aujourdhui: "2026-10-19", estTravaille: ouvre });
    expect(p.parties.map((x) => x.jour)).toEqual(["2026-10-19", "2026-10-20", "2026-10-20"]);
    expect(p.validation).toBeNull();
  });
});

describe("etatPost", () => {
  it("publié, validé, brouillon, à rédiger", () => {
    expect(etatPost({ publishedAt: new Date() })).toBe("publie");
    expect(etatPost({ postStatus: "posted" })).toBe("publie");
    expect(etatPost({ contentStatus: "ready" })).toBe("valide");
    expect(etatPost({ autoPost: true, contentStatus: "idea" })).toBe("valide");
    expect(etatPost({ consigne: "l'idée", contentStatus: "draft" })).toBe("brouillon");
    expect(etatPost({ contentStatus: "draft" })).toBe("brouillon");
    expect(etatPost({ contentStatus: "idea", autoPost: false })).toBe("a_rediger");
  });
  it("un post manuel (hors campagne) qui a déjà un texte est un brouillon : c'est le texte de l'utilisatrice", () => {
    expect(etatPost({ campaignId: null, body: "Mon texte", contentStatus: "idea", autoPost: false })).toBe("brouillon");
    expect(etatPost({ campaignId: null, body: "  ", contentStatus: "idea", autoPost: false })).toBe("a_rediger");
    expect(etatPost({ campaignId: 3, body: "Consigne", contentStatus: "idea", autoPost: false })).toBe("a_rediger");
  });
});

describe("manquesPourValider", () => {
  const maintenant = new Date("2026-10-19T08:00:00Z");
  const base = { body: "Un texte", scheduledFor: "2026-10-22T07:00:00Z", maintenant };
  it("rien ne manque pour un texte seul", () => {
    expect(manquesPourValider({ ...base, genre: "texte", medias: [] })).toEqual([]);
  });
  it("texte vide et date passée", () => {
    expect(manquesPourValider({ ...base, body: "  ", scheduledFor: "2026-10-19T08:01:00Z", genre: "texte", medias: [] }))
      .toEqual(["texte", "date"]);
    expect(manquesPourValider({ ...base, scheduledFor: null, genre: "texte", medias: [] })).toEqual(["date"]);
  });
  it("une image ou une story sans visuel", () => {
    expect(manquesPourValider({ ...base, genre: "image", medias: [] })).toEqual(["visuel"]);
    expect(manquesPourValider({ ...base, genre: "story", medias: [] })).toEqual(["visuel"]);
    expect(manquesPourValider({ ...base, genre: "image", medias: ["image"] })).toEqual([]);
  });
  it("un carrousel d'un seul visuel", () => {
    expect(manquesPourValider({ ...base, genre: "carrousel", medias: ["image"] })).toEqual(["visuels"]);
    expect(manquesPourValider({ ...base, genre: "carrousel", medias: ["image", "image"] })).toEqual([]);
  });
  it("une vidéo sans vidéo, même avec une image", () => {
    expect(manquesPourValider({ ...base, genre: "video", medias: ["image"] })).toEqual(["video"]);
    expect(manquesPourValider({ ...base, genre: "video", medias: ["video"] })).toEqual([]);
  });
});

describe("echeanceAtelier", () => {
  it("l'échéance d'une tâche d'atelier, rien pour une autre tâche", () => {
    expect(echeanceAtelier({ taskType: "atelier_contenu", actionData: { echeance: "2026-10-21" } })).toBe("2026-10-21");
    expect(echeanceAtelier({ taskType: "atelier_validation", actionData: { echeance: "2026-10-21" } })).toBe("2026-10-21");
    expect(echeanceAtelier({ taskType: "generic", actionData: { echeance: "2026-10-21" } })).toBeNull();
    expect(echeanceAtelier({ taskType: "atelier_contenu", actionData: { echeance: "n'importe quoi" } })).toBeNull();
    expect(echeanceAtelier({ taskType: "atelier_contenu", actionData: null })).toBeNull();
  });
});
