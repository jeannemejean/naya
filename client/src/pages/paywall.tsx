import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

export default function Paywall() {
  const qc = useQueryClient();
  const { logout } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function subscribe() {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/checkout");
      const { url } = await res.json();
      if (url) { window.location.href = url; return; }
      setError("Impossible de démarrer l'abonnement.");
    } catch {
      setError("Impossible de démarrer l'abonnement.");
    }
    setLoading(false);
  }

  async function redeem() {
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/billing/redeem-code", { code });
      if (!res.ok) { setError("Code invalide ou déjà utilisé."); return; }
      await qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.href = "/";
    } catch {
      setError("Code invalide ou déjà utilisé.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center naya-paper px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="font-display uppercase text-naya-olive mb-3" style={{ fontSize: "1.8rem", letterSpacing: "0.06em" }}>
          Accède à Naya
        </h1>
        <p className="text-naya-olive-70 mb-8">29 €/mois · 7 jours d'essai gratuit, sans engagement.</p>

        <button
          onClick={subscribe}
          disabled={loading}
          className="w-full rounded-lg bg-naya-olive text-naya-cream py-3 font-medium mb-6 disabled:opacity-60"
        >
          {loading ? "…" : "Commencer l'essai gratuit"}
        </button>

        <div className="flex items-center gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code d'accès (testeurs)"
            className="flex-1 rounded-md border border-naya-olive-18 bg-background px-3 py-2 text-sm"
          />
          <button onClick={redeem} className="rounded-md border border-naya-olive-18 px-3 py-2 text-sm">
            Valider
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <button onClick={logout} className="mt-8 text-xs text-naya-olive-35 hover:text-naya-olive">
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
