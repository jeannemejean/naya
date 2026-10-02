// Tests de `preferences.ts` — les préférences d'une marque qui atteignent la
// génération de campagne.
//
// `../../db` est mocké sur le motif exact de `collision.test.ts`
// (server/services/brand-links/collision.test.ts) : une chaîne de constructeur de
// requête « tout accepte », attendable (thenable), qui capture `from`/`where`/
// `orderBy`/`limit` pour vérifier le tri et le plafond décrits dans le brief — PAS
// seulement que la fonction est appelée. Une seule file FIFO de résultats
// (`hoisted.resultats`) : `preferencesDeLaMarque` émet au plus DEUX requêtes dans
// l'ordre (les lignes, puis — seulement si le plafond est atteint — le compte réel).
//
// `../../storage` et `../claude` sont mockés pour le bloc de régression qui importe
// `../openai` (`generateCampaignStrategy`) : openai.ts importe `storage` statiquement
// (jamais appelé par cette fonction, mais évalué à l'import) et appelle le modèle en
// direct via `callClaudeDetailed` — motif repris de `ritual-analyze.test.ts` et
// `collision.test.ts` (seul `callClaudeDetailed` est remplacé, le reste du module
// `../claude`, dont `assertNotTruncated` et `CLAUDE_MODELS`, reste réel).
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

vi.mock("../../storage", () => ({ storage: {} }));
vi.mock("../claude", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, callClaudeDetailed: vi.fn() };
});

const { memoryEntries } = await import("@shared/schema");
const {
  preferencesDeLaMarque,
  formaterPreferences,
  PLAFOND_PREFERENCES,
} = await import("./preferences");

const dialecte = new PgDialect();
const enSql = (clause: any) => dialecte.sqlToQuery(clause);

function reset() {
  hoisted.resultats = [];
  hoisted.selects = [];
  hoisted.froms = [];
  hoisted.wheres = [];
  hoisted.orderBys = [];
  hoisted.limits = [];
  vi.clearAllMocks();
}

function ligne(over: Partial<{ id: number; content: string; salience: number | null; createdAt: Date | null }> = {}) {
  return {
    id: 1,
    content: "Contenu générique.",
    salience: 0.5,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...over,
  };
}

