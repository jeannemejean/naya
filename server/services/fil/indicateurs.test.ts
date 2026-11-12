// Indicateurs du matin et valeur précédente (spec §8.3, Review Focus 4). Aucune base ni réseau :
// les sources sont simulées, le relevé vit dans une table en mémoire qui suit `fusionnerReleve`
// (le miroir du ON CONFLICT … WHERE de la vraie requête, vérifiée plus bas par son SQL).
import { describe, it, expect, vi, beforeEach } from "vitest";

// La base est factice : les modules du fil la chargent, aucun test ne la touche.
vi.mock("../../db", async () => await import("./__fixtures__/db-factice"));
import type { Indicateur } from "@shared/fil";
import {
  calculerIndicateurs, releverEtComparer, indicateursDuJour, releverUneFois, viderRelevesEnMemoire, ligneIndicateurs,
  choisirCible, cibleNumerique, fusionnerReleve, CLES_INDICATEURS, SourceIndisponible,
  type SourcesIndicateurs, type DepsReleve, type LigneReleve,
} from "./indicateurs";
import { requeteEcrireReleve, requetePrecedentes, requeteReponses } from "./indicateurs-deps";
import { lireAbonnes } from "../social-publishers";

const MAINTENANT = new Date("2026-11-12T08:00:00Z");
const AUJ = "2026-11-12";
const JOUR = 24 * 3600_000;

function sources(over: Partial<SourcesIndicateurs> = {}): SourcesIndicateurs {
  return {
    prospection: vi.fn(async () => ({ envois: 42, reponses: 5, interesses: 2 })),
    nomsProspects: vi.fn(async () => ["Marc Dupont", "Boulangerie Dupont", "Naya"]),
    agenda: vi.fn(async () => [
      { titre: "Rdv Boulangerie Dupont", at: new Date(MAINTENANT.getTime() - 3 * JOUR) },
      { titre: "Call Naya", at: new Date(MAINTENANT.getTime() - 2 * JOUR) },           // nom générique : ignoré
      { titre: "Marc Dupont — suite", at: new Date(MAINTENANT.getTime() + 2 * JOUR) }, // à venir : ignoré
      { titre: "Marc Dupont", at: new Date(MAINTENANT.getTime() - 40 * JOUR) },        // hors 4 semaines
    ]),
    pipeline: vi.fn(async () => ({ enDiscussion: 3, relancesEchues: 1 })),
    objectifs: vi.fn(async () => [{ projetId: 10, goalType: "revenue", successMode: "revenue", cible: "2 clients" }]),
    signes: vi.fn(async () => 1),
    comptes: vi.fn(async () => [{ id: 7, plateforme: "instagram", nom: "JMD" }, { id: 8, plateforme: "linkedin_page_99", nom: "Agence JMD" }]),
    abonnes: vi.fn(async (_u: string, id: number) => {
      if (id === 8) throw new SourceIndisponible("jeton LinkedIn expiré ou révoqué");
      return 1204;
    }),
    postsPublies: vi.fn(async () => 6),
    appelsOffres: vi.fn(async () => [
      { statut: "repere", dateLimite: new Date("2026-12-01"), bloquants: null, source: "boamp" },
      { statut: "repere", dateLimite: null, bloquants: null, source: "manuel" },
      { statut: "repere", dateLimite: new Date("2026-11-01"), bloquants: null, source: "boamp" },               // passé
      { statut: "repere", dateLimite: new Date("2026-12-01"), bloquants: "• À écarter, hors périmètre", source: "boamp" }, // écarté par la veille
      { statut: "premier_jet_pret", dateLimite: new Date("2026-12-01"), bloquants: null, source: "boamp" },
      { statut: "premier_jet_pret", dateLimite: new Date("2026-11-01"), bloquants: null, source: "boamp" },      // passé
      { statut: "en_redaction", dateLimite: new Date("2026-12-01"), bloquants: null, source: "boamp" },
      { statut: "depose", dateLimite: new Date("2026-11-01"), bloquants: null, source: "boamp" },
      { statut: "perdu", dateLimite: null, bloquants: null, source: "boamp" },
    ]),
    ...over,
  };
}

