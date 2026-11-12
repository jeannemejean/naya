// La création, version Naya (spec §8, point 6) : alerte par compte actif sans rien de prévu sur
// 7 jours, posts à valider dans les 3 jours (lien vers l'atelier), phases de campagne non
// validées qui commencent dans les 7 jours, et rituels de création rattachés à l'objectif de
// visibilité du projet (testés dans ritual-materialize.test.ts). Toutes les dépendances sont
// injectées : aucun test ne touche une vraie base, l'IA ni le réseau. creation.ts n'importe ni la
// base ni le stockage.
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  suiviCreation, debutsDesPhases, suiviCreationEnCache, viderCacheCreation, chargerSuiviCreation,
  CACHE_CREATION_MS, type CampagneCreation, type CompteCreation, type PostCreation, type DepsCreation,
} from "./creation";

const JOUR_MS = 24 * 3600_000;
const MAINTENANT = new Date("2026-11-12T08:00:00Z"); // jeudi
const dans = (j: number) => new Date(MAINTENANT.getTime() + j * JOUR_MS);
const ilYa = (j: number) => new Date(MAINTENANT.getTime() - j * JOUR_MS);

const INSTA: CompteCreation = { id: 1, platform: "instagram", nom: "Encore Merci", projectId: null };
const LINKEDIN: CompteCreation = { id: 2, platform: "linkedin", nom: "Jeanne Méjean", projectId: null };

const post = (extra: Partial<PostCreation>): PostCreation => ({
  id: 1, title: "Recette du lundi", platform: "instagram", socialAccountId: 1, scheduledFor: null, publishedAt: null,
  postStatus: null, contentStatus: "ready", autoPost: true, consigne: null, campaignId: null, body: "Texte", portee: null,
  ...extra,
});

describe("suiviCreation : alertes par compte actif", () => {
  it("compte actif sans aucun post dans les 7 jours : une alerte", () => {
    const r = suiviCreation([], [INSTA], [], MAINTENANT);
    expect(r.alertes).toEqual(["Rien de prévu sur Instagram (Encore Merci) dans les 7 prochains jours."]);
  });

  it("post publié hier et rien de prévu : une alerte quand même (la fenêtre regarde devant)", () => {
    const publie = post({ publishedAt: ilYa(1), scheduledFor: ilYa(1), postStatus: "posted" });
    expect(suiviCreation([publie], [INSTA], [], MAINTENANT).alertes).toHaveLength(1);
  });

  it("un post prévu dans 5 jours couvre son compte, pas l'autre ; un post en échec ne couvre rien", () => {
    const prevu = post({ scheduledFor: dans(5) });
    expect(suiviCreation([prevu], [INSTA, LINKEDIN], [], MAINTENANT).alertes)
      .toEqual(["Rien de prévu sur LinkedIn (Jeanne Méjean) dans les 7 prochains jours."]);
    const echec = post({ scheduledFor: dans(2), postStatus: "failed" });
    expect(suiviCreation([echec], [INSTA], [], MAINTENANT).alertes).toHaveLength(1);
    // Au-delà de 7 jours : pas couvert.
    expect(suiviCreation([post({ scheduledFor: dans(8) })], [INSTA], [], MAINTENANT).alertes).toHaveLength(1);
  });

  it("portée : un post sans compte désigné ne couvre que les comptes de sa portée (mode agence)", () => {
    const client: CompteCreation = { id: 3, platform: "instagram", nom: "Garance", projectId: 50 };
    const postClient = post({ socialAccountId: null, scheduledFor: dans(2), portee: 50 });
    const r = suiviCreation([postClient], [INSTA, client], [], MAINTENANT);
    expect(r.alertes).toEqual(["Rien de prévu sur Instagram (Encore Merci) dans les 7 prochains jours."]);
  });
});

