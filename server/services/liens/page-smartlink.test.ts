import { describe, it, expect } from "vitest";
import { echapperHtml, rendrePageSmartlink } from "./page-smartlink";

const base = {
  titre: "Ma marque", bio: "Café & thé", avatarUrl: "https://cdn.x/a.jpg", theme: null,
  urlPage: "https://www.hellonaya.app/b/ma-marque", boutons: [], tuiles: [],
};

describe("echapperHtml", () => {
  it("échappe les 5 caractères sensibles", () => {
    expect(echapperHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    expect(echapperHtml(null)).toBe("");
  });
});

describe("rendrePageSmartlink", () => {
  it("échappe le titre, la bio et les libellés", () => {
    const html = rendrePageSmartlink({
      ...base,
      titre: `<script>alert(1)</script>`,
      bio: `"><img src=x onerror=alert(1)>`,
      boutons: [{ libelle: `<b>Site</b>`, href: "/l/abcDEF1" }],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Site</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(`href="/l/abcDEF1"`);
    expect(html).toContain("&lt;b&gt;Site&lt;/b&gt;");
  });
  it("OpenGraph, langue, viewport", () => {
    const html = rendrePageSmartlink(base);
    expect(html).toContain(`<html lang="fr">`);
    expect(html).toContain(`property="og:title" content="Ma marque"`);
    expect(html).toContain(`property="og:description" content="Café &amp; thé"`);
    expect(html).toContain(`property="og:url" content="https://www.hellonaya.app/b/ma-marque"`);
    expect(html).toContain(`property="og:image" content="https://cdn.x/a.jpg"`);
    expect(html).toContain("width=device-width");
  });
  it("écarte les href et images non sûrs, et les couleurs non hexadécimales", () => {
    const html = rendrePageSmartlink({
      ...base,
      avatarUrl: "javascript:alert(1)",
      theme: { couleurFond: "red;}</style><script>", couleurTexte: "#112233" },
      boutons: [{ libelle: "x", href: "javascript:alert(1)" }],
      tuiles: [{ imageUrl: "http://pas-https/a.jpg", href: null }, { imageUrl: "https://cdn.x/t.jpg", href: "data:text/html,x" }],
    });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).not.toContain("http://pas-https");
    expect(html).not.toContain("</style><script>");
    expect(html).toContain("#112233");
    expect(html).toContain(`<div class="tuile"><img src="https://cdn.x/t.jpg"`);
  });
  it("tuile cliquable vers son lien court", () => {
    const html = rendrePageSmartlink({ ...base, tuiles: [{ imageUrl: "https://cdn.x/t.jpg", href: "/l/zzzzzzz" }] });
    expect(html).toContain(`<a class="tuile" href="/l/zzzzzzz" rel="noopener">`);
  });
});