const par = (ind: Indicateur[], cle: string) => ind.find((i) => i.cle === cle);

/** Table `indicateurs_releves` en mémoire, pour une utilisatrice. */
function table(initiales: Array<LigneReleve & { jour: string }> = []) {
  const lignes = new Map<string, LigneReleve & { jour: string }>();
  for (const l of initiales) lignes.set(`${l.cle}|${l.jour}`, l);
  return {
    lignes,
    ecrire: vi.fn(async (_u: string, jour: string, nouvelles: LigneReleve[]) => {
      for (const n of nouvelles) {
        const k = `${n.cle}|${jour}`;
        lignes.set(k, { ...fusionnerReleve(lignes.get(k), n), jour });
      }
    }),
    lireJour: vi.fn(async (_u: string, jour: string) => [...lignes.values()].filter((l) => l.jour === jour)),
    precedentes: vi.fn(async (_u: string, jour: string) => {
      const res = new Map<string, LigneReleve & { jour: string }>();
      for (const l of lignes.values()) {
        if (l.jour >= jour || l.indisponible) continue;
        const d = res.get(l.cle);
        if (!d || d.jour < l.jour) res.set(l.cle, l);
      }
      return [...res.values()];
    }),
  };
}

function depsReleve(t: ReturnType<typeof table>, src: SourcesIndicateurs = sources()): DepsReleve & { calculer: any } {
  return {
    calculer: vi.fn((u: string, m: Date) => calculerIndicateurs(u, m, src)),
    ecrire: t.ecrire, lireJour: t.lireJour, precedentes: t.precedentes,
    comptes: vi.fn(async () => [{ id: 7, plateforme: "instagram", nom: "JMD" }, { id: 8, plateforme: "linkedin_page_99", nom: "Agence JMD" }]),
  };
}

beforeEach(() => viderRelevesEnMemoire());

describe("calculerIndicateurs", () => {
  it("calcule chaque famille, dans l'ordre des clés", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources());
    expect(par(ind, "prospection_envois_4s")?.valeur).toBe(42);
    expect(par(ind, "prospection_reponses_4s")?.valeur).toBe(5);
    expect(par(ind, "prospection_interesses_4s")?.valeur).toBe(2);
    expect(par(ind, "pipeline_en_discussion")?.valeur).toBe(3);
    expect(par(ind, "pipeline_relances_echues")?.valeur).toBe(1);
    expect(par(ind, "audience_abonnes_7")).toMatchObject({ valeur: 1204, libelle: "Abonnés Instagram JMD" });
    expect(par(ind, "audience_posts_4s_7")?.valeur).toBe(6);
    expect(ind.every((i) => i.precedente === null)).toBe(true);
    expect(ind[0].cle).toBe("prospection_envois_4s");
    expect(ind[ind.length - 1].cle).toBe("ao_en_redaction_ou_deposes");
    expect(CLES_INDICATEURS).toContain("audience_abonnes_{compteId}");
  });

  it("rendez-vous : seulement les événements passés des 4 semaines qui citent un prospect (mots génériques ignorés)", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources());
    expect(par(ind, "prospection_rdv_4s")?.valeur).toBe(1);
  });

  it("sans agenda relié : « agenda non relié », valeur nulle, jamais 0", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources({ agenda: vi.fn(async () => null) }));
    expect(par(ind, "prospection_rdv_4s")).toMatchObject({ valeur: null, indisponible: "agenda non relié" });
  });

  it("agenda en panne : « agenda illisible », la panne est journalisée ; les autres indicateurs restent calculés", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ind = await calculerIndicateurs("u1", MAINTENANT, sources({ agenda: vi.fn(async () => { throw new Error("GCal timeout"); }) }));
      expect(par(ind, "prospection_rdv_4s")).toMatchObject({ valeur: null, indisponible: "agenda illisible" });
      expect(par(ind, "prospection_envois_4s")?.valeur).toBe(42);
      expect(erreur).toHaveBeenCalled();
      expect(erreur.mock.calls.flat().join(" ")).toContain("GCal timeout");
    } finally {
      erreur.mockRestore();
    }
  });

  it("jeton LinkedIn expiré : l'abonné de la page est indisponible avec sa raison, ses posts restent comptés", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources());
    expect(par(ind, "audience_abonnes_8")).toMatchObject({ valeur: null, indisponible: "jeton LinkedIn expiré ou révoqué" });
    expect(par(ind, "audience_posts_4s_8")?.valeur).toBe(6);
  });

  it("une erreur brute n'est jamais montrée (elle pourrait citer une requête) : « lecture impossible »", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources({ prospection: vi.fn(async () => { throw new Error("select … access_token=SECRET"); }) }));
    for (const c of ["prospection_envois_4s", "prospection_reponses_4s", "prospection_interesses_4s"]) {
      expect(par(ind, c)).toMatchObject({ valeur: null, indisponible: "lecture impossible" });
    }
    expect(JSON.stringify(ind)).not.toContain("SECRET");
    erreur.mockRestore();
  });

  it("appels d'offres : à venir (repérés ouverts, hors écartés), premiers jets ouverts, en rédaction ou déposés", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources());
    expect(par(ind, "ao_a_venir")?.valeur).toBe(2);
    expect(par(ind, "ao_premiers_jets_sans_decision")?.valeur).toBe(1);
    expect(par(ind, "ao_en_redaction_ou_deposes")?.valeur).toBe(2);
  });
});

