// Outils « à valider » de l'agent (spec §5 et §6.3), lot 1 : les gros changements. Appelés par
// le modèle, ils n'écrivent RIEN : ils vérifient que chaque id est à l'utilisatrice, lisent
// l'état actuel et rendent un aperçu (avant → après) avec son empreinte (propositions.ts en
// fait une proposition `en_attente`). L'exécution n'a lieu qu'à la validation, élément par
// élément, par les mêmes fonctions que le web : modifierTache, deleteTask (après
// vérification d'appartenance), ecrire-projet.ts et completerMesure.
// Règle du projet : aucun de ces outils ne crée de tâche pour un jalon `locked`.
import { storage } from "../../../storage";
import { modifierTache } from "../../taches/ecrire-tache";
import { confirmerJalon, creerChaineJalons, creerProjet } from "../../projets/ecrire-projet";
import { completerMesure, lireMoisMesure } from "../../mesure/completer";
import { completerMois } from "../../mesure/phrase";
import { moisValide } from "../../mesure/saisie";
import { CLES_CANAUX } from "../../mesure/catalogues";
import { memeValeur } from "../journal";
import {
  outilAValider, tachesNonFaitesDuJour,
  type Apercu, type BilanExecution, type Empreinte, type OutilPropose,
} from "../propositions";
import type { Changement } from "@shared/agent";
import { dateLocale, dateValide, heureCourte, heureValide, jourCourt, titrePropre } from "./directs";

const ELEMENTS_MAX = 100;
const JALONS_MAX = 20;
const DESCRIPTION_MAX = 2000;

const erreur = (message: string) => ({ erreur: message });
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// « 2 nov. à 10 h » ; « à planifier » sans date.
function placement(date: unknown, heure: unknown): string {
  if (typeof date !== "string" || !date) return "à planifier";
  const j = jourCourt(date.slice(0, 10));
  return typeof heure === "string" && heure ? `${j} à ${heureCourte(heure.slice(0, 5))}` : j;
}

// Les refus de modifierTache, en français lisible.
function raisonLisible(message: string): string {
  if (message === "task_not_found") return "introuvable";
  if (/not one of your work days/.test(message)) return "jour non travaillé";
  return message;
}

// La tâche si elle est à l'utilisatrice, sinon undefined (getTask ne filtre pas).
async function tacheDe(userId: string, id: unknown): Promise<any | undefined> {
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) return undefined;
  const t = await storage.getTask(id);
  return t && (t as any).userId === userId ? t : undefined;
}

// Ce qu'on surveille d'une tâche entre l'aperçu et la validation.
function empreinteTache(t: any): Empreinte[number] {
  return {
    table: "tasks", id: t.id,
    champs: { title: t.title, scheduledDate: t.scheduledDate ?? null, scheduledTime: t.scheduledTime ?? null, completed: !!t.completed },
  };
}

// Déplace une tâche (modifierTache : jour travaillé, créneau libre, filet anti-chevauchement)
// et rend la ligne du bilan.
async function deplacerUne(userId: string, id: number, date: string, heure: string | undefined, bilan: BilanExecution) {
  try {
    const t = await tacheDe(userId, id);
    if (!t) { bilan.echecs.push(`Tâche n° ${id} : introuvable`); return; }
    const patch: Record<string, unknown> = { scheduledDate: date };
    if (heure != null) patch.scheduledTime = heure;
    const r = await modifierTache(userId, id, patch);
    if (!r.ok) { bilan.echecs.push(`« ${t.title} » : ${raisonLisible(r.message)}`); return; }
    const apres = r.tache as any;
    bilan.reussis.push(`« ${apres.title} » déplacée au ${placement(apres.scheduledDate, apres.scheduledTime)}`);
  } catch (e: any) {
    console.error(`[agent] déplacement de la tâche ${id} :`, e?.message ?? e);
    bilan.echecs.push(`Tâche n° ${id} : erreur imprévue`);
  }
}

// ── deplacer_taches ────────────────────────────────────────────────────────────────────

