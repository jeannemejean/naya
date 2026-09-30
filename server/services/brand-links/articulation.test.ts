// Tests du service qui lit l'articulation disponible pour une marque : pour chacun
// de ses liens, les campagnes vivantes de la marque liée, réduites à ce qui peut
// entrer dans un prompt.
//
// `../../db` est mocké sur le motif de `server/routes.reading.test.ts` pour ne JAMAIS
// toucher la vraie base (DATABASE_URL de .env pointe vers une base réelle — consigne
// projet : aucun test n'exécute de requête réelle). Le mock capture la table passée à
// `.from()` (pour savoir QUELLE table a été interrogée, et surtout laquelle NE L'A PAS
// été), les clauses `where` (rendues en SQL avec le dialecte Postgres de drizzle, hors
// connexion) et la projection de colonnes passée à `.select()`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  selects: [] as any[],
  froms: [] as any[],
  wheres: [] as any[],
  orderBys: [] as any[],
  limits: [] as any[],
}));

vi.mock("../../db", () => {
  // Une chaîne de constructeur de requête « tout accepte » : chaque méthode rend la
  // même chaîne, et l'objet est attendable (thenable) — il rend le prochain résultat
  // de la file. `from` capture la table interrogée : c'est ce qui permet d'affirmer
  // qu'AUCUNE requête n'a touché `campaigns` quand la marque n'a aucun lien.
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
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
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

const { projectLinks, campaigns, projects } = await import("@shared/schema");
const {
  articulationsDisponibles,
  STATUTS_ARTICULABLES,
  PLAFOND_CAMPAGNES_PAR_LIEN,
} = await import("./articulation");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

let infoSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hoisted.resultats = [];
  hoisted.selects = [];
  hoisted.froms = [];
  hoisted.wheres = [];
  hoisted.orderBys = [];
  hoisted.limits = [];
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  // Restaure console.info entre chaque test : sans ça, `vi.spyOn` réutilise
  // l'espion déjà en place et son historique d'appels fuite d'un test à l'autre —
  // ce qui a fait exactement échouer les 2 tests ci-dessous à l'écriture.
  infoSpy.mockRestore();
});

/** Un lien tel que rendu par `db.select().from(projectLinks)...`. */
function lienRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "user-1",
    fromProjectId: 7,
    toProjectId: 9,
    roleAmont: "j'incarne, c'est moi qu'on suit",
    roleAval: "l'agence vend la méthode",
    nature: "Je suis le visage de JMD.",
    audiencesRecoupent: false,
    ...over,
  };
}

/** Une campagne telle que rendue par `db.select({...}).from(campaigns)...`. */
function campagneRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "Septembre — la méthode",
    objective: "asseoir l'autorité",
    coreMessage: "on ne vend pas une méthode, on la pratique",
    phases: [{ angle: "montrer les coulisses" }],
    ...over,
  };
}

