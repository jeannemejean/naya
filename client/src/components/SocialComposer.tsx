import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ALT_TEXTE_MAX, NOM_AUDIO_MAX, lireCollaborateurs } from "@shared/options-post";
import { ObjectUploader } from "@/components/ObjectUploader";
import TextesEnregistres from "@/components/content/TextesEnregistres";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, AlertCircle, Image as ImageIcon, Video } from "lucide-react";
import {
  formatsFor, validatePost, capabilitiesFor,
  type Platform, type PostFormat, type MediaInput,
} from "@shared/social-capabilities";

interface Account { id: number; platform: string; basePlatform: string; accountName: string; isPage: boolean }
interface MediaAsset { id: number; url: string; kind: "image" | "video"; durationSec?: number; name: string }

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok" };

function probeVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    v.onerror = () => reject(new Error("probe_failed"));
    v.src = url;
  });
}

/** Choisit un format par défaut selon le réseau et les médias présents. */
function defaultFormat(platform: Platform, media: MediaAsset[]): PostFormat {
  const available = formatsFor(platform).map((f) => f.format);
  const hasVideo = media.some((m) => m.kind === "video");
  const many = media.length > 1;
  if (platform === "tiktok") return "short";
  if (many && available.includes("carousel")) return "carousel";
  if (hasVideo && available.includes("reel")) return "reel";
  if (hasVideo && available.includes("feed_video")) return "feed_video";
  if (media.length === 1 && available.includes("feed_image")) return "feed_image";
  return available[0];
}

