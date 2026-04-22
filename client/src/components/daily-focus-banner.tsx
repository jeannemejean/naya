import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Target } from "lucide-react";

export default function DailyFocusBanner() {
  const { t } = useTranslation();
  const { data: brandDna } = useQuery<Record<string, any>>({
    queryKey: ["/api/brand-dna"],
    retry: false,
  });

  const getDayOfWeek = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getDay()];
  };

  const getDayLabel = () => {
    const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    return days[new Date().getDay()];
  };

  const getStrategicFocus = () => {
    if (!brandDna) return t('dailyFocus.strategicBusinessGrowth');
    const revenueUrgency = brandDna.revenueUrgency?.toLowerCase() || "";
    const businessType = brandDna.businessType?.toLowerCase() || "";
    const day = getDayOfWeek();
    if (revenueUrgency.includes("immediate") || revenueUrgency.includes("urgent")) return t('dailyFocus.revenueGeneration');
    if (day === "Monday") return t('dailyFocus.weekPlanning');
    if (day === "Friday") return t('dailyFocus.relationshipBuilding');
    if (businessType.includes("coach") || businessType.includes("consultant")) return t('dailyFocus.authorityBuilding');
    return t('dailyFocus.visibilityEngagement');
  };

  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--primary)',
        borderRadius: 'var(--radius)',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          background: 'rgba(139,127,168,0.12)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Target style={{ width: 15, height: 15, color: 'var(--primary)' }} />
      </div>
      <div>
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--foreground)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {getStrategicFocus()}
        </p>
        <p
          style={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.625rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 300,
            color: 'var(--muted-foreground)',
            marginTop: 3,
          }}
        >
          {getDayLabel()} · Focus stratégique
        </p>
      </div>
    </div>
  );
}
