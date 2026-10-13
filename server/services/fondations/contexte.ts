/**
 * Section « Fondations validées » du contexte de Naya. PUR.
 * Seules les sections validées sortent. En mode tiers (message à un inconnu) : l'offre
 * d'entrée et les motivations seulement, jamais les KPI ni le plan.
 */
import { BRIQUES, LIBELLES_FORMATS, type FormatCreatif } from "./catalogues";
import { statutsDe, type Offre, type Motivation, type Kpi, type Plan } from "./sections";

const MAX = 3500;

export function blocFondations(f: { statuts?: unknown; offre?: unknown; motivations?: unknown; kpis?: unknown; plan?: unknown } | null | undefined, opts: { tiers: boolean }): string {
  if (!f) return "";
  const s = statutsDe(f);
  const parties: string[] = [];

  const offre = f.offre as Offre | null;
  if (s.offre === "valide" && offre?.nom) {
    parties.push(`### Offre d'entrée\n${offre.nom}${offre.prix ? ` (${offre.prix})` : ""}${offre.description ? ` : ${offre.description}` : ""}` +
      `${offre.pourquoi ? `\nPourquoi elle fait passer à l'achat : ${offre.pourquoi}` : ""}${offre.existe ? "" : "\n(Pas encore en place : à créer.)"}`);
  }

  const motivations = Array.isArray(f.motivations) ? (f.motivations as Motivation[]) : [];
  if (s.motivations === "valide" && motivations.length) {
    const lignes = motivations.map((m) => {
      const l = [`- **${m.nom}**${m.angle ? ` — ${m.angle}` : ""}`];
      if (m.accroches?.length) l.push(`  Accroches : ${m.accroches.join(" / ")}`);
      if (m.preuves?.length) l.push(`  Preuves : ${m.preuves.join(" / ")}`);
      if (m.objections?.length) l.push(`  Objections à lever : ${m.objections.join(" / ")}`);
      if (m.formats?.length) l.push(`  Formats : ${m.formats.map((x) => LIBELLES_FORMATS[x as FormatCreatif] || x).join(", ")}`);
      return l.join("\n");
    });
    parties.push(`### Motivations d'achat (les angles)\n${lignes.join("\n")}\n` +
      `Quand tu proposes un contenu, un message ou une campagne, pars d'une de ces motivations et varie-les. N'invente pas de preuve au-delà de celles-ci.`);
  }

  if (!opts.tiers) {
    const kpis = Array.isArray(f.kpis) ? (f.kpis as Kpi[]) : [];
    if (s.kpis === "valide" && kpis.length) {
      parties.push(`### Indicateurs suivis\n${kpis.map((k) => `- ${k.nom}${k.cible ? ` (cible : ${k.cible})` : ""}`).join("\n")}`);
    }
    const plan = f.plan as Plan | null;
    if (s.plan === "valide" && plan?.briques?.length) {
      const maintenant = plan.briques.filter((b) => b.statut === "maintenant").map((b) => {
        const lib = BRIQUES.find((x) => x.cle === b.cle)?.libelle || b.cle;
        return `- ${lib}${b.action ? ` : ${b.action}` : ""}`;
      });
      if (maintenant.length) parties.push(`### Plan d'acquisition (stade : ${plan.maturite}) — briques à travailler maintenant\n${maintenant.join("\n")}`);
    }
  }

  if (!parties.length) return "";
  return `## Fondations validées du projet\n${parties.join("\n\n")}`.slice(0, MAX);
}
