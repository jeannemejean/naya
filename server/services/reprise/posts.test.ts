import { describe, it, expect } from "vitest";
import { deciderJoursPosts, estPostManque, promptPosts, type PostManque } from "./posts";

const jourDe = (p: PostManque) => new Date(p.scheduledFor).toISOString().slice(0, 10);
const P = (id: number, jour: string, platform = "instagram"): PostManque => ({ id, title: `Post ${id}`, platform, scheduledFor: `${jour}T09:00:00Z`, campaignId: 7 });

describe("estPostManque", () => {
  it("un brouillon ou un post validé dont le jour est passé, jamais parti", () => {
    expect(estPostManque({ scheduledFor: "2026-10-14T09:00:00Z", contentStatus: "ready" }, "2026-10-14", "2026-10-25")).toBe(true);
    expect(estPostManque({ scheduledFor: "2026-10-22T09:00:00Z", contentStatus: "draft" }, "2026-10-22", "2026-10-25")).toBe(true);
  });
  it("publié, en cours de publication, ou pas encore passé : non", () => {
    expect(estPostManque({ scheduledFor: "2026-10-14T09:00:00Z", publishedAt: new Date() }, "2026-10-14", "2026-10-25")).toBe(false);
    expect(estPostManque({ scheduledFor: "2026-10-14T09:00:00Z", postStatus: "posted" }, "2026-10-14", "2026-10-25")).toBe(false);
    expect(estPostManque({ scheduledFor: "2026-10-14T09:00:00Z", contentStatus: "published" }, "2026-10-14", "2026-10-25")).toBe(false);
    expect(estPostManque({ scheduledFor: "2026-10-27T09:00:00Z" }, "2026-10-27", "2026-10-25")).toBe(false);
  });
});

describe("deciderJoursPosts", () => {
  const base = { cible: "2026-10-27", fin: "2026-11-09", dejaPrevus: [], jourDe };

  it("sans avis de Naya, tout est reprogrammé dans l'ordre, un post par plateforme et par jour, en semaine", () => {
    const ouvre = (d: string) => { const j = new Date(`${d}T12:00:00Z`).getUTCDay(); return j >= 1 && j <= 5; };
    const r = deciderJoursPosts({ ...base, estTravaille: ouvre, posts: [P(2, "2026-10-16"), P(1, "2026-10-14"), P(4, "2026-10-17"), P(3, "2026-10-16", "tiktok")], sortie: null });
    expect(r.map((d) => [d.id, d.action, d.jour])).toEqual([
      [1, "reprogrammer", "2026-10-29"], // brouillon : deux jours pour l'écrire (cible mardi 27)
      [2, "reprogrammer", "2026-10-30"],
      [3, "reprogrammer", "2026-10-29"], // une autre plateforme peut partager le jour
      [4, "reprogrammer", "2026-11-02"], // pas le week-end
    ]);
  });

  it("un post déjà validé peut sortir dès le lendemain", () => {
    const r = deciderJoursPosts({ ...base, posts: [{ ...P(216, "2026-10-14"), contentStatus: "ready" }], sortie: null });
    expect(r[0].jour).toBe("2026-10-28");
  });

  it("le jour choisi par Naya est tenu ; s'il est pris sur la même plateforme, le post glisse", () => {
    const r = deciderJoursPosts({
      ...base, dejaPrevus: [{ platform: "Instagram", jour: "2026-10-29" }],
      posts: [P(1, "2026-10-14")],
      sortie: { posts: [{ id: 1, action: "reprogrammer", jour: "2026-10-29", raison: "Utile." }] },
    });
    expect(r[0]).toMatchObject({ action: "reprogrammer", jour: "2026-10-30", raison: "Utile." });
  });

  it("un jour hors fenêtre ou illisible est remplacé ; « retirer » est tenu", () => {
    const r = deciderJoursPosts({
      ...base, posts: [P(1, "2026-10-14"), P(2, "2026-10-15")],
      sortie: { posts: [
        { id: 1, action: "reprogrammer", jour: "2026-10-20", raison: "" },
        { id: 2, action: "retirer", jour: null, raison: "Halloween est passé." },
      ] },
    });
    expect(r).toEqual([
      { id: 1, action: "reprogrammer", jour: "2026-10-29", raison: "" },
      { id: 2, action: "retirer", jour: null, raison: "Halloween est passé." },
    ]);
  });
});

describe("promptPosts", () => {
  it("donne au modèle la campagne, sa fin, le statut et ce qui est déjà prévu", () => {
    const p = promptPosts({
      aujourdhui: "2026-10-26", cible: "2026-10-27", fin: "2026-11-09", jourDe,
      posts: [{ ...P(216, "2026-10-14"), contentStatus: "ready" }],
      campagnes: new Map([[7, { name: "Saisons, regards, désirs", endDate: "2026-10-30" }]]),
      dejaPrevus: [{ title: "Board Automne", platform: "Pinterest", jour: "2026-10-27" }],
    });
    expect(p).toContain("#216 Post 216 — instagram, prévu le 2026-10-14, campagne « Saisons, regards, désirs » (jusqu'au 2026-10-30), validé");
    expect(p).toContain("- 2026-10-27 · Pinterest · Board Automne");
  });
});
