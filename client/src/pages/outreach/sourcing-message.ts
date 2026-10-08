/** Réponse de /source-leads (server/services/prospection-pipeline.ts → sourcerCampagne). */
export interface ReponseSourcing {
  imported: number;
  skipped: number;
  cible: number;
  reserve: number;
  reserveSuffisante?: boolean;
  cibleAtteinte: boolean;
}

/** Toast après un sourcing : ce qui a été importé, rapporté à la cible de la campagne. */
export function resumeSourcing(r: ReponseSourcing): { title: string; description: string } {
  if (r.reserveSuffisante) {
    return {
      title: "Ta réserve suffit",
      description: `${r.reserve} prospects attendent déjà d'être contactés, pour un objectif de ${r.cible} sur deux semaines.`,
    };
  }
  const pl = r.imported > 1 ? "s" : "";
  const title = `${r.imported} prospect${pl} importé${pl}`;
  const ecartes = r.skipped > 0 ? ` ${r.skipped} déjà présent${r.skipped > 1 ? "s" : ""} écarté${r.skipped > 1 ? "s" : ""}.` : "";
  if (r.cibleAtteinte) {
    return { title, description: `Objectif des deux prochaines semaines atteint (${r.cible}).${ecartes}` };
  }
  return {
    title,
    description: `${r.imported + r.reserve} sur un objectif de ${r.cible} avec ta réserve.${ecartes} Relance la recherche plus tard pour de nouveaux angles.`,
  };
}
