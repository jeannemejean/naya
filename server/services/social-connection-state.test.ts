import { describe, it, expect } from "vitest";
import {
  etatConnexion,
  doitEtreRafraichie,
  MARGE_RAFRAICHISSEMENT_JOURS,
  type EtatConnexion,
} from "./social-connection-state";

/**
 * L'état réel d'une connexion à un réseau social.
 *
 * Le défaut constaté le 18 septembre : les deux comptes de la production portaient
 * `is_active = true` alors que leurs jetons étaient morts depuis 56 jours (LinkedIn) et
 * 26 jours (Instagram). L'écran Réglages affichait « Connecté ». Rien ne fonctionnait.
 *
 * `is_active` ne dit pas si la connexion marche : il dit qu'elle n'a pas été révoquée depuis
 * l'application. C'est une intention, pas un état. La confondre avec l'état, c'est présenter
 * une absence comme une santé — le motif corrigé partout dans ce dépôt.
 */

const LE_18 = new Date("2026-09-18T09:00:00Z");
const dans = (jours: number) => new Date(LE_18.getTime() + jours * 86_400_000);

const base = {
  accessToken: "un-jeton",
  isActive: true,
  expiresAt: dans(30),
  now: LE_18,
};

describe("etatConnexion", () => {
  it("un jeton valide et lointain est connecté", () => {
    expect(etatConnexion({ ...base })).toBe("connectee");
  });

  it("un jeton EXPIRÉ est expiré, quoi que dise is_active", () => {
    // LE test. C'est exactement l'état des deux comptes de production, affichés « Connecté ».
    expect(etatConnexion({ ...base, expiresAt: dans(-56), isActive: true })).toBe("expiree");
  });

  it("un jeton qui expire dans les jours qui viennent se signale AVANT de mourir", () => {
    // Sans cette fenêtre, on ne découvre la panne qu'une fois la publication échouée.
    expect(etatConnexion({ ...base, expiresAt: dans(MARGE_RAFRAICHISSEMENT_JOURS - 1) })).toBe(
      "expire_bientot",
    );
  });

  it("la limite de la fenêtre est inclusive du côté sûr", () => {
    expect(etatConnexion({ ...base, expiresAt: dans(MARGE_RAFRAICHISSEMENT_JOURS + 1) })).toBe(
      "connectee",
    );
  });

  it("sans jeton d'accès, il n'y a pas de connexion", () => {
    for (const sans of ["", null, undefined]) {
      expect(
        etatConnexion({ ...base, accessToken: sans as string }),
        `jeton « ${String(sans)} »`,
      ).toBe("absente");
    }
  });

  it("une connexion désactivée est absente, même avec un jeton vivant", () => {
    expect(etatConnexion({ ...base, isActive: false })).toBe("absente");
  });

  it("une date d'expiration INCONNUE ne vaut pas « expiré »", () => {
    // Certains jetons n'ont pas d'expiration connue. Les déclarer expirés ferait reconnecter
    // sans raison ; les déclarer sains serait tout aussi faux. On dit ce qu'on sait :
    // la connexion existe, son échéance est inconnue.
    expect(etatConnexion({ ...base, expiresAt: null })).toBe("echeance_inconnue");
    expect(etatConnexion({ ...base, expiresAt: undefined })).toBe("echeance_inconnue");
  });

  it("une date INVALIDE vaut échéance inconnue, pas une date", () => {
    // `new Date("n'importe quoi")` est un objet Date réel dont le temps vaut NaN. Toute
    // comparaison avec NaN est fausse : sans ce cas, un jeton mort passerait pour connecté.
    expect(etatConnexion({ ...base, expiresAt: new Date("pas une date") })).toBe(
      "echeance_inconnue",
    );
  });
});

describe("doitEtreRafraichie", () => {
  it("on rafraîchit ce qui va expirer, pas ce qui est encore loin", () => {
    expect(doitEtreRafraichie("expire_bientot")).toBe(true);
    expect(doitEtreRafraichie("connectee")).toBe(false);
  });

  it("on tente aussi sur un jeton DÉJÀ expiré", () => {
    // Un jeton de rafraîchissement peut survivre à son jeton d'accès. Renoncer d'emblée
    // imposerait une reconnexion manuelle là où un appel aurait suffi.
    expect(doitEtreRafraichie("expiree")).toBe(true);
  });

  it("on ne rafraîchit pas ce qui n'existe pas", () => {
    expect(doitEtreRafraichie("absente")).toBe(false);
  });

  it("une échéance inconnue ne déclenche pas de rafraîchissement", () => {
    // Rafraîchir sans savoir pourquoi, c'est consommer un quota et risquer d'invalider un
    // jeton qui marche.
    expect(doitEtreRafraichie("echeance_inconnue")).toBe(false);
  });

  it("tout état est tranché", () => {
    // Bug visé : ajouter un état plus tard et oublier de décider. Un switch sans cas par
    // défaut renverrait `undefined`, donc « ne pas rafraîchir » — silencieusement.
    const tous: EtatConnexion[] = [
      "connectee",
      "expire_bientot",
      "expiree",
      "absente",
      "echeance_inconnue",
    ];
    for (const e of tous) {
      expect(typeof doitEtreRafraichie(e), `état ${e}`).toBe("boolean");
    }
  });
});
