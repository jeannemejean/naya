import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

export default function Welcome() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("Activation de ton abonnement…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await apiRequest("GET", "/api/billing/sync"); } catch {}
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          const res = await apiRequest("GET", "/api/auth/user");
          const user = await res.json();
          if (user?.access?.allowed) {
            await qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
            window.location.href = "/";
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setMsg("Ça prend un peu plus longtemps que prévu. Recharge la page dans un instant.");
    })();
    return () => { cancelled = true; };
  }, [qc]);

  return (
    <div className="min-h-screen flex items-center justify-center naya-paper px-6">
      <p className="text-naya-olive-70">{msg}</p>
    </div>
  );
}
