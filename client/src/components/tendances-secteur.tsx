import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { TrendingUp, ExternalLink, Pin, X, PenLine } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tendance = { id: number; statut: string; libelle: string; plateforme: string; lift: number; nbForts: number; nbComptes: number; exemples: string[]; pourquoi: string; adaptation: string };
type Donnees = {
  ouvert: boolean;
  rattachement: { profilId: number; statut: string; nomProfil: string } | null;
  catalogue: Array<{ id: number; nom: string }>;
  tendances: Tendance[];
};

export function TendancesSecteur({ projectId, compact = false }: { projectId: number; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const cle = `/api/profils-veille/projet/${projectId}`;
  const { data } = useQuery<Donnees>({ queryKey: [cle] });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: [cle] });
  const [choix, setChoix] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [postCree, setPostCree] = useState<string | null>(null);
  const dejaVues = useRef<Set<number>>(new Set());

  const statut = useMutation({
    mutationFn: ({ id, s }: { id: number; s: string }) => apiRequest("PATCH", `/api/profils-veille/tendances/${id}`, { statut: s }),
    onSuccess: rafraichir,
  });
  const enPost = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/profils-veille/tendances/${id}/post`).then((r) => r.json()),
    onSuccess: (r: { contentId: number; semaine?: string; deja?: boolean }) => {
      if (r.semaine) setPostCree(r.semaine);
      rafraichir();
      toast({ title: t("tendancesSecteur.postCree") });
    },
  });
  const changer = useMutation({ mutationFn: (profilId: number) => apiRequest("POST", `${cle}/profil`, { profilId }), onSuccess: () => { setChoix(false); rafraichir(); } });
  const refuser = useMutation({ mutationFn: () => apiRequest("POST", `${cle}/refuser`), onSuccess: () => { setChoix(false); rafraichir(); } });
  const suggerer = useMutation({
    mutationFn: () => apiRequest("POST", `${cle}/suggestion`, { plateforme: "instagram", saisie }),
    onSuccess: () => { setSaisie(""); toast({ title: t("tendancesSecteur.suggestionOk") }); },
    onError: () => toast({ title: t("tendancesSecteur.suggestionKo"), variant: "destructive" }),
  });

  if (!data) return null;
  if (compact) {
    if (!data.ouvert || data.tendances.length === 0) return null;
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4" />{t("tendancesSecteur.carteLundi")}</div>
          <Link href={`/projects/${projectId}?onglet=veille`}><Button size="sm" variant="outline">{t("tendancesSecteur.voir")}</Button></Link>
        </CardContent>
      </Card>
    );
  }

  // Refusé (« Aucun des deux ») : plus de « Naya suit pour toi… » ; Naya range de nouveau le projet.
  const actif = data.rattachement && (data.rattachement.statut === "propose" || data.rattachement.statut === "confirme") ? data.rattachement : null;
  const nombre = (x: number) => x.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  const marquerVu = (tend: Tendance) => {
    if (tend.statut !== "nouveau" || dejaVues.current.has(tend.id)) return;
    dejaVues.current.add(tend.id);
    statut.mutate({ id: tend.id, s: "vu" });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" />{t("tendancesSecteur.titre")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {(!data.rattachement || data.rattachement.statut === "refuse") && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.aucunProfil")}</p>}
        {data.rattachement?.statut === "en_attente" && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.enAttente")}</p>}
        {actif && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t("tendancesSecteur.suivi", { profil: actif.nomProfil })}</span>
            <Button size="sm" variant="ghost" onClick={() => setChoix(!choix)}>{t("tendancesSecteur.pasToi")}</Button>
          </div>
        )}
        {choix && (
          <div className="flex flex-wrap gap-2">
            {data.catalogue.filter((c) => c.id !== data.rattachement?.profilId).map((c) => (
              <Button key={c.id} size="sm" variant="outline" onClick={() => changer.mutate(c.id)}>{c.nom}</Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => refuser.mutate()}>{t("tendancesSecteur.aucunDesDeux")}</Button>
          </div>
        )}
        {actif && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) suggerer.mutate(); }}>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder={t("tendancesSecteur.suggererPlaceholder")} className="max-w-xs" />
            <Button size="sm" variant="outline" type="submit">{t("tendancesSecteur.suggerer")}</Button>
          </form>
        )}

        {!data.ouvert && actif && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.ferme")}</p>}
        {data.ouvert && actif && data.tendances.length === 0 && <p className="text-sm text-muted-foreground">{t("tendancesSecteur.rien")}</p>}
        {postCree && <Link href={`/atelier?semaine=${encodeURIComponent(postCree)}`}><Button size="sm">{t("tendancesSecteur.ouvrirAtelier")}</Button></Link>}

        {data.tendances.map((tend) => (
          <div key={tend.id} className="rounded-lg border p-4 space-y-2" onMouseEnter={() => marquerVu(tend)}>
            <div className="font-medium">{tend.libelle} · {tend.plateforme}</div>
            <div className="text-xs text-muted-foreground">{t("tendancesSecteur.mesure", { lift: nombre(tend.lift), forts: tend.nbForts, comptes: tend.nbComptes })}</div>
            <div className="text-sm"><span className="font-medium">{t("tendancesSecteur.pourToi")} : </span>{tend.adaptation}</div>
            <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("tendancesSecteur.pourquoi")}</summary><p className="mt-1">{tend.pourquoi}</p></details>
            {tend.exemples.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-muted-foreground">{t("tendancesSecteur.exemples")} :</span>
                {tend.exemples.map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">{i + 1}<ExternalLink className="h-3 w-3" /></a>)}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => enPost.mutate(tend.id)} disabled={enPost.isPending}><PenLine className="mr-1 h-4 w-4" />{t("tendancesSecteur.enFaireUnPost")}</Button>
              <Button size="sm" variant="outline" onClick={() => statut.mutate({ id: tend.id, s: "garde" })} disabled={tend.statut === "garde"}><Pin className="mr-1 h-4 w-4" />{tend.statut === "garde" ? t("tendancesSecteur.garde") : t("tendancesSecteur.garder")}</Button>
              <Button size="sm" variant="ghost" onClick={() => statut.mutate({ id: tend.id, s: "ecarte" })}><X className="mr-1 h-4 w-4" />{t("tendancesSecteur.ecarter")}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
