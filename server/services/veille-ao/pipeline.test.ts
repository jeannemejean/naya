// Veille AO : un passage complet avec fetch simulé (réponses réelles enregistrées), base et IA
// factices. Aucun réseau, aucune base.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../claude", () => ({ callClaudeDetailed: vi.fn(), assertNotTruncated: vi.fn() }));
const { passageVeilleAO, lancerVeilleAO, faitsDe, _reinitialiserEchecs, ECHECS_MAX, DUREE_ECHECS_MS, echecDefinitif } = await import("./pipeline");
const { veilleEnCours } = await import("./etat");
const { _reinitialiserVeilleAO, tourVeilleAO, doitLancer, heureParis, utilisatricesVeilleAO } = await import("./planificateur");
import type { Existant } from "./dedupe";
import type { Fetch } from "./sources";
import type { DepsVeilleAO } from "./pipeline";

const fixture = (nom: string) => JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", nom), "utf8"));
const BOAMP = fixture("boamp-2026-11-10.json");
const TED = fixture("ted-2026-11-10.json");
const MAINTENANT = new Date("2026-11-10T08:00:00Z");

const fetchFixtures: Fetch = async (url) => ({
  ok: true, status: 200, json: async () => (url.startsWith("https://boamp") ? BOAMP : TED),
});

const qualif = (score = "moyen") => ({
  valeur: {
    dansPerimetre: true, motifHorsPerimetre: null, capacites: "a_verifier_rc", motifCapacites: null, score,
    raisonScore: "Raison.", offresJmd: ["IN SITU"], bloquants: [], piecesExigees: null, criteresPonderation: null,
    montantEstimeHt: null, resume: "Résumé.",
  },
  coutEur: 0.02,
});

function deps(existants: Existant[] = [], over: Partial<DepsVeilleAO> = {}) {
  const inseres: any[] = [];
  const rafraichis: Array<{ id: number; faits: any; opts?: any }> = [];
  const d: DepsVeilleAO = {
    fetch: fetchFixtures,
    existants: vi.fn(async () => existants),
    inserer: vi.fn(async (_u: string, l: any[]) => { inseres.push(...l); }),
    rafraichir: vi.fn(async (_u: string, id: number, faits: any, opts?: any) => { rafraichis.push({ id, faits, opts }); }),
    contexte: vi.fn(async () => "Offres : IN SITU, IN LINEA, IN SCENA"),
    qualifier: vi.fn(async () => qualif()),
    estBloquee: vi.fn(async () => false),
    ...over,
  };
  return { d, inseres, rafraichis };
}

beforeEach(() => { _reinitialiserVeilleAO(); _reinitialiserEchecs(); });

/** Lance un passage « manuel » qui reste bloqué jusqu'à liberer(). */
function passageBloquant(base: DepsVeilleAO) {
  let liberer!: () => void;
  const attente = new Promise<void>((r) => { liberer = r; });
  const d = { ...base, existants: async () => { await attente; return []; } };
  const fini = lancerVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
  return { liberer, fini };
}

