// Onglet Séquence de la fiche prospect : le brief (ce qui justifie d'écrire, la preuve, les
// angles) puis chaque message de la séquence, avec son contrôle qualité. Une édition est
// souveraine (le texte part tel quel) ; écarter un message le fait réécrire et apprend à Naya
// ce qui ne va pas.
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@shared/schema";
import { channelMeta } from "./channels";
import { useCampaigns } from "./useOutreach";
import {
  RAISONS_ECART, useEcarterStepMessage, useEditStepMessage, useLeadStepMessages, usePatchBrief, useProofs,
  type BriefDTO, type StepMessageDTO,
} from "./useEcriture";

export default function MessagesProspect({ lead, fallback }: { lead: Lead; fallback?: ReactNode }) {
  const { t } = useTranslation();
  const { data: messages = [], isLoading } = useLeadStepMessages(lead.id);
  return (
    <div className="space-y-3">
      <BriefPanel lead={lead} />
      <h3 className="text-xs font-semibold text-foreground pt-1">{t("ecriture.messages.titre")}</h3>
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : messages.length === 0 ? (
        fallback ?? null
      ) : (
        messages.map((m) => <MessageCarte key={m.stepId} leadId={lead.id} m={m} />)
      )}
    </div>
  );
}

function BriefPanel({ lead }: { lead: Lead }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const brief = ((lead as any).prospectBrief ?? null) as BriefDTO | null;
  const { data: campaigns = [] } = useCampaigns();
  const projectId = campaigns.find((c: any) => c.id === (lead as any).prospectionCampaignId)?.projectId ?? null;
  const { data: preuves = [] } = useProofs(projectId);
  const valides = preuves.filter((p) => p.status === "validated");
  const patch = usePatchBrief(lead.id);
  const [edition, setEdition] = useState(false);
  const [draft, setDraft] = useState({ declencheur: "", raison: "", angles: "", preuveId: "none" });

  useEffect(() => {
    setDraft({
      declencheur: brief?.declencheur?.fait ?? "",
      raison: brief?.raison ?? "",
      angles: (brief?.angles ?? []).join("\n"),
      preuveId: brief?.preuveId != null ? String(brief.preuveId) : "none",
    });
  }, [lead.id, brief?.declencheur?.fait, brief?.raison, brief?.preuveId, (brief?.angles ?? []).join("|")]);

  const enregistrer = () => {
    patch.mutate({
      declencheur: draft.declencheur.trim() ? { fait: draft.declencheur.trim(), source: brief?.declencheur?.source ?? "note" } : null,
      raison: draft.raison,
      angles: draft.angles.split("\n").map((x) => x.trim()).filter(Boolean),
      preuveId: draft.preuveId === "none" ? null : Number(draft.preuveId),
    }, {
      onSuccess: () => { setEdition(false); toast({ title: t("ecriture.brief.enregistre") }); },
      onError: () => toast({ title: t("ecriture.brief.erreur"), variant: "destructive" }),
    });
  };

  const preuve = valides.find((p) => p.id === brief?.preuveId);

  return (
    <div className="rounded-lg border border-naya-olive-18 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">{t("ecriture.brief.titre")}</span>
        {!edition && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEdition(true)}>
            <Pencil className="w-3 h-3" />{t("ecriture.brief.modifier")}
          </Button>
        )}
      </div>

      {!edition ? (
        brief ? (
          <dl className="text-xs space-y-1.5">
            <Ligne label={t("ecriture.brief.declencheur")} valeur={brief.declencheur?.fait} />
            {!brief.declencheur && <p className="text-xs text-naya-mauve">{t("ecriture.brief.aucunDeclencheur")}</p>}
            <Ligne label={t("ecriture.brief.raison")} valeur={brief.raison} />
            <Ligne label={t("ecriture.brief.proposition")} valeur={brief.proposition?.contenu} />
            <Ligne label={t("ecriture.brief.preuve")} valeur={preuve?.clientLabel ?? t("ecriture.brief.aucunePreuve")} />
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{t("ecriture.brief.pasDeBrief")}</p>
        )
      ) : (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">{t("ecriture.brief.declencheur")}</Label>
            <Textarea rows={2} className="text-xs" value={draft.declencheur} onChange={(e) => setDraft({ ...draft, declencheur: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t("ecriture.brief.raison")}</Label>
            <Input className="h-8 text-xs" value={draft.raison} onChange={(e) => setDraft({ ...draft, raison: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">{t("ecriture.brief.preuve")}</Label>
            <Select value={draft.preuveId} onValueChange={(v) => setDraft({ ...draft, preuveId: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("ecriture.brief.aucunePreuve")}</SelectItem>
                {valides.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.clientLabel}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("ecriture.brief.angles")}</Label>
            <Textarea rows={4} className="text-xs" value={draft.angles} onChange={(e) => setDraft({ ...draft, angles: e.target.value })} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEdition(false)}>{t("common.cancel")}</Button>
            <Button size="sm" className="h-8 text-xs" disabled={patch.isPending} onClick={enregistrer}>
              {patch.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}{t("ecriture.brief.enregistrer")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Ligne({ label, valeur }: { label: string; valeur?: string | null }) {
  if (!valeur) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground/90">{valeur}</dd>
    </div>
  );
}

function MessageCarte({ leadId, m }: { leadId: number; m: StepMessageDTO }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const meta = channelMeta(m.channel);
  const Icon = meta.Icon;
  const editer = useEditStepMessage(leadId);
  const ecarter = useEcarterStepMessage(leadId);
  const [edition, setEdition] = useState(false);
  const [body, setBody] = useState(m.body ?? "");
  const [subject, setSubject] = useState(m.subject ?? "");
  const [raison, setRaison] = useState<string>("");
  useEffect(() => { setBody(m.body ?? ""); setSubject(m.subject ?? ""); }, [m.body, m.subject]);

  const aRevoir = m.qualite === "a_revoir" && !m.edited;
  const erreur = () => toast({ title: t("ecriture.messages.erreur"), variant: "destructive" });

  return (
    <div className="rounded-lg border border-naya-olive-18 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
          <Icon className="w-3 h-3" />{meta.label}
        </span>
        <span className="text-xs text-muted-foreground">{t(`ecriture.messages.roles.${m.role}`)}</span>
        {aRevoir && <Badge variant="mauve">{t("ecriture.messages.aRevoir")}</Badge>}
        {m.edited && <Badge variant="salvia">{t("ecriture.messages.edite")}</Badge>}
      </div>

      {m.defauts.length > 0 && (
        <div className="rounded-md bg-naya-mauve/5 border border-naya-mauve/30 p-2 space-y-1">
          <p className="text-[11px] font-semibold text-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />{aRevoir ? t("ecriture.messages.aRevoirAide") : t("ecriture.messages.avertissement")}
          </p>
          <ul className="text-[11px] text-foreground/80 list-disc pl-4">
            {m.defauts.map((d, i) => <li key={i}>{d.raison}</li>)}
          </ul>
        </div>
      )}

      {!m.body ? (
        <p className="text-xs text-muted-foreground">{t("ecriture.messages.pasEncore")}</p>
      ) : edition ? (
        <div className="space-y-2">
          {m.channel === "email" && (
            <Input className="h-8 text-xs" placeholder={t("ecriture.messages.objet")} value={subject} onChange={(e) => setSubject(e.target.value)} />
          )}
          <Textarea rows={6} className="text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEdition(false)}>{t("common.cancel")}</Button>
            <Button size="sm" className="h-8 text-xs" disabled={!body.trim() || editer.isPending}
              onClick={() => editer.mutate({ stepId: m.stepId, body, subject: m.channel === "email" ? subject : null }, {
                onSuccess: () => { setEdition(false); toast({ title: t("ecriture.messages.enregistre") }); },
                onError: erreur,
              })}>
              {t("ecriture.messages.enregistrer")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {m.channel === "email" && m.subject && <p className="text-sm font-semibold text-foreground">{m.subject}</p>}
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{m.body}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setEdition(true)}>
              <Pencil className="w-3 h-3" />{t("ecriture.messages.modifier")}
            </Button>
            <Select value={raison} onValueChange={setRaison}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder={t("ecriture.messages.raison")} /></SelectTrigger>
              <SelectContent>
                {RAISONS_ECART.map((r) => <SelectItem key={r} value={r}>{t(`ecriture.messages.raisons.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={!raison || ecarter.isPending}
              onClick={() => ecarter.mutate({ stepId: m.stepId, raison }, {
                onSuccess: () => { setRaison(""); toast({ title: t("ecriture.messages.ecarte") }); },
                onError: erreur,
              })}>
              <X className="w-3 h-3" />{t("ecriture.messages.ecarter")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