describe("suiviCreation : posts à valider", () => {
  it("brouillon prévu après-demain : présent dans aValider, avec le lien de l'atelier de sa semaine", () => {
    const brouillon = post({ id: 7, title: "Encore Merci : la tarte", scheduledFor: dans(2), contentStatus: "draft", autoPost: false });
    const r = suiviCreation([brouillon], [INSTA], [], MAINTENANT);
    // Samedi 14 novembre 2026 : l'atelier de la semaine du lundi 9.
    expect(r.aValider).toEqual([{ libelle: "À valider : « Encore Merci : la tarte » (Instagram, samedi 14 novembre)", lien: "/atelier?semaine=2026-11-09" }]);
  });

  it("à rédiger compris (post proposé par la présence), validé, publié ou trop loin exclus", () => {
    const presence = post({ id: 8, title: "Proposition", scheduledFor: dans(1), contentStatus: "idea", autoPost: false, body: "", consigne: null, campaignId: 4 });
    const valide = post({ id: 9, scheduledFor: dans(1), contentStatus: "ready" });
    const loin = post({ id: 10, scheduledFor: dans(5), contentStatus: "draft", autoPost: false });
    const publie = post({ id: 11, scheduledFor: dans(1), publishedAt: dans(1), contentStatus: "draft", autoPost: false });
    const r = suiviCreation([loin, valide, presence, publie], [INSTA], [], MAINTENANT);
    expect(r.aValider.map((x) => x.libelle)).toEqual(["À rédiger : « Proposition » (Instagram, vendredi 13 novembre)"]);
  });

  it("brouillon prévu plus tôt aujourd'hui (en retard) : visible ; prévu hier : non", () => {
    const retard = post({ id: 13, title: "Retard", scheduledFor: new Date("2026-11-12T06:00:00Z"), contentStatus: "draft", autoPost: false });
    const hier = post({ id: 14, title: "Hier", scheduledFor: new Date("2026-11-11T20:00:00Z"), contentStatus: "draft", autoPost: false });
    expect(suiviCreation([retard, hier], [INSTA], [], MAINTENANT).aValider.map((x) => x.libelle))
      .toEqual(["À valider : « Retard » (Instagram, jeudi 12 novembre)"]);
  });

  it("post `origine='presence'` avec sa consigne : brouillon, donc à valider", () => {
    const p = post({ id: 12, title: "Coulisses", scheduledFor: dans(1), contentStatus: "idea", autoPost: false, body: "", consigne: "Angle coulisses" });
    expect(suiviCreation([p], [INSTA], [], MAINTENANT).aValider).toHaveLength(1);
  });
});

// Forme RÉELLE de `campaigns.phases` (jsonb), figée ici : écrite par la génération de campagne
// (openai.ts, GeneratedCampaign.phases : CampaignPhase[]) et lue par computePhaseRanges
// (campagne/placement.ts). Aucune date ni aucun drapeau de validation par phase : le début se
// calcule depuis `startDate` et `duration` (découpage de computePhaseRanges), et une phase est
// validée quand sa campagne est lancée (statut ≠ draft, /api/campaigns/:id/launch).
const PHASES = [
  { number: 1, name: "Fondations", duration: "Weeks 1-2", objective: "Poser le message", keyActions: ["a", "b", "c"], successSignal: "x" },
  { number: 2, name: "Accélération", duration: "Weeks 3-4", objective: "Diffuser", keyActions: ["a", "b", "c"], successSignal: "y" },
  { number: 3, name: "Conversion", duration: "Weeks 5-6", objective: "Convertir", keyActions: ["a", "b", "c"], successSignal: "z" },
];
const campagne = (extra: Partial<CampagneCreation>): CampagneCreation => ({
  id: 4, name: "Campagne 360", status: "draft", startDate: "2026-11-15", duration: "1_month", phases: PHASES, ...extra,
});