describe("passage de veille", () => {
  it("collecte les deux sources, écarte le doublon TED, qualifie et insère le reste", async () => {
    const { d, inseres } = deps();
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(b.examines).toBe(9);
    expect(b.doublons).toBe(1); // 780380-2026 = 26-108562 (même objet)
    expect(b.nouveaux).toBe(8);
    expect(inseres.map((l) => `${l.source}:${l.sourceId}`)).not.toContain("ted:780380-2026");
    expect(inseres.every((l) => l.statut === "repere" && l.sourceId && l.source)).toBe(true);
    expect(b.coutEur).toBeCloseTo(0.16);
    expect(d.qualifier).toHaveBeenCalledTimes(8);
  });

  it("ligne Notion portant le numéro BOAMP : faits rafraîchis, jamais statut ni notes, aucun appel IA pour elle", async () => {
    const notion: Existant = { id: 42, source: "notion_import", sourceId: "abc", reference: "BOAMP 26-108562 / 2600002", lienAvis: null, objet: "Communication SPL" };
    const { d, rafraichis, inseres } = deps([notion]);
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["boamp"] });
    expect(b.rafraichis).toBe(1);
    expect(rafraichis[0].id).toBe(42);
    expect(rafraichis[0].opts).toEqual({ seulementVides: true }); // Notion : on complète, on n'écrase pas
    expect(rafraichis[0].faits).toMatchObject({ montantEstimeHt: "250000.00", procedure: "Appel d'offres ouvert" });
    expect(Object.keys(rafraichis[0].faits)).not.toEqual(expect.arrayContaining(["statut"]));
    for (const k of ["statut", "notes", "scoreAdequation", "bloquants"]) expect(rafraichis[0].faits).not.toHaveProperty(k);
    expect(inseres.map((l) => l.sourceId)).not.toContain("26-108562");
    expect(d.qualifier).toHaveBeenCalledTimes(4);
  });

  it("contexte réel lu une fois par passage et transmis à chaque qualification ; sans lui, on qualifie quand même", async () => {
    const { d } = deps();
    await passageVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(d.contexte).toHaveBeenCalledTimes(1);
    expect(d.qualifier).toHaveBeenCalledWith("u1", expect.anything(), "Offres : IN SITU, IN LINEA, IN SCENA");
    const { d: d2, inseres } = deps([], { contexte: vi.fn(async () => { throw new Error("base"); }) });
    await passageVeilleAO("u1", d2, { maintenant: MAINTENANT, sources: ["ted"] });
    expect(d2.qualifier).toHaveBeenCalledWith("u1", expect.anything(), "");
    expect(inseres).toHaveLength(4);
  });

  it("ligne veille déjà connue : faits rafraîchis normalement (pas seulement les vides)", async () => {
    const { d, rafraichis } = deps([{ id: 7, source: "boamp", sourceId: "26-108562", reference: null, lienAvis: null, objet: "x" }]);
    await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["boamp"] });
    expect(rafraichis[0]).toMatchObject({ id: 7, opts: { seulementVides: false } });
  });

  it("échec définitif = sortie invalide ou tronquée ; le reste est passager", () => {
    expect(echecDefinitif(new Error("structure_invalide: score"))).toBe(true);
    expect(echecDefinitif(new Error("structure_invalide: réponse non JSON"))).toBe(true);
    expect(echecDefinitif(new Error("CAMPAIGN_TRUNCATED: l'étape … a dépassé"))).toBe(true);
    for (const m of ["fetch failed", "The operation was aborted due to timeout", "429 rate_limit_error", "500 Internal Server Error", "529 overloaded_error", "ECONNRESET"]) {
      expect(echecDefinitif(new Error(m))).toBe(false);
    }
  });

  it("erreurs passagères (réseau, 429, surcharge) : jamais comptées, l'avis est retenté à chaque passage", async () => {
    const { d } = deps([], { qualifier: vi.fn(async () => { throw new Error("529 overloaded_error"); }) });
    for (let i = 0; i < ECHECS_MAX + 2; i++) await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
    expect(d.qualifier).toHaveBeenCalledTimes(4 * (ECHECS_MAX + 2));
  });

  it("les échecs définitifs expirent au bout de 3 jours", async () => {
    const { d } = deps([], { qualifier: vi.fn(async () => { throw new Error("structure_invalide"); }) });
    for (let i = 0; i < ECHECS_MAX; i++) await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
    const plusTard = new Date(MAINTENANT.getTime() + DUREE_ECHECS_MS + 60_000);
    await passageVeilleAO("u1", d, { maintenant: new Date(MAINTENANT.getTime() + DUREE_ECHECS_MS - 60_000), sources: ["ted"] });
    expect(d.qualifier).toHaveBeenCalledTimes(4 * ECHECS_MAX);
    // plusTard : la fenêtre de collecte est la même (fixtures), seule l'horloge change.
    const b = await passageVeilleAO("u1", d, { maintenant: plusTard, sources: ["ted"] });
    expect(b.abandonnes).toBe(0);
    expect(d.qualifier).toHaveBeenCalledTimes(4 * ECHECS_MAX + b.echecsQualification);
    expect(b.echecsQualification).toBeGreaterThan(0);
  });

  it(`qualification qui échoue ${2} fois : plus retentée (pas refacturée)`, async () => {
    const { d } = deps([], { qualifier: vi.fn(async () => { throw new Error("structure_invalide"); }) });
    for (let i = 0; i < ECHECS_MAX; i++) await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
    expect(d.qualifier).toHaveBeenCalledTimes(4 * ECHECS_MAX);
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
    expect(d.qualifier).toHaveBeenCalledTimes(4 * ECHECS_MAX);
    expect(b.abandonnes).toBe(4);
  });

  it("budget atteint en cours de passage : les appels suivants ne partent pas", async () => {
    let appels = 0;
    const { d, inseres } = deps([], { estBloquee: vi.fn(async () => appels++ >= 3) });
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT, concurrence: 1 });
    expect(d.qualifier).toHaveBeenCalledTimes(2); // 1re vérif globale + 2 appels, puis bloquée
    expect(inseres).toHaveLength(2);
    expect(b.iaBloquee).toBe(true);
    expect(b.reportesPlafond).toBe(6);
  });

  it("faits : jamais de valeur vide qui écraserait une valeur connue", () => {
    expect(faitsDe({ dateLimite: null, procedure: null, departement: null, montantEstimeHt: null, lienDce: null } as any)).toEqual({});
  });

  it("plafond d'appels IA : les plus proches de leur date limite d'abord, le reste au passage suivant", async () => {
    const { d, inseres } = deps();
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT, plafondIA: 3 });
    expect(d.qualifier).toHaveBeenCalledTimes(3);
    expect(b.reportesPlafond).toBe(5);
    expect(inseres.map((l) => l.sourceId)).toEqual(expect.arrayContaining(["777375-2026", "26-108766"]));
  });

  it("IA bloquée pour l'utilisatrice : aucun appel, rien d'inséré", async () => {
    const { d, inseres } = deps([], { estBloquee: vi.fn(async () => true) });
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(b.iaBloquee).toBe(true);
    expect(d.qualifier).not.toHaveBeenCalled();
    expect(inseres).toHaveLength(0);
  });

  it("qualification invalide : avis non inséré (retenté au passage suivant), les autres passent", async () => {
    let n = 0;
    const { d, inseres } = deps([], {
      qualifier: vi.fn(async () => { if (n++ === 0) throw new Error("structure_invalide: score"); return qualif(); }),
    });
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(b.echecsQualification).toBe(1);
    expect(b.nouveaux).toBe(7);
    expect(inseres).toHaveLength(7);
  });

  it("délais : passé ou à moins de 6 jours, écarté sans appel IA", async () => {
    const { d } = deps();
    const b = await passageVeilleAO("u1", d, { maintenant: new Date("2026-11-24T08:00:00Z"), sources: ["boamp"] });
    // 26-108766 (30/11) : 6 jours, gardé ; 26-108811 (04/12) gardé ; rien de passé à cette date.
    expect(b.horsDelai).toBe(0);
    const b2 = await passageVeilleAO("u1", deps().d, { maintenant: new Date("2026-11-26T08:00:00Z"), sources: ["boamp"] });
    expect(b2.horsDelai).toBe(1); // 26-108766 : 4 jours
  });

  it("une source en panne n'arrête pas l'autre", async () => {
    const { d } = deps([], {
      fetch: async (url) => (url.startsWith("https://boamp") ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => TED }),
    });
    const b = await passageVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(b.erreursSources).toEqual(["boamp: HTTP 503"]);
    expect(b.nouveaux).toBe(4);
  });
});

