// Fil conducteur, propositions d'étapes (spec §2) : pour un objectif sans étapes, ou dont les
// étapes sont toutes franchies, Naya propose une suite de 3 à 6 étapes, chacune avec son
// « pourquoi ». Rien n'est créé avant que Jeanne valide : ce sont des propositions de l'agent
// (agent_propositions), valables 7 jours, validées ou annulées par les routes de l'agent.
// Même principe pour rattacher une chaîne de jalons existante à l'objectif qu'elle sert.
//
// Règle d'une chaîne : les étapes faites d'abord, puis AU PLUS une en cours, puis celles à venir.
// createMilestoneChain rend active la première non faite et verrouille les suivantes : tout autre
// ordre ouvrirait deux étapes dans la même chaîne.
import { z } from "zod";
import { storage } from "../../storage";
import { isAiBlocked } from "../usage";
import { callClaudeWithContext, CLAUDE_MODELS } from "../claude";
import { createMilestoneChain } from "../milestone-engine";
import { depot } from "../agent/depot";
import {
  ETAPE_CLOSE, outilAValider, proposerHorsConversation,
  type BilanExecution, type Empreinte, type OutilPropose,
} from "../agent/propositions";
import { titrePropre } from "../agent/outils/directs";
import type { Changement, PropositionVue } from "@shared/agent";
import type { ProjectGoal, ProjectMilestone } from "@shared/schema";
import { filActifPour } from "./interrupteur";
import { chargerCarte } from "./carte";
import { bornerPourquoi, estPourquoiCreux } from "./rattachement";
import { jsonDe } from "./json-ia";

export const DUREE_PROPOSITION_FIL_MS = 7 * 24 * 3600_000;
export const ETAPES_MIN = 3;
export const ETAPES_MAX = 6;
export const OUTILS_FIL_PROPOSITIONS = ["proposer_etapes", "rattacher_chaine"];

export type EtatEtape = "faite" | "en_cours" | "a_venir";
export interface EtapeProposee { titre: string; pourquoi: string; etat: EtatEtape }

const ETATS: readonly EtatEtape[] = ["faite", "en_cours", "a_venir"];
const RANG: Record<EtatEtape, number> = { faite: 0, en_cours: 1, a_venir: 2 };
const LIBELLE_ETAT: Record<EtatEtape, string> = { faite: "déjà faite", en_cours: "en cours", a_venir: "à venir" };
const STATUTS_JALON: Record<string, string> = {
  locked: "verrouillée", unlocked: "ouverte", active: "en cours", completed: "faite", skipped: "sautée",
};

const erreur = (code: string) => ({ erreur: code });
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** Vrai si les états suivent l'ordre d'une chaîne : faites, puis au plus une en cours, puis à venir. */
export function ordreEtatsValide(etats: EtatEtape[]): boolean {
  let enCours = 0;
  for (let i = 0; i < etats.length; i++) {
    if (etats[i] === "en_cours") enCours++;
    if (i > 0 && RANG[etats[i]] < RANG[etats[i - 1]]) return false;
  }
  return enCours <= 1;
}

/**
 * Remet une liste dans l'ordre d'une chaîne (filet de l'exécution ; l'aperçu, lui, refuse) :
 * une seule en cours (les suivantes passent à venir), puis tri stable faites → en cours → à venir.
 */
export function normaliserEtats<T extends { etat: EtatEtape }>(etapes: T[]): T[] {
  let enCoursVue = false;
  const uneSeule = etapes.map((e) => {
    if (e.etat !== "en_cours") return e;
    if (enCoursVue) return { ...e, etat: "a_venir" as const };
    enCoursVue = true;
    return e;
  });
  return uneSeule.map((e, i) => ({ e, i })).sort((a, b) => RANG[a.e.etat] - RANG[b.e.etat] || a.i - b.i).map((x) => x.e);
}

