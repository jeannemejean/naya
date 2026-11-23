// Repas de la semaine : préparer (en arrière-plan), relire, changer un repas, valider (place les
// courses, le batch et les préparations dans le planning), cocher la liste de courses.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, CalendarCheck, Copy, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ajouterJours, lundiDe, REPAS, type Repas, type RepasPlan } from "@shared/vie-perso";
import { codeErreur, type ReponsePlan } from "./commun";

const aujourdhuiLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function SemaineRepas() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const cetteSemaine = lundiDe(aujourdhuiLocal());
  const prochaine = ajouterJours(cetteSemaine, 7);
  const [semaine, setSemaine] = useState(prochaine);
  const [suivi, setSuivi] = useState(false);
  const cle = `/api/vie-perso/plans/${semaine}`;

  const { data, isLoading } = useQuery<ReponsePlan>({
    queryKey: [cle],
    throwOnError: false,
    refetchInterval: (q) => ((q.state.data as ReponsePlan | undefined)?.preparation?.statut === "en_cours" ? 3000 : false),
  });
  const plan = data?.plan ?? null;
  const prep = data?.preparation ?? null;
  const enCours = prep?.statut === "en_cours";

  useEffect(() => { if (enCours) setSuivi(true); }, [enCours]);
  useEffect(() => {
    if (!suivi || !data || enCours) return;
    setSuivi(false);
    if (prep?.statut === "fini") toast({ title: t("viePerso.semaine.pret") });
    else if (prep?.statut === "erreur") toast({ title: t(`viePerso.erreurs.${prep.erreur}`, { defaultValue: t("viePerso.erreurs.preparation_echec") }), variant: "destructive" });
    else toast({ title: t("viePerso.erreurs.perdu"), variant: "destructive" });
  }, [data, enCours, prep, suivi, t, toast]);

  const erreur = (e: unknown) => toast({ title: t(`viePerso.erreurs.${codeErreur(e)}`, { defaultValue: t("viePerso.erreurs.erreur") }), variant: "destructive" });

  const preparer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/preparer`, {}),
    onSuccess: () => { setSuivi(true); queryClient.invalidateQueries({ queryKey: [cle] }); },
    onError: erreur,
  });
  const valider = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/valider`, {}).then((r) => r.json() as Promise<{ taches: number }>),
    onSuccess: (r) => {
      toast({ title: t("viePerso.semaine.valideToast", { n: r.taches }) });
      queryClient.invalidateQueries({ queryKey: [cle] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: erreur,
  });
  const cocher = useMutation({
    mutationFn: (x: { index: number; coche: boolean }) => apiRequest("PATCH", `${cle}/courses`, x),
    onMutate: (x) => {
      queryClient.setQueryData<ReponsePlan>([cle], (d) => d?.plan ? {
        ...d, plan: { ...d.plan, coches: x.coche ? [...d.plan.coches, x.index] : d.plan.coches.filter((i) => i !== x.index) },
      } : d);
    },
    onError: (e) => { erreur(e); queryClient.invalidateQueries({ queryKey: [cle] }); },
  });

  const formatJour = (j: string, o: Intl.DateTimeFormatOptions) => new Date(`${j}T12:00:00`).toLocaleDateString(i18n.language, o);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {[[cetteSemaine, "cetteSemaine"], [prochaine, "prochaine"]].map(([s, k]) => (
            <Button key={s} size="sm" variant={semaine === s ? "default" : "outline"} onClick={() => setSemaine(s)}>{t(`viePerso.semaine.${k}`)}</Button>
          ))}
        </div>
        <span className="text-sm text-naya-olive-70">{t("viePerso.semaine.du", { date: formatJour(semaine, { day: "numeric", month: "long" }) })}</span>
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-naya-olive-55" /> : enCours || preparer.isPending ? (
        <p className="flex items-center gap-2 text-sm text-naya-olive-70" role="status"><Loader2 className="h-4 w-4 animate-spin" />{t("viePerso.semaine.enCours")}</p>
      ) : !plan ? (
        <div className="rounded-lg border border-naya-olive-10 bg-card p-6 text-center space-y-3">
          <p className="font-medium">{t("viePerso.semaine.aucun")}</p>
          <p className="text-sm text-naya-olive-70">{t("viePerso.semaine.aucunAide")}</p>
          <Button onClick={() => preparer.mutate()} data-testid="vie-perso-preparer"><Sparkles className="h-4 w-4 mr-1.5" />{t("viePerso.semaine.preparer")}</Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-naya-olive-10 bg-card px-4 py-3">
            <p className="text-sm text-naya-olive-70">{t(plan.statut === "valide" ? "viePerso.semaine.valide" : "viePerso.semaine.brouillon")}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => preparer.mutate()}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("viePerso.semaine.refaire")}</Button>
              <Button size="sm" onClick={() => valider.mutate()} disabled={valider.isPending} data-testid="vie-perso-valider">
                {valider.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CalendarCheck className="h-3.5 w-3.5 mr-1.5" />}
                {t(plan.statut === "valide" ? "viePerso.semaine.revalider" : "viePerso.semaine.valider")}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {plan.contenu.jours.map((j) => (
              <div key={j.date} className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold capitalize">{formatJour(j.date, { weekday: "long", day: "numeric", month: "long" })}</h3>
                {REPAS.map((r) => j[r] && <CarteRepas key={r} cle={cle} jour={j.date} repas={r} valeur={j[r]!} />)}
              </div>
            ))}
          </div>

          {plan.contenu.batch.etapes.length > 0 && (
            <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-2">
              <h3 className="text-sm font-semibold">{t("viePerso.semaine.batch")} · {t("viePerso.semaine.batchDuree", { n: plan.contenu.batch.dureeMin })}</h3>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                {plan.contenu.batch.etapes.map((e, i) => <li key={i}>{e.appareil && <strong>{e.appareil} : </strong>}{e.action}</li>)}
              </ol>
            </section>
          )}

          <ListeCourses plan={plan} onCocher={(index, coche) => cocher.mutate({ index, coche })} />

          {(plan.contenu.regles.length > 0 || plan.contenu.snacks.length > 0) && (
            <section className="grid gap-3 md:grid-cols-2">
              {([["regles", plan.contenu.regles], ["snacks", plan.contenu.snacks]] as const).map(([k, l]) => l.length > 0 && (
                <div key={k} className="rounded-lg border border-naya-olive-10 bg-card p-4">
                  <h3 className="text-sm font-semibold mb-2">{t(`viePerso.semaine.${k}`)}</h3>
                  <ul className="list-disc pl-5 space-y-1 text-sm">{l.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CarteRepas({ cle, jour, repas, valeur }: { cle: string; jour: string; repas: Repas; valeur: RepasPlan }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [ouvert, setOuvert] = useState(false);
  const [demande, setDemande] = useState("");
  const changer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/repas`, { jour, repas, demande: demande.trim() || null }),
    onSuccess: () => { setOuvert(false); setDemande(""); toast({ title: t("viePerso.semaine.changerOk") }); queryClient.invalidateQueries({ queryKey: [cle] }); },
    onError: (e) => toast({ title: t(`viePerso.erreurs.${codeErreur(e)}`, { defaultValue: t("viePerso.erreurs.erreur") }), variant: "destructive" }),
  });
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-naya-olive-55">{t(`viePerso.semaine.repas.${repas}`)}</p>
        <button type="button" className="text-[11px] underline text-naya-olive-55 hover:text-foreground" onClick={() => setOuvert((o) => !o)}>{t("viePerso.semaine.changer")}</button>
      </div>
      <p className="text-sm font-medium">{valeur.titre}</p>
      {valeur.detail && <p className="text-xs text-naya-olive-70">{valeur.detail}</p>}
      {valeur.variantes.map((v, i) => <p key={i} className="text-xs text-naya-olive-70"><strong>{v.membre} :</strong> {v.texte}</p>)}
      <p className="text-[11px] text-naya-olive-55">
        {[
          valeur.kcal != null && t("viePerso.semaine.kcal", { n: valeur.kcal }),
          valeur.proteines != null && valeur.lipides != null && valeur.glucides != null && t("viePerso.semaine.macros", { p: valeur.proteines, l: valeur.lipides, g: valeur.glucides }),
          valeur.preparationMin > 0 && t("viePerso.semaine.prep", { n: valeur.preparationMin }),
        ].filter(Boolean).join(" · ")}
      </p>
      {ouvert && (
        <div className="flex gap-2 pt-1">
          <Input value={demande} onChange={(e) => setDemande(e.target.value.slice(0, 500))} placeholder={t("viePerso.semaine.changerAide")} className="h-8 text-xs" />
          <Button size="sm" onClick={() => changer.mutate()} disabled={changer.isPending}>
            {changer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("viePerso.semaine.changer")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ListeCourses({ plan, onCocher }: { plan: NonNullable<ReponsePlan["plan"]>; onCocher: (index: number, coche: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const coches = new Set(plan.coches);
  const parMagasin = useMemo(() => {
    const m = new Map<string, Map<string, number[]>>();
    plan.contenu.courses.forEach((c, i) => {
      const mag = c.magasin.trim() || "·";
      const ray = c.rayon.trim();
      if (!m.has(mag)) m.set(mag, new Map());
      const r = m.get(mag)!;
      if (!r.has(ray)) r.set(ray, []);
      r.get(ray)!.push(i);
    });
    return m;
  }, [plan.contenu.courses]);
  if (plan.contenu.courses.length === 0) return null;

  const texte = Array.from(parMagasin, ([mag, rayons]) => [mag, ...Array.from(rayons.values()).flat()
    .filter((i) => !coches.has(i)).map((i) => { const c = plan.contenu.courses[i]; return `- ${c.article}${c.quantite ? ` (${c.quantite})` : ""}`; })].join("\n")).join("\n\n");
  const copier = async () => {
    try { await navigator.clipboard.writeText(texte); toast({ title: t("viePerso.semaine.copie") }); } catch { /* presse-papier refusé */ }
  };

  return (
    <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("viePerso.semaine.courses")}</h3>
        <Button size="sm" variant="outline" onClick={copier}><Copy className="h-3.5 w-3.5 mr-1.5" />{t("viePerso.semaine.copier")}</Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from(parMagasin, ([mag, rayons]) => (
          <div key={mag} className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-naya-olive-70">{mag}</h4>
            {Array.from(rayons, ([ray, idx]) => (
              <div key={ray} className="space-y-1">
                {ray && <p className="text-[11px] text-naya-olive-55">{ray}</p>}
                {idx.map((i) => {
                  const c = plan.contenu.courses[i];
                  return (
                    <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
                      <input type="checkbox" className="mt-1" checked={coches.has(i)} onChange={(e) => onCocher(i, e.target.checked)} />
                      <span className={cn(coches.has(i) && "line-through text-naya-olive-55")}>
                        {c.article}{c.quantite && <span className="text-naya-olive-55"> · {c.quantite}</span>}
                        {c.pour && c.pour !== "tous" && <span className="text-naya-olive-55"> · {c.pour}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
