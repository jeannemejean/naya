// API Batch d'Anthropic : 50 % moins cher, résultat en quelques heures (assez pour l'analyse
// hebdomadaire des profils de veille). Le lot est soumis, puis relu à un tour suivant.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./providers/anthropic";
import { estimateClaudeCostEur } from "../usage";

export interface RequeteLot { customId: string; system: string; prompt: string; model: string; maxTokens: number; schema: Record<string, unknown> }
export type ResultatLot = { customId: string; texte: string; coutEur: number } | { customId: string; erreur: string };

export async function soumettreLot(reqs: RequeteLot[], client: Pick<Anthropic, "messages"> = anthropic): Promise<string> {
  const lot = await client.messages.batches.create({
    requests: reqs.map((r) => ({
      custom_id: r.customId,
      params: {
        model: r.model, max_tokens: r.maxTokens, system: r.system,
        messages: [{ role: "user" as const, content: r.prompt }],
        output_config: { format: { type: "json_schema" as const, schema: r.schema } },
      },
    })),
  });
  return lot.id;
}

export async function lireLot(batchId: string, client: Pick<Anthropic, "messages"> = anthropic): Promise<ResultatLot[] | null> {
  const lot = await client.messages.batches.retrieve(batchId);
  if (lot.processing_status !== "ended") return null;
  const out: ResultatLot[] = [];
  for await (const r of await client.messages.batches.results(batchId)) {
    const res: any = r.result;
    if (res.type === "succeeded") {
      const m = res.message;
      const texte = (m.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      out.push({ customId: r.custom_id, texte, coutEur: 0.5 * estimateClaudeCostEur(m.model, m.usage?.input_tokens ?? 0, m.usage?.output_tokens ?? 0) });
    } else {
      out.push({ customId: r.custom_id, erreur: res.type === "errored" ? String(res.error?.error?.message ?? "errored") : String(res.type) });
    }
  }
  return out;
}
