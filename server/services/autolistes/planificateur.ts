// Autolistes (lot 6) : le passage qui garde les 7 prochains jours de chaque liste active posés
// dans le calendrier, et qui compte les publications (un post publié d'une liste sans boucle est
// consommé). Un tour par heure (et 1 min après le démarrage) : le passage du jour ne se perd pas
// sur un redémarrage, et un post publié est vite compté. Chaque modification d'une liste la
// repose aussi aussitôt (routes). Les erreurs sont journalisées, jamais levées.
import { materialiserTout } from "./materialiser";

let tourEnCours = false;

export async function tourAutolistes(): Promise<void> {
  if (tourEnCours) return;
  tourEnCours = true;
  try {
    const { depsMaterialiser } = await import("./deps");
    const b = await materialiserTout(depsMaterialiser);
    if (b.poses || b.erreurs) console.log(`[autolistes] ${b.listes} liste(s), ${b.poses} post(s) posé(s), ${b.erreurs} erreur(s)`);
  } catch (e: any) {
    console.error("[autolistes] tour :", e?.message ?? e);
  } finally {
    tourEnCours = false;
  }
}

export function scheduleAutolistes(): void {
  setInterval(() => void tourAutolistes(), 60 * 60_000);
  setTimeout(() => void tourAutolistes(), 60_000);
  console.log("[autolistes] passage planifié chaque heure (7 jours posés à l'avance)");
}