// L'objectif s'il est à l'utilisatrice (par son projet), avec ses étapes déjà posées.
export async function objectifDe(userId: string, objectifId: unknown): Promise<{ objectif: ProjectGoal; etapes: ProjectMilestone[] } | undefined> {
  if (typeof objectifId !== "number" || !Number.isInteger(objectifId) || objectifId <= 0) return undefined;
  const objectif = await storage.getProjectGoal(objectifId);
  if (!objectif || !(await storage.getProject(objectif.projectId, userId))) return undefined;
  const etapes = (await storage.getMilestones(objectif.projectId, userId)).filter((j) => j.goalId === objectifId);
  return { objectif, etapes };
}

// ── proposer_etapes ────────────────────────────────────────────────────────────────────

type ArgsEtapes = { objectifId: number; etapes: EtapeProposee[] };

// Les étapes proposées, nettoyées (titre borné, pourquoi borné ou vide), ou la raison du refus.
function etapesPropres(brutes: unknown[]): EtapeProposee[] | { erreur: string } {
  if (brutes.length < ETAPES_MIN || brutes.length > ETAPES_MAX) return erreur("nombre_etapes");
  const etapes: EtapeProposee[] = [];
  for (const b of brutes as any[]) {
    const titre = titrePropre(b?.titre);
    if (!titre) return erreur("titre_invalide");
    if (!ETATS.includes(b?.etat)) return erreur("etat_invalide");
    const pourquoi = typeof b?.pourquoi === "string" && b.pourquoi.trim() ? bornerPourquoi(b.pourquoi.trim()) : "";
    etapes.push({ titre, pourquoi, etat: b.etat });
  }
  if (!ordreEtatsValide(etapes.map((e) => e.etat))) return erreur("ordre_etats");
  return etapes;
}

const proposerEtapes = outilAValider<ArgsEtapes>({
  nom: "proposer_etapes",
  dureeMs: DUREE_PROPOSITION_FIL_MS,
  description:
    "Propose la suite d'étapes (3 à 6) d'un objectif qui n'a pas d'étape en cours, chacune avec une phrase " +
    "« pourquoi » et son état réel (faite, en cours, à venir ; dans cet ordre). Rien n'est créé avant que " +
    "l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      objectifId: { type: "integer", description: "Id de l'objectif." },
      etapes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titre: { type: "string", description: "Titre de l'étape." },
            pourquoi: { type: "string", description: "Pourquoi cette étape, en une phrase concrète." },
            etat: { type: "string", enum: [...ETATS], description: "faite, en_cours ou a_venir." },
          },
          required: ["titre", "pourquoi", "etat"],
        },
      },
    },
    required: ["objectifId", "etapes"],
  },
  async apercu(ctx, args) {
    if (!filActifPour(ctx.userId)) return erreur("fil_inactif");
    const etapes = etapesPropres(args.etapes);
    if ("erreur" in etapes) return etapes;
    const o = await objectifDe(ctx.userId, args.objectifId);
    if (!o) return erreur("introuvable");
    if (o.objectif.status !== "active") return erreur("objectif_inactif");
    if (o.etapes.some((j) => !ETAPE_CLOSE.has(j.status))) return erreur("chaine_en_cours");
    const changements: Changement[] = etapes.map((e, i) => ({
      libelle: `Étape ${i + 1} « ${e.titre} »`, avant: null, apres: LIBELLE_ETAT[e.etat],
    }));
    const empreinte: Empreinte = [
      { table: "project_goals", id: o.objectif.id, champs: { status: "active" } },
      { table: "etapes_objectif", id: o.objectif.id, champs: { nombre: o.etapes.length, ouvertes: 0 } },
    ];
    return { resume: `${pluriel(etapes.length, "étape")} pour « ${o.objectif.title} »`, changements, empreinte };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    try {
      const o = await objectifDe(ctx.userId, args.objectifId);
      if (!o) { bilan.echecs.push("Objectif introuvable"); return bilan; }
      const propres = etapesPropres(args.etapes);
      if ("erreur" in propres) { bilan.echecs.push(`Étapes refusées : ${propres.erreur}`); return bilan; }
      const etapes = normaliserEtats(propres);
      // La nouvelle chaîne se range après les étapes déjà franchies de l'objectif.
      const ordreDepart = o.etapes.reduce((m, j) => Math.max(m, (j.order ?? 0) + 1), 0);
      const creees = await createMilestoneChain(
        o.objectif.projectId, ctx.userId,
        etapes.map((e) => ({ title: e.titre, pourquoi: e.pourquoi, etat: e.etat })),
        { goalId: o.objectif.id, ordreDepart },
      );
      for (const j of creees) bilan.reussis.push(`Étape « ${j.title} » créée (${STATUTS_JALON[j.status] ?? j.status})`);
    } catch (e: any) {
      console.error("[fil] création des étapes :", e?.message ?? e);
      bilan.echecs.push("Étapes : création impossible");
    }
    return bilan;
  },
});

