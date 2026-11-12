// Cadence de présence (spec §5) : seuil lu dans la bande passante de contenu, état de la présence
// par compte actif, et posts proposés à l'atelier. Toutes les dépendances (base, IA, placement)
// sont injectées : aucun test ne touche une vraie base ni le réseau.
import { describe, it, expect, vi } from "vitest";
import {
  seuilPresenceJours, postsParSemaine, etatPresence, proposerPostsPresence, ordonnerComptes, type DepsPresence,
} from "./presence";
import { filtrerTachesGenerees } from "../filtre-taches-generees";

const JOUR_MS = 24 * 3600_000;
const MAINTENANT = new Date("2026-11-12T06:00:00Z"); // jeudi
const ilYa = (j: number) => new Date(MAINTENANT.getTime() - j * JOUR_MS);
const dans = (j: number) => new Date(MAINTENANT.getTime() + j * JOUR_MS);

describe("seuilPresenceJours", () => {
  it("lit un rythme dans le texte libre : ceil(7 / posts par semaine), borné à [2, 14]", () => {
    expect(seuilPresenceJours("2 posts par semaine", null)).toBe(4);
    expect(seuilPresenceJours("quotidien", null)).toBe(2);
    expect(seuilPresenceJours("1 par mois", null)).toBe(14);
    expect(seuilPresenceJours("1/mois", null)).toBe(14);
    expect(seuilPresenceJours("3x/semaine", null)).toBe(3);
    expect(seuilPresenceJours("une fois par semaine", null)).toBe(7);
    expect(seuilPresenceJours("2 à 3 posts par semaine", "LinkedIn")).toBe(4);
  });

  it("un intervalle (« tous les N jours », « toutes les N semaines ») n'est pas un nombre par période", () => {
    expect(postsParSemaine("toutes les 2 semaines")).toBe(0.5);
    expect(seuilPresenceJours("toutes les 2 semaines", null)).toBe(14);
    expect(seuilPresenceJours("un post tous les 3 jours", null)).toBe(3);
    expect(seuilPresenceJours("tous les 15 jours", null)).toBe(14);
    expect(seuilPresenceJours("every 2 weeks", null)).toBe(14);
    // Des posts PAR jour restent un rythme quotidien.
    expect(seuilPresenceJours("2 posts tous les jours", null)).toBe(2);
  });

  it("« 3 jours par semaine » n'est pas un nombre de posts", () => {
    expect(postsParSemaine("3 jours par semaine")).toBeNull();
    expect(seuilPresenceJours("3 jours par semaine", null)).toBe(7);
    expect(seuilPresenceJours("je bloque 3 jours par semaine, 2 posts par semaine", null)).toBe(4);
  });

  it("sans rythme lisible : 7", () => {
    expect(seuilPresenceJours(null, null)).toBe(7);
    expect(seuilPresenceJours("je ne sais pas", null)).toBe(7);
    expect(seuilPresenceJours("", "Instagram")).toBe(7);
  });

  it("les choix de l'onboarding (minimal, light, moderate, active)", () => {
    expect(seuilPresenceJours("minimal", null)).toBe(10);
    expect(seuilPresenceJours("light", null)).toBe(7);
    expect(seuilPresenceJours("moderate", null)).toBe(3);
    expect(seuilPresenceJours("active", null)).toBe(2);
    expect(seuilPresenceJours("building-a-system", null)).toBe(7);
  });

  it("platformPriority ne change pas le seuil", () => {
    expect(seuilPresenceJours("2 posts par semaine", "Instagram puis LinkedIn")).toBe(4);
  });
});

describe("ordonnerComptes", () => {
  it("range les comptes selon l'ordre de platformPriority, les autres ensuite", () => {
    const comptes = [{ id: 1, platform: "instagram" }, { id: 2, platform: "linkedin" }, { id: 3, platform: "tiktok" }];
    expect(ordonnerComptes(comptes, "LinkedIn d'abord, puis Instagram").map((c) => c.id)).toEqual([2, 1, 3]);
    expect(ordonnerComptes(comptes, null).map((c) => c.id)).toEqual([1, 2, 3]);
  });
});

