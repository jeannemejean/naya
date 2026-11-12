// Le matin du fil conducteur à l'écran (spec 2026-11-10, §3 et §4), en tête d'Aujourd'hui : les
// tâches clés en cartes ; dessous, les objectifs oubliés (« Reprendre ») et la journée allégée
// (« Alléger ma journée », puis « Annuler » pendant 24 h) ; puis, en une ligne, les tâches du
// jour sans objectif. Si rien ne cloche : une seule phrase. Hors interrupteur, le brief ne porte
// pas de `fil` : rien n'est rendu, l'accueil reste exactement comme avant.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MatinFil, ObjectifOublie } from "@shared/fil";
import { apiRequest } from "@/lib/queryClient";
import { formatLocalDate } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { annulationOuverte, resumeMatin } from "./logique";
import { cleErreurAnnulation, cleErreurFil, codeErreur, texteNonRattachees, texteNonRemises } from "./fil-logique";
import { CLE_BRIEF, CLE_FIL_MATIN, type Brief } from "./MotDuMatin";
import { TachesCles } from "./TachesCles";

/**
 * Le `fil` du matin. Le GET du brief ne le porte pas : on le lit par le POST, mais seulement
 * quand le texte du jour existe déjà (le POST prend alors le chemin en cache, sans IA). Sinon,
 * c'est MotDuMatin qui génère et dépose le `fil` de sa réponse sous CLE_FIL_MATIN.
 */
export function useMatinFil(): MatinFil | null {
  const { data: brief } = useQuery<Brief>({ queryKey: CLE_BRIEF, retry: false, throwOnError: false });
  const { data } = useQuery<MatinFil | null>({
    queryKey: CLE_FIL_MATIN,
    queryFn: async () => {
      const reponse = await (await apiRequest("POST", "/api/tasks/daily-brief", {})).json();
      return (reponse?.fil as MatinFil | undefined) ?? null;
    },
    enabled: !!brief?.content,
    retry: false,
    throwOnError: false,
  });
  return data ?? null;
}

/** Après une action du matin : le brief (et son fil) et toutes les tâches. */
function rafraichir(qc: QueryClient) {
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/tasks") });
}

// ── Mémoire locale (24 h d'annulation, reprises du jour) ─────────────────────────────────
// Le serveur ne renvoie plus la proposition une fois validée : l'action à annuler et les
// objectifs déjà repris aujourd'hui sont gardés dans le navigateur. Stockage indisponible : on
// continue sans (le bouton disparaît au rechargement, rien de plus).

const CLE_ALLEGEMENT = "naya.fil.allegement";
const CLE_REPRIS = "naya.fil.repris";
type MemoAllegement = { actionId: number; valideA: string };