// ── rattacher_chaine ───────────────────────────────────────────────────────────────────

type ArgsRattachement = { projetId: number; objectifId: number; jalonIds: number[] };

const rattacherChaine = outilAValider<ArgsRattachement>({
  nom: "rattacher_chaine",
  dureeMs: DUREE_PROPOSITION_FIL_MS,
  description:
    "Propose de rattacher une chaîne de jalons existante d'un projet à l'objectif qu'elle sert. Les jalons " +
    "gardent leur statut. Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      projetId: { type: "integer", description: "Id du projet." },
      objectifId: { type: "integer", description: "Id de l'objectif du même projet." },
      jalonIds: { type: "array", items: { type: "integer" }, description: "Ids des jalons de la chaîne." },
    },
    required: ["projetId", "objectifId", "jalonIds"],
  },
  async apercu(ctx, args) {
    if (!filActifPour(ctx.userId)) return erreur("fil_inactif");
    const ids = Array.from(new Set(args.jalonIds));
    if (!ids.length) return erreur("aucun_jalon");
    const projet = await storage.getProject(args.projetId, ctx.userId);
    if (!projet) return erreur("introuvable");
    const o = await objectifDe(ctx.userId, args.objectifId);
    if (!o || o.objectif.projectId !== projet.id) return erreur("introuvable");
    if (o.objectif.status !== "active") return erreur("objectif_inactif");
    const jalons: ProjectMilestone[] = [];
    for (const id of ids) {
      const j = Number.isInteger(id) && id > 0 ? await storage.getMilestone(id) : undefined;
      if (!j || j.userId !== ctx.userId || j.projectId !== projet.id) return erreur("introuvable");
      if (j.goalId != null) return erreur("deja_rattache");
      jalons.push(j);
    }
    // Deux étapes ouvertes pour un même objectif : jamais (une chaîne en cours à la fois).
    if (o.etapes.some((j) => !ETAPE_CLOSE.has(j.status)) && jalons.some((j) => !ETAPE_CLOSE.has(j.status))) {
      return erreur("chaine_en_cours");
    }
    const changements: Changement[] = jalons.map((j) => ({
      libelle: `Jalon « ${j.title} » (${STATUTS_JALON[j.status] ?? j.status})`,
      avant: "chaîne du projet",
      apres: `objectif « ${o.objectif.title} »`,
    }));
    // L'empreinte porte le goalId (goal_id) et le statut de chaque jalon : rattaché ailleurs ou
    // avancé depuis l'aperçu, la proposition est périmée.
    // L'état des étapes de l'objectif en fait partie : une chaîne posée pour lui depuis l'aperçu
    // (proposer_etapes validée) rendrait deux étapes ouvertes ; la proposition est alors périmée.
    const empreinte: Empreinte = [
      { table: "project_goals", id: o.objectif.id, champs: { status: "active" } },
      {
        table: "etapes_objectif", id: o.objectif.id,
        champs: { nombre: o.etapes.length, ouvertes: o.etapes.filter((j) => !ETAPE_CLOSE.has(j.status)).length },
      },
      ...jalons.map((j) => ({ table: "project_milestones", id: j.id, champs: { goalId: null, status: j.status } })),
    ];
    return {
      resume: `Rattacher ${pluriel(jalons.length, "jalon")} de « ${projet.name} » à « ${o.objectif.title} »`,
      changements, empreinte,
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    for (const id of Array.from(new Set(args.jalonIds))) {
      try {
        const j = await storage.getMilestone(id);
        if (!j || j.userId !== ctx.userId || j.projectId !== args.projetId) { bilan.echecs.push(`Jalon n° ${id} : introuvable`); continue; }
        // Seul le lien change : le statut (et donc la règle `locked`) reste tel quel.
        await storage.updateMilestone(id, { goalId: args.objectifId });
        bilan.reussis.push(`Jalon « ${j.title} » rattaché`);
      } catch (e: any) {
        console.error(`[fil] rattachement du jalon ${id} :`, e?.message ?? e);
        bilan.echecs.push(`Jalon n° ${id} : erreur imprévue`);
      }
    }
    return bilan;
  },
});

