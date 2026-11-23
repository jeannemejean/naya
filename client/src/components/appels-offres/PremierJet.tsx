// Premier jet de réponse à un appel d'offres, dans le détail d'un AO : le préparer (avec le RC
// collé si Jeanne l'a), suivre la rédaction (2 à 3 min, en arrière-plan), le lire, le copier, le
// télécharger. Un ancien premier jet qui est un lien (Notion, Claude Design) reste un lien
// (affiché avec les autres liens du détail) ; on peut en préparer un nouveau dans Naya.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Copy, Download, RefreshCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { lienSur } from "@shared/appels-offres";
import { blocsMarkdown, segmentsEnLigne } from "@/lib/markdown-simple";

type Etat = { statut: "aucun" | "en_cours" | "fini" | "erreur"; erreur?: string };
const RC_MAX = 60_000;
const FERMES = new Set(["ecarte", "perdu", "gagne", "depose"]);

export function PremierJet({ ao }: { ao: { id: number; objet: string; statut: string; premierJet: string | null; dateLimite: string | null } }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const texte = ao.premierJet && !lienSur(ao.premierJet) ? ao.premierJet : null;
  const [rcOuvert, setRcOuvert] = useState(false);
  const [rc, setRc] = useState("");
  const [lire, setLire] = useState(false);
  const [suivi, setSuivi] = useState(false);
  const cle = `/api/appels-offres/${ao.id}/premier-jet`;

  // État au montage (une préparation lancée avant de changer d'AO ou de recharger la page).
  const { data: etat } = useQuery<Etat>({
    queryKey: [cle],
    refetchInterval: (q) => ((q.state.data as Etat | undefined)?.statut === "en_cours" ? 3000 : false),
  });
  const enCours = etat?.statut === "en_cours";
  useEffect(() => { if (enCours) setSuivi(true); }, [enCours]);
  useEffect(() => {
    if (!suivi || !etat || etat.statut === "en_cours") return;
    setSuivi(false);
    if (etat.statut === "fini") {
      queryClient.invalidateQueries({ queryKey: ["/api/appels-offres"] });
      toast({ title: t("appelsOffres.premierJet.pret") });
      setLire(true);
    } else if (etat.statut === "erreur") {
      const e = etat.erreur ?? "";
      toast({ title: t(`appelsOffres.premierJet.erreurs.${e}`, { defaultValue: t("appelsOffres.premierJet.erreurs.premier_jet_echec") }), variant: "destructive" });
    } else {
      // « aucun » pendant un suivi : le serveur a redémarré, la rédaction est perdue.
      toast({ title: t("appelsOffres.premierJet.erreurs.perdu"), variant: "destructive" });
    }
  }, [etat, suivi, t, toast]);

  const preparer = useMutation({
    mutationFn: () => apiRequest("POST", cle, { rc: rc.trim() ? rc : null }).then((r) => r.json() as Promise<Etat>),
    onSuccess: (e) => {
      queryClient.setQueryData([cle], e);
      setSuivi(true);
      setRcOuvert(false);
    },
    onError: (e: unknown) => {
      const m = e instanceof Error ? e.message : "";
      const code = /^409\b/.test(m) ? "premier_jet_en_cours" : (/"message":"(\w+)"/.exec(m)?.[1] ?? "premier_jet_echec");
      toast({ title: t(`appelsOffres.premierJet.erreurs.${code}`, { defaultValue: t("appelsOffres.premierJet.erreurs.premier_jet_echec") }), variant: "destructive" });
    },
  });

  const copier = async () => {
    try { await navigator.clipboard.writeText(texte ?? ""); toast({ title: t("appelsOffres.premierJet.copie") }); }
    catch { toast({ title: t("appelsOffres.premierJet.copieEchec"), variant: "destructive" }); }
  };
  const telecharger = () => {
    const url = URL.createObjectURL(new Blob([texte ?? ""], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `premier-jet-ao-${ao.id}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ferme = FERMES.has(ao.statut) || (!!ao.dateLimite && new Date(ao.dateLimite).getTime() < Date.now());
  const occupe = enCours || preparer.isPending;

  return (
    <div className="space-y-2" data-testid="ao-premier-jet">
      <span className="text-[11px] uppercase tracking-wide text-naya-olive-55">{t("appelsOffres.premierJet.titre")}</span>

      {texte && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setLire(true)}><FileText className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.lire")}</Button>
          <Button size="sm" variant="outline" onClick={copier}><Copy className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.copier")}</Button>
          <Button size="sm" variant="outline" onClick={telecharger}><Download className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.telecharger")}</Button>
        </div>
      )}

      {occupe ? (
        <p className="flex items-center gap-2 text-sm text-naya-olive-70" role="status">
          <Loader2 className="h-4 w-4 animate-spin" />{t("appelsOffres.premierJet.enCours")}
        </p>
      ) : !ferme && (
        <div className="space-y-2">
          {!texte && <p className="text-xs text-naya-olive-55">{t("appelsOffres.premierJet.explication")}</p>}
          {rcOuvert ? (
            <div className="space-y-1">
              <Textarea value={rc} onChange={(e) => setRc(e.target.value.slice(0, RC_MAX))} rows={6}
                placeholder={t("appelsOffres.premierJet.rcPlaceholder")} data-testid="ao-premier-jet-rc" />
              <p className="text-[11px] text-naya-olive-55">{t("appelsOffres.premierJet.rcAide")}</p>
            </div>
          ) : (
            <button type="button" className="text-xs underline text-naya-olive-70 hover:text-foreground" onClick={() => setRcOuvert(true)}>
              {t("appelsOffres.premierJet.collerRc")}
            </button>
          )}
          <div>
            <Button size="sm" variant={texte ? "outline" : "default"} onClick={() => preparer.mutate()} data-testid="ao-premier-jet-preparer">
              {texte ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.refaire")}</> : t("appelsOffres.premierJet.preparer")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={lire && !!texte} onOpenChange={setLire}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto bg-card">
          <DialogHeader>
            <DialogTitle>{t("appelsOffres.premierJet.titre")}</DialogTitle>
            <DialogDescription>{ao.objet}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copier}><Copy className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.copier")}</Button>
            <Button size="sm" variant="outline" onClick={telecharger}><Download className="h-3.5 w-3.5 mr-1.5" />{t("appelsOffres.premierJet.telecharger")}</Button>
          </div>
          <Document texte={texte ?? ""} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EnLigne({ s }: { s: string }) {
  return (
    <>
      {segmentsEnLigne(s).map((x, i) => x.aCompleter ? <mark key={i} className={`bg-naya-sulphur/40 text-naya-olive rounded px-0.5${x.gras ? " font-semibold" : ""}`}>{x.texte}</mark>
        : x.gras ? <strong key={i}>{x.texte}</strong>
        : x.italique ? <em key={i}>{x.texte}</em>
        : <span key={i}>{x.texte}</span>)}
    </>
  );
}

function Document({ texte }: { texte: string }) {
  return (
    <article className="space-y-3 text-sm text-foreground leading-relaxed">
      {blocsMarkdown(texte).map((b, i) => {
        if (b.type === "titre") {
          const c = b.niveau === 1 ? "text-lg font-semibold" : b.niveau === 2 ? "text-base font-semibold pt-3 border-t border-naya-olive-10" : "text-sm font-semibold pt-1";
          return <h3 key={i} className={c}><EnLigne s={b.texte} /></h3>;
        }
        if (b.type === "citation") return <div key={i} className="rounded-md border border-naya-sulphur/60 bg-naya-sulphur/20 px-3 py-2"><EnLigne s={b.texte} /></div>;
        if (b.type === "liste") {
          const Tag = b.ordonnee ? "ol" : "ul";
          return (
            <Tag key={i} className={b.ordonnee ? "list-decimal pl-5 space-y-1" : b.items.some((x) => x.coche !== undefined) ? "space-y-1" : "list-disc pl-5 space-y-1"}>
              {b.items.map((x, j) => (
                <li key={j} className={x.coche !== undefined ? "flex items-start gap-2" : undefined}>
                  {x.coche !== undefined && <input type="checkbox" checked={x.coche} readOnly className="mt-1" aria-hidden />}
                  <span><EnLigne s={x.texte} /></span>
                </li>
              ))}
            </Tag>
          );
        }
        return <p key={i}><EnLigne s={b.texte} /></p>;
      })}
    </article>
  );
}