describe("clients signés vers l'objectif", () => {
  it("« 1 / 2 » quand la cible de l'objectif revenue vaut « 2 clients », compté sur son projet", async () => {
    const s = sources();
    const ind = await calculerIndicateurs("u1", MAINTENANT, s);
    expect(par(ind, "pipeline_signes")?.valeur).toBe("1 / 2");
    expect(s.signes).toHaveBeenCalledWith("u1", 10);
  });

  it("sans cible numérique : « 1 »", async () => {
    const ind = await calculerIndicateurs("u1", MAINTENANT, sources({
      objectifs: vi.fn(async () => [{ projetId: 10, goalType: "revenue", successMode: "revenue", cible: "décrocher des clients" }]),
    }));
    expect(par(ind, "pipeline_signes")?.valeur).toBe("1");
  });

  it("une cible en argent n'est pas une cible de clients ; deux candidats sans départage : pas de cible", () => {
    expect(cibleNumerique("3 000 €")).toBeNull();
    expect(cibleNumerique("10k de CA")).toBeNull();
    expect(cibleNumerique("2 clients")).toBe(2);
    const deux = [
      { projetId: 1, goalType: "revenue", successMode: "revenue", cible: "2 contrats" },
      { projetId: 2, goalType: "revenue", successMode: "revenue", cible: "3 clients" },
    ];
    expect(choisirCible(deux)).toEqual({ projetId: null, cible: null });
    // Un objectif « mensuel » au successMode revenue compte ; un objectif de visibilité non.
    expect(choisirCible([
      { projetId: 4, goalType: "monthly", successMode: "revenue", cible: "4 clients" },
      { projetId: 5, goalType: "visibility", successMode: "visibility", cible: "1000 abonnés" },
    ])).toEqual({ projetId: 4, cible: 4 });
  });
});

