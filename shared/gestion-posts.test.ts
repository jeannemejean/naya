import { describe, it, expect } from "vitest";
import {
  evenementsDuChangement, copiePourDuplication, lireActionGroupee, trierPourAction, nouvelleDate,
  lireTexteNote, postVerrouille, TEXTE_NOTE_MAX, IDS_GROUPES_MAX, dateCorbeilleLimite,
} from "./gestion-posts";

const base = {
  id: 7, userId: "u1", projectId: 1, title: "Titre", body: "Texte", platform: "instagram", contentType: "post",
  pillar: "education", goal: "visibility", intent: "awareness", status: "draft", contentStatus: "ready",
  scheduledFor: new Date("2026-12-01T09:00:00Z"), publishedAt: null, autoPost: true, postStatus: "pending",
  platformPostId: null, mediaIds: [3, 4], mediaUrl: null, mediaFileName: null, postFormat: "carousel",
  campaignId: 12, socialAccountId: 5, crossPostGroupId: "g", premierCommentaire: "1er", couvertureUrl: "c.jpg",
  couvertureOffsetMs: 1500, texteAlternatif: "alt", collaborateurs: ["a"], reelDansLeFil: true, nomAudio: "son",
  linkedinDocument: false, videoMeta: { durationSec: 3 }, lastError: "x", providerContainerId: "pc",
  sourceTaskId: 99, supprimeLe: null, consigne: "c", angle: "a", formatCreatif: "f",
} as any;

describe("evenementsDuChangement", () => {
  it("rien ne change → aucun événement", () => {
    expect(evenementsDuChangement(base, { ...base })).toEqual([]);
  });
  it("texte, date, programmation, publication", () => {
    const apres = { ...base, body: "Autre", scheduledFor: new Date("2026-12-02T09:00:00Z"), autoPost: false };
    const ev = evenementsDuChangement(base, apres).map((e) => e.evenement);
    expect(ev).toEqual(["texte_modifie", "date_modifiee", "deprogramme"]);
    const d = evenementsDuChangement(base, apres).find((e) => e.evenement === "date_modifiee")!;
    expect(d.details).toEqual({ avant: "2026-12-01T09:00:00.000Z", apres: "2026-12-02T09:00:00.000Z" });
    expect(evenementsDuChangement({ ...base, autoPost: false }, base).map((e) => e.evenement)).toEqual(["programme"]);
    expect(evenementsDuChangement(base, { ...base, publishedAt: new Date() }).map((e) => e.evenement)).toEqual(["publie"]);
  });
  it("une date passée en chaîne équivaut à la même date", () => {
    expect(evenementsDuChangement(base, { ...base, scheduledFor: "2026-12-01T09:00:00.000Z" })).toEqual([]);
  });
  it("patch partiel : seuls les champs présents comptent", () => {
    expect(evenementsDuChangement(base, { title: "Nouveau" }).map((e) => e.evenement)).toEqual(["texte_modifie"]);
    expect(evenementsDuChangement(base, { contentStatus: "draft" })).toEqual([]);
  });
});

describe("copiePourDuplication", () => {
  it("copie le texte, les médias et les options ; jamais la publication", () => {
    const c = copiePourDuplication(base, { projectId: 2 });
    expect(c).toMatchObject({
      userId: "u1", projectId: 2, title: "Titre", body: "Texte", platform: "instagram", mediaIds: [3, 4],
      postFormat: "carousel", premierCommentaire: "1er", couvertureUrl: "c.jpg", couvertureOffsetMs: 1500,
      texteAlternatif: "alt", collaborateurs: ["a"], reelDansLeFil: true, nomAudio: "son", linkedinDocument: false,
      autoPost: false, postStatus: "pending", status: "draft", contentStatus: "draft",
      platformPostId: null, publishedAt: null, socialAccountId: null, campaignId: null, crossPostGroupId: null,
      sourceTaskId: null, lastError: null, providerContainerId: null,
    });
    expect(c).not.toHaveProperty("id");
    expect(c).not.toHaveProperty("supprimeLe");
    expect(c.scheduledFor).toEqual(base.scheduledFor);
  });
  it("une date fournie remplace l'originale ; null la retire", () => {
    expect(copiePourDuplication(base, { projectId: null, scheduledFor: new Date("2027-01-01T00:00:00Z") }).scheduledFor)
      .toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(copiePourDuplication(base, { projectId: null, scheduledFor: null }).scheduledFor).toBeNull();
  });
  it("une idée reste une idée", () => {
    expect(copiePourDuplication({ ...base, contentStatus: "idea" }, { projectId: 1 }).contentStatus).toBe("idea");
  });
  it("les médias sont copiés, pas partagés", () => {
    const c = copiePourDuplication(base, { projectId: 1 });
    expect(c.mediaIds).not.toBe(base.mediaIds);
  });
});

