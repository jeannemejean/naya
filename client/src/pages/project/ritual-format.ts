// Helper PUR d'affichage des jours d'un rituel. Isolé de RitualList.tsx pour rester
// testable en environnement node (le composant tire queryClient, côté navigateur).
const DAY_LABELS: Record<string, string> = {
  mon: "lun", tue: "mar", wed: "mer", thu: "jeu", fri: "ven", sat: "sam", sun: "dim",
};

/** "mon,tue,wed,thu,fri" → "du lun au ven" ; sinon "lun · mer · ven". */
export function formatDays(days: string): string {
  const list = days.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (list.length === 5 && ["mon", "tue", "wed", "thu", "fri"].every((d) => list.includes(d))) {
    return "du lun au ven";
  }
  if (list.length === 7) return "tous les jours";
  return list.map((d) => DAY_LABELS[d] ?? d).join(" · ");
}
