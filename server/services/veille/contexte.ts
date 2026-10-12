/** Bloc « Veille du marché » du contexte de Naya. PUR. */
const ORDRE = ["objection", "vocabulaire", "attente", "sujet", "offre_concurrent", "citation_geo", "source_geo", "position", "contenu_fort", "actu_concurrent", "bilan_geo", "bilan_serp"];
const LIBELLE: Record<string, string> = {
  objection: "Objection", vocabulaire: "Vocabulaire réel", attente: "Attente", sujet: "Sujet",
  offre_concurrent: "Offre concurrente", actu_concurrent: "Actualité concurrente", contenu_fort: "Contenu concurrent fort",
  position: "Google", bilan_serp: "Google", citation_geo: "Réponses des IA", source_geo: "Sources des IA", bilan_geo: "Réponses des IA",
};
const MAX = 8;

export function blocVeille(constats: Array<{ type: string; texte: string }>): string {
  if (!constats.length) return "";
  const rang = (t: string) => { const i = ORDRE.indexOf(t); return i < 0 ? ORDRE.length : i; };
  const lignes = [...constats]
    .sort((a, b) => rang(a.type) - rang(b.type))
    .slice(0, MAX)
    .map((c) => `- [${LIBELLE[c.type] || c.type}] ${c.texte.replace(/\s+/g, " ").trim()}`);
  return `## Veille du marché (relevés réels, récents)\n${lignes.join("\n")}\n\n` +
    `Appuie-toi dessus quand c'est pertinent (objections et mots réels des clients, mouvements des concurrents). N'invente rien au-delà de ces relevés.`;
}
