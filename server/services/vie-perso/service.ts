// Vie perso : préparer, ajuster et valider la semaine de repas ; découper et planifier une
// activité (spec 2026-11-23). Dépendances injectées (base, IA, agenda) : testable sans rien.
import type { z } from "zod/v4";
import {
  joursDeSemaine, planDepuisGenere, repasDepuisGenere, SCHEMA_ACTIVITE, SCHEMA_PLAN_GENERE, SCHEMA_PLAN_REPAS, REPAS,
  type ContenuActivite, type Fenetre, type PlanRepas, type ProfilViePerso, type Repas,
} from "@shared/vie-perso";
import {
  nettoyerProfond, promptActivite, promptChangerRepas, promptPlan,
  SCHEMA_CHANGEMENT, SYSTEME_ACTIVITE, SYSTEME_CHANGER_REPAS, SYSTEME_REPAS,
  type MembrePrompt, type RecettePrompt,
} from "./consignes";
import { placerActivite, placerDemandes, tachesDuPlan, type Depuis, type Occupes, type TachePlacee } from "./placement";

export const MAX_TOKENS_PLAN = 12_000;
export const MAX_TOKENS_CHANGEMENT = 4_000;
export const MAX_TOKENS_ACTIVITE = 2_000;

/** Ce que porte une tâche perso dans actionData, pour la retrouver (et la remplacer). */
export type OrigineTache = { plan: string } | { activite: number };

export interface PlanLu { statut: "brouillon" | "valide"; contenu: PlanRepas; coches: number[] }
export interface ActiviteLue {
  id: number; titre: string; description: string; avecQui: string; quand: Fenetre;
  dateCible: string | null; statut: string; contenu: ContenuActivite | null;
}

export interface DepsViePerso {
  profil(userId: string): Promise<ProfilViePerso>;
  membres(userId: string): Promise<MembrePrompt[]>;
  recettes(userId: string): Promise<RecettePrompt[]>;
  lirePlan(userId: string, semaine: string): Promise<PlanLu | null>;
  /** Écrit (ou remplace) le plan de la semaine ; `statut` brouillon remet les coches à zéro. */
  ecrirePlan(userId: string, semaine: string, contenu: PlanRepas, o: { statut: "brouillon" | "valide"; coutEur?: number; garderCoches?: boolean }): Promise<void>;
  lireActivite(userId: string, id: number): Promise<ActiviteLue | null>;
  ecrireActivite(userId: string, id: number, modif: { contenu?: ContenuActivite; statut?: string }): Promise<void>;
  /** Clés (`actionData.vieperso.cle`) des tâches perso DÉJÀ FAITES de cette origine. */
  clesFaites(userId: string, origine: OrigineTache): Promise<Set<string>>;
  /** Supprime les tâches perso NON FAITES de cette origine ; renvoie leur nombre. */
  supprimerTachesNonFaites(userId: string, origine: OrigineTache): Promise<number>;
  /** Plages occupées (toutes tâches horodatées non archivées + agenda) de `de` à `a` inclus. */
  occupes(userId: string, de: string, a: string): Promise<Occupes>;
  creerTaches(userId: string, origine: OrigineTache, taches: TachePlacee[]): Promise<number>;
  generer<T>(o: { schema: z.ZodType<T>; system: string; prompt: string; maxTokens: number; rapide: boolean; userId: string; etape: string }): Promise<{ valeur: T; coutEur: number }>;
  maintenant(): Depuis;
}

export type Resultat<T = {}> = ({ ok: true } & T) | { ok: false; erreur: string };

/** Les dates du plan sont celles de la semaine demandée, quoi qu'ait écrit le modèle. */
function recaler(plan: PlanRepas, semaine: string): PlanRepas {
  const jours = joursDeSemaine(semaine);
  return { ...plan, jours: plan.jours.map((j, i) => ({ ...j, date: jours[i] })) };
}

export async function preparerPlan(userId: string, semaine: string, deps: DepsViePerso): Promise<Resultat<{ coutEur: number }>> {
  const [profil, membres, recettes] = await Promise.all([deps.profil(userId), deps.membres(userId), deps.recettes(userId)]);
  const { valeur, coutEur } = await deps.generer({
    schema: SCHEMA_PLAN_GENERE, system: SYSTEME_REPAS, prompt: promptPlan({ profil, membres, recettes, semaine }),
    maxTokens: MAX_TOKENS_PLAN, rapide: false, userId, etape: "vie_perso_plan",
  });
  await deps.ecrirePlan(userId, semaine, recaler(planDepuisGenere(nettoyerProfond(valeur)), semaine), { statut: "brouillon", coutEur });
  return { ok: true, coutEur };
}

