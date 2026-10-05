import { Component, createElement as h, type ReactNode, type CSSProperties } from "react";
import { oublierMarqueStockee } from "@/lib/marque-active-stockee";

// Écran affiché quand une erreur non gérée remonte (crash de rendu, ou erreur de query
// propagée). Jamais de page blanche / crash brut. Écrit en createElement (pas de JSX)
// pour rester transformable par tous les outils (vitest/oxc inclus).
const wrap: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  minHeight: "100vh", gap: 16, padding: 24, textAlign: "center",
  background: "var(--background, #F7F4EC)", fontFamily: "Inter, system-ui, sans-serif",
};

export function ErrorScreen({ onRetry }: { onRetry?: () => void }) {
  return h("div", { role: "alert", style: wrap },
    h("img", { src: "/naya-mark-elephant.png", alt: "", width: 56, height: 56, style: { objectFit: "contain", opacity: 0.9 } }),
    h("h2", { style: { fontSize: "1.25rem", fontWeight: 600, color: "#2B2D1C", margin: 0 } },
      "Naya cherche la meilleure réponse…"),
    h("p", { style: { fontSize: "0.9rem", color: "rgba(43,45,28,0.55)", maxWidth: 360, margin: 0 } },
      "Un petit accroc de notre côté. Réessaie dans un instant — tes données sont en sécurité."),
    h("button", {
      onClick: onRetry ?? (() => window.location.reload()),
      style: { marginTop: 8, padding: "8px 20px", borderRadius: 10, border: "none", background: "#2B2D1C", color: "#F7F4EC", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" },
    }, "Réessayer"),
  );
}

interface State { hasError: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("[ErrorBoundary] Uncaught error:", error, info);
  }

  handleRetry = () => {
    // « Réessayer » doit CHANGER quelque chose, sinon c'est un bouton qui ne peut pas
    // réussir — et on a déjà corrigé ce défaut ailleurs dans ce dépôt.
    //
    // Le 5 octobre 2026, après une réinitialisation de compte, le navigateur gardait
    // l'identifiant d'une marque supprimée. Au rechargement il était relu avant que le
    // serveur ait pu dire la vérité, les requêtes partaient sur une marque inexistante,
    // l'erreur remontait ici, et « Réessayer » rechargeait dans le MÊME état. Boucle
    // parfaite, dont on ne sortait qu'en vidant le stockage à la main.
    //
    // On oublie donc la marque active avant de recharger. Le coût est nul : le serveur
    // la renvoie au chargement suivant si elle existe encore. Et c'est volontairement
    // indépendant de l'erreur rencontrée — on ne sait pas laquelle a échoué, et le
    // geste doit marcher quelle que soit la cause.
    oublierMarqueStockee(window.localStorage);
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return h(ErrorScreen, { onRetry: this.handleRetry });
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
