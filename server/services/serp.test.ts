import { describe, it, expect } from "vitest";
import { extractLinkedInLead, buildSerpUrl, parseSerpBody } from "./serp";

describe("extractLinkedInLead", () => {
  it("extrait nom + URL d'un résultat LinkedIn /in/", () => {
    const r = extractLinkedInLead({
      link: "https://fr.linkedin.com/in/solene-jaboulet-7799b9?trk=abc",
      title: "Solene JABOULET - Directrice Marketing et Communication - Cité du Vin | LinkedIn",
      description: "Directrice Marketing, Cité du Vin",
    });
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Solene JABOULET");
    expect(r!.role).toBe("Directrice Marketing et Communication");
    expect(r!.company).toBe("Cité du Vin");
    expect(r!.linkedinUrl).toBe("https://fr.linkedin.com/in/solene-jaboulet-7799b9"); // query strippée
  });

  it("gère un titre nom + société (2 parties)", () => {
    const r = extractLinkedInLead({ link: "https://www.linkedin.com/in/x", title: "Marie Dupont - Encore Merci | LinkedIn" });
    expect(r!.name).toBe("Marie Dupont");
    expect(r!.company).toBe("Encore Merci");
    expect(r!.role).toBeNull();
  });

  it("gère un nom seul", () => {
    const r = extractLinkedInLead({ link: "https://linkedin.com/in/x", title: "Marie Dupont | LinkedIn" });
    expect(r!.name).toBe("Marie Dupont");
    expect(r!.role).toBeNull();
    expect(r!.company).toBeNull();
  });

  it("ignore un résultat non-profil (pas /in/)", () => {
    expect(extractLinkedInLead({ link: "https://www.linkedin.com/company/encore-merci", title: "Encore Merci | LinkedIn" })).toBeNull();
    expect(extractLinkedInLead({ link: "https://example.com/page", title: "Truc" })).toBeNull();
  });

  it("ignore si pas de nom", () => {
    expect(extractLinkedInLead({ link: "https://linkedin.com/in/x", title: " | LinkedIn" })).toBeNull();
  });
});

describe("buildSerpUrl — la verticale et la fenêtre de fraîcheur", () => {
  it("sans options : une recherche web classique, comme avant", () => {
    const url = buildSerpUrl("actualité packaging");
    expect(url).toContain("https://www.google.com/search?q=");
    expect(url).not.toContain("tbm=");
    expect(url).not.toContain("tbs=");
  });

  it("verticale actualités + 7 jours : tbm=nws et tbs=qdr:w", () => {
    const url = buildSerpUrl("actualité packaging", { vertical: "news", freshness: "week" });
    expect(url).toContain("tbm=nws");
    expect(url).toContain("tbs=qdr%3Aw");
  });

  it("la requête est encodée, y compris les opérateurs", () => {
    expect(buildSerpUrl('site:lesechos.fr "packaging durable"')).toContain(
      encodeURIComponent('site:lesechos.fr "packaging durable"'),
    );
  });

  it("sans pays/langue : ni gl ni hl dans l'URL (non-régression prospection)", () => {
    const url = buildSerpUrl("actualité packaging");
    expect(url).not.toContain("gl=");
    expect(url).not.toContain("hl=");
  });

  it("avec pays/langue : gl=fr et hl=fr dans l'URL, sans casser tbm/tbs", () => {
    const url = buildSerpUrl("actualité packaging", {
      vertical: "news",
      freshness: "week",
      pays: "fr",
      langue: "fr",
    });
    expect(url).toContain("gl=fr");
    expect(url).toContain("hl=fr");
    expect(url).toContain("tbm=nws");
    expect(url).toContain("tbs=qdr%3Aw");
  });
});

describe("parseSerpBody — les deux formes de réponse Bright Data", () => {
  it("lit la forme web (organic), comme la prospection aujourd'hui", () => {
    const out = parseSerpBody({ organic: [{ link: "https://a.fr/x", title: "A", description: "desc" }] });
    expect(out).toEqual([{ link: "https://a.fr/x", title: "A", description: "desc", source: undefined, publishedAtRaw: undefined }]);
  });

  it("lit la forme actualités (news) et en retient la date brute", () => {
    const out = parseSerpBody({
      news: [{ link: "https://b.fr/y", title: "B", source: "Les Echos", date: "il y a 2 jours" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].link).toBe("https://b.fr/y");
    expect(out[0].source).toBe("Les Echos");   // la source alimente la fiche — sans elle, « source inconnue »
    expect(out[0].publishedAtRaw).toBe("il y a 2 jours");
  });

  it("une réponse vide ou inattendue ne jette pas : liste vide", () => {
    expect(parseSerpBody(null)).toEqual([]);
    expect(parseSerpBody({})).toEqual([]);
    expect(parseSerpBody({ organic: "pas un tableau" })).toEqual([]);
  });

  it("un résultat sans lien est écarté", () => {
    expect(parseSerpBody({ organic: [{ title: "sans lien" }] })).toEqual([]);
  });
});
