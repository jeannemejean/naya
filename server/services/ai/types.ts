// Phase 1 — Abstraction du modèle. Interface unique derrière laquelle vivent les
// fournisseurs (Anthropic aujourd'hui, OpenAI en secours, modèle maison demain).
// L'intelligence vit dans la couche Naya, pas chez le fournisseur.

export type TaskKind =
  | "strategic_reasoning" // → modèle "smart" (Sonnet)
  | "fast_generation"     // → modèle "fast" (Haiku)
  | "extraction"          // → modèle dédié extraction (Haiku pour l'instant)
  | "classification"      // → fast
  | "embedding";          // → provider d'embeddings (OpenAI en Phase 1)

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateInput {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  provider: string;
  usage?: { inputTokens: number; outputTokens: number };
  // Raison d'arrêt du modèle. "max_tokens" (Anthropic) / "length" (OpenAI) = réponse TRONQUÉE
  // (le budget de tokens a été atteint) → le texte est incomplet, ne jamais le parser en JSON.
  stopReason?: string;
}

export interface EmbedInput {
  texts: string[];
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  provider: string;
}

export interface NayaModelProvider {
  readonly name: string; // "anthropic" | "openai" | "naya-local"
  supports(task: TaskKind): boolean;
  generate(input: GenerateInput, model: string): Promise<GenerateResult>;
  embed?(input: EmbedInput, model: string): Promise<EmbedResult>; // optionnel en Phase 1
  // Le streaming reste géré dans l'adaptateur claude.ts en Phase 1 (pas abstrait ici).
}
