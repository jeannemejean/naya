import type { NayaModelProvider } from "./types";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";

// Registre des providers disponibles selon les clés env présentes.
// Anthropic est toujours instancié (provider principal). OpenAI seulement si
// OPENAI_API_KEY est présent (secours + embeddings).
const providers = new Map<string, NayaModelProvider>();

providers.set("anthropic", new AnthropicProvider());
if (process.env.OPENAI_API_KEY) {
  providers.set("openai", new OpenAIProvider());
}

export const registry = {
  get(name: string): NayaModelProvider {
    const p = providers.get(name);
    if (!p) {
      throw new Error(
        `[ai/registry] Provider inconnu ou indisponible : "${name}". ` +
        `Providers actifs : ${Array.from(providers.keys()).join(", ") || "(aucun)"}.`,
      );
    }
    return p;
  },
  has(name: string): boolean {
    return providers.has(name);
  },
  names(): string[] {
    return Array.from(providers.keys());
  },
};