type Deplacement = { tacheId: number; date: string; heure?: string };

const deplacerTaches = outilAValider<{ deplacements: Deplacement[] }>({
  nom: "deplacer_taches",
  description:
    "Propose de déplacer plusieurs tâches (chacune à un jour, et à une heure si donnée ; sinon elle " +
    "garde son heure). Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      deplacements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tacheId: { type: "integer", description: "Id de la tâche." },
            date: { type: "string", description: "Nouveau jour, AAAA-MM-JJ." },
            heure: { type: "string", description: "Nouvelle heure, HH:MM." },
          },
          required: ["tacheId", "date"],
        },
      },
    },
    required: ["deplacements"],
  },
  async apercu(ctx, args) {
    const liste = args.deplacements;
    if (!liste.length) return erreur("aucun déplacement");
    if (liste.length > ELEMENTS_MAX) return erreur(`${ELEMENTS_MAX} tâches au plus`);
    if (new Set(liste.map((d) => d.tacheId)).size !== liste.length) return erreur("une tâche apparaît deux fois");
    for (const d of liste) {
      if (!dateValide(d.date)) return erreur("date doit être AAAA-MM-JJ");
      if (d.heure != null && !heureValide(d.heure)) return erreur("heure doit être HH:MM");
    }
    const changements: Changement[] = [];
    const empreinte: Empreinte = [];
    for (const d of liste) {
      const t = await tacheDe(ctx.userId, d.tacheId);
      if (!t) return erreur("introuvable");
      changements.push({
        libelle: `« ${t.title} »`,
        avant: placement(t.scheduledDate, t.scheduledTime),
        apres: placement(d.date, d.heure ?? t.scheduledTime),
      });
      empreinte.push(empreinteTache(t));
    }
    return { resume: `Déplacer ${pluriel(liste.length, "tâche")}`, changements, empreinte };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    for (const d of args.deplacements) await deplacerUne(ctx.userId, d.tacheId, d.date, d.heure, bilan);
    return bilan;
  },
});

// ── decaler_journee ────────────────────────────────────────────────────────────────────

const decalerJournee = outilAValider<{ du: string; au: string }>({
  nom: "decaler_journee",
  description:
    "Propose de décaler toutes les tâches non faites d'un jour (du) à un autre jour (au), chacune à " +
    "la même heure si le créneau est libre. Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      du: { type: "string", description: "Jour de départ, AAAA-MM-JJ." },
      au: { type: "string", description: "Jour d'arrivée, AAAA-MM-JJ." },
    },
    required: ["du", "au"],
  },
  async apercu(ctx, args) {
    if (!dateValide(args.du) || !dateValide(args.au)) return erreur("du et au doivent être AAAA-MM-JJ");
    if (args.du === args.au) return erreur("du et au sont le même jour");
    // « Passé » au sens du fuseau de l'utilisatrice, pas de l'UTC.
    if (args.au < dateLocale(ctx)) return erreur("on ne décale pas vers un jour passé");
    const taches = await tachesNonFaitesDuJour(ctx.userId, args.du);
    if (!taches.length) return erreur("aucune tâche à faire ce jour-là");
    if (taches.length > ELEMENTS_MAX) return erreur(`${ELEMENTS_MAX} tâches au plus`);
    const changements: Changement[] = taches.map((t: any) => ({
      libelle: `« ${t.title} »`,
      avant: placement(t.scheduledDate, t.scheduledTime),
      apres: placement(args.au, t.scheduledTime),
    }));
    // La liste elle-même fait partie de l'empreinte : une tâche ajoutée ou cochée ce jour-là
    // depuis l'aperçu rend la proposition périmée (on ne déplace que ce qui a été montré).
    const empreinte: Empreinte = [
      { table: "taches_du_jour", id: 0, champs: { date: args.du, ids: taches.map((t) => t.id) } },
      ...taches.map(empreinteTache),
    ];
    return {
      resume: `Décaler ${pluriel(taches.length, "tâche")} du ${jourCourt(args.du)} au ${jourCourt(args.au)}`,
      changements, empreinte,
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    // L'empreinte vient d'être vérifiée : ce sont exactement les tâches de l'aperçu.
    const taches = await tachesNonFaitesDuJour(ctx.userId, args.du);
    for (const t of taches) await deplacerUne(ctx.userId, t.id, args.au, undefined, bilan);
    return bilan;
  },
});