describe("un seul passage à la fois", () => {
  it("un second lancement pendant le premier renvoie null ; ensuite c'est à nouveau possible", async () => {
    let liberer!: () => void;
    const attente = new Promise<void>((r) => { liberer = r; });
    const { d } = deps([], { existants: vi.fn(async () => { await attente; return []; }) });
    const premier = lancerVeilleAO("u1", d, { maintenant: MAINTENANT, sources: ["ted"] });
    await new Promise((r) => setTimeout(r, 0));
    expect(veilleEnCours("u1")).toBe(true);
    expect(await lancerVeilleAO("u1", d, { maintenant: MAINTENANT })).toBeNull();
    expect(veilleEnCours("u2")).toBe(false);
    liberer();
    expect((await premier)?.nouveaux).toBe(4);
    expect(veilleEnCours("u1")).toBe(false);
  });

  it("une erreur inattendue est journalisée, jamais levée", async () => {
    const { d } = deps([], { existants: vi.fn(async () => { throw new Error("base indisponible"); }) });
    const b = await lancerVeilleAO("u1", d, { maintenant: MAINTENANT });
    expect(b?.erreursSources).toEqual(["passage: base indisponible"]);
    expect(veilleEnCours("u1")).toBe(false);
  });
});

describe("planificateur", () => {
  it("heure de Paris (hiver et été)", () => {
    expect(heureParis(new Date("2026-11-10T05:49:00Z"))).toEqual({ jour: "2026-11-10", minutes: 6 * 60 + 49 });
    expect(heureParis(new Date("2026-07-10T04:49:00Z")).minutes).toBe(6 * 60 + 49);
  });

  it("part à 06:49 Paris, une fois par jour, rattrapage jusqu'à midi", () => {
    expect(doitLancer(new Date("2026-11-10T05:48:00Z"), null)).toBe(false);
    expect(doitLancer(new Date("2026-11-10T05:49:00Z"), null)).toBe(true);
    expect(doitLancer(new Date("2026-11-10T09:00:00Z"), "2026-11-10")).toBe(false);
    expect(doitLancer(new Date("2026-11-10T11:30:00Z"), "2026-11-09")).toBe(false);
  });

  it("inscription par VEILLE_AO_USERS, limitée à la liste autorisée (profil JMD) avec un avertissement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(utilisatricesVeilleAO({ VEILLE_AO_USERS: " qNCa68cbCCGcMAcLWmehk, autre ,qNCa68cbCCGcMAcLWmehk,," } as any)).toEqual(["qNCa68cbCCGcMAcLWmehk"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("autre ignorée"));
    expect(utilisatricesVeilleAO({ VEILLE_AO_USERS: "autre" } as any)).toEqual([]);
    expect(utilisatricesVeilleAO({} as any)).toEqual([]);
    warn.mockRestore();
  });

  it("passage qui a planté : le jour n'est pas marqué, retenté au tour suivant", async () => {
    let n = 0;
    const { d } = deps([], { existants: vi.fn(async () => { if (n++ === 0) throw new Error("base indisponible"); return []; }) });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const premier = await tourVeilleAO(new Date("2026-11-10T05:50:00Z"), d, ["u1"]);
    expect(premier?.u1?.erreursSources).toEqual(["passage: base indisponible"]);
    const second = await tourVeilleAO(new Date("2026-11-10T05:55:00Z"), d, ["u1"]);
    expect(second?.u1?.nouveaux).toBe(8);
    expect(await tourVeilleAO(new Date("2026-11-10T06:00:00Z"), d, ["u1"])).toBeNull();
    err.mockRestore();
  });

  it("une source en panne n'empêche pas de marquer le jour (le passage a abouti)", async () => {
    const { d } = deps([], { fetch: async (url) => (url.startsWith("https://boamp") ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => TED }) });
    await tourVeilleAO(new Date("2026-11-10T05:50:00Z"), d, ["u1"]);
    expect(await tourVeilleAO(new Date("2026-11-10T05:55:00Z"), d, ["u1"])).toBeNull();
  });

  it("le jour n'est marqué fait que si le passage est réellement parti", async () => {
    const { d } = deps();
    const t = new Date("2026-11-10T05:50:00Z");
    const lancement = passageBloquant(d);
    const bilans = await tourVeilleAO(t, d, ["u1"]); // un passage manuel tourne déjà : refusé
    expect(bilans).toEqual({ u1: null });
    lancement.liberer();
    await lancement.fini;
    const ensuite = await tourVeilleAO(new Date("2026-11-10T06:00:00Z"), d, ["u1"]);
    expect(ensuite?.u1?.nouveaux).toBe(8);
    expect(await tourVeilleAO(new Date("2026-11-10T06:10:00Z"), d, ["u1"])).toBeNull();
  });

  it("un tour : chaque inscrite une fois, puis plus rien le même jour", async () => {
    const { d } = deps();
    const t = new Date("2026-11-10T05:50:00Z");
    const bilans = await tourVeilleAO(t, d, ["u1", "u2"]);
    expect(Object.keys(bilans!)).toEqual(["u1", "u2"]);
    expect(await tourVeilleAO(new Date("2026-11-10T06:00:00Z"), d, ["u1", "u2"])).toBeNull();
    expect(await tourVeilleAO(t, d, [])).toBeNull();
  });
});
