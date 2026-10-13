/**
 * Bilan mensuel (routine `mesure_bilan`, le 2 de chaque mois) et section « Mesure » du
 * contexte de Naya. Le résumé notifié est CALCULÉ, jamais tiré de l'IA ; l'IA écrit le
 * bilan à partir des seuls chiffres du registre.
 */
import type { Routine, Fondations } from "@shared/schema";
import type { ResultatPassage } from "../routines/types";
import { prochainPassageApres } from "../routines/temps";
import { KIND_BILAN, HEURE_BILAN_UTC } from "./catalogues";
import { indicateurs, evolutions, libelleMois, moisPrecedent, type LigneMesure } from "./calculs";

export type LigneRegistre = LigneMesure & { bilan?: string | null; bilanLe?: Date | string | null; updatedAt?: Date | string | null };

const espaces = (s: string) => s.replace(/[  ]/g, " ");
export const euros = (n: number) => `${espaces(Math.round(n).toLocaleString("fr-FR"))} €`;
const ratio = (n: number) => espaces(n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const pourcent = (x: number | null) => (x === null ? "" : ` (${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)} %)`);

export type Langue = "fr" | "en";
const lienMesure = (projectId: number) => `/projects/${projectId}?onglet=mesure`;
const eurosEn = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;
const ratioEn = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pourcentEn = (x: number | null) => (x === null ? "" : ` (${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%)`);
const moisEn = (mois: string) => libelleMois(mois, "en-US");

/** Les phrases des passages du bilan, dans la langue du compte. */
const TEXTES = {
  fr: {
    projetDisparu: "Ce projet n'existe plus : bilan arrêté.",
    rappel: (m: string) => `Saisis tes chiffres de ${libelleMois(m)} dans Mesure : Naya fera ton bilan du mois.`,
    dejaFait: (m: string) => `Bilan de ${libelleMois(m)} déjà fait, chiffres inchangés.`,
    vide: "Réponse de l'IA vide : bilan non écrit.",
    manqueEncore: (m: string) => ` Il manque encore tes chiffres de ${libelleMois(m)}.`,
  },
  en: {
    projetDisparu: "This project no longer exists: review stopped.",
    rappel: (m: string) => `Enter your ${moisEn(m)} figures in Measure: Naya will write your monthly review.`,
    dejaFait: (m: string) => `${moisEn(m)} review already done, figures unchanged.`,
    vide: "Empty AI answer: review not written.",
    manqueEncore: (m: string) => ` Your ${moisEn(m)} figures are still missing.`,
  },
};

const serie = (lignes: LigneMesure[], cle: "mer" | "cac") => lignes.map((l) => ({ mois: l.mois, valeur: indicateurs(l)[cle] }));

/** « Bilan de septembre 2026 prêt : MER 5,0 (+25 %), CAC 75 € (+17 %). » (ou en anglais). */
export function resumeBilan(mois: string, lignes: LigneMesure[], langue: Langue = "fr"): string {
  const en = langue === "en";
  const [eur, rat, pct] = en ? [eurosEn, ratioEn, pourcentEn] : [euros, ratio, pourcent];
  const l = lignes.find((x) => x.mois === mois);
  const ind = l ? indicateurs(l) : null;
  const morceaux: string[] = [];
  if (ind?.mer != null) morceaux.push(`MER ${rat(ind.mer)}${pct(evolutions(serie(lignes, "mer"), mois).precedent)}`);
  if (ind?.cac != null) morceaux.push(`CAC ${eur(ind.cac)}${pct(evolutions(serie(lignes, "cac"), mois).precedent)}`);
  if (!morceaux.length && ind) {
    if (ind.ca != null) morceaux.push(`${en ? "Revenue" : "CA"} ${eur(ind.ca)}`);
    if (ind.nouveaux_clients != null) morceaux.push(`${ind.nouveaux_clients} ${en ? "new customers" : "nouveaux clients"}`);
  }
  if (en) return `${moisEn(mois)} review ready${morceaux.length ? `: ${morceaux.join(", ")}` : ""}.`;
  return `Bilan de ${libelleMois(mois)} prêt${morceaux.length ? ` : ${morceaux.join(", ")}` : ""}.`;
}

function ligneIndicateurs(l: LigneMesure): string {
  const i = indicateurs(l);
  const parts = [
    i.ca != null && `CA ${euros(i.ca)}`,
    i.nouveaux_clients != null && `nouveaux clients ${i.nouveaux_clients}`,
    i.depense_totale != null && `dépense marketing ${euros(i.depense_totale)}`,
    i.mer != null && `MER ${ratio(i.mer)}`,
    i.cac != null && `CAC ${euros(i.cac)}`,
    i.panier_moyen != null && `panier moyen ${euros(i.panier_moyen)}`,
    i.part_ca_nouveaux != null && `part du CA nouveaux clients ${Math.round(i.part_ca_nouveaux * 100)} %`,
    i.marge_contributive != null && `marge contributive ${euros(i.marge_contributive)}`,
  ].filter(Boolean);
  return parts.join(", ");
}

/** Section « Mesure » du contexte (jamais en mode tiers). `lignes` : les plus récentes d'abord. */
export function blocMesure(lignes: LigneRegistre[]): string {
  if (!lignes.length) return "";
  const recentes = lignes.slice(0, 3).map((l) => `- ${libelleMois(l.mois)} : ${ligneIndicateurs(l) || "chiffres incomplets"}`);
  const avecBilan = lignes.find((l) => l.bilan);
  return `## Mesure (registre mensuel saisi par l'utilisatrice)\n${recentes.join("\n")}` +
    (avecBilan ? `\n\nDernier bilan (${libelleMois(avecBilan.mois)}) :\n${String(avecBilan.bilan).slice(0, 1200)}` : "") +
    `\n\nAppuie tes recommandations sur ces chiffres quand c'est pertinent ; ne les extrapole pas.`;
}

// ─── La routine ──────────────────────────────────────────────────────────────
export interface DepsBilan {
  storage: {
    getProject(id: number, userId: string): Promise<any>;
    getMesures(userId: string, projectId: number, limite?: number): Promise<LigneRegistre[]>;
    /** N'écrit que si la ligne n'a pas été modifiée depuis `lu` (sinon le bilan commenterait d'anciens chiffres). */
    setBilanMesure(userId: string, projectId: number, mois: string, bilan: string, lu: Date | string | null | undefined): Promise<void>;
    getFondations(userId: string, projectId: number): Promise<Fondations | undefined>;
  };
  garde(userId: string): Promise<ResultatPassage | null>;
  ia(userId: string, projectId: number, prompt: string): Promise<string>;
  maintenant(): Date;
  /** Langue du compte pour les phrases du passage (français par défaut). */
  langue?(userId: string): Promise<Langue>;
}

export function routineBilanPour(p: { userId: string; projectId: number }, maintenant: Date, actif = true) {
  return {
    userId: p.userId, projectId: p.projectId, kind: KIND_BILAN,
    cible: { projectId: p.projectId }, cibleCle: `project:${p.projectId}`,
    cadence: "mensuelle", heureUtc: HEURE_BILAN_UTC, actif,
    prochainPassage: prochainPassageApres("mensuelle", HEURE_BILAN_UTC, maintenant),
  };
}

const temps = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);

