import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

interface RefusPostModalProps {
  post: { id: number; title: string } | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string, freeText: string | undefined, remplacer: boolean) => void;
  isPending?: boolean;
}

const REASON_IDS = ["wrong_tone", "wrong_angle", "not_for_brand", "too_many", "inaccurate", "other"] as const;

export default function RefusPostModal({ post, open, onClose, onConfirm, isPending }: RefusPostModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [freeText, setFreeText] = useState("");
  const [remplacer, setRemplacer] = useState(true);

  // Remise à zéro à la fermeture seulement : en cas d'échec, la saisie reste.
  useEffect(() => {
    if (!open) {
      setReason("");
      setFreeText("");
      setRemplacer(true);
    }
  }, [open]);

  function handleConfirm() {
    if (!reason) return;
    onConfirm(reason, freeText.trim() || undefined, remplacer);
  }

  const confirmLabel = remplacer ? t("refusPost.confirmReplace") : t("refusPost.confirm");
  const pendingLabel = remplacer ? t("refusPost.pending") : t("common.loading");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t("refusPost.title")}</DialogTitle>
          {post && <p className="text-xs text-naya-cream0 mt-1 line-clamp-2">{t("refusPost.quoted", { title: post.title })}</p>}
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="flex gap-1.5 flex-wrap">
            {REASON_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setReason(id)}
                className={`px-2.5 py-1 rounded-md text-xs transition-all border ${
                  reason === id
                    ? "bg-naya-olive text-white border-slate-900"
                    : "bg-white text-naya-olive-55 border-naya-olive-18 hover:border-naya-olive-18"
                }`}
              >
                {t(`refusPost.reasons.${id}`)}
              </button>
            ))}
          </div>

          <div>
            <p className="text-sm font-medium text-foreground mb-1.5">{t("refusPost.explainLabel")}</p>
            <Textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t("refusPost.explainPlaceholder")}
              rows={4}
              className="text-sm resize-none border-naya-olive-35"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={remplacer}
              onChange={(e) => setRemplacer(e.target.checked)}
            />
            {t("refusPost.replace")}
          </label>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={!reason || isPending} className="flex-1">
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
