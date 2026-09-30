// Tests de la détection de collision d'angle entre marques liées.
//
// `../../db` est mocké sur le motif de `server/services/brand-links/articulation.test.ts`
// pour ne JAMAIS toucher la vraie base (DATABASE_URL de .env pointe vers une base
// réelle — consigne projet : aucun test n'exécute de requête réelle). Le mock capture
// la table passée à `.from()` (pour savoir QUELLE table a été interrogée, et surtout
// laquelle NE L'A PAS été — la garantie centrale de la règle 1), ainsi que les
// `orderBy`/`limit` (pour vérifier le tri et le plafond décrits dans le brief).
//
// `../claude` est mocké sur le motif de `server/services/sequence-message.test.ts` :
// seul `callClaude` est remplacé, le reste du module (CLAUDE_MODELS) reste réel.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[],
  selects: [] as any[],
  froms: [] as any[],
  wheres: [] as any[],
  orderBys: [] as any[],
  limits: [] as any[],
}));

vi.mock("../../db", () => {
  // Chaîne de constructeur de requête « tout accepte », attendable (thenable) : elle
  // rend le prochain résultat de la file, ou rejette si c'est une erreur — c'est ce
  // qui permet de simuler une base qui tombe en panne (règle 2 : best-effort).
  const chaine = (): any => {
    const suite: any = {
      from: (table: any) => {
        hoisted.froms.push(table);
        return suite;
      },
      where: (clause: any) => {
        hoisted.wheres.push(clause);
        return suite;
      },
      orderBy: (...args: any[]) => {
        hoisted.orderBys.push(args);
        return suite;
      },
      limit: (n: any) => {
        hoisted.limits.push(n);
        return suite;
      },
      then: (ok: any, ko: any) =>
        Promise.resolve()
          .then(() => {
            const r = hoisted.resultats.shift();
            if (r instanceof Error) throw r;
            return r ?? [];
          })
          .then(ok, ko),
    };
    return suite;
  };
  return {
    db: {
      select: (projection?: any) => {
        hoisted.selects.push(projection);
        return chaine();
      },
    },
  };
});

vi.mock("../claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaude: vi.fn() };
});

const { projectLinks, content, projects } = await import("@shared/schema");
const claude = await import("../claude");
const {
  parseVerdict,
  detecterCollision,
  FENETRE_JOURS,
  MAX_CONTENUS_COMPARES,
  LONGUEUR_MAX_TITRE,
} = await import("./collision");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

describe("parseVerdict — lire le jugement du modèle sans lui faire confiance", () => {
  it("lit un verdict de collision", () => {
    expect(parseVerdict('{"collision":true,"contenuId":42,"pourquoi":"les deux annoncent la méthode"}'))
      .toEqual({ contenuId: 42, pourquoi: "les deux annoncent la méthode" });
  });

  it("rend null quand le modèle dit qu'il n'y a pas de collision", () => {
    expect(parseVerdict('{"collision":false}')).toBeNull();
  });

  it("tolère le bavardage et les balises autour du JSON", () => {
    expect(parseVerdict('Voici :\n```json\n{"collision":true,"contenuId":7,"pourquoi":"r"}\n```'))
      .toEqual({ contenuId: 7, pourquoi: "r" });
  });

  it("rend null sur une sortie illisible, sans jeter", () => {
    expect(parseVerdict("je ne sais pas")).toBeNull();
    expect(parseVerdict("")).toBeNull();
  });

  it("rend null si collision est vraie mais l'identifiant absent ou non numérique — une alerte sans cible ne sert à rien", () => {
    expect(parseVerdict('{"collision":true,"pourquoi":"r"}')).toBeNull();
    expect(parseVerdict('{"collision":true,"contenuId":"quarante-deux","pourquoi":"r"}')).toBeNull();
  });

  it("accepte un verdict sans explication, en rendant une raison vide plutôt que rien", () => {
    expect(parseVerdict('{"collision":true,"contenuId":9}')).toEqual({ contenuId: 9, pourquoi: "" });
  });
});

