import { useEffect, useState } from "react";

const DEFAULT_MESSAGES = [
  "Naya analyse tes projets…",
  "Elle priorise ce qui compte cette semaine…",
  "Elle cale tes tâches dans ton planning…",
  "Presque prêt…",
];

/**
 * Overlay plein écran affiché pendant une génération longue (tâches / plan).
 * But : rendre l'attente visible et rassurante (animation + messages qui défilent)
 * pour que l'utilisateur comprenne que quelque chose se passe en arrière-plan.
 */
export default function GeneratingOverlay({
  open,
  title = "Naya prépare ton plan",
  messages = DEFAULT_MESSAGES,
}: {
  open: boolean;
  title?: string;
  messages?: string[];
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!open) {
      setIdx(0);
      return;
    }
    const id = setInterval(() => setIdx((i) => (i + 1) % messages.length), 2400);
    return () => clearInterval(id);
  }, [open, messages.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-naya-olive-06/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <style>{`
        @keyframes naya-loadbar { 0% { left: -40%; } 100% { left: 100%; } }
        @keyframes naya-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      `}</style>
      <div className="bg-white rounded-2xl shadow-2xl border border-naya-olive-10 px-10 py-12 max-w-sm w-[88%] text-center">
        {/* Éléphant qui flotte + halo qui pulse */}
        <div className="relative mx-auto mb-7 w-20 h-20 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" />
          <span className="absolute inset-3 rounded-full bg-primary/10 animate-pulse" />
          <img
            src="/naya-mark-elephant.png"
            alt=""
            className="relative w-12 h-12 object-contain"
            style={{ animation: "naya-float 2s ease-in-out infinite" }}
          />
        </div>

        <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
        <p
          key={idx}
          className="text-sm text-naya-olive-55 min-h-[20px] transition-opacity duration-300"
        >
          {messages[idx]}
        </p>

        {/* Barre de progression indéterminée (ne reste jamais figée) */}
        <div className="mt-6 relative h-1.5 w-full rounded-full bg-naya-olive-10 overflow-hidden">
          <span
            className="absolute top-0 h-full w-2/5 rounded-full bg-primary"
            style={{ animation: "naya-loadbar 1.3s ease-in-out infinite" }}
          />
        </div>
      </div>
    </div>
  );
}