// ── supprimer_taches ───────────────────────────────────────────────────────────────────

const supprimerTaches = outilAValider<{ tacheIds: number[] }>({
  nom: "supprimer_taches",
  description: "Propose de supprimer des tâches (définitivement). Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: { tacheIds: { type: "array", items: { type: "integer" }, description: "Ids des tâches." } },
    required: ["tacheIds"],
  },
  async apercu(ctx, args) {
    const ids = Array.from(new Set(args.tacheIds));
    if (!ids.length) return erreur("aucune tâche");
    if (ids.length > ELEMENTS_MAX) return erreur(`${ELEMENTS_MAX} tâches au plus`);
    const changements: Changement[] = [];
    const empreinte: Empreinte = [];
    for (const id of ids) {
      const t = await tacheDe(ctx.userId, id);
      if (!t) return erreur("introuvable");
      changements.push({ libelle: `« ${t.title} »`, avant: placement(t.scheduledDate, t.scheduledTime), apres: null });
      empreinte.push(empreinteTache(t));
    }
    return { resume: `Supprimer ${pluriel(ids.length, "tâche")}`, changements, empreinte };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    for (const id of Array.from(new Set(args.tacheIds))) {
      try {
        // deleteTask ne filtre pas par utilisatrice : l'appartenance est revérifiée juste avant.
        const t = await tacheDe(ctx.userId, id);
        if (!t) { bilan.echecs.push(`Tâche n° ${id} : introuvable`); continue; }
        await storage.deleteTask(id);
        bilan.reussis.push(`« ${t.title} » supprimée`);
      } catch (e: any) {
        console.error(`[agent] suppression de la tâche ${id} :`, e?.message ?? e);
        bilan.echecs.push(`Tâche n° ${id} : erreur imprévue`);
      }
    }
    return bilan;
  },
});

// ── creer_projet ───────────────────────────────────────────────────────────────────────

const TYPES_PROJET = ["Business", "Personal Brand", "Passion Project", "Client Project", "Agency", "Internal", "Lifestyle"];

function titresJalons(jalons: unknown[]): string[] | null {
  const titres = jalons.map(titrePropre);
  return titres.every((t): t is string => !!t) ? titres : null;
}

const STATUTS_JALON: Record<string, string> = {
  locked: "verrouillé", unlocked: "déverrouillé", active: "actif", completed: "terminé",
};

// Le premier jalon d'une chaîne est actif, les suivants verrouillés (createMilestoneChain).
const statutDansChaine = (i: number) => (i === 0 ? "actif" : "verrouillé");

