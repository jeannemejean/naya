import { describe, it, expect } from "vitest";
import { roleEtapeLinkedin, tropProche, normaliserTexte, intentionDitInvitation } from "./sequence-distinct";

const li = (condition = "always", intention: string | null = null) => ({ channel: "linkedin", condition, intention });
const em = (condition = "always") => ({ channel: "email", condition, intention: null });

describe("roleEtapeLinkedin", () => {
  it("séquence type : invitation (always) puis message (if_invite_accepted) puis relance", () => {
    const steps = [li("always"), li("if_invite_accepted"), li("always")];
    expect(roleEtapeLinkedin(steps, 0)).toBe("invitation");
    expect(roleEtapeLinkedin(steps, 1)).toBe("message_apres_acceptation");
    expect(roleEtapeLinkedin(steps, 2)).toBe("relance");
  });
  it("email : jamais de rôle LinkedIn", () => {
    expect(roleEtapeLinkedin([em(), li()], 0)).toBeNull();
  });
  it("première étape LinkedIn après des emails = invitation", () => {
    expect(roleEtapeLinkedin([em(), em("if_not_opened"), li("always")], 2)).toBe("invitation");
  });
  it("if_invite_not_accepted en première étape LinkedIn = invitation", () => {
    expect(roleEtapeLinkedin([em(), li("if_invite_not_accepted")], 1)).toBe("invitation");
  });
  it("if_invite_accepted prime sur une intention qui parle d'invitation", () => {
    expect(roleEtapeLinkedin([li("always"), li("if_invite_accepted", "invitation")], 1)).toBe("message_apres_acceptation");
  });
  it("étapes héritées (intention nulle, conditions always) : 1re = invitation, suivantes = relance", () => {
    const steps = [li(), li(), li()];
    expect(roleEtapeLinkedin(steps, 0)).toBe("invitation");
    expect(roleEtapeLinkedin(steps, 1)).toBe("relance");
  });
  it("l'intention ne désigne l'invitation que si aucune invitation n'existe avant", () => {
    // Étape 0 = message (if_invite_accepted), étape 1 « Invitation LinkedIn » → invitation.
    expect(roleEtapeLinkedin([li("if_invite_accepted"), li("always", "Invitation LinkedIn")], 1)).toBe("invitation");
    // Déjà une invitation avant → relance, même si l'intention dit « invitation ».
    expect(roleEtapeLinkedin([li("always"), li("always", "Nouvelle invitation")], 1)).toBe("relance");
  });
  it("index hors bornes → null", () => {
    expect(roleEtapeLinkedin([li()], 5)).toBeNull();
  });
});

describe("intentionDitInvitation", () => {
  it("reconnaît FR/EN, ignore l'après-acceptation", () => {
    expect(intentionDitInvitation("Invitation LinkedIn d'ouverture")).toBe(true);
    expect(intentionDitInvitation("Send connection request")).toBe(true);
    expect(intentionDitInvitation("Demande de connexion")).toBe(true);
    expect(intentionDitInvitation("Message après connexion")).toBe(false);
    expect(intentionDitInvitation("Follow-up after invite accepted")).toBe(false);
    expect(intentionDitInvitation("Email de valeur")).toBe(false);
    expect(intentionDitInvitation(null)).toBe(false);
  });
});

describe("normaliserTexte", () => {
  it("minuscules, sans accents ni ponctuation", () => {
    expect(normaliserTexte("  Élégant, n'est-ce pas ?! ")).toBe("elegant n est ce pas");
  });
});

describe("tropProche", () => {
  const invitation = "Bonjour Fred, le nom Petit Bivouac crée une vraie pause dans un rayon outdoor saturé. J'aimerais suivre ce que vous construisez à Grenoble. Jeanne";
  it("identiques (modulo casse/accents/ponctuation) → true", () => {
    expect(tropProche(invitation, invitation)).toBe(true);
    expect(tropProche("Élégant, vraiment !", "elegant vraiment")).toBe(true);
  });
  it("note d'invitation recopiée dans le message suivant → true", () => {
    expect(tropProche(invitation, `Merci d'avoir accepté ! ${invitation} Qu'en pensez-vous ?`)).toBe(true);
  });
  it("paraphrase (même vocabulaire réordonné) → true", () => {
    const para = "Fred, à Grenoble, Petit Bivouac : ce nom crée une vraie pause dans un rayon outdoor saturé. J'aimerais suivre ce que vous construisez. Jeanne";
    expect(tropProche(invitation, para)).toBe(true);
  });
  it("messages réellement différents → false", () => {
    const suite = "Merci Fred. Votre dernière collection mise sur la réparation plutôt que le neuf, c'est rare chez les marques de bivouac. Comment vos clients l'ont-ils reçue ? Jeanne";
    expect(tropProche(invitation, suite)).toBe(false);
  });
  it("texte vide → false", () => {
    expect(tropProche("", invitation)).toBe(false);
  });
});