describe("preferencesDeLaMarque — la requête", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset();
    // Restaurée dans afterEach : sans ça l'historique d'appels fuit d'un test à
    // l'autre et produit des échecs trompeurs — piège déjà rencontré sur ce chantier
    // (vu dans collision.test.ts).
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it("cas 1 — la clause porte sur fil = \"cap\", entryType = \"préférence\" ET supersededAt IS NULL, rendue par PgDialect", async () => {
    hoisted.resultats = [[]];

    await preferencesDeLaMarque("user-1", 7);

    const requete = enSql(hoisted.wheres[0]);
    expect(requete.sql).toContain('"memory_entries"."fil"');
    expect(requete.sql).toContain('"memory_entries"."entry_type"');
    expect(requete.sql).toContain('"memory_entries"."superseded_at" is null');
    expect(requete.params).toContain("cap");
    expect(requete.params).toContain("préférence");
  });

  it("cas 2 — le tri (salience DESC, createdAt DESC) et le plafond sont rendus au constructeur de requête", async () => {
    hoisted.resultats = [[]];

    await preferencesDeLaMarque("user-1", 7);

    expect(hoisted.limits).toContain(PLAFOND_PREFERENCES);
    expect(hoisted.orderBys[0]).toHaveLength(2);
    const [parSalience, parDate] = hoisted.orderBys[0];
    expect(enSql(parSalience).sql).toBe('"memory_entries"."salience" desc');
    expect(enSql(parDate).sql).toBe('"memory_entries"."created_at" desc');
  });

  it("cas 3 — la clause porte sur le projectId exact : les préférences d'une autre marque n'entrent jamais", async () => {
    hoisted.resultats = [[]];

    await preferencesDeLaMarque("user-1", 42);

    const requete = enSql(hoisted.wheres[0]);
    expect(requete.sql).toContain('"memory_entries"."project_id"');
    expect(requete.params).toContain(42);
    expect(requete.params).not.toContain(7);
  });

  it("la clause porte aussi sur userId", async () => {
    hoisted.resultats = [[]];

    await preferencesDeLaMarque("user-9", 7);

    const requete = enSql(hoisted.wheres[0]);
    expect(requete.sql).toContain('"memory_entries"."user_id"');
    expect(requete.params).toContain("user-9");
  });

  it("une seule requête part quand moins de lignes que le plafond reviennent — pas de requête de comptage inutile", async () => {
    hoisted.resultats = [[ligne({ id: 1 }), ligne({ id: 2 })]];

    const r = await preferencesDeLaMarque("user-1", 7);

    expect(r).toHaveLength(2);
    expect(hoisted.selects).toHaveLength(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("cas 6 — au-delà du plafond, le journal annonce le COMPTE RÉEL écarté, jamais une approximation", async () => {
    const lignesPlafond = Array.from({ length: PLAFOND_PREFERENCES }, (_, i) => ligne({ id: i + 1 }));
    const totalReel = PLAFOND_PREFERENCES + 5;
    hoisted.resultats = [lignesPlafond, [{ total: totalReel }]];

    const r = await preferencesDeLaMarque("user-1", 7);

    expect(r).toHaveLength(PLAFOND_PREFERENCES);
    expect(hoisted.selects).toHaveLength(2); // la requête des lignes, puis celle du compte
    const appelsPlafond = infoSpy.mock.calls.filter(([msg]) => /écarté/i.test(String(msg)));
    expect(appelsPlafond).toHaveLength(1);
    expect(appelsPlafond[0][0]).toContain(`${totalReel - PLAFOND_PREFERENCES} préférence(s) écartée(s)`);
    expect(appelsPlafond[0][0]).not.toContain(`${PLAFOND_PREFERENCES + 1}`); // pas d'approximation voisine
  });

  it("le nombre de lignes atteint exactement le plafond MAIS il n'y en a pas plus en réalité → aucun journal", async () => {
    const lignesPlafond = Array.from({ length: PLAFOND_PREFERENCES }, (_, i) => ligne({ id: i + 1 }));
    hoisted.resultats = [lignesPlafond, [{ total: PLAFOND_PREFERENCES }]];

    await preferencesDeLaMarque("user-1", 7);

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("aucun résultat ne rend un tableau vide, sans journal", async () => {
    hoisted.resultats = [[]];

    const r = await preferencesDeLaMarque("user-1", 7);

    expect(r).toEqual([]);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});

describe("formaterPreferences — PURE, n'expose que content", () => {
  it("cas 4 — rend une chaîne vide sur une liste vide", () => {
    expect(formaterPreferences([])).toBe("");
  });

  it("cas 5 — n'expose QUE content : ni identifiant, ni salience, ni date dans la sortie", () => {
    const ps = [
      ligne({ id: 999, content: "Jamais de ton promotionnel sur les lancements produit.", salience: 0.93, createdAt: new Date("2026-01-15T00:00:00.000Z") }),
      ligne({ id: 1000, content: "Pas de storytelling personnel sur cette marque.", salience: 0.71, createdAt: new Date("2025-11-03T00:00:00.000Z") }),
    ];

    const sortie = formaterPreferences(ps);

    expect(sortie).toContain("Jamais de ton promotionnel sur les lancements produit.");
    expect(sortie).toContain("Pas de storytelling personnel sur cette marque.");
    // Aucun identifiant.
    expect(sortie).not.toContain("999");
    expect(sortie).not.toContain("1000");
    // Aucune salience.
    expect(sortie).not.toContain("0.93");
    expect(sortie).not.toContain("0.71");
    expect(sortie).not.toContain("salience");
    // Aucune date.
    expect(sortie).not.toContain("2026-01-15");
    expect(sortie).not.toContain("2025-11-03");
    expect(sortie).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("rend un en-tête suivi d'une ligne par préférence", () => {
    const sortie = formaterPreferences([ligne({ content: "A." }), ligne({ content: "B." })]);
    const lignesRendues = sortie.split("\n");
    expect(lignesRendues[0]).toMatch(/PRÉFÉRENCE/);
    expect(lignesRendues).toContain("- A.");
    expect(lignesRendues).toContain("- B.");
  });

  it("verrouille la DIRECTION : l'en-tête annonce lui-même que ce qui suit est à ÉVITER, indépendamment du phrasé du contenu", () => {
    // `content` ici ne porte AUCUN marqueur de rejet ("Ce qui n'allait pas…") — une
    // phrase nue, comme arriverait une préférence saisie à la main ou importée. Si la
    // direction ne tenait qu'au phrasé habituel de `construirePreference` (rejeter.ts),
    // ce cas la perdrait : le modèle lirait "ton plus corporate" comme une consigne à
    // suivre, l'inverse exact de l'intention. Ce test tombe si l'en-tête redevient
    // neutre (ex. "PRÉFÉRENCES EXPRIMÉES PAR L'UTILISATRICE SUR CETTE MARQUE").
    const sortie = formaterPreferences([ligne({ content: "ton plus corporate" })]);
    const premiereLigne = sortie.split("\n")[0];
    expect(premiereLigne).toContain("À ÉVITER");
    expect(premiereLigne).not.toBe("PRÉFÉRENCES EXPRIMÉES PAR L'UTILISATRICE SUR CETTE MARQUE");
  });

  it("ne s'étale jamais et ne sérialise jamais tout l'objet : un champ ajouté demain à Preference ne peut pas fuiter", () => {
    // Un objet dont content est une propriété normale, mais qui porte aussi un champ
    // qu'on n'a jamais voulu envoyer. formaterPreferences n'y accède que par nom :
    // un étalement (...p) ou un JSON.stringify(p) l'aurait laissé fuiter.
    const avecChampSecret = [{ ...ligne({ content: "Reste concis." }), tonDeVoixDeLAutreMarque: "SECRET_FUITE" }];
    const sortie = formaterPreferences(avecChampSecret as any);
    expect(sortie).not.toContain("SECRET_FUITE");
  });
});

describe("régression — le prompt de generateCampaignStrategy", () => {
  const BASE = {
    userId: "user-1",
    objective: "asseoir l'autorité",
    duration: "1_month",
    brandDna: {},
  };

  async function promptEnvoye(request: any): Promise<string> {
    const claude = await import("../claude");
    (claude.callClaudeDetailed as any).mockReset().mockResolvedValue({
      text: JSON.stringify({
        name: "x", campaignType: "visibility", coreMessage: "x", targetAudience: "x",
        audienceSegment: "x", insights: [], messagingFramework: {}, phases: [], channels: [],
        kpis: [], prospection: null,
      }),
      stopReason: "end_turn",
    });
    const { generateCampaignStrategy } = await import("../openai");
    await generateCampaignStrategy(request);
    const appel = (claude.callClaudeDetailed as any).mock.calls[0][0];
    return appel.messages[0].content as string;
  }

  it("contient les préférences formatées quand elles existent", async () => {
    const prefs = [ligne({ content: "Jamais de ton promotionnel." })];
    const texte = await promptEnvoye({ ...BASE, preferences: prefs });

    expect(texte).toContain(formaterPreferences(prefs));
    expect(texte).toContain("Jamais de ton promotionnel.");
  });

  it("est inchangé quand il n'y a aucune préférence — absence de champ et tableau vide produisent EXACTEMENT le même prompt", async () => {
    const texteSansChamp = await promptEnvoye({ ...BASE });
    const texteTableauVide = await promptEnvoye({ ...BASE, preferences: [] });

    expect(texteSansChamp).toBe(texteTableauVide);
    expect(texteSansChamp).not.toContain("PRÉFÉRENCE");
  });
});
