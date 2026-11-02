// Une ligne de connexion Unipile (LinkedIn ou Gmail), partagée par l'écran des connexions d'un
// projet client et par les réglages de l'utilisatrice : seules les routes et les textes changent.
// États : non configuré · à relier · relié · à reconnecter (déconnecté) · restreint (LinkedIn).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface EtatUnipile {
  configured: boolean;
  connected: boolean;
  disconnectedAt?: string | null;
  address?: string | null;
  restricted?: boolean;
  restrictedReason?: string | null;
}

interface Props {
  kind: "linkedin" | "gmail";
  etat: EtatUnipile;
  routes: { lien: string; sync: string; retirer?: string; lever?: string };
  /** Texte d'aide (« connecte… dans la fenêtre qui s'ouvre ») et toast de succès, selon le périmètre. */
  aide: string;
  connecte: string;
  onChange: () => void;
}

export default function LigneUnipile({ kind, etat, routes, aide, connecte, onChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [lienOuvert, setLienOuvert] = useState(false);
  const erreur = () => toast({ title: t("connexions.erreur"), variant: "destructive" });
  const lien = useMutation({
    mutationFn: async () => (await apiRequest("POST", routes.lien)).json(),
    onSuccess: (j: any) => { window.open(j.url, "_blank", "noopener"); setLienOuvert(true); },
    onError: erreur,
  });
  const sync = useMutation({
    mutationFn: () => apiRequest("POST", routes.sync),
    onSuccess: () => { setLienOuvert(false); toast({ title: connecte }); onChange(); },
    onError: (e: any) => toast({
      title: String(e?.message || "").includes(`${kind}_deja_utilise`) ? t(`connexions.${kind}.dejaUtilise`) : t(`connexions.${kind}.introuvable`),
      variant: "destructive",
    }),
  });
  const lever = useMutation({ mutationFn: () => apiRequest("POST", routes.lever!), onSuccess: onChange, onError: erreur });
  const retirer = useMutation({ mutationFn: () => apiRequest("DELETE", routes.retirer!), onSuccess: onChange, onError: erreur });

  const boutonsRelier = (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={lien.isPending} onClick={() => lien.mutate()}>{t("connexions.connecter")}</Button>
      {lienOuvert && <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>{t("connexions.termine")}</Button>}
    </div>
  );

  let corps;
  if (!etat.configured) {
    corps = <p className="text-xs text-muted-foreground">{t(`connexions.${kind}.nonConfigure`)}</p>;
  } else if (etat.connected) {
    const deconnecte = !!etat.disconnectedAt;
    const message = deconnecte
      ? t(`connexions.${kind}.deconnecte`)
      : etat.restricted
        ? t("connexions.linkedin.restreint", { raison: etat.restrictedReason || "" })
        : kind === "gmail" ? t("connexions.gmail.actif", { adresse: etat.address || "" }) : t("connexions.linkedin.actif");
    corps = (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{message}</p>
        {deconnecte && boutonsRelier}
        <div className="flex flex-wrap gap-2">
          {etat.restricted && routes.lever && (
            <Button size="sm" variant="outline" disabled={lever.isPending} onClick={() => lever.mutate()}>{t("connexions.linkedin.lever")}</Button>
          )}
          {routes.retirer && (
            <Button size="sm" variant="ghost" disabled={retirer.isPending} onClick={() => retirer.mutate()}>{t("connexions.deconnecter")}</Button>
          )}
        </div>
      </div>
    );
  } else {
    corps = (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{aide}</p>
        {boutonsRelier}
      </div>
    );
  }
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{t(`connexions.${kind}.titre`)}</h3>
      {corps}
    </section>
  );
}
