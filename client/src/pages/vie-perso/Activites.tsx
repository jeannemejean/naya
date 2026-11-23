// Activités perso : les décrire, Naya les découpe (achats, étapes), puis les place dans les soirs
// ou les week-ends.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, CalendarPlus, RefreshCw, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { codeErreur, type Activite } from "./commun";

const CLE = "/api/vie-perso/activites";
const QUANDS = ["soir", "weekend", "indifferent"] as const;

export function Activites() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: activites = [], isLoading } = useQuery<Activite[]>({ queryKey: [CLE], throwOnError: false });
  const [titre, setTitre] = useState("");
  const [description, setDescription] = useState("");
  const [avecQui, setAvecQui] = useState("");
  const [quand, setQuand] = useState<(typeof QUANDS)[number]>("indifferent");
  const [dateCible, setDateCible] = useState("");

  const erreur = (e: unknown) => toast({ title: t(`viePerso.erreurs.${codeErreur(e)}`, { defaultValue: t("viePerso.erreurs.erreur") }), variant: "destructive" });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [CLE] });

  const creer = useMutation({
    mutationFn: () => apiRequest("POST", CLE, { titre: titre.trim(), description, avecQui, quand, dateCible: dateCible || null }),
    onSuccess: () => { setTitre(""); setDescription(""); setAvecQui(""); setDateCible(""); rafraichir(); },
    onError: erreur,
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">{t("viePerso.activites.nouvelle")}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs text-naya-olive-70">{t("viePerso.activites.titre")}
            <Input value={titre} onChange={(e) => setTitre(e.target.value.slice(0, 160))} placeholder={t("viePerso.activites.titrePlaceholder")} />
          </label>
          <label className="space-y-1 text-xs text-naya-olive-70">{t("viePerso.activites.avecQui")}
            <Input value={avecQui} onChange={(e) => setAvecQui(e.target.value.slice(0, 200))} placeholder={t("viePerso.activites.avecQuiPlaceholder")} />
          </label>
        </div>
        <label className="block space-y-1 text-xs text-naya-olive-70">{t("viePerso.activites.description")}
          <Textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 2000))} rows={3} placeholder={t("viePerso.activites.descriptionPlaceholder")} />
        </label>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 text-xs text-naya-olive-70">
            <span>{t("viePerso.activites.quand")}</span>
            <div className="flex gap-1">
              {QUANDS.map((q) => (
                <Button key={q} size="sm" type="button" variant={quand === q ? "default" : "outline"} onClick={() => setQuand(q)}>{t(`viePerso.activites.quands.${q}`)}</Button>
              ))}
            </div>
          </div>
          <label className="space-y-1 text-xs text-naya-olive-70">{t("viePerso.activites.dateCible")}
            <Input type="date" value={dateCible} onChange={(e) => setDateCible(e.target.value)} className="w-44" />
          </label>
          <Button onClick={() => creer.mutate()} disabled={!titre.trim() || creer.isPending} data-testid="vie-perso-activite-creer">
            {creer.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />{t("viePerso.activites.enCours")}</> : <><Sparkles className="h-4 w-4 mr-1.5" />{t("viePerso.activites.creer")}</>}
          </Button>
        </div>
      </section>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-naya-olive-55" />
        : activites.length === 0 ? <p className="text-sm text-naya-olive-55">{t("viePerso.activites.aucune")}</p>
        : [...activites].reverse().map((a) => <CarteActivite key={a.id} a={a} onErreur={erreur} onChange={rafraichir} />)}
    </div>
  );
}

function CarteActivite({ a, onErreur, onChange }: { a: Activite; onErreur: (e: unknown) => void; onChange: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const planifier = useMutation({
    mutationFn: () => apiRequest("POST", `${CLE}/${a.id}/planifier`, {}).then((r) => r.json() as Promise<{ taches: number; nonPlacees: string[] }>),
    onSuccess: (r) => {
      toast({ title: t("viePerso.activites.planifiee", { n: r.taches }), description: r.nonPlacees.length ? t("viePerso.activites.nonPlacees", { liste: r.nonPlacees.join(", ") }) : undefined });
      onChange();
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: onErreur,
  });
  const decouper = useMutation({ mutationFn: () => apiRequest("POST", `${CLE}/${a.id}/decouper`, {}), onSuccess: onChange, onError: onErreur });
  const supprimer = useMutation({
    mutationFn: () => apiRequest("DELETE", `${CLE}/${a.id}`),
    onSuccess: () => { onChange(); queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }); },
    onError: onErreur,
  });

  return (
    <article className="rounded-lg border border-naya-olive-10 bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{a.titre}</h3>
          <p className="text-xs text-naya-olive-55">
            {[t(`viePerso.activites.quands.${a.quand}`), a.avecQui, a.dateCible, t(`viePerso.activites.statuts.${a.statut}`)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2">
          {a.contenu && (
            <Button size="sm" onClick={() => planifier.mutate()} disabled={planifier.isPending}>
              {planifier.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5 mr-1.5" />}
              {t(a.statut === "planifiee" ? "viePerso.activites.replanifier" : "viePerso.activites.planifier")}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => decouper.mutate()} disabled={decouper.isPending} aria-label={t("viePerso.activites.redecouper")}>
            {decouper.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="outline" onClick={() => supprimer.mutate()} disabled={supprimer.isPending} aria-label={t("viePerso.activites.supprimer")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {a.contenu && (
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          {a.contenu.achats.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-naya-olive-55 mb-1">{t("viePerso.activites.achats")}</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {a.contenu.achats.map((x, i) => <li key={i}>{x.article}{x.quantite && ` · ${x.quantite}`}{x.ou && <span className="text-naya-olive-55"> · {x.ou}</span>}</li>)}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[11px] uppercase tracking-wide text-naya-olive-55 mb-1">{t("viePerso.activites.etapes")}</p>
            <ol className="list-decimal pl-5 space-y-0.5">
              {a.contenu.etapes.map((e, i) => (
                <li key={i}>{e.titre} <span className="text-naya-olive-55">· {t("viePerso.activites.minutes", { n: e.dureeMin })}{e.ensemble && ` · ${t("viePerso.activites.ensemble")}`}</span></li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </article>
  );
}
