// Page « Appels d'offres » (espace Projets, à côté de Prospection) : les marchés publics repérés,
// triés par date limite, avec le détail d'un appel d'offres à droite. Seuls le statut et les
// notes se modifient ici ; le reste vient de la veille (et de l'import Notion d'octobre 2026).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Landmark, Loader2, ExternalLink, ChevronDown, ChevronRight, X } from "lucide-react";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  STATUTS_AO, SCORES_AO, SEUIL_URGENCE_JOURS, estPasse, joursAvant, lienSur, type StatutAO, type ScoreAO,
} from "@shared/appels-offres";

type AppelOffres = {
  id: number;
  objet: string;
  acheteur: string | null;
  reference: string | null;
  procedure: string | null;
  dateLimite: string | null;
  dateReperage: string | null;
  departement: string | null;
  montantEstimeHt: string | null;
  scoreAdequation: ScoreAO | null;
  offresJmd: string[];
  statut: StatutAO;
  criteresPonderation: string | null;
  piecesExigees: string | null;
  bloquants: string | null;
  notes: string | null;
  lienAvis: string | null;
  lienDce: string | null;
  premierJet: string | null;
};

const CLE = "/api/appels-offres";
type Periode = "tous" | "a_venir" | "passes";

// Teintes claires uniquement : le texte reste olive foncé, lisible partout.
const COULEUR_SCORE: Record<ScoreAO, string> = {
  fort: "bg-naya-mauve/20 text-naya-olive border-naya-mauve/40",
  moyen: "bg-naya-sulphur/30 text-naya-olive border-naya-sulphur/60",
  faible: "bg-naya-olive-06 text-naya-olive-70 border-naya-olive-18",
};
const COULEUR_STATUT: Record<StatutAO, string> = {
  repere: "bg-naya-salvia/15 text-naya-olive",
  premier_jet_pret: "bg-naya-sulphur/30 text-naya-olive",
  en_redaction: "bg-naya-sulphur/30 text-naya-olive",
  depose: "bg-naya-salvia/25 text-naya-olive",
  gagne: "bg-naya-salvia/40 text-naya-olive",
  perdu: "bg-naya-olive-10 text-naya-olive-70",
  ecarte: "bg-naya-olive-06 text-naya-olive-55",
};

