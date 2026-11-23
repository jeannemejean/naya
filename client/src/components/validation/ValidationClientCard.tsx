// Carte « Validation client » d'une marque (lot 8, inspiré de Metricool) : activer, règle (une
// validation suffit / tous les relecteurs), relecteurs (10 au plus, sans compte), lien privé du
// portail (créer, régénérer, couper, copier) et les posts en validation avec les commentaires.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, ExternalLink, Link2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { lireReglagesValidation, RELECTEURS_MAX, type RegleValidation } from "@shared/validation-client";
import { BadgeValidation } from "./ValidationPost";

interface Relecteur { nom: string; email: string }
interface Decision { id: number; relecteur: string; decision: "validee" | "refusee" | "commentaire"; commentaire: string | null; le: string }
interface PostVue { id: number; titre: string; texte: string; plateforme: string; prevuLe: string | null; statut: string | null; decisions: Decision[] }
interface Reponse {
  reglages: { actif: boolean; regle: RegleValidation; relecteurs: Relecteur[] } | null;
  portail: { lien: string; creeLe: string; expireLe: string | null } | null;
  posts: PostVue[];
}

export default function ValidationClientCard({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = ["/api/validation/projets", projectId];
  const { data, isLoading } = useQuery<Reponse>({
    queryKey: cle,
    queryFn: async () => (await apiRequest("GET", `/api/validation/projets/${projectId}`)).json(),
    throwOnError: false,
  });

  const [actif, setActif] = useState(false);
  const [regle, setRegle] = useState<RegleValidation>("un");
  const [relecteurs, setRelecteurs] = useState<Relecteur[]>([]);
  useEffect(() => {
    if (!data) return;
    setActif(data.reglages?.actif ?? false);
    setRegle(data.reglages?.regle ?? "un");
    setRelecteurs(data.reglages?.relecteurs ?? []);
  }, [data]);

  const erreur = () => toast({ title: t("validationClient.erreur"), variant: "destructive" });
  const enregistrer = useMutation({
    mutationFn: async () => (await apiRequest("PUT", `/api/validation/projets/${projectId}`, { actif, regle, relecteurs })).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: cle }); toast({ title: t("validationClient.enregistre") }); },
    onError: erreur,
  });
  const creerLien = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/validation/projets/${projectId}/portail`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: cle }),
    onError: erreur,
  });
  const couperLien = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/validation/projets/${projectId}/portail`)).json(),
    onSuccess: () => qc.invalidateQueries({ queryKey: cle }),
    onError: erreur,
  });

  const valides = lireReglagesValidation({ actif, regle, relecteurs }) != null;
  const urlComplete = data?.portail ? `${window.location.origin}${data.portail.lien}` : "";
  const copier = async () => {
    try { await navigator.clipboard.writeText(urlComplete); toast({ title: t("validationClient.portail.copie") }); } catch { erreur(); }
  };
  const majRelecteur = (i: number, champ: keyof Relecteur, v: string) =>
    setRelecteurs((rs) => rs.map((r, j) => (j === i ? { ...r, [champ]: v } : r)));

  return (
    <Card className="p-5 space-y-4" data-testid="carte-validation-client">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-naya-olive-55" />
        <h3 className="text-sm font-semibold text-foreground">{t("validationClient.titre")}</h3>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      <p className="text-xs text-naya-olive-55">{t("validationClient.aide")}</p>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={actif} onCheckedChange={setActif} data-testid="validation-actif" />
        {t("validationClient.activer")}
      </label>

      <div className="space-y-1">
        <p className="text-xs font-medium">{t("validationClient.regle")}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["un", "tous"] as const).map((r) => (
            <label key={r} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name={`regle-${projectId}`} checked={regle === r} onChange={() => setRegle(r)} />
              {t(r === "un" ? "validationClient.regleUn" : "validationClient.regleTous")}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-naya-olive-35">{t("validationClient.regleAide")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">{t("validationClient.relecteurs", { n: relecteurs.length, max: RELECTEURS_MAX })}</p>
        {relecteurs.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="h-8 text-sm" value={r.nom} placeholder={t("validationClient.nom")} aria-label={t("validationClient.nom")}
              onChange={(e) => majRelecteur(i, "nom", e.target.value)} maxLength={80} />
            <Input className="h-8 text-sm" type="email" value={r.email} placeholder={t("validationClient.email")} aria-label={t("validationClient.email")}
              onChange={(e) => majRelecteur(i, "email", e.target.value)} />
            <Button size="sm" variant="ghost" type="button" aria-label={t("validationClient.retirer")} title={t("validationClient.retirer")}
              onClick={() => setRelecteurs((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" type="button" disabled={relecteurs.length >= RELECTEURS_MAX}
            onClick={() => setRelecteurs((rs) => [...rs, { nom: "", email: "" }])}>
            <Plus className="h-3.5 w-3.5 mr-1" />{t("validationClient.ajouter")}
          </Button>
          <Button size="sm" type="button" disabled={!valides || enregistrer.isPending} onClick={() => enregistrer.mutate()} data-testid="validation-enregistrer">
            {enregistrer.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{t("validationClient.enregistrer")}
          </Button>
        </div>
        {!valides && <p className="text-[11px] text-[#5c3d45]">{t("validationClient.invalide", { max: RELECTEURS_MAX })}</p>}
        <p className="text-[11px] text-naya-olive-35">{t("validationClient.pasDeNotification")}</p>
      </div>

      <div className="space-y-2 border-t border-naya-olive-18 pt-3">
        <p className="text-xs font-medium flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />{t("validationClient.portail.titre")}</p>
        {data?.portail ? (
          <>
            <div className="flex items-center gap-2">
              <Input readOnly value={urlComplete} className="h-8 text-xs" onFocus={(e) => e.currentTarget.select()} data-testid="validation-lien" />
              <Button size="sm" variant="outline" type="button" onClick={() => void copier()} aria-label={t("validationClient.portail.copier")} title={t("validationClient.portail.copier")}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <a href={data.portail.lien} target="_blank" rel="noreferrer" aria-label={t("validationClient.portail.ouvrir")} title={t("validationClient.portail.ouvrir")}
                className="inline-flex h-8 items-center px-2 rounded border border-naya-olive-18">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" type="button" disabled={creerLien.isPending}
                onClick={() => { if (window.confirm(t("validationClient.portail.regenererConfirmer"))) creerLien.mutate(); }}>
                {t("validationClient.portail.regenerer")}
              </Button>
              <Button size="sm" variant="ghost" type="button" disabled={couperLien.isPending}
                onClick={() => { if (window.confirm(t("validationClient.portail.couperConfirmer"))) couperLien.mutate(); }}>
                {t("validationClient.portail.couper")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-naya-olive-35">{t("validationClient.portail.aucun")}</p>
            <Button size="sm" variant="outline" type="button" disabled={creerLien.isPending} onClick={() => creerLien.mutate()} data-testid="validation-creer-lien">
              {t("validationClient.portail.creer")}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-naya-olive-18 pt-3">
        <p className="text-xs font-medium">{t("validationClient.posts.titre")}</p>
        {(data?.posts ?? []).length === 0 ? (
          <p className="text-xs text-naya-olive-35">{t("validationClient.posts.vide")}</p>
        ) : (
          <ul className="space-y-2">
            {data!.posts.map((p) => (
              <li key={p.id} className="rounded border border-naya-olive-18 p-2 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium truncate max-w-[60%]">{p.titre}</span>
                  <span className="text-[11px] text-naya-olive-55">{p.plateforme}</span>
                  <span className="text-[11px] text-naya-olive-35">{p.prevuLe ? format(new Date(p.prevuLe), "dd/MM/yyyy HH:mm") : t("validationClient.posts.sansDate")}</span>
                  <BadgeValidation statut={p.statut} />
                </div>
                {p.decisions.map((d) => (
                  <p key={d.id} className="text-xs text-naya-olive-70">
                    <span className="font-medium">{t(`validationClient.decision.${d.decision}`, { nom: d.relecteur })}</span>
                    {d.commentaire ? <span className="whitespace-pre-wrap"> — {d.commentaire}</span> : null}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