describe("releverEtComparer (Review Focus 4)", () => {
  it("indisponible : valeur nulle, la précédente vient du dernier relevé DISPONIBLE, et le relevé ne l'écrase pas par 0", async () => {
    const t = table([
      { cle: "prospection_rdv_4s", valeur: 3, texte: null, indisponible: null, jour: "2026-11-09" },
      { cle: "prospection_rdv_4s", valeur: null, texte: null, indisponible: "agenda illisible", jour: "2026-11-11" },
      { cle: "audience_abonnes_8", valeur: 512, texte: null, indisponible: null, jour: "2026-11-10" },
    ]);
    const d = depsReleve(t, sources({ agenda: vi.fn(async () => null) }));
    const ind = await releverEtComparer("u1", AUJ, d, MAINTENANT);

    expect(par(ind, "prospection_rdv_4s")).toMatchObject({ valeur: null, precedente: 3, indisponible: "agenda non relié" });
    expect(par(ind, "audience_abonnes_8")).toMatchObject({ valeur: null, precedente: 512, indisponible: "jeton LinkedIn expiré ou révoqué" });
    const ecrite = t.lignes.get(`prospection_rdv_4s|${AUJ}`)!;
    expect(ecrite.valeur).toBeNull();
    expect(ecrite.indisponible).toBe("agenda non relié");
    // Les relevés d'avant sont intacts.
    expect(t.lignes.get("prospection_rdv_4s|2026-11-09")?.valeur).toBe(3);
  });

  it("une indisponibilité plus tard dans la journée n'écrase pas la valeur déjà relevée aujourd'hui", async () => {
    const t = table();
    await releverEtComparer("u1", AUJ, depsReleve(t), MAINTENANT);
    expect(t.lignes.get(`audience_abonnes_7|${AUJ}`)?.valeur).toBe(1204);

    const panne = sources({ abonnes: vi.fn(async () => { throw new SourceIndisponible("jeton Instagram expiré"); }) });
    const ind = await releverEtComparer("u1", AUJ, depsReleve(t, panne), MAINTENANT);
    expect(t.lignes.get(`audience_abonnes_7|${AUJ}`)).toMatchObject({ valeur: 1204, indisponible: null });
    expect(par(ind, "audience_abonnes_7")?.valeur).toBe(1204);
  });

  it("le relevé est idempotent dans la journée : une ligne par clé, mêmes valeurs", async () => {
    const t = table([{ cle: "prospection_envois_4s", valeur: 30, texte: null, indisponible: null, jour: "2026-11-11" }]);
    const premier = await releverEtComparer("u1", AUJ, depsReleve(t), MAINTENANT);
    const n = t.lignes.size;
    const second = await releverEtComparer("u1", AUJ, depsReleve(t), MAINTENANT);
    expect(t.lignes.size).toBe(n);
    expect(second).toEqual(premier);
    expect(par(second, "prospection_envois_4s")).toMatchObject({ valeur: 42, precedente: 30 });
  });

  it("« n / cible » : le texte est relevé, la précédente garde son texte", async () => {
    const t = table([{ cle: "pipeline_signes", valeur: 0, texte: "0 / 2", indisponible: null, jour: "2026-11-11" }]);
    const ind = await releverEtComparer("u1", AUJ, depsReleve(t), MAINTENANT);
    expect(t.lignes.get(`pipeline_signes|${AUJ}`)).toMatchObject({ valeur: 1, texte: "1 / 2" });
    expect(par(ind, "pipeline_signes")).toMatchObject({ valeur: "1 / 2", precedente: "0 / 2" });
  });
});

