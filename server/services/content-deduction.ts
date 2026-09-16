import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { CHAMPS_DEDUCTIBLES, type ChampDeductible } from "./task-to-content";

/**
 * Déduction des champs obligatoires du calendrier de contenu, à partir du texte écrit dans
 * l'espace de travail d'une tâche.
 *
 * `callClaudeWithContext` injecte l'ADN de marque et la directive de langue du compte : le
 * modèle connaît donc les piliers éditoriaux réels et la plateforme prioritaire, plutôt que
 * d'inventer à partir du seul texte.
 *
 * RÈGLE ABSOLUE : cette fonction ne lève jamais. Le texte de l'utilisatrice est la donnée
 * précieuse ; le routage vers le calendrier est un bénéfice. Un modèle indisponible, une
 * réponse illisible ou un dépassement de quota ne doivent pas faire échouer un
 * enregistrement. C'est la même discipline que pour l'écriture mémoire du lot précédent :
 * perdre le travail de quelqu'un parce qu'un appel réseau a raté serait précisément le
 * défaut que tout ceci corrige.
 */

const MAX_EXTRAIT = 2000;

/**
 * Au-delà, on renonce à déduire et on écrit « à préciser ».
 *
 * L'appel se fait pendant que l'utilisatrice attend le retour de son clic sur Enregistrer.
 * Sans cette borne, un modèle qui pend retiendrait la requête entière — donc son texte
 * paraîtrait ne pas s'enregistrer, alors qu'il l'est déjà.
 */
export const DELAI_DEDUCTION_MS = 8000;

function avecDelai<T>(p: Promise<T>, ms: number, valeurSiDepasse: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const minuteur = setTimeout(() => resolve(valeurSiDepasse), ms);
    p.then(
      (v) => { clearTimeout(minuteur); resolve(v); },
      () => { clearTimeout(minuteur); resolve(valeurSiDepasse); },
    );
  });
}

export async function deduireChampsContenu(input: {
  userId: string;
  projectId: number | null;
  titreTache: string;
  titreNote: string;
  texte: string;
}): Promise<Partial<Record<ChampDeductible, string>>> {
  try {
    const prompt = `Une note vient d'être écrite en réalisant cette tâche. Elle part au calendrier de contenu.

Tâche : ${input.titreTache}
Titre de la note : ${input.titreNote || "(aucun)"}
Texte :
"""
${input.texte.slice(0, MAX_EXTRAIT)}
"""

Déduis UNIQUEMENT ces quatre champs, à partir du texte et de l'ADN de marque que tu connais :

- platform     : la plateforme de publication (linkedin, instagram, tiktok, newsletter, youtube, blog…)
- contentType  : le format (post, carousel, article, video, story, thread…)
- pillar       : le pilier éditorial, pris dans ceux du Brand DNA quand l'un correspond
- goal         : l'objectif visé, en quelques mots

Réponds en JSON strict, sans texte autour, sans balises markdown :
{"platform":"...","contentType":"...","pillar":"...","goal":"..."}

Laisse un champ à "" si le texte ne permet pas de le déterminer. Ne devine pas un pilier qui
n'existe pas dans le Brand DNA : une chaîne vide vaut mieux qu'un pilier inventé.`;

    const brut = await avecDelai(
      callClaudeWithContext({
        userId: input.userId,
        projectId: input.projectId,
        userMessage: prompt,
        model: CLAUDE_MODELS.fast,
        max_tokens: 300,
      }),
      DELAI_DEDUCTION_MS,
      "",
    );

    return lireReponse(brut);
  } catch (e: any) {
    // Jamais bloquant, jamais muet : construireContenuDepuisTache écrira « à préciser » et
    // marquera les champs, donc l'utilisatrice verra qu'il y a quelque chose à compléter.
    console.error("[ContentDeduction] déduction indisponible:", e?.message ?? e);
    return {};
  }
}

/**
 * Lecture défensive de la réponse. Un modèle peut entourer son JSON de texte, de balises
 * markdown, ou rendre autre chose qu'un objet. Aucune de ces situations ne doit lever :
 * elles valent toutes « je n'ai rien pu déduire ».
 */
export function lireReponse(brut: string): Partial<Record<ChampDeductible, string>> {
  const sansBalises = brut.replace(/```(?:json)?/gi, "").trim();
  const debut = sansBalises.indexOf("{");
  const fin = sansBalises.lastIndexOf("}");
  if (debut === -1 || fin === -1 || fin <= debut) return {};

  let objet: unknown;
  try {
    objet = JSON.parse(sansBalises.slice(debut, fin + 1));
  } catch {
    return {};
  }
  // Pas de test Array.isArray : la tranche commence au premier `{`, donc JSON.parse ne
  // peut rendre qu'un objet ou lever. Un garde inatteignable laisserait croire qu'il
  // protège de quelque chose.
  if (typeof objet !== "object" || objet === null) return {};

  const sortie: Partial<Record<ChampDeductible, string>> = {};
  for (const champ of CHAMPS_DEDUCTIBLES) {
    const v = (objet as Record<string, unknown>)[champ];
    // Seules les chaînes non blanches sont retenues. Un nombre, un objet ou un null rendus
    // par le modèle valent « non déterminé » — construireContenuDepuisTache s'en chargera.
    if (typeof v === "string" && v.trim()) sortie[champ] = v.trim();
  }
  return sortie;
}
