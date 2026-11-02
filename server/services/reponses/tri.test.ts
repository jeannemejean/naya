import { describe, it, expect } from "vitest";
import { classerMessage, texteNouveau } from "./tri";

// Lundi 2 novembre 2026, 10 h UTC.
const now = new Date("2026-11-02T10:00:00Z");
const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("classerMessage", () => {
  it("absence FR avec date : retour le lendemain ouvré", () => {
    const r = classerMessage({ body: "Bonjour,\nJe suis absente du bureau jusqu'au 12 novembre.\nCordialement" }, now);
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
    const r = classerMessage({ body: "Out of office, back Monday" }, now);
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
    expect(jour(classerMessage({ body: "Automatic reply: I am out of office until 12 Nov." }, now).retourLe)).toBe("2026-11-13");
    expect(jour(classerMessage({ body: "Out of office. I'll be back on November 12th." }, now).retourLe)).toBe("2026-11-13");
    expect(jour(classerMessage({ body: "Réponse automatique : de retour le 12/11" }, now).retourLe)).toBe("2026-11-13");
    // Vendredi 13 → lundi 16.
    expect(jour(classerMessage({ body: "Je suis en congés jusqu'au vendredi 13 novembre" }, now).retourLe)).toBe("2026-11-16");
    // Janvier, vu de novembre : l'année suivante.
    expect(jour(classerMessage({ body: "En congé jusqu'au 4 janvier" }, now).retourLe)).toBe("2027-01-05");
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
});
