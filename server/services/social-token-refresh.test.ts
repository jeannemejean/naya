import { describe, it, expect } from "vitest";
import { lireReponseJeton, comptesARafraichir } from "./social-token-refresh";

const MAINTENANT = new Date("2026-09-18T10:00:00Z");
const dans = (jours: number) => new Date(MAINTENANT.getTime() + jours * 86_400_000);

/**
 * Lecture d'une réponse de renouvellement de jeton.
 *
 * Cette fonction décide de ce qui sera ÉCRIT par-dessus un jeton existant. Une lecture trop
 * permissive remplacerait un jeton qui fonctionne par une valeur vide — et transformerait un
 * renouvellement raté en déconnexion.
 */
describe("lireReponseJeton", () => {
  it("lit un renouvellement complet", () => {
    const r = lireReponseJeton(
      { access_token: "nouveau", refresh_token: "nouveau-refresh", expires_in: 5184000 },
      MAINTENANT,
    );

    expect(r).toEqual({
      accessToken: "nouveau",
      refreshToken: "nouveau-refresh",
      expiresAt: new Date(MAINTENANT.getTime() + 5184000 * 1000),
    });
  });

  it("SANS access_token, on ne renvoie RIEN", () => {
    // LE test. Écrire une valeur vide par-dessus un jeton qui marche transformerait un
    // renouvellement raté en déconnexion — donc une panne causée par la tentative de
    // reparation.
    for (const mauvais of [
      {},
      { access_token: "" },
      { access_token: "   " },
      { access_token: null },
      { access_token: 42 },
      { error: "invalid_grant" },
    ]) {
      expect(lireReponseJeton(mauvais as any, MAINTENANT), JSON.stringify(mauvais)).toBeNull();
    }
  });

  it("une réponse qui n'est pas un objet exploitable ne renvoie rien", () => {
    // Le tableau vide est couvert par l'absence d'access_token, pas par un test de type :
    // un garde Array.isArray s'est révélé inatteignable par mutation, et a été retiré.
    for (const brut of [null, undefined, "texte", 42, []]) {
      expect(lireReponseJeton(brut as any, MAINTENANT), String(brut)).toBeNull();
    }
  });

  it("sans refresh_token, l'ancien n'est PAS écrasé", () => {
    // Certaines plateformes ne renvoient un refresh_token qu'à la première émission. Le
    // remplacer par `undefined` perdrait la seule chose qui permet le prochain renouvellement.
    const r = lireReponseJeton({ access_token: "nouveau", expires_in: 3600 }, MAINTENANT);

    expect(r).not.toBeNull();
    expect(r!.refreshToken).toBeUndefined();
  });

  it("sans expires_in, l'échéance est INCONNUE — pas inventée", () => {
    // L'échange initial, ailleurs dans ce dépôt, invente 60 jours quand expires_in manque.
    // C'est précisément ce genre de supposition qui a produit des comptes affichés
    // « Connecté » avec des jetons morts. Ici on dit qu'on ne sait pas.
    const r = lireReponseJeton({ access_token: "nouveau" }, MAINTENANT);

    expect(r!.expiresAt).toBeNull();
  });

  it("un expires_in aberrant vaut échéance inconnue", () => {
    for (const aberrant of [0, -1, "beaucoup", null, NaN, Infinity]) {
      const r = lireReponseJeton({ access_token: "n", expires_in: aberrant } as any, MAINTENANT);
      expect(r!.expiresAt, `expires_in = ${String(aberrant)}`).toBeNull();
    }
  });
});

/**
 * Choix des comptes à renouveler.
 */
describe("comptesARafraichir", () => {
  const compte = (o: Partial<any> = {}) => ({
    id: 1,
    platform: "linkedin",
    accessToken: "jeton",
    refreshToken: "refresh",
    isActive: true,
    expiresAt: dans(2),
    ...o,
  });

  it("retient un compte qui expire bientôt", () => {
    expect(comptesARafraichir([compte()], MAINTENANT)).toHaveLength(1);
  });

  it("retient un compte DÉJÀ expiré", () => {
    // Un jeton de rafraîchissement peut survivre à son jeton d'accès.
    expect(comptesARafraichir([compte({ expiresAt: dans(-56) })], MAINTENANT)).toHaveLength(1);
  });

  it("ignore un compte encore bon pour longtemps", () => {
    expect(comptesARafraichir([compte({ expiresAt: dans(60) })], MAINTENANT)).toEqual([]);
  });

  it("ignore un compte SANS jeton de rafraîchissement", () => {
    // Le cas d'Instagram en production : pas de refresh_token en base. Tenter quand même
    // consommerait un appel pour un échec certain, à chaque passage du worker.
    expect(comptesARafraichir([compte({ refreshToken: null })], MAINTENANT)).toEqual([]);
    expect(comptesARafraichir([compte({ refreshToken: "" })], MAINTENANT)).toEqual([]);
  });

  it("ignore un compte désactivé", () => {
    expect(comptesARafraichir([compte({ isActive: false })], MAINTENANT)).toEqual([]);
  });

  it("ignore un compte dont l'échéance est inconnue", () => {
    // Rafraîchir sans savoir pourquoi consomme un quota et risque d'invalider un jeton qui
    // fonctionne.
    expect(comptesARafraichir([compte({ expiresAt: null })], MAINTENANT)).toEqual([]);
  });

  it("trie les plus urgents d'abord", () => {
    // Si un quota limite le nombre d'appels, ce sont les plus proches de la mort qui doivent
    // passer en premier.
    const r = comptesARafraichir(
      [compte({ id: 1, expiresAt: dans(5) }), compte({ id: 2, expiresAt: dans(-10) })],
      MAINTENANT,
    );

    expect(r.map((c) => c.id)).toEqual([2, 1]);
  });

  it("une liste vide ne casse rien", () => {
    expect(comptesARafraichir([], MAINTENANT)).toEqual([]);
  });
});