describe("detecterCollision", () => {
  const ENTREE = {
    userId: "user-1",
    projectId: 7,
    titre: "On lance la méthode",
    corps: "Le contenu qu'on programme.",
    quand: new Date("2026-10-06T10:00:00.000Z"),
  };

  const LIEN = {
    id: 1,
    userId: "user-1",
    fromProjectId: 7,
    toProjectId: 9,
    audiencesRecoupent: true,
  };

  function voisin(over: Record<string, unknown> = {}) {
    return {
      id: 100,
      title: "On ouvre les portes",
      body: "Le contenu déjà programmé sur la marque liée.",
      projectId: 9,
      scheduledFor: new Date("2026-10-05T09:00:00.000Z"),
      ...over,
    };
  }

  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hoisted.resultats = [];
    hoisted.selects = [];
    hoisted.froms = [];
    hoisted.wheres = [];
    hoisted.orderBys = [];
    hoisted.limits = [];
    vi.clearAllMocks();
    // Restaurée dans afterEach : sans ça l'historique d'appels fuit d'un test à
    // l'autre et produit des échecs trompeurs qui accusent le code à tort — piège
    // déjà rencontré sur ce chantier.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("règle 1 — sans aucun lien aux audiences recoupées, rend null SANS interroger content ni le modèle", async () => {
    hoisted.resultats = [[]]; // la requête projectLinks ne rend rien

    const r = await detecterCollision(ENTREE);

    expect(r).toBeNull();
    expect(hoisted.froms).toEqual([projectLinks]);
    expect(hoisted.froms).not.toContain(content);
    expect(claude.callClaude).not.toHaveBeenCalled();
  });

  it("règle 1 — la requête des liens filtre bien sur l'utilisateur ET sur le recoupement d'audiences, pas seulement sur l'existence d'un lien", async () => {
    // Un test qui se contente d'un résultat câblé à [] ne prouve RIEN sur la clause
    // construite — le simulacre rendrait le même résultat que le filtre soit présent
    // ou non. On inspecte donc le SQL réellement rendu, comme pour la fenêtre de
    // dates de la requête content (voir plus bas) : c'est le seul moyen de savoir que
    // retirer `audiencesRecoupent` de la clause ferait échouer ce test.
    hoisted.resultats = [[]]; // peu importe le résultat rendu ici, seule la clause nous intéresse

    await detecterCollision(ENTREE);

    const requeteLiens = enSql(hoisted.wheres[0]);
    expect(requeteLiens.sql).toContain('"project_links"."audiences_recoupent"');
    expect(requeteLiens.sql).toContain('"project_links"."user_id"');
    expect(requeteLiens.params).toContain(true);
    expect(requeteLiens.params).toContain(ENTREE.userId);
  });

  it("sans contenu déjà programmé dans la fenêtre sur la marque liée, rend null sans appeler le modèle", async () => {
    hoisted.resultats = [[LIEN], []]; // liens, puis aucun contenu voisin

    const r = await detecterCollision(ENTREE);

    expect(r).toBeNull();
    expect(claude.callClaude).not.toHaveBeenCalled();
  });

  it("rend le plafond et le tri au constructeur de requête — MAX_CONTENUS_COMPARES, trié par date de programmation", async () => {
    hoisted.resultats = [[LIEN], []];

    await detecterCollision(ENTREE);

    expect(hoisted.limits).toContain(MAX_CONTENUS_COMPARES);
    expect(hoisted.orderBys[0]).toEqual([content.scheduledFor]);
  });

  it("règle 3 — une alerte sans cible ne sert à rien : le modèle invente un identifiant absent de la fenêtre → null", async () => {
    hoisted.resultats = [[LIEN], [voisin({ id: 100 })]];
    (claude.callClaude as any).mockResolvedValue(
      JSON.stringify({ collision: true, contenuId: 999, pourquoi: "invente" }),
    );

    const r = await detecterCollision(ENTREE);

    expect(r).toBeNull();
    // Sans cible réelle, on ne va même pas chercher le nom de la marque.
    expect(hoisted.froms).not.toContain(projects);
  });

  it("pas de collision selon le modèle → null", async () => {
    hoisted.resultats = [[LIEN], [voisin()]];
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ collision: false }));

    const r = await detecterCollision(ENTREE);

    expect(r).toBeNull();
  });

  it("collision confirmée sur un contenu réel de la fenêtre → rend la Collision complète", async () => {
    hoisted.resultats = [
      [LIEN],
      [voisin({ id: 100, scheduledFor: new Date("2026-10-05T09:00:00.000Z") })],
      [{ name: "Marque B" }],
    ];
    (claude.callClaude as any).mockResolvedValue(
      JSON.stringify({ collision: true, contenuId: 100, pourquoi: "les deux annoncent la méthode" }),
    );

    const r = await detecterCollision(ENTREE);

    expect(r).toEqual({
      contenuId: 100,
      marque: "Marque B",
      scheduledFor: new Date("2026-10-05T09:00:00.000Z"),
      pourquoi: "les deux annoncent la méthode",
    });
  });

  it("marque introuvable (cas limite) → rend quand même l'alerte, avec un nom générique plutôt que de la perdre", async () => {
    hoisted.resultats = [[LIEN], [voisin({ id: 100 })], []]; // projects ne rend rien
    (claude.callClaude as any).mockResolvedValue(
      JSON.stringify({ collision: true, contenuId: 100, pourquoi: "r" }),
    );

    const r = await detecterCollision(ENTREE);

    expect(r?.marque).toBe("une marque liée");
  });

  it("règle 2 — best-effort absolu : une base qui tombe en panne rend null et journalise, sans jeter", async () => {
    hoisted.resultats = [new Error("connexion perdue")];

    await expect(detecterCollision(ENTREE)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("détection de collision échouée"),
      expect.anything(),
    );
  });

  it("règle 2 — best-effort absolu : un appel au modèle qui échoue rend null et journalise, sans jeter", async () => {
    hoisted.resultats = [[LIEN], [voisin()]];
    (claude.callClaude as any).mockRejectedValue(new Error("délai dépassé"));

    await expect(detecterCollision(ENTREE)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("la fenêtre de comparaison encadre bien la date visée de FENETRE_JOURS de part et d'autre", async () => {
    hoisted.resultats = [[LIEN], []];

    await detecterCollision(ENTREE);

    expect(FENETRE_JOURS).toBe(7);
    // Les deux bornes de la fenêtre sont bien celles attendues, à la milliseconde.
    const attenduDebut = new Date(ENTREE.quand.getTime() - 7 * 24 * 3600 * 1000);
    const attenduFin = new Date(ENTREE.quand.getTime() + 7 * 24 * 3600 * 1000);
    const requeteContent = enSql(hoisted.wheres[1]);
    expect(requeteContent.params).toContainEqual(attenduDebut.toISOString());
    expect(requeteContent.params).toContainEqual(attenduFin.toISOString());
  });

  it("le prompt est borné aussi sur les TITRES, pas seulement sur les corps — `content.title` n'a pas de longueur maximale en base", async () => {
    const titreEnorme = "X".repeat(10_000);
    hoisted.resultats = [[LIEN], [voisin({ title: titreEnorme })]];
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({ collision: false }));

    await detecterCollision({ ...ENTREE, titre: titreEnorme });

    expect(LONGUEUR_MAX_TITRE).toBe(200);
    const appel = (claude.callClaude as any).mock.calls[0][0];
    const promptEnvoye: string = appel.messages[0].content;
    // Le titre du contenu qu'on programme comme celui du voisin sont tronqués : le
    // texte intégral de 10 000 caractères ne se retrouve nulle part dans le prompt.
    expect(promptEnvoye).not.toContain(titreEnorme);
    expect(promptEnvoye).toContain("X".repeat(LONGUEUR_MAX_TITRE));
    expect(promptEnvoye).not.toContain("X".repeat(LONGUEUR_MAX_TITRE + 1));
  });
});
