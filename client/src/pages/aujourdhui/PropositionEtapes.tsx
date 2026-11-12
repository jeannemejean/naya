// Les propositions du fil conducteur (spec 2026-11-10, §2) : Naya propose les étapes d'un objectif,
// chacune avec son pourquoi ; Jeanne valide, ajuste (renommer, réordonner, retirer, ajouter) ou
// fait refaire, avec une note facultative. Rien n'est créé avant validation. Même carte pour
// rattacher une chaîne de jalons existante à son objectif. Affichée en tête d'Aujourd'hui et
// sur la page projet. Hors interrupteur, les routes du fil répondent 404 : rien n'est rendu.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ajouter, ajustementPret, cleErreurFil, codeErreur, corpsAjustement, corpsRefaire, deplacer, etapesDeProposition,
  renommer, supprimer, type EtapeEditable, type PropositionFil,
} from "./fil-logique";

export const CLE_PROPOSITIONS_FIL = ["/api/fil/propositions"];

/** Les propositions ouvertes du fil ; `actif: false` hors interrupteur (404), sans erreur affichée. */
export function usePropositionsFil() {
  const { data } = useQuery<{ actif: boolean; propositions: PropositionFil[] }>({
    queryKey: CLE_PROPOSITIONS_FIL,
    queryFn: async () => {
      const res = await fetch("/api/fil/propositions", { credentials: "include" });
      if (res.status === 404) return { actif: false, propositions: [] };
      if (!res.ok) throw new Error(`${res.status}`);
      return { actif: true, propositions: (await res.json()) as PropositionFil[] };
    },
    retry: false,
    throwOnError: false,
    staleTime: 30_000,
    // Hors interrupteur (404) : on cesse d'interroger le fil.
    refetchInterval: (q) => (q.state.data?.actif === false ? false : 2 * 60 * 1000),
  });
  return { actif: data?.actif ?? false, propositions: data?.propositions ?? [] };
}

/** Ce qu'une proposition validée ou refaite change : propositions, étapes des projets, tâches. */
function rafraichir(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: CLE_PROPOSITIONS_FIL });
  qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/projects/") });
  qc.invalidateQueries({ queryKey: ["/api/tasks/range"] });
  qc.invalidateQueries({ queryKey: ["/api/tasks"] });
}

const boutonPrincipal =
  "inline-flex min-h-[44px] items-center rounded-full bg-primary px-5 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";
const boutonSecondaire =
  "inline-flex min-h-[44px] items-center rounded-full px-4 text-[15px] font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const boutonIcone =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30";

/** Les cartes de proposition ; filtrées sur un projet si `projetId` est donné. */
export function PropositionsFil({ projetId, className }: { projetId?: number; className?: string }) {
  const { actif, propositions } = usePropositionsFil();
  if (!actif) return null;
  const visibles = projetId == null ? propositions : propositions.filter((p) => p.objectif?.projetId === projetId);
  if (visibles.length === 0) return null;
  return (
    <div className={cn("space-y-4", className)}>
      {visibles.map((p) => (p.outil === "rattacher_chaine"
        ? <CarteRattachement key={p.id} proposition={p} />
        : <CartePropositionEtapes key={p.id} proposition={p} />))}
    </div>
  );
}