describe("suiviCreation : phases de campagne", () => {
  it("débuts des phases : même découpage que computePhaseRanges (30 jours / 3 phases = 10 jours)", () => {
    expect(debutsDesPhases(campagne({}))).toEqual([
      { numero: 1, nom: "Fondations", debut: "2026-11-15", finCampagne: "2026-12-14" },
      { numero: 2, nom: "Accélération", debut: "2026-11-25", finCampagne: "2026-12-14" },
      { numero: 3, nom: "Conversion", debut: "2026-12-05", finCampagne: "2026-12-14" },
    ]);
    // Sans date de début, ou sans phases lisibles : rien.
    expect(debutsDesPhases(campagne({ startDate: null }))).toEqual([]);
    expect(debutsDesPhases(campagne({ phases: "n'importe quoi" }))).toEqual([]);
  });

  it("phase d'une campagne non lancée qui commence dans les 7 jours : à valider ; lancée ou trop loin : rien", () => {
    const r = suiviCreation([], [], [campagne({}), campagne({ id: 5, name: "Lancée", status: "active" })], MAINTENANT);
    expect(r.aValider).toEqual([{
      libelle: "Campagne « Campagne 360 » : la phase « Fondations » commence le dimanche 15 novembre, campagne pas encore lancée",
      lien: "/campaigns",
    }]);
    // Campagne commencée il y a 10 jours, jamais lancée : la phase 2 commence aujourd'hui.
    const r2 = suiviCreation([], [], [campagne({ startDate: "2026-11-02" })], MAINTENANT);
    expect(r2.aValider.map((x) => x.libelle)).toEqual([
      "Campagne « Campagne 360 » : la phase « Accélération » commence le jeudi 12 novembre, campagne pas encore lancée",
    ]);
    expect(suiviCreation([], [], [campagne({ startDate: "2026-12-01" })], MAINTENANT).aValider).toEqual([]);
  });

  it("campagne non lancée déjà finie : ignorée (même si une phase « commence » dans la fenêtre)", () => {
    // 1 semaine pour 10 phases (computePhaseRanges : 1 jour chacune, la campagne finit au 7e) :
    // partie le 3 nov., finie le 9 ; la phase 10 « commencerait » le 12, aujourd'hui.
    const phases10 = Array.from({ length: 10 }, (_, i) => ({ ...PHASES[0], number: i + 1, name: `P${i + 1}` }));
    expect(debutsDesPhases(campagne({ startDate: "2026-11-03", duration: "1_week", phases: phases10 }))[9])
      .toMatchObject({ debut: "2026-11-12", finCampagne: "2026-11-09" });
    expect(suiviCreation([], [], [campagne({ startDate: "2026-11-03", duration: "1_week", phases: phases10 })], MAINTENANT).aValider).toEqual([]);
    const phases7 = phases10.slice(0, 7);
    // Encore en cours (finit le 18 nov.) : la phase 7 commence le 18, dans la fenêtre.
    expect(suiviCreation([], [], [campagne({ startDate: "2026-11-12", duration: "1_week", phases: phases7 })], MAINTENANT).aValider).toHaveLength(7);
  });
});

describe("chargerSuiviCreation et cache", () => {
  const deps = (over: Partial<DepsCreation> = {}): DepsCreation => ({
    comptesActifs: vi.fn(async () => [INSTA]),
    posts: vi.fn(async () => []),
    campagnes: vi.fn(async () => []),
    ...over,
  });

  beforeEach(() => viderCacheCreation());

  it("lit les sources sur [maintenant, +7 jours] et rend le suivi", async () => {
    const d = deps();
    const r = await chargerSuiviCreation("u1", MAINTENANT, d);
    expect(r.alertes).toHaveLength(1);
    // Depuis minuit à Paris (08:00Z = 09:00 Paris → 23:00Z la veille).
    expect(d.posts).toHaveBeenCalledWith("u1", new Date("2026-11-11T23:00:00Z"), dans(7));
  });

  it("gardé 20 min par utilisatrice et par jour ; un échec n'est pas gardé", async () => {
    const calculer = vi.fn(async () => ({ alertes: ["a"], aValider: [] }));
    await suiviCreationEnCache("u1", MAINTENANT, calculer);
    await suiviCreationEnCache("u1", new Date(MAINTENANT.getTime() + CACHE_CREATION_MS - 1), calculer);
    expect(calculer).toHaveBeenCalledTimes(1);
    await suiviCreationEnCache("u1", new Date(MAINTENANT.getTime() + CACHE_CREATION_MS), calculer);
    expect(calculer).toHaveBeenCalledTimes(2);

    viderCacheCreation();
    const plante = vi.fn().mockRejectedValueOnce(new Error("base")).mockResolvedValue({ alertes: [], aValider: [] });
    await expect(suiviCreationEnCache("u2", MAINTENANT, plante)).rejects.toThrow("base");
    await suiviCreationEnCache("u2", MAINTENANT, plante);
    expect(plante).toHaveBeenCalledTimes(2);
  });
});
