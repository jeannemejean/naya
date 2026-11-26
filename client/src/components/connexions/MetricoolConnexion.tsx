// Connexion Metricool (Réglages) : la séance de redémarrage y lit les posts programmés, marque par
// marque. L'utilisatrice colle elle-même son jeton API (Metricool, offre Advanced ou Custom) et son
// userId ; Naya trouve ses marques et elle coche celles à regarder. Le jeton est chiffré côté
// serveur et n'est jamais réaffiché : changer de marques ensuite ne demande pas de le recoller.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface MarqueMc { blogId: string; nom: string }
interface EtatMc { connecte: boolean; etat?: string; marques?: MarqueMc[] }

const CLE = "/api/metricool/connexion";

async function appel(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const corps = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corps?.message ?? "erreur");
  return corps;
}

export default function MetricoolConnexion() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<EtatMc>({ queryKey: [CLE], throwOnError: false });
  const [champs, setChamps] = useState({ jeton: "", mcUserId: "" });
  // Marques trouvées sur le compte (null tant qu'on ne les a pas demandées) et cochées.
  const [trouvees, setTrouvees] = useState<MarqueMc[] | null>(null);
  const [coches, setCoches] = useState<string[]>([]);

  const echec = (e: Error) => toast({ title: t("metricool.echec"), description: t(`metricool.raisons.${e.message}`, { defaultValue: "" }), variant: "destructive" });
  // Déjà connectée : le serveur reprend le jeton enregistré (corps vide).
  const identifiants = () => (data?.connecte ? {} : champs);

  const trouver = useMutation({
    mutationFn: () => appel("/api/metricool/marques", "POST", identifiants()),
    onSuccess: (r: { marques: MarqueMc[] }) => {
      setTrouvees(r.marques);
      const suivies = data?.marques?.map((m) => m.blogId) ?? [];
      const deja = r.marques.filter((m) => suivies.includes(m.blogId)).map((m) => m.blogId);
      setCoches(deja.length ? deja : r.marques.map((m) => m.blogId));
    },
    onError: echec,
  });
  const connecter = useMutation({
    mutationFn: () => appel(CLE, "PUT", { ...identifiants(), blogIds: coches }),
    onSuccess: () => {
      setChamps({ jeton: "", mcUserId: "" }); setTrouvees(null);
      qc.invalidateQueries({ queryKey: [CLE] });
      toast({ title: t("metricool.connecte") });
    },
    onError: echec,
  });
  const deconnecter = useMutation({
    mutationFn: async () => { await fetch(CLE, { method: "DELETE", credentials: "include" }); },
    onSuccess: () => { setTrouvees(null); qc.invalidateQueries({ queryKey: [CLE] }); },
  });

  const basculer = (id: string, oui: boolean) => setCoches((c) => (oui ? [...c, id] : c.filter((x) => x !== id)));

  const choix = trouvees && (
    <div className="space-y-2">
      {trouvees.length ? (
        <>
          <p className="text-sm">{t("metricool.choisirMarques")}</p>
          {trouvees.map((m) => (
            <div key={m.blogId} className="flex items-center gap-2">
              <Checkbox id={`mc-marque-${m.blogId}`} checked={coches.includes(m.blogId)} onCheckedChange={(v) => basculer(m.blogId, v === true)} />
              <Label htmlFor={`mc-marque-${m.blogId}`} className="font-normal">{m.nom}</Label>
            </div>
          ))}
          <Button size="sm" disabled={connecter.isPending || !coches.length} onClick={() => connecter.mutate()}>
            {t("metricool.connecter")}
          </Button>
        </>
      ) : (
        <p className="text-sm">{t("metricool.aucuneMarque")}</p>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("metricool.titre")}</CardTitle>
        <CardDescription>{t("metricool.explication")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.connecte ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                {data.etat === "refuse" ? t("metricool.refuse") : t("metricool.etatConnecte", { marques: (data.marques ?? []).map((m) => m.nom).join(", ") })}
              </p>
              <div className="flex gap-2">
                {!trouvees && (
                  <Button size="sm" variant="outline" disabled={trouver.isPending} onClick={() => trouver.mutate()}>{t("metricool.changerMarques")}</Button>
                )}
                <Button size="sm" variant="ghost" disabled={deconnecter.isPending} onClick={() => deconnecter.mutate()}>{t("connexions.deconnecter")}</Button>
              </div>
            </div>
            {choix}
          </>
        ) : (
          <>
            {(["jeton", "mcUserId"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`mc-${k}`}>{t(`metricool.champs.${k}`)}</Label>
                <Input id={`mc-${k}`} type={k === "jeton" ? "password" : "text"} autoComplete="off" value={champs[k]}
                  onChange={(e) => { setChamps((c) => ({ ...c, [k]: e.target.value })); setTrouvees(null); }} />
                {k === "mcUserId" && <p className="text-xs text-muted-foreground">{t("metricool.aideUserId")}</p>}
              </div>
            ))}
            {choix ?? (
              <Button size="sm" disabled={trouver.isPending || !champs.jeton || !champs.mcUserId} onClick={() => trouver.mutate()}>
                {t("metricool.trouverMarques")}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
