import { describe, it, expect } from "vitest";
import { classerMessage, texteNouveau } from "./tri";

// Lundi 2 novembre 2026, 10 h UTC.
const now = new Date("2026-11-02T10:00:00Z");
const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("classerMessage", () => {
  it("absence FR avec date : retour le lendemain ouvré", () => {
    const r = classerMessage({ body: "Bonjour,\nJe suis absente du bureau jusqu'au 12 novembre.\nCordialement", headers: { "Auto-Submitted": "auto-replied" } }, now);
    expect(r.nature).toBe("absence");
    expect(jour(r.retourLe)).toBe("2026-11-13");
    expect(r.desinscription).toBe(false);
  });

  it("un refus poli est une vraie réponse", () => {
    const r = classerMessage({ body: "Merci, pas intéressée" }, now);
    expect(r).toEqual({ nature: "reponse", retourLe: null, desinscription: false });
  });

  it("accusé de réception automatique (formule + en-tête)", () => {
    const r = classerMessage({
      subject: "Re: votre message",
      body: "Merci pour votre message, nous avons bien reçu votre demande",
      headers: { "Auto-Submitted": "auto-replied" },
    }, now);
    expect(r.nature).toBe("accuse");
    expect(r.retourLe).toBeNull();
  });

  it("out of office sans date exploitable : now + 7 j", () => {
    const r = classerMessage({ subject: "Out of Office", body: "Out of office, back Monday" }, now);
    expect(r.nature).toBe("absence");
    expect(r.retourLe?.getTime()).toBe(now.getTime() + 7 * 86400000);
  });

  it("« Stop » seul : vraie réponse et désinscription", () => {
    const r = classerMessage({ body: "Stop" }, now);
    expect(r.nature).toBe("reponse");
    expect(r.desinscription).toBe(true);
  });

  it("message ambigu : vraie réponse", () => {
    expect(classerMessage({ body: "Je reviens vers vous" }, now).nature).toBe("reponse");
  });

  it("dates EN et numériques", () => {
    expect(jour(classerMessage({ subject: "Automatic reply: Hello", body: "I am out of office until 12 Nov." }, now).retourLe)).toBe("2026-11-13");
    expect(jour(classerMessage({ body: "Out of office. I'll be back on November 12th.", headers: { "Auto-Submitted": "auto-replied" } }, now).retourLe)).toBe("2026-11-13");
    expect(jour(classerMessage({ subject: "Réponse automatique : Votre message", body: "Absente, de retour le 12/11" }, now).retourLe)).toBe("2026-11-13");
    // Vendredi 13 → lundi 16.
    expect(jour(classerMessage({ body: "Je suis en congés jusqu'au vendredi 13 novembre", headers: { "Auto-Submitted": "auto-replied" } }, now).retourLe)).toBe("2026-11-16");
    // Vendredi 4 décembre → lundi 7.
    expect(jour(classerMessage({ subject: "Absence", body: "En congé jusqu'au 4 décembre" }, now).retourLe)).toBe("2026-12-07");
  });

  it("en-tête technique seul (sans formule) : automatique, jamais une réponse", () => {
    expect(classerMessage({ body: "Bonjour", headers: { "X-Autoreply": "yes" } }, now).nature).toBe("accuse");
    expect(classerMessage({ body: "Bonjour", headers: { precedence: "bulk" } }, now).nature).toBe("accuse");
    expect(classerMessage({ body: "Bonjour", headers: { "Auto-Submitted": "no" } }, now).nature).toBe("reponse");
  });

  it("désinscription : formules FR/EN", () => {
    for (const b of ["Merci de me désinscrire", "Je ne veux plus recevoir vos emails", "Retirez-moi de votre liste", "please unsubscribe me", "Remove me from your list"]) {
      expect(classerMessage({ body: b }, now).desinscription).toBe(true);
    }
    expect(classerMessage({ body: "On arrête pas de stopper les projets" }, now).desinscription).toBe(false);
  });

  it("le texte cité (notre email et son lien de désinscription) ne compte pas", () => {
    const body = "Avec plaisir, appelons-nous jeudi.\n\nLe lun. 2 nov. 2026 à 09:00, Jeanne <j@x.fr> a écrit :\n> Bonjour Marc,\n> Se désinscrire : https://naya/desinscription/abc";
    const r = classerMessage({ body }, now);
    expect(r).toEqual({ nature: "reponse", retourLe: null, desinscription: false });
    expect(texteNouveau(body)).toBe("Avec plaisir, appelons-nous jeudi.");
    expect(texteNouveau("Ok\n\nOn Mon, Nov 2, 2026 at 9:00 AM Jeanne <j@x.fr> wrote:\n> hi")).toBe("Ok");
  });

  it("attribution Gmail aplatie (sans retour à la ligne) : le pied « Se désinscrire » cité ne désinscrit pas", () => {
    const body = "Ça m'intéresse  Le jeu. 5 nov. 2026 à 19:10, jeanne.mejean@agencejmd.com <jeanne.mejean@agencejmd.com> a écrit : Bonjour Marc, je vous écris au sujet de… Se désinscrire : https://naya/desinscription/abc";
    expect(classerMessage({ body }, now)).toEqual({ nature: "reponse", retourLe: null, desinscription: false });
    expect(texteNouveau(body)).toBe("Ça m'intéresse");
  });

  it("demande de désinscription écrite AVANT une attribution aplatie : désinscription", () => {
    const body = "Merci de me désinscrire. Le 5 nov. 2026 à 19:10, Jeanne <j@x.fr> a écrit : Bonjour Marc, …";
    expect(classerMessage({ body }, now)).toEqual({ nature: "reponse", retourLe: null, desinscription: true });
  });

  describe("R11 : une formule seule ne rend jamais un message automatique", () => {
    const conge = "Je suis en congé jusqu'au 12 novembre";
    it("« nous avons bien reçu » sans en-tête, sujet « Re: » → réponse", () => {
      expect(classerMessage({ subject: "Re: Acme", body: "Nous avons bien reçu votre message, je vous rappelle demain" }, now).nature).toBe("reponse");
    });
    it("congé + Auto-Submitted → absence", () => {
      const r = classerMessage({ subject: "Re: Acme", body: conge, headers: { "Auto-Submitted": "auto-replied" } }, now);
      expect(r.nature).toBe("absence");
      expect(jour(r.retourLe)).toBe("2026-11-13");
    });
    it("congé, sans en-tête, sujet « Réponse automatique : … » → absence", () => {
      expect(classerMessage({ subject: "Réponse automatique : Acme", body: conge }, now).nature).toBe("absence");
    });
    it("congé, sans en-tête, sujet « Re: … » → réponse", () => {
      expect(classerMessage({ subject: "Re: Acme", body: conge }, now)).toEqual({ nature: "reponse", retourLe: null, desinscription: false });
    });
    it("LinkedIn (ni en-tête ni sujet) : toujours une réponse", () => {
      expect(classerMessage({ body: "Out of office until 12 Nov" }, now).nature).toBe("reponse");
      expect(classerMessage({ body: "Je suis absente du bureau jusqu'au 12 novembre" }, now).nature).toBe("reponse");
    });
    it("marqueurs de sujet : accusé et absence", () => {
      expect(classerMessage({ subject: "Accusé de réception : Acme", body: "Merci" }, now).nature).toBe("accuse");
      expect(classerMessage({ subject: "Auto: Acme", body: "Merci pour votre message" }, now).nature).toBe("accuse");
      expect(classerMessage({ subject: "Absente", body: "Merci" }, now).nature).toBe("absence");
      expect(classerMessage({ subject: "TR: Réponse automatique", body: "x" }, now).nature).toBe("reponse");
    });
  });

  describe("date de retour : jamais un numéro de téléphone ou de version", () => {
    const auto = { "Auto-Submitted": "auto-replied" };
    it("téléphone à points après la vraie date", () => {
      const r = classerMessage({ body: "Je suis absente jusqu'au 12 novembre.\nEn cas d'urgence : 06.12.34.56.78", headers: auto }, now);
      expect(jour(r.retourLe)).toBe("2026-11-13");
    });
    it("numéro de version sans repère : pas une date (now + 7 j)", () => {
      const r = classerMessage({ subject: "Réponse automatique", body: "Je suis absente. Version 2.3 de notre offre en pièce jointe." }, now);
      expect(r.retourLe?.getTime()).toBe(now.getTime() + 7 * 86400000);
    });
    it("décembre → janvier : année suivante, prochain jour ouvré", () => {
      const dec = new Date("2026-12-20T10:00:00Z");
      const r = classerMessage({ body: "Je suis en congé jusqu'au 3 janvier", headers: auto }, dec);
      expect(jour(r.retourLe)).toBe("2027-01-04");
    });
    it("année hors {cette année, la suivante} ignorée ; retour au-delà de 60 j → now + 7 j", () => {
      expect(classerMessage({ body: "Je suis absente jusqu'au 12/11/2031", headers: auto }, now).retourLe?.getTime()).toBe(now.getTime() + 7 * 86400000);
      expect(classerMessage({ body: "En congé maternité jusqu'au 15 mai", headers: auto }, now).retourLe?.getTime()).toBe(now.getTime() + 7 * 86400000);
    });
    it("la date la plus proche d'un repère l'emporte sur la plus tardive", () => {
      const r = classerMessage({ body: "Je suis absente jusqu'au 12 novembre. Notre salon du 28 novembre aura bien lieu.", headers: auto }, now);
      expect(jour(r.retourLe)).toBe("2026-11-13");
    });
  });
});
