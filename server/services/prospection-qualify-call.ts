import { callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { lireQualification, type Qualification } from "./prospection-qualification";

/**
 * L'audit tel que le pipeline le manipule : un dictionnaire de sections, pas forcement
 * complet. Le typer en `AuditSections` strict obligerait a une conversion mensongere —
 * generateAudit rend un Record dont rien ne garantit que toutes les sections sont presentes.
 */
export type AuditLu = Record<string, string | undefined>;

/**
 * Produit le verdict de qualification d'un prospect à partir de son audit.
 *
 * `callClaudeWithContext` injecte le Brand DNA et la langue du compte : les critères
 * viennent donc du contexte de CETTE utilisatrice, jamais d'un barème universel. C'est une
 * contrainte explicite de Jeanne — ne pas universaliser le playbook de l'agence, dériver les
 * critères du contexte de chaque utilisateur.
 *
 * Les dossiers qu'elle déposera plus tard affineront ce jugement en passant par le même
 * canal, sans que ce module change.
 *
 * NE LÈVE JAMAIS. Un modèle indisponible rend `null`, et `null` veut dire « pas qualifié » —
 * jamais « écarté ». Perdre un prospect parce qu'un appel réseau a raté serait exactement le
 * défaut que ce dispositif existe pour éviter.
 */

const DELAI_MS = 12_000;

function avecDelai<T>(p: Promise<T>, ms: number, siDepasse: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const minuteur = setTimeout(() => resolve(siDepasse), ms);
    p.then(
      (v) => { clearTimeout(minuteur); resolve(v); },
      () => { clearTimeout(minuteur); resolve(siDepasse); },
    );
  });
}

export async function qualifierProspect(input: {
  userId: string;
  projectId: number | null;
  audit: AuditLu;
  /** Ce qu'on sait du prospect : société, rôle, texte d'enrichissement. */
  contexteProspect: string;
}): Promise<Qualification | null> {
  try {
    const prompt = `Un audit vient d'être réalisé sur ce prospect. Décide s'il a sa place dans la campagne de prospection.

CE QU'ON SAIT DU PROSPECT
${input.contexteProspect.slice(0, 1500)}

L'AUDIT
Contexte : ${input.audit.contexteMarque ?? ""}
Audience : ${input.audit.audience ?? ""}
Contenu : ${input.audit.contenu ?? ""}
Positionnement : ${input.audit.positionnement ?? ""}
Enjeux : ${input.audit.enjeux ?? ""}
Angle : ${input.audit.angle ?? ""}

Juge à partir du Brand DNA que tu connais — l'offre réelle, l'audience visée, le
positionnement. Ne juge PAS sur la notoriété ou la taille de la marque : une grande maison
peut être hors sujet, une petite structure peut être parfaitement alignée.

Trois verdicts possibles :

- "retenu" : l'audit montre un besoin que cette offre adresse, et un interlocuteur en
  position d'y répondre.
- "ecarte" : l'audit montre que ce prospect n'a pas ce besoin, ou qu'il est hors de portée.
- "attention_particuliere" : le prospect est intéressant mais l'approche standard ne
  conviendrait pas. Une maison dont la communication est volontairement en retrait, un
  interlocuteur qu'il faut aborder autrement, un cas où la campagne générique desservirait.

"confiance" dit à quel point l'audit te permet de trancher :
- "haute" : l'audit contient de quoi décider sans hésiter.
- "moyenne" : tu penches, mais l'audit est incomplet.
- "basse" : l'audit ne permet pas vraiment de juger.

Sois avare de "haute" sur un "ecarte" : c'est le seul cas qui retire le prospect de la
campagne sans relecture humaine. Dans le doute, dis "moyenne".

"raison" : une phrase, concrète, tirée de l'audit. Elle sera lue par l'utilisatrice pour
contester ou confirmer ton verdict. Pas de généralité.

Réponds en JSON strict, sans texte autour, sans balises markdown :
{"verdict":"retenu|ecarte|attention_particuliere","raison":"...","confiance":"haute|moyenne|basse"}`;

    const brut = await avecDelai(
      callClaudeWithContext({
        userId: input.userId,
        projectId: input.projectId,
        userMessage: prompt,
        model: CLAUDE_MODELS.fast,
        max_tokens: 400,
      }),
      DELAI_MS,
      "",
    );

    return lireQualification(extraireJson(brut));
  } catch (e: any) {
    console.error("[Qualification] indisponible:", e?.message ?? e);
    return null;
  }
}

/** Extraction défensive : le modèle entoure parfois son JSON de texte ou de balises. */
export function extraireJson(brut: string): unknown {
  const sansBalises = (brut ?? "").replace(/```(?:json)?/gi, "").trim();
  const debut = sansBalises.indexOf("{");
  const fin = sansBalises.lastIndexOf("}");
  if (debut === -1 || fin === -1 || fin <= debut) return null;
  try {
    return JSON.parse(sansBalises.slice(debut, fin + 1));
  } catch {
    return null;
  }
}
