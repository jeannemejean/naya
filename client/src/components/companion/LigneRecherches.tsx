// Ligne discrète sous une réponse : où Naya a cherché pour répondre.
import { useTranslation } from "react-i18next";

export function LigneRecherches({ recherches }: { recherches: string[] }) {
  const { t } = useTranslation();
  if (recherches.length === 0) return null;
  return (
    <p
      style={{
        marginTop: 6,
        marginBottom: 0,
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: '0.5625rem',
        letterSpacing: '0.02em',
        fontWeight: 300,
        color: 'var(--muted-foreground)',
        opacity: 0.8,
      }}
    >
      {t('companion.chercheDans', { sources: recherches.join(' ; ') })}
    </p>
  );
}
