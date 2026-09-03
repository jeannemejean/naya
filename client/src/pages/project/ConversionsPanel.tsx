// Fil 3 / LOT 3B — écran de déclaration d'une conversion et de sa restitution.
//
// Doctrine (héritée de la restitution Réception de LOT 3A, voir content-calendar.tsx) :
// - La restitution est TOUJOURS en fractions de fenêtre (§5.3 du brief) — jamais
//   « ce post a converti X ». Voir conversion-credit.ts pour la mise en forme.
// - Une conversion créditée à personne est un état NORMAL et explicite, pas une erreur ni un
//   vide silencieux : « aucun contenu publié dans la fenêtre ».
// - Aucun classement, aucun scoreboard, aucune comparaison entre contenus ou entre marques —
//   les lignes créditées sont ordonnées par id de contenu, jamais par poids.
// - La fenêtre utilisée est celle FIGÉE au moment de la conversion (attributionWindowDays sur
//   la ligne, jamais relue sur le projet) : on le dit à l'écran pour que le chiffre reste
//   digne de confiance même après un changement de réglage.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns/format";
// Icône NEUTRE volontairement : cette section n'est pas un tableau de bord de performance
// (pas de classement, pas de comparaison). Une flèche de croissance (TrendingUp) y suggérait
// une progression, y compris dans le cas « aucun contenu crédité » où elle est absurde.
import { Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useConversions, useDeclareConversion, type ConversionWithCredits } from "./useProjectPage";
import { buildConversionCreditRows } from "./conversion-credit";

interface ConversionsPanelProps {
  projectId: number;
}

function todayDateOnly(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function emptyForm() {
  return { convertedAt: todayDateOnly(), conversionType: "", value: "" };
}

export default function ConversionsPanel({ projectId }: ConversionsPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const conversions = useConversions(projectId);
  // Le TITRE des contenus crédités arrive DÉJÀ résolu par le serveur (`contentTitle` sur
  // chaque crédit). Cet écran lisait auparavant `/api/content?projectId=…` pour le retrouver,
  // mais cette route est plafonnée par le serveur aux 50 contenus les plus récents : tout
  // contenu crédité au-delà s'affichait « Contenu supprimé depuis » alors qu'il existait
  // toujours — un mensonge atteignable en usage ordinaire avec une fenêtre de 60 jours.
  const declareConversion = useDeclareConversion(projectId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const handleDeclare = () => {
    declareConversion.mutate(form, {
      onSuccess: () => {
        setOpen(false);
        setForm(emptyForm());
      },
      onError: () => {
        toast({ title: t("projects.conversions.saveFailed"), variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t("projects.conversions.title")}</h2>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setForm(emptyForm());
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              {t("projects.conversions.declareButton")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("projects.conversions.dialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-1">
              <div>
                <Label htmlFor="conversion-date">{t("projects.conversions.dateLabel")}</Label>
                <Input
                  id="conversion-date"
                  type="date"
                  value={form.convertedAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, convertedAt: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="conversion-type">{t("projects.conversions.typeLabel")}</Label>
                <Input
                  id="conversion-type"
                  placeholder={t("projects.conversions.typePlaceholder")}
                  value={form.conversionType}
                  onChange={(e) => setForm((prev) => ({ ...prev, conversionType: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="conversion-value">{t("projects.conversions.valueLabel")}</Label>
                <Input
                  id="conversion-value"
                  type="number"
                  step="any"
                  value={form.value}
                  onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                />
              </div>
              <div className="flex justify-end">
                <Button disabled={!form.convertedAt || declareConversion.isPending} onClick={handleDeclare}>
                  {declareConversion.isPending
                    ? t("projects.conversions.saving")
                    : t("projects.conversions.save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {conversions.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (conversions.data ?? []).length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-naya-olive-55">{t("projects.conversions.emptyList")}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {(conversions.data ?? []).map((conversion) => (
            <ConversionCard key={conversion.id} conversion={conversion} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConversionCard({ conversion }: { conversion: ConversionWithCredits }) {
  const { t } = useTranslation();
  const rows = buildConversionCreditRows(
    conversion.attributions,
    t("projects.conversions.unknownContent"),
  );
  const windowDays = conversion.attributionWindowDays ?? 30;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-foreground">
            {conversion.conversionType?.trim() || t("projects.conversions.typeFallback")}
          </p>
          <p className="text-xs text-naya-olive-55">
            {format(new Date(conversion.convertedAt), "dd/MM/yyyy")}
            {conversion.value !== null && conversion.value !== undefined && (
              <> · {t("projects.conversions.valueLine", { value: conversion.value })}</>
            )}
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-naya-olive-06 border border-naya-olive-18 p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-naya-olive-70">
          <Info className="w-3.5 h-3.5" />
          <p className="text-sm">{t("projects.conversions.resultTitle")}</p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-foreground">{t("projects.conversions.noCreditIntro")}</p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.contentId} className="text-sm text-foreground flex items-center justify-between gap-2">
                <span className="truncate" title={row.title}>
                  {row.title}
                </span>
                <span className="text-naya-olive-55 flex-shrink-0">
                  {t("projects.conversions.shareLine", { percent: row.sharePercent })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-naya-olive-55 pt-1">
          {t("projects.conversions.windowNote", { days: windowDays })}
        </p>
      </div>
    </Card>
  );
}