const creerProjetOutil = outilAValider<{ nom: string; type?: string; description?: string; jalons?: string[] }>({
  nom: "creer_projet",
  description:
    "Propose de créer un projet, avec éventuellement sa chaîne de jalons (le premier actif, les suivants " +
    "verrouillés). Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      nom: { type: "string", description: "Nom du projet." },
      type: { type: "string", enum: TYPES_PROJET, description: "Type de projet." },
      description: { type: "string", description: "Description courte." },
      jalons: { type: "array", items: { type: "string" }, description: "Titres des jalons, dans l'ordre." },
    },
    required: ["nom"],
  },
  async apercu(ctx, args) {
    const nom = titrePropre(args.nom);
    if (!nom) return erreur("nom vide ou trop long");
    if (args.description != null && args.description.length > DESCRIPTION_MAX) return erreur("description trop longue");
    const jalons = titresJalons(args.jalons ?? []);
    if (!jalons) return erreur("un titre de jalon est vide ou trop long");
    if (jalons.length > JALONS_MAX) return erreur(`${JALONS_MAX} jalons au plus`);
    const premier = (await storage.getProjects(ctx.userId)).length === 0;
    const changements: Changement[] = [{ libelle: "Projet", avant: null, apres: `${nom} (${args.type ?? "Business"})` }];
    if (args.description) changements.push({ libelle: "Description", avant: null, apres: args.description });
    if (premier) changements.push({ libelle: "Projet principal", avant: null, apres: "oui (ton premier projet)" });
    jalons.forEach((titre, i) => changements.push({ libelle: `Jalon « ${titre} »`, avant: null, apres: statutDansChaine(i) }));
    const resume = `Créer le projet « ${nom} »${jalons.length ? ` avec ${pluriel(jalons.length, "jalon")}` : ""}`;
    // Aucune ligne existante n'est touchée : empreinte vide.
    return { resume, changements, empreinte: [] };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    const nom = titrePropre(args.nom) ?? String(args.nom);
    let projetId: number;
    try {
      const donnees: Record<string, unknown> = { name: nom };
      if (args.type) donnees.type = args.type;
      if (args.description) donnees.description = args.description;
      const r = await creerProjet(ctx.userId, donnees);
      projetId = r.projet.id;
      bilan.reussis.push(`Projet « ${r.projet.name} » créé`);
    } catch (e: any) {
      console.error("[agent] création de projet :", e?.message ?? e);
      bilan.echecs.push(`Projet « ${nom} » : création impossible`);
      if (args.jalons?.length) bilan.echecs.push(`${pluriel(args.jalons.length, "jalon")} non créé${args.jalons.length > 1 ? "s" : ""} (pas de projet)`);
      return bilan;
    }
    if (args.jalons?.length) await ecrireJalons(ctx.userId, projetId, args.jalons.map((titre) => ({ titre })), bilan);
    return bilan;
  },
});

// ── creer_jalons ───────────────────────────────────────────────────────────────────────

type JalonDemande = { titre: string; description?: string };

// La chaîne passe par creerChaineJalons (createMilestoneChain) : aucune tâche n'y est créée.
async function ecrireJalons(userId: string, projetId: number, jalons: JalonDemande[], bilan: BilanExecution) {
  try {
    const r = await creerChaineJalons(userId, projetId, {
      milestones: jalons.map((j) => ({ title: titrePropre(j.titre) ?? j.titre, ...(j.description ? { description: j.description } : {}) })),
    });
    if (!r.ok) {
      bilan.echecs.push(`Jalons : ${r.status === 404 ? "projet introuvable" : r.message}`);
      return;
    }
    for (const j of r.jalons) bilan.reussis.push(`Jalon « ${j.title} » créé (${j.status === "locked" ? "verrouillé" : "actif"})`);
  } catch (e: any) {
    console.error("[agent] création de jalons :", e?.message ?? e);
    bilan.echecs.push("Jalons : création impossible");
  }
}

