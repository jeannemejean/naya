import { describe, it, expect } from "vitest";
import { scriptPrincipal, nouvelleVersionDisponible } from "./nouvelle-version";

const html = (src: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${src}"></script></head><body></body></html>`;

describe("scriptPrincipal", () => {
  it("extrait le bundle principal construit par Vite", () => {
    expect(scriptPrincipal(html("/assets/index-yxjfPvOO.js"))).toBe("/assets/index-yxjfPvOO.js");
  });
  it("ignore les autres scripts et rend null sans bundle (mode dev)", () => {
    expect(scriptPrincipal(html("/src/main.tsx"))).toBeNull();
    expect(scriptPrincipal("")).toBeNull();
  });
  it("accepte une URL absolue", () => {
    expect(scriptPrincipal(html("https://www.hellonaya.app/assets/index-AbC_12-x.js"))).toBe("/assets/index-AbC_12-x.js");
  });
});

describe("nouvelleVersionDisponible", () => {
  it("vrai quand le serveur sert un autre bundle que celui chargé", () => {
    expect(nouvelleVersionDisponible("/assets/index-old.js", html("/assets/index-new.js"))).toBe(true);
  });
  it("faux quand c'est le même bundle", () => {
    expect(nouvelleVersionDisponible("/assets/index-same.js", html("/assets/index-same.js"))).toBe(false);
  });
  it("faux quand on ne sait pas (dev, page illisible, bundle courant inconnu)", () => {
    expect(nouvelleVersionDisponible(null, html("/assets/index-new.js"))).toBe(false);
    expect(nouvelleVersionDisponible("/assets/index-old.js", "<html>erreur</html>")).toBe(false);
  });
});
