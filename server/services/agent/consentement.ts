// Le « oui » dans la conversation vaut validation de la proposition en attente (16 nov. 2026).
//
// Un message qui ne fait qu'acquiescer (estConsentement), juste après une réponse de Naya qui
// portait une ou des propositions encore en attente : on les valide ici, comme le bouton
// « Valider », et on répond sans repasser par le modèle. Ainsi le modèle ne peut ni refaire une
// proposition ni prétendre avoir agi. Rien d'applicable (déjà traitée, introuvable) : null, la
// conversation suit son cours normal. Expirée : on le dit, sans rien appliquer.
import type { ActionFaite, ReponseAgent } from "@shared/agent";
import { estConsentement } from "@shared/consentement";
import { FENETRE_ANNULATION_MS } from "./journal";
import { validerProposition, type ResultatValidation } from "./propositions";

type Ligne = { role: string; actions?: unknown };

/** Les propositions (id + résumé) portées par la DERNIÈRE réponse de Naya, s'il y en a. */
export function propositionsDuDernierTour(historique: ReadonlyArray<Ligne>): { id: number; resume: string }[] {
  for (let i = historique.length - 1; i >= 0; i--) {
    const l = historique[i];
    if (l.role === "user") continue;
    const props = (l.actions as any)?.propositions;
    if (!Array.isArray(props)) return [];
    return props
      .filter((p: any) => Number.isInteger(p?.id) && p.id > 0)
      .map((p: any) => ({ id: p.id as number, resume: typeof p.resume === "string" ? p.resume : "" }));
  }
  return [];
}

export interface DepsConsentement {
  valider?: (userId: string, id: number, maintenant: Date, o: { fuseau?: string }) => Promise<ResultatValidation>;
}

export async function repondreAuConsentement(
  opts: { userId: string; message: string; historique: ReadonlyArray<Ligne>; maintenant: Date; fuseau: string },
  deps: DepsConsentement = {},
): Promise<ReponseAgent | null> {
  if (!estConsentement(opts.message)) return null;
  const enAttente = propositionsDuDernierTour(opts.historique);
  if (enAttente.length === 0) return null;
  const valider = deps.valider ?? validerProposition;

  const reussis: string[] = [];
  const echecs: string[] = [];
  const faites: ActionFaite[] = [];
  let validees = 0;
  let expirees = 0;
  for (const p of enAttente) {
    const r = await valider(opts.userId, p.id, opts.maintenant, { fuseau: opts.fuseau });
    if (!r.ok) {
      if (r.raison === "expiree") expirees++;
      continue;
    }
    validees++;
    reussis.push(...r.reussis);
    echecs.push(...r.echecs);
    if (r.actionId != null) {
      faites.push({
        actionId: r.actionId,
        resume: p.resume || "Proposition appliquée",
        annulableJusqua: new Date(opts.maintenant.getTime() + FENETRE_ANNULATION_MS).toISOString(),
      });
    }
  }

  const vide = { faites, propositions: [], recherches: [], actions: [] as [] };
  if (validees === 0) {
    if (expirees === 0) return null;
    return {
      ...vide,
      message: "Rien n'a été appliqué : la proposition a expiré (elle reste valable une heure). Redis-moi ce que tu veux faire et je te la repropose.",
    };
  }
  const lignes = [
    reussis.length ? `C'est fait :\n${reussis.map((x) => `- ${x}`).join("\n")}` : "C'est validé.",
    ...(echecs.length ? [`Pas pu le faire :\n${echecs.map((x) => `- ${x}`).join("\n")}`] : []),
  ];
  return { ...vide, message: lignes.join("\n\n") };
}