const creerJalons = outilAValider<{ projetId: number; jalons: JalonDemande[] }>({
  nom: "creer_jalons",
  description:
    "Propose d'ajouter une chaîne de jalons à un projet (le premier actif, les suivants verrouillés jusqu'à " +
    "ce que le précédent soit terminé). Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      projetId: { type: "integer", description: "Id du projet." },
      jalons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titre: { type: "string", description: "Titre du jalon." },
            description: { type: "string", description: "Description courte." },
          },
          required: ["titre"],
        },
      },
    },
    required: ["projetId", "jalons"],
  },
  async apercu(ctx, args) {
    if (!args.jalons.length) return erreur("aucun jalon");
    if (args.jalons.length > JALONS_MAX) return erreur(`${JALONS_MAX} jalons au plus`);
    const titres = titresJalons(args.jalons.map((j) => j.titre));
    if (!titres) return erreur("un titre de jalon est vide ou trop long");
    if (args.jalons.some((j) => j.description != null && j.description.length > DESCRIPTION_MAX)) return erreur("description trop longue");
    const projet = await storage.getProject(args.projetId, ctx.userId);
    if (!projet) return erreur("introuvable");
    // createMilestoneChain crée une chaîne NEUVE (premier jalon actif, ordre à partir de 0, sans
    // lien avec l'existant) : sur un projet qui a déjà des jalons, elle ferait une seconde chaîne
    // parallèle avec deux jalons actifs. Lot 1 : on refuse ; prolonger une chaîne = lot 2.
    const existants = await storage.getMilestones(projet.id, ctx.userId);
    if (existants.length > 0) {
      return {
        erreur: "projet_a_deja_des_jalons",
        jalons: existants.slice(0, 10).map((j) => ({ titre: j.title, statut: STATUTS_JALON[j.status] ?? j.status })),
      };
    }
    const changements: Changement[] = titres.map((titre, i) => ({ libelle: `Jalon « ${titre} »`, avant: null, apres: statutDansChaine(i) }));
    return {
      resume: `Ajouter ${pluriel(titres.length, "jalon")} à « ${projet.name} »`,
      changements,
      empreinte: [
        { table: "projects", id: projet.id, champs: { name: projet.name } },
        { table: "jalons_du_projet", id: projet.id, champs: { nombre: 0 } },
      ],
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    await ecrireJalons(ctx.userId, args.projetId, args.jalons, bilan);
    return bilan;
  },
});

// ── confirmer_jalon ────────────────────────────────────────────────────────────────────

const confirmerJalonOutil = outilAValider<{ jalonId: number }>({
  nom: "confirmer_jalon",
  description:
    "Propose de confirmer un jalon comme atteint : il passe à « terminé », ses tâches non faites sont " +
    "cochées et les jalons suivants peuvent se déverrouiller. Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: { jalonId: { type: "integer", description: "Id du jalon." } },
    required: ["jalonId"],
  },
  async apercu(ctx, args) {
    const jalon = Number.isInteger(args.jalonId) && args.jalonId > 0 ? await storage.getMilestone(args.jalonId) : undefined;
    if (!jalon || jalon.userId !== ctx.userId) return erreur("introuvable");
    if (jalon.status === "completed") return erreur("ce jalon est déjà terminé");
    const changements: Changement[] = [
      { libelle: `Jalon « ${jalon.title} »`, avant: STATUTS_JALON[jalon.status] ?? jalon.status, apres: "terminé" },
    ];
    const stats = (await storage.getMilestoneTaskStats(ctx.userId, [jalon.id]))[jalon.id];
    const aFaire = stats ? stats.total - stats.done : 0;
    if (aFaire > 0) changements.push({ libelle: `${pluriel(aFaire, "tâche")} du jalon non faite${aFaire > 1 ? "s" : ""}`, avant: "à faire", apres: "cochées" });
    return {
      resume: `Confirmer le jalon « ${jalon.title} »`,
      changements,
      empreinte: [{ table: "project_milestones", id: jalon.id, champs: { status: jalon.status } }],
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    try {
      // Aucune tâche n'est créée : confirmMilestone coche et débloque les tâches existantes.
      const r = await confirmerJalon(ctx.userId, args.jalonId);
      if (!r.ok) bilan.echecs.push(`Jalon n° ${args.jalonId} : introuvable`);
      else if (!r.jalon) bilan.echecs.push(`Jalon n° ${args.jalonId} : confirmation impossible`);
      else bilan.reussis.push(`Jalon « ${r.jalon.title} » confirmé`);
    } catch (e: any) {
      console.error("[agent] confirmation de jalon :", e?.message ?? e);
      bilan.echecs.push(`Jalon n° ${args.jalonId} : erreur imprévue`);
    }
    return bilan;
  },
});

// ── saisir_mesure ──────────────────────────────────────────────────────────────────────

const CHAMPS_MESURE: Record<string, string> = {
  ca: "Chiffre d'affaires", caNouveaux: "CA des nouveaux clients", nouveauxClients: "Nouveaux clients",
  commandes: "Commandes", coutsVariables: "Coûts variables",
};

