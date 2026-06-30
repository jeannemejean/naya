import { useEffect, useState } from "react";

// Vrai quand l'onglet est visible/au premier plan. Sert à METTRE EN PAUSE les pollings
// (refetchInterval) quand l'utilisateur n'est pas sur la page — pas de requêtes inutiles.
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    window.addEventListener("focus", onChange);
    window.addEventListener("blur", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      window.removeEventListener("focus", onChange);
      window.removeEventListener("blur", onChange);
    };
  }, []);

  return visible;
}
