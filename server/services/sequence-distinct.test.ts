import { describe, it, expect } from "vitest";
import {
  roleEtapeLinkedin, tropProche, normaliserTexte, intentionDitInvitation, texteSignifiant,
  branchesExclusives, nextTropProcheState, lireGarde, etatGardeApercu, MAX_TROP_PROCHE_CONSECUTIFS, RAISON_TROP_PROCHE,
} from "./sequence-distinct";

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

describe("tropProche — noms propres et formules neutralisés (fix round 1)", () => {
  const neutres = ["Marie Dupont", "Marie", "Dupont", "Lumen Concept Store", "Lyon", "Jeanne", "Méjean"];
  it("paire du relecteur : deux messages courts qui ne partagent que noms, entreprise, ville et signature → PAS trop proches", () => {
    const a = "Bonjour Marie Dupont, votre boutique Lumen Concept Store Lyon m'intrigue. Jeanne Méjean";
    const b = "Bonjour Marie Dupont, une question sur Lumen Concept Store Lyon : la saison ? Jeanne Méjean";
    expect(tropProche(a, b, { neutres })).toBe(false);
  });
  it("une vraie paraphrase reste signalée malgré les noms retirés", () => {
    const a = "Bonjour Marie, votre façon de mettre en scène les créateurs locaux dans la vitrine de Lumen Concept Store donne envie d'entrer. J'aimerais suivre vos prochaines sélections. Jeanne";
    const b = "Marie, la façon dont Lumen Concept Store met en scène les créateurs locaux dans sa vitrine donne vraiment envie d'entrer. J'aimerais suivre vos sélections. Belle journée, Jeanne";
    expect(tropProche(a, b, { neutres })).toBe(true);
  });
  it("textes courts (< 6 mots porteurs) : seule l'égalité quasi exacte compte", () => {
    expect(tropProche("Bonjour Marie, ravie de vous lire. Jeanne", "Merci Marie, ravie de vous lire ! Jeanne Méjean", { neutres })).toBe(true);
    expect(tropProche("Marie, votre vitrine m'a arrêtée.", "Marie, votre vitrine change souvent ?", { neutres })).toBe(false);
  });
  it("texteSignifiant retire noms (expression et mots), formules de politesse, mais garde le fond", () => {
    expect(texteSignifiant("Bonjour Marie Dupont, votre boutique Lumen Concept Store m'intrigue. Bien à vous, Jeanne", { neutres }))
      .toBe("votre boutique m intrigue");
  });
});

describe("branchesExclusives", () => {
  it("paires opposées", () => {
    expect(branchesExclusives("if_invite_accepted", "if_invite_not_accepted")).toBe(true);
    expect(branchesExclusives("if_not_opened", "if_opened")).toBe(true);
    expect(branchesExclusives("if_clicked", "if_not_opened")).toBe(true);
  });
  it("branches compatibles", () => {
    expect(branchesExclusives("always", "if_invite_accepted")).toBe(false);
    expect(branchesExclusives("if_opened", "if_clicked")).toBe(false);
    expect(branchesExclusives(null, undefined)).toBe(false);
  });
});

describe("nextTropProcheState / lireGarde", () => {
  const now = new Date("2026-10-08T10:00:00Z");
  it("compte les blocages consécutifs et recule tant que le plafond n'est pas atteint", () => {
    const r = nextTropProcheState(0, now, 3_600_000);
    expect(r).toEqual({ abandon: false, consecutifs: 1, nextRunAt: new Date("2026-10-08T11:00:00Z") });
    expect(nextTropProcheState(1, now, 3_600_000).abandon).toBe(false);
  });
  it(`abandonne au ${MAX_TROP_PROCHE_CONSECUTIFS}e blocage consécutif`, () => {
    expect(MAX_TROP_PROCHE_CONSECUTIFS).toBe(3);
    expect(nextTropProcheState(2, now, 3_600_000)).toEqual({ abandon: true, consecutifs: 3, nextRunAt: null });
  });
  it("lireGarde tolère l'absence et les valeurs malformées", () => {
    expect(lireGarde({})).toBeNull();
    expect(lireGarde({ enrichedProfile: { linkedin: {} } })).toBeNull();
    expect(lireGarde({ enrichedProfile: { nayaSequence: { tropProcheConsecutifs: "2", stepId: 7, attention: RAISON_TROP_PROCHE } } }))
      .toEqual({ tropProcheConsecutifs: 2, stepId: 7, attention: RAISON_TROP_PROCHE });
  });
  it("raison visible conforme", () => {
    expect(RAISON_TROP_PROCHE).toBe("Naya n'arrive pas à écrire un message assez différent du précédent — à rédiger à la main.");
  });
});

describe("etatGardeApercu", () => {
  it("expose la raison et l'étape bloquée quand le moteur a renoncé", () => {
    const lead = { enrichedProfile: { nayaSequence: { tropProcheConsecutifs: 3, stepId: 12, attention: RAISON_TROP_PROCHE } } };
    expect(etatGardeApercu(lead, [11, 12, 13])).toEqual({ attention: RAISON_TROP_PROCHE, indexBloque: 1 });
  });
  it("rien à montrer tant que le moteur réessaie (compteur sans raison) ou sans garde", () => {
    expect(etatGardeApercu({ enrichedProfile: { nayaSequence: { tropProcheConsecutifs: 1, stepId: 12, attention: null } } }, [12]))
      .toEqual({ attention: null, indexBloque: -1 });
    expect(etatGardeApercu({}, [12])).toEqual({ attention: null, indexBloque: -1 });
  });
});