function lire<T>(cle: string): T | null {
  try { const v = localStorage.getItem(cle); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function ecrire(cle: string, valeur: unknown | null) {
  try { valeur == null ? localStorage.removeItem(cle) : localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* rien */ }
}
function reprisDuJour(jour: string): number[] {
  const m = lire<{ jour: string; ids: number[] }>(CLE_REPRIS);
  return m?.jour === jour && Array.isArray(m.ids) ? m.ids : [];
}

const boutonPrincipal =
  "inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
const boutonSecondaire =
  "inline-flex min-h-[44px] items-center rounded-full px-4 text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function BlocMatinFil({ className }: { className?: string }) {
  const { t } = useTranslation();
  const fil = useMatinFil();
  if (!fil) return null;
  const { phraseUnique, sections } = resumeMatin(fil);
  const propositionId = sections.includes("allegement") ? fil.allegement?.propositionId ?? null : null;

  return (
    <div className={cn("space-y-4", className)}>
      {phraseUnique && (
        <p className="rounded-carte bg-card p-5 text-[16px] leading-[1.5] text-foreground shadow-cocon sm:p-6">
          {t(phraseUnique, { titre: fil.tachesCles[0]?.titre ?? "" })}
        </p>
      )}
      {sections.includes("tachesCles") && <TachesCles taches={fil.tachesCles} />}
      {sections.includes("oublis") && <ObjectifsOublies objectifs={fil.objectifsOublies} />}
      {/* Toujours monté : après validation, la proposition n'est plus dans le fil mais « Annuler » reste 24 h. */}
      <CarteAllegement propositionId={propositionId} />
      {sections.includes("nonRattachees") && (
        <p className="px-1 text-[14px] leading-[1.5] text-muted-foreground">{texteNonRattachees(fil.nonRattachees, (cle, opts) => t(cle, opts))}</p>
      )}
    </div>
  );
}

function ObjectifsOublies({ objectifs }: { objectifs: ObjectifOublie[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="oublis-titre" className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <h2 id="oublis-titre" className="text-[22px] font-semibold leading-tight text-foreground">{t("filConducteur.matin.oublis.titre")}</h2>
      <ul className="mt-3 divide-y divide-border">
        {objectifs.map((o) => <LigneOubli key={o.objectifId} objectif={o} />)}
      </ul>
    </section>
  );
}

function LigneOubli({ objectif }: { objectif: ObjectifOublie }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const jour = formatLocalDate(new Date());
  const [repris, setRepris] = useState(() => reprisDuJour(jour).includes(objectif.objectifId));
  const [erreur, setErreur] = useState<string | null>(null);
  // La reprise affichée part telle quelle : le serveur la crée sans appel IA.
  const reprendre = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fil/objectifs/${objectif.objectifId}/reprendre`,
      { titre: objectif.reprise.titre, pourquoi: objectif.reprise.pourquoi, clientToday: jour }),
    onSuccess: () => {
      ecrire(CLE_REPRIS, { jour, ids: [...reprisDuJour(jour), objectif.objectifId] });
      setRepris(true);
      rafraichir(qc);
    },
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="break-words text-[16px] leading-[1.45] text-foreground">
        {t("filConducteur.matin.oublis.ligne", { objectif: objectif.titre, jours: objectif.joursSansTache })}
      </p>
      <p className="mt-1 break-words text-[14px] leading-[1.5] text-foreground">{t("filConducteur.matin.oublis.reprise", { titre: objectif.reprise.titre })}</p>
      <p className="mt-0.5 break-words text-[14px] leading-[1.5] text-muted-foreground">{objectif.reprise.pourquoi}</p>
      {erreur && <p role="alert" className="mt-2 text-[14px] leading-[1.5] text-foreground">{t(erreur)}</p>}
      <div className="mt-2">
        {repris ? (
          <p role="status" className="text-[14px] font-semibold text-foreground">{t("filConducteur.matin.oublis.fait")}</p>
        ) : (
          <button type="button" className={boutonPrincipal} disabled={reprendre.isPending} onClick={() => { setErreur(null); reprendre.mutate(); }}>
            {t(reprendre.isPending ? "filConducteur.matin.oublis.enCours" : "filConducteur.matin.oublis.reprendre")}
          </button>
        )}
      </div>
    </li>
  );
}

/** Proposée (énergie basse) → « Alléger ma journée » ; validée → « Annuler » pendant 24 h ; annulée → une ligne. */
function CarteAllegement({ propositionId }: { propositionId: number | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [memo, setMemo] = useState<MemoAllegement | null>(() => lire<MemoAllegement>(CLE_ALLEGEMENT));
  const [annulee, setAnnulee] = useState<{ nonRemises: number } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const oublier = () => { ecrire(CLE_ALLEGEMENT, null); setMemo(null); };

  const alleger = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/agent/propositions/${propositionId}/valider`)).json(),
    onSuccess: (r: { actionId?: number }) => {
      if (typeof r?.actionId === "number") {
        const m = { actionId: r.actionId, valideA: new Date().toISOString() };
        ecrire(CLE_ALLEGEMENT, m);
        setMemo(m);
      }
      setAnnulee(null);
      rafraichir(qc);
    },
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });
  const pasAujourdhui = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agent/propositions/${propositionId}/annuler`),
    onSettled: () => rafraichir(qc),
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });
  const annuler = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/agent/actions/${memo!.actionId}/annuler`)).json(),
    onSuccess: (r: { nonRemises?: unknown[] }) => {
      oublier();
      setAnnulee({ nonRemises: Array.isArray(r?.nonRemises) ? r.nonRemises.length : 0 });
      rafraichir(qc);
    },
    onError: (e) => {
      const code = codeErreur(e);
      // Plus rien à annuler : le bouton disparaît, le message reste.
      if (code === "expiree" || code === "deja_annulee" || code === "introuvable" || code === "modifiee") oublier();
      setErreur(cleErreurAnnulation(code));
    },
  });
  const occupe = alleger.isPending || pasAujourdhui.isPending || annuler.isPending;
  const enCours = memo && annulationOuverte(memo.valideA, new Date()) ? memo : null;
  const ligneErreur = erreur && <p role="alert" className="mt-3 text-[14px] leading-[1.5] text-foreground">{t(erreur)}</p>;

  if (annulee) {
    return (
      <div role="status" className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
        <p className="text-[16px] leading-[1.5] text-foreground">{t("filConducteur.matin.allegement.annulee")}</p>
        {annulee.nonRemises > 0 && (
          <p className="mt-1 text-[14px] leading-[1.5] text-muted-foreground">{texteNonRemises(annulee.nonRemises, (cle, opts) => t(cle, opts))}</p>
        )}
      </div>
    );
  }
  if (enCours) {
    return (
      <section aria-label={t("filConducteur.matin.allegement.titre")} className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[16px] leading-[1.5] text-foreground">{t("filConducteur.matin.allegement.fait")}</p>
          <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => { setErreur(null); annuler.mutate(); }}>
            {t("filConducteur.matin.allegement.annuler")}
          </button>
        </div>
        {ligneErreur}
      </section>
    );
  }
  if (propositionId == null) {
    return erreur ? <div className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">{ligneErreur}</div> : null;
  }
  return (
    <section aria-labelledby="allegement-titre" className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <h2 id="allegement-titre" className="text-[22px] font-semibold leading-tight text-foreground">{t("filConducteur.matin.allegement.titre")}</h2>
      <p className="mt-1 text-[16px] leading-[1.5] text-muted-foreground">{t("filConducteur.matin.allegement.chapo")}</p>
      {ligneErreur}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={boutonPrincipal} disabled={occupe} onClick={() => { setErreur(null); alleger.mutate(); }}>
          {t("filConducteur.matin.allegement.alleger")}
        </button>
        <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => { setErreur(null); pasAujourdhui.mutate(); }}>
          {t("filConducteur.matin.allegement.pasAujourdhui")}
        </button>
      </div>
    </section>
  );
}

export default BlocMatinFil;
