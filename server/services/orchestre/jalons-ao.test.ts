// Étape 2 du chef d'orchestre : les appels d'offres posent leurs jalons (spec §« Étape 2 »).
import { describe, it, expect } from "vitest";
import { jalonsDe, cleJalon, planDeSynchro, type TacheAO } from "./jalons-ao";

const ouvre = (j: string) => ![0, 6].includes(new Date(`${j}T12:00:00Z`).getUTCDay());
// Jeudi 19 nov. 2026.
const AUJ = "2026-11-19";
const limite = (jour: string, h = "11:00") => new Date(`${jour}T${h}:00.000Z`);
const ao = (o: Partial<Parameters<typeof jalonsDe>[0]> = {}) => ({
  id: 7, objet: "Refonte du site de la mairie", statut: "en_redaction", procedure: "MAPA",
  dateLimite: limite("2026-12-04"), lienAvis: "https://exemple.fr/avis", projectId: 3, ...o,
});

describe("jalonsDe", () => {
  it("en rédaction (MAPA) : analyse, 2 parties de rédaction, pièces, relecture, dépôt, rétro-planifiés avec un jour de tampon", () => {
    // Limite vendredi 4 déc. → dépôt jeudi 3, relecture + pièces mercredi 2, rédaction lundi 30 nov. et mardi 1er, analyse vendredi 27.
    const j = jalonsDe(ao(), AUJ, ouvre);
    expect(j.map((x) => [x.jalon, x.partie ?? 0, x.echeance, x.duree])).toEqual([
      ["analyse", 0, "2026-11-27", 45],
      ["redaction", 1, "2026-11-30", 120],
      ["redaction", 2, "2026-12-01", 120],
      ["pieces", 0, "2026-12-02", 60],
      ["relecture", 0, "2026-12-02", 60],
      ["depot", 0, "2026-12-03", 30],
    ]);
    // Planifiée un jour travaillé avant son échéance (du jeu pour le re-tassage).
    expect(j[0].jourPlanifie).toBe("2026-11-26");
    expect(j[5].jourPlanifie).toBe("2026-12-02");
    expect(j[1].titre).toBe("AO « Refonte du site de la mairie » : rédiger le mémoire technique (partie 1/2)");
  });

  it("appel d'offres ouvert : 4 parties de rédaction", () => {
    const j = jalonsDe(ao({ procedure: "Appel d'offres ouvert", dateLimite: limite("2026-12-18") }), AUJ, ouvre);
    expect(j.filter((x) => x.jalon === "redaction")).toHaveLength(4);
  });

  it("pris tard : les échéances se tassent sur aujourd'hui, jamais avant ; jamais après le jour limite", () => {
    const j = jalonsDe(ao({ dateLimite: limite("2026-11-23") }), AUJ, ouvre); // lundi
    for (const x of j) {
      expect(x.echeance >= AUJ).toBe(true);
      expect(x.echeance <= "2026-11-23").toBe(true);
      expect(x.jourPlanifie >= AUJ).toBe(true);
      expect(x.jourPlanifie <= x.echeance).toBe(true);
    }
    expect(j.find((x) => x.jalon === "depot")!.echeance).toBe("2026-11-20");
  });

  it("aujourd'hui un samedi : le plancher est le prochain jour travaillé", () => {
    const j = jalonsDe(ao({ dateLimite: limite("2026-11-24") }), "2026-11-21", ouvre);
    expect(Math.min(...j.map((x) => Date.parse(x.jourPlanifie)))).toBe(Date.parse("2026-11-23"));
  });

  it("premier jet prêt : une seule décision, échéance = le jour où l'analyse doit commencer", () => {
    const j = jalonsDe(ao({ statut: "premier_jet_pret" }), AUJ, ouvre);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ jalon: "decision", echeance: "2026-11-27", duree: 15 });
    expect(j[0].titre).toBe("Décider : répondre à « Refonte du site de la mairie » ?");
  });

  it("date limite passée, absente, ou statut sans travail : aucun jalon", () => {
    expect(jalonsDe(ao({ dateLimite: limite("2026-11-18") }), AUJ, ouvre)).toEqual([]);
    expect(jalonsDe(ao({ dateLimite: null }), AUJ, ouvre)).toEqual([]);
    for (const statut of ["repere", "depose", "gagne", "perdu", "ecarte"]) {
      expect(jalonsDe(ao({ statut }), AUJ, ouvre)).toEqual([]);
    }
  });

  it("objet long : coupé à 60 caractères", () => {
    const j = jalonsDe(ao({ objet: "x".repeat(100), statut: "premier_jet_pret" }), AUJ, ouvre);
    expect(j[0].titre).toBe(`Décider : répondre à « ${"x".repeat(59)}… » ?`);
  });
});

