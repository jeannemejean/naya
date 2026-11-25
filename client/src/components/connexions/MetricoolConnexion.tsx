// Connexion Metricool (Réglages) : la séance de redémarrage y lit les posts programmés par l'agence.
// L'utilisatrice colle elle-même son jeton API (Metricool, offre Advanced ou Custom) ; il est
// chiffré côté serveur et n'est jamais réaffiché.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface EtatMc { connecte: boolean; etat?: string; blogId?: string }

export default function MetricoolConnexion() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = "/api/metricool/connexion";
  const { data } = useQuery<EtatMc>({ queryKey: [cle], throwOnError: false });
  const [champs, setChamps] = useState({ jeton: "", mcUserId: "", blogId: "" });

  const connecter = useMutation({
    mutationFn: async () => {
      const res = await fetch(cle, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(champs) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "erreur");
    },
    onSuccess: () => { setChamps({ jeton: "", mcUserId: "", blogId: "" }); qc.invalidateQueries({ queryKey: [cle] }); toast({ title: t("metricool.connecte") }); },
    onError: (e: Error) => toast({ title: t("metricool.echec"), description: t(`metricool.raisons.${e.message}`, { defaultValue: "" }), variant: "destructive" }),
  });
  const deconnecter = useMutation({
    mutationFn: async () => { await fetch(cle, { method: "DELETE", credentials: "include" }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: [cle] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("metricool.titre")}</CardTitle>
        <CardDescription>{t("metricool.explication")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.connecte ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{data.etat === "refuse" ? t("metricool.refuse") : t("metricool.etatConnecte", { blogId: data.blogId })}</p>
            <Button size="sm" variant="ghost" disabled={deconnecter.isPending} onClick={() => deconnecter.mutate()}>{t("connexions.deconnecter")}</Button>
          </div>
        ) : (
          <>
            {(["jeton", "mcUserId", "blogId"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`mc-${k}`}>{t(`metricool.champs.${k}`)}</Label>
                <Input id={`mc-${k}`} type={k === "jeton" ? "password" : "text"} autoComplete="off" value={champs[k]}
                  onChange={(e) => setChamps((c) => ({ ...c, [k]: e.target.value }))} />
              </div>
            ))}
            <Button size="sm" disabled={connecter.isPending || !champs.jeton || !champs.mcUserId || !champs.blogId} onClick={() => connecter.mutate()}>
              {t("metricool.connecter")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
