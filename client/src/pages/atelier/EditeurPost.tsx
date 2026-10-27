// Atelier de contenu — un post à la fois : l'idée, le texte (modifiable sur place, enregistré
// au fil de la frappe), « Refaire » avec une consigne courte, les visuels, le format, la date,
// et « Valider » (⌘/Ctrl + Entrée). Ce qui empêche de valider est dit en clair.
// En haut, une barre : Modifier, Note à Naya (elle réécrit, remplace ou retire le post), Supprimer.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, ImagePlus, Loader2, MessageSquareText, PenLine, RotateCcw, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { televerser } from "@/lib/livrables-api";
import { genreDuPost, manquesPourValider } from "@shared/atelier";
import type { MotifNote, PostAtelier } from "./api";
import { devalider, enregistrer, joindreVisuel, noterPost, refaire, retirerVisuel, supprimerPost, valider } from "./api";

const FORMATS = ["feed_image", "text", "carousel", "reel", "story"] as const;
const RETOUCHES = ["court", "percutant", "personnel", "angle"] as const;
const MOTIFS: MotifNote[] = ["deja_programme", "plus_actuel"];
const LIMITES: Record<string, number> = { linkedin: 3000, instagram: 2200, facebook: 5000 };

/** « 2026-10-22T07:00:00.000Z » → valeur d'un champ datetime-local, à l'heure de l'appareil. */
function versChampLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function EditeurPost({ post, enRedaction, onChange, onValide, onRetire }: {
  post: PostAtelier;
  enRedaction: boolean;
  /** Le serveur a changé quelque chose : relire la semaine. */
  onChange: () => void;
  /** Le post vient d'être validé : passer au suivant. */
  onValide: () => void;
  /** Le post a quitté l'atelier (supprimé, ou remplacé par `remplacant`). */
  onRetire: (remplacant: number | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [texte, setTexte] = useState(post.body ?? "");
  const [format, setFormat] = useState(post.postFormat ?? "feed_image");
  const [date, setDate] = useState(post.scheduledFor);
  const [retouche, setRetouche] = useState("");
  const [enregistre, setEnregistre] = useState<"rien" | "encours" | "ok" | "erreur">("rien");
  const [occupe, setOccupe] = useState<null | "valider" | "refaire" | "visuel" | "devalider" | "note" | "supprimer">(null);
  const [panneau, setPanneau] = useState<null | "note" | "supprimer">(null);
  const [motif, setMotif] = useState<MotifNote | null>(null);
  const [note, setNote] = useState("");
  const zoneTexte = useRef<HTMLTextAreaElement>(null);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aEnvoyer = useRef<string | null>(null);
  const fichiers = useRef<HTMLInputElement>(null);
  const modifiable = post.etat === "a_rediger" || post.etat === "brouillon";

  // Le texte arrive du serveur (rédaction de Naya, « Refaire ») : on le reprend s'il n'y a rien en attente.
  useEffect(() => { if (aEnvoyer.current === null) setTexte(post.body ?? ""); }, [post.body]);
  useEffect(() => { setFormat(post.postFormat ?? "feed_image"); }, [post.postFormat]);
  useEffect(() => { setDate(post.scheduledFor); }, [post.scheduledFor]);

  const vider = useCallback(async () => {
    if (minuterie.current) { clearTimeout(minuterie.current); minuterie.current = null; }
    const body = aEnvoyer.current;
    if (body === null) return;
    aEnvoyer.current = null;
    setEnregistre("encours");
    try { await enregistrer(post.id, { body }); setEnregistre("ok"); }
    catch { setEnregistre("erreur"); aEnvoyer.current = body; }
  }, [post.id]);

  // Enregistrement après une pause de frappe ; et à la sortie de l'écran.
  const taper = (v: string) => {
    setTexte(v);
    aEnvoyer.current = v;
    setEnregistre("rien");
    if (minuterie.current) clearTimeout(minuterie.current);
    minuterie.current = setTimeout(() => { void vider(); }, 800);
  };
  useEffect(() => () => { void vider(); }, [vider]);

  const erreur = (e: any) => toast({ title: t(`atelier.erreurs.${e?.message}`, { defaultValue: t("atelier.erreurs.inconnue") }), variant: "destructive" });

  const changerFormat = async (f: string) => {
    setFormat(f);
    try { await enregistrer(post.id, { postFormat: f }); onChange(); } catch (e) { erreur(e); }
  };
  const changerDate = async (v: string) => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return;
    setDate(d.toISOString());
    try { await enregistrer(post.id, { scheduledFor: d.toISOString() }); onChange(); } catch (e) { erreur(e); }
  };

  const genresMedias = post.medias.map((m) => m.genre);
  const manques = modifiable
    ? manquesPourValider({ genre: genreDuPost({ postFormat: format }), body: texte, scheduledFor: date, medias: genresMedias, maintenant: new Date() })
    : [];

  const lancerValidation = useCallback(async () => {
    // Jamais pendant que Naya rédige (le texte affiché est encore la consigne), ni s'il manque quelque chose.
    if (!modifiable || occupe || enRedaction || manques.length > 0) return;
    setOccupe("valider");
    try {
      await vider();
      const r = await valider(post.id, { body: texte });
      if (r.statut === "manques") {
        toast({ title: t("atelier.manquesTitre"), description: r.manques.map((m) => t(`atelier.manques.${m}`)).join(" "), variant: "destructive" });
        return;
      }
      const quand = new Date(date).toLocaleString(i18n.language, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      toast({ title: r.statut === "programme" ? t("atelier.programmeToast", { quand }) : t("atelier.aPublierToast", { quand }) });
      onChange();
      onValide();
    } catch (e) { erreur(e); }
    finally { setOccupe(null); }
  }, [modifiable, occupe, enRedaction, manques.length, vider, post.id, texte, date, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘/Ctrl + Entrée : valider, où que soit le curseur.
  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void lancerValidation(); }
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [lancerValidation]);

  const lancerRefaire = async (consigne: string) => {
    setOccupe("refaire");
    try {
      await vider();
      const body = await refaire(post.id, consigne);
      setTexte(body);
      setRetouche("");
      onChange();
    } catch (e) { erreur(e); }
    finally { setOccupe(null); }
  };

  const ajouterVisuels = async (liste: FileList | null) => {
    if (!liste?.length) return;
    setOccupe("visuel");
    try {
      for (const f of Array.from(liste)) {
        const { url } = await televerser("media", f);
        await joindreVisuel(post.id, { url, name: f.name, type: f.type, size: f.size });
      }
      onChange();
    } catch (e) { erreur(e); }
    finally { setOccupe(null); }
  };
  const retirer = async (mediaId: number) => {
    try { await retirerVisuel(post.id, mediaId); onChange(); } catch (e) { erreur(e); }
  };
  const annulerValidation = async () => {
    setOccupe("devalider");
    try { await devalider(post.id); onChange(); } catch (e) { erreur(e); }
    finally { setOccupe(null); }
  };

  // « Modifier » : un post validé redevient brouillon ; le curseur va dans le texte.
  const modifier = async () => {
    setPanneau(null);
    if (post.etat === "valide") await annulerValidation();
    setTimeout(() => { zoneTexte.current?.focus(); zoneTexte.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, 50);
  };

  const envoyerNote = async () => {
    if (occupe || (!motif && !note.trim())) return;
    setOccupe("note");
    try {
      await vider();
      const r = await noterPost(post.id, { motif, note: note.trim() });
      setPanneau(null); setMotif(null); setNote("");
      if (r.statut === "reecrit") {
        setTexte(r.body);
        toast({ title: t("atelier.actions.reecrit") });
        onChange();
      } else if (r.statut === "remplace") {
        toast({ title: t("atelier.actions.remplace", { titre: r.remplacement.title }) });
        onRetire(r.remplacement.id);
      } else {
        toast({ title: t(r.remplacementEchoue ? "atelier.actions.remplacementEchoue" : "atelier.actions.supprime") });
        onRetire(null);
      }
    } catch (e) { erreur(e); }
    finally { setOccupe(null); }
  };

  const confirmerSuppression = async () => {
    setOccupe("supprimer");
    try {
      await supprimerPost(post.id);
      toast({ title: t("atelier.actions.supprime") });
      onRetire(null);
    } catch (e) { erreur(e); setOccupe(null); }
  };

  const limite = LIMITES[(post.platform || "").toLowerCase()];
  const quandPublie = new Date(date).toLocaleString(i18n.language, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5" aria-labelledby={`post-${post.id}`}>
      <header className="space-y-1">
        <div className="flex items-start gap-2">
          <p className="text-xs text-muted-foreground capitalize pt-1.5 min-w-0">
            {post.projet
              ? t("atelier.enTeteProjet", { quand: quandPublie, reseau: post.platform, projet: post.projet })
              : t("atelier.enTete", { quand: quandPublie, reseau: post.platform })}
          </p>
          {post.etat !== "publie" && (
            <div role="toolbar" aria-label={t("atelier.actions.barre")} className="ml-auto flex flex-shrink-0 items-center gap-0.5 -mr-2 -mt-0.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={occupe !== null || enRedaction} onClick={() => { void modifier(); }} aria-label={t("atelier.actions.modifier")}>
                <PenLine className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">{t("atelier.actions.modifier")}</span>
              </Button>
              <Button size="sm" variant={panneau === "note" ? "secondary" : "ghost"} className="h-7 px-2 text-xs" disabled={occupe !== null || enRedaction}
                aria-expanded={panneau === "note"} onClick={() => setPanneau(panneau === "note" ? null : "note")} aria-label={t("atelier.actions.note")}>
                <MessageSquareText className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">{t("atelier.actions.note")}</span>
              </Button>
              <Button size="sm" variant={panneau === "supprimer" ? "secondary" : "ghost"} className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" disabled={occupe !== null || enRedaction}
                aria-expanded={panneau === "supprimer"} onClick={() => setPanneau(panneau === "supprimer" ? null : "supprimer")} aria-label={t("atelier.actions.supprimer")}>
                <Trash2 className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">{t("atelier.actions.supprimer")}</span>
              </Button>
            </div>
          )}
        </div>
        <h2 id={`post-${post.id}`} className="text-lg font-semibold text-foreground">{post.title}</h2>
        {(post.consigne || post.etat === "a_rediger") && (
          <p className="text-xs text-muted-foreground whitespace-pre-line max-h-48 overflow-y-auto">
            <span className="font-medium">{t("atelier.idee")}</span> {post.consigne ?? post.body}
          </p>
        )}
      </header>

      {panneau === "note" && (
        <form className="space-y-2.5 rounded-lg border border-border bg-muted/40 p-3" aria-busy={occupe === "note"}
          onSubmit={(e) => { e.preventDefault(); void envoyerNote(); }}>
          <div>
            <p className="text-sm font-medium text-foreground">{t("atelier.actions.noteTitre")}</p>
            <p className="text-xs text-muted-foreground">{t("atelier.actions.noteAide")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {MOTIFS.map((m) => (
              <Button key={m} type="button" size="sm" variant={motif === m ? "default" : "outline"} className="h-7 text-xs" aria-pressed={motif === m}
                disabled={occupe !== null} onClick={() => setMotif(motif === m ? null : m)}>
                {t(`atelier.actions.motifs.${m}`)}
              </Button>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} disabled={occupe !== null}
            placeholder={t("atelier.actions.notePlaceholder")} aria-label={t("atelier.actions.noteTitre")} className="text-sm bg-card"
            // ⌘/Ctrl + Entrée envoie la note (et ne valide pas le post).
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); void envoyerNote(); } }} />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={occupe !== null || (!motif && !note.trim())}>
              {occupe === "note" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
              {occupe === "note" ? t("atelier.actions.nayaLit") : t("atelier.actions.envoyer")}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={occupe !== null} onClick={() => setPanneau(null)}>{t("atelier.actions.annuler")}</Button>
          </div>
        </form>
      )}

      {panneau === "supprimer" && (
        <div className="space-y-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("atelier.actions.supprimerTitre")}</p>
            <p className="text-xs text-muted-foreground">{t("atelier.actions.supprimerAide")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="destructive" disabled={occupe !== null} onClick={() => { void confirmerSuppression(); }}>
              {occupe === "supprimer" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
              {t("atelier.actions.supprimerConfirmer")}
            </Button>
            <Button size="sm" variant="ghost" disabled={occupe !== null} onClick={() => setPanneau("note")}>
              <MessageSquareText className="w-3.5 h-3.5 mr-1.5" />{t("atelier.actions.note")}
            </Button>
            <Button size="sm" variant="ghost" disabled={occupe !== null} onClick={() => setPanneau(null)}>{t("atelier.actions.annuler")}</Button>
          </div>
        </div>
      )}

      {post.etat === "valide" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-naya-olive-06 border border-naya-olive-18 px-3 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-naya-salvia" />
          <p className="text-sm text-foreground flex-1">
            {post.programme ? t("atelier.valideProgramme", { quand: quandPublie }) : t("atelier.valideAPublier", { quand: quandPublie })}
          </p>
          <Button size="sm" variant="outline" disabled={occupe !== null} onClick={annulerValidation}>
            <Undo2 className="w-3.5 h-3.5 mr-1" />{t("atelier.modifier")}
          </Button>
        </div>
      )}
      {post.etat === "publie" && <p className="text-sm text-muted-foreground">{t("atelier.dejaPublie")}</p>}
      {post.erreurPublication && <p className="text-sm text-destructive">{t("atelier.erreurPublication", { erreur: post.erreurPublication })}</p>}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`texte-${post.id}`} className="text-sm font-medium">{t("atelier.texte")}</Label>
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {enregistre === "encours" ? t("atelier.enregistrement") : enregistre === "ok" ? t("atelier.enregistre") : enregistre === "erreur" ? t("atelier.nonEnregistre") : ""}
          </span>
        </div>
        {enRedaction ? (
          <div className="space-y-2 rounded-md border border-dashed border-border p-4" aria-busy="true">
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Sparkles className="w-4 h-4 animate-pulse motion-reduce:animate-none" />{t("atelier.nayaRedige")}</p>
            {/* Pendant la rédaction (10 à 30 s), l'idée du post reste lisible au lieu d'un écran vide. */}
            {(post.consigne || post.body)?.trim() ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{(post.consigne || post.body).trim()}</p>
            ) : (
              <><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></>
            )}
          </div>
        ) : (
          <Textarea
            ref={zoneTexte}
            id={`texte-${post.id}`}
            value={texte}
            onChange={(e) => taper(e.target.value)}
            onBlur={() => { void vider(); }}
            readOnly={!modifiable}
            rows={12}
            maxLength={5000}
            placeholder={t("atelier.textePlaceholder")}
            className="text-sm leading-relaxed resize-y"
          />
        )}
        {limite && !enRedaction && (
          <p className={`text-[11px] text-right ${texte.length > limite ? "text-destructive" : "text-muted-foreground"}`}>
            {t("atelier.caracteres", { n: texte.length, max: limite })}
          </p>
        )}
      </section>

      {modifiable && !enRedaction && (
        <section className="space-y-2">
          <p className="text-sm font-medium">{t("atelier.refaireTitre")}</p>
          <div className="flex flex-wrap gap-1.5">
            {RETOUCHES.map((r) => (
              <Button key={r} size="sm" variant="outline" className="h-7 text-xs" disabled={occupe !== null} onClick={() => lancerRefaire(t(`atelier.retouches.${r}`))}>
                {t(`atelier.retouches.${r}`)}
              </Button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void lancerRefaire(retouche); }}>
            <Input value={retouche} onChange={(e) => setRetouche(e.target.value)} maxLength={300} placeholder={t("atelier.retouchePlaceholder")} className="h-8 text-sm" aria-label={t("atelier.retouchePlaceholder")} />
            <Button type="submit" size="sm" variant="secondary" disabled={occupe !== null}>
              {occupe === "refaire" ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
              {t("atelier.refaire")}
            </Button>
          </form>
        </section>
      )}

      <section className="space-y-2">
        <p className="text-sm font-medium">{t("atelier.visuels")}</p>
        <div
          className="flex flex-wrap gap-2"
          onDragOver={(e) => { if (modifiable) e.preventDefault(); }}
          onDrop={(e) => { if (!modifiable) return; e.preventDefault(); void ajouterVisuels(e.dataTransfer.files); }}
        >
          {post.medias.map((m) => (
            <div key={m.id} className="relative h-24 w-24 overflow-hidden rounded-md border border-border bg-muted">
              {m.genre === "video"
                ? <video src={m.url} className="h-full w-full object-cover" muted />
                : <img src={m.url} alt="" className="h-full w-full object-cover" />}
              {modifiable && (
                <button type="button" onClick={() => retirer(m.id)} aria-label={t("atelier.retirerVisuel")}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
          {modifiable && (
            <button type="button" onClick={() => fichiers.current?.click()} disabled={occupe !== null}
              className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {occupe === "visuel" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {t("atelier.ajouterVisuel")}
            </button>
          )}
          <input ref={fichiers} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void ajouterVisuels(e.target.files); e.target.value = ""; }} />
        </div>
        {modifiable && <p className="text-[11px] text-muted-foreground">{t("atelier.visuelsAide")}</p>}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("atelier.format")}</Label>
          <Select value={format} onValueChange={changerFormat} disabled={!modifiable}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORMATS.map((f) => <SelectItem key={f} value={f}>{t(`atelier.formats.${f}`)}</SelectItem>)}
              {!FORMATS.includes(format as any) && <SelectItem value={format}>{t(`atelier.formats.${format}`, { defaultValue: format })}</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`date-${post.id}`} className="text-xs">{t("atelier.date")}</Label>
          <Input id={`date-${post.id}`} type="datetime-local" className="h-8 text-sm" disabled={!modifiable}
            key={date} defaultValue={versChampLocal(date)} onBlur={(e) => { if (e.target.value !== versChampLocal(date)) void changerDate(e.target.value); }} />
        </div>
      </section>

      {modifiable && (
        <footer className="space-y-2 border-t border-border pt-4">
          {manques.length > 0 && !enRedaction && (
            <ul className="text-xs text-naya-mauve space-y-0.5">
              {manques.map((m) => <li key={m}>{t(`atelier.manques.${m}`)}</li>)}
            </ul>
          )}
          {!post.compteConnecte && <p className="text-[11px] text-muted-foreground">{t("atelier.sansCompte", { reseau: post.platform })}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={() => { void lancerValidation(); }} disabled={occupe !== null || enRedaction || manques.length > 0}>
              {occupe === "valider" ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              {t("atelier.valider")}
            </Button>
            <span className="text-[11px] text-muted-foreground">{t("atelier.raccourciValider")}</span>
          </div>
        </footer>
      )}
    </article>
  );
}
