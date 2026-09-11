import { describe, it, expect } from "vitest";
import { planDailySessions, isWithinAnySession, SESSIONS_MIN_PER_DAY, SESSIONS_MAX_PER_DAY } from "./prospection-sessions";

const FENETRE = {
  userWindowStart: new Date("2026-07-15T07:00:00.000Z"), // 9h Paris
  userWindowEnd: new Date("2026-07-15T16:00:00.000Z"),   // 18h Paris
  dateStr: "2026-07-15",
};

// Fenetres de reference utilisees par plusieurs tests ci-dessous, calculees a
// partir de targetWindowUTC (voir prospection-target-hours.test.ts pour les
// memes valeurs verifiees independamment) :
//  - HK (Asia/Hong_Kong, UTC+8, pas d'heure d'ete) : 09:00-18:00 locale =
//    01:00-10:00 UTC -> intersecte avec FENETRE = [07:00, 10:00) UTC.
//  - SN (Africa/Dakar, UTC+0, pas d'heure d'ete) : 09:00-18:00 locale =
//    09:00-18:00 UTC -> intersecte avec FENETRE = [09:00, 16:00) UTC.
// Les deux creneaux se recoupent sur [09:00,10:00) mais ont chacun une region
// SANS AMBIGUITE : avant 09:00 UTC, une session ne peut venir QUE du creneau
// HK ; a partir de 10:00 UTC, elle ne peut venir QUE du creneau SN.
const HK_ONLY_AVANT = Date.parse("2026-07-15T09:00:00.000Z");
const SN_ONLY_APRES = Date.parse("2026-07-15T10:00:00.000Z");

