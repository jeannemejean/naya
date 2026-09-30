import { describe, it, expect, vi } from "vitest";
import { runReadingRoom } from "./runner";

const TODAY = new Date("2026-10-01T05:00:00Z");
const hier = new Date("2026-09-30T08:00:00Z");

const depsBase = (over: any = {}) => ({
  projetsActifs: vi.fn().mockResolvedValue([{ id: 1, name: "JMD" }]),
  requetes: vi.fn().mockResolvedValue(["actu secteur"]),
  sourcer: vi.fn().mockResolvedValue([
    { url: "https://media.fr/a", title: "A", source: "M", publishedAt: hier, projectId: 1 },
  ]),
  hashDejaVus: vi.fn().mockResolvedValue(new Set<string>()),
  contexteMarque: vi.fn().mockResolvedValue("contexte"),
  noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/a", score: 0.9, rationale: "r" }]),
  rediger: vi.fn().mockResolvedValue({ factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" }),
  ecrire: vi.fn().mockResolvedValue(undefined),
  expirer: vi.fn().mockResolvedValue(0),
  ...over,
});

describe("runReadingRoom", () => {
  it("le chemin nominal : une fiche écrite", async () => {
    const deps = depsBase();
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
    expect(deps.ecrire).toHaveBeenCalledTimes(1);
  });

  it("expire les fiches de la veille À CHAQUE passage, même quand la revue est vide", async () => {
    const deps = depsBase({ sourcer: vi.fn().mockResolvedValue([]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(deps.expirer).toHaveBeenCalledWith("u1", TODAY);
    expect(out.fichesEcrites).toBe(0);
  });

  it("rien au-dessus du seuil → zéro fiche, et on n'a même pas scrapé", async () => {
    const deps = depsBase({ noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/a", score: 0.4, rationale: "r" }]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.rediger).not.toHaveBeenCalled();
  });

  it("une rédaction qui rend null n'écrit pas de fiche", async () => {
    const deps = depsBase({ rediger: vi.fn().mockResolvedValue(null) });
    expect((await runReadingRoom("u1", TODAY, deps as any)).fichesEcrites).toBe(0);
    expect(deps.ecrire).not.toHaveBeenCalled();
  });

  it("un projet qui échoue n'empêche pas les autres d'être veillés", async () => {
    const deps = depsBase({
      projetsActifs: vi.fn().mockResolvedValue([{ id: 1, name: "A" }, { id: 2, name: "B" }]),
      contexteMarque: vi.fn().mockImplementation(async (_u: string, projectId: number) => {
        if (projectId === 1) throw new Error("boom");
        return "contexte B";
      }),
      sourcer: vi.fn().mockResolvedValue([
        { url: "https://media.fr/b", title: "B", source: "M", publishedAt: hier, projectId: 2 },
      ]),
      noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/b", score: 0.9, rationale: "r" }]),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
  });

  it("aucun projet actif → aucune requête, aucun appel modèle", async () => {
    const deps = depsBase({ projetsActifs: vi.fn().mockResolvedValue([]) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.noter).not.toHaveBeenCalled();
    expect(deps.sourcer).not.toHaveBeenCalled();
  });

  it("une URL déjà vue n'est jamais reproposée, même si le modèle la noterait haut", async () => {
    const { hashUrl, canonicalizeUrl } = await import("./url");
    const deps = depsBase({
      hashDejaVus: vi.fn().mockResolvedValue(new Set([hashUrl(canonicalizeUrl("https://media.fr/a")!)])),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.noter).not.toHaveBeenCalled();
  });
});
