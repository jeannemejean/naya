// Outils de lecture de l'agent (« tout savoir ») : chercher dans tout ce que l'utilisatrice a
// écrit ou reçu, puis lire un élément en entier. Toujours bornés à ctx.userId (la session),
// jamais à un identifiant fourni par le modèle.
import { chercher, lire, SOURCES, type FiltresRecherche, type SourceRecherche } from "../recherche";
import { storage } from "../../../storage";
import type { ContexteOutil, Outil } from "../registre";

const LECTURE_MAX = 20000; // caractères rendus par `lire` (une réponse de tâche, un livrable…)

// Libellé lisible d'une recherche, montré sous la réponse (« où l'agent a cherché »).
export function libelleRecherche(requete: string, filtres: FiltresRecherche): string {
  const morceaux = [`« ${requete} »`];
  if (filtres.projetId !== undefined) morceaux.push(`projet n°${filtres.projetId}`);
  if (filtres.depuis && filtres.jusqua) morceaux.push(`du ${filtres.depuis} au ${filtres.jusqua}`);
  else if (filtres.depuis) morceaux.push(`depuis le ${filtres.depuis}`);
  else if (filtres.jusqua) morceaux.push(`jusqu'au ${filtres.jusqua}`);
  if (filtres.sources?.length) morceaux.push(`dans : ${filtres.sources.join(", ")}`);
  return morceaux.join(" · ");
}

const chercherOutil: Outil = {
  nom: "chercher",
  classe: "lecture",
  description:
    "Cherche, par sens et par mots, dans tout ce que l'utilisatrice a écrit ou reçu : réponses dans " +
    "les tâches, livrables, notes et captures, mémoire, conversations avec toi, contenus, tâches, " +
    "réponses de prospects. Filtres facultatifs : projet, période, types de source. Chaque résultat " +
    "donne la source, l'id (pour `lire`), la date, le titre, le projet et un extrait. " +
    "Appelle-le avant de dire que tu ne trouves pas quelque chose.",
  schema: {
    type: "object",
    properties: {
      requete: { type: "string", description: "Ce qu'on cherche, en mots simples (noms propres, sujet, terme exact)." },
      projetId: { type: "integer", description: "Id d'un projet pour limiter la recherche à ce projet." },
      depuis: { type: "string", description: "Date de début incluse, AAAA-MM-JJ." },
      jusqua: { type: "string", description: "Date de fin incluse, AAAA-MM-JJ." },
      sources: {
        type: "array",
        items: { type: "string", enum: SOURCES },
        description: "Types de source à fouiller (tous par défaut).",
      },
    },
    required: ["requete"],
  },
  async executer(ctx, args) {
    const filtres: FiltresRecherche = {};
    if (args.projetId !== undefined && args.projetId !== null) filtres.projetId = args.projetId;
    if (args.depuis) filtres.depuis = args.depuis;
    if (args.jusqua) filtres.jusqua = args.jusqua;
    if (Array.isArray(args.sources) && args.sources.length > 0) filtres.sources = args.sources as SourceRecherche[];
    const requete = String(args.requete).trim();

    const trouvailles = await chercher(ctx.userId, requete, filtres);
    return {
      pourModele: {
        trouvailles: trouvailles.map((t) => ({
          source: t.source, id: t.id, date: t.date.slice(0, 10), titre: t.titre, projet: t.projet, extrait: t.extrait,
        })),
        ...(trouvailles.length === 0 ? { note: "Aucun résultat. Essaie d'autres mots, ou élargis la période." } : {}),
      },
      recherche: libelleRecherche(requete, filtres),
    };
  },
};

const lireOutil: Outil = {
  nom: "lire",
  classe: "lecture",
  description:
    "Lit en entier un élément trouvé par `chercher` (réponse de tâche, livrable, note, conversation…), " +
    "à partir de sa source et de son id.",
  schema: {
    type: "object",
    properties: {
      source: { type: "string", enum: SOURCES, description: "La source donnée par `chercher`." },
      id: { type: "integer", description: "L'id donné par `chercher`." },
    },
    required: ["source", "id"],
  },
  async executer(ctx, args) {
    const lecture = await lire(ctx.userId, args.source as SourceRecherche, args.id);
    if (!lecture) return { pourModele: { erreur: "introuvable" } };
    const tronque = lecture.contenu.length > LECTURE_MAX;
    return {
      pourModele: {
        ...lecture,
        contenu: tronque ? lecture.contenu.slice(0, LECTURE_MAX) : lecture.contenu,
        ...(tronque ? { note: `Contenu coupé à ${LECTURE_MAX} caractères sur ${lecture.contenu.length}.` } : {}),
      },
    };
  },
};



