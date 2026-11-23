// Garde de publication de la validation client (lot 8) : attente pendant la grâce de 3 h,
// puis échec « validation_manquante » / « validation_refusee » avec l'alerte habituelle.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
const { traiterAttentesValidation, sqlBloqueParValidation } = await import("./garde-publication");

const MAINTENANT = new Date("2026-11-23T12:00:00Z");
const ilYa = (min: number) => new Date(MAINTENANT.getTime() - min * 60_000);
const post = (id: number, min: number, statut = "a_valider") => ({ id, userId: "u1", title: `Post ${id}`, platform: "instagram", scheduledFor: ilYa(min), validationStatut: statut });

function fauxDeps(posts: any[], echoue = true) {
  return {
    enAttente: vi.fn(async () => posts),
    echouer: vi.fn(async () => echoue),
    journaliser: vi.fn(async () => {}),
    signalerEchec: vi.fn(async () => {}),
  };
}

describe("traiterAttentesValidation", () => {
  it("pendant la grâce : le post attend, rien n'est écrit", async () => {
    const deps = fauxDeps([post(1, 5), post(2, 179)]);
    expect(await traiterAttentesValidation(MAINTENANT, deps)).toEqual({ attente: 2, echecs: 0 });
    expect(deps.echouer).not.toHaveBeenCalled();
    expect(deps.signalerEchec).not.toHaveBeenCalled();
  });
  it("grâce écoulée : échec « validation_manquante », historique et alerte", async () => {
    const deps = fauxDeps([post(1, 5), post(2, 181)]);
    expect(await traiterAttentesValidation(MAINTENANT, deps)).toEqual({ attente: 1, echecs: 1 });
    expect(deps.echouer).toHaveBeenCalledWith(2, "validation_manquante", MAINTENANT);
    expect(deps.journaliser).toHaveBeenCalledWith("u1", 2, "echec", { raison: "validation_manquante" });
    expect(deps.signalerEchec).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }), "validation_manquante");
  });
  it("refusé : « validation_refusee »", async () => {
    const deps = fauxDeps([post(3, 240, "refusee")]);
    await traiterAttentesValidation(MAINTENANT, deps);
    expect(deps.signalerEchec).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), "validation_refusee");
  });
  it("validé ou modifié entre-temps (la mise à jour conditionnelle ne touche rien) : ni historique ni alerte", async () => {
    const deps = fauxDeps([post(4, 300)], false);
    expect(await traiterAttentesValidation(MAINTENANT, deps)).toEqual({ attente: 0, echecs: 0 });
    expect(deps.journaliser).not.toHaveBeenCalled();
    expect(deps.signalerEchec).not.toHaveBeenCalled();
  });
});

describe("sqlBloqueParValidation", () => {
  it("ne vise que « à valider » / « refusé » d'une marque dont la validation est active", () => {
    const chunks = JSON.stringify((sqlBloqueParValidation as any).queryChunks.filter((c: any) => c?.value).map((c: any) => c.value));
    expect(chunks).toContain("'a_valider', 'refusee'");
    expect(chunks).toContain("validation_projet");
    expect(chunks).toContain("vp.actif = true");
  });
});