describe("etatPresence", () => {
  const linkedin = { id: 5, platform: "linkedin" };
  const post = (over: any) => ({
    publishedAt: null, scheduledFor: null, socialAccountId: null, platform: "linkedin", contentStatus: "idea", postStatus: "pending", ...over,
  });

  it("un post programmé mais pas publié il y a 10 jours ne compte pas comme publié", () => {
    const e = etatPresence([post({ scheduledFor: ilYa(10), contentStatus: "ready" })], [linkedin], 7, MAINTENANT);
    expect(e).toEqual({ aProposer: true, plateforme: "linkedin", joursDepuisDernier: null });
  });

  it("un post publié dans la fenêtre : rien à proposer ; joursDepuisDernier compté depuis la publication", () => {
    const e = etatPresence([post({ scheduledFor: ilYa(3), publishedAt: ilYa(3), postStatus: "posted" })], [linkedin], 7, MAINTENANT);
    expect(e).toEqual({ aProposer: false, plateforme: null, joursDepuisDernier: 3 });
  });

  it("un post publié il y a 9 jours, seuil 7, rien de prévu : à proposer", () => {
    const e = etatPresence([post({ publishedAt: ilYa(9), postStatus: "posted" })], [linkedin], 7, MAINTENANT);
    expect(e).toEqual({ aProposer: true, plateforme: "linkedin", joursDepuisDernier: 9 });
  });

  it("une campagne qui a des posts prévus dans la fenêtre : aProposer faux", () => {
    const campagne = [post({ scheduledFor: dans(3), contentStatus: "idea" }), post({ scheduledFor: dans(9) })];
    expect(etatPresence(campagne, [linkedin], 7, MAINTENANT).aProposer).toBe(false);
  });

  it("un post prévu au-delà de la fenêtre ne suffit pas", () => {
    expect(etatPresence([post({ scheduledFor: dans(9) })], [linkedin], 7, MAINTENANT).aProposer).toBe(true);
  });

  it("par compte : le compte relié au post par socialAccountId, sinon par plateforme", () => {
    const insta = { id: 6, platform: "instagram" };
    // LinkedIn est couvert (post prévu), Instagram ne l'est pas : on propose pour Instagram.
    const e = etatPresence([post({ scheduledFor: dans(2), platform: "LinkedIn" })], [linkedin, insta], 7, MAINTENANT);
    expect(e).toMatchObject({ aProposer: true, plateforme: "instagram" });
    // Un post rattaché à un autre compte LinkedIn ne couvre pas celui-ci.
    const autre = etatPresence([post({ scheduledFor: dans(2), socialAccountId: 99 })], [linkedin], 7, MAINTENANT);
    expect(autre.aProposer).toBe(true);
  });

  it("un post en échec de publication n'est pas prévu", () => {
    expect(etatPresence([post({ scheduledFor: dans(2), postStatus: "failed" })], [linkedin], 7, MAINTENANT).aProposer).toBe(true);
  });

  it("aucun compte actif : rien à proposer", () => {
    expect(etatPresence([], [], 7, MAINTENANT)).toEqual({ aProposer: false, plateforme: null, joursDepuisDernier: null });
  });
});

// ── proposerPostsPresence ──────────────────────────────────────────────────────────────

function fabrique(over: Partial<DepsPresence> = {}) {
  const base: any[] = [];
  let n = 100;
  const reponse = JSON.stringify({ posts: [
    { titre: "Ce qu'on a appris en lançant IN SCENA", consigne: "Raconter la première semaine de lancement", plateforme: "linkedin", pilier: "Coulisses" },
    { titre: "Le mythe du post viral", consigne: "Démonter l'idée qu'un post viral fait un client", plateforme: "LinkedIn", pilier: "Expertise" },
  ] });
  const deps: DepsPresence & { base: any[] } = {
    base,
    adn: vi.fn(async () => ({ contentBandwidth: "2 posts par semaine", platformPriority: "LinkedIn", contentPillars: ["Coulisses", "Expertise"] })),
    projetVisibilite: vi.fn(async () => 9),
    comptesActifs: vi.fn(async () => [{ id: 5, platform: "linkedin" }]),
    postsEntre: vi.fn(async () => base),
    propositionsEnAttente: vi.fn(async (_u: string, debut: Date, fin: Date) => base.filter((p) =>
      p.origine === "presence" && !p.publishedAt && (p.createdAt >= debut || (p.scheduledFor >= debut && p.scheduledFor <= fin))).length),
    estTravaille: vi.fn(async () => (j: string) => ![0, 6].includes(new Date(`${j}T12:00:00Z`).getUTCDay())),
    iaBloquee: vi.fn(async () => false),
    ia: vi.fn(async () => reponse),
    creerPost: vi.fn(async (v: any) => { const p = { id: ++n, createdAt: MAINTENANT, ...v }; base.push(p); return p; }),
    placer: vi.fn(async () => ({ creees: 1 })),
    ...over,
  };
  return deps;
}

