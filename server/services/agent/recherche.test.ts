// Tests de la recherche par mots et de la lecture. `../../db` est mocké : aucun test ne
// touche une vraie base (consigne projet). Le mock capture les clauses `where` et rend les
// résultats d'une file ; on rend les `where` en SQL avec le dialecte Postgres de drizzle,
// hors connexion, pour affirmer ce que chaque requête borne réellement.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  wheres: [] as any[],
  limites: [] as number[],
  ordres: [] as any[],
  executes: [] as any[],
  lignesSens: [] as any[],
  embedText: vi.fn(),
}));

vi.mock("../../db", () => {
  const chaine = (): any => {
    const suite: any = {
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
    };
    for (const m of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) {
      suite[m] = (...args: any[]) => {
        if (m === "where") hoisted.wheres.push(args[0]);
        if (m === "limit") hoisted.limites.push(args[0]);
        if (m === "orderBy") hoisted.ordres.push(args[0]);
        return suite;
      };
    }
    return suite;
  };
  return {
    db: {
      select: () => chaine(),
      execute: async (q: any) => { hoisted.executes.push(q); return { rows: hoisted.lignesSens }; },
    },
    pool: { query: vi.fn(), on: vi.fn() },
  };
});

vi.mock("../memory/embed", () => ({
  embedText: hoisted.embedText,
  embedTexts: vi.fn(),
  embedTextsParLots: vi.fn(),
  toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import {
  chercher,
  chercherParMots,
  chercherParSens,
  dateValide,
  lire,
  extraireMots,
  normaliser,
  motifIlike,
  calculerScore,
  extraireAutour,
  trierEtCouper,
  SOURCES,
  type Trouvaille,
} from "./recherche";

const dialecte = new PgDialect();
const rendre = (w: any) => dialecte.sqlToQuery(w);

beforeEach(() => {
  hoisted.resultats.length = 0;
  hoisted.wheres.length = 0;
  hoisted.limites.length = 0;
  hoisted.ordres.length = 0;
  hoisted.executes.length = 0;
  hoisted.lignesSens = [];
  hoisted.embedText.mockReset();
  hoisted.embedText.mockResolvedValue(null);
});

describe("logique pure", () => {
  it("extraireMots : 3 lettres ou plus, dédoublonnés (accents et casse ignorés), au plus 8", () => {
    expect(extraireMots("la Redéfinition de l'offre, redefinition !")).toEqual(["redefinition", "offre"]);
    expect(extraireMots("un deux trois quatre cinq six sept huit neuf dix onze")).toEqual(
      ["deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf"],
    );
    expect(extraireMots("a b de")).toEqual([]);
  });

  it("normaliser retire accents et casse en gardant la longueur", () => {
    const t = "Redéfinition ÉTÉ";
    expect(normaliser(t)).toBe("redefinition ete");
    expect(normaliser(t).length).toBe(t.length);
  });

  it("motifIlike échappe % _ et \\", () => {
    expect(motifIlike("50%_off")).toBe("%50\\%\\_off%");
    expect(motifIlike("a\\b")).toBe("%a\\\\b%");
  });

  it("calculerScore = mots trouvés / mots", () => {
    expect(calculerScore("Redéfinition de l'Offre", ["redefinition", "offre"])).toBe(1);
    expect(calculerScore("Redéfinition seule", ["redefinition", "offre"])).toBe(0.5);
  });

  it("extraireAutour : 240 caractères autour de la première occurrence, accents ignorés", () => {
    const texte = "x".repeat(500) + " Redéfinition de l'offre " + "y".repeat(500);
    const e = extraireAutour(texte, ["offre", "redefinition"]);
    expect(e.replace(/…/g, "").length).toBeLessThanOrEqual(240);
    expect(e).toContain("Redéfinition de l'offre");
    expect(extraireAutour("court", ["absent"])).toBe("court");
  });

  it("trierEtCouper : score puis date décroissante, au plus 12", () => {
    const t = (id: number, score: number, date: string): Trouvaille =>
      ({ source: "note", id, date, titre: "", projet: null, extrait: "", score });
    const tri = trierEtCouper([
      t(1, 0.5, "2026-10-01T00:00:00.000Z"),
      t(2, 1, "2026-09-01T00:00:00.000Z"),
      t(3, 1, "2026-10-15T00:00:00.000Z"),
    ]);
    expect(tri.map((x) => x.id)).toEqual([3, 2, 1]);
    const beaucoup = Array.from({ length: 20 }, (_, i) => t(i, 1, "2026-10-01T00:00:00.000Z"));
    expect(trierEtCouper(beaucoup)).toHaveLength(12);
  });
});

describe("chercherParMots", () => {
  it("trouve une réponse de tâche : titre de la tâche, date de la réponse", async () => {
    const maj = new Date("2026-10-20T09:00:00Z");
    hoisted.resultats.push([
      { id: 7, date: maj, titre: "Préparer l'atelier", projet: "Agence", texte: "Redéfinition de l'offre Accompagnement" },
    ]);
    const r = await chercherParMots("u1", "redefinition offre", { sources: ["tache_reponse"] });
    expect(r).toEqual([{
      source: "tache_reponse", id: 7, date: maj.toISOString(), titre: "Préparer l'atelier",
      projet: "Agence", extrait: "Redéfinition de l'offre Accompagnement", score: 1,
    }]);
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).toContain('"task_workspace_entries"."user_id" = $1');
    expect(q.sql).toMatch(/unaccent\(.*"task_workspace_entries"\."content".*\) ilike any\(array\[unaccent\(\$\d+\), unaccent\(\$\d+\)\]\)/);
    expect(q.params).toEqual(expect.arrayContaining(["u1", "%redefinition%", "%offre%"]));
    expect(hoisted.limites[0]).toBe(30);
  });

  it("requête vide de mots : aucun appel en base", async () => {
    expect(await chercherParMots("u1", "a de", {})).toEqual([]);
    expect(hoisted.wheres).toHaveLength(0);
  });

  it("chaque source est cloisonnée par l'utilisatrice, la mémoire exclut le périmé", async () => {
    await chercherParMots("u1", "offre", {});
    expect(hoisted.wheres).toHaveLength(SOURCES.length);
    const parSource = Object.fromEntries(SOURCES.map((s, i) => [s, rendre(hoisted.wheres[i])]));
    const tables: Record<string, string> = {
      tache_reponse: "task_workspace_entries", livrable: "livrables", note: "quick_capture_entries",
      memoire: "memory_entries", conversation: "companion_conversations", contenu: "content",
      tache: "tasks", reponse_prospect: "inbox_conversations",
    };
    for (const s of SOURCES) {
      const q = parSource[s];
      expect(q.sql, s).toContain(`"${tables[s]}"."user_id" = $1`);
      expect(q.params[0], s).toBe("u1");
      expect(q.sql, s).toContain("ilike any(array[unaccent(");
      expect(q.params, s).toContain("%offre%");
    }
    expect(parSource.memoire.sql).toContain('"memory_entries"."superseded_at" is null');
    expect(parSource.contenu.sql).toContain('"content"."title"');
    expect(parSource.contenu.sql).toContain('"content"."body"');
    expect(parSource.tache.sql).toContain('"tasks"."description"');
    expect(parSource.reponse_prospect.sql).toContain('"inbox_messages"."subject"');
    expect(parSource.reponse_prospect.sql).toContain('"inbox_messages"."body"');
  });

  it("l'entrée utilisateur ne passe que par des paramètres liés", async () => {
    await chercherParMots("u1", "robert'); drop table tasks; --", { sources: ["note"] });
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).not.toContain("drop");
    expect(q.params).toEqual(expect.arrayContaining(["u1", "%robert%", "%drop%", "%table%", "%tasks%"]));
  });

  it("depuis / jusqua bornent la date, projetId filtre le projet", async () => {
    await chercherParMots("u1", "offre", { sources: ["tache_reponse", "reponse_prospect"], depuis: "2026-10-01", jusqua: "2026-10-31", projetId: 4 });
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).toContain('"task_workspace_entries"."updated_at" >= $');
    expect(q.sql).toMatch(/"task_workspace_entries"\."updated_at" < \(\$\d+::date \+ interval '1 day'\)/);
    expect(q.params).toEqual(expect.arrayContaining(["2026-10-01", "2026-10-31", 4]));
    const p = rendre(hoisted.wheres[1]);
    expect(p.sql).toContain('"inbox_messages"."sent_at" >= $');
    expect(p.sql).toContain('"inbox_conversations"."project_id" = $');
  });

  it("avec projetId, les conversations (sans projet) ne sont pas interrogées", async () => {
    await chercherParMots("u1", "offre", { sources: ["conversation", "note"], projetId: 4 });
    expect(hoisted.wheres).toHaveLength(1);
    expect(rendre(hoisted.wheres[0]).sql).toContain('"quick_capture_entries"');
  });
});