function CartePropositionEtapes({ proposition }: { proposition: PropositionFil }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"lecture" | "ajuster" | "refaire">("lecture");
  const [liste, setListe] = useState<EtapeEditable[]>(() => etapesDeProposition(proposition));
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const etapes = etapesDeProposition(proposition);
  const objectifId = proposition.objectif?.id ?? Number((proposition.arguments as any)?.objectifId);
  const surErreur = (e: unknown) => setErreur(cleErreurFil(codeErreur(e)));

  const valider = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agent/propositions/${proposition.id}/valider`),
    onSuccess: () => { toast({ title: t("filConducteur.proposition.validee") }); rafraichir(qc); },
    onError: surErreur,
  });
  const ajuster = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fil/propositions/${proposition.id}/ajuster`, corpsAjustement(liste)),
    onSuccess: () => { setMode("lecture"); rafraichir(qc); },
    onError: surErreur,
  });
  // « Refaire » : un seul appel, avec `remplace`. Le serveur crée la nouvelle puis seulement
  // annule celle-ci : en cas d'échec, cette carte reste et affiche l'erreur.
  const refaire = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fil/objectifs/${objectifId}/proposer-etapes`,
      corpsRefaire(proposition.id, note)),
    onSuccess: () => rafraichir(qc),
    onError: surErreur,
  });
  const occupe = valider.isPending || ajuster.isPending || refaire.isPending;

  const changerMode = (m: typeof mode) => {
    setErreur(null);
    if (m === "ajuster") setListe(etapes);
    setMode(m);
  };

  const titre = proposition.objectif
    ? t("filConducteur.proposition.titre", { objectif: proposition.objectif.titre })
    : t("filConducteur.proposition.titreSansObjectif");

  return (
    <section aria-label={titre} className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <h2 className="text-[22px] font-semibold leading-tight text-foreground">{titre}</h2>
      <p className="mt-1 text-[16px] leading-[1.5] text-muted-foreground">{t("filConducteur.proposition.chapo")}</p>

      {mode !== "ajuster" && (
        <ol className="mt-4 space-y-3">
          {etapes.map((e, i) => (
            <li key={i} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3">
              <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[14px] font-semibold tabular-nums text-foreground">{i + 1}</span>
              <div className="min-w-0">
                <p className="break-words text-[16px] leading-[1.45] text-foreground">
                  {e.titre}
                  <span className="ml-2 text-[13px] text-muted-foreground">· {t(`filConducteur.proposition.etat.${e.etat}`)}</span>
                </p>
                {e.pourquoi && <p className="mt-0.5 break-words text-[14px] leading-[1.5] text-muted-foreground">{e.pourquoi}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {mode === "ajuster" && (
        <div className="mt-4">
          <ol className="space-y-2">
            {liste.map((e, i) => (
              <li key={i} className="flex items-center gap-1">
                <span aria-hidden="true" className="w-6 shrink-0 text-center text-[14px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                <input
                  value={e.titre}
                  onChange={(ev) => setListe((l) => renommer(l, i, ev.target.value))}
                  aria-label={t("filConducteur.proposition.titreEtape", { n: i + 1 })}
                  maxLength={200}
                  className="min-h-[44px] min-w-0 flex-1 rounded-champ border border-border bg-background px-3 text-[16px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button type="button" className={boutonIcone} disabled={i === 0} onClick={() => setListe((l) => deplacer(l, i, -1))}
                  aria-label={t("filConducteur.proposition.monter", { titre: e.titre })}>
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" className={boutonIcone} disabled={i === liste.length - 1} onClick={() => setListe((l) => deplacer(l, i, 1))}
                  aria-label={t("filConducteur.proposition.descendre", { titre: e.titre })}>
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button type="button" className={boutonIcone} onClick={() => setListe((l) => supprimer(l, i))}
                  aria-label={t("filConducteur.proposition.supprimer", { titre: e.titre })}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setListe((l) => ajouter(l))} className={cn(boutonSecondaire, "mt-1 gap-1.5 px-2")}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("filConducteur.proposition.ajouterEtape")}
          </button>
          {!ajustementPret(liste) && <p className="mt-1 text-[14px] text-muted-foreground">{t("filConducteur.proposition.bornes")}</p>}
        </div>
      )}

      {mode === "refaire" && (
        <label className="mt-4 block">
          <span className="text-[14px] font-semibold text-foreground">{t("filConducteur.proposition.note")}</span>
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            maxLength={1000}
            rows={2}
            placeholder={t("filConducteur.proposition.notePlaceholder")}
            className="mt-1 w-full rounded-champ border border-border bg-background px-3 py-2 text-[16px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}

      {erreur && <p role="alert" className="mt-3 text-[14px] leading-[1.5] text-foreground">{t(erreur)}</p>}
      {refaire.isPending && <p className="mt-3 text-[14px] text-muted-foreground">{t("filConducteur.proposition.enCours")}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {mode === "lecture" && (
          <>
            <button type="button" className={boutonPrincipal} disabled={occupe} onClick={() => valider.mutate()}>{t("filConducteur.proposition.valider")}</button>
            <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => changerMode("ajuster")}>{t("filConducteur.proposition.ajuster")}</button>
            <button type="button" className={boutonSecondaire} disabled={occupe || !objectifId} onClick={() => changerMode("refaire")}>{t("filConducteur.proposition.refaire")}</button>
          </>
        )}
        {mode === "ajuster" && (
          <>
            <button type="button" className={boutonPrincipal} disabled={occupe || !ajustementPret(liste)} onClick={() => { setErreur(null); ajuster.mutate(); }}>
              {t("filConducteur.proposition.enregistrer")}
            </button>
            <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => changerMode("lecture")}>{t("filConducteur.proposition.annuler")}</button>
          </>
        )}
        {mode === "refaire" && (
          <>
            <button type="button" className={boutonPrincipal} disabled={occupe} onClick={() => { setErreur(null); refaire.mutate(); }}>
              {t("filConducteur.proposition.relancer")}
            </button>
            <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => changerMode("lecture")}>{t("filConducteur.proposition.annuler")}</button>
          </>
        )}
      </div>
    </section>
  );
}

function CarteRattachement({ proposition }: { proposition: PropositionFil }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const valider = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agent/propositions/${proposition.id}/valider`),
    onSuccess: () => { toast({ title: t("filConducteur.rattachement.fait") }); rafraichir(qc); },
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });
  const laisser = useMutation({
    mutationFn: () => apiRequest("POST", `/api/agent/propositions/${proposition.id}/annuler`),
    onSettled: () => rafraichir(qc),
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });
  const occupe = valider.isPending || laisser.isPending;
  const titre = t("filConducteur.rattachement.titre", { objectif: proposition.objectif?.titre ?? "" });

  return (
    <section aria-label={titre} className="rounded-carte bg-card p-5 shadow-cocon sm:p-6">
      <h2 className="text-[22px] font-semibold leading-tight text-foreground">{titre}</h2>
      <p className="mt-1 text-[16px] leading-[1.5] text-muted-foreground">{t("filConducteur.rattachement.chapo")}</p>
      <ul className="mt-3 space-y-1">
        {proposition.changements.map((c, i) => (
          <li key={i} className="break-words text-[15px] leading-[1.5] text-foreground">{c.libelle}</li>
        ))}
      </ul>
      {erreur && <p role="alert" className="mt-3 text-[14px] leading-[1.5] text-foreground">{t(erreur)}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={boutonPrincipal} disabled={occupe} onClick={() => valider.mutate()}>{t("filConducteur.rattachement.valider")}</button>
        <button type="button" className={boutonSecondaire} disabled={occupe} onClick={() => laisser.mutate()}>{t("filConducteur.rattachement.laisser")}</button>
      </div>
    </section>
  );
}

/** « Proposer des étapes » pour un objectif (page projet) : la carte de proposition apparaît ensuite. */
export function BoutonProposerEtapes({ objectifId }: { objectifId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  const proposer = useMutation({
    mutationFn: () => apiRequest("POST", `/api/fil/objectifs/${objectifId}/proposer-etapes`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLE_PROPOSITIONS_FIL }),
    onError: (e) => setErreur(cleErreurFil(codeErreur(e))),
  });
  return (
    <div className="flex flex-wrap items-center gap-x-3">
      <button
        type="button"
        onClick={() => { setErreur(null); proposer.mutate(); }}
        disabled={proposer.isPending}
        className="inline-flex min-h-[36px] items-center rounded-full border border-border px-3 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {t(proposer.isPending ? "filConducteur.roadmap.proposerEnCours" : "filConducteur.roadmap.proposer")}
      </button>
      {erreur && <span role="alert" className="text-[13px] text-muted-foreground">{t(erreur)}</span>}
    </div>
  );
}

export default PropositionsFil;
