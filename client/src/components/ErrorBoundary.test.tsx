import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary, ErrorScreen } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("l'écran d'erreur affiche « Naya cherche la meilleure réponse… »", () => {
    const html = renderToStaticMarkup(createElement(ErrorScreen));
    expect(html).toContain("Naya cherche la meilleure réponse");
    expect(html).toContain("Réessayer");
  });

  it("getDerivedStateFromError bascule en hasError (→ l'écran sera rendu)", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it("rend normalement les enfants quand il n'y a pas d'erreur", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, null, createElement("div", null, "CONTENU OK")),
    );
    expect(html).toContain("CONTENU OK");
    expect(html).not.toContain("Naya cherche la meilleure réponse");
  });
});
