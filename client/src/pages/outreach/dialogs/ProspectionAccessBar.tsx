// Barre d'accès prospection (sobre) — extraite de l'ancien outreach.tsx:540-575 (inchangée).
import { prospectionWidgetModel, type ProspectionStatusDTO } from '@/lib/prospection-widget';

export default function ProspectionAccessBar({ status }: { status?: ProspectionStatusDTO }) {
  const m = prospectionWidgetModel(status);
  if (m.mode === 'hidden') return null;

  if (m.mode === 'upsell') {
    return (
      <div className="border-b border-border bg-naya-olive-06 px-6 py-2.5 flex items-center justify-between gap-4 flex-shrink-0">
        <p className="text-sm text-muted-foreground">
          Passe à l'option <span className="font-medium text-foreground">Enrichissement (+15€/mois)</span> pour accéder à l'audit IA et aux messages personnalisés.
        </p>
        <a
          href="/settings"
          className="text-sm font-medium text-naya-olive whitespace-nowrap hover:underline"
        >
          Activer l'enrichissement →
        </a>
      </div>
    );
  }

  // mode enrichment : compteur discret + barre de progression
  return (
    <div className="border-b border-border bg-white px-6 py-2.5 flex items-center gap-4 flex-shrink-0">
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        <span className={`font-semibold ${m.atLimit ? 'text-mauve-text' : 'text-foreground'}`}>{m.used}/{m.limit}</span> prospects LinkedIn cette semaine
      </span>
      <div className="flex-1 max-w-xs h-1.5 rounded-full bg-naya-olive-10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${m.atLimit ? 'bg-naya-mauve' : 'bg-naya-olive'}`}
          style={{ width: `${m.percent}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">Réinitialisation lundi</span>
    </div>
  );
}
