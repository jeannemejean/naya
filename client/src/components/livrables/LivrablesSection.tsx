import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACCEPT_FICHIER, lienValide } from "@shared/livrables";
import {
  cleLivrablesTache, estCleListeLivrables, creerLivrableApi, modifierLivrableApi, supprimerLivrableApi, televerser,
  type LivrableClient,
} from "@/lib/livrables-api";
import { LivrableCarte } from "./LivrableCarte";

type Brouillon =
  | { id: string; kind: "media" | "fichier"; file: File; apercu: string | null; urlEnvoyee?: string; content: string; erreur: string | null; envoi: boolean }
  | { id: string; kind: "texte" | "lien"; url: string; content: string; erreur: string | null; envoi: boolean };

export default function LivrablesSection({
  taskId, focus, onFaitHorsNaya,
}: {
  taskId: number;
  focus: boolean;
  onFaitHorsNaya?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const media = useRef<HTMLInputElement>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [brouillons, setBrouillons] = useState<Brouillon[]>([]);

  // Aperçus (object URLs) à libérer au démontage.
  const brouillonsRef = useRef<Brouillon[]>([]);
  brouillonsRef.current = brouillons;
  useEffect(() => () => {
    brouillonsRef.current.forEach((b) => { if ("apercu" in b && b.apercu) URL.revokeObjectURL(b.apercu); });
  }, []);

  const retirer = (b: Brouillon) => {
    if ("apercu" in b && b.apercu) URL.revokeObjectURL(b.apercu);
    setBrouillons((bs) => bs.filter((x) => x.id !== b.id));
  };

  const { data: livrables = [], isError } = useQuery<LivrableClient[]>({ queryKey: cleLivrablesTache(taskId), throwOnError: false });
  const { data: config } = useQuery<{ fichiers: boolean; medias: boolean }>({ queryKey: ["/api/livrables/config"], throwOnError: false });

  const invalider = () => Promise.all([
    qc.invalidateQueries({ queryKey: cleLivrablesTache(taskId) }),
    qc.invalidateQueries({ predicate: (q) => estCleListeLivrables(q.queryKey) }),
    qc.invalidateQueries({ queryKey: ["/api/media-library"] }),
  ]);
  const maj = (id: string, patch: Partial<Brouillon>) =>
    setBrouillons((bs) => bs.map((b) => (b.id === id ? ({ ...b, ...patch } as Brouillon) : b)));
  const nouvelId = () => Math.random().toString(36).slice(2);

  const ajouterFichiers = (kind: "media" | "fichier", files: FileList | null) => {
    if (!files) return;
    const nouveaux: Brouillon[] = Array.from(files).map((file) => ({
      id: nouvelId(), kind, file, content: "", erreur: null, envoi: false,
      apercu: kind === "media" && file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setBrouillons((bs) => [...bs, ...nouveaux]);
  };

  const deposer = async (b: Brouillon) => {
    maj(b.id, { envoi: true, erreur: null });
    try {
      if (b.kind === "media" || b.kind === "fichier") {
        // Un envoi déjà réussi n'est pas refait lors d'une nouvelle tentative.
        let url = b.urlEnvoyee;
        if (!url) {
          url = (await televerser(b.kind, b.file)).url;
          maj(b.id, { urlEnvoyee: url });
        }
        await creerLivrableApi({
          taskId, kind: b.kind, url, content: b.content || null,
          fileName: b.file.name, mimeType: b.file.type, size: b.file.size,
        });
        if (b.apercu) URL.revokeObjectURL(b.apercu);
      } else {
        if (b.kind === "lien" && !lienValide(b.url)) throw new Error("invalid_url");
        await creerLivrableApi({ taskId, kind: b.kind, url: b.kind === "lien" ? b.url : null, content: b.content || null });
      }
      setBrouillons((bs) => bs.filter((x) => x.id !== b.id));
      invalider();
    } catch (e: any) {
      const cle = `livrables.err_${e?.message}`;
      const msg = t(cle) === cle ? t("livrables.err_generic") : t(cle);
      maj(b.id, { envoi: false, erreur: msg });
    }
  };

  const modifier = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string | null }) => modifierLivrableApi(id, content),
    onSuccess: invalider,
    onError: () => toast({ description: t("livrables.err_update"), variant: "destructive" }),
  });
  const supprimer = useMutation({
    mutationFn: (id: number) => supprimerLivrableApi(id),
    onSuccess: invalider,
    onError: () => toast({ description: t("livrables.err_delete"), variant: "destructive" }),
  });

  return (
    <section className={`space-y-3 rounded-lg p-3 ${focus ? "ring-2 ring-naya-sulphur/60 bg-naya-sulphur/5" : ""}`}>
      <h3 className="text-sm font-semibold text-foreground">{t("livrables.title")}</h3>

      {focus && !isError && livrables.length === 0 && (
        <div className="text-sm space-y-2">
          <p className="font-medium">{t("livrables.askTitle")}</p>
          <p className="text-muted-foreground">{t("livrables.askBody")}</p>
          {onFaitHorsNaya && (
            <Button size="sm" variant="outline" onClick={onFaitHorsNaya}>{t("livrables.doneOutside")}</Button>
          )}
        </div>
      )}

      {focus && !isError && livrables.length > 0 && onFaitHorsNaya && (
        <Button size="sm" onClick={onFaitHorsNaya}>{t("livrables.finishTask")}</Button>
      )}

      {isError && <p className="text-xs text-muted-foreground">{t("livrables.err_load")}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() =>
          setBrouillons((bs) => [...bs, { id: nouvelId(), kind: "texte", url: "", content: "", erreur: null, envoi: false }])}>
          {t("livrables.addText")}
        </Button>
        <Button size="sm" variant="outline" disabled={config ? !config.medias : false} onClick={() => media.current?.click()}>
          {t("livrables.addMedia")}
        </Button>
        <Button size="sm" variant="outline" disabled={!config?.fichiers} title={config?.fichiers ? undefined : t("livrables.fileSoon")}
          onClick={() => fichier.current?.click()}>
          {t("livrables.addFile")}{config && !config.fichiers ? ` · ${t("livrables.fileSoon")}` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={() =>
          setBrouillons((bs) => [...bs, { id: nouvelId(), kind: "lien", url: "", content: "", erreur: null, envoi: false }])}>
          {t("livrables.addLink")}
        </Button>
        <input ref={media} type="file" accept="image/*,video/*" multiple hidden
          onChange={(e) => { ajouterFichiers("media", e.target.files); e.target.value = ""; }} />
        <input ref={fichier} type="file" accept={ACCEPT_FICHIER} multiple hidden
          onChange={(e) => { ajouterFichiers("fichier", e.target.files); e.target.value = ""; }} />
      </div>

      {brouillons.map((b) => (
        <div key={b.id} className="rounded-md border border-dashed border-naya-olive-18 p-3 space-y-2">
          {b.kind === "media" && b.apercu && <img src={b.apercu} alt="" className="h-24 rounded object-cover" />}
          {(b.kind === "media" || b.kind === "fichier") && <p className="text-xs text-muted-foreground break-all">{b.file.name}</p>}
          {b.kind === "lien" && (
            <Input placeholder={t("livrables.linkPlaceholder")} value={b.url} onChange={(e) => maj(b.id, { url: e.target.value })} />
          )}
          <Textarea
            rows={b.kind === "texte" ? 5 : 2}
            placeholder={b.kind === "texte" ? t("livrables.textPlaceholder") : b.kind === "media" ? t("livrables.descriptionPlaceholder") : t("livrables.note")}
            value={b.content}
            onChange={(e) => maj(b.id, { content: e.target.value })}
          />
          {b.erreur && <p className="text-xs text-naya-mauve">{b.erreur}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={b.envoi || (b.kind === "texte" && !b.content.trim()) || (b.kind === "lien" && !b.url.trim())} onClick={() => deposer(b)}>
              {b.envoi ? t("livrables.saving") : b.erreur ? t("livrables.retry") : t("livrables.save")}
            </Button>
            <Button size="sm" variant="ghost" disabled={b.envoi} onClick={() => retirer(b)}>
              {t("livrables.remove")}
            </Button>
          </div>
        </div>
      ))}

      {!isError && livrables.length === 0 && brouillons.length === 0 && !focus && (
        <p className="text-xs text-muted-foreground">{t("livrables.empty")}</p>
      )}
      {livrables.map((l) => (
        <LivrableCarte key={l.id} livrable={l} enCours={modifier.isPending || supprimer.isPending}
          onModifier={(content) => modifier.mutateAsync({ id: l.id, content }).then(() => undefined)}
          onSupprimer={() => supprimer.mutate(l.id)} />
      ))}
    </section>
  );
}
