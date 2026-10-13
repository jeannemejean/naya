// Connexions d'un projet CLIENT (mode agence, spec 2026-10-13-connexions-client-design.md) :
// ses réseaux sociaux, son expéditeur e-mail et sa signature, son compte LinkedIn. Un projet
// client publie et prospecte UNIQUEMENT avec celles-ci — jamais avec les connexions de
// l'utilisatrice. Sans connexion, Naya prépare et l'utilisatrice publie ou envoie elle-même.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const RESEAUX = [
  { id: "instagram", nom: "Instagram" },
  { id: "linkedin", nom: "LinkedIn" },
  { id: "tiktok", nom: "TikTok" },
] as const;

interface Statut { connected: boolean; etat: string; accountName?: string; configured: boolean; pagesCount?: number }
interface Email { senderEmail: string; senderName: string; address: string; city: string; country: string; hasOwnKey: boolean; verificationStatus: string }
interface Linkedin { configured: boolean; connected: boolean; restricted: boolean; restrictedReason: string | null }
interface Connexions { reseaux: { statut: Record<string, Statut> }; email: Email; linkedin: Linkedin }

export default function ConnexionsClientPanel({ projectId }: { projectId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const cle = `/api/projects/${projectId}/connexions`;
  const { data, isLoading } = useQuery<Connexions>({ queryKey: [cle] });
  const rafraichir = () => qc.invalidateQueries({ queryKey: [cle] });

  // Retour d'OAuth : la connexion d'un réseau revient sur cette page avec ?social=…&status=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const social = params.get("social");
    const st = params.get("status");
    if (!social || !st) return;
    if (st === "connected") toast({ title: t("connexions.reseaux.connecte", { reseau: social }) });
    else toast({ title: t("connexions.reseaux.echec"), description: params.get("reason") || undefined, variant: "destructive" });
    const url = new URL(window.location.href);
    ["social", "status", "reason"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
    rafraichir();
  }, []);

  const erreur = () => toast({ title: t("connexions.erreur"), variant: "destructive" });

  const connecter = useMutation({
    mutationFn: async (reseau: string) => {
      const res = await fetch(`/api/social/oauth/${reseau}/url?projectId=${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      window.location.href = j.url;
    },
    onError: erreur,
  });
  const deconnecter = useMutation({
    mutationFn: (reseau: string) => apiRequest("DELETE", `/api/social/disconnect/${reseau}?projectId=${projectId}`),
    onSuccess: rafraichir,
    onError: erreur,
  });

  return (
    <Card className="p-4 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Plug className="w-4 h-4 text-naya-salvia" />
          {t("connexions.titre")}
        </h2>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">{t("connexions.regle")}</p>
      </div>

      {isLoading || !data ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("connexions.reseaux.titre")}</h3>
            {RESEAUX.map(({ id, nom }) => {
              const s = data.reseaux.statut[id];
              return (
                <div key={id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <span className="text-sm font-medium min-w-24">{nom}</span>
                  <span className="text-xs text-muted-foreground flex-1">
                    {!s?.configured
                      ? t("connexions.reseaux.nonConfigure")
                      : s.connected
                        ? t("connexions.reseaux.compte", { compte: s.accountName || nom })
                        : s.etat === "expiree"
                          ? t("connexions.reseaux.expire")
                          : t("connexions.reseaux.absent")}
                  </span>
                  {s?.configured && (s.connected || s.etat === "expiree") && (
                    <Button size="sm" variant="ghost" disabled={deconnecter.isPending} onClick={() => deconnecter.mutate(id)}>
                      {t("connexions.deconnecter")}
                    </Button>
                  )}
                  {s?.configured && !s.connected && (
                    <Button size="sm" variant="outline" disabled={connecter.isPending} onClick={() => connecter.mutate(id)}>
                      {t("connexions.connecter")}
                    </Button>
                  )}
                </div>
              );
            })}
          </section>

          <EmailClient projectId={projectId} email={data.email} onSaved={rafraichir} />
          <LinkedinClient projectId={projectId} linkedin={data.linkedin} onChange={rafraichir} />
        </>
      )}
    </Card>
  );
}

function EmailClient({ projectId, email, onSaved }: { projectId: number; email: Email; onSaved: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [form, setForm] = useState({
    senderEmail: email.senderEmail, senderName: email.senderName, address: email.address, city: email.city, country: email.country, sendgridApiKey: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const enregistrer = useMutation({
    mutationFn: () => {
      // Clé vide = inchangée (on ne l'efface pas par mégarde).
      const { sendgridApiKey, ...reste } = form;
      return apiRequest("PUT", `/api/projects/${projectId}/connexions/email`, sendgridApiKey.trim() ? form : reste);
    },
    onSuccess: () => { toast({ title: t("connexions.email.enregistre") }); setForm((f) => ({ ...f, sendgridApiKey: "" })); onSaved(); },
    onError: () => toast({ title: t("connexions.erreur"), variant: "destructive" }),
  });
  const verifier = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/connexions/email/verify`),
    onSuccess: () => { toast({ title: t("connexions.email.verificationEnvoyee") }); onSaved(); },
    onError: () => toast({ title: t("connexions.email.verificationImpossible"), variant: "destructive" }),
  });
  const champ = (k: keyof typeof form, label: string, type = "text") => (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={form[k]} onChange={set(k)} className="h-8 text-sm" />
    </div>
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("connexions.email.titre")}</h3>
        {email.senderEmail && (
          <Badge variant="outline" className="text-[10px]">{t(`connexions.email.statut.${email.verificationStatus}`, { defaultValue: email.verificationStatus })}</Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("connexions.email.aide")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {champ("senderEmail", t("connexions.email.adresse"), "email")}
        {champ("senderName", t("connexions.email.signature"))}
        {champ("address", t("connexions.email.rue"))}
        {champ("city", t("connexions.email.ville"))}
        {champ("country", t("connexions.email.pays"))}
        <div>
          <Label className="text-xs">{t("connexions.email.cle")}</Label>
          <Input
            type="password" value={form.sendgridApiKey} onChange={set("sendgridApiKey")} className="h-8 text-sm"
            placeholder={email.hasOwnKey ? t("connexions.email.cleGardee") : t("connexions.email.clePartagee")}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={enregistrer.isPending} onClick={() => enregistrer.mutate()}>{t("connexions.enregistrer")}</Button>
        {email.senderEmail && email.verificationStatus !== "verified" && (
          <Button size="sm" variant="outline" disabled={verifier.isPending} onClick={() => verifier.mutate()}>{t("connexions.email.verifier")}</Button>
        )}
      </div>
    </section>
  );
}

function LinkedinClient({ projectId, linkedin, onChange }: { projectId: number; linkedin: Linkedin; onChange: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [lienOuvert, setLienOuvert] = useState(false);
  const base = `/api/projects/${projectId}/connexions/linkedin`;
  const erreur = () => toast({ title: t("connexions.erreur"), variant: "destructive" });
  const lien = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${base}/lien`)).json(),
    onSuccess: (j: any) => { window.open(j.url, "_blank", "noopener"); setLienOuvert(true); },
    onError: erreur,
  });
  const sync = useMutation({
    mutationFn: () => apiRequest("POST", `${base}/sync`),
    onSuccess: () => { setLienOuvert(false); toast({ title: t("connexions.linkedin.connecte") }); onChange(); },
    onError: () => toast({ title: t("connexions.linkedin.introuvable"), variant: "destructive" }),
  });
  const lever = useMutation({ mutationFn: () => apiRequest("POST", `${base}/lever-restriction`), onSuccess: onChange, onError: erreur });
  const retirer = useMutation({ mutationFn: () => apiRequest("DELETE", base), onSuccess: onChange, onError: erreur });

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("connexions.linkedin.titre")}</h3>
      {!linkedin.configured ? (
        <p className="text-xs text-muted-foreground">{t("connexions.linkedin.nonConfigure")}</p>
      ) : linkedin.connected ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {linkedin.restricted ? t("connexions.linkedin.restreint", { raison: linkedin.restrictedReason || "" }) : t("connexions.linkedin.actif")}
          </p>
          <div className="flex flex-wrap gap-2">
            {linkedin.restricted && (
              <Button size="sm" variant="outline" disabled={lever.isPending} onClick={() => lever.mutate()}>{t("connexions.linkedin.lever")}</Button>
            )}
            <Button size="sm" variant="ghost" disabled={retirer.isPending} onClick={() => retirer.mutate()}>{t("connexions.deconnecter")}</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("connexions.linkedin.aide")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={lien.isPending} onClick={() => lien.mutate()}>{t("connexions.connecter")}</Button>
            {lienOuvert && (
              <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>{t("connexions.linkedin.termine")}</Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