export async function changerRepas(
  userId: string, semaine: string, jour: string, repas: Repas, demande: string | null, deps: DepsViePerso,
): Promise<Resultat> {
  if (!(REPAS as readonly string[]).includes(repas)) return { ok: false, erreur: "repas_invalide" };
  const plan = await deps.lirePlan(userId, semaine);
  if (!plan) return { ok: false, erreur: "plan_introuvable" };
  const i = plan.contenu.jours.findIndex((j) => j.date === jour);
  if (i < 0) return { ok: false, erreur: "jour_invalide" };
  const [profil, membres] = await Promise.all([deps.profil(userId), deps.membres(userId)]);
  const { valeur } = await deps.generer({
    schema: SCHEMA_CHANGEMENT, system: SYSTEME_CHANGER_REPAS,
    prompt: promptChangerRepas({ plan: plan.contenu, jour, repas, demande, profil, membres }),
    maxTokens: MAX_TOKENS_CHANGEMENT, rapide: true, userId, etape: "vie_perso_repas",
  });
  const v = nettoyerProfond(valeur);
  if (!v.repas.titre.trim()) return { ok: false, erreur: "generation_invalide" };
  const jours = plan.contenu.jours.map((j, k) => (k === i ? { ...j, [repas]: repasDepuisGenere(v.repas) } : j));
  // Re-valider le contenu entier : les courses rendues passent par les mêmes bornes que le plan.
  const contenu = SCHEMA_PLAN_REPAS.parse({ ...plan.contenu, jours, courses: v.courses });
  // La liste de courses change : les coches repartent de zéro. Un plan validé reste validé, mais
  // ses tâches ne sont pas refaites ici (« Valider » à nouveau les remplace).
  await deps.ecrirePlan(userId, semaine, contenu, { statut: plan.statut });
  return { ok: true };
}

export async function validerPlan(userId: string, semaine: string, deps: DepsViePerso): Promise<Resultat<{ taches: number }>> {
  const plan = await deps.lirePlan(userId, semaine);
  if (!plan) return { ok: false, erreur: "plan_introuvable" };
  const profil = await deps.profil(userId);
  const origine: OrigineTache = { plan: semaine };
  // Ce qui est déjà fait (courses cochées vendredi, par exemple) n'est pas recréé.
  const faites = await deps.clesFaites(userId, origine);
  const demandes = tachesDuPlan(plan.contenu, profil, semaine).filter((d) => !faites.has(d.cle));
  // Les tâches non faites de ce plan sont remplacées ; les faites restent (et occupent leur créneau).
  await deps.supprimerTachesNonFaites(userId, origine);
  const jours = demandes.map((d) => d.jour).sort();
  const occupes = jours.length ? await deps.occupes(userId, jours[0], jours[jours.length - 1]) : new Map();
  const placees = placerDemandes(demandes, occupes, profil, deps.maintenant());
  const n = await deps.creerTaches(userId, origine, placees);
  await deps.ecrirePlan(userId, semaine, plan.contenu, { statut: "valide", garderCoches: true });
  return { ok: true, taches: n };
}

export async function decouperActivite(userId: string, id: number, deps: DepsViePerso): Promise<Resultat> {
  const a = await deps.lireActivite(userId, id);
  if (!a) return { ok: false, erreur: "activite_introuvable" };
  const profil = await deps.profil(userId);
  const { valeur } = await deps.generer({
    schema: SCHEMA_ACTIVITE, system: SYSTEME_ACTIVITE,
    prompt: promptActivite({ titre: a.titre, description: a.description, avecQui: a.avecQui, quand: a.quand, dateCible: a.dateCible, equipement: profil.equipement }),
    maxTokens: MAX_TOKENS_ACTIVITE, rapide: true, userId, etape: "vie_perso_activite",
  });
  await deps.ecrireActivite(userId, id, { contenu: nettoyerProfond(valeur), statut: "a_planifier" });
  return { ok: true };
}

const HORIZON_ACTIVITE_JOURS = 60;

export async function planifierActivite(userId: string, id: number, deps: DepsViePerso): Promise<Resultat<{ taches: number; nonPlacees: string[] }>> {
  const a = await deps.lireActivite(userId, id);
  if (!a) return { ok: false, erreur: "activite_introuvable" };
  if (!a.contenu) return { ok: false, erreur: "activite_non_decoupee" };
  const profil = await deps.profil(userId);
  const origine: OrigineTache = { activite: id };
  const depuis = deps.maintenant();
  if (a.dateCible && a.dateCible <= depuis.jour) return { ok: false, erreur: "date_passee" };
  await deps.supprimerTachesNonFaites(userId, origine);
  const fin = a.dateCible ?? new Date(Date.parse(`${depuis.jour}T12:00:00Z`) + HORIZON_ACTIVITE_JOURS * 86_400_000).toISOString().slice(0, 10);
  const occupes = await deps.occupes(userId, depuis.jour, fin);
  const r = placerActivite({ titre: a.titre, contenu: a.contenu, quand: a.quand, dateCible: a.dateCible }, occupes, profil, depuis);
  const n = await deps.creerTaches(userId, origine, r.taches);
  await deps.ecrireActivite(userId, id, { statut: "planifiee" });
  return { ok: true, taches: n, nonPlacees: r.nonPlacees };
}