describe("dates des filtres", () => {
  it("dateValide : YYYY-MM-DD strict, date de calendrier réelle", () => {
    expect(dateValide("2026-10-01")).toBe(true);
    expect(dateValide("2024-02-29")).toBe(true);
    expect(dateValide("2026-02-30")).toBe(false);
    expect(dateValide("2026-13-01")).toBe(false);
    expect(dateValide("2026-1-01")).toBe(false);
    expect(dateValide("hier")).toBe(false);
    expect(dateValide("2026-10-01T00:00:00Z")).toBe(false);
  });

  it("une date invalide est ignorée : elle n'entre pas en SQL, la recherche passe", async () => {
    await chercherParMots("u1", "offre", { sources: ["note"], depuis: "la semaine dernière", jusqua: "2026-02-30" });
    const q = rendre(hoisted.wheres[0]);
    expect(q.sql).not.toContain("::date");
    expect(q.params).not.toContain("la semaine dernière");
    expect(q.params).not.toContain("2026-02-30");
  });

  it("une date valide à côté d'une invalide est gardée", async () => {
    await chercherParMots("u1", "offre", { sources: ["note"], depuis: "2026-10-01", jusqua: "n'importe" });
    const q = rendre(hoisted.wheres[0]);
    expect(q.params).toContain("2026-10-01");
    expect(q.sql).not.toContain("interval '1 day'");
  });
});

