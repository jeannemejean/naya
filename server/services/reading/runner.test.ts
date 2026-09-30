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
  compterFichesDuJour: vi.fn().mockResolvedValue(0),
  accesExterneConfigure: vi.fn().mockReturnValue(true),
  depenseBloquee: vi.fn().mockResolvedValue(false),
  ...over,
});

// Deux candidats vivants, un par marque, pour les scénarios à deux projets : chaque
// marque a quelque chose à noter après l'étage 1, ce qui est la condition pour que
// l'isolement des échecs entre marques soit réellement exercé (voir le test dédié).
const deuxProjetsAvecCandidatsVivants = () => ({
  projetsActifs: vi.fn().mockResolvedValue([{ id: 1, name: "A" }, { id: 2, name: "B" }]),
  sourcer: vi.fn().mockResolvedValue([
    { url: "https://media.fr/a", title: "A", source: "M", publishedAt: hier, projectId: 1 },
    { url: "https://media.fr/b", title: "B", source: "M", publishedAt: hier, projectId: 1 },
    { url: "https://media.fr/c", title: "C", source: "M", publishedAt: hier, projectId: 2 },
  ]),
  noter: vi.fn().mockImplementation(async (input: any) =>
    input.candidats.map((c: any) => ({ url: c.url, score: 0.9, rationale: "r" }))),
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

  it("un projet qui échoue à la notation n'empêche pas l'autre d'être veillé (les deux marques ont un candidat vivant)", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      contexteMarque: vi.fn().mockImplementation(async (_u: string, projectId: number) => {
        if (projectId === 1) throw new Error("boom");
        return "contexte B";
      }),
    });
    // Preuve que l'isolement est réellement exercé : la marque 1 a un candidat vivant
    // après l'étage 1 (donc contexteMarque(1) EST appelé et lève), et malgré ça la
    // marque 2 reçoit bien sa fiche — sans quoi retirer le try/catch romprait ce test.
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(deps.contexteMarque).toHaveBeenCalledWith("u1", 1);
    expect(out.fichesEcrites).toBe(1);
    expect(deps.ecrire).toHaveBeenCalledTimes(1);
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

  it("le plafond quotidien (tous statuts confondus) borne l'écriture : deux fiches déjà écrites aujourd'hui, trois retenues → une seule est écrite", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      compterFichesDuJour: vi.fn().mockResolvedValue(2),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
    expect(deps.ecrire).toHaveBeenCalledTimes(1);
  });

  it("le plafond quotidien déjà atteint (trois fiches déjà écrites) → aucune fiche n'est écrite", async () => {
    const deps = depsBase({ compterFichesDuJour: vi.fn().mockResolvedValue(3) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.ecrire).not.toHaveBeenCalled();
  });

  // ── Le bilan : UNE ligne de journal par passage. Le produit s'interdit tout
  // compteur et tout message visible, donc une défaillance silencieuse est
  // indétectable par l'utilisatrice — cette ligne est le seul organe de détection. ──

  const lignesDeBilan = (journal: any) =>
    journal.mock.calls.map((c: any[]) => String(c[0])).filter((l: string) => l.includes("bilan"));

  it("journalise UNE ligne de bilan en fin de passage, avec le compte de chaque étage", async () => {
    const journal = vi.spyOn(console, "info").mockImplementation(() => {});
    await runReadingRoom("u1", TODAY, depsBase() as any);
    const lignes = lignesDeBilan(journal);
    journal.mockRestore();

    expect(lignes).toHaveLength(1); // une ligne, pas un pavé
    expect(lignes[0]).toContain("marques veillées 1");
    expect(lignes[0]).toContain("requêtes 1");
    expect(lignes[0]).toContain("candidats bruts 1");
    expect(lignes[0]).toContain("survivants étage 1 1");
    expect(lignes[0]).toContain("au-dessus du seuil 1");
    expect(lignes[0]).toContain("fiches écrites 1");
    expect(lignes[0]).toContain("lectures en échec 0");
  });

  it("zéro fiche faute d'articles lisibles → le bilan le dit, là où l'écran ne peut rien dire", async () => {
    const journal = vi.spyOn(console, "info").mockImplementation(() => {});
    await runReadingRoom("u1", TODAY, depsBase({ rediger: vi.fn().mockResolvedValue(null) }) as any);
    const [ligne] = lignesDeBilan(journal);
    journal.mockRestore();

    expect(ligne).toContain("fiches écrites 0");
    expect(ligne).toContain("lectures en échec 1");
  });

  it("zéro fiche faute de candidats → le bilan distingue le sourcing vide de tout le reste", async () => {
    const journal = vi.spyOn(console, "info").mockImplementation(() => {});
    await runReadingRoom("u1", TODAY, depsBase({ sourcer: vi.fn().mockResolvedValue([]) }) as any);
    const [ligne] = lignesDeBilan(journal);
    journal.mockRestore();

    expect(ligne).toContain("candidats bruts 0");
    expect(ligne).toContain("au-dessus du seuil 0");
    expect(ligne).toContain("fiches écrites 0");
  });

  it("rien au-dessus du seuil → le bilan le montre : des candidats vivants, aucune note retenue", async () => {
    const journal = vi.spyOn(console, "info").mockImplementation(() => {});
    const deps = depsBase({ noter: vi.fn().mockResolvedValue([{ url: "https://media.fr/a", score: 0.4, rationale: "r" }]) });
    await runReadingRoom("u1", TODAY, deps as any);
    const [ligne] = lignesDeBilan(journal);
    journal.mockRestore();

    expect(ligne).toContain("survivants étage 1 1");
    expect(ligne).toContain("au-dessus du seuil 0");
    expect(ligne).toContain("fiches écrites 0");
  });

  // ── Repêchage : un candidat dont la lecture échoue (presse payante) ne doit pas
  // VOLER une place du plafond. Il n'écrit aucune ligne, donc son URL n'entre pas dans
  // la mémoire « déjà vu » : sans repêchage, il revient prendre la même place chaque
  // matin jusqu'à sortir de la fenêtre de 7 jours. ─────────────────────────────────────

  it("repêchage : solde de 2, trois retenus, le premier illisible → DEUX fiches écrites (le troisième est repêché)", async () => {
    // Le solde doit être STRICTEMENT inférieur au nombre de retenus, sinon le test
    // passerait aussi sans repêchage (trois retenus, un échec, deux écrites par simple
    // épuisement). Avec solde = 2, seul le repêchage peut produire deux fiches.
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      compterFichesDuJour: vi.fn().mockResolvedValue(1), // solde = 3 - 1 = 2
      rediger: vi.fn().mockImplementation(async (input: any) => {
        if (input.candidat.url === "https://media.fr/a") return null; // article payant
        return { factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" };
      }),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(2);
    expect(deps.rediger).toHaveBeenCalledTimes(3); // les trois sont tentés
    expect((deps.ecrire as any).mock.calls.map((c: any[]) => c[0].url)).toEqual([
      "https://media.fr/b",
      "https://media.fr/c",
    ]);
  });

  it("le repêchage s'arrête AU SOLDE, jamais au-delà : solde de 1, premier illisible → une fiche, et le troisième n'est même pas tenté", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      compterFichesDuJour: vi.fn().mockResolvedValue(2), // solde = 1
      rediger: vi.fn().mockImplementation(async (input: any) => {
        if (input.candidat.url === "https://media.fr/a") return null;
        return { factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" };
      }),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(1);
    expect(deps.rediger).toHaveBeenCalledTimes(2); // a (échec) puis b (écrite) — c jamais
  });

  it("candidats épuisés avant le solde → on écrit ce qu'on a, sans jamais baisser le seuil", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(), // 3 retenus, solde = 3
      rediger: vi.fn().mockImplementation(async (input: any) => {
        if (input.candidat.url === "https://media.fr/a") return null;
        return { factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" };
      }),
    });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(2);
  });

  // ── Best-effort : chaque collaborateur peut échouer, aucun ne doit faire remonter
  // d'exception ni empêcher les autres de produire leur travail. ─────────────────────

  it("expirer rejette → la revue continue quand même et produit ses fiches", async () => {
    const deps = depsBase({ expirer: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 1 });
  });

  it("compterFichesDuJour rejette → aucune fiche écrite, rien ne remonte (fail-closed)", async () => {
    const deps = depsBase({ compterFichesDuJour: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 0 });
    expect(deps.ecrire).not.toHaveBeenCalled();
  });

  it("rediger rejette pour une fiche sur trois → les deux autres sont écrites", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      rediger: vi.fn().mockImplementation(async (input: any) => {
        if (input.candidat.url === "https://media.fr/b") throw new Error("boom");
        return { factSummary: "f", whyThisBrand: "p", angle: "a", question: "q" };
      }),
    });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 2 });
    expect(deps.ecrire).toHaveBeenCalledTimes(2);
  });

  it("ecrire rejette pour une fiche → les autres sont écrites quand même", async () => {
    const deps = depsBase({
      ...deuxProjetsAvecCandidatsVivants(),
      ecrire: vi.fn().mockImplementation(async (ligne: any) => {
        if (ligne.url === "https://media.fr/b") throw new Error("boom");
      }),
    });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 2 });
    expect(deps.ecrire).toHaveBeenCalledTimes(3); // tentée pour les 3, réussie pour 2
  });

  it("projetsActifs rejette → résultat normal à zéro fiche, sans exception", async () => {
    const deps = depsBase({ projetsActifs: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 0 });
  });

  // ── L'accès aux données externes (SERP + scrape) est un collaborateur ordinaire,
  // pas une comparaison d'identité sur depsParDefaut : testable comme les autres. ────

  it("Bright Data configuré → la revue tourne normalement", async () => {
    const deps = depsBase({ accesExterneConfigure: vi.fn().mockReturnValue(true) });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 1 });
  });

  // ── Le garde-fou de dépense de usage.ts : exigé deux fois par le spec, il n'était
  // appelé nulle part dans la lecture. Sa place est APRÈS l'expiration. ─────────────

  it("plafond de dépense atteint → revue arrêtée proprement, zéro fiche, et l'expiration a quand même eu lieu", async () => {
    const deps = depsBase({ depenseBloquee: vi.fn().mockResolvedValue(true) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    // L'expiration est inconditionnelle : les fiches d'hier ne traînent pas un jour de
    // plus parce que le plafond de dépense est atteint.
    expect(deps.expirer).toHaveBeenCalledWith("u1", TODAY);
    expect(deps.projetsActifs).not.toHaveBeenCalled();
    expect(deps.sourcer).not.toHaveBeenCalled();
    expect(deps.noter).not.toHaveBeenCalled();
    expect(deps.rediger).not.toHaveBeenCalled();
    expect(deps.ecrire).not.toHaveBeenCalled();
  });

  it("le garde-fou de dépense lui-même en échec → on suppose bloqué (fail closed), sans exception", async () => {
    const deps = depsBase({ depenseBloquee: vi.fn().mockRejectedValue(new Error("base indisponible")) });
    await expect(runReadingRoom("u1", TODAY, deps as any)).resolves.toEqual({ fichesEcrites: 0 });
    expect(deps.sourcer).not.toHaveBeenCalled();
  });

  it("Bright Data non configuré → aucun sourcing, aucun appel modèle, aucune fiche, et l'expiration a quand même eu lieu", async () => {
    const deps = depsBase({ accesExterneConfigure: vi.fn().mockReturnValue(false) });
    const out = await runReadingRoom("u1", TODAY, deps as any);
    expect(out.fichesEcrites).toBe(0);
    expect(deps.expirer).toHaveBeenCalledWith("u1", TODAY);
    expect(deps.projetsActifs).not.toHaveBeenCalled();
    expect(deps.sourcer).not.toHaveBeenCalled();
    expect(deps.noter).not.toHaveBeenCalled();
  });
});