// ── Consultation par domaine ───────────────────────────────────────────────────────────
// Outils en lecture seule, un par domaine. Sorties compactes (le contexte du modèle est
// précieux) : seuls les champs utiles, des plafonds explicites, et `tronque: true` quand on
// coupe. Tout id fourni par le modèle (projet, campagne) est vérifié contre ctx.userId.

const PLANNING_JOURS_MAX = 31;
const PLANNING_TACHES_MAX = 200;
const PROSPECTS_MAX = 50;
const CONTENUS_MAX = 100;
const INTROUVABLE = { pourModele: { erreur: "introuvable" } };

// AAAA-MM-JJ réel (le 31 février est refusé).
function dateValide(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function ajouterJours(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function ecartJours(du: string, au: string): number {
  return Math.round((Date.parse(`${au}T00:00:00Z`) - Date.parse(`${du}T00:00:00Z`)) / 86400000);
}

// « Aujourd'hui » dans le fuseau de l'utilisatrice, pas celui du serveur.
function aujourdhui(ctx: ContexteOutil): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ctx.fuseau, year: "numeric", month: "2-digit", day: "2-digit" }).format(ctx.maintenant);
  } catch {
    return ctx.maintenant.toISOString().slice(0, 10);
  }
}

const jour = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString().slice(0, 10) : null);

// Le projet existe ET appartient à la session ? (getProject filtre sur userId.)
async function projetAMoi(ctx: ContexteOutil, projetId: unknown) {
  if (typeof projetId !== "number") return undefined;
  return storage.getProject(projetId, ctx.userId);
}

const consulterPlanning: Outil = {
  nom: "consulter_planning",
  classe: "lecture",
  description:
    "Lit le planning sur une période (31 jours au plus, 200 tâches au plus) : id, titre, date, heure, " +
    "durée, faite ou non, projet. Filtres facultatifs : projet, état (faites / a_faire / toutes).",
  schema: {
    type: "object",
    properties: {
      du: { type: "string", description: "Premier jour, AAAA-MM-JJ." },
      au: { type: "string", description: "Dernier jour inclus, AAAA-MM-JJ." },
      projetId: { type: "integer", description: "Limiter à ce projet." },
      etat: { type: "string", enum: ["faites", "a_faire", "toutes"], description: "Toutes par défaut." },
    },
    required: ["du", "au"],
  },
  async executer(ctx, args) {
    if (!dateValide(args.du) || !dateValide(args.au)) return { pourModele: { erreur: "du et au doivent être des dates AAAA-MM-JJ valides" } };
    if (args.au < args.du) return { pourModele: { erreur: "au doit être après du" } };
    let projetId: number | undefined;
    if (args.projetId !== undefined && args.projetId !== null) {
      if (!(await projetAMoi(ctx, args.projetId))) return INTROUVABLE;
      projetId = args.projetId;
    }
    let tronque = false;
    let au: string = args.au;
    if (ecartJours(args.du, au) + 1 > PLANNING_JOURS_MAX) {
      au = ajouterJours(args.du, PLANNING_JOURS_MAX - 1);
      tronque = true;
    }
    let taches = await storage.getTasksInRange(ctx.userId, args.du, au, projetId);
    if (args.etat === "faites") taches = taches.filter((t) => t.completed);
    else if (args.etat === "a_faire") taches = taches.filter((t) => !t.completed);
    if (taches.length > PLANNING_TACHES_MAX) {
      taches = taches.slice(0, PLANNING_TACHES_MAX);
      tronque = true;
    }
    const noms = new Map<number, string>();
    if (taches.some((t) => t.projectId != null)) {
      for (const p of await storage.getProjects(ctx.userId, 200)) noms.set(p.id, p.name);
    }
    return {
      pourModele: {
        du: args.du,
        au,
        taches: taches.map((t) => ({
          id: t.id, titre: t.title, date: t.scheduledDate, heure: t.scheduledTime ?? null,
          duree: t.estimatedDuration ?? null, faite: !!t.completed,
          projet: t.projectId != null ? noms.get(t.projectId) ?? null : null,
        })),
        ...(tronque ? { tronque: true, note: `Période limitée à ${PLANNING_JOURS_MAX} jours et ${PLANNING_TACHES_MAX} tâches : redemande la suite.` } : {}),
      },
    };
  },
};

