// La pilule des 5 espaces : verticale à gauche au-dessus de 768 px, horizontale en bas en
// dessous. Un seul rendu pour les deux tailles (pas de doublon pour le clavier ni les
// lecteurs d'écran) : seules les classes changent.
import { useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useTranslation } from "react-i18next";
import { LayoutGrid, LineChart, LogOut, Languages, PenLine, Search, Settings, Sun, Telescope, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLanguageToggle } from "@/hooks/useLanguageToggle";
import { useProject } from "@/lib/project-context";
import { ESPACES, espaceDuChemin, type EspaceId } from "@/lib/espaces";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const ICONES: Record<EspaceId, LucideIcon> = {
  aujourdhui: Sun,
  projets: LayoutGrid,
  creer: PenLine,
  veille: Telescope,
  chiffres: LineChart,
};

// Classe posée sur <body> : sous 768 px, index.css y réserve la hauteur de la pilule du bas.
export const CLASSE_PILULE_BAS = "pilule-en-bas";

// Bouton rond de 44 px ; anneau clair visible sur le fond sombre de la pilule.
const ROND =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary";

export default function PiluleNavigation({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  const { setActiveProjectId } = useProject();
  const { current: langue, toggle: basculerLangue } = useLanguageToggle();
  const telephone = useIsMobile();
  const recherche = useSearch();
  // La requête compte : /projects/4?onglet=veille appartient à l'espace Veille.
  const actif = espaceDuChemin(recherche ? `${location}?${recherche}` : location)?.espace ?? null;
  const cote = telephone ? "top" : "right";
  const initiale = user?.firstName?.charAt(0) || user?.email?.charAt(0) || "N";

  useEffect(() => {
    document.body.classList.add(CLASSE_PILULE_BAS);
    return () => document.body.classList.remove(CLASSE_PILULE_BAS);
  }, []);

  return (
    <nav
      aria-label={t("navigation.espaces")}
      className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-full bg-primary p-1.5 shadow-cocon md:static md:inset-auto md:flex-col md:justify-start md:gap-1"
    >
      {ESPACES.map((espace) => {
        const Icone = ICONES[espace.id];
        const estActif = espace.id === actif;
        const nom = t(espace.cle);
        return (
          <Tooltip key={espace.id} delayDuration={200}>
            <TooltipTrigger asChild>
              <Link
                href={espace.href}
                aria-label={nom}
                aria-current={estActif ? "page" : undefined}
                // L'accueil ramène toujours à la vue globale, comme l'ancien logo.
                onClick={() => { if (espace.href === "/") setActiveProjectId(null); }}
                className={cn(
                  ROND,
                  estActif
                    ? "bg-[var(--fond)] text-primary"
                    : "text-primary-foreground hover:bg-primary-foreground/15",
                )}
              >
                <Icone className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side={cote}>{nom}</TooltipContent>
          </Tooltip>
        );
      })}

      <span aria-hidden="true" className="hidden md:my-1 md:block md:h-px md:w-6 md:bg-primary-foreground/20" />

      {onSearchClick && (
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSearchClick}
              aria-label={t("navigation.rechercher")}
              className={cn(ROND, "text-primary-foreground hover:bg-primary-foreground/15")}
            >
              <Search className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side={cote}>{t("navigation.rechercher")}</TooltipContent>
        </Tooltip>
      )}

      {/* Avatar : Réglages, langue, déconnexion. */}
      <DropdownMenu>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              aria-label={t("navigation.compte")}
              className={cn(
                ROND,
                location === "/settings"
                  ? "bg-[var(--fond)] text-primary"
                  : "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25",
              )}
            >
              <span className="text-[16px] font-semibold leading-none" aria-hidden="true">{initiale.toUpperCase()}</span>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={cote}>{t("navigation.compte")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent side={cote} align="end" sideOffset={12} className="w-56">
          {(user?.firstName || user?.email) && (
            <>
              <DropdownMenuLabel className="truncate text-[13px] font-semibold text-muted-foreground">
                {user?.firstName || user?.email}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onClick={() => navigate("/settings")}>
            <Settings className="mr-2 h-4 w-4" strokeWidth={1.75} />
            {t("navigation.reglages")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={basculerLangue}>
            <Languages className="mr-2 h-4 w-4" strokeWidth={1.75} />
            {/* Libellé dans la langue d'arrivée, comme l'ancien bouton EN/FR. */}
            <span lang={langue === "en" ? "fr" : "en"}>{t("navigation.autreLangue")}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" strokeWidth={1.75} />
            {t("navigation.deconnexion")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
