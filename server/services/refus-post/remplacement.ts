// Génération d'un post de remplacement après un refus. Ne lève jamais.
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { imposerLangueDuCompte } from "../garde-langue";
import { formaterPreferences, preferencesDeLaMarque } from "../campaign-reject/preferences";
import { libelleRaisonPost, validerPostRemplacement, type PostRemplacement, type RaisonRefusPost } from "./pur";

// Retire les clôtures ``` éventuelles autour du JSON.
function retirerClotures(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function genererPostRemplacement(input: {
  userId: string;
  post: {
    projectId?: number | null; platform?: string | null; contentType?: string | null;
    pillar?: string | null; goal?: string | null; title?: string | null; body?: string | null;
  };
  raison: RaisonRefusPost;
  explication?: string | null;
}): Promise<PostRemplacement | null> {
  try {
    const { userId, post, raison } = input;
    const explication = (input.explication ?? "").trim().slice(0, 1500);
    const projectId = post.projectId ?? null;

    // Préférences de la marque : best-effort, jamais bloquantes.
    let preferences = "";
    if (projectId != null) {
      try {
        preferences = formaterPreferences(await preferencesDeLaMarque(userId, projectId));
      } catch (e: any) {
        console.error("[refus-post] préférences indisponibles :", e?.message || e);
      }
    }

    const message = [
      "The user declined this post:",
      `Network: ${post.platform || ""}`,
      `Content type: ${post.contentType || ""}`,
      `Pillar: ${post.pillar || ""}`,
      `Goal: ${post.goal || ""}`,
      `Title: ${post.title || ""}`,
      `Excerpt: ${(post.body || "").slice(0, 1200)}`,
      `Reason: ${libelleRaisonPost(raison)}`,
      explication ? `Explanation from the user: ${explication}` : "",
      preferences,
      "",
      "Write ONE replacement post, ready to publish as is on this network, serving the same goal, avoiding what was declined and why.",
      'Respond with JSON only: {"title","body"}',
    ].filter(Boolean).join("\n");

    const texte = await callClaudeWithContext({
      userId,
      projectId,
      userMessage: message,
      model: CLAUDE_MODELS.fast,
      max_tokens: 1500,
    });

    let brut: unknown;
    try {
      brut = JSON.parse(retirerClotures(texte));
    } catch {
      console.error("[refus-post] génération : réponse non JSON");
      return null;
    }
    const r = validerPostRemplacement(brut);
    if (!r) {
      console.error("[refus-post] génération : remplacement invalide");
      return null;
    }
    // Garde de langue : le texte est traité comme une tâche { title, description }, puis recopié.
    const tampon = { title: r.title, description: r.body };
    await imposerLangueDuCompte([tampon as any], userId);
    return {
      title: (typeof tampon.title === "string" && tampon.title.trim() ? tampon.title : r.title).slice(0, 200),
      body: (typeof tampon.description === "string" && tampon.description.trim() ? tampon.description : r.body).slice(0, 5000),
    };
  } catch (e: any) {
    console.error("[refus-post] génération échouée :", e?.message || e);
    return null;
  }
}