describe("proposerPostsPresence", () => {
  it("crée 1 à 3 posts origine presence, sans campagne, consigne posée, sur les prochains jours travaillés, puis place l'atelier", async () => {
    const deps = fabrique();
    const r = await proposerPostsPresence("u", MAINTENANT, deps);
    expect(r).toEqual({ crees: 2 });
    const crees = (deps.creerPost as any).mock.calls.map(([v]: any[]) => v);
    expect(crees.map((v: any) => v.scheduledFor.toISOString())).toEqual(["2026-11-13T08:00:00.000Z", "2026-11-16T08:00:00.000Z"]);
    for (const v of crees) {
      expect(v).toMatchObject({
        userId: "u", projectId: 9, origine: "presence", campaignId: null, autoPost: false, platform: "linkedin",
        socialAccountId: 5, body: "", contentStatus: "idea", publishedAt: null,
      });
      expect(v.consigne.length).toBeGreaterThan(0);
    }
    expect(crees[1].platform).toBe("linkedin"); // « LinkedIn » renvoyé par l'IA, ramené au compte
    expect(crees.map((v: any) => v.pillar)).toEqual(["Coulisses", "Expertise"]);
    expect(deps.placer).toHaveBeenCalledTimes(1);
    expect((deps.placer as any).mock.calls[0][1].map((p: any) => p.id)).toEqual([101, 102]);
    // L'IA reçoit les piliers et la plateforme.
    const prompt = (deps.ia as any).mock.calls[0][2] as string;
    expect(prompt).toContain("Coulisses");
    expect(prompt).toContain("linkedin");
  });

  it("aucun post créé n'a autoPost: true", async () => {
    const deps = fabrique({ ia: vi.fn(async () => JSON.stringify({ posts: [
      { titre: "A", consigne: "a", plateforme: "linkedin", pilier: "x", autoPost: true },
      { titre: "B", consigne: "b", plateforme: "linkedin", pilier: "y" },
      { titre: "C", consigne: "c", plateforme: "linkedin", pilier: "z" },
    ] })) });
    await proposerPostsPresence("u", MAINTENANT, deps);
    const crees = (deps.creerPost as any).mock.calls.map(([v]: any[]) => v);
    expect(crees).toHaveLength(3);
    expect(crees.every((v: any) => v.autoPost === false)).toBe(true);
  });

  it("lancé deux fois le même jour : un seul lot", async () => {
    const deps = fabrique();
    const a = await proposerPostsPresence("u", MAINTENANT, deps);
    const b = await proposerPostsPresence("u", new Date(MAINTENANT.getTime() + 3 * 3600_000), deps);
    expect(a.crees).toBe(2);
    expect(b.crees).toBe(0);
    expect(deps.ia).toHaveBeenCalledTimes(1);
    expect(deps.base).toHaveLength(2);
  });

  it("deux passages simultanés : un seul lot", async () => {
    const deps = fabrique();
    const [a, b] = await Promise.all([proposerPostsPresence("u", MAINTENANT, deps), proposerPostsPresence("u", MAINTENANT, deps)]);
    expect(a.crees + b.crees).toBe(2);
    expect(deps.ia).toHaveBeenCalledTimes(1);
  });

  it("anti-doublon : un post presence non publié dans la fenêtre bloque, même hors du compte", async () => {
    const deps = fabrique();
    deps.base.push({ id: 1, origine: "presence", publishedAt: null, createdAt: ilYa(2), scheduledFor: ilYa(1), platform: "instagram" });
    expect(await proposerPostsPresence("u", MAINTENANT, deps)).toEqual({ crees: 0 });
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("une présence assurée (post prévu) : aucun appel IA", async () => {
    const deps = fabrique();
    deps.base.push({ id: 1, campaignId: 3, publishedAt: null, scheduledFor: dans(2), platform: "linkedin", postStatus: "pending" });
    expect(await proposerPostsPresence("u", MAINTENANT, deps)).toEqual({ crees: 0 });
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("IA bloquée (plafond) : rien, sans appel", async () => {
    const deps = fabrique({ iaBloquee: vi.fn(async () => true) });
    expect(await proposerPostsPresence("u", MAINTENANT, deps)).toEqual({ crees: 0 });
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("jour non travaillé : rien (le prochain matin travaillé s'en charge)", async () => {
    const deps = fabrique();
    expect(await proposerPostsPresence("u", new Date("2026-11-14T06:00:00Z"), deps)).toEqual({ crees: 0 });
    expect(deps.ia).not.toHaveBeenCalled();
  });

  it("sortie IA invalide deux fois : rien n'est créé", async () => {
    const deps = fabrique({ ia: vi.fn(async () => "pas du JSON") });
    expect(await proposerPostsPresence("u", MAINTENANT, deps)).toEqual({ crees: 0 });
    expect(deps.ia).toHaveBeenCalledTimes(2);
    expect(deps.creerPost).not.toHaveBeenCalled();
  });

  it("une plateforme inconnue renvoyée par l'IA retombe sur celle à couvrir", async () => {
    const deps = fabrique({ ia: vi.fn(async () => JSON.stringify({ posts: [{ titre: "A", consigne: "a", plateforme: "Snapchat", pilier: "x" }] })) });
    await proposerPostsPresence("u", MAINTENANT, deps);
    expect((deps.creerPost as any).mock.calls[0][0]).toMatchObject({ platform: "linkedin", socialAccountId: 5 });
  });
});

// Décision du 9 oct. 2026 intacte : la présence passe par l'atelier, jamais par le générateur.
describe("non-régression : le générateur générique ne crée toujours pas de contenu", () => {
  it("filtrerTachesGenerees retire « Écrire un post LinkedIn » venue de l'auto-planner", () => {
    const taches = [{ title: "Écrire un post LinkedIn", type: "planning" }, { title: "Préparer le devis Imetik", type: "admin" }];
    expect(filtrerTachesGenerees(taches, "auto-planner").map((t) => t.title)).toEqual(["Préparer le devis Imetik"]);
  });
});
