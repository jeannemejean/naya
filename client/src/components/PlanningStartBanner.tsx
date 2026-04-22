import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { X, Calendar } from "lucide-react";
import { Link } from "wouter";

export default function PlanningStartBanner() {
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery<any>({
    queryKey: ['/api/preferences'],
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest('PATCH', '/api/preferences', { planningStartDate: null }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/preferences'] }),
  });

  const planningStartDate: string | null = prefs?.planningStartDate ?? null;
  const today = new Date().toISOString().slice(0, 10);

  if (!planningStartDate || planningStartDate <= today) return null;

  const dateLabel = new Date(planningStartDate + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div
      style={{
        marginBottom: 16,
        padding: '12px 16px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
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
          background: 'rgba(92,122,107,0.12)',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Calendar style={{ width: 15, height: 15, color: 'var(--accent)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--foreground)',
            margin: 0,
          }}
        >
          Planification en pause
        </p>
        <p
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '0.75rem',
            fontWeight: 400,
            color: 'var(--muted-foreground)',
            marginTop: 2,
          }}
        >
          Naya démarrera le <strong style={{ color: 'var(--foreground)', fontWeight: 500 }}>{dateLabel}</strong>
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Link
          href="/settings"
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '0.75rem',
            fontWeight: 400,
            color: 'var(--muted-foreground)',
            textDecoration: 'none',
          }}
          onMouseEnter={(e: any) => (e.currentTarget.style.color = 'var(--foreground)')}
          onMouseLeave={(e: any) => (e.currentTarget.style.color = 'var(--muted-foreground)')}
        >
          Modifier
        </Link>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--primary-foreground)',
            background: 'var(--primary)',
            border: 'none',
            borderRadius: 6,
            padding: '4px 12px',
            cursor: 'pointer',
          }}
        >
          Démarrer
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--muted-foreground)',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            borderRadius: 4,
          }}
          onMouseEnter={(e: any) => (e.currentTarget.style.color = 'var(--foreground)')}
          onMouseLeave={(e: any) => (e.currentTarget.style.color = 'var(--muted-foreground)')}
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </div>
    </div>
  );
}
