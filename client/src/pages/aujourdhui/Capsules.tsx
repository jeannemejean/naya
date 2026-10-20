// La rangée de capsules. Chacune charge ses données seule et disparaît si sa requête échoue
// ou n'a rien à dire ; la rangée défile au trackpad, au doigt et au clavier (capsules = liens).
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { capsuleCampagne, capsulesAffichables, chiffreCle } from "./logique";

type TacheSemaine = { id: number; completed: boolean; type?: string; source?: string };

function Capsule({ href, className, style, children }: {
  href: string; className?: string; style?: React.CSSProperties; children: ReactNode;
}) {
  return (
    <li className="shrink-0 snap-start">
      <Link
        href={href}
        style={style}
        // Arrondi haut en dôme (moitié de la largeur), bas en arrondi de carte.
        className={cn(
          "flex h-[120px] w-[104px] flex-col justify-end gap-0.5 rounded-b-carte rounded-t-[52px] bg-card px-3 pb-3 text-foreground shadow-cocon transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className,
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function CapsuleSemaine({ lundi, dimanche, activeProjectId }: { lundi: string; dimanche: string; activeProjectId: number | null }) {
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
  // Les jalons virtuels du planning ne sont pas des tâches.
  const vraies = data.filter((x) => x.type !== "milestone" && x.source !== "milestone");
  if (vraies.length === 0) return null;
  const faites = vraies.filter((x) => x.completed).length;
  return (
    <Capsule href="/planning">
      <span className="text-[13px] text-muted-foreground">{t("accueil.capsules.semaine")}</span>
      <span className="whitespace-nowrap text-[17px] font-semibold leading-tight">{t("accueil.capsules.semaineValeur", { faites, total: vraies.length })}</span>
      <span className="text-[13px] text-muted-foreground">{t("accueil.capsules.semaineDetail")}</span>
    </Capsule>
  );
}

function CapsuleCampagne({ aujourdhui }: { aujourdhui: string }) {
  const { t } = useTranslation();
  const { data, isSuccess } = useQuery<Array<{ name: string; status: string | null; endDate: string | null }>>({
    queryKey: ["/api/campaigns"],
    retry: false,
    throwOnError: false,
  });
  const c = isSuccess && Array.isArray(data) ? capsuleCampagne(data, aujourdhui) : null;
  if (!c) return null;
  return (
    <Capsule href="/campaigns" style={{ background: "var(--motif)" }}>
      <span className="text-[13px] text-muted-foreground">{t("accueil.capsules.campagne")}</span>
      <span className="line-clamp-2 break-words text-[13px] font-semibold leading-snug">{c.nom}</span>
      <span className="text-[13px] text-muted-foreground">{t("accueil.capsules.jusquau", { date: c.fin })}</span>
    </Capsule>
  );
}

function CapsuleVeille({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { data, isSuccess } = useQuery<{ tendances?: Array<{ statut: string }> }>({
    queryKey: [`/api/profils-veille/projet/${projectId}`],
    retry: false,
    throwOnError: false,
  });
  const nouvelles = isSuccess && Array.isArray(data?.tendances) ? data!.tendances!.filter((x) => x.statut === "nouveau").length : 0;
  if (nouvelles === 0) return null;
  return (
    <Capsule href="/veille">
      <span className="text-[13px] text-muted-foreground">{t("accueil.capsules.veille")}</span>
      <span className="text-[22px] font-semibold leading-tight">{nouvelles}</span>
      <span className="text-[13px] leading-snug text-muted-foreground">{t("accueil.capsules.tendances", { count: nouvelles })}</span>
    </Capsule>
  );
}

function CapsuleChiffres({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { data, isSuccess } = useQuery<unknown>({
    queryKey: [`/api/mesure/${projectId}`],
    retry: false,
    throwOnError: false,
  });
  const chiffre = isSuccess ? chiffreCle(data) : null;
  if (!chiffre) return null;
  const nom = t(`mesure.indicateurs.${chiffre.libelle}.nom`, { defaultValue: chiffre.libelle });
  return (
    <Capsule href="/mesure" className="bg-primary text-primary-foreground">
      <span className="line-clamp-2 text-[13px] leading-snug">{nom}</span>
      <span className="text-[22px] font-semibold leading-tight">{chiffre.variation}</span>
      <span className="text-[13px]">{t("accueil.capsules.variation")}</span>
    </Capsule>
  );
}

export function Capsules({ aujourdhui, lundi, dimanche, activeProjectId }: {
  aujourdhui: string; lundi: string; dimanche: string; activeProjectId: number | null;
}) {
  const { t } = useTranslation();
  const affichables = capsulesAffichables(activeProjectId);
  return (
    // Marges négatives : la rangée déborde jusqu'au bord droit de l'écran (indice de défilement).
    <section aria-label={t("accueil.capsules.region")} className="-mr-4 sm:-mr-6 lg:mr-0">
      <ul className="flex snap-x gap-3 overflow-x-auto overscroll-x-contain p-1 pb-3 pr-4 sm:pr-6 [scrollbar-width:thin]">
        <CapsuleSemaine lundi={lundi} dimanche={dimanche} activeProjectId={activeProjectId} />
        <CapsuleCampagne aujourdhui={aujourdhui} />
        {/* Mode « tous les projets » : aucune requête vers la veille ni la mesure. */}
        {affichables.veille && activeProjectId !== null && <CapsuleVeille projectId={activeProjectId} />}
        {affichables.chiffres && activeProjectId !== null && <CapsuleChiffres projectId={activeProjectId} />}
      </ul>
    </section>
  );
}

export default Capsules;
