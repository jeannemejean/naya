// Onglet Résultats — analytics de la campagne (Task 7, Plan 2). Consomme useAnalytics (GET
// /api/prospection/campaigns/:id/analytics, cf. StepAnalytics dans types.ts) : totaux globaux
// (sent/openRate/replyRate/bounceRate), détail par étape (byStep) et par canal (byChannel).
// Pas de lib de charts — barres simples (divs) remplies avec des tokens naya-*, largeur relative
// au max de leur propre section (byStep vs byChannel ne partagent pas la même échelle).
import { BarChart3 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalytics } from './useOutreach';
import { channelMeta, type ChannelId } from './channels';

interface ResultsTabProps {
  campaignId: number;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4 flex flex-col gap-1">
      <span className="text-2xl font-semibold text-foreground">{value}</span>
      <span className="text-xs text-naya-olive-55">{label}</span>
    </Card>
  );
}

// Barre horizontale — largeur proportionnelle à value/max (plancher à 4% dès que value > 0, pour
// qu'un petit total reste visible), remplie avec une classe naya-* fixe passée par l'appelant.
function MetricBar({
  label,
  value,
  max,
  fillClass,
}: {
  label: string;
  value: number;
  max: number;
  fillClass: string;
}) {
  const pct = value > 0 ? Math.max((value / max) * 100, 4) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 flex-shrink-0 text-[11px] text-naya-olive-55">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-naya-olive-06 overflow-hidden">
        <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 flex-shrink-0 text-right text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
      <div className="w-14 h-14 bg-naya-olive-10 rounded-lg flex items-center justify-center">
        <BarChart3 className="w-7 h-7 text-naya-mauve" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">
        Pas encore de données — lance la campagne et reviens ici.
      </p>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

// Les deux canaux affichés en "Par canal" — fixes (pas dérivés de byChannel) pour toujours montrer
// les deux cartes Email/LinkedIn, même si un canal n'a encore aucun envoi.
const CHANNEL_ROWS: ChannelId[] = ['email', 'linkedin'];

export default function ResultsTab({ campaignId }: ResultsTabProps) {
  const { data: analytics, isLoading } = useAnalytics(campaignId);

  if (isLoading) return <ResultsSkeleton />;
  if (!analytics || analytics.sent === 0) return <EmptyState />;

  const steps = [...analytics.byStep].sort((a, b) => a.stepOrder - b.stepOrder);
  const stepMax = Math.max(1, ...steps.flatMap((s) => [s.sent, s.opened, s.clicked, s.bounced]));

  const byChannelMap = new Map(analytics.byChannel.map((c) => [c.channel, c]));
  const channelMax = Math.max(1, ...CHANNEL_ROWS.map((c) => byChannelMap.get(c)?.sent ?? 0));

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* ── Totaux ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Envoyés" value={String(analytics.sent)} />
        <StatTile label="Ouvertures" value={`${analytics.openRate}%`} />
        <StatTile label="Réponses" value={`${analytics.replyRate}%`} />
        <StatTile label="Bounces" value={`${analytics.bounceRate}%`} />
      </div>

      {/* ── Par étape ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-naya-olive-55">Par étape</h3>
        {steps.length === 0 ? (
          <p className="text-sm text-naya-olive-55">Aucune étape enregistrée pour cette campagne.</p>
        ) : (
          <div className="space-y-2">
            {steps.map((step) => {
              const meta = channelMeta(step.channel);
              const Icon = meta.Icon;
              return (
                <Card key={step.stepOrder} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">Étape {step.stepOrder}</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${meta.chip}`}>
                      <Icon className="w-3 h-3" />
                      {meta.label}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <MetricBar label="Envoyés" value={step.sent} max={stepMax} fillClass={meta.dot} />
                    <MetricBar label="Ouverts" value={step.opened} max={stepMax} fillClass="bg-naya-sulphur" />
                    <MetricBar label="Cliqués" value={step.clicked} max={stepMax} fillClass="bg-naya-salvia" />
                    <MetricBar label="Bounces" value={step.bounced} max={stepMax} fillClass="bg-naya-mauve" />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Par canal ── */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-naya-olive-55">Par canal</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CHANNEL_ROWS.map((channelId) => {
            const meta = channelMeta(channelId);
            const Icon = meta.Icon;
            const row = byChannelMap.get(channelId);
            const sent = row?.sent ?? 0;
            const replied = row?.replied ?? 0;
            return (
              <Card key={channelId} className="p-4 flex flex-col gap-3">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs w-fit ${meta.chip}`}>
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </span>
                <div className="space-y-1.5">
                  <MetricBar label="Envoyés" value={sent} max={channelMax} fillClass={meta.dot} />
                  <MetricBar label="Réponses" value={replied} max={channelMax} fillClass="bg-naya-mauve" />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
