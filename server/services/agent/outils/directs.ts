// Actions directes de l'agent (spec §5 et §6.3) : les petits gestes faits sans demander —
// créer une tâche, un rappel, une liste ; cocher / décocher ; déplacer une tâche ; régler
// l'énergie du jour. Chacun passe par les mêmes fonctions que le web (creerTache /
// modifierTache, avec leurs garde-fous), puis journalise ses lignes (avant / après) pour
// pouvoir être annulé pendant 24 h (journal.ts). Un refus n'écrit AUCUNE ligne de journal et
// revient au modèle en {erreur}. Jamais de planificateur IA ici.
import { storage } from "../../../storage";
import { rangerSouvenir, type FilRange } from "../../memory/ranger";
import { creerTache, modifierTache } from "../../taches/ecrire-tache";
import { resolveScheduledEndTime } from "../../task-schedule-fields";
import { dateDansFuseau } from "../consignes";
import { depot, type LigneJournal } from "../depot";
import { FENETRE_ANNULATION_MS } from "../journal";
import type { ContexteOutil, Outil, ResultatOutil } from "../registre";

const ELEMENTS_MAX = 100;
const TITRE_MAX = 200;

// ── Petits utilitaires ─────────────────────────────────────────────────────────────────

// AAAA-MM-JJ réel (le 31 février est refusé).
export function dateValide(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function heureValide(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function titrePropre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= TITRE_MAX ? t : null;
}

// « Aujourd'hui » dans le fuseau de l'utilisatrice (repli UTC si le fuseau est invalide).
export function dateLocale(ctx: ContexteOutil): string {
  try {
    return dateDansFuseau(ctx.maintenant, ctx.fuseau);
  } catch {
    return ctx.maintenant.toISOString().slice(0, 10);
  }
}

const erreur = (message: string): ResultatOutil => ({ pourModele: { erreur: message } });

// « le 5 nov. » / « à 10 h » / « à 9 h 30 ».
export function jourCourt(date: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
}
export function heureCourte(heure: string): string {
  const [h, m] = heure.split(":").map(Number);
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
function quand(date: string | null | undefined, heure: string | null | undefined, prefixe = "le"): string {
  if (!date) return "";
  return ` ${prefixe} ${jourCourt(date)}${heure ? ` à ${heureCourte(heure)}` : ""}`;
}

// Journalise l'action et rend ce que la réponse montre (« Annuler » jusqu'à…).
async function journaliser(
  ctx: ContexteOutil,
  nom: string,
  resume: string,
  lignes: LigneJournal[],
  pourModele: Record<string, unknown>,
): Promise<ResultatOutil> {
  const a = await depot.ajouterAction(ctx.userId, nom, resume, lignes);
  const depart = a.createdAt ? new Date(a.createdAt) : ctx.maintenant;
  const annulableJusqua = new Date(depart.getTime() + FENETRE_ANNULATION_MS).toISOString();
  return {
    pourModele: { ok: true, ...pourModele, resume },
    faite: { actionId: a.id, resume, annulableJusqua },
  };
}

// Champs d'une tâche créée qu'on surveille : si elle a été renommée, cochée ou déplacée
// depuis, l'annulation (qui la supprimerait) est refusée.
function apresCreation(t: any): Record<string, unknown> {
  return { title: t.title, scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, completed: !!t.completed };
}

// ── Création de tâche / rappel ─────────────────────────────────────────────────────────

const creerTacheOutil: Outil = {
  nom: "creer_tache",
  classe: "direct",
  description:
    "Ajoute une tâche au planning. Sans date, elle reste à planifier ; avec une date sans heure, " +
    "le premier créneau libre est pris. Refusé sur un jour non travaillé.",
  schema: {
    type: "object",
    properties: {
      titre: { type: "string", description: "Intitulé court de la tâche." },
      date: { type: "string", description: "Jour, AAAA-MM-JJ." },
      heure: { type: "string", description: "Heure de début, HH:MM." },
      dureeMinutes: { type: "integer", description: "Durée estimée en minutes." },
      projetId: { type: "integer", description: "Projet de rattachement." },
    },
    required: ["titre"],
  },
  async executer(ctx, args) {
    const titre = titrePropre(args.titre);
    if (!titre) return erreur("titre vide ou trop long");
    if (args.date != null && !dateValide(args.date)) return erreur("date doit être AAAA-MM-JJ");
    if (args.heure != null && !heureValide(args.heure)) return erreur("heure doit être HH:MM");
    if (args.heure != null && args.date == null) return erreur("une heure demande une date");
    if (args.dureeMinutes != null && !(args.dureeMinutes > 0 && args.dureeMinutes <= 24 * 60)) {
      return erreur("dureeMinutes hors limites");
    }

    const donnees: Record<string, unknown> = {
      title: titre, type: "planning", category: "planning", priority: 3, source: "companion",
    };
    if (args.date != null) donnees.scheduledDate = args.date;
    if (args.heure != null) {
      donnees.scheduledTime = args.heure;
      donnees.scheduledEndTime = resolveScheduledEndTime(args.heure, args.dureeMinutes ?? null);
    }
    if (args.dureeMinutes != null) donnees.estimatedDuration = args.dureeMinutes;
    if (args.projetId != null) donnees.projectId = args.projetId;

    const r = await creerTache(ctx.userId, donnees);
    if (!r.ok) return erreur(r.message);
    const t = r.tache as any;
    const resume = `Tâche « ${t.title} » ajoutée${quand(t.scheduledDate, t.scheduledTime)}`;
    return journaliser(ctx, "creer_tache", resume,
      [{ table: "tasks", id: t.id, avant: null, apres: apresCreation(t) }],
      { tacheId: t.id, date: t.scheduledDate ?? null, heure: t.scheduledTime ?? null });
  },
};

const creerRappelOutil: Outil = {
  nom: "creer_rappel",
  classe: "direct",
  description: "Pose un rappel à un jour et une heure précis (une petite tâche administrative à cette heure-là).",
  schema: {
    type: "object",
    properties: {
      titre: { type: "string", description: "De quoi se souvenir." },
      date: { type: "string", description: "Jour, AAAA-MM-JJ." },
      heure: { type: "string", description: "Heure, HH:MM." },
    },
    required: ["titre", "date", "heure"],
  },
  async executer(ctx, args) {
    const titre = titrePropre(args.titre);
    if (!titre) return erreur("titre vide ou trop long");
    if (!dateValide(args.date)) return erreur("date doit être AAAA-MM-JJ");
    if (!heureValide(args.heure)) return erreur("heure doit être HH:MM");

    const r = await creerTache(ctx.userId, {
      title: titre, type: "admin", category: "planning", priority: 2, source: "companion",
      scheduledDate: args.date, scheduledTime: args.heure,
      scheduledEndTime: resolveScheduledEndTime(args.heure, null),
    });
    if (!r.ok) return erreur(r.message);
    const t = r.tache as any;
    const resume = `Rappel « ${t.title} »${quand(t.scheduledDate, t.scheduledTime)}`;
    return journaliser(ctx, "creer_rappel", resume,
      [{ table: "tasks", id: t.id, avant: null, apres: apresCreation(t) }],
      { tacheId: t.id, date: t.scheduledDate ?? null, heure: t.scheduledTime ?? null });
  },
};

// ── Liste ──────────────────────────────────────────────────────────────────────────────

const creerListeOutil: Outil = {
  nom: "creer_liste",
  classe: "direct",
  description: "Crée une liste à cocher (courses, à emporter, étapes…), rattachable à un jour ou à une tâche.",
  schema: {
    type: "object",
    properties: {
      titre: { type: "string", description: "Nom de la liste." },
      elements: { type: "array", items: { type: "string" }, description: "Les éléments, dans l'ordre." },
      date: { type: "string", description: "Jour de rattachement, AAAA-MM-JJ." },
      tacheLieeId: { type: "integer", description: "Tâche à laquelle rattacher la liste." },
    },
    required: ["titre", "elements"],
  },
  async executer(ctx, args) {
    const titre = titrePropre(args.titre);
    if (!titre) return erreur("titre vide ou trop long");
    const elements = (args.elements as string[]).map((e) => e.trim()).filter(Boolean);
    if (elements.length > ELEMENTS_MAX) return erreur(`${ELEMENTS_MAX} éléments au plus`);
    if (elements.some((e) => e.length > TITRE_MAX)) return erreur("un élément est trop long");
    if (args.date != null && !dateValide(args.date)) return erreur("date doit être AAAA-MM-JJ");
    if (args.tacheLieeId != null) {
      const t = await storage.getTask(args.tacheLieeId);
      if (!t || (t as any).userId !== ctx.userId) return erreur("introuvable");
    }

    const liste = await storage.createTaskList({
      userId: ctx.userId, title: titre, linkedTaskId: args.tacheLieeId ?? null,
      linkedDate: args.date ?? null, createdByCompanion: true,
    });
    try {
      for (let i = 0; i < elements.length; i++) {
        await storage.createTaskListItem({ listId: liste.id, title: elements[i], order: i });
      }
    } catch (e) {
      // Pas de liste à moitié remplie et non journalisée : on la retire.
      await storage.deleteTaskList(liste.id, ctx.userId).catch(() => {});
      throw e;
    }
    const n = elements.length;
    const resume = `Liste « ${liste.title} » créée (${n} élément${n > 1 ? "s" : ""})`;
    return journaliser(ctx, "creer_liste", resume,
      [{ table: "task_lists", id: liste.id, avant: null, apres: {
        title: liste.title, elements: elements.map((titre) => ({ titre, coche: false })),
      } }],
      { listeId: liste.id });
  },
};

// ── Cocher / décocher ──────────────────────────────────────────────────────────────────

function outilCoche(nom: "cocher_tache" | "decocher_tache"): Outil {
  const cocher = nom === "cocher_tache";
  return {
    nom,
    classe: "direct",
    description: cocher ? "Marque une tâche comme faite." : "Remet une tâche à faire (la décoche).",
    schema: {
      type: "object",
      properties: { tacheId: { type: "integer", description: "Id de la tâche." } },
      required: ["tacheId"],
    },
    async executer(ctx, args) {
      // Décocher remet explicitement completedAt à null (modifierTache ne le fait pas seul).
      const patch = cocher ? { completed: true } : { completed: false, completedAt: null };
      const r = await modifierTache(ctx.userId, args.tacheId, patch);
      if (!r.ok) return erreur(r.message);
      const avant = r.avant as any;
      const apres = r.tache as any;
      const resume = `Tâche « ${apres.title} » ${cocher ? "cochée" : "décochée"}`;
      return journaliser(ctx, nom, resume, [{
        table: "tasks", id: args.tacheId,
        avant: { completed: !!avant.completed, completedAt: avant.completedAt ?? null },
        apres: { completed: !!apres.completed, completedAt: apres.completedAt ?? null },
      }], { tacheId: args.tacheId });
    },
  };
}

// ── Déplacer ───────────────────────────────────────────────────────────────────────────

const deplacerTacheOutil: Outil = {
  nom: "deplacer_tache",
  classe: "direct",
  description:
    "Déplace une tâche à un autre jour (et à une autre heure si donnée ; sinon elle garde son heure). " +
    "Si le créneau est pris, elle glisse au suivant libre. Refusé sur un jour non travaillé.",
  schema: {
    type: "object",
    properties: {
      tacheId: { type: "integer", description: "Id de la tâche." },
      date: { type: "string", description: "Nouveau jour, AAAA-MM-JJ." },
      heure: { type: "string", description: "Nouvelle heure, HH:MM." },
    },
    required: ["tacheId", "date"],
  },
  async executer(ctx, args) {
    if (!dateValide(args.date)) return erreur("date doit être AAAA-MM-JJ");
    if (args.heure != null && !heureValide(args.heure)) return erreur("heure doit être HH:MM");
    const patch: Record<string, unknown> = { scheduledDate: args.date };
    if (args.heure != null) patch.scheduledTime = args.heure;

    const r = await modifierTache(ctx.userId, args.tacheId, patch);
    if (!r.ok) return erreur(r.message);
    // Relue après le filet anti-chevauchement, qui a pu la décaler : `apres` doit être ce
    // qui est vraiment en base, sinon l'annulation la croirait modifiée.
    const relue = await storage.getTask(args.tacheId);
    const t = (relue && (relue as any).userId === ctx.userId ? relue : r.tache) as any;
    const avant = r.avant as any;
    const champs = (x: any) => ({
      scheduledDate: x.scheduledDate ?? null, scheduledTime: x.scheduledTime ?? null, scheduledEndTime: x.scheduledEndTime ?? null,
    });
    const resume = `Tâche « ${t.title} » déplacée${quand(t.scheduledDate, t.scheduledTime, "au")}`;
    return journaliser(ctx, "deplacer_tache", resume,
      [{ table: "tasks", id: args.tacheId, avant: champs(avant), apres: champs(t) }],
      { tacheId: args.tacheId, date: t.scheduledDate ?? null, heure: t.scheduledTime ?? null });
  },
};

// ── Énergie du jour ────────────────────────────────────────────────────────────────────

const NIVEAUX: Record<string, string> = { high: "haute", medium: "moyenne", low: "basse", depleted: "à plat" };

const reglerEnergieOutil: Outil = {
  nom: "regler_energie",
  classe: "direct",
  description: "Note l'énergie du jour de l'utilisatrice (haute, moyenne, basse, à plat).",
  schema: {
    type: "object",
    properties: { niveau: { type: "string", enum: Object.keys(NIVEAUX), description: "high | medium | low | depleted." } },
    required: ["niveau"],
  },
  async executer(ctx, args) {
    const prefs = await storage.getUserPreferences(ctx.userId);
    const avant = {
      currentEnergyLevel: prefs?.currentEnergyLevel ?? null,
      energyUpdatedDate: prefs?.energyUpdatedDate ?? null,
    };
    const nouvelles = await storage.upsertUserPreferences(ctx.userId, {
      currentEnergyLevel: args.niveau,
      energyUpdatedDate: dateLocale(ctx),
    });
    const apres = {
      currentEnergyLevel: nouvelles.currentEnergyLevel ?? null,
      energyUpdatedDate: nouvelles.energyUpdatedDate ?? null,
    };
    const resume = `Énergie du jour : ${NIVEAUX[args.niveau]}`;
    return journaliser(ctx, "regler_energie", resume,
      [{ table: "user_preferences", id: ctx.userId, avant, apres }],
      { niveau: args.niveau });
  },
};

// ── Notes et mémoire ───────────────────────────────────────────────────────────────────

const CONTENU_MAX = 4000;

function contenuPropre(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= CONTENU_MAX ? t : null;
}

// Le projet doit être à l'utilisatrice (getProject est borné à userId) : sinon « introuvable ».
async function projetDe(ctx: ContexteOutil, projetId: unknown): Promise<{ id: number; name: string } | null> {
  if (typeof projetId !== "number" || !Number.isInteger(projetId)) return null;
  const p = await storage.getProject(projetId, ctx.userId);
  return p ? { id: p.id, name: p.name } : null;
}

// Même écriture que POST /api/projects/:id/notes : une note « inbox » non traitée.
async function ecrireNote(ctx: ContexteOutil, nom: string, contenu: string, projet: { id: number; name: string } | null, resume: string) {
  const note = await storage.createCaptureEntry({
    userId: ctx.userId,
    projectId: projet?.id ?? null,
    content: contenu,
    captureType: "note",
    classifiedType: "note",
    isProcessed: false,
    routingStatus: "inbox",
  } as any);
  // Les champs surveillés : édition, rangement ou conversion depuis rendent l'annulation
  // impossible (elle supprimerait la note).
  return journaliser(ctx, nom, resume, [{
    table: "quick_capture_entries", id: note.id, avant: null,
    apres: {
      content: note.content, captureType: "note", isProcessed: false, routingStatus: "inbox",
      routedTo: null, convertedToTaskId: null, projectId: projet?.id ?? null,
    },
  }], { noteId: note.id });
}

const creerNoteOutil: Outil = {
  nom: "creer_note",
  classe: "direct",
  description: "Enregistre une note (boîte de réception de Naya), éventuellement liée à un projet.",
  schema: {
    type: "object",
    properties: {
      contenu: { type: "string", description: "Texte de la note." },
      projetId: { type: "integer", description: "Projet auquel lier la note." },
    },
    required: ["contenu"],
  },
  async executer(ctx, args) {
    const contenu = contenuPropre(args.contenu);
    if (!contenu) return erreur("contenu vide ou trop long");
    let projet = null;
    if (args.projetId != null) {
      projet = await projetDe(ctx, args.projetId);
      if (!projet) return erreur("introuvable");
    }
    const resume = projet ? `Note ajoutée aux notes de ${projet.name}` : "Note ajoutée à la boîte de réception";
    return ecrireNote(ctx, "creer_note", contenu, projet, resume);
  },
};

const FILS_RANGEMENT: FilRange[] = ["cap", "founder", "savoir"];

const rangerInformationOutil: Outil = {
  nom: "ranger_information",
  classe: "direct",
  description:
    "Range une information donnée par l'utilisatrice : dans les notes d'un projet (ou = note_projet, projetId requis) " +
    "ou dans la mémoire de Naya (ou = memoire). Fil de mémoire : cap (le projet), founder (elle, transverse), " +
    "savoir (connaissance de métier). Sans fil : cap si un projet est donné, sinon founder.",
  schema: {
    type: "object",
    properties: {
      contenu: { type: "string", description: "L'information, en une ou deux phrases." },
      ou: { type: "string", enum: ["note_projet", "memoire"], description: "note_projet | memoire." },
      projetId: { type: "integer", description: "Projet concerné (requis pour note_projet)." },
      fil: { type: "string", enum: FILS_RANGEMENT, description: "Mémoire seulement : cap | founder | savoir." },
      type: { type: "string", description: "Mémoire seulement : fait, décision, préférence, observation…" },
    },
    required: ["contenu", "ou"],
  },
  async executer(ctx, args) {
    const contenu = contenuPropre(args.contenu);
    if (!contenu) return erreur("contenu vide ou trop long");

    if (args.ou === "note_projet") {
      if (args.projetId == null) return erreur("projet_requis");
      const projet = await projetDe(ctx, args.projetId);
      if (!projet) return erreur("introuvable");
      return ecrireNote(ctx, "ranger_information", contenu, projet, `Rangé dans les notes de ${projet.name}`);
    }

    // Mémoire. Le fil décide de la portée de lecture (retrieve.ts porteeFil) : cap est lu
    // par marque, founder sans marque, savoir sans marque ou avec la marque active.
    let projet = null;
    if (args.projetId != null) {
      projet = await projetDe(ctx, args.projetId);
      if (!projet) return erreur("introuvable");
    }
    const fil: FilRange = args.fil ?? (projet ? "cap" : "founder");
    if (fil === "cap" && !projet) return erreur("projet_requis");
    const projectId = fil === "founder" ? null : projet?.id ?? null;
    const type = typeof args.type === "string" && args.type.trim() ? args.type.trim().slice(0, 40) : "fait";

    const { id } = await rangerSouvenir(ctx.userId, projectId, contenu, fil, type);
    const ou = fil === "founder" || !projet ? "la mémoire" : `la mémoire de ${projet.name}`;
    return journaliser(ctx, "ranger_information", `Rangé dans ${ou}`, [{
      table: "memory_entries", id, avant: null, apres: { content: contenu, supersededAt: null },
    }], { souvenirId: id, fil });
  },
};

export const OUTILS_DIRECTS: Outil[] = [
  creerTacheOutil,
  creerRappelOutil,
  creerNoteOutil,
  creerListeOutil,
  outilCoche("cocher_tache"),
  outilCoche("decocher_tache"),
  deplacerTacheOutil,
  rangerInformationOutil,
  reglerEnergieOutil,
];
