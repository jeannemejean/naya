// Section « Jalons du projet » de buildNayaContext, groupée par objectif.
// Pur. Les jalons sans objectif (ou reliés à un objectif qui n'est plus actif) gardent le rendu
// historique, mot pour mot : un projet sans chaîne reliée produit exactement le texte d'avant.
// Règle absolue (CLAUDE.md) : chaque jalon `locked` est nommé comme interdit de tâches.
import { etapesActives } from "./carte";

interface JalonCtx { id: number; title: string; status: string; goalId?: number | null; projectId: number; order?: number | null; pourquoi?: string | null }
interface ObjectifCtx { id: number; title: string }

const guillemets = (t: string) => `« ${t} »`;

export function formaterJalonsDuProjet(jalons: JalonCtx[], objectifsActifs: ObjectifCtx[]): string | null {
  if (jalons.length === 0) return null;
  const idsActifs = new Set(objectifsActifs.map((o) => o.id));
  const blocs: string[] = [];

  for (const o of objectifsActifs) {
    const chaine = jalons.filter((j) => j.goalId === o.id);
    if (chaine.length === 0) continue;
    const enCours = etapesActives(chaine as any)[0] as JalonCtx | undefined;
    const verrouillees = chaine.filter((j) => j.status === "locked");
    const franchies = chaine.filter((j) => j.status === "completed");
    const lignes = [
      enCours
        ? `Objectif ${guillemets(o.title)} → étape en cours : ✅ ${guillemets(enCours.title)} (tu PEUX générer des tâches pour cette étape)${enCours.pourquoi ? ` — pourquoi : ${enCours.pourquoi}` : ""}`
        : `Objectif ${guillemets(o.title)} → aucune étape en cours`,
    ];
    if (verrouillees.length > 0) {
      lignes.push(`  Suivantes verrouillées (tu NE DOIS PAS générer de tâches pour elles) : ${verrouillees.map((j) => `🔒 ${guillemets(j.title)}`).join(", ")}`);
    }
    if (franchies.length > 0) lignes.push(`  Déjà franchies : ${franchies.map((j) => guillemets(j.title)).join(", ")}`);
    blocs.push(lignes.join("\n"));
  }

  // Chaîne de projet (sans objectif actif) : rendu historique inchangé.
  const reste = jalons.filter((j) => j.goalId == null || !idsActifs.has(j.goalId));
  const active = reste.filter((m) => ["unlocked", "active", "completed"].includes(m.status));
  const locked = reste.filter((m) => m.status === "locked");
  if (active.length > 0) {
    blocs.push(`Jalons actifs/débloqués (tu PEUX générer des tâches pour ces jalons) :\n${active.map((m) => `- ✅ ${m.title}`).join("\n")}`);
  }
  if (locked.length > 0) {
    blocs.push(`Jalons BLOQUÉS (tu NE DOIS PAS générer de tâches pour ces jalons) :\n${locked.map((m) => `- 🔒 ${m.title} (bloqué — condition non remplie)`).join("\n")}`);
  }
  return blocs.length > 0 ? `## Jalons du projet\n${blocs.join("\n\n")}` : null;
}
