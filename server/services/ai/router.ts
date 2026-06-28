import type { TaskKind } from "./types";

// Politique de routage : mappe une intention métier (TaskKind) vers (provider, model).
// Point unique à modifier pour changer le modèle d'une tâche. Le reste du moteur
// (call sites, adaptateur claude.ts) n'a pas à connaître les noms de modèles.
//
// Overrides possibles par variable d'env : NAYA_MODEL_<TASKKIND_MAJUSCULE> = "provider:model"
// (ex. NAYA_MODEL_STRATEGIC_REASONING="anthropic:claude-sonnet-4-6").
export function route(task: TaskKind): { provider: string; model: string } {
  const override = readEnvOverride(task);
  if (override) return override;

  switch (task) {
    case "strategic_reasoning":
      return { provider: "anthropic", model: "claude-sonnet-4-6" };
    case "fast_generation":
    case "classification":
    case "extraction":
      return { provider: "anthropic", model: "claude-haiku-4-5-20251001" };
    case "embedding":
      // DÉCISION 5 (Phase 2) : text-embedding-3-large RÉDUIT à 1536 dim (matryoshka).
      // Meilleure qualité (surtout en français) ; 1536 reste sous le plafond d'index
      // pgvector HNSW (2000 dim) et fige la dimension côté mémoire. Réduction appliquée
      // par le provider OpenAI (dimensions: 1536).
      return { provider: "openai", model: "text-embedding-3-large" };
  }
}

function readEnvOverride(task: TaskKind): { provider: string; model: string } | null {
  const raw = process.env[`NAYA_MODEL_${task.toUpperCase()}`];
  if (!raw || !raw.includes(":")) return null;
  const idx = raw.indexOf(":");
  const provider = raw.slice(0, idx).trim();
  const model = raw.slice(idx + 1).trim();
  if (!provider || !model) return null;
  return { provider, model };
}
