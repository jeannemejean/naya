import { describe, it, expect } from "vitest";
import {
  decideLinkedInAction,
  linkedInRampCapForDay,
  isLinkedInRestrictionSignal,
  LINKEDIN_RAMP_UP_START_CAP,
  LINKEDIN_RAMP_UP_STEP,
  LINKEDIN_RAMP_UP_STEP_DAYS,
  LINKEDIN_MATURE_DAILY_CAP,
  LINKEDIN_WEEKLY_CAP,
  type LinkedInGuardInput,
} from "./prospection-linkedin-guard";

// Instant de référence : mardi 13 janvier 2026, 10:00 à Paris (09:00 UTC, hiver UTC+1).
// Choisi loin de toute transition DST pour ne pas mélanger deux préoccupations dans les
// scénarios "métier" (hors DST : voir timezone.test.ts pour la correction DST elle-même).
const BASE_NOW = new Date("2026-01-13T09:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const WORK_DAYS_MON_FRI = new Set(["mon", "tue", "wed", "thu", "fri"]);

function baseInput(overrides: Partial<LinkedInGuardInput> = {}): LinkedInGuardInput {
  return {
    now: BASE_NOW,
    timezone: "Europe/Paris",
    workDayStartMin: 9 * 60,
    workDayEndMin: 18 * 60,
    workDays: WORK_DAYS_MON_FRI,
    // Compte connecté il y a bien plus de 15 jours → palier mature (15/jour).
    accountConnectedAt: new Date(BASE_NOW.getTime() - 60 * DAY),
    recentSendTimestamps: [],
    restriction: null,
    minDelayMs: 3 * 60 * 1000,
    ...overrides,
  };
}

describe("decideLinkedInAction — cas nominal", () => {
  it("compte mature, aucun envoi récent, en pleine fenêtre ouvrée → autorisé", () => {
    expect(decideLinkedInAction(baseInput())).toEqual({ allowed: true });
  });
});

describe("decideLinkedInAction — compte neuf limité à 5 actions/jour", () => {
  it("compte connecté aujourd'hui (jour 0), 4 envois déjà faits dans les dernières 24h → autorisé (5e action)", () => {
    const recentSendTimestamps = Array.from({ length: 4 }, (_, i) => new Date(BASE_NOW.getTime() - (i + 1) * HOUR));
    const got = decideLinkedInAction(
      baseInput({ accountConnectedAt: new Date(BASE_NOW.getTime() - 1 * HOUR), recentSendTimestamps }),
    );
    expect(got).toEqual({ allowed: true });
  });

  it("compte connecté aujourd'hui (jour 0), 5 envois déjà faits dans les dernières 24h → refusé (plafond ramp-up=5)", () => {
    const recentSendTimestamps = Array.from({ length: 5 }, (_, i) => new Date(BASE_NOW.getTime() - (i + 1) * HOUR));
    const got = decideLinkedInAction(
      baseInput({ accountConnectedAt: new Date(BASE_NOW.getTime() - 1 * HOUR), recentSendTimestamps }),
    );
    expect(got.allowed).toBe(false);
    if (!got.allowed) {
      expect(got.reason).toBe("daily_ramp_cap_reached");
      expect(got.detail).toContain("5");
    }
  });
});

describe("linkedInRampCapForDay — courbe de montée en charge", () => {
  it("jours 0 à 2 : plafond de départ", () => {
    expect(linkedInRampCapForDay(0)).toBe(LINKEDIN_RAMP_UP_START_CAP);
    expect(linkedInRampCapForDay(1)).toBe(LINKEDIN_RAMP_UP_START_CAP);
    expect(linkedInRampCapForDay(2)).toBe(LINKEDIN_RAMP_UP_START_CAP);
  });

  it("jours 3 à 5 : un palier plus haut", () => {
    expect(linkedInRampCapForDay(3)).toBe(LINKEDIN_RAMP_UP_START_CAP + LINKEDIN_RAMP_UP_STEP);
    expect(linkedInRampCapForDay(5)).toBe(LINKEDIN_RAMP_UP_START_CAP + LINKEDIN_RAMP_UP_STEP);
  });

  it("jour 15 : plafond mature atteint (5 + 5 paliers de 2 = 15)", () => {
    expect(linkedInRampCapForDay(15)).toBe(LINKEDIN_MATURE_DAILY_CAP);
  });

  it("jour 30, jour 365 : plafonné à la valeur mature, ne dépasse jamais", () => {
    expect(linkedInRampCapForDay(30)).toBe(LINKEDIN_MATURE_DAILY_CAP);
    expect(linkedInRampCapForDay(365)).toBe(LINKEDIN_MATURE_DAILY_CAP);
  });

  it("date de connexion dans le futur (horloge en doute) → palier le plus prudent, jamais plus", () => {
    expect(linkedInRampCapForDay(-5)).toBe(LINKEDIN_RAMP_UP_START_CAP);
  });
});

describe("decideLinkedInAction — plafond hebdomadaire glissant (80/7j) atteint alors que le quotidien ne l'est pas", () => {
  it("80 envois espacés de 2h (compte mature, 12/24h < 15) → refusé au titre du plafond hebdomadaire", () => {
    // 80 envois toutes les 2h, du plus récent (i=1, il y a 2h) au plus ancien (i=80, il y a
    // 160h ≈ 6,67 jours) : tous dans la fenêtre glissante de 7 jours (168h), mais seuls 12
    // tombent dans les dernières 24h (i=1..12) — largement sous le plafond mature de 15.
    const recentSendTimestamps = Array.from({ length: 80 }, (_, i) => new Date(BASE_NOW.getTime() - (i + 1) * 2 * HOUR));
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) {
      expect(got.reason).toBe("weekly_cap_reached");
      expect(got.detail).toContain(String(LINKEDIN_WEEKLY_CAP));
    }
  });

  it("79 envois seulement (même répartition) → le plafond hebdomadaire n'est PAS encore atteint", () => {
    const recentSendTimestamps = Array.from({ length: 79 }, (_, i) => new Date(BASE_NOW.getTime() - (i + 1) * 2 * HOUR));
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps }));
    expect(got).toEqual({ allowed: true });
  });
});

