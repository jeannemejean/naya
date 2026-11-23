// Outils de l'agent pour l'option Vie perso (spec 2026-11-23 §10). Refusés à une utilisatrice
// sans l'option. Pas d'outil direct en V1 : ajouter une course passe par l'écran (l'annulation
// du journal ne sait pas encore défaire une ligne de vie_perso_plans).
import { ajouterJours, lundiDe, type Fenetre } from "@shared/vie-perso";
import type { Outil } from "../registre";
import { outilAValider, type BilanExecution, type OutilPropose } from "../propositions";

const erreur = (message: string) => ({ erreur: message });
const JOUR = /^\d{4}-\d{2}-\d{2}$/;

async function charger() {
  const [{ depsViePerso, storeViePerso, viePersoActivePour }, service] = await Promise.all([
    import("../../vie-perso/deps"), import("../../vie-perso/service"),
  ]);
  return { deps: depsViePerso, store: storeViePerso, active: viePersoActivePour, service };
}

const aujourdhuiParis = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const consulterViePerso: Outil = {
  nom: "consulter_vie_perso",
  classe: "lecture",
  description: "Lit la vie perso (option) : repas de cette semaine et de la suivante, courses non cochées, activités perso et leur état.",
  schema: { type: "object", properties: {} },
  async executer(ctx) {
    const x = await charger();
    if (!x.active(ctx.userId)) return { pourModele: erreur("option Vie perso inactive") };
    const lundi = lundiDe(aujourdhuiParis(ctx.maintenant));
    const semaines = [lundi, ajouterJours(lundi, 7)];
    const plans = await Promise.all(semaines.map((s) => x.deps.lirePlan(ctx.userId, s)));
    const activites = await x.store.listerActivites(ctx.userId);
    return {
      pourModele: {
        semaines: semaines.map((s, i) => {
          const p = plans[i];
          if (!p) return { semaine: s, plan: null };
          const coches = new Set(p.coches);
          return {
            semaine: s, statut: p.statut,
            repas: p.contenu.jours.map((j) => ({ date: j.date, dejeuner: j.dejeuner?.titre ?? null, diner: j.diner?.titre ?? null, dessert: j.dessert?.titre ?? null })),
            coursesRestantes: p.contenu.courses.filter((_, k) => !coches.has(k)).map((c) => `${c.article} (${c.quantite}) · ${c.magasin}`),
          };
        }),
        activites: activites.map((a) => ({ id: a.id, titre: a.titre, quand: a.quand, statut: a.statut, dateCible: a.dateCible })),
      },
    };
  },
};

interface ArgsSemaine { semaine?: string }

export const preparerRepasSemaine: OutilPropose = outilAValider<ArgsSemaine>({
  nom: "preparer_repas_semaine",
  description: "Propose de préparer (ou refaire) le plan de repas d'une semaine : repas du foyer, batch cooking, liste de courses. Le plan reste un brouillon à valider dans Vie perso.",
  schema: {
    type: "object",
    properties: { semaine: { type: "string", description: "Un jour de la semaine visée, AAAA-MM-JJ (par défaut : la semaine prochaine)." } },
  },
  async apercu(ctx, args) {
    const x = await charger();
    if (!x.active(ctx.userId)) return erreur("option Vie perso inactive");
    if (args.semaine != null && (typeof args.semaine !== "string" || !JOUR.test(args.semaine))) return erreur("semaine doit être AAAA-MM-JJ");
    const semaine = lundiDe(args.semaine ?? ajouterJours(aujourdhuiParis(ctx.maintenant), 7));
    const actuel = await x.deps.lirePlan(ctx.userId, semaine);
    return {
      resume: `Préparer les repas de la semaine du ${semaine}`,
      changements: [{ libelle: `Plan de repas (semaine du ${semaine})`, avant: actuel ? `plan ${actuel.statut}` : null, apres: "nouveau brouillon" }],
      empreinte: [],
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    const x = await charger();
    const semaine = lundiDe(args.semaine ?? ajouterJours(aujourdhuiParis(ctx.maintenant), 7));
    // Une à deux minutes : lancée en arrière-plan, le plan apparaît dans Vie perso.
    x.service.preparerPlan(ctx.userId, semaine, x.deps).catch((e: any) => console.error("[agent] repas de la semaine :", e?.message ?? e));
    bilan.reussis.push(`Préparation des repas de la semaine du ${semaine} lancée : le brouillon sera dans Vie perso d'ici deux minutes`);
    return bilan;
  },
});

interface ArgsActivite { titre: string; description?: string; avecQui?: string; quand?: Fenetre; dateCible?: string }

export const planifierActiviteOutil: OutilPropose = outilAValider<ArgsActivite>({
  nom: "planifier_activite",
  description: "Propose d'ajouter une activité perso (loisir, bricolage, projet de Noël…) : Naya la découpe en achats et étapes et les place dans les soirées ou week-ends.",
  schema: {
    type: "object",
    properties: {
      titre: { type: "string", description: "L'activité, en quelques mots." },
      description: { type: "string", description: "Détails utiles." },
      avecQui: { type: "string", description: "Avec qui (vide : seule)." },
      quand: { type: "string", enum: ["soir", "weekend", "indifferent"] },
      dateCible: { type: "string", description: "À finir avant, AAAA-MM-JJ." },
    },
    required: ["titre"],
  },
  async apercu(ctx, args) {
    const x = await charger();
    if (!x.active(ctx.userId)) return erreur("option Vie perso inactive");
    const titre = typeof args.titre === "string" ? args.titre.trim() : "";
    if (!titre || titre.length > 160) return erreur("titre vide ou trop long");
    if (args.dateCible != null && (typeof args.dateCible !== "string" || !JOUR.test(args.dateCible))) return erreur("dateCible doit être AAAA-MM-JJ");
    if (args.quand != null && !["soir", "weekend", "indifferent"].includes(args.quand)) return erreur("quand invalide");
    return {
      resume: `Planifier « ${titre} »`,
      changements: [{ libelle: "Activité perso", avant: null, apres: [titre, args.avecQui, args.dateCible && `avant le ${args.dateCible}`].filter(Boolean).join(" · ") }],
      empreinte: [],
    };
  },
  async executer(ctx, args) {
    const bilan: BilanExecution = { reussis: [], echecs: [] };
    const x = await charger();
    try {
      const a = await x.store.ajouterActivite(ctx.userId, {
        titre: args.titre.trim(), description: (args.description ?? "").slice(0, 2000), avecQui: (args.avecQui ?? "").slice(0, 200),
        quand: args.quand ?? "indifferent", dateCible: args.dateCible ?? null,
      });
      const d = await x.service.decouperActivite(ctx.userId, a.id, x.deps);
      if (!d.ok) { bilan.echecs.push(`« ${a.titre} » : découpage impossible`); return bilan; }
      const p = await x.service.planifierActivite(ctx.userId, a.id, x.deps);
      if (!p.ok) { bilan.echecs.push(`« ${a.titre} » : ${p.erreur}`); return bilan; }
      bilan.reussis.push(`« ${a.titre} » : ${p.taches} moment${p.taches > 1 ? "s" : ""} placé${p.taches > 1 ? "s" : ""}`);
      if (p.nonPlacees.length) bilan.echecs.push(`Pas de place avant la date pour : ${p.nonPlacees.join(", ")}`);
    } catch (e: any) {
      console.error("[agent] activité perso :", e?.message ?? e);
      bilan.echecs.push(`« ${args.titre} » : erreur imprévue`);
    }
    return bilan;
  },
});