describe("indicateursDuJour (le matin)", () => {
  it("relevé du jour présent : lu en base, aucun calcul (aucune API appelée)", async () => {
    const t = table([
      { cle: "prospection_envois_4s", valeur: 40, texte: null, indisponible: null, jour: AUJ },
      { cle: "audience_abonnes_7", valeur: 1200, texte: null, indisponible: null, jour: AUJ },
      { cle: "audience_abonnes_7", valeur: 1100, texte: null, indisponible: null, jour: "2026-11-11" },
    ]);
    const d = depsReleve(t);
    const ind = await indicateursDuJour("u1", AUJ, MAINTENANT, d);
    expect(d.calculer).not.toHaveBeenCalled();
    expect(par(ind, "audience_abonnes_7")).toMatchObject({ valeur: 1200, precedente: 1100, libelle: "Abonnés Instagram JMD" });
    expect(ind.map((i) => i.cle)).toEqual(["prospection_envois_4s", "audience_abonnes_7"]);
  });

  it("pas encore de relevé : calculé UNE fois même pour des appels simultanés, puis lu", async () => {
    const t = table();
    const d = depsReleve(t);
    const [a, b] = await Promise.all([indicateursDuJour("u1", AUJ, MAINTENANT, d), indicateursDuJour("u1", AUJ, MAINTENANT, d)]);
    expect(d.calculer).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    await indicateursDuJour("u1", AUJ, MAINTENANT, d);
    expect(d.calculer).toHaveBeenCalledTimes(1);
  });

  it("passage du matin en cours : la page partage son calcul", async () => {
    const t = table();
    const d = depsReleve(t);
    const passage = releverUneFois("u1", AUJ, d, MAINTENANT);
    const page = indicateursDuJour("u1", AUJ, MAINTENANT, d);
    await Promise.all([passage, page]);
    expect(d.calculer).toHaveBeenCalledTimes(1);
  });

  it("échec complet : pas de nouvel essai pendant 10 min, puis on réessaie", async () => {
    const t = table();
    const d = depsReleve(t);
    d.ecrire = vi.fn(async () => { throw new Error("base"); });
    await expect(indicateursDuJour("u1", AUJ, MAINTENANT, d)).rejects.toThrow("base");
    expect(await indicateursDuJour("u1", AUJ, new Date(MAINTENANT.getTime() + 60_000), d)).toEqual([]);
    expect(d.calculer).toHaveBeenCalledTimes(1);
    await expect(indicateursDuJour("u1", AUJ, new Date(MAINTENANT.getTime() + 11 * 60_000), d)).rejects.toThrow("base");
    expect(d.calculer).toHaveBeenCalledTimes(2);
  });
});

describe("ligneIndicateurs", () => {
  const i = (cle: string, valeur: number | string | null, precedente: number | string | null, extra: Partial<Indicateur> = {}): Indicateur =>
    ({ cle, libelle: cle, valeur, precedente, ...extra });

  it("donne le sens (↑ ↓ =) et dit l'indisponible", () => {
    const l = ligneIndicateurs([
      i("prospection_envois_4s", 42, 30), i("prospection_reponses_4s", 5, 5), i("prospection_rdv_4s", null, 2, { indisponible: "agenda non relié" }),
      i("pipeline_relances_echues", 1, 3), i("pipeline_signes", "1 / 2", "0 / 2"), i("pipeline_en_discussion", 3, null),
    ]);
    expect(l).toBe("42 envois ↑ · 5 réponses = · rdv indisponible · 1 relances échues ↓ · 1 / 2 signés ↑ · 3 en discussion");
  });

  it("ne dépasse jamais 140 caractères", () => {
    const beaucoup: Indicateur[] = [
      i("prospection_envois_4s", 12345, 999), i("prospection_reponses_4s", 1234, 999), i("prospection_interesses_4s", 1234, 999),
      i("prospection_rdv_4s", 123, 99), i("pipeline_en_discussion", 1234, 99), i("pipeline_relances_echues", 1234, 99),
      i("pipeline_signes", "123 / 456", "1 / 456"),
      ...[1, 2, 3, 4].map((n) => i(`audience_abonnes_${n}`, 123456, 12345, { libelle: `Abonnés Instagram Un compte au nom très long ${n}` })),
      i("ao_a_venir", 99, 98), i("ao_premiers_jets_sans_decision", 99, 98), i("ao_en_redaction_ou_deposes", 99, 98),
    ];
    const l = ligneIndicateurs(beaucoup);
    expect(l.length).toBeLessThanOrEqual(140);
    expect(l.startsWith("12345 envois ↑")).toBe(true);
    expect(ligneIndicateurs([])).toBe("");
  });

  it("les posts par compte restent au détail ; les abonnés nomment leur compte", () => {
    expect(ligneIndicateurs([
      i("audience_abonnes_7", 1204, 1180, { libelle: "Abonnés Instagram JMD" }), i("audience_posts_4s_7", 6, 4, { libelle: "Posts publiés Instagram JMD (4 sem.)" }),
    ])).toBe("1204 abonnés Instagram JMD ↑");
  });
});

