// Libellés courts côté serveur (aperçus des propositions).
const JOURS: Record<string, string> = { mon: "lun", tue: "mar", wed: "mer", thu: "jeu", fri: "ven", sat: "sam", sun: "dim" };

export function formatRythmeServeur(days: string, intervalWeeks: number | null | undefined): string {
  const liste = days.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const jours = liste.length === 7 ? "tous les jours"
    : liste.length === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => liste.includes(d)) ? "du lun au ven"
    : liste.map((d) => JOURS[d] ?? d).join(" · ");
  return intervalWeeks && intervalWeeks > 1 ? `${jours}, toutes les ${intervalWeeks} semaines` : jours;
}
