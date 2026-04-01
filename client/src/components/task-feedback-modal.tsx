import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";

interface Task {
  id: number;
  title: string;
}

interface TaskFeedbackModalProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (feedbackType: string, reason: string, freeText?: string) => void;
  isPending?: boolean;
}

export default function TaskFeedbackModal({ task, open, onClose, onConfirm, isPending }: TaskFeedbackModalProps) {
  const { t } = useTranslation();
  const [feedbackType, setFeedbackType] = useState("deleted");
  const [reason, setReason] = useState("");
  const [freeText, setFreeText] = useState("");

  const FEEDBACK_TYPES = [
    { id: "deleted", label: t('taskFeedback.removePermanently') },
    { id: "dismissed", label: t('taskFeedback.dismissForNow') },
    { id: "deferred", label: t('taskFeedback.deferToLater') },
  ];

  const REASONS = [
    { id: "not_useful", label: t('taskFeedback.notUseful') },
    { id: "wrong_timing", label: t('taskFeedback.wrongTiming') },
    { id: "already_done", label: t('taskFeedback.alreadyDone') },
    { id: "not_aligned", label: t('taskFeedback.notAligned') },
    { id: "too_vague", label: t('taskFeedback.tooVague') },
    { id: "wrong_approach", label: t('taskFeedback.wrongApproach') },
    { id: "other", label: t('taskFeedback.other') },
  ];

  function handleConfirm() {
    if (!reason) return;
    onConfirm(feedbackType, reason, freeText || undefined);
    setFeedbackType("deleted");
    setReason("");
    setFreeText("");
  }

  function handleClose() {
    setFeedbackType("deleted");
    setReason("");
    setFreeText("");
    onClose();
  }

  const confirmLabel = feedbackType === "deleted" ? t('taskFeedback.removeTask') : feedbackType === "deferred" ? t('taskFeedback.deferTask') : t('taskFeedback.dismissForNow');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t('taskFeedback.title')}</DialogTitle>
          {task && (
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-1 line-clamp-2">
              "{task.title}"
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div>
            <p className="text-xs text-slate-600 dark:text-gray-400 mb-2">{t('taskFeedback.action')}</p>
            <div className="flex gap-1.5 flex-wrap">
              {FEEDBACK_TYPES.map(ft => (
                <button
                  key={ft.id}
                  onClick={() => setFeedbackType(ft.id)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-all border ${
                    feedbackType === ft.id
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-gray-900 dark:border-white'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600'
                  }`}
                >
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-600 dark:text-gray-400 mb-2">{t('taskFeedback.reason')}</p>
            <div className="flex gap-1.5 flex-wrap">
              {REASONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setReason(r.id)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-all border ${
                    reason === r.id
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-gray-900 dark:border-white'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-600 dark:text-gray-400 mb-1.5">{t('taskFeedback.tellUsMore')}</p>
            <Textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder={t('taskFeedback.tellUsMorePlaceholder')}
              rows={2}
              className="text-sm resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={handleClose} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={!reason || isPending}
              className="flex-1"
            >
              {isPending ? t('common.loading') : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