function consigne(mois: string, lignes: LigneRegistre[], cibles: string): string {
  const tableau = lignes.filter((l) => l.mois <= mois).slice(0, 6).reverse().map((l) => `- ${l.mois} : ${ligneIndicateurs(l) || "chiffres incomplets"}`).join("\n");
  return `Écris le bilan d'acquisition de ${libelleMois(mois)} pour ce projet, à partir de ces chiffres réels saisis par l'utilisatrice (du plus ancien au plus récent) :
${tableau}
${cibles ? `\nCibles qu'elle s'est fixées :\n${cibles}\n` : ""}
Rappels : MER = CA total ÷ dépense marketing totale ; CAC = dépense d'acquisition ÷ nouveaux clients. Ce sont les chiffres de pilotage, pas les ROAS déclarés par les plateformes.

En texte simple, 1 200 caractères au plus, trois courts paragraphes :
1. Ce qui a bougé ce mois-ci (avec les chiffres).
2. La cause la plus probable, d'après ce que tu sais du projet ; dis-le si tu ne peux pas trancher.
3. Une décision concrète pour le mois qui vient, justifiée par un chiffre.
N'invente aucun chiffre. Si les données sont trop incomplètes pour conclure, dis ce qui manque.`;
}

export async function executerBilan(routine: Routine, deps: DepsBilan): Promise<ResultatPassage> {
  const projectId = Number((routine.cible as any)?.projectId);
  const projet = Number.isInteger(projectId) ? await deps.storage.getProject(projectId, routine.userId) : null;
  const langue: Langue = (await deps.langue?.(routine.userId)) ?? "fr";
  const T = TEXTES[langue];
  if (!projet) return { statut: "rien_a_faire", resume: T.projetDisparu, desactiver: true };

  const now = deps.maintenant();
  const courant = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const precedent = moisPrecedent(courant);
  const lignes = await deps.storage.getMesures(routine.userId, projectId, 13);
  const manque = !lignes.some((l) => l.mois === precedent);
  // Le mois clos le plus récent (3 derniers) dont le bilan manque ou est périmé : des chiffres
  // saisis après le 2, ou un passage raté, ont quand même leur bilan.
  const aFaire = lignes
    .filter((l) => l.mois <= precedent && l.mois >= moisPrecedent(courant, 3))
    // Périmé si ses chiffres OU ceux du mois auquel il se compare ont changé depuis.
    .find((l) => {
      const compare = lignes.find((x) => x.mois === moisPrecedent(l.mois));
      return !(l.bilan && temps(l.bilanLe) >= Math.max(temps(l.updatedAt), temps(compare?.updatedAt)));
    });
  if (!aFaire) {
    if (manque) return { statut: "rien_a_faire", notifier: true, resume: T.rappel(precedent), lien: lienMesure(projectId) };
    return { statut: "rien_a_faire", resume: T.dejaFait(precedent) };
  }
  const vise = aFaire.mois;

  const refus = await deps.garde(routine.userId);
  if (refus) return refus;

  const f = await deps.storage.getFondations(routine.userId, projectId);
  const kpis = (f?.statuts as any)?.kpis === "valide" && Array.isArray(f?.kpis) ? (f!.kpis as Array<{ nom: string; cible?: string }>) : [];
  const cibles = kpis.filter((k) => k.cible).map((k) => `- ${k.nom} : ${k.cible}`).join("\n");

  const texte = (await deps.ia(routine.userId, projectId, consigne(vise, lignes, cibles))).trim();
  if (!texte) return { statut: "erreur", resume: T.vide };
  await deps.storage.setBilanMesure(routine.userId, projectId, vise, texte.slice(0, 3000), aFaire.updatedAt);
  const rappel = manque && vise !== precedent ? T.manqueEncore(precedent) : "";
  return { statut: "ok", notifier: true, resume: resumeBilan(vise, lignes, langue) + rappel, details: { mois: vise }, lien: lienMesure(projectId) };
}