const consulterProjets: Outil = {
  nom: "consulter_projets",
  classe: "lecture",
  description: "Liste les projets (id, nom, type, statut, priorité, point d'étape). Avec `projetId`, ajoute les jalons de ce projet.",
  schema: {
    type: "object",
    properties: { projetId: { type: "integer", description: "Un projet, pour voir aussi ses jalons." } },
  },
  async executer(ctx, args) {
    if (args.projetId !== undefined && args.projetId !== null) {
      const p = await projetAMoi(ctx, args.projetId);
      if (!p) return INTROUVABLE;
      const jalons = await storage.getMilestones(p.id, ctx.userId);
      return {
        pourModele: {
          projet: { id: p.id, nom: p.name, type: p.type, statut: p.projectStatus, priorite: p.priorityLevel, note: p.statusNote ?? null },
          jalons: jalons.map((j) => ({ id: j.id, titre: j.title, statut: j.status, type: j.milestoneType, echeance: j.targetDate ?? null })),
        },
      };
    }
    const projets = await storage.getProjects(ctx.userId, 200);
    return {
      pourModele: {
        projets: projets.map((p) => ({
          id: p.id, nom: p.name, type: p.type, statut: p.projectStatus, priorite: p.priorityLevel, note: p.statusNote ?? null,
        })),
      },
    };
  },
};

const consulterContenus: Outil = {
  nom: "consulter_contenus",
  classe: "lecture",
  description:
    "Liste les contenus (posts, newsletters…) et les campagnes de contenu : titre, plateforme, statut, " +
    "dates. Filtres facultatifs : projet, période (du / au), statut. Pour le texte d'un contenu, utilise `lire`.",
  schema: {
    type: "object",
    properties: {
      projetId: { type: "integer", description: "Limiter à ce projet." },
      du: { type: "string", description: "Début de période, AAAA-MM-JJ (date programmée, publiée ou de création)." },
      au: { type: "string", description: "Fin de période incluse, AAAA-MM-JJ." },
      statut: { type: "string", description: "Statut du contenu (draft, scheduled, published…)." },
    },
  },
  async executer(ctx, args) {
    if (args.du !== undefined && !dateValide(args.du)) return { pourModele: { erreur: "du doit être une date AAAA-MM-JJ valide" } };
    if (args.au !== undefined && !dateValide(args.au)) return { pourModele: { erreur: "au doit être une date AAAA-MM-JJ valide" } };
    let projetId: number | undefined;
    if (args.projetId !== undefined && args.projetId !== null) {
      if (!(await projetAMoi(ctx, args.projetId))) return INTROUVABLE;
      projetId = args.projetId;
    }
    const [lignes, campagnes] = await Promise.all([
      storage.getContent(ctx.userId, CONTENUS_MAX, projetId),
      storage.getCampaigns(ctx.userId, projetId),
    ]);
    const contenus = lignes
      .map((c) => ({ c, date: jour(c.scheduledFor) ?? jour(c.publishedAt) ?? jour(c.createdAt) }))
      .filter(({ c, date }) =>
        (!args.statut || c.status === args.statut) &&
        (!args.du || (date !== null && date >= args.du)) &&
        (!args.au || (date !== null && date <= args.au)))
      .map(({ c }) => ({
        id: c.id, titre: c.title, plateforme: c.platform, statut: c.status,
        programmeLe: jour(c.scheduledFor), publieLe: jour(c.publishedAt), projetId: c.projectId ?? null,
      }));
    return {
      pourModele: {
        contenus,
        campagnes: campagnes.map((k) => ({ id: k.id, nom: k.name, objectif: k.objective, statut: k.status ?? null })),
        ...(lignes.length >= CONTENUS_MAX ? { note: `Les ${CONTENUS_MAX} contenus les plus récents seulement.` } : {}),
      },
    };
  },
};