export const OUTILS_FIL: OutilPropose[] = [proposerEtapes, rattacherChaine];

// ── Génération par l'IA ────────────────────────────────────────────────────────────────

const SortieEtapes = z.object({
  etapes: z.array(z.object({
    titre: z.string().trim().min(1).max(200),
    pourquoi: z.string().trim().min(1),
    etat: z.enum(["faite", "en_cours", "a_venir"]),
  })).min(ETAPES_MIN).max(ETAPES_MAX),
});

const jour = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "?");

// Ce qui est déjà en cours, pour que les étapes suivent l'état réel (spec §2).
async function etatReel(userId: string, objectif: ProjectGoal, etapesFaites: ProjectMilestone[], maintenant: Date): Promise<string> {
  const projetId = objectif.projectId;
  const [campagnes, prospection, posts, mesures] = await Promise.all([
    storage.getCampaigns(userId, projetId).catch(() => []),
    storage.getProspectionCampaigns(userId).catch(() => []),
    storage.getPostsEntre(userId, new Date(maintenant.getTime() - 30 * 24 * 3600_000), maintenant).catch(() => []),
    storage.getMesures(userId, projetId, 1).catch(() => []),
  ]);
  const lignes: string[] = [];
  const enCours = (campagnes as any[]).filter((c) => c.status === "active" || c.status === "running");
  lignes.push(`Campagnes en cours : ${enCours.length ? enCours.map((c) => `« ${c.name} »`).join(", ") : "aucune"}.`);
  const pros = (prospection as any[]).filter((c) => c.projectId == null || c.projectId === projetId);
  lignes.push(`Campagnes de prospection : ${pros.length ? pros.map((c) => `« ${c.name} » (${c.status})`).join(", ") : "aucune"}.`);
  const publies = (posts as any[]).filter((p) => p.status === "published" || p.publishedAt);
  const parPlateforme = new Map<string, number>();
  for (const p of publies) parPlateforme.set(p.platform, (parPlateforme.get(p.platform) ?? 0) + 1);
  lignes.push(`Posts publiés sur 30 jours : ${publies.length}${parPlateforme.size ? ` (${Array.from(parPlateforme, ([k, n]) => `${k} ${n}`).join(", ")})` : ""}.`);
  const m = (mesures as any[])[0];
  lignes.push(m
    ? `Dernière mesure (${m.mois}) : CA ${m.ca ?? "?"}, nouveaux clients ${m.nouveauxClients ?? "?"}, commandes ${m.commandes ?? "?"}.`
    : "Dernière mesure : aucune saisie.");
  if (etapesFaites.length) lignes.push(`Étapes déjà franchies pour cet objectif : ${etapesFaites.map((e) => `« ${e.title} »`).join(", ")}.`);
  return lignes.join("\n");
}