describe("lireAbonnes (social-publishers) : jamais de jeton dans une raison", () => {
  const JETON = "JETON-TRES-SECRET";

  it("jeton expiré : indisponible sans appel réseau", async () => {
    const f = vi.fn();
    await expect(lireAbonnes({ platform: "instagram", accountId: "1", accessToken: JETON, expiresAt: new Date(MAINTENANT.getTime() - 1) }, MAINTENANT, f as any))
      .rejects.toThrow("jeton Instagram expiré");
    expect(f).not.toHaveBeenCalled();
  });

  it("profil LinkedIn : l'API ne donne pas ses abonnés, sans appel réseau", async () => {
    const f = vi.fn();
    await expect(lireAbonnes({ platform: "linkedin", accountId: "abc", accessToken: JETON }, MAINTENANT, f as any)).rejects.toThrow(/LinkedIn/);
    expect(f).not.toHaveBeenCalled();
  });

  it("page LinkedIn refusée (401) : raison courte, sans le jeton ni la réponse", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: `token ${JETON} invalid`, status: 401 }), { status: 401 }));
    const e = await lireAbonnes({ platform: "linkedin_page_99", accountId: "99", accessToken: JETON }, MAINTENANT, f as any).catch((x) => x);
    expect(e.message).toBe("jeton LinkedIn expiré ou révoqué");
    expect(e.message).not.toContain(JETON);
  });

  it("panne réseau : le message d'origine (qui peut citer l'URL) n'est pas repris", async () => {
    const f = vi.fn(async () => { throw new Error(`fetch failed https://graph.instagram.com/?access_token=${JETON}`); });
    const e = await lireAbonnes({ platform: "instagram", accountId: "1", accessToken: JETON }, MAINTENANT, f as any).catch((x) => x);
    expect(e.message).toBe("Instagram ne répond pas");
  });

  it("Instagram : followers_count ; page LinkedIn : firstDegreeSize", async () => {
    const ig = vi.fn(async () => new Response(JSON.stringify({ followers_count: 1204, id: "1" }), { status: 200 }));
    expect(await lireAbonnes({ platform: "instagram", accountId: "1", accessToken: JETON }, MAINTENANT, ig as any)).toBe(1204);
    expect(String((ig.mock.calls[0] as any[])[0])).toContain("fields=followers_count");
    const li = vi.fn(async () => new Response(JSON.stringify({ firstDegreeSize: 512 }), { status: 200 }));
    expect(await lireAbonnes({ platform: "linkedin_page_99", accountId: "99", accessToken: JETON }, MAINTENANT, li as any)).toBe(512);
    expect(String((li.mock.calls[0] as any[])[0])).toContain("networkSizes/urn%3Ali%3Aorganization%3A99");
  });
});

describe("requêtes du relevé (SQL, sans base)", () => {
  it("upsert sur l'index unique, scopé à l'utilisatrice ; une indisponibilité n'écrase qu'une indisponibilité", () => {
    const { sql, params } = requeteEcrireReleve("u1", AUJ, [{ cle: "prospection_rdv_4s", valeur: null, texte: null, indisponible: "agenda non relié" }]).toSQL();
    expect(sql).toMatch(/on conflict \("user_id","cle","releve_le"\) do update set/i);
    expect(sql).toMatch(/where excluded\.indisponible is null or "indicateurs_releves"\."indisponible" is not null/i);
    expect(params).toContain("u1");
  });

  it("réponses : les prospects archivés n'en sont pas", () => {
    const { sql, params } = requeteReponses("u1", new Date("2026-10-15T00:00:00Z")).toSQL();
    expect(sql).toMatch(/"leads"\."archived_at" is null/);
    expect(params).toContain("u1");
  });

  it("précédente : dernier relevé disponible d'avant le jour, par clé", () => {
    const { sql, params } = requetePrecedentes("u1", AUJ).toSQL();
    expect(sql).toMatch(/select distinct on \("indicateurs_releves"\."cle"\)/i);
    expect(sql).toMatch(/"releve_le" < \$2/);
    expect(sql).toMatch(/"indisponible" is null/);
    expect(sql).toMatch(/order by "indicateurs_releves"\."cle", "indicateurs_releves"\."releve_le" desc/i);
    expect(params).toEqual(["u1", AUJ]);
  });
});
