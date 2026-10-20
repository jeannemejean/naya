// « En un coup d'œil » : une carte, une ligne par repère (semaine, campagne, veille,
// chiffres). Chaque ligne charge ses données seule et disparaît si sa requête échoue ou n'a
// rien à dire ; sans aucune ligne, la carte n'est pas rendue du tout.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { CalendarDays, ChevronRight, LineChart, Megaphone, Telescope, type LucideIcon } from "lucide-react";
import { estEvenementAgenda } from "@/lib/agenda-api";
import { capsuleCampagne, capsulesAffichables, chiffreCle } from "./logique";

type TacheSemaine = { id: number; completed: boolean; type?: string; source?: string };

// Toutes les lignes ont la même grille : rond d'icône de 40 px, texte, chevron. Les icônes
// tombent ainsi sur une seule colonne, quelle que soit la longueur des textes.
function Capsule({ href, icone: Icone, titre, valeur, detail, children }: {
  href: string; icone: LucideIcon; titre: string; valeur: ReactNode; detail?: ReactNode; children?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-[64px] items-center gap-3 rounded-champ px-3 py-3 transition-colors duration-150 hover:bg-[rgba(239,231,217,0.55)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
          <Icone className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-muted-foreground">{titre}</span>
          <span className="block truncate text-[16px] font-semibold leading-snug text-foreground">{valeur}</span>
          {detail && <span className="block truncate text-[13px] text-muted-foreground">{detail}</span>}
          {children}
        </span>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </Link>
    </li>
  );
}

// Chaque capsule est un hook : il rend son contenu, ou null si sa requête échoue ou n'a rien
// à dire. Le parent sait ainsi s'il reste au moins une capsule avant de poser la section.

function useCapsuleSemaine(lundi: string, dimanche: string, activeProjectId: number | null): ReactNode {
  const { t } = useTranslation();
  const url = `/api/tasks/range?start=${lundi}&end=${dimanche}${activeProjectId ? `&projectId=${activeProjectId}` : ""}`;
  const { data, isSuccess } = useQuery<TacheSemaine[]>({
    // préfixe /api/tasks/range : suit le cochage optimiste et ses invalidations
    queryKey: ["/api/tasks/range", { start: lundi, end: dimanche, ...(activeProjectId ? { projectId: activeProjectId } : {}), scope: "semaine-accueil" }],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    retry: false,
    throwOnError: false,
  });
  if (!isSuccess || !Array.isArray(data)) return null;
  // Ni les jalons virtuels du planning ni les événements d'agenda ne sont des tâches (même règle que le fil).
  const vraies = data.filter((x) => x.type !== "milestone" && x.source !== "milestone" && !estEvenementAgenda(x));
  if (vraies.length === 0) return null;
  const faites = vraies.filter((x) => x.completed).length;
  return (
    <Capsule key="semaine" href="/semaine" icone={CalendarDays} titre={t("accueil.capsules.semaine")}
      valeur={t("accueil.capsules.semaineValeur", { faites, total: vraies.length })}>
      <span aria-hidden="true" className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((faites / vraies.length) * 100)}%` }} />
      </span>
    </Capsule>
  );
}

function useCapsuleCampagne(aujourdhui: string): ReactNode {
  const { t, i18n } = useTranslation();
  const { data, isSuccess } = useQuery<Array<{ name: string; status: string | null; endDate: string | null }>>({
    queryKey: ["/api/campaigns"],
    retry: false,
    throwOnError: false,
  });
  const locale = i18n.language === "en" ? "en-GB" : "fr-FR";
  const c = isSuccess && Array.isArray(data) ? capsuleCampagne(data, aujourdhui, locale) : null;
  if (!c) return null;
  return (
    <Capsule key="campagne" href="/campaigns" icone={Megaphone} titre={t("accueil.capsules.campagne")}
      valeur={c.nom} detail={t("accueil.capsules.jusquau", { date: c.fin })} />
  );
}

// `actif` faux (mode « tous les projets ») : la requête n'est jamais envoyée.
function useCapsuleVeille(projectId: number | null, actif: boolean): ReactNode {
  const { t } = useTranslation();
  const { data, isSuccess } = useQuery<{ tendances?: Array<{ statut: string }> }>({
    queryKey: [`/api/profils-veille/projet/${projectId}`],
    enabled: actif && projectId !== null,
    retry: false,
    throwOnError: false,
  });
  const nouvelles = actif && isSuccess && Array.isArray(data?.tendances) ? data!.tendances!.filter((x) => x.statut === "nouveau").length : 0;
  if (nouvelles === 0) return null;
  return (
    <Capsule key="veille" href="/veille" icone={Telescope} titre={t("accueil.capsules.veille")}
      valeur={`${nouvelles} ${t("accueil.capsules.tendances", { count: nouvelles })}`} />
  );
}

function useCapsuleChiffres(projectId: number | null, actif: boolean): ReactNode {
  const { t } = useTranslation();
  const { data, isSuccess } = useQuery<unknown>({
    queryKey: [`/api/mesure/${projectId}`],
    enabled: actif && projectId !== null,
    retry: false,
    throwOnError: false,
  });
  const chiffre = actif && isSuccess ? chiffreCle(data) : null;
  if (!chiffre) return null;
  const nom = t(`mesure.indicateurs.${chiffre.libelle}.nom`, { defaultValue: chiffre.libelle });
  return (
    <Capsule key="chiffres" href="/mesure" icone={LineChart} titre={nom}
      valeur={chiffre.variation} detail={t("accueil.capsules.variation")} />
  );
}

export function Capsules({ aujourdhui, lundi, dimanche, activeProjectId }: {
  aujourdhui: string; lundi: string; dimanche: string; activeProjectId: number | null;
}) {
  const { t } = useTranslation();
  const affichables = capsulesAffichables(activeProjectId);
  const capsules = [
    useCapsuleSemaine(lundi, dimanche, activeProjectId),
    useCapsuleCampagne(aujourdhui),
    useCapsuleVeille(activeProjectId, affichables.veille),
    useCapsuleChiffres(activeProjectId, affichables.chiffres),
  ].filter(Boolean);
  if (capsules.length === 0) return null;
  return (
    <section aria-labelledby="capsules-titre" className="rounded-carte bg-card p-3 shadow-cocon">
      <h2 id="capsules-titre" className="px-3 pb-1 pt-2 text-[13px] font-semibold text-muted-foreground">{t("accueil.capsules.region")}</h2>
      <ul>{capsules}</ul>
    </section>
  );
}

export default Capsules;