describe("planDailySessions", () => {
  it("est deterministe pour une meme graine", () => {
    const a = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 42 });
    const b = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 42 });
    expect(a.map((s) => s.start.toISOString())).toEqual(b.map((s) => s.start.toISOString()));
  });

  // NB : cette fonction ne prend pas le jour en paramètre séparé de `seed` — c'est
  // la graine, dérivée en amont (typiquement de la date), qui fait varier le
  // découpage d'un jour à l'autre. Le test ci-dessous vérifie donc directement la
  // propriété dont dépend "un jour différent" : graine différente => découpage
  // différent.
  it("produit un decoupage different pour une graine differente (la graine encode le jour)", () => {
    const j1 = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 1 });
    const j2 = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 2 });
    expect(j1.map((s) => s.start.toISOString())).not.toEqual(j2.map((s) => s.start.toISOString()));
  });

  it("produit entre 2 et 3 sessions", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 7 });
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s.length).toBeLessThanOrEqual(3);
  });

  it("place les sessions dans la fenetre de l'utilisatrice, jamais en dehors", () => {
    // US est volontairement inclus : sans ville, sa fenêtre pays (19h-22h UTC,
    // voir prospection-target-hours.test.ts) ne recoupe pas du tout la fenêtre de
    // l'utilisatrice (07h-16h UTC). Un bug qui oublierait de borner le créneau
    // pays par la fenêtre utilisatrice (Math.max/Math.min) laisserait passer un
    // créneau US brut, entièrement hors bornes — c'est précisément ce que cette
    // assertion ferait tomber.
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR", "US"], seed: 1 });
    for (const sess of s) {
      expect(sess.start.getTime()).toBeGreaterThanOrEqual(FENETRE.userWindowStart.getTime());
      expect(sess.end.getTime()).toBeLessThanOrEqual(FENETRE.userWindowEnd.getTime());
      expect(sess.end.getTime()).toBeGreaterThan(sess.start.getTime());
    }
  });

  it("couvre les fuseaux presents : une file dont le pays ouvre plus tard decale le dernier rendez-vous", () => {
    // ⚠️ Le brief original comparait FR à US. C'est infaisable avec cet input
    // (pas de ville) : targetWindowUTC("US", null, ...) rend 19h-22h UTC (repli
    // sur l'intersection des 29 fuseaux US, voir prospection-target-hours.ts /
    // .test.ts), qui ne recoupe JAMAIS la fenêtre 07h-16h UTC de FENETRE — une
    // file "US" seule produit donc TOUJOURS [] ici, quel que soit le seed, et
    // Math.max(...[].map(...)) est -Infinity : le test tel qu'écrit dans le
    // brief échoue nécessairement, il ne prouve rien sur la couverture des
    // fuseaux. On le remplace par SN (Africa/Dakar, UTC+0, pas d'heure d'été) :
    // sa fenêtre ouvrée locale (09h-18h UTC) recoupe bien 07h-16h UTC, mais
    // démarre 2h après celle de FR (07h-16h UTC, qui coïncide avec la fenêtre de
    // l'utilisatrice puisqu'elle est aussi à Paris — et se termine donc, comme
    // SN, exactement à la borne uEnd).
    //
    // Ce n'est pas qu'une observation empirique : c'est structurel. FR et SN
    // n'utilisant chacun qu'un seul créneau, la sélection pondérée le choisit
    // à coup sûr (aucune branche alternative à tirer), donc la SEULE source
    // d'aléa qui diffère entre les deux appels est le tirage du créneau
    // lui-même (immédiat, sans effet ici) — la fraction `r_i` tirée pour la
    // durée et pour la position de départ de la session i est donc IDENTIQUE
    // dans les deux appels (même graine, même séquence de tirages). Or la
    // longueur du créneau SN vaut exactement celle de FR moins 2h (creneau_fr
    // = [07:00,16:00], creneau_sn = [09:00,16:00]) : à durée tirée égale, la
    // marge de positionnement de SN est donc plus petite de 2h que celle de
    // FR, et son point de départ (cs_sn = cs_fr + 2h) est translaté d'autant.
    // Il en découle algébriquement start_sn(i) >= start_fr(i) - epsilon
    // d'arrondi entier pour CHAQUE session i appariée — donc en particulier
    // pour l'index du dernier rendez-vous. Vérifié strictement (>) sur les
    // seeds 1 à 50 avec cette implémentation ; la seule façon théorique
    // d'obtenir une égalité serait une coïncidence exacte d'arrondi flottant
    // sur une graine adverse, jamais rencontrée.
    const fr = planDailySessions({ ...FENETRE, pendingCountryCodes: ["FR"], seed: 5 });
    const sn = planDailySessions({ ...FENETRE, pendingCountryCodes: ["SN"], seed: 5 });
    expect(fr.length).toBeGreaterThan(0);
    expect(sn.length).toBeGreaterThan(0);
    const dernierFr = Math.max(...fr.map((s) => s.end.getTime()));
    const dernierSn = Math.max(...sn.map((s) => s.end.getTime()));
    expect(dernierSn).toBeGreaterThan(dernierFr);
  });

  it("ne produit aucune session quand la file est vide", () => {
    expect(planDailySessions({ ...FENETRE, pendingCountryCodes: [], seed: 9 })).toEqual([]);
  });

  it("ne produit aucune session quand aucune cible n'est joignable dans la fenetre", () => {
    // NZ : 9h-18h a Auckland (hiver, UTC+12, pas d'heure d'ete) ne croise pas
    // 9h-18h a Paris (2026-07-15 est un mercredi, donc jour ouvre cote NZ aussi —
    // ce n'est pas le controle "jour ouvre" qui rend [], c'est bien l'absence de
    // recoupement horaire).
    expect(planDailySessions({ ...FENETRE, pendingCountryCodes: ["NZ"], seed: 4 })).toEqual([]);
  });

  it("ignore un pays inconnu sans planter", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["ZZ", "FR"], seed: 6 });
    expect(s.length).toBeGreaterThanOrEqual(2);
  });

  // IMPORTANT 1 (revue) : aucun test precedent ne construisait une file avec deux
  // pays REELLEMENT joignables en meme temps (["FR","US"] et ["ZZ","FR"] retombent
  // tous les deux, en pratique, sur un seul creneau exploitable). Une mutation qui
  // desactive completement la rotation entre creneaux passait donc inapercue.
  // HK et SN sont ici tous les deux joignables ET ont des creneaux distincts (voir
  // les constantes en tete de fichier) : c'est le cas qui porte la raison d'etre
  // de la tache ("une file mixte obtient de la matinee ET de la fin d'apres-midi").
  it("une file avec deux pays reellement joignables et des creneaux distincts repartit les sessions entre les deux", () => {
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: ["HK", "SN"], seed: 2 });
    const avantHK = s.filter((x) => x.start.getTime() < HK_ONLY_AVANT);
    const apresSN = s.filter((x) => x.start.getTime() >= SN_ONLY_APRES);
    // Une session dans chaque region sans ambiguite : la preuve qu'aucune des deux
    // n'a ete ignoree par le placement.
    expect(avantHK.length).toBeGreaterThan(0);
    expect(apresSN.length).toBeGreaterThan(0);
  });

  // IMPORTANT 2 (revue) : sur une fenetre utilisatrice etroite, une duree de
  // session tiree au hasard (10-20 min) peut depasser un creneau pourtant valide
  // (>= 10 min) — l'ancien code sautait alors la session en silence, violant
  // l'invariant "2 a 3 sessions" documente (mesure : 193/200 graines produisaient
  // < 2 sessions sur ce meme scenario avant correction, voir task-4-report.md).
  // La duree est maintenant plafonnee a la taille du creneau qui l'accueille.
  it("respecte l'invariant 2 a 3 sessions meme sur une fenetre utilisatrice etroite (12 minutes)", () => {
    // 07:00-07:12 UTC est entierement a l'interieur du creneau FR (07:00-16:00) :
    // une cible y est joignable, la fenetre est juste trop etroite pour la duree
    // de session par defaut.
    const fenetreEtroite = {
      userWindowStart: new Date("2026-07-15T07:00:00.000Z"),
      userWindowEnd: new Date("2026-07-15T07:12:00.000Z"),
      dateStr: "2026-07-15",
    };
    const s = planDailySessions({ ...fenetreEtroite, pendingCountryCodes: ["FR"], seed: 1 });
    expect(s.length).toBeGreaterThanOrEqual(SESSIONS_MIN_PER_DAY);
    expect(s.length).toBeLessThanOrEqual(SESSIONS_MAX_PER_DAY);
    for (const sess of s) {
      expect(sess.start.getTime()).toBeGreaterThanOrEqual(fenetreEtroite.userWindowStart.getTime());
      expect(sess.end.getTime()).toBeLessThanOrEqual(fenetreEtroite.userWindowEnd.getTime());
    }
  });

  // MINEUR (revue) : le choix du creneau doit etre pondere par le NOMBRE de
  // cibles en attente qu'il dessert, pas par la simple presence du pays. Une file
  // tres desequilibree (20 cibles HK contre 1 cible SN) doit favoriser tres
  // largement le creneau HK : aucune session ne doit atteindre la region SN sans
  // ambiguite (>= 10:00 UTC, inatteignable depuis le creneau HK seul).
  it("pondere le choix du creneau par le volume de cibles : une file tres desequilibree favorise le creneau majoritaire", () => {
    const fileDesequilibree = Array(20).fill("HK").concat(["SN"]);
    const s = planDailySessions({ ...FENETRE, pendingCountryCodes: fileDesequilibree, seed: 2 });
    const apresSN = s.filter((x) => x.start.getTime() >= SN_ONLY_APRES);
    expect(apresSN.length).toBe(0);
  });
});

describe("isWithinAnySession", () => {
  it("reconnait un instant a l'interieur d'une session", () => {
    const s = [{ start: new Date("2026-07-15T09:00:00.000Z"), end: new Date("2026-07-15T09:15:00.000Z") }];
    expect(isWithinAnySession(s, new Date("2026-07-15T09:05:00.000Z"))).toBe(true);
  });

  it("exclut la borne de fin", () => {
    const s = [{ start: new Date("2026-07-15T09:00:00.000Z"), end: new Date("2026-07-15T09:15:00.000Z") }];
    expect(isWithinAnySession(s, new Date("2026-07-15T09:15:00.000Z"))).toBe(false);
  });

  it("refuse quand il n'y a aucune session", () => {
    expect(isWithinAnySession([], new Date("2026-07-15T09:05:00.000Z"))).toBe(false);
  });
});
