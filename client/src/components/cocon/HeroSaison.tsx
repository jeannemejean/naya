import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useApparence } from "@/hooks/useApparence";
import { PALETTES, photoDuJour } from "@shared/saisons";
import { DecorSaison } from "./DecorSaison";

// Dégradé espresso à gauche : le texte blanc est toujours posé sur un voile (spec, règle 5).
const VOILE = "linear-gradient(90deg, rgba(46,42,36,.62), rgba(46,42,36,.08) 70%)";

// La couleur de saison est là tout de suite ; la photo arrive en fondu par-dessus, sans saut de mise en page.
function PhotoSaison({ src }: { src: string }) {
  const [chargee, setChargee] = useState(false);
  return (
    <img
      src={src}
      alt=""
      width={1600}
      height={900}
      decoding="async"
      // une image déjà en cache peut être complète avant que onLoad ne soit branché
      ref={(el) => { if (el?.complete && el.naturalWidth > 0) setChargee(true); }}
      onLoad={() => setChargee(true)}
      className={cn(
        "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
        chargee ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

export function HeroSaison({ className, children }: { className?: string; children: ReactNode }) {
  const { apparence, saison, fuseau } = useApparence();
  const photo = photoDuJour(saison, new Date(), fuseau);

  return (
    <div
      className={cn("relative isolate min-h-[200px] overflow-hidden rounded-bloc md:min-h-[240px]", className)}
      style={{ backgroundColor: PALETTES[saison].touche1 }}
    >
      {/* key : nouvel état « pas encore chargée » à chaque changement de photo */}
      {photo && <PhotoSaison key={photo} src={photo} />}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: VOILE }} />
      {apparence.decor && <DecorSaison saison={saison} />}
      <div className="relative">{children}</div>
    </div>
  );
}

export default HeroSaison;
