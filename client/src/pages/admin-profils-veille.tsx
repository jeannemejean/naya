import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/sidebar";
import OngletsEspace from "@/components/navigation/OngletsEspace";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Compte = { id: number; plateforme: string; compte: string; url: string; statut: string; origine: string };
type Profil = { id: number; nom: string; description: string; statut: string; origine: string; comptes: Compte[]; nbProjets: number; nbEnAttente: number; depenseMois: number; passages: Array<{ id: number; jour: string; statut: string; postsNouveaux: number; echecs: number; erreur: string | null }> };
const CLE = ["/api/admin/profils-veille"];

// apiRequest lève une Error dont le message commence par le statut HTTP puis le corps ("409: {...}").
function estPlafond(e: unknown): boolean {
  return e instanceof Error && e.message.includes("plafond_comptes");
}

export default function AdminProfilsVeille({ onSearchClick }: { onSearchClick?: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const estOwner = (user as any)?.role === "owner";
  const { data } = useQuery<{ profils: Profil[]; plafond: number }>({ queryKey: CLE, enabled: estOwner });
  const rafraichir = () => queryClient.invalidateQueries({ queryKey: CLE });
  const surErreurCompte = (e: unknown) => { if (estPlafond(e)) toast({ title: t("adminProfils.plafondComptes"), variant: "destructive" }); };
  const [nom, setNom] = useState(""); const [description, setDescription] = useState("");
  const creer = useMutation({ mutationFn: () => apiRequest("POST", "/api/admin/profils-veille", { nom, description }), onSuccess: () => { setNom(""); setDescription(""); rafraichir(); } });
  const majProfil = useMutation({ mutationFn: ({ id, statut }: { id: number; statut: string }) => apiRequest("PATCH", `/api/admin/profils-veille/${id}`, { statut }), onSuccess: rafraichir });
  const majCompte = useMutation({ mutationFn: ({ id, statut }: { id: number; statut: string }) => apiRequest("PATCH", `/api/admin/profils-veille/comptes/${id}`, { statut }), onSuccess: rafraichir, onError: surErreurCompte });
  const lancer = useMutation({ mutationFn: ({ id, etape }: { id: number; etape: string }) => apiRequest("POST", `/api/admin/profils-veille/${id}/lancer`, { etape }, { timeoutMs: 600_000 }), onSuccess: rafraichir });

  if (!estOwner) return <div className="p-8">{t("adminProfils.interdit")}</div>;
  return (
    <div className="flex h-screen">
      <Sidebar onSearchClick={onSearchClick} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <OngletsEspace />
        <main className="flex-1 overflow-y-auto p-6 space-y-6">
          <h1 className="text-2xl font-semibold">{t("adminProfils.titre")}</h1>
          <Card>
            <CardHeader><CardTitle>{t("adminProfils.nouveau")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t("adminProfils.nom")} />
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("adminProfils.description")} />
              <Button onClick={() => creer.mutate()} disabled={nom.trim().length < 2}>{t("adminProfils.creer")}</Button>
            </CardContent>
          </Card>
          {data?.profils.map((p) => <CarteProfil key={p.id} p={p} plafond={data.plafond} onStatut={(statut) => majProfil.mutate({ id: p.id, statut })} onCompte={(id, statut) => majCompte.mutate({ id, statut })} onLancer={(etape) => lancer.mutate({ id: p.id, etape })} onRafraichir={rafraichir} onErreurCompte={surErreurCompte} />)}
          <Etiquetage />
        </main>
      </div>
    </div>
  );
}

