import { useEffect, useState, type CSSProperties } from "react";
import type { Saison } from "@shared/saisons";

// Décor animé de saison, confiné au bloc qui le contient (HeroSaison).
// SVG + @keyframes (section « Décor de saison » de index.css), aucune librairie.
// Tout le mouvement est lent (6 à 12 s) et décalé : une ambiance, pas une animation qui attire l'œil.

// Pseudo-aléatoire déterministe : les positions ne changent pas d'un rendu à l'autre.
function alea(i: number, graine: number): number {
  const x = Math.sin(i * 12.9898 + graine * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const entre = (min: number, max: number, t: number) => min + (max - min) * t;

// Variables CSS lues par les keyframes ; délai négatif pour que le décor soit déjà en place au chargement.
function vars(v: Record<string, string>): CSSProperties {
  return v as CSSProperties;
}

const COULEURS_FEUILLE = ["#C07A47", "#D9B98A", "#E2A35F"];
const COULEURS_PETALE = ["#F3E2A0", "#F2D3CF", "#F7EAC0"];

function Feuilles() {
  return (
    <>
      {Array.from({ length: 7 }, (_, i) => {
        const duree = entre(9, 12, alea(i, 1));
        const taille = Math.round(entre(18, 26, alea(i, 2)));
        return (
          <span
            key={i}
            className="decor-mobile decor-chute"
            style={vars({
              left: `${entre(4, 92, (i + alea(i, 3)) / 7)}%`,
              "--duree": `${duree}s`,
              "--delai": `-${entre(0, duree, alea(i, 4))}s`,
            })}
          >
            <span className="decor-feuille" style={vars({ "--duree": `${entre(6, 8, alea(i, 5))}s` })}>
              <svg width={taille} height={taille} viewBox="0 0 24 24" style={{ opacity: 0.88 }}>
                <path d="M12 2C18.5 6 20.5 13.5 12 22C3.5 13.5 5.5 6 12 2Z" fill={COULEURS_FEUILLE[i % 3]} />
                <path d="M12 5V20" stroke="rgba(46,42,36,.22)" strokeWidth="1" strokeLinecap="round" />
              </svg>
            </span>
          </span>
        );
      })}
    </>
  );
}

function Flocons() {
  return (
    <>
      {Array.from({ length: 24 }, (_, i) => {
        const duree = entre(7, 12, alea(i, 11));
        const rayon = entre(1.5, 3.5, alea(i, 12));
        return (
          <span
            key={i}
            className="decor-mobile decor-chute"
            style={vars({
              left: `${entre(1, 98, (i + alea(i, 13)) / 24)}%`,
              "--duree": `${duree}s`,
              "--delai": `-${entre(0, duree, alea(i, 14))}s`,
            })}
          >
            <span className="decor-flocon" style={vars({ "--duree": `${entre(6, 9, alea(i, 15))}s` })}>
              <svg width={rayon * 2 + 2} height={rayon * 2 + 2} viewBox={`0 0 ${rayon * 2 + 2} ${rayon * 2 + 2}`}>
                <circle cx={rayon + 1} cy={rayon + 1} r={rayon} fill="#FFFFFF" opacity={entre(0.5, 0.85, alea(i, 16))} />
              </svg>
            </span>
          </span>
        );
      })}
    </>
  );
}

// Fixe en bas à droite, jamais animé : c'est lui qui reste sous prefers-reduced-motion.
function BonhommeDeNeige() {
  return (
    <svg className="decor-bonhomme" width="44" height="44" viewBox="0 0 44 44">
      <circle cx="22" cy="32" r="11" fill="#FFFDF8" stroke="rgba(46,42,36,.12)" />
      <circle cx="22" cy="14.5" r="8" fill="#FFFDF8" stroke="rgba(46,42,36,.12)" />
      {/* écharpe caramel, avec un pan qui tombe */}
      <path d="M14.5 20.5Q22 24 29.5 20.5V23.5Q22 27 14.5 23.5Z" fill="#C07A47" />
      <path d="M25 23.5L27.5 23L28.5 30L25.8 30.4Z" fill="#B06C3C" />
      <circle cx="19.2" cy="13" r="1.1" fill="#2E2A24" />
      <circle cx="24.8" cy="13" r="1.1" fill="#2E2A24" />
      <path d="M22 15L27 16.4L22 17.2Z" fill="#E2853A" />
      <circle cx="22" cy="30" r="0.9" fill="#2E2A24" opacity=".7" />
      <circle cx="22" cy="34" r="0.9" fill="#2E2A24" opacity=".7" />
    </svg>
  );
}

function Petales() {
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => {
        const duree = entre(9, 12, alea(i, 21));
        const taille = Math.round(entre(12, 16, alea(i, 22)));
        return (
          <span
            key={i}
            className="decor-mobile decor-chute"
            style={vars({
              // un peu décalés vers la gauche : ils dérivent vers la droite en tombant
              left: `${entre(-6, 82, (i + alea(i, 23)) / 8)}%`,
              "--duree": `${duree}s`,
              "--delai": `-${entre(0, duree, alea(i, 24))}s`,
            })}
          >
            {/* hérite --duree et --delai de la chute : la dérive suit la descente, en diagonale */}
            <span className="decor-petale">
              <svg width={taille} height={Math.round(taille * 1.4)} viewBox="0 0 20 28" style={{ opacity: 0.9 }}>
                <path d="M10 1C16 6 16.5 18 10 27C3.5 18 4 6 10 1Z" fill={COULEURS_PETALE[i % 3]} />
              </svg>
            </span>
          </span>
        );
      })}
    </>
  );
}

// Taches de lumière dorée, floues, qui ondulent comme le soleil à travers un rideau.
// Placées hors de la zone de texte (à gauche) : elles éclaircissent le fond, donc le contraste.
// Sous 768 px, le texte occupe toute la largeur du héros (mesuré à 375 px : de bord à bord,
// du haut jusqu'au bouton) : aucune place ne l'évite, les reflets y sont donc masqués.
function Reflets() {
  const places = [
    { left: "30%", top: "6%", taille: 150 },
    { left: "46%", top: "52%", taille: 110 },
    { left: "62%", top: "6%", taille: 170 },
    { left: "80%", top: "52%", taille: 120 },
  ];
  return (
    <>
      {places.map((p, i) => (
        <span
          key={i}
          className="decor-mobile decor-reflet max-md:hidden"
          style={vars({
            left: p.left,
            top: p.top,
            width: `${p.taille}px`,
            height: `${Math.round(p.taille * 0.7)}px`,
            "--duree": `${entre(8, 12, alea(i, 31))}s`,
            "--delai": `-${entre(0, 8, alea(i, 32))}s`,
          })}
        />
      ))}
    </>
  );
}

export function DecorSaison({ saison }: { saison: Saison }) {
  // Onglet caché : on fige les animations plutôt que de les faire tourner pour personne.
  const [cache, setCache] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const surChangement = () => setCache(document.hidden);
    document.addEventListener("visibilitychange", surChangement);
    return () => document.removeEventListener("visibilitychange", surChangement);
  }, []);

  return (
    <div className="decor-saison" data-saison={saison} data-pause={cache ? "" : undefined} aria-hidden="true">
      {saison === "automne" && <Feuilles />}
      {saison === "hiver" && (
        <>
          <Flocons />
          <BonhommeDeNeige />
        </>
      )}
      {saison === "printemps" && <Petales />}
      {saison === "ete" && <Reflets />}
    </div>
  );
}

export default DecorSaison;