const nombre = (v: unknown): string | null =>
  typeof v === "number" ? new Intl.NumberFormat("fr-FR").format(v) : null;

const saisirMesure = outilAValider<{ projetId: number; mois: string; champs: Record<string, unknown> }>({
  nom: "saisir_mesure",
  description:
    "Propose de compléter un mois du registre de mesure d'un projet : seuls les chiffres donnés sont " +
    "écrits, les autres restent. Rien n'est fait avant que l'utilisatrice valide.",
  schema: {
    type: "object",
    properties: {
      projetId: { type: "integer", description: "Id du projet." },
      mois: { type: "string", description: "Mois, AAAA-MM (pas dans le futur)." },
      champs: {
        type: "object",
        description: "Les chiffres du mois.",
        properties: {
          ca: { type: "number", description: "Chiffre d'affaires." },
          caNouveaux: { type: "number", description: "CA réalisé avec les nouveaux clients." },
          nouveauxClients: { type: "integer", description: "Nombre de nouveaux clients." },
          commandes: { type: "integer", description: "Nombre de commandes." },
          coutsVariables: { type: "number", description: "Coûts variables." },
          depenses: { type: "object", description: `Dépenses par canal : ${CLES_CANAUX.join(", ")}.` },
        },
      },
    },
    required: ["projetId", "mois", "champs"],
  },
  async apercu(ctx, args) {
    const projet = Number.isInteger(args.projetId) && args.projetId > 0 ? await storage.getProject(args.projetId, ctx.userId) : undefined;
    if (!projet) return erreur("introuvable");
    if (!moisValide(args.mois, ctx.maintenant)) return erreur("mois_invalide");
    const existant = await lireMoisMesure(ctx.userId, projet.id, args.mois);
    const v = completerMois(existant as any, args.champs);
    if (!v.ok) return erreur(v.erreur);

    const changements: Changement[] = [];
    for (const [champ, libelle] of Object.entries(CHAMPS_MESURE)) {
      const avant = (existant as any)?.[champ] ?? null;
      const apres = (v.valeur as any)[champ];
      if (!memeValeur(avant, apres)) changements.push({ libelle, avant: nombre(avant), apres: nombre(apres) });
    }
    const depensesAvant = ((existant as any)?.depenses ?? {}) as Record<string, number>;
    for (const [canal, montant] of Object.entries(v.valeur.depenses)) {
      if (!memeValeur(depensesAvant[canal], montant)) {
        changements.push({ libelle: `Dépenses ${canal}`, avant: nombre(depensesAvant[canal]), apres: nombre(montant) });
      }
    }
    if (!changements.length) return erreur("rien ne change : ces chiffres sont déjà enregistrés");

    const champs: Record<string, unknown> = { mois: args.mois, id: existant?.id ?? null, depenses: existant?.depenses ?? null };
    for (const c of Object.keys(CHAMPS_MESURE)) champs[c] = (existant as any)?.[c] ?? null;
    const apercu: Apercu = {
      resume: `Compléter ${args.mois} pour « ${projet.name} »`,
      changements,
      empreinte: [{ table: "mesures_mensuelles", id: projet.id, champs }],
    };
    return apercu;
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    try {
      const r = await completerMesure(ctx.userId, args.projetId, args.mois, args.champs);
      if (r.ok) bilan.reussis.push(`Mesure de ${args.mois} complétée`);
      else bilan.echecs.push(`Mesure de ${args.mois} : ${r.status === 404 ? "projet introuvable" : r.message}`);
    } catch (e: any) {
      console.error("[agent] saisie de mesure :", e?.message ?? e);
      bilan.echecs.push(`Mesure de ${args.mois} : erreur imprévue`);
    }
    return bilan;
  },
});

export const OUTILS_A_VALIDER: OutilPropose[] = [
  deplacerTaches, decalerJournee, supprimerTaches,
  creerProjetOutil, creerJalons, confirmerJalonOutil, saisirMesure,
];
