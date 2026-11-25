import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { recurringRituals, envois, seancesRedemarrage, connexionsMetricool } from "./schema";
import { STATUTS_ENVOI } from "./envois";

describe("schéma de la séance de redémarrage", () => {
  it("rituels : intervalle en semaines et date d'ancrage", () => {
    const c = getTableColumns(recurringRituals);
    expect(c).toHaveProperty("intervalWeeks");
    expect(c).toHaveProperty("anchorDate");
  });
  it("envois : statut et prochaine relance", () => {
    const c = getTableColumns(envois);
    expect(c).toHaveProperty("prochaineRelance");
    expect(c).toHaveProperty("statut");
  });
  it("séances et connexion Metricool existent", () => {
    expect(getTableColumns(seancesRedemarrage)).toHaveProperty("projets");
    expect(getTableColumns(connexionsMetricool)).toHaveProperty("jetonChiffre");
  });
  it("statuts d'envoi", () => {
    expect([...STATUTS_ENVOI]).toEqual(["envoye", "relance", "reponse", "accepte", "refuse", "sans_suite"]);
  });
});
