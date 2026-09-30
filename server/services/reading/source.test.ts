import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke la SERP API (réseau) mais on garde la vraie logique de sourcing/plafond/épinglage.
vi.mock("../serp", () => ({ serpSearch: vi.fn() }));

import { parseDateRelative, sourcerCandidats, MAX_REQUETES_SERP_PAR_JOUR } from "./source";
import { serpSearch } from "../serp";

beforeEach(() => {
  vi.clearAllMocks();
});

const TODAY = new Date("2026-10-01T06:00:00Z");

describe("parseDateRelative — Google Actualités date en clair, pas en ISO", () => {
  it("lit « il y a 2 jours »", () => {
    const d = parseDateRelative("il y a 2 jours", TODAY);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit « il y a 3 heures » → aujourd'hui", () => {
    expect(parseDateRelative("il y a 3 heures", TODAY)?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("lit la forme anglaise « 2 days ago »", () => {
    expect(parseDateRelative("2 days ago", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("lit une date absolue ISO", () => {
    expect(parseDateRelative("2026-09-28", TODAY)?.toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("rend null sur une date absente ou incompréhensible — l'étage 1 écartera le candidat", () => {
    expect(parseDateRelative(undefined, TODAY)).toBeNull();
    expect(parseDateRelative("l'autre jour", TODAY)).toBeNull();
  });

  it("ne rend jamais une date future", () => {
    expect(parseDateRelative("2027-01-01", TODAY)).toBeNull();
  });

  it("ne rend jamais une Invalid Date : un nombre démesuré fait déborder le calcul vers l'infini, on rend null", () => {
    // "999999999999999999999999999999 jours" fait déborder n * jours * 24 * 3600 * 1000
    // vers Infinity ; new Date(-Infinity) est une Invalid Date, un objet TRUTHY dont
    // getTime() vaut NaN — exactement le piège que l'étage 1 du tri ne rattrape qu'en
    // seconde ligne de défense. Ici, à la source, on doit déjà rendre null.
    const d = parseDateRelative("il y a 999999999999999999999999999999 jours", TODAY);
    expect(d).toBeNull();
  });
});

describe("sourcerCandidats — épinglage, plafond dur, best-effort", () => {
  it("transmet bien l'épinglage vertical/fraîcheur/pays/langue à chaque appel SERP", async () => {
    (serpSearch as any).mockResolvedValue([]);

    await sourcerCandidats({
      userId: "u1",
      today: TODAY,
      parProjet: [{ projectId: 1, requetes: ["packaging durable 2026"] }],
    });

    expect(serpSearch).toHaveBeenCalledWith(
      "packaging durable 2026",
      "u1",
      { vertical: "news", freshness: "week", pays: "fr", langue: "fr" },
    );
  });

  it(`n'exécute jamais plus de ${MAX_REQUETES_SERP_PAR_JOUR} requêtes, même avec beaucoup plus de requêtes réparties sur plusieurs projets`, async () => {
    (serpSearch as any).mockResolvedValue([]);

    // 5 projets × 10 requêtes = 50 requêtes, largement au-dessus du plafond de 24.
    const parProjet = Array.from({ length: 5 }, (_, p) => ({
      projectId: p + 1,
      requetes: Array.from({ length: 10 }, (_, i) => `requete ${p}-${i}`),
    }));

    await sourcerCandidats({ userId: "u1", today: TODAY, parProjet });

    expect(serpSearch).toHaveBeenCalledTimes(MAX_REQUETES_SERP_PAR_JOUR);
  });

  it("tourniquet : avec vingt marques et six requêtes chacune, le plafond ampute la profondeur — AUCUNE marque n'est privée de veille", async () => {
    (serpSearch as any).mockResolvedValue([]);

    // 20 marques x 6 requêtes = 120 requêtes pour un plafond de 24. L'aplatissement
    // projet par projet ne servait que les quatre premières (4 x 6 = 24) et rien aux
    // seize autres, tous les jours, en silence.
    const parProjet = Array.from({ length: 20 }, (_, p) => ({
      projectId: p + 1,
      requetes: Array.from({ length: 6 }, (_, i) => `p${p + 1}-r${i + 1}`),
    }));

    await sourcerCandidats({ userId: "u1", today: TODAY, parProjet });

    const executees: string[] = (serpSearch as any).mock.calls.map((c: any[]) => c[0]);
    expect(executees).toHaveLength(MAX_REQUETES_SERP_PAR_JOUR);

    const marquesServies = new Set(executees.map((r) => r.split("-")[0]));
    expect(marquesServies.size).toBe(20);

    // Et c'est bien la PROFONDEUR qui est rognée : chaque marque a sa première requête,
    // les quatre premières en ont une deuxième (24 = 20 + 4), aucune n'en a trois.
    expect(executees.slice(0, 20)).toEqual(parProjet.map((p) => p.requetes[0]));
    expect(executees.slice(20)).toEqual(parProjet.slice(0, 4).map((p) => p.requetes[1]));
  });

  it("tourniquet : des marques aux nombres de requêtes inégaux ne décalent rien — on saute celles qui n'ont plus de requête à ce rang", async () => {
    (serpSearch as any).mockResolvedValue([]);
    const parProjet = [
      { projectId: 1, requetes: ["a1", "a2", "a3"] },
      { projectId: 2, requetes: ["b1"] },
      { projectId: 3, requetes: ["c1", "c2"] },
    ];

    await sourcerCandidats({ userId: "u1", today: TODAY, parProjet });

    expect((serpSearch as any).mock.calls.map((c: any[]) => c[0])).toEqual([
      "a1", "b1", "c1", // rang 1 : les trois marques
      "a2", "c2",       // rang 2 : la marque 2 n'a plus rien
      "a3",             // rang 3 : la marque 1 seule
    ]);
  });

  it("best-effort : une requête sur deux qui rejette n'empêche pas les autres de rendre leurs résultats, sans exception qui s'échappe", async () => {
    (serpSearch as any).mockImplementation(async (requete: string) => {
      if (requete === "b" || requete === "d") throw new Error("SERP indisponible");
      return [
        { link: `https://media.fr/${requete}`, title: `Titre ${requete}`, source: "Média", publishedAtRaw: "il y a 1 jour" },
      ];
    });

    const parProjet = [{ projectId: 1, requetes: ["a", "b", "c", "d"] }];

    // Si une exception s'échappait de sourcerCandidats, cet await rejetterait le test.
    const out = await sourcerCandidats({ userId: "u1", today: TODAY, parProjet });

    expect(out.map((c) => c.url).sort()).toEqual(["https://media.fr/a", "https://media.fr/c"]);
  });
});