export function SocialComposer({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId?: number | null }) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Comptes du périmètre du projet : un projet client ne propose que les comptes du client.
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: [projectId ? `/api/social/accounts?projectId=${projectId}` : "/api/social/accounts"],
    enabled: open,
  });

  const [selected, setSelected] = useState<Record<number, PostFormat>>({}); // accountId -> format
  const [caption, setCaption] = useState("");
  // Légende adaptée par réseau (Metricool) : vide = la légende commune.
  const [adapter, setAdapter] = useState(false);
  const [legendes, setLegendes] = useState<Record<number, string>>({});
  const [premierCommentaire, setPremierCommentaire] = useState("");
  const zoneLegende = useRef<HTMLTextAreaElement>(null);
  const zoneCommentaire = useRef<HTMLTextAreaElement>(null);
  const [couvertureSec, setCouvertureSec] = useState("");
  // Options de publication : Instagram (alt, collaborateurs, Reel) et carrousel PDF LinkedIn.
  const [texteAlternatif, setTexteAlternatif] = useState("");
  const [collaborateurs, setCollaborateurs] = useState("");
  const [reelDansLeFil, setReelDansLeFil] = useState<"defaut" | "oui" | "non">("defaut");
  const [nomAudio, setNomAudio] = useState("");
  const [linkedinDocument, setLinkedinDocument] = useState(false);
  const legendeDe = (accId: number) => (adapter && legendes[accId]?.trim() ? legendes[accId] : caption);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [scheduledFor, setScheduledFor] = useState("");
  // Publication automatique sur demande seulement (le serveur ne l'active plus par défaut).
  const [autoPost, setAutoPost] = useState(false);
  const [uploading, setUploading] = useState(false);

  const mediaInputs: MediaInput[] = media.map((m) => ({ kind: m.kind, durationSec: m.durationSec }));

  function toggleAccount(acc: Account) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[acc.id]) delete next[acc.id];
      else next[acc.id] = defaultFormat(acc.basePlatform as Platform, media);
      return next;
    });
  }

  // Validation par cible
  const validations = useMemo(() => {
    return Object.entries(selected).map(([accId, format]) => {
      const acc = accounts.find((a) => a.id === Number(accId))!;
      const r = validatePost({ platform: acc.basePlatform as Platform, format, media: mediaInputs, caption: legendeDe(acc.id) });
      return { acc, format, ...r };
    });
  }, [selected, accounts, media, caption, adapter, legendes]); // eslint-disable-line react-hooks/exhaustive-deps

  const allValid = validations.length > 0 && validations.every((v) => v.ok);

  async function handleUpload(result: any) {
    setUploading(true);
    try {
      for (const f of result.successful || []) {
        const url = f.meta?.publicUrl || f.uploadURL;
        const kind: "image" | "video" = (f.type || "").startsWith("video/") ? "video" : "image";
        let durationSec: number | undefined, width: number | undefined, height: number | undefined;
        if (kind === "video") {
          const meta = await probeVideo(url).catch(() => null);
          if (meta) { durationSec = meta.duration; width = meta.width; height = meta.height; }
        }
        const saved = await fetch("/api/media-library", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: f.name || "media", originalName: f.name || "media",
            mimeType: f.type || "application/octet-stream", size: f.size || 0, url,
            duration: durationSec ? Math.round(durationSec) : undefined, width, height,
          }),
        }).then((r) => r.json());
        setMedia((prev) => [...prev, { id: saved.id, url, kind, durationSec, name: f.name || "média" }]);
      }
    } catch {
      toast({ title: "Erreur à l'enregistrement du média", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      const targets = Object.entries(selected).map(([accId, format]) => {
        const acc = accounts.find((a) => a.id === Number(accId))!;
        return { basePlatform: acc.basePlatform, socialAccountId: acc.id, format, caption: legendeDe(acc.id) };
      });
      const sec = couvertureSec.trim() === "" ? null : Number(couvertureSec);
      const collab = lireCollaborateurs(collaborateurs.split(/[\s,;]+/));
      if (collab === undefined) throw new Error(t("atelier.collaborateursInvalides"));
      const res = await fetch("/api/content/cross-post", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets, caption, mediaIds: media.map((m) => m.id),
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          autoPost, projectId: projectId || null,
          premierCommentaire: premierCommentaire.trim() || null,
          couvertureOffsetMs: sec != null && Number.isFinite(sec) && sec >= 0 ? Math.round(sec * 1000) : null,
          options: {
            texteAlternatif: texteAlternatif.trim() || null, collaborateurs: collab,
            reelDansLeFil: reelDansLeFil === "defaut" ? null : reelDansLeFil === "oui",
            nomAudio: nomAudio.trim() || null, linkedinDocument,
          },
        }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.texte || e?.message || "cross_post_failed"); }
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/content"] });
      toast({ title: `Programmé sur ${data.count} réseau(x) ✅` });
      setSelected({}); setCaption(""); setMedia([]); setScheduledFor("");
      setLegendes({}); setAdapter(false); setPremierCommentaire(""); setCouvertureSec("");
      setTexteAlternatif(""); setCollaborateurs(""); setReelDansLeFil("defaut"); setNomAudio(""); setLinkedinDocument(false);
      onClose();
    },
    onError: (e: any) => toast({ title: "Échec", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Composer une publication</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Réseaux */}
          <div>
            <p className="text-xs text-naya-olive-35 mb-2 font-mono">Réseaux</p>
            {accounts.length === 0 ? (
              <p className="text-sm text-naya-olive-35">Aucun compte connecté — connecte tes réseaux dans Réglages.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {accounts.map((acc) => {
                  const on = !!selected[acc.id];
                  return (
                    <button key={acc.id} onClick={() => toggleAccount(acc)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${on ? "bg-naya-olive text-naya-cream border-naya-olive" : "bg-white text-naya-olive border-naya-olive-18 hover:bg-naya-olive-06"}`}>
                      {PLATFORM_LABEL[acc.basePlatform] || acc.basePlatform}
                      {acc.isPage ? " (page)" : ""} · {acc.accountName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Médias */}
          <div>
            <p className="text-xs text-naya-olive-35 mb-2 font-mono">Médias (image / vidéo)</p>
            <div className="flex flex-wrap gap-2 items-center">
              {media.map((m) => (
                <div key={m.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-naya-olive-18 bg-naya-olive-06 flex items-center justify-center">
                  {m.kind === "image"
                    ? <img src={m.url} alt={m.name} className="w-full h-full object-cover" />
                    : <Video className="w-6 h-6 text-naya-olive-35" />}
                  <button onClick={() => setMedia((p) => p.filter((x) => x.id !== m.id))}
                    className="absolute top-0.5 right-0.5 bg-black/60 rounded-full p-0.5"><X className="w-3 h-3 text-white" /></button>
                  {m.kind === "video" && m.durationSec != null && (
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-black/60 text-white px-1 rounded">{Math.round(m.durationSec)}s</span>
                  )}
                </div>
              ))}
              <ObjectUploader maxNumberOfFiles={10} onGetUploadParameters={async (file) => {
                const r = await fetch("/api/media/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name || "media", contentType: file.type || "application/octet-stream" }) });
                if (!r.ok) throw new Error("upload_url_failed");
                const d = await r.json();
                return { method: "PUT" as const, url: d.uploadUrl, publicUrl: d.publicUrl };
              }} onComplete={handleUpload} buttonClassName="!bg-naya-olive-06 !text-naya-olive hover:!bg-naya-olive-10">
                <span className="flex items-center gap-1.5 text-xs"><Upload className="w-3.5 h-3.5" />{uploading ? "…" : "Ajouter"}</span>
              </ObjectUploader>
            </div>
          </div>

          {/* Format par réseau sélectionné */}
          {validations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-naya-olive-35 font-mono">Format par réseau</p>
              {validations.map((v) => (
                <div key={v.acc.id} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 truncate">{PLATFORM_LABEL[v.acc.basePlatform]}{v.acc.isPage ? " (page)" : ""}</span>
                  <select value={v.format} onChange={(e) => setSelected((p) => ({ ...p, [v.acc.id]: e.target.value as PostFormat }))}
                    className="border border-naya-olive-18 rounded-md px-2 py-1 text-xs bg-white">
                    {formatsFor(v.acc.basePlatform as Platform).map((f) => <option key={f.format} value={f.format}>{f.label}</option>)}
                  </select>
                  {!v.ok && <span className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{v.errors[0]}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Aperçu réaliste par format */}
          {validations.length > 0 && media.length > 0 && (() => {
            const primary = validations[0];
            const fmt = primary.format;
            const tall = fmt === "story" || fmt === "reel" || fmt === "short";
            const m0 = media[0];
            return (
              <div>
                <p className="text-xs text-naya-olive-35 mb-2 font-mono">
                  Aperçu — {PLATFORM_LABEL[primary.acc.basePlatform]} · {fmt}
                </p>
                <div className="mx-auto bg-black rounded-2xl overflow-hidden relative" style={{ width: tall ? 200 : 264, aspectRatio: tall ? "9 / 16" : "1 / 1" }}>
                  {m0.kind === "image"
                    ? <img src={m0.url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><Video className="w-10 h-10 text-white/70" /></div>}
                  {media.length > 1 && (
                    <span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">1/{media.length}</span>
                  )}
                  {tall && caption ? (
                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
                      <p className="text-white text-[11px] leading-snug" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{caption}</p>
                    </div>
                  ) : null}
                </div>
                {!tall && caption ? (
                  <p className="text-[12px] text-naya-olive-70 mt-2 mx-auto whitespace-pre-wrap" style={{ maxWidth: 264, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{caption}</p>
                ) : null}
              </div>
            );
          })()}

          {/* Légende */}
          <div>
            <p className="text-xs text-naya-olive-35 mb-2 font-mono">Légende</p>
            <Textarea ref={zoneLegende} value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} placeholder="Écris ta légende…" />
            <TextesEnregistres zone={zoneLegende} valeur={caption} onChange={setCaption} projectId={projectId} testId="textes-legende" />
            {validations.length > 1 && (
              <label className="mt-2 flex items-center gap-2 text-xs text-naya-olive-70">
                <Switch checked={adapter} onCheckedChange={setAdapter} /> {t("composer.adapterParReseau")}
              </label>
            )}
            {adapter && validations.map(({ acc }) => (
              <div key={acc.id} className="mt-2">
                <p className="text-[11px] text-naya-olive-55 mb-1">{t("composer.legendePour", { reseau: acc.accountName || acc.basePlatform })}</p>
                <Textarea rows={3} value={legendes[acc.id] ?? ""} placeholder={t("composer.legendeCommune")}
                  onChange={(e) => setLegendes((l) => ({ ...l, [acc.id]: e.target.value }))} />
              </div>
            ))}
          </div>

          {/* Premier commentaire (Instagram, LinkedIn, Facebook) et couverture d'un Reel */}
          {validations.some(({ acc }) => ["instagram", "linkedin", "facebook"].includes(acc.basePlatform)) && (
            <div>
              <p className="text-xs text-naya-olive-35 mb-2 font-mono">{t("atelier.premierCommentaire")}</p>
              <Textarea ref={zoneCommentaire} rows={2} maxLength={2200} value={premierCommentaire} onChange={(e) => setPremierCommentaire(e.target.value)}
                placeholder={t("atelier.premierCommentaireAide")} />
              <TextesEnregistres zone={zoneCommentaire} valeur={premierCommentaire} onChange={(v) => setPremierCommentaire(v.slice(0, 2200))} projectId={projectId} testId="textes-commentaire" />
            </div>
          )}
          {validations.some(({ acc, format }) => acc.basePlatform === "instagram" && (format === "reel" || format === "feed_video")) && media.some((m) => m.kind === "video") && (
            <div className="flex items-center gap-2">
              <p className="text-xs text-naya-olive-35 font-mono">{t("atelier.couverture")}</p>
              <input type="number" min={0} step={0.5} value={couvertureSec} onChange={(e) => setCouvertureSec(e.target.value)}
                className="w-20 border border-naya-olive-18 rounded-md px-2 py-1 text-sm" />
              <span className="text-[11px] text-naya-olive-55">{t("atelier.couvertureAide")}</span>
            </div>
          )}

          {/* Options Instagram : texte alternatif, collaborateurs (pas en story), Reel */}
          {validations.some(({ acc, format }) => acc.basePlatform === "instagram" && format !== "story") && (
            <div className="space-y-2">
              {media.some((m) => m.kind === "image") && (
                <div>
                  <p className="text-xs text-naya-olive-35 mb-1 font-mono">{t("atelier.texteAlternatif")}</p>
                  <Textarea rows={2} maxLength={ALT_TEXTE_MAX} value={texteAlternatif} onChange={(e) => setTexteAlternatif(e.target.value)}
                    placeholder={t("atelier.texteAlternatifAide")} />
                </div>
              )}
              <div>
                <p className="text-xs text-naya-olive-35 mb-1 font-mono">{t("atelier.collaborateurs")}</p>
                <input value={collaborateurs} onChange={(e) => setCollaborateurs(e.target.value)} placeholder={t("atelier.collaborateursAide")}
                  className="w-full border border-naya-olive-18 rounded-md px-2 py-1 text-sm" />
              </div>
            </div>
          )}
          {validations.some(({ acc, format }) => acc.basePlatform === "instagram" && (format === "reel" || format === "feed_video")) && media.some((m) => m.kind === "video") && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-naya-olive-35 font-mono">
                {t("atelier.reelDansLeFil")}
                <select value={reelDansLeFil} onChange={(e) => setReelDansLeFil(e.target.value as "defaut" | "oui" | "non")}
                  className="border border-naya-olive-18 rounded-md px-2 py-1 text-sm font-sans">
                  <option value="defaut">{t("atelier.reelDansLeFilDefaut")}</option>
                  <option value="oui">{t("atelier.reelDansLeFilOui")}</option>
                  <option value="non">{t("atelier.reelDansLeFilNon")}</option>
                </select>
              </label>
              <input value={nomAudio} maxLength={NOM_AUDIO_MAX} onChange={(e) => setNomAudio(e.target.value)}
                placeholder={t("atelier.nomAudio")} title={t("atelier.nomAudioAide")}
                className="flex-1 min-w-[10rem] border border-naya-olive-18 rounded-md px-2 py-1 text-sm" />
            </div>
          )}
          {/* LinkedIn : carrousel publié en document PDF */}
          {validations.some(({ acc, format }) => acc.basePlatform === "linkedin" && format === "carousel") && !media.some((m) => m.kind === "video") && (
            <div>
              <label className="flex items-center gap-2 text-xs text-naya-olive-70">
                <Switch checked={linkedinDocument} onCheckedChange={setLinkedinDocument} /> {t("atelier.linkedinDocument")}
              </label>
              <p className="text-[11px] text-naya-olive-55 mt-1">{t("atelier.linkedinDocumentAide")}</p>
            </div>
          )}

          {/* Programmation */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs text-naya-olive-35 mb-1 font-mono">Date / heure</p>
              <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)}
                className="border border-naya-olive-18 rounded-md px-2 py-1 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-sm mt-4">
              <Switch checked={autoPost} onCheckedChange={setAutoPost} /> Publication automatique
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button disabled={!allValid || submit.isPending || uploading} onClick={() => submit.mutate()}>
              {submit.isPending ? "…" : scheduledFor ? "Programmer" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