describe("lireActionGroupee", () => {
  it("valide les trois actions", () => {
    expect(lireActionGroupee({ ids: [1, 2, 2], action: "deplacer", jours: 3 })).toEqual({ ids: [1, 2], action: "deplacer", jours: 3 });
    expect(lireActionGroupee({ ids: [1], action: "deplacer", date: "2026-12-24" })).toEqual({ ids: [1], action: "deplacer", date: "2026-12-24" });
    expect(lireActionGroupee({ ids: [1], action: "dupliquer", projectIds: [4, 4, 5] })).toEqual({ ids: [1], action: "dupliquer", projectIds: [4, 5] });
    expect(lireActionGroupee({ ids: [1], action: "supprimer" })).toEqual({ ids: [1], action: "supprimer" });
  });
  it("refuse le reste", () => {
    expect(lireActionGroupee({ ids: [], action: "supprimer" })).toBeNull();
    expect(lireActionGroupee({ ids: [1, "x"], action: "supprimer" })).toBeNull();
    expect(lireActionGroupee({ ids: Array.from({ length: IDS_GROUPES_MAX + 1 }, (_, i) => i + 1), action: "supprimer" })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "publier" })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "deplacer" })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "deplacer", jours: 0 })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "deplacer", jours: 1.5 })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "deplacer", date: "24/12/2026" })).toBeNull();
    expect(lireActionGroupee({ ids: [1], action: "dupliquer", projectIds: [] })).toBeNull();
    expect(lireActionGroupee(null)).toBeNull();
  });
});

describe("nouvelleDate", () => {
  it("décale de n jours en gardant l'heure de Paris (changement d'heure compris)", () => {
    // 25 oct. 2026 : passage à l'heure d'hiver. 9 h à Paris le 24 (UTC+2) → 9 h le 26 (UTC+1).
    expect(nouvelleDate(new Date("2026-10-24T07:00:00Z"), { jours: 2 })!.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(nouvelleDate(new Date("2026-12-01T09:00:00Z"), { jours: -1 })!.toISOString()).toBe("2026-11-30T09:00:00.000Z");
  });
  it("une date fixée garde l'heure ; sans date d'origine, 9 h à Paris", () => {
    expect(nouvelleDate(new Date("2026-12-01T15:30:00Z"), { date: "2026-12-24" })!.toISOString()).toBe("2026-12-24T15:30:00.000Z");
    expect(nouvelleDate(null, { date: "2026-07-14" })!.toISOString()).toBe("2026-07-14T07:00:00.000Z");
    expect(nouvelleDate(null, { jours: 2 })).toBeNull();
  });
});

describe("trierPourAction", () => {
  const maintenant = new Date("2026-11-23T10:00:00Z");
  const publie = { ...base, id: 1, publishedAt: new Date(), postStatus: "posted" };
  const enCours = { ...base, id: 2, postStatus: "posting" };
  const libre = { ...base, id: 3, autoPost: false };
  const sansDate = { ...base, id: 4, scheduledFor: null, autoPost: false };
  const programme = { ...base, id: 5, autoPost: true, scheduledFor: new Date("2026-11-24T09:00:00Z") };

  it("supprimer : les publiés et ceux en cours sont ignorés, et signalés", () => {
    const r = trierPourAction([publie, enCours, libre], { action: "supprimer" }, maintenant);
    expect(r.retenus.map((x) => x.post.id)).toEqual([3]);
    expect(r.ignores).toEqual([{ id: 1, raison: "deja_publie" }, { id: 2, raison: "en_cours" }]);
  });
  it("déplacer : nouvelle date calculée ; sans date avec un décalage → ignoré ; programmé dans le passé → ignoré", () => {
    const r = trierPourAction([libre, sansDate, programme, publie], { action: "deplacer", jours: -2 }, maintenant);
    expect(r.retenus.map((x) => [x.post.id, x.scheduledFor!.toISOString()])).toEqual([[3, "2026-11-29T09:00:00.000Z"]]);
    expect(r.ignores).toEqual([{ id: 4, raison: "sans_date" }, { id: 5, raison: "date_passee" }, { id: 1, raison: "deja_publie" }]);
  });
  it("dupliquer : tout est retenu, même publié", () => {
    const r = trierPourAction([publie, enCours], { action: "dupliquer", projectIds: [2] }, maintenant);
    expect(r.retenus).toHaveLength(2);
    expect(r.ignores).toEqual([]);
  });
});

describe("notes et verrou", () => {
  it("texte de note : rogné, non vide, borné", () => {
    expect(lireTexteNote({ texte: "  hello " })).toBe("hello");
    expect(lireTexteNote({ texte: "   " })).toBeNull();
    expect(lireTexteNote({ texte: 3 })).toBeNull();
    expect(lireTexteNote({ texte: "x".repeat(TEXTE_NOTE_MAX + 1) })).toBeNull();
    expect(lireTexteNote({ texte: "x".repeat(TEXTE_NOTE_MAX) })).toHaveLength(TEXTE_NOTE_MAX);
  });
  it("post verrouillé : publié ou en cours", () => {
    expect(postVerrouille(base)).toBe(false);
    expect(postVerrouille({ ...base, postStatus: "Processing " })).toBe(true);
    expect(postVerrouille({ ...base, contentStatus: "published" })).toBe(true);
    expect(postVerrouille({ ...base, publishedAt: new Date() })).toBe(true);
  });
  it("corbeille : 30 jours", () => {
    expect(dateCorbeilleLimite(new Date("2026-11-30T00:00:00Z")).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
});