describe("planDeSynchro", () => {
  const attendus = jalonsDe(ao(), AUJ, ouvre).map((j) => ({ aoId: 7, ...j }));
  const tache = (jalon: string, partie: number | undefined, o: Partial<TacheAO> = {}): TacheAO => ({
    id: Math.floor(Math.random() * 1e6), completed: false, archivedAt: null,
    actionData: { ao: { id: 7, jalon, ...(partie ? { partie } : {}) }, echeanceDure: "2026-11-27" }, ...o,
  });

  it("rien en base : tout est à créer", () => {
    const p = planDeSynchro(attendus, []);
    expect(p.aCreer).toHaveLength(6);
    expect(p.aArchiver).toEqual([]);
  });

  it("une tâche cochée ou archivée n'est jamais recréée ni touchée", () => {
    const faite = tache("analyse", undefined, { completed: true, actionData: { ao: { id: 7, jalon: "analyse" }, echeanceDure: "2026-11-01" } });
    const archivee = tache("depot", undefined, { archivedAt: new Date() });
    const p = planDeSynchro(attendus, [faite, archivee]);
    expect(p.aCreer.map((x) => x.jalon)).not.toContain("analyse");
    expect(p.aCreer.map((x) => x.jalon)).not.toContain("depot");
    expect(p.aModifier).toEqual([]);
  });

  it("ouverte et plus attendue (statut avancé, limite passée) : archivée", () => {
    const orpheline = tache("decision", undefined);
    expect(planDeSynchro(attendus, [orpheline]).aArchiver).toEqual([orpheline.id]);
  });

  it("ouverte, échéance changée (date limite repoussée) : l'échéance suit", () => {
    const t = tache("analyse", undefined, { actionData: { ao: { id: 7, jalon: "analyse" }, echeanceDure: "2026-11-20" } });
    const p = planDeSynchro(attendus, [t]);
    expect(p.aModifier).toEqual([{ id: t.id, echeance: "2026-11-27" }]);
  });

  it("clé : AO, jalon, partie", () => {
    expect(cleJalon(7, "redaction", 2)).toBe("7:redaction:2");
    expect(cleJalon(7, "depot")).toBe("7:depot:0");
  });
});

describe("synchroniserJalonsAO", () => {
  it("crée les jalons manquants avec leur échéance dure, archive les orphelins, ré-échéance", async () => {
    const { synchroniserJalonsAO } = await import("./jalons-ao");
    const creees: Record<string, any>[] = [];
    const archivees: number[] = [];
    const reEch: [number, string][] = [];
    const r = await synchroniserJalonsAO("u", new Date("2026-11-19T08:00:00Z"), {
      listerAO: async () => [ao(), ao({ id: 8, statut: "depose" })],
      tachesAO: async () => [
        { id: 50, completed: false, archivedAt: null, actionData: { ao: { id: 8, jalon: "depot" }, echeanceDure: "2026-11-25" } },
        { id: 51, completed: false, archivedAt: null, actionData: { ao: { id: 7, jalon: "depot" }, echeanceDure: "2026-12-01" } },
      ],
      estTravaille: async () => ouvre,
      creer: async (_u, d) => { creees.push(d); return true; },
      archiver: async (_u, id) => { archivees.push(id); },
      reEcheancer: async (_u, id, e) => { reEch.push([id, e]); },
    });
    expect(r).toEqual({ crees: 5, archivees: 1, reEcheancees: 1 });
    expect(archivees).toEqual([50]);
    expect(reEch).toEqual([[51, "2026-12-03"]]);
    expect(creees[0]).toMatchObject({
      source: "appel_offres", taskType: "ao_jalon", projectId: 3, scheduledDate: "2026-11-26", estimatedDuration: 45,
      actionData: { ao: { id: 7, jalon: "analyse" }, echeanceDure: "2026-11-27", lien: "/appels-offres", externalUrl: "https://exemple.fr/avis" },
    });
    expect(creees[0].dueDate.toISOString()).toBe("2026-11-27T22:59:00.000Z");
  });
});