describe("decideLinkedInAction — nuit (hors heures de bureau)", () => {
  it("03:00 à Paris un jour ouvré → refusé", () => {
    const nightNow = new Date("2026-01-13T02:00:00.000Z"); // 03:00 Paris, même mardi
    const got = decideLinkedInAction(baseInput({ now: nightNow }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("outside_business_hours");
  });
});

describe("decideLinkedInAction — week-end", () => {
  it("samedi 10:00 à Paris → refusé même en pleine journée", () => {
    const saturdayNow = new Date("2026-01-17T09:00:00.000Z"); // 10:00 Paris, samedi
    const got = decideLinkedInAction(baseInput({ now: saturdayNow }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("outside_business_days");
  });
});

// Revue post-commit 261835e, mineur relevé : les tests de fenêtre ouvrée existants
// donnaient le même verdict qu'on lise l'heure de Paris ou l'heure UTC brute (aucun ne
// discriminait). Ceux-ci vérifient explicitement la conversion : si `decideLinkedInAction`
// substituait `now.getUTCHours()` à `localWallClock(timezone, now)`, ces tests précis
// échoueraient alors que ceux du dessus continueraient de passer.
describe("decideLinkedInAction — la fenêtre ouvrée est bien celle de Paris, jamais l'heure UTC brute", () => {
  it("17:30 UTC un mardi de janvier = 18:30 à Paris (hors fenêtre 9h-18h) → refusé — lire l'heure UTC brute (17:30) l'aurait autorisé à tort", () => {
    const now = new Date("2026-01-13T17:30:00.000Z");
    const got = decideLinkedInAction(baseInput({ now }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("outside_business_hours");
  });

  it("borne exacte : 08:59 à Paris (07:59 UTC) → refusé, juste avant l'ouverture", () => {
    const now = new Date("2026-01-13T07:59:00.000Z");
    const got = decideLinkedInAction(baseInput({ now }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("outside_business_hours");
  });

  it("borne exacte : 09:00 à Paris (08:00 UTC) → autorisé, l'ouverture est inclusive", () => {
    const now = new Date("2026-01-13T08:00:00.000Z");
    expect(decideLinkedInAction(baseInput({ now }))).toEqual({ allowed: true });
  });

  it("borne exacte : 17:59 à Paris (16:59 UTC) → autorisé, juste avant la fermeture", () => {
    const now = new Date("2026-01-13T16:59:00.000Z");
    expect(decideLinkedInAction(baseInput({ now }))).toEqual({ allowed: true });
  });

  it("borne exacte : 18:00 à Paris (17:00 UTC) → refusé, la fermeture est exclusive", () => {
    const now = new Date("2026-01-13T17:00:00.000Z");
    const got = decideLinkedInAction(baseInput({ now }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("outside_business_hours");
  });
});

describe("decideLinkedInAction — délai minimum aléatoire entre deux actions", () => {
  it("dernier envoi il y a 1 min, délai minimum 3 min → refusé (évite la rafale du worker chaque minute)", () => {
    const recentSendTimestamps = [new Date(BASE_NOW.getTime() - 1 * 60 * 1000)];
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps, minDelayMs: 3 * 60 * 1000 }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("min_delay_not_elapsed");
  });

  it("dernier envoi il y a 5 min, délai minimum 3 min → le délai n'est plus un obstacle", () => {
    const recentSendTimestamps = [new Date(BASE_NOW.getTime() - 5 * 60 * 1000)];
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps, minDelayMs: 3 * 60 * 1000 }));
    expect(got).toEqual({ allowed: true });
  });

  it("le délai est un PARAMÈTRE : la fonction ne tire jamais l'aléa elle-même (même entrée → même sortie)", () => {
    const recentSendTimestamps = [new Date(BASE_NOW.getTime() - 2 * 60 * 1000)];
    const a = decideLinkedInAction(baseInput({ recentSendTimestamps, minDelayMs: 4 * 60 * 1000 }));
    const b = decideLinkedInAction(baseInput({ recentSendTimestamps, minDelayMs: 4 * 60 * 1000 }));
    expect(a).toEqual(b);
  });
});

describe("decideLinkedInAction — compte en restriction : arrêt total, aucune retentative automatique", () => {
  it("restriction active → refusé, quel que soit le reste (fenêtre ouverte, plafonds larges)", () => {
    const got = decideLinkedInAction(
      baseInput({ restriction: { restrictedAt: new Date(BASE_NOW.getTime() - DAY), reason: "403 challenge de sécurité" } }),
    );
    expect(got.allowed).toBe(false);
    if (!got.allowed) {
      expect(got.reason).toBe("restricted");
      expect(got.detail).toContain("403 challenge de sécurité");
    }
  });

  it("restriction active PRIME sur un historique illisible (priorité de sécurité, pas d'ambiguïté sur la raison loguée)", () => {
    const got = decideLinkedInAction(
      baseInput({ restriction: { restrictedAt: new Date(BASE_NOW.getTime() - DAY) }, recentSendTimestamps: null }),
    );
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("restricted");
  });
});

describe("decideLinkedInAction — historique d'envoi illisible ≠ historique vide → refus par prudence", () => {
  it("recentSendTimestamps = null (lecture échouée) → refusé, jamais traité comme 0 envoi", () => {
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps: null }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("send_history_unreadable");
  });

  it("recentSendTimestamps = [] (lecture réussie, réellement aucun envoi) → PAS refusé pour ce motif", () => {
    const got = decideLinkedInAction(baseInput({ recentSendTimestamps: [] }));
    expect(got.allowed).toBe(true);
  });
});

describe("decideLinkedInAction — date de connexion du compte inconnue → refus par prudence", () => {
  it("accountConnectedAt = null → impossible de calculer la montée en charge, refusé", () => {
    const got = decideLinkedInAction(baseInput({ accountConnectedAt: null }));
    expect(got.allowed).toBe(false);
    if (!got.allowed) expect(got.reason).toBe("account_connection_unknown");
  });
});

describe("isLinkedInRestrictionSignal — classification des erreurs Unipile", () => {
  it("401 (authentification) présent dans l'erreur composée → signal de restriction", () => {
    expect(isLinkedInRestrictionSignal("chat_401/invite_403 Forbidden")).toBe(true);
  });

  it("403 (interdit) seul → signal de restriction", () => {
    expect(isLinkedInRestrictionSignal("chat_500/invite_403 account restricted")).toBe(true);
  });

  it("mention explicite d'un challenge de sécurité → signal de restriction", () => {
    expect(isLinkedInRestrictionSignal("CHECKPOINT_CHALLENGE required")).toBe(true);
  });

  it("erreur serveur 500 des deux côtés, sans 401/403 ni mot-clé → PAS un signal de restriction (transitoire)", () => {
    expect(isLinkedInRestrictionSignal("chat_500/invite_502 Internal Server Error")).toBe(false);
  });

  it("erreurs de configuration/résolution du profil → PAS un signal de restriction", () => {
    expect(isLinkedInRestrictionSignal("unipile_not_configured")).toBe(false);
    expect(isLinkedInRestrictionSignal("no_public_id")).toBe(false);
    expect(isLinkedInRestrictionSignal("profile_not_resolved")).toBe(false);
  });

  it("pas d'erreur → pas un signal", () => {
    expect(isLinkedInRestrictionSignal(undefined)).toBe(false);
    expect(isLinkedInRestrictionSignal(null)).toBe(false);
    expect(isLinkedInRestrictionSignal("")).toBe(false);
  });

  // Revue post-commit 261835e, défaut Critique 3 : `resolveProviderId` (linkedin.ts)
  // compose désormais `resolve_401`/`resolve_403` quand la résolution du profil (le
  // PREMIER appel du parcours d'envoi) échoue par erreur HTTP — au lieu du générique
  // `profile_not_resolved`, qui rendait une vraie restriction indiscernable d'un simple
  // profil introuvable. Ce classifieur n'a pas eu besoin de changer : le motif
  // `(?<!\d)(401|403)(?!\d)` couvre déjà cette forme — ce test le fige explicitement.
  it("resolve_401 / resolve_403 (échec de résolution du profil, linkedin.ts) → signal de restriction", () => {
    expect(isLinkedInRestrictionSignal("resolve_401")).toBe(true);
    expect(isLinkedInRestrictionSignal("resolve_403")).toBe(true);
  });
});
