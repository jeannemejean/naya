// Onglets de la page projet : tout ce qui concerne un projet vit dans sa page. L'onglet est dans
// l'URL (?onglet=…) : Retour, un lien copié ou une notification ouvrent exactement le bon écran.
export const ONGLETS = ["ensemble", "fondations", "veille", "mesure", "client"] as const;
export type Onglet = (typeof ONGLETS)[number];

export function ongletDe(recherche: string, estClient: boolean): Onglet {
  const o = new URLSearchParams(recherche.startsWith("?") ? recherche.slice(1) : recherche).get("onglet");
  if (!o || !(ONGLETS as readonly string[]).includes(o)) return "ensemble";
  if (o === "client" && !estClient) return "ensemble";
  return o as Onglet;
}

export function lienOnglet(projectId: number, onglet: Onglet): string {
  return onglet === "ensemble" ? `/projects/${projectId}` : `/projects/${projectId}?onglet=${onglet}`;
}

export function ongletPourAutreProjet(onglet: Onglet, autreEstClient: boolean): Onglet {
  return onglet === "client" && !autreEstClient ? "ensemble" : onglet;
}