/**
 * Demande à l'IA 3 à 6 étapes pour l'objectif, avec leur état réel (posts publiés comptés sur les
 * 30 jours avant `maintenant`). Rend null, sans appel IA, si l'IA est bloquée (plafond), si
 * l'objectif n'est pas à l'utilisatrice, n'est pas actif ou a déjà une étape ouverte ; null aussi si deux réponses de suite
 * sont invalides (JSON, nombre, ordre des états, « pourquoi » creux).
 */
export async function genererEtapes(
  userId: string,
  objectifId: number,
  note?: string,
  maintenant: Date = new Date(),
): Promise<EtapeProposee[] | null> {
  if (await isAiBlocked(userId)) return null;
  const o = await objectifDe(userId, objectifId);
  // Aucun appel IA pour une proposition que l'aperçu refuserait : objectif non actif, ou qui a
  // déjà une étape ouverte.
  if (!o || o.objectif.status !== "active" || o.etapes.some((j) => !ETAPE_CLOSE.has(j.status))) return null;
  const { objectif } = o;
  const contexte = await etatReel(userId, objectif, o.etapes, maintenant);

  const consigne = [
    `Objectif : « ${objectif.title} »${objectif.description ? ` (${objectif.description})` : ""}.`,
    `Type : ${objectif.goalType}, mode de réussite : ${objectif.successMode}.`,
    objectif.targetValue ? `Cible : ${objectif.targetValue}.` : "",
    objectif.dueDate ? `Échéance : ${jour(objectif.dueDate)}.` : "",
    "",
    "Ce qui est déjà en cours :",
    contexte,
    note?.trim() ? `\nCe que l'utilisatrice demande pour cette proposition : ${note.trim().slice(0, 1000)}` : "",
    "",
    `Propose la suite de ${ETAPES_MIN} à ${ETAPES_MAX} grosses étapes qui mènent à cet objectif, propres à cette marque et à ce qu'elle fait déjà. Pas de modèle générique.`,
    "Pour chaque étape : un titre court, et un « pourquoi » d'une phrase qui dit concrètement ce que l'étape apporte à l'objectif (pas « pour avancer ton objectif »).",
    "État réel de chaque étape : « faite » si c'est déjà accompli, « en_cours » si c'est déjà lancé (une campagne active, par exemple), sinon « a_venir ». Ordre : les faites d'abord, puis une seule en cours au plus, puis les à venir.",
    'Réponds UNIQUEMENT en JSON : {"etapes":[{"titre":"…","pourquoi":"…","etat":"a_venir"}]}',
  ].filter((l) => l !== "").join("\n");

  let remarque = "";
  for (let essai = 0; essai < 2; essai++) {
    const texte = await callClaudeWithContext({
      userId, projectId: objectif.projectId, model: CLAUDE_MODELS.smart, max_tokens: 1500, temperature: 0.4,
      userMessage: consigne + remarque,
    });
    const v = SortieEtapes.safeParse(jsonDe(texte));
    if (!v.success) { remarque = "\n\nTa réponse précédente n'était pas un JSON valide de 3 à 6 étapes. Recommence."; continue; }
    const etapes = v.data.etapes.map((e) => ({ titre: e.titre, pourquoi: bornerPourquoi(e.pourquoi), etat: e.etat }));
    if (!ordreEtatsValide(etapes.map((e) => e.etat))) { remarque = "\n\nOrdre des états invalide : faites, puis une en cours au plus, puis à venir. Recommence."; continue; }
    if (etapes.some((e) => estPourquoiCreux(e.pourquoi))) { remarque = "\n\nCertains « pourquoi » étaient creux. Chaque pourquoi doit dire concrètement ce que l'étape apporte. Recommence."; continue; }
    return etapes;
  }
  return null;
}

/**
 * Génère puis enregistre une proposition `proposer_etapes`. Ne fait rien (aucun appel IA) s'il
 * y en a déjà une en attente pour cet objectif. Rien n'est créé avant validation.
 */