describe("ordre par source", () => {
  it("livrable et contenu sont triés sur coalesce(updated_at, created_at), nuls en dernier", async () => {
    await chercherParMots("u1", "offre", { sources: ["livrable", "contenu"] });
    const l = rendre(hoisted.ordres[0]).sql;
    const c = rendre(hoisted.ordres[1]).sql;
    expect(l).toBe('coalesce("livrables"."updated_at", "livrables"."created_at") desc nulls last');
    expect(c).toBe('coalesce("content"."updated_at", "content"."created_at") desc nulls last');
  });
});

describe("chercherParSens", () => {
  it("sans embedding de la requête (pas de clé, service en panne) : [] sans requête", async () => {
    expect(await chercherParSens("u1", "offre", {})).toEqual([]);
    expect(hoisted.executes).toHaveLength(0);
  });

  it("une seule requête : 15 plus proches de recherche_embeddings + 10 de memory_entries, bornées", async () => {
    hoisted.embedText.mockResolvedValue([0.1, 0.2]);
    await chercherParSens("u1", "offre", {});
    expect(hoisted.executes).toHaveLength(1);
    const q = rendre(hoisted.executes[0]);
    const s = q.sql.toLowerCase();
    expect(s).toContain("from recherche_embeddings");
    expect(s).toContain("from memory_entries");
    expect(s).toContain("superseded_at is null");
    expect(s).toMatch(/embedding <=> \$\d+::vector/);
    expect(s).not.toContain("inbox");
    expect(q.params.filter((p) => p === "u1")).toHaveLength(2);
    expect(q.params).toEqual(expect.arrayContaining(["[0.1,0.2]", 15, 10]));
  });

  it("relit les lignes sources (titre, extrait), score = 1 - distance, sous 0.35 ignoré", async () => {
    hoisted.embedText.mockResolvedValue([0.1]);
    hoisted.lignesSens = [
      { source: "note", id: 4, distance: 0.2 },
      { source: "memoire", id: 9, distance: 0.4 },
      { source: "livrable", id: 5, distance: 0.7 }, // score 0.3 : ignoré
    ];
    hoisted.resultats.push([{ id: 4, date: new Date("2026-10-01T00:00:00Z"), titre: null, projet: "Agence", texte: "Repenser l'accompagnement" }]);
    hoisted.resultats.push([{ id: 9, date: new Date("2026-09-01T00:00:00Z"), titre: "fait", projet: null, texte: "Elle préfère les ateliers" }]);
    const r = await chercherParSens("u1", "offre", {});
    expect(r.map((x) => [x.source, x.id, Number(x.score.toFixed(2))])).toEqual([["note", 4, 0.8], ["memoire", 9, 0.6]]);
    expect(r[0].titre).toBe("Note : Repenser l'accompagnement");
    expect(r[0].extrait).toBe("Repenser l'accompagnement");
    expect(r[0].projet).toBe("Agence");
    // Relecture cloisonnée, une requête par source retenue.
    expect(hoisted.wheres).toHaveLength(2);
    for (const w of hoisted.wheres) expect(rendre(w).params).toContain("u1");
    expect(rendre(hoisted.wheres[0]).sql).toContain('"quick_capture_entries"."id" in');
  });

  it("filtres : sources limitées, dates et projet appliqués à la relecture", async () => {
    hoisted.embedText.mockResolvedValue([0.1]);
    hoisted.lignesSens = [{ source: "note", id: 4, distance: 0.1 }];
    hoisted.resultats.push([]);
    const r = await chercherParSens("u1", "offre", { sources: ["note"], depuis: "2026-10-01", projetId: 3 });
    expect(r).toEqual([]);
    const s = rendre(hoisted.executes[0]).sql.toLowerCase();
    expect(s).not.toContain("memory_entries");
    expect(s).toContain("source in");
    const w = rendre(hoisted.wheres[0]);
    expect(w.params).toEqual(expect.arrayContaining(["u1", "2026-10-01", 3]));
  });

  it("sources sans rien d'embeddé (tache, contenu…) : aucune requête", async () => {
    hoisted.embedText.mockResolvedValue([0.1]);
    expect(await chercherParSens("u1", "offre", { sources: ["tache", "reponse_prospect"] })).toEqual([]);
    expect(hoisted.executes).toHaveLength(0);
  });
});

