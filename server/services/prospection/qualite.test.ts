import { describe, it, expect } from "vitest";
import { controlerMessage, type Defaut } from "./qualite";

const codes = (d: Defaut[]) => d.map((x) => x.code);
const ctx = (over: Partial<Parameters<typeof controlerMessage>[1]> = {}) => ({
  entreprise: "Estée Lauder", liensAutorises: [] as string[], premiereTouche: false, ...over,
});

describe("contrôle qualité, couche 1 : la séquence « Sneha » est rejetée", () => {
  it("l'invitation : question de réflexion, genre, aucune mention de l'entreprise", () => {
    const body = "Sneha, la façon dont votre division fragrance construit une identité sensorielle cohérente m'a frappée. Comment pensez-vous l'équilibre entre héritage et renouveau ? Jeanne";
    const d = codes(controlerMessage({ role: "invitation", canal: "linkedin", body }, ctx({ premiereTouche: true })));
    expect(d).toContain("question_reflexion");
    expect(d).toContain("tic");
    expect(d).toContain("sans_entreprise");
  });

  it("la relance qui avoue le tracking", () => {
    const body = "Bonjour Sneha, Vous avez jeté un œil à mon message précédent, ce qui m'a donné envie de revenir vers vous plus directement. Est-ce qu'il y a un brief en cours ? Jeanne";
    expect(codes(controlerMessage({ role: "relance", canal: "email", body, subject: "Une question" }, ctx()))).toContain("tracking");
  });

  it("l'objet poétique", () => {
    const d = codes(controlerMessage({
      role: "email_ouverture", canal: "email",
      subject: "Parfum et désir : ce que la saison dit avant les mots",
      body: "Bonjour Sneha, ".repeat(30),
    }, ctx()));
    expect(d).toContain("objet");
  });

  it("le tic « résonner avec »", () => {
    const body = "Je serais heureuse d'en parler pour voir si ce que je fais peut résonner avec ce que vous construisez. Jeanne";
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx()))).toContain("tic");
  });

  it("un lien qui ne vient ni de la preuve ni des consignes", () => {
    const body = "Voici un cas proche : https://exemple.com/cas. Je vous l'envoie ? Jeanne";
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx()))).toContain("lien_inconnu");
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx({ liensAutorises: ["https://exemple.com/cas"] })))).not.toContain("lien_inconnu");
  });

  it("un lien sans http (domaine nu) qui ne vient pas d'une preuve est repéré", () => {
    const body = "Tout est sur monsite.fr/offre et calendly.com/jeanne. Je vous l'envoie ? Jeanne";
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx()))).toContain("lien_inconnu");
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body: "Le cas est ici : jmd.fr/cas. Jeanne" }, ctx({ liensAutorises: ["https://jmd.fr/cas"] })))).not.toContain("lien_inconnu");
  });

  it("une abréviation ou une phrase normale n'est pas prise pour un lien", () => {
    const body = "Bonjour Marie, j'ai vu le lancement, p.ex. la gamme 2026. Je vous l'envoie ? Jeanne, jeanne@jmd.fr";
    expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx()))).not.toContain("lien_inconnu");
  });

  it("les tournures neutres en tête de phrase ne sont pas des adjectifs de genre", () => {
    for (const body of [
      "Intéressant de voir votre lancement. Jeanne",
      "Heureusement que la gamme sort au printemps. Jeanne",
      "Impressionnant de voir la collection. Jeanne",
      "Touchant de lire votre post. Jeanne",
      "Interessant pour la suite. Jeanne",
    ]) {
      expect(codes(controlerMessage({ role: "relance", canal: "linkedin", body }, ctx())), body).not.toContain("genre");
    }
  });

  it("un placeholder et un tiret long", () => {
    const d = codes(controlerMessage({ role: "relance", canal: "linkedin", body: "Bonjour [prénom] — voici l'idée. Jeanne" }, ctx()));
    expect(d).toContain("placeholder");
    expect(d).toContain("tiret");
  });

  it("un adjectif accordé en tête de phrase (« Ravie d'être connectée »)", () => {
    const body = "Bonjour Marie, je dirige JMD. Ravie d'être connectée. Jeanne";
    expect(codes(controlerMessage({ role: "invitation", canal: "linkedin", body }, ctx({ entreprise: null })))).toContain("genre");
  });

  it("une note LinkedIn trop longue", () => {
    const body = "a".repeat(301);
    expect(codes(controlerMessage({ role: "invitation", canal: "linkedin", body }, ctx()))).toContain("trop_long");
  });

  it("un email d'ouverture trop court ou trop long", () => {
    expect(codes(controlerMessage({ role: "email_ouverture", canal: "email", subject: "Marc Jacobs et JMD", body: "Bonjour, un mot. Jeanne" }, ctx()))).toContain("trop_court");
    expect(codes(controlerMessage({ role: "email_ouverture", canal: "email", subject: "Marc Jacobs et JMD", body: "mot ".repeat(130) }, ctx()))).toContain("trop_long");
  });

  it("chaque défaut porte une raison lisible", () => {
    const d = controlerMessage({ role: "relance", canal: "linkedin", body: "[x]" }, ctx());
    expect(d.every((x) => x.raison.length > 10)).toBe(true);
  });
});

describe("contrôle qualité, couche 1 : un bon message passe", () => {
  it("message court, identité, déclencheur nommé, demande facile", () => {
    const body = "Bonjour Sneha, je dirige JMD, on accompagne des maisons de beauté sur leurs contenus. Le lancement de Daisy Wild chez Marc Jacobs m'a donné une idée de série courte pour vous. Je vous l'envoie ? Jeanne";
    expect(controlerMessage({ role: "premier_message", canal: "linkedin", body }, ctx({ entreprise: "Marc Jacobs", premiereTouche: true }))).toEqual([]);
  });

  it("une entreprise inconnue ne déclenche pas « sans_entreprise »", () => {
    const body = "Bonjour, je dirige JMD. Le lancement de votre gamme m'a donné une idée. Je vous l'envoie ? Jeanne";
    expect(codes(controlerMessage({ role: "invitation", canal: "linkedin", body }, ctx({ entreprise: null, premiereTouche: true })))).not.toContain("sans_entreprise");
  });
});
