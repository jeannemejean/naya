// Règle non négociable (CLAUDE.md) : Naya ne génère JAMAIS de tâches pour un jalon `locked`.
//
// Jusqu'au 15 oct. 2026, la règle n'était qu'une phrase du contexte (« Jalons BLOQUÉS : tu NE
// DOIS PAS… ») — absente des appels sans contexte (tâches de campagne), et jamais vérifiée.
// Les tâches générées ne portent aucun lien vers un jalon : seule une lecture de leur sens dit
// si elles font avancer un jalon verrouillé. Cette garde fait cette lecture, APRÈS la
// génération, par un appel indépendant (modèle rapide, réponse structurée et validée), et
// MARQUE les tâches fautives (voir marques-jalons.ts) ; `filtrerTachesGenerees` les retire.
//
// Sans jalon verrouillé : aucun appel, aucun coût. Si la vérification échoue, les tâches
// passent (choix de Jeanne, 15 oct. 2026 : une panne ne vide pas la journée ; la phrase du
// prompt reste le premier filet) — et l'échec est journalisé.
import { z } from "zod/v4";
import { marquer } from "./marques-jalons";

export interface JalonVerrouille { id: number; title: string; description: string | null }

export const SCHEMA_VERIFICATION = z.object({
  taches: z.array(z.object({ index: z.number().int(), jalonId: z.number().int().nullable() })),
});

export interface DepsJalons {
  /** Les jalons `locked` du projet ; de tous les projets de l'utilisatrice si projectId est null. */
  jalonsVerrouilles(userId: string, projectId: number | null): Promise<JalonVerrouille[]>;
  verifier(entree: {
    userId: string; projectId: number | null;
    taches: Array<{ index: number; title: string; description: string }>;
    jalons: JalonVerrouille[];
  }): Promise<z.infer<typeof SCHEMA_VERIFICATION>>;
}

const texte = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim().slice(0, max);

/** Marque les tâches qui font avancer un jalon verrouillé. Rend le nombre marqué. Ne lève jamais. */
export async function marquerTachesDesJalonsVerrouilles(
  taches: unknown[] | null | undefined,
  userId: string,
  projectId: number | null | undefined,
  deps?: DepsJalons,
): Promise<number> {
  if (!Array.isArray(taches) || taches.length === 0 || !userId) return 0;
  try {
    const d = deps ?? depsReelles;
    const jalons = await d.jalonsVerrouilles(userId, projectId ?? null);
    if (jalons.length === 0) return 0;
    const { taches: verdicts } = await d.verifier({
      userId, projectId: projectId ?? null, jalons,
      taches: taches.map((t: any, index) => ({ index, title: texte(t?.title, 200), description: texte(t?.description, 400) })),
    });
    const parId = new Map(jalons.map((j) => [j.id, j]));
    const ecartees: string[] = [];
    for (const v of verdicts) {
      const jalon = v.jalonId != null ? parId.get(v.jalonId) : undefined;
      const tache: any = taches[v.index];
      if (!jalon || !tache) continue;
      marquer(tache);
      ecartees.push(`« ${texte(tache.title, 120)} » → jalon verrouillé « ${jalon.title} »`);
    }
    if (ecartees.length > 0) {
      console.log(`[JalonsVerrouilles] ${ecartees.length} tâche(s) écartée(s) :\n  ${ecartees.join("\n  ")}`);
    }
    return ecartees.length;
  } catch (e: any) {
    console.error("[JalonsVerrouilles] vérification impossible, tâches laissées passer :", e?.message ?? e);
    return 0;
  }
}

const SYSTEME =
  "Tu vérifies une règle absolue : aucune tâche ne doit faire avancer un jalon VERROUILLÉ (sa condition de déblocage n'est pas encore remplie). " +
  "Pour chaque tâche, donne l'id du jalon verrouillé qu'elle fait avancer directement, ou null. " +
  "Ne désigne un jalon que si la tâche travaille clairement sur ce jalon ; une tâche générale, quotidienne ou liée à un autre sujet → null. " +
  "Une entrée par tâche, avec son index.";

const depsReelles: DepsJalons = {
  async jalonsVerrouilles(userId, projectId) {
    const { storage } = await import("../storage");
    const projets = projectId != null ? [projectId] : (await storage.getProjects(userId)).map((p) => p.id);
    const out: JalonVerrouille[] = [];
    for (const pid of projets) {
      for (const m of await storage.getMilestones(pid, userId)) {
        if (m.status === "locked") out.push({ id: m.id, title: m.title, description: m.description ?? null });
      }
    }
    return out;
  },
  async verifier({ userId, projectId, taches, jalons }) {
    const [{ genererStructure }, { CLAUDE_MODELS }] = await Promise.all([import("./ai/structure"), import("./claude")]);
    const { valeur } = await genererStructure({
      schema: SCHEMA_VERIFICATION, system: SYSTEME, model: CLAUDE_MODELS.fast, maxTokens: 1200,
      taskKind: "classification", etape: "garde des jalons verrouillés", userId, projectId,
      prompt: [
        "Jalons verrouillés :",
        ...jalons.map((j) => `#${j.id} ${j.title}${j.description ? ` — ${j.description}` : ""}`),
        "",
        "Tâches :",
        ...taches.map((t) => `[${t.index}] ${t.title}${t.description ? ` — ${t.description}` : ""}`),
      ].join("\n"),
    });
    return valeur;
  },
};
