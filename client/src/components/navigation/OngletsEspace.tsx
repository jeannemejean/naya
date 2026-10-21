// Les onglets en pilule de l'espace courant, en tête du contenu de chaque page. Rien hors
// espace (Réglages, adresse inconnue). Dans Projets (hors page d'un projet), le choix du
// projet actif s'y ajoute.
import { Link, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { ESPACES, espaceDuChemin, estPageProjet, ongletsVisibles } from "@/lib/espaces";
import { cn } from "@/lib/utils";
import SelecteurProjet from "./SelecteurProjet";

export default function OngletsEspace() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { user } = useAuth();
  const recherche = useSearch();
  // La requête compte : /projects/4?onglet=veille appartient à l'espace Veille.
  const position = espaceDuChemin(recherche ? `${location}?${recherche}` : location);
  const espace = position ? ESPACES.find((e) => e.id === position.espace) : undefined;
  if (!position || !espace) return null;

  const onglets = ongletsVisibles(espace, user?.role === "owner");

  return (
    <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-4 sm:px-6">
      <nav aria-label={t(espace.cle)} className="-ml-1 min-w-0 flex-1 overflow-x-auto">
        {/* Marge intérieure : l'anneau de focus ne doit pas être rogné par le défilement. */}
        <ul className="flex w-max items-center gap-2 p-1">
          {onglets.map((o) => {
            const estActif = o.id === position.onglet;
            return (
              <li key={o.id}>
                <Link
                  href={o.href}
                  aria-current={estActif ? "page" : undefined}
                  className={cn(
                    "inline-flex h-11 items-center whitespace-nowrap rounded-full px-4 text-[16px] font-semibold transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    estActif
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-card hover:text-foreground",
                  )}
                >
                  {t(o.cle)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Une page projet a déjà son propre sélecteur (le nom du projet). */}
      {espace.id === "projets" && !estPageProjet(location) && <SelecteurProjet />}
    </div>
  );
}