describe("articulationsDisponibles", () => {
  it("sans aucun lien pour ce projet, rend une liste vide et NE LANCE AUCUNE requête de campagnes", async () => {
    hoisted.resultats = [[]]; // la requête projectLinks ne rend rien

    const r = await articulationsDisponibles("user-1", 7);

    expect(r).toEqual([]);
    // Une seule requête a été lancée, et c'est celle sur projectLinks : la garantie
    // du spec est qu'une marque sans lien ne paie AUCUNE requête de campagnes — donc
    // une génération strictement identique à avant ce chantier.
    expect(hoisted.froms).toEqual([projectLinks]);
    expect(hoisted.froms).not.toContain(campaigns);
  });

  it("un lien sortant (fromProjectId = la marque courante) rend le sens 'nourrit'", async () => {
    hoisted.resultats = [
      [lienRow({ fromProjectId: 7, toProjectId: 9 })],
      [{ name: "Marque B" }],
      [campagneRow()],
    ];

    const r = await articulationsDisponibles("user-1", 7);

    expect(r).toHaveLength(1);
    expect(r[0].sens).toBe("nourrit");
  });

  it("un lien entrant (toProjectId = la marque courante) rend le sens 'estNourriePar'", async () => {
    hoisted.resultats = [
      [lienRow({ fromProjectId: 9, toProjectId: 7 })],
      [{ name: "Marque B" }],
      [campagneRow()],
    ];

    const r = await articulationsDisponibles("user-1", 7);

    expect(r).toHaveLength(1);
    expect(r[0].sens).toBe("estNourriePar");
  });

  it("filtre les campagnes sur exactement draft, active, running — jamais completed", async () => {
    hoisted.resultats = [
      [lienRow()],
      [{ name: "Marque B" }],
      [], // peu importe le résultat rendu ici, seul le filtre appliqué nous intéresse
    ];

    await articulationsDisponibles("user-1", 7);

    // La 3e requête (après projectLinks puis projects) est celle sur campaigns.
    const whereCampagnes = enSql(hoisted.wheres[2]);
    expect(whereCampagnes.sql).toContain('"campaigns"."status" in');
    expect(whereCampagnes.params).toEqual(expect.arrayContaining(["draft", "active", "running"]));
    expect(whereCampagnes.params).not.toContain("completed");
    // La constante exportée est la source de vérité du filtre — si elle changeait,
    // ce test resterait vrai par construction ; on fige donc aussi sa valeur exacte.
    expect(STATUTS_ARTICULABLES).toEqual(["draft", "active", "running"]);
  });

  it("les angles viennent de anglesDepuisPhases ; un phases illisible donne []", async () => {
    hoisted.resultats = [
      [lienRow()],
      [{ name: "Marque B" }],
      [campagneRow({ phases: [{ angle: "montrer les coulisses" }, { objective: "chiffres clients" }] })],
    ];
    const r = await articulationsDisponibles("user-1", 7);
    expect(r[0].campagne.angles).toEqual(["montrer les coulisses", "chiffres clients"]);

    hoisted.resultats = [
      [lienRow()],
      [{ name: "Marque B" }],
      [campagneRow({ phases: "pas un tableau" })],
    ];
    const r2 = await articulationsDisponibles("user-1", 7);
    expect(r2[0].campagne.angles).toEqual([]);
  });

  it("l'objet campagne rendu ne porte QUE les 6 champs légitimes — aucun ADN, aucune mémoire", async () => {
    hoisted.resultats = [
      [lienRow()],
      [{ name: "Marque B" }],
      [campagneRow()],
    ];

    const r = await articulationsDisponibles("user-1", 7);

    // Un champ de plus (ou de moins) fait échouer ce test — c'est voulu : c'est la
    // garantie centrale du spec, portée ici et pas seulement par le typage.
    expect(Object.keys(r[0].campagne).sort()).toEqual(
      ["angles", "coreMessage", "id", "marque", "name", "objective"].sort(),
    );
  });

  it("projette explicitement les 5 colonnes de campaigns — jamais la ligne entière", async () => {
    hoisted.resultats = [
      [lienRow()],
      [{ name: "Marque B" }],
      [campagneRow()],
    ];

    await articulationsDisponibles("user-1", 7);

    // 1er select : projectLinks (pas de projection). 2e : projects (déjà projeté
    // avant ce correctif). 3e : campaigns — c'est celui-là qui doit être projeté.
    const projectionCampaigns = hoisted.selects[2];
    expect(projectionCampaigns).toBeTruthy();
    expect(Object.keys(projectionCampaigns).sort()).toEqual(
      ["coreMessage", "id", "name", "objective", "phases"].sort(),
    );
  });

  describe("couple réciproque (A→B ET B→A)", () => {
    // Le schéma autorise volontairement les deux sens à coexister (une relation
    // peut être mutuelle, avec des rôles différents de chaque côté). Sans
    // déduplication, la même campagne de la marque liée ressortirait deux fois —
    // une fois "nourrit", une fois "estNourriePar" — deux affirmations
    // contradictoires dans le même prompt.
    const lienSortant = lienRow({ id: 1, fromProjectId: 7, toProjectId: 9 });
    const lienEntrant = lienRow({ id: 2, fromProjectId: 9, toProjectId: 7 });

    it("ne rend qu'UNE SEULE articulation pour la campagne commune, au sens sortant", async () => {
      hoisted.resultats = [
        [lienSortant, lienEntrant],       // la requête projectLinks rend les deux liens
        [{ name: "Marque B" }],           // projects, pour le 1er lien traité (sortant)
        [campagneRow({ id: 42 })],        // campaigns, pour le 1er lien traité
        [{ name: "Marque B" }],           // projects, pour le 2e lien traité (entrant)
        [campagneRow({ id: 42 })],        // campaigns, pour le 2e lien traité — MÊME campagne
      ];

      const r = await articulationsDisponibles("user-1", 7);

      // Une seule articulation, pas deux : la campagne n'apparaît plus qu'une fois.
      expect(r).toHaveLength(1);
      expect(r[0].campagne.id).toBe(42);
      // C'est le sens sortant qui est retenu — celui déclaré depuis la page de
      // CETTE marque, donc celui que l'utilisatrice attend en travaillant dessus.
      expect(r[0].sens).toBe("nourrit");
      // Le choix n'est pas silencieux : il perd une information réelle (la
      // relation était bien réciproque), donc il est journalisé.
      expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/couple réciproque/i));
    });

    it("journalise UNE SEULE fois pour le couple, même quand PLUSIEURS campagnes sont réduites", async () => {
      // Deux campagnes communes (43 et 44) pour le même couple réciproque : sans
      // regroupement, on aurait 2 lignes de journal quasi identiques. Le spec veut
      // une ligne par COUPLE, pas une par campagne.
      hoisted.resultats = [
        [lienSortant, lienEntrant],
        [{ name: "Marque B" }],
        [campagneRow({ id: 43 }), campagneRow({ id: 44 })],
        [{ name: "Marque B" }],
        [campagneRow({ id: 43 }), campagneRow({ id: 44 })],
      ];

      const r = await articulationsDisponibles("user-1", 7);

      expect(r).toHaveLength(2); // les 2 campagnes, chacune une seule fois
      const appelsCouple = infoSpy.mock.calls.filter(([msg]) => /couple réciproque/i.test(msg));
      expect(appelsCouple).toHaveLength(1);
      // Le compte annoncé dans ce message correspond au nombre réel de campagnes
      // réduites — ici 2 — pas un texte vague.
      expect(appelsCouple[0][0]).toMatch(/2 campagne/);
    });
  });

  describe("plafond de campagnes par lien", () => {
    it("ne rend jamais plus de PLAFOND_CAMPAGNES_PAR_LIEN campagnes pour un même lien", async () => {
      expect(PLAFOND_CAMPAGNES_PAR_LIEN).toBeGreaterThan(0);

      // Simule ce qu'une vraie requête bornée par `.limit(PLAFOND + 1)` rendrait
      // quand la marque liée porte PLUS de campagnes vivantes que le plafond.
      const enTrop = Array.from({ length: PLAFOND_CAMPAGNES_PAR_LIEN + 1 }, (_, i) =>
        campagneRow({ id: 100 + i, name: `Campagne ${i}` }),
      );
      hoisted.resultats = [
        [lienRow()],
        [{ name: "Marque B" }],
        enTrop,
      ];

      const r = await articulationsDisponibles("user-1", 7);

      expect(r).toHaveLength(PLAFOND_CAMPAGNES_PAR_LIEN);
    });

    it("journalise un seuil franchi — jamais un nombre de campagnes écartées", async () => {
      // La requête n'est bornée qu'à PLAFOND + 1 : elle ne peut donc JAMAIS révéler
      // combien de campagnes dépassent réellement le plafond (6 ou 60 rendent la
      // même chose ici). Un message qui affiche quand même un nombre d'écartées
      // serait un mensonge déguisé en mesure précise — c'est exactement ce que ce
      // test interdit.
      const enTrop = Array.from({ length: PLAFOND_CAMPAGNES_PAR_LIEN + 1 }, (_, i) =>
        campagneRow({ id: 200 + i, name: `Campagne ${i}` }),
      );
      hoisted.resultats = [
        [lienRow()],
        [{ name: "Marque B" }],
        enTrop,
      ];

      await articulationsDisponibles("user-1", 7);

      const appelsPlafond = infoSpy.mock.calls.filter(([msg]) => /plafond|plus de/i.test(msg));
      expect(appelsPlafond).toHaveLength(1);
      const message = appelsPlafond[0][0] as string;
      // Un seuil franchi : la marque a PLUS de campagnes que le plafond...
      expect(message).toMatch(new RegExp(`plus de ${PLAFOND_CAMPAGNES_PAR_LIEN} campagnes vivantes`));
      // ... et le critère de ce qui est retenu.
      expect(message).toMatch(/récemment mises à jour/);
      // Jamais un décompte d'écartées : ni "N écartée(s)", ni le mot "écarté"
      // suivi d'un chiffre, qui laisserait croire à une mesure exacte qu'on n'a pas.
      expect(message).not.toMatch(/\d+\s*campagne\(?s?\)?\s*écart/i);
    });

    it("demande explicitement PLAFOND + 1 lignes à la requête campaigns (et trie pour un plafond déterministe)", async () => {
      hoisted.resultats = [
        [lienRow()],
        [{ name: "Marque B" }],
        [campagneRow()],
      ];

      await articulationsDisponibles("user-1", 7);

      expect(hoisted.limits).toContain(PLAFOND_CAMPAGNES_PAR_LIEN + 1);
      // Un ORDER BY a bien été appliqué à la requête projectLinks (déterminisme du
      // sens retenu en cas de couple réciproque) et à celle des campagnes
      // (déterminisme de ce qui est gardé quand le plafond mord).
      expect(hoisted.orderBys.length).toBeGreaterThanOrEqual(2);
    });
  });
});
