// Tests du service qui lit l'articulation disponible pour une marque : pour chacun
// de ses liens, les campagnes vivantes de la marque liée, réduites à ce qui peut
// entrer dans un prompt.
//
// `../../db` est mocké sur le motif de `server/routes.reading.test.ts` pour ne JAMAIS
// toucher la vraie base (DATABASE_URL de .env pointe vers une base réelle — consigne
// projet : aucun test n'exécute de requête réelle). Le mock capture la table passée à
// `.from()` (pour savoir QUELLE table a été interrogée, et surtout laquelle NE L'A PAS
// été) et les clauses `where` (rendues en SQL avec le dialecte Postgres de drizzle,
// hors connexion, pour affirmer ce que les requêtes bornent RÉELLEMENT).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const hoisted = vi.hoisted(() => ({
  resultats: [] as any[][],
  froms: [] as any[],
  wheres: [] as any[],
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
      then: (ok: any, ko: any) => Promise.resolve(hoisted.resultats.shift() ?? []).then(ok, ko),
    };
    return suite;
  };
  return {
    db: { select: (..._args: any[]) => chaine() },
  };
});

const { projectLinks, campaigns, projects } = await import("@shared/schema");
const { articulationsDisponibles, STATUTS_ARTICULABLES } = await import("./articulation");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

beforeEach(() => {
  hoisted.resultats = [];
  hoisted.froms = [];
  hoisted.wheres = [];
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

/** Une campagne telle que rendue par `db.select().from(campaigns)...`. */
function campagneRow(over: Record<string, unknown> = {}) {
  return {
    id: 42,
    userId: "user-1",
    projectId: 9,
    name: "Septembre — la méthode",
    objective: "asseoir l'autorité",
    coreMessage: "on ne vend pas une méthode, on la pratique",
    status: "active",
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
      // La ligne brute simule une table qui porterait bien plus de colonnes que ce
      // que le service doit en extraire.
      [campagneRow({ targetAudience: "CSP+", insights: { ne: "doit pas fuiter" } })],
    ];

    const r = await articulationsDisponibles("user-1", 7);

    // Un champ de plus (ou de moins) fait échouer ce test — c'est voulu : c'est la
    // garantie centrale du spec, portée ici et pas seulement par le typage.
    expect(Object.keys(r[0].campagne).sort()).toEqual(
      ["angles", "coreMessage", "id", "marque", "name", "objective"].sort(),
    );
  });
});