export default function AppelsOffresPage({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("en") ? "en-GB" : "fr-FR";
  const { data, isLoading, isError } = useQuery<AppelOffres[]>({ queryKey: [CLE] });
  const [filtreStatut, setFiltreStatut] = useState<StatutAO | "tous">("tous");
  const [filtreScore, setFiltreScore] = useState<ScoreAO | "tous">("tous");
  const [periode, setPeriode] = useState<Periode>("tous");
  const [passesOuverts, setPassesOuverts] = useState(false);
  const [choisi, setChoisi] = useState<number | null>(null);

  const { aVenir, passes } = useMemo(() => {
    const maintenant = new Date();
    const filtres = (data ?? []).filter((a) =>
      (filtreStatut === "tous" || a.statut === filtreStatut) && (filtreScore === "tous" || a.scoreAdequation === filtreScore));
    const temps = (a: AppelOffres) => (a.dateLimite ? new Date(a.dateLimite).getTime() : Number.POSITIVE_INFINITY);
    return {
      // À venir : le plus proche d'abord ; sans date à la fin.
      aVenir: filtres.filter((a) => !estPasse(a.dateLimite, maintenant)).sort((x, y) => temps(x) - temps(y)),
      // Passés : le plus récent d'abord.
      passes: filtres.filter((a) => estPasse(a.dateLimite, maintenant)).sort((x, y) => temps(y) - temps(x)),
    };
  }, [data, filtreStatut, filtreScore]);

  const selection = data?.find((a) => a.id === choisi) ?? null;
  const montrerAVenir = periode !== "passes";
  const montrerPasses = periode !== "a_venir";
  const passesDeplies = passesOuverts || periode === "passes";

  const formatDate = (d: string) => new Date(d).toLocaleString(locale, {
    timeZone: "Europe/Paris", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const formatMontant = (m: string | null) => (m == null ? null
    : new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(m)));

  const echeance = (a: AppelOffres) => {
    const n = joursAvant(a.dateLimite);
    if (n == null) return { texte: t("appelsOffres.sansDate"), classe: "text-naya-olive-55" };
    const texte = n === 0 ? t("appelsOffres.aujourdhui") : n > 0 ? t("appelsOffres.dansJours", { count: n }) : t("appelsOffres.ilYa", { count: -n });
    const urgent = n >= 0 && n < SEUIL_URGENCE_JOURS && !estPasse(a.dateLimite);
    return { texte, classe: urgent ? "text-naya-mauve font-semibold" : "text-naya-olive-55" };
  };

  const ligne = (a: AppelOffres) => {
    const e = echeance(a);
    const actif = a.id === choisi;
    return (
      <li key={a.id}>
        <button
          type="button"
          onClick={() => setChoisi(a.id)}
          data-testid={`ao-ligne-${a.id}`}
          className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${actif ? "border-naya-olive-35 bg-naya-olive-06" : "border-naya-olive-10 bg-card hover:bg-naya-olive-06"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground line-clamp-2">{a.objet}</p>
              {a.acheteur && <p className="text-xs text-naya-olive-55 mt-0.5 truncate">{a.acheteur}</p>}
            </div>
            <span className={`shrink-0 text-[11px] rounded-full px-2 py-0.5 ${COULEUR_STATUT[a.statut]}`}>
              {t(`appelsOffres.statuts.${a.statut}`)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {a.dateLimite && <span className="text-naya-olive-70">{formatDate(a.dateLimite)}</span>}
            <span className={e.classe}>{e.texte}</span>
            {a.montantEstimeHt && <span className="text-naya-olive-70">{formatMontant(a.montantEstimeHt)}</span>}
            {a.scoreAdequation && (
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${COULEUR_SCORE[a.scoreAdequation]}`}>
                {t(`appelsOffres.scores.${a.scoreAdequation}`)}
              </span>
            )}
            {a.offresJmd.map((o) => (
              <span key={o} className="rounded-full bg-naya-olive-06 border border-naya-olive-10 px-2 py-0.5 text-[10px] tracking-wide text-naya-olive-70">{o}</span>
            ))}
          </div>
        </button>
      </li>
    );
  };

  const vide = !isLoading && !isError && (data?.length ?? 0) === 0;
  const rienAvecFiltres = !vide && data && (montrerAVenir ? aVenir.length : 0) + (montrerPasses ? passes.length : 0) === 0;

  return (
    <div className="flex h-screen bg-background">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <OngletsEspace />
        <header className="bg-card border-b border-border px-6 py-4 flex-shrink-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Landmark className="h-5 w-5 text-naya-salvia" />
            {t("appelsOffres.titre")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("appelsOffres.description")}</p>
        </header>

        <main className="flex-1 overflow-hidden flex">
          <section className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="flex flex-wrap gap-3">
                <Filtre label={t("appelsOffres.filtres.statut")} valeur={filtreStatut} onChange={(v) => setFiltreStatut(v as StatutAO | "tous")}
                  options={[["tous", t("appelsOffres.filtres.tous")], ...STATUTS_AO.map((s) => [s, t(`appelsOffres.statuts.${s}`)] as [string, string])]} />
                <Filtre label={t("appelsOffres.filtres.score")} valeur={filtreScore} onChange={(v) => setFiltreScore(v as ScoreAO | "tous")}
                  options={[["tous", t("appelsOffres.filtres.tous")], ...SCORES_AO.map((s) => [s, t(`appelsOffres.scores.${s}`)] as [string, string])]} />
                <Filtre label={t("appelsOffres.filtres.periode")} valeur={periode} onChange={(v) => setPeriode(v as Periode)}
                  options={[["tous", t("appelsOffres.filtres.toutes")], ["a_venir", t("appelsOffres.filtres.aVenir")], ["passes", t("appelsOffres.filtres.passes")]]} />
              </div>

              {isLoading && (
                <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              )}
              {isError && <p className="text-sm text-naya-mauve">{t("appelsOffres.erreur")}</p>}
              {vide && <p className="text-sm text-muted-foreground py-6">{t("appelsOffres.vide")}</p>}
              {rienAvecFiltres && <p className="text-sm text-muted-foreground py-6">{t("appelsOffres.aucunFiltre")}</p>}

              {montrerAVenir && aVenir.length > 0 && (
                <div className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-naya-olive-55">{t("appelsOffres.aVenir")}</h2>
                  <ul className="space-y-2">{aVenir.map(ligne)}</ul>
                </div>
              )}

              {montrerPasses && passes.length > 0 && (
                <div className="space-y-2 pt-2">
                  <button type="button" onClick={() => setPassesOuverts((o) => !o)}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-naya-olive-55 hover:text-foreground">
                    {passesDeplies ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {t("appelsOffres.passesN", { n: passes.length })}
                  </button>
                  {passesDeplies && <ul className="space-y-2 opacity-90">{passes.map(ligne)}</ul>}
                </div>
              )}
            </div>
          </section>

          {selection ? (
            <aside className="fixed inset-0 z-40 bg-card overflow-y-auto lg:static lg:z-auto lg:w-[440px] lg:shrink-0 lg:border-l lg:border-border">
              <Detail key={selection.id} ao={selection} locale={locale} onFermer={() => setChoisi(null)} formatDate={formatDate} formatMontant={formatMontant} echeance={echeance} />
            </aside>
          ) : (
            <aside className="hidden lg:flex lg:w-[440px] lg:shrink-0 border-l border-border items-center justify-center p-6">
              <p className="text-sm text-muted-foreground text-center">{t("appelsOffres.choisir")}</p>
            </aside>
          )}
        </main>
      </div>
    </div>
  );
}

function Filtre({ label, valeur, onChange, options }: {
  label: string; valeur: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-naya-olive-55">
      {label}
      <Select value={valeur} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-44 text-sm text-foreground"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}

function Detail({ ao, locale, onFermer, formatDate, formatMontant, echeance }: {
  ao: AppelOffres;
  locale: string;
  onFermer: () => void;
  formatDate: (d: string) => string;
  formatMontant: (m: string | null) => string | null;
  echeance: (a: AppelOffres) => { texte: string; classe: string };
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [notes, setNotes] = useState(ao.notes ?? "");

  const modifier = useMutation({
    mutationFn: (corps: { statut?: StatutAO; notes?: string | null }) =>
      apiRequest("PATCH", `${CLE}/${ao.id}`, corps).then((r) => r.json()),
    onSuccess: (maj: AppelOffres) => {
      queryClient.setQueryData<AppelOffres[]>([CLE], (l) => l?.map((a) => (a.id === maj.id ? maj : a)));
      setNotes(maj.notes ?? "");
      toast({ title: t("appelsOffres.enregistre") });
    },
    onError: () => toast({ title: t("appelsOffres.echec"), variant: "destructive" }),
  });

  const e = echeance(ao);
  const champ = (cle: string, valeur: React.ReactNode) => valeur ? (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-naya-olive-55">{t(`appelsOffres.champs.${cle}`)}</dt>
      <dd className="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">{valeur}</dd>
    </div>
  ) : null;
  // Seuls les liens http(s) deviennent des href ; le reste n'est pas affiché.
  const liens = ([["avis", lienSur(ao.lienAvis)], ["dce", lienSur(ao.lienDce)], ["premierJet", lienSur(ao.premierJet)]] as const)
    .filter((x): x is readonly ["avis" | "dce" | "premierJet", string] => !!x[1]);
  const reperage = ao.dateReperage ? new Date(`${ao.dateReperage}T12:00:00Z`).toLocaleDateString(locale, { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }) : null;

  return (
    <div className="p-5 space-y-5" data-testid="ao-detail">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground leading-snug">{ao.objet}</h2>
        <Button variant="ghost" size="icon" onClick={onFermer} aria-label={t("appelsOffres.fermer")}><X className="h-4 w-4" /></Button>
      </div>

      <div className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-naya-olive-55">{t("appelsOffres.champs.statut")}</span>
        <Select value={ao.statut} onValueChange={(v) => modifier.mutate({ statut: v as StatutAO })} disabled={modifier.isPending}>
          <SelectTrigger className="h-9 text-sm" data-testid="ao-statut"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUTS_AO.map((s) => <SelectItem key={s} value={s}>{t(`appelsOffres.statuts.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {liens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {liens.map(([cle, url]) => (
            <a key={cle} href={url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-naya-olive-18 px-2.5 py-1 text-xs text-foreground hover:bg-naya-olive-06">
              {t(`appelsOffres.liens.${cle}`)}<ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-1 gap-3">
        {champ("acheteur", ao.acheteur)}
        {champ("dateLimite", ao.dateLimite ? <>{formatDate(ao.dateLimite)} <span className={e.classe}>({e.texte})</span></> : null)}
        {champ("montant", formatMontant(ao.montantEstimeHt) ?? t("appelsOffres.montantInconnu"))}
        {champ("score", ao.scoreAdequation ? t(`appelsOffres.scores.${ao.scoreAdequation}`) : null)}
        {champ("offres", ao.offresJmd.length ? ao.offresJmd.join(" / ") : null)}
        {champ("procedure", ao.procedure)}
        {champ("reference", ao.reference)}
        {champ("departement", ao.departement)}
        {champ("dateReperage", reperage)}
        {champ("criteres", ao.criteresPonderation)}
        {champ("pieces", ao.piecesExigees)}
        {champ("bloquants", ao.bloquants)}
      </dl>

      <div className="space-y-2">
        <span className="text-[11px] uppercase tracking-wide text-naya-olive-55">{t("appelsOffres.champs.notes")}</span>
        <Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} rows={6}
          placeholder={t("appelsOffres.notesPlaceholder")} data-testid="ao-notes" />
        <Button size="sm" onClick={() => modifier.mutate({ notes: notes.trim() === "" ? null : notes })}
          disabled={modifier.isPending || (notes.trim() === "" ? null : notes) === ao.notes}>
          {t("appelsOffres.enregistrer")}
        </Button>
      </div>
    </div>
  );
}