function CarteProfil({ p, plafond, onStatut, onCompte, onLancer, onRafraichir, onErreurCompte }: { p: Profil; plafond: number; onStatut: (s: string) => void; onCompte: (id: number, s: string) => void; onLancer: (e: string) => void; onRafraichir: () => void; onErreurCompte: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [saisie, setSaisie] = useState("");
  const ajouter = useMutation({ mutationFn: () => apiRequest("POST", `/api/admin/profils-veille/${p.id}/comptes`, { plateforme: "instagram", saisie, statut: "suivi" }), onSuccess: () => { setSaisie(""); onRafraichir(); }, onError: onErreurCompte });
  const { data: tend } = useQuery<{ tendances: Array<{ id: number; semaine: string; plateforme: string; typeMedia: string; structure: string; lift: number; pourquoi: string; ecarteParJeanne: boolean }> }>({ queryKey: [`/api/admin/profils-veille/${p.id}/tendances`] });
  const diffuser = useMutation({ mutationFn: ({ id, ecarte }: { id: number; ecarte: boolean }) => apiRequest("PATCH", `/api/admin/profils-veille/tendances/${id}`, { ecarteParJeanne: ecarte }), onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/admin/profils-veille/${p.id}/tendances`] }) });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>{p.nom} · {t(`adminProfils.statut.${p.statut}`)}</span>
          <span className="text-sm font-normal">{t("adminProfils.depense", { eur: p.depenseMois.toFixed(2), plafond })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{p.description}</p>
        <p>{t("adminProfils.projets", { n: p.nbProjets })}{p.nbEnAttente ? ` · ${t("adminProfils.enAttente", { n: p.nbEnAttente })}` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {p.statut !== "actif" && <Button size="sm" onClick={() => onStatut("actif")}>{t("adminProfils.activer")}</Button>}
          {p.statut === "actif" && <Button size="sm" variant="outline" onClick={() => onStatut("en_pause")}>{t("adminProfils.pause")}</Button>}
          <Button size="sm" variant="ghost" onClick={() => onStatut("archive")}>{t("adminProfils.archiver")}</Button>
          <Button size="sm" variant="outline" onClick={() => onLancer("collecte")}>{t("adminProfils.lancerCollecte")}</Button>
          <Button size="sm" variant="outline" onClick={() => onLancer("analyse")}>{t("adminProfils.lancerAnalyse")}</Button>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.comptes")}</div>
          <p className="text-xs text-muted-foreground">{t("adminProfils.plafondComptes")}</p>
          <ul className="mt-1 space-y-1">
            {p.comptes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <a href={c.url} target="_blank" rel="noreferrer" className="underline">{t("adminProfils.handle", { compte: c.compte, interpolation: { escapeValue: false } })}</a>
                <span className="text-xs text-muted-foreground">{t(`adminProfils.compteStatut.${c.statut}`)} · {t(`adminProfils.origine.${c.origine}`)}</span>
                {c.statut !== "suivi" && <Button size="sm" variant="outline" onClick={() => onCompte(c.id, "suivi")}>{t("adminProfils.suivre")}</Button>}
                {c.statut !== "ecarte" && <Button size="sm" variant="ghost" onClick={() => onCompte(c.id, "ecarte")}>{t("adminProfils.ecarter")}</Button>}
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) ajouter.mutate(); }}>
            <Input value={saisie} onChange={(e) => setSaisie(e.target.value)} placeholder={t("tendancesSecteur.suggererPlaceholder")} className="max-w-xs" />
            <Button size="sm" type="submit">{t("adminProfils.ajouterCompte")}</Button>
          </form>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.passages")}</div>
          <ul className="text-xs">{p.passages.map((x) => <li key={x.id}>{x.jour} · {x.statut} · +{x.postsNouveaux} · {x.echecs}{x.erreur ? ` · ${x.erreur}` : ""}</li>)}</ul>
        </div>
        <div>
          <div className="font-medium">{t("adminProfils.tendances")}</div>
          <ul className="space-y-1">
            {tend?.tendances.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2">
                <span>{x.semaine} · {x.plateforme} · {x.typeMedia} {x.structure} · {t("adminProfils.multiplicateur", { lift: x.lift.toFixed(1) })}</span>
                <Button size="sm" variant="ghost" onClick={() => diffuser.mutate({ id: x.id, ecarte: !x.ecarteParJeanne })}>{x.ecarteParJeanne ? t("adminProfils.diffuser") : t("adminProfils.ecarterTendance")}</Button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function Etiquetage() {
  const { t } = useTranslation();
  const { data } = useQuery<{ posts: Array<{ id: number; typeMedia: string; legende: string; url: string }>; structures: string[]; accroches: string[] }>({ queryKey: ["/api/admin/profils-veille/etiquetage"] });
  const [choix, setChoix] = useState<Record<number, { structure?: string; accroche?: string }>>({});
  const enregistrer = useMutation({
    mutationFn: (postId: number) => apiRequest("POST", "/api/admin/profils-veille/etiquettes", { postId, ...choix[postId] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/profils-veille/etiquetage"] }),
  });
  if (!data || data.posts.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("adminProfils.etiquetage")}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t("adminProfils.etiquetageAide")}</p>
        {data.posts.map((p) => (
          <div key={p.id} className="rounded border p-3 space-y-2">
            <a href={p.url} target="_blank" rel="noreferrer" className="text-xs underline">{p.typeMedia}</a>
            <p>{p.legende}</p>
            <div className="flex flex-wrap gap-2">
              <select aria-label={t("adminProfils.structure")} value={choix[p.id]?.structure ?? ""} onChange={(e) => setChoix({ ...choix, [p.id]: { ...choix[p.id], structure: e.target.value } })}>
                <option value="">{t("adminProfils.structure")}</option>
                {data.structures.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label={t("adminProfils.accroche")} value={choix[p.id]?.accroche ?? ""} onChange={(e) => setChoix({ ...choix, [p.id]: { ...choix[p.id], accroche: e.target.value } })}>
                <option value="">{t("adminProfils.accroche")}</option>
                {data.accroches.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <Button size="sm" disabled={!choix[p.id]?.structure || !choix[p.id]?.accroche} onClick={() => enregistrer.mutate(p.id)}>{t("adminProfils.enregistrer")}</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