describe("chercher", () => {
  const motsNote = () =>
    hoisted.resultats.push([{ id: 1, date: new Date("2026-10-01T00:00:00Z"), titre: "n", projet: null, texte: "offre" }]);

  it("parSens qui lève : les résultats par mots reviennent quand même", async () => {
    motsNote();
    const r = await chercher("u1", "offre", { sources: ["note"] }, { parSens: async () => { throw new Error("down"); } });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it("parSens qui renvoie [] : les résultats par mots", async () => {
    motsNote();
    const r = await chercher("u1", "offre", { sources: ["note"] }, { parSens: async () => [] });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it("sans clé OpenAI (parSens par défaut, embedText null) : les résultats par mots", async () => {
    motsNote();
    const r = await chercher("u1", "offre", { sources: ["note"] });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it("fusion : un même élément n'apparaît qu'une fois, score = max", async () => {
    hoisted.resultats.push([
      { id: 1, date: new Date("2026-10-01T00:00:00Z"), titre: null, projet: null, texte: "offre accompagnement" },
      { id: 2, date: new Date("2026-10-02T00:00:00Z"), titre: null, projet: null, texte: "offre" },
    ]);
    const sens: Trouvaille[] = [
      { source: "note", id: 1, date: "2026-10-01T00:00:00.000Z", titre: "Note : x", projet: null, extrait: "x", score: 0.9 },
      { source: "note", id: 2, date: "2026-10-02T00:00:00.000Z", titre: "Note : y", projet: null, extrait: "y", score: 0.4 },
      { source: "memoire", id: 7, date: "2026-09-01T00:00:00.000Z", titre: "Mémoire", projet: null, extrait: "z", score: 0.5 },
    ];
    const r = await chercher("u1", "offre accompagnement", { sources: ["note"] }, { parSens: async () => sens });
    expect(r.map((x) => [x.source, x.id, x.score])).toEqual([["note", 1, 1], ["note", 2, 0.5], ["memoire", 7, 0.5]]);
  });

  it("un élément trouvé seulement par sens garde son score", async () => {
    hoisted.resultats.push([]);
    const sens: Trouvaille[] = [{ source: "note", id: 3, date: "", titre: "t", projet: null, extrait: "e", score: 0.95 }];
    const r = await chercher("u1", "offre", { sources: ["note"] }, { parSens: async () => sens });
    expect(r).toEqual(sens);
  });
});

describe("lire", () => {
  it("tache_reponse : la tâche, sa date prévue et toutes ses réponses, bornées à l'utilisatrice", async () => {
    hoisted.resultats.push([{ id: 7, taskId: 3 }]);
    hoisted.resultats.push([{ title: "Préparer l'atelier", scheduledDate: "2026-10-22", dueDate: null, projet: "Agence" }]);
    hoisted.resultats.push([
      { content: "Première réponse", updatedAt: new Date("2026-10-18T08:00:00Z") },
      { content: "Redéfinition de l'offre", updatedAt: new Date("2026-10-20T09:00:00Z") },
    ]);
    const r = await lire("u1", "tache_reponse", 7);
    expect(r?.titre).toBe("Préparer l'atelier");
    expect(r?.projet).toBe("Agence");
    expect(r?.contenu).toContain("2026-10-22");
    expect(r?.contenu).toContain("Première réponse");
    expect(r?.contenu).toContain("Redéfinition de l'offre");
    for (const w of hoisted.wheres) expect(rendre(w).params).toContain("u1");
  });

  it("l'élément d'une autre utilisatrice : null", async () => {
    for (const s of SOURCES) {
      hoisted.resultats.push([]);
      expect(await lire("autre", s, 7), s).toBeNull();
    }
    for (const w of hoisted.wheres) {
      const q = rendre(w);
      expect(q.sql).toContain('"user_id" = $');
      expect(q.params).toContain("autre");
    }
  });

  it("reponse_prospect est cloisonnée par inbox_conversations.user_id", async () => {
    hoisted.resultats.push([]);
    await lire("u1", "reponse_prospect", 5);
    expect(rendre(hoisted.wheres[0]).sql).toContain('"inbox_conversations"."user_id" = $');
  });
});