export async function proposerEtapesPour(
  userId: string,
  objectifId: number,
  maintenant: Date,
  note?: string,
  opts: { ignorer?: number } = {},
): Promise<PropositionVue | { erreur: string }> {
  // `ignorer` : la proposition que celle-ci va remplacer (« Refaire ») ; la route ne l'annule
  // qu'après la création de la nouvelle, pour qu'un échec la laisse intacte.
  const enAttente = await depot.propositionsEnAttente(userId, ["proposer_etapes"], maintenant);
  if (enAttente.some((p) => p.id !== opts.ignorer && Number((p.arguments as any)?.objectifId) === objectifId)) return erreur("deja_en_attente");
  const etapes = await genererEtapes(userId, objectifId, note, maintenant);
  if (!etapes) return erreur("generation_impossible");
  return proposerHorsConversation(userId, "proposer_etapes", { objectifId, etapes }, maintenant);
}

// ── Rattachement des chaînes existantes ────────────────────────────────────────────────

const SortieChoix = z.object({ objectif: z.number().int().nullable() });

// Plusieurs objectifs actifs : un appel rapide choisit celui que la chaîne sert, ou s'abstient.
async function choisirObjectif(
  userId: string,
  projetId: number,
  chaine: { titre: string }[],
  objectifs: { id: number; titre: string }[],
): Promise<number | null> {
  const consigne = [
    "Une chaîne d'étapes existe dans ce projet sans être reliée à un objectif :",
    ...chaine.map((e, i) => `${i + 1}. ${e.titre}`),
    "",
    "Objectifs actifs du projet :",
    ...objectifs.map((o, i) => `[${i}] ${o.titre}`),
    "",
    "Quel objectif cette chaîne sert-elle ? Si aucun ne correspond clairement, abstiens-toi.",
    'Réponds UNIQUEMENT en JSON : {"objectif": <numéro entre crochets>} ou {"objectif": null}',
  ].join("\n");
  const texte = await callClaudeWithContext({
    userId, projectId: projetId, model: CLAUDE_MODELS.fast, max_tokens: 100, temperature: 0, userMessage: consigne,
  });
  const v = SortieChoix.safeParse(jsonDe(texte));
  if (!v.success || v.data.objectif == null) return null;
  return objectifs[v.data.objectif]?.id ?? null;
}

/**
 * Une proposition `rattacher_chaine` par projet qui a une chaîne sans objectif et au moins un
 * objectif actif. Un seul objectif : choisi sans IA. Plusieurs : un appel rapide choisit, ou
 * s'abstient. Un projet qui a déjà une proposition en attente est laissé tel quel.
 */
export async function proposerRattachements(userId: string, maintenant: Date): Promise<PropositionVue[]> {
  const carte = await chargerCarte(userId, null);
  const enAttente = await depot.propositionsEnAttente(userId, ["rattacher_chaine"], maintenant);
  const projetsEnAttente = new Set(enAttente.map((p) => Number((p.arguments as any)?.projetId)));
  const faites: PropositionVue[] = [];
  for (const [projetId, chaine] of Array.from(carte.chainesSansObjectif)) {
    if (projetsEnAttente.has(projetId)) continue;
    const objectifs = carte.objectifs.filter((o) => o.projetId === projetId);
    if (objectifs.length === 0) continue;
    try {
      let objectifId: number | null = objectifs.length === 1 ? objectifs[0].id : null;
      if (objectifs.length > 1) {
        if (await isAiBlocked(userId)) continue;
        objectifId = await choisirObjectif(userId, projetId, chaine, objectifs);
      }
      if (objectifId == null) continue;
      const r = await proposerHorsConversation(userId, "rattacher_chaine", { projetId, objectifId, jalonIds: chaine.map((e) => e.id) }, maintenant);
      if ("erreur" in r) console.log(`[fil] rattachement non proposé (projet ${projetId}) : ${r.erreur}`);
      else faites.push(r);
    } catch (e: any) {
      console.error(`[fil] rattachement du projet ${projetId} :`, e?.message ?? e);
    }
  }
  return faites;
}