const consulterProspection: Outil = {
  nom: "consulter_prospection",
  classe: "lecture",
  description:
    "Liste les campagnes de prospection. Avec `campagneId`, ajoute ses prospects (50 au plus) : nom, " +
    "entreprise, stade, état de la séquence (statut et étape).",
  schema: {
    type: "object",
    properties: { campagneId: { type: "integer", description: "Une campagne de prospection, pour voir ses prospects." } },
  },
  async executer(ctx, args) {
    const campagnes = await storage.getProspectionCampaigns(ctx.userId);
    const vue = (k: (typeof campagnes)[number]) => ({
      id: k.id, nom: k.name, statut: k.status, canal: k.channel ?? null, secteur: k.targetSector ?? null, offre: k.offer ?? null,
    });
    if (args.campagneId === undefined || args.campagneId === null) return { pourModele: { campagnes: campagnes.map(vue) } };

    // getProspectionCampaigns est déjà borné au userId : une campagne absente de la liste n'est pas à elle.
    const campagne = campagnes.find((k) => k.id === args.campagneId);
    if (!campagne) return INTROUVABLE;
    const leads = await storage.getLeadsByCampaign(campagne.id, ctx.userId);
    const retenus = leads.slice(0, PROSPECTS_MAX);
    const etats = await Promise.all(retenus.map((l) => storage.getLeadSequenceState(l.id)));
    return {
      pourModele: {
        campagne: vue(campagne),
        prospects: retenus.map((l, i) => ({
          id: l.id, nom: l.name, entreprise: l.company ?? null, stade: l.status,
          sequence: etats[i] ? { statut: etats[i]!.status, etape: etats[i]!.currentStep } : null,
        })),
        ...(leads.length > PROSPECTS_MAX ? { tronque: true, total: leads.length, note: `${PROSPECTS_MAX} prospects sur ${leads.length}.` } : {}),
      },
    };
  },
};

const consulterMesures: Outil = {
  nom: "consulter_mesures",
  classe: "lecture",
  description:
    "Lit les mesures mensuelles d'un projet : chiffre d'affaires, nouveaux clients, commandes, coûts, " +
    "dépenses par canal, bilan. Filtre facultatif : un mois (AAAA-MM).",
  schema: {
    type: "object",
    properties: {
      projetId: { type: "integer", description: "Le projet." },
      mois: { type: "string", description: "Un seul mois, AAAA-MM." },
    },
    required: ["projetId"],
  },
  async executer(ctx, args) {
    if (args.mois !== undefined && !(typeof args.mois === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.mois))) {
      return { pourModele: { erreur: "mois doit être au format AAAA-MM" } };
    }
    if (!(await projetAMoi(ctx, args.projetId))) return INTROUVABLE;
    let mesures = await storage.getMesures(ctx.userId, args.projetId, 24);
    if (args.mois) mesures = mesures.filter((m) => m.mois === args.mois);
    return {
      pourModele: {
        mesures: mesures.map((m) => ({
          mois: m.mois, ca: m.ca ?? null, caNouveaux: m.caNouveaux ?? null, nouveauxClients: m.nouveauxClients ?? null,
          commandes: m.commandes ?? null, coutsVariables: m.coutsVariables ?? null, depenses: m.depenses ?? {},
          bilan: m.bilan ? m.bilan.slice(0, 500) : null,
        })),
      },
    };
  },
};

const consulterReglages: Outil = {
  nom: "consulter_reglages",
  classe: "lecture",
  description: "Lit les réglages utiles : fuseau, jours et heures de travail, énergie du jour, adresse d'envoi de la prospection.",
  schema: { type: "object", properties: {} },
  async executer(ctx) {
    const p = await storage.getUserPreferences(ctx.userId);
    // Liste blanche explicite : on ne répand JAMAIS l'objet des préférences (clés d'API chiffrées,
    // ids de comptes Unipile…). Un nouveau champ du schéma n'apparaît donc pas tout seul ici.
    const energieDuJour = p?.energyUpdatedDate === aujourdhui(ctx);
    return {
      pourModele: {
        fuseau: p?.timezone ?? ctx.fuseau,
        joursTravail: p?.workDays ?? null,
        debutJournee: p?.workDayStart ?? null,
        finJournee: p?.workDayEnd ?? null,
        energie: energieDuJour ? p?.currentEnergyLevel ?? null : null,
        adresseEnvoi: { email: p?.prospectionSenderEmail ?? null, nom: p?.prospectionSenderName ?? null },
      },
    };
  },
};

export const OUTILS_LECTURE: Outil[] = [
  chercherOutil, lireOutil,
  consulterPlanning, consulterProjets, consulterContenus, consulterProspection, consulterMesures, consulterReglages,
];
