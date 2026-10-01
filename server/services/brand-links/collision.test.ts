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
// seuls `callClaude` (chemin singulier, `detecterCollision`) et `callClaudeDetailed`
// (chemin en lot, `detecterCollisionLot` — qui doit lire `stopReason` pour détecter une
// réponse tronquée, motif repris de `server/services/content-import/import.test.ts`)
// sont remplacés ; le reste du module (CLAUDE_MODELS) reste réel.
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
  return { ...actual, callClaude: vi.fn(), callClaudeDetailed: vi.fn() };
});

const { projectLinks, content, projects } = await import("@shared/schema");
const claude = await import("../claude");
const {
  parseVerdict,
  detecterCollision,
  FENETRE_JOURS,
  MAX_CONTENUS_COMPARES,
  LONGUEUR_MAX_TITRE,
  parseVerdictLot,
  detecterCollisionLot,
  PLAFOND_POSTS_LOT,
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

  it("rend null si collision est vraie mais l'identifiant absent ou non interprétable — une alerte sans cible ne sert à rien", () => {
    expect(parseVerdict('{"collision":true,"pourquoi":"r"}')).toBeNull();
    // "quarante-deux" ne contient AUCUN chiffre : il n'y a rien à en extraire, et on ne
    // devine pas — c'est différent d'un identifiant juste mal ponctué (voir plus bas).
    expect(parseVerdict('{"collision":true,"contenuId":"quarante-deux","pourquoi":"r"}')).toBeNull();
  });

  it("accepte un verdict sans explication, en rendant une raison vide plutôt que rien", () => {
    expect(parseVerdict('{"collision":true,"contenuId":9}')).toEqual({ contenuId: 9, pourquoi: "" });
  });

  describe("tolère la ponctuation recopiée depuis la présentation qu'on montre au modèle", () => {
    // Incident réel contre la vraie base et le vrai modèle : la liste des voisins
    // présentait chaque contenu comme "[1] Titre", et le modèle a recopié la notation
    // telle quelle dans sa réponse : `"contenuId": "[1]"`. `parseVerdict` l'exigeait
    // strictement numérique et rejetait donc une collision pourtant correctement
    // détectée et expliquée — en silence, sans aucune erreur ni test rouge.
    it('lit un identifiant encadré de crochets, tel que recopié depuis la présentation "[1] Titre"', () => {
      expect(parseVerdict('{"collision":true,"contenuId":"[1]","pourquoi":"copie exacte"}'))
        .toEqual({ contenuId: 1, pourquoi: "copie exacte" });
    });

    it("lit un identifiant donné comme chaîne numérique simple", () => {
      expect(parseVerdict('{"collision":true,"contenuId":"42","pourquoi":"r"}'))
        .toEqual({ contenuId: 42, pourquoi: "r" });
    });

    it("lit un identifiant noyé dans du texte autour du chiffre", () => {
      expect(parseVerdict('{"collision":true,"contenuId":"Identifiant : 7","pourquoi":"r"}'))
        .toEqual({ contenuId: 7, pourquoi: "r" });
    });
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

  it("règle 3 — un identifiant ponctué mais extrait reste rejeté s'il ne correspond à AUCUN voisin réel", async () => {
    // L'extraction tolérante (parseVerdict) ne remplace pas le filtre final : un
    // identifiant "[999]" devient bien 999, mais 999 n'est toujours la cible d'aucun
    // contenu réel de la fenêtre — donc toujours pas d'alerte.
    hoisted.resultats = [[LIEN], [voisin({ id: 100 })]];
    (claude.callClaude as any).mockResolvedValue(
      JSON.stringify({ collision: true, contenuId: "[999]", pourquoi: "invente, et ponctué" }),
    );

    const r = await detecterCollision(ENTREE);

    expect(r).toBeNull();
    expect(hoisted.froms).not.toContain(projects);
  });

  it("régression de l'incident réel : le modèle recopie la présentation (\"[1]\") et la collision est tout de même relayée", async () => {
    hoisted.resultats = [
      [LIEN],
      [voisin({ id: 1, scheduledFor: new Date("2026-10-05T09:00:00.000Z") })],
      [{ name: "Marque B" }],
    ];
    (claude.callClaude as any).mockResolvedValue(JSON.stringify({
      collision: true,
      contenuId: "[1]",
      pourquoi: "Le contenu programmé [1] est une copie exacte du contenu qu'on veut programmer.",
    }));

    const r = await detecterCollision(ENTREE);

    expect(r).toEqual({
      contenuId: 1,
      marque: "Marque B",
      scheduledFor: new Date("2026-10-05T09:00:00.000Z"),
      pourquoi: "Le contenu programmé [1] est une copie exacte du contenu qu'on veut programmer.",
    });
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

describe("parseVerdictLot — lire le verdict du modèle pour un LOT de couples", () => {
  const idsNouveaux = new Set([410, 411, 412]);
  const idsVoisins = new Set([900, 901]);

  it("lit un tableau de collisions et rend les couples valides", () => {
    const raw = JSON.stringify({
      collisions: [
        { nouveauId: 410, contenuId: 900, pourquoi: "même angle" },
        { nouveauId: 412, contenuId: 901, pourquoi: "autre angle" },
      ],
    });
    expect(parseVerdictLot(raw, idsNouveaux, idsVoisins)).toEqual([
      { nouveauId: 410, contenuId: 900, pourquoi: "même angle" },
      { nouveauId: 412, contenuId: 901, pourquoi: "autre angle" },
    ]);
  });

  it("écarte un couple dont nouveauId n'appartient pas aux nouveaux contenus envoyés", () => {
    const raw = JSON.stringify({ collisions: [{ nouveauId: 999, contenuId: 900, pourquoi: "invente" }] });
    expect(parseVerdictLot(raw, idsNouveaux, idsVoisins)).toEqual([]);
  });

  it("écarte un couple dont contenuId n'appartient pas aux voisins réels", () => {
    const raw = JSON.stringify({ collisions: [{ nouveauId: 410, contenuId: 999, pourquoi: "invente" }] });
    expect(parseVerdictLot(raw, idsNouveaux, idsVoisins)).toEqual([]);
  });

  it('tolère la ponctuation recopiée depuis la présentation, "[412]" est accepté comme 412', () => {
    const raw = JSON.stringify({ collisions: [{ nouveauId: "[412]", contenuId: 900, pourquoi: "copie exacte" }] });
    expect(parseVerdictLot(raw, idsNouveaux, idsVoisins)).toEqual([
      { nouveauId: 412, contenuId: 900, pourquoi: "copie exacte" },
    ]);
  });

  it("rend [] pour un lot sans collision, et pour une sortie illisible, sans jeter", () => {
    expect(parseVerdictLot(JSON.stringify({ collisions: [] }), idsNouveaux, idsVoisins)).toEqual([]);
    expect(parseVerdictLot("je ne sais pas", idsNouveaux, idsVoisins)).toEqual([]);
    expect(parseVerdictLot("", idsNouveaux, idsVoisins)).toEqual([]);
  });

  it("rend [] si le champ \"collisions\" n'est pas un tableau (ni une chaîne, ni null)", () => {
    expect(parseVerdictLot(JSON.stringify({ collisions: "pas un tableau" }), idsNouveaux, idsVoisins)).toEqual([]);
    // `null` est le cas qui mord vraiment : une CHAÎNE est itérable caractère par
    // caractère dans un `for...of`, donc retombe sur `[]` même SANS le garde
    // `Array.isArray` (chaque caractère n'a pas de `nouveauId`/`contenuId`, donc est
    // ignoré — le test passerait par accident). `null` n'est PAS itérable : sans le
    // garde, `for (const item of o.collisions)` lève une `TypeError` au lieu de rendre
    // `[]`. C'est ce second cas qui prouve que le garde existe et fait son travail.
    expect(parseVerdictLot(JSON.stringify({ collisions: null }), idsNouveaux, idsVoisins)).toEqual([]);
  });

  it("un couple dont l'un des deux identifiants est inventé est écarté EN ENTIER — la tolérance de ponctuation ne remplace pas la vérification d'existence", () => {
    const raw = JSON.stringify({
      collisions: [
        { nouveauId: 410, contenuId: 900, pourquoi: "valide" },
        { nouveauId: 410, contenuId: 999, pourquoi: "contenuId inventé" },
        { nouveauId: 999, contenuId: 900, pourquoi: "nouveauId inventé" },
      ],
    });
    expect(parseVerdictLot(raw, idsNouveaux, idsVoisins)).toEqual([
      { nouveauId: 410, contenuId: 900, pourquoi: "valide" },
    ]);
  });
});

/**
 * Ce que rend `callClaudeDetailed` : le texte brut et le `stopReason`. Motif repris de
 * `server/services/content-import/import.test.ts` — `detecterCollisionLot` doit lire
 * `stopReason` (et pas seulement le texte, comme `callClaude`) pour détecter une
 * réponse tronquée au lieu de la confondre avec "aucune collision".
 */
function reponseModeleLot(raw: string, stopReason?: string) {
  return { text: raw, stopReason };
}

describe("detecterCollisionLot", () => {
  const POSTS = [
    {
      id: 410,
      titre: "On lance la méthode",
      corps: "Le premier contenu du lot qu'on programme.",
      quand: new Date("2026-10-06T10:00:00.000Z"),
    },
    {
      id: 411,
      titre: "Un deuxième post du lot",
      corps: "Le second contenu du lot qu'on programme.",
      quand: new Date("2026-10-08T10:00:00.000Z"),
    },
  ];

  const ENTREE_LOT = { userId: "user-1", projectId: 7, posts: POSTS };

  const LIEN = {
    id: 1,
    userId: "user-1",
    fromProjectId: 7,
    toProjectId: 9,
    audiencesRecoupent: true,
  };

  function voisin(over: Record<string, unknown> = {}) {
    return {
      id: 900,
      title: "On ouvre les portes",
      body: "Le contenu déjà programmé sur la marque liée.",
      projectId: 9,
      scheduledFor: new Date("2026-10-07T09:00:00.000Z"),
      ...over,
    };
  }

  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    hoisted.resultats = [];
    hoisted.selects = [];
    hoisted.froms = [];
    hoisted.wheres = [];
    hoisted.orderBys = [];
    hoisted.limits = [];
    vi.clearAllMocks();
    // Restaurés dans afterEach — même piège que pour `detecterCollision` : un spy qui
    // fuit d'un test à l'autre produit des échecs trompeurs qui accusent le code à tort.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("règle 1 — sans aucun lien aux audiences recoupées, rend [] SANS interroger content ni le modèle", async () => {
    hoisted.resultats = [[]]; // la requête projectLinks ne rend rien

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r).toEqual([]);
    expect(hoisted.froms).toEqual([projectLinks]);
    expect(hoisted.froms).not.toContain(content);
    expect(claude.callClaudeDetailed).not.toHaveBeenCalled();
  });

  it("un lot vide rend [] sans interroger quoi que ce soit", async () => {
    const r = await detecterCollisionLot({ userId: "user-1", projectId: 7, posts: [] });

    expect(r).toEqual([]);
    expect(hoisted.froms).toEqual([]);
    expect(claude.callClaudeDetailed).not.toHaveBeenCalled();
  });

  it("sans contenu déjà programmé dans la fenêtre sur la marque liée, rend [] sans appeler le modèle", async () => {
    hoisted.resultats = [[LIEN], []]; // liens, puis aucun contenu voisin

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r).toEqual([]);
    expect(claude.callClaudeDetailed).not.toHaveBeenCalled();
  });

  it("la fenêtre de comparaison couvre l'AMPLITUDE du lot entier, pas la date d'un seul post", async () => {
    hoisted.resultats = [[LIEN], []];

    await detecterCollisionLot(ENTREE_LOT);

    // POSTS[0] est le plus ancien, POSTS[1] le plus récent : la fenêtre doit encadrer
    // les DEUX bornes du lot, chacune élargie de FENETRE_JOURS.
    const attenduDebut = new Date(POSTS[0].quand.getTime() - FENETRE_JOURS * 24 * 3600 * 1000);
    const attenduFin = new Date(POSTS[1].quand.getTime() + FENETRE_JOURS * 24 * 3600 * 1000);
    const requeteContent = enSql(hoisted.wheres[1]);
    expect(requeteContent.params).toContainEqual(attenduDebut.toISOString());
    expect(requeteContent.params).toContainEqual(attenduFin.toISOString());
  });

  it("au-delà de PLAFOND_POSTS_LOT, les posts envoyés au modèle sont bornés et le journal dit le nombre RÉEL écarté", async () => {
    const nombreTotal = PLAFOND_POSTS_LOT + 3;
    const beaucoupDePosts = Array.from({ length: nombreTotal }, (_, i) => ({
      id: 500 + i,
      titre: `Post ${i}`,
      corps: `Corps ${i}`,
      quand: new Date(Date.now() + i * 1000),
    }));
    hoisted.resultats = [[LIEN], [voisin()]];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({ collisions: [] })));

    await detecterCollisionLot({ userId: "user-1", projectId: 7, posts: beaucoupDePosts });

    const appel = (claude.callClaudeDetailed as any).mock.calls[0][0];
    const promptEnvoye: string = appel.messages[0].content;
    for (let i = 0; i < PLAFOND_POSTS_LOT; i++) {
      expect(promptEnvoye).toContain(`Nouveau contenu : ${500 + i}`);
    }
    for (let i = PLAFOND_POSTS_LOT; i < nombreTotal; i++) {
      expect(promptEnvoye).not.toContain(`Nouveau contenu : ${500 + i}`);
    }

    const appelsPlafond = infoSpy.mock.calls.filter(([msg]) => /écarté/i.test(String(msg)));
    expect(appelsPlafond).toHaveLength(1);
    // Le compte est RÉEL (3), pas une approximation — `beaucoupDePosts` est un tableau
    // en mémoire dont la longueur exacte est connue, contrairement à une requête
    // bornée par un simple LIMIT.
    expect(appelsPlafond[0][0]).toContain(`${nombreTotal - PLAFOND_POSTS_LOT} post(s) écarté(s)`);
  });

  it("un couple dont le nouveauId appartient à un post ÉCARTÉ par le plafond (jamais envoyé) est rejeté", async () => {
    const nombreTotal = PLAFOND_POSTS_LOT + 1;
    const beaucoupDePosts = Array.from({ length: nombreTotal }, (_, i) => ({
      id: 500 + i,
      titre: `Post ${i}`,
      corps: `Corps ${i}`,
      quand: new Date(Date.now() + i * 1000),
    }));
    const idEcarte = 500 + PLAFOND_POSTS_LOT; // le dernier, au-delà du plafond
    hoisted.resultats = [[LIEN], [voisin({ id: 900 })]];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({
      collisions: [{ nouveauId: idEcarte, contenuId: 900, pourquoi: "invente un post jamais envoyé" }],
    })));

    const r = await detecterCollisionLot({ userId: "user-1", projectId: 7, posts: beaucoupDePosts });

    expect(r).toEqual([]);
  });

  it("règle 2 — best-effort absolu : une base qui tombe en panne rend [] et journalise, sans jeter", async () => {
    hoisted.resultats = [new Error("connexion perdue")];

    await expect(detecterCollisionLot(ENTREE_LOT)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("détection de collision en lot échouée"),
      expect.anything(),
    );
  });

  it("règle 2 — best-effort absolu : un appel au modèle qui échoue rend [] et journalise, sans jeter", async () => {
    hoisted.resultats = [[LIEN], [voisin()]];
    (claude.callClaudeDetailed as any).mockRejectedValue(new Error("délai dépassé"));

    await expect(detecterCollisionLot(ENTREE_LOT)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("une réponse du modèle illisible rend [] sans jeter", async () => {
    hoisted.resultats = [[LIEN], [voisin()]];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot("je ne sais pas"));

    await expect(detecterCollisionLot(ENTREE_LOT)).resolves.toEqual([]);
  });

  it("collision confirmée sur un couple réel → rend le CollisionLot complet, avec les VRAIS identifiants des deux côtés", async () => {
    hoisted.resultats = [
      [LIEN],
      [voisin({ id: 900, projectId: 9, scheduledFor: new Date("2026-10-07T09:00:00.000Z") })],
      [{ id: 9, name: "Marque B" }],
    ];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({
      collisions: [{ nouveauId: 411, contenuId: 900, pourquoi: "les deux annoncent la méthode" }],
    })));

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r).toEqual([{
      nouveauId: 411,
      contenuId: 900,
      marque: "Marque B",
      scheduledFor: new Date("2026-10-07T09:00:00.000Z"),
      pourquoi: "les deux annoncent la méthode",
    }]);
  });

  it("plusieurs collisions dans le même lot sont toutes rendues, chacune avec ses propres identifiants réels", async () => {
    hoisted.resultats = [
      [LIEN],
      [
        voisin({ id: 900, projectId: 9, scheduledFor: new Date("2026-10-05T09:00:00.000Z") }),
        voisin({ id: 901, title: "La formation ouvre ses portes", projectId: 9, scheduledFor: new Date("2026-10-09T09:00:00.000Z") }),
      ],
      [{ id: 9, name: "Marque B" }],
    ];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({
      collisions: [
        { nouveauId: 410, contenuId: 900, pourquoi: "même angle, premier couple" },
        { nouveauId: 411, contenuId: 901, pourquoi: "même angle, second couple" },
      ],
    })));

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r).toEqual([
      {
        nouveauId: 410, contenuId: 900, marque: "Marque B",
        scheduledFor: new Date("2026-10-05T09:00:00.000Z"),
        pourquoi: "même angle, premier couple",
      },
      {
        nouveauId: 411, contenuId: 901, marque: "Marque B",
        scheduledFor: new Date("2026-10-09T09:00:00.000Z"),
        pourquoi: "même angle, second couple",
      },
    ]);
  });

  it("marque introuvable (cas limite) → rend quand même l'alerte, avec un nom générique plutôt que de la perdre", async () => {
    hoisted.resultats = [[LIEN], [voisin({ id: 900 })], []]; // projects ne rend rien
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({
      collisions: [{ nouveauId: 410, contenuId: 900, pourquoi: "r" }],
    })));

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r[0]?.marque).toBe("une marque liée");
  });

  it("aucun couple valide dans le verdict → rend [] sans interroger projects pour le nom de la marque", async () => {
    hoisted.resultats = [[LIEN], [voisin({ id: 900 })]];
    (claude.callClaudeDetailed as any).mockResolvedValue(reponseModeleLot(JSON.stringify({
      collisions: [{ nouveauId: 999, contenuId: 900, pourquoi: "nouveauId inventé" }],
    })));

    const r = await detecterCollisionLot(ENTREE_LOT);

    expect(r).toEqual([]);
    expect(hoisted.froms).not.toContain(projects);
  });

  describe("troncature de la réponse du modèle", () => {
    // DEUX valeurs, pas une (motif `server/services/content-import/import.test.ts`) :
    // les providers ne nomment pas la troncature de la même façon. Sans ce garde, une
    // réponse coupée produit un JSON illisible, `parseVerdictLot` rend `[]`, et "aucune
    // collision" devient un énoncé FAUX présenté comme un résultat, en silence.
    it.each(["max_tokens", "length"])(
      "une réponse tronquée (%s) rend [] mais le journalise EXPLICITEMENT comme une troncature, pas comme une absence de collision",
      async (stopReason) => {
        hoisted.resultats = [[LIEN], [voisin({ id: 900 })]];
        // JSON réellement incomplet : la coupure est au milieu d'une chaîne, sans
        // accolade fermante — `parseVerdictLot` ne peut pas le lire.
        (claude.callClaudeDetailed as any).mockResolvedValue(
          reponseModeleLot('{"collisions": [{"nouveauId": 410, "contenuId": 900, "pourq', stopReason),
        );

        const r = await detecterCollisionLot(ENTREE_LOT);

        expect(r).toEqual([]);
        const appelsTroncature = infoSpy.mock.calls.filter(([msg]) => /tronqu/i.test(String(msg)));
        expect(appelsTroncature).toHaveLength(1);
        expect(appelsTroncature[0][0]).toContain(stopReason);
      },
    );

    it("une réponse complète (stopReason \"end_turn\") ne journalise AUCUNE troncature", async () => {
      hoisted.resultats = [[LIEN], [voisin()]];
      (claude.callClaudeDetailed as any).mockResolvedValue(
        reponseModeleLot(JSON.stringify({ collisions: [] }), "end_turn"),
      );

      await detecterCollisionLot(ENTREE_LOT);

      const appelsTroncature = infoSpy.mock.calls.filter(([msg]) => /tronqu/i.test(String(msg)));
      expect(appelsTroncature).toHaveLength(0);
    });
  });
});
