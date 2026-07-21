// Rendu structuré de l'audit de marque IA d'un prospect — refonte de l'ancien bloc audit inline
// (git show 80a5a90:client/src/pages/outreach.tsx ~661-667 pour AUDIT_LABELS, ~826-838 pour le
// rendu). `auditNotes` peut être : une chaîne JSON (`leads.audit_notes` / `leads.strategic_notes`),
// un objet déjà parsé, du texte brut non-JSON (fallback), ou null/vide (audit pas encore généré).
// Ne doit jamais throw — toute entrée malformée retombe sur un état vide ou du texte brut.
import { Sparkles } from 'lucide-react';

// Labels lisibles des sections d'audit (clés dynamiques selon le type de projet du prospect) —
// migré tel quel depuis l'ancien outreach.tsx.
const AUDIT_LABELS: Record<string, string> = {
  contexteMarque: 'Contexte marque', audience: 'Audience', contenu: 'Contenu & présence',
  positionnement: 'Positionnement', enjeux: 'Enjeux identifiés', angle: 'Notre angle projet',
  contexteEntreprise: 'Contexte entreprise', stackActuel: 'Stack actuel', signauxAchat: 'Signaux d’achat',
  decideurs: 'Décideurs', contextePersonne: 'Contexte personne', activitePublique: 'Activité publique',
  besoinsProbables: 'Besoins probables', contexte: 'Contexte', observations: 'Observations',
};

function auditSectionLabel(key: string): string {
  return AUDIT_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

/** Section spéciale toujours mise en avant / affichée en dernier — l'angle projet retenu par Naya. */
const HIGHLIGHT_KEY = 'angle';

interface ParsedAudit {
  /** Sections clé → texte, quand `auditNotes` est un JSON objet valide (ou déjà un objet). */
  sections: Record<string, string> | null;
  /** Texte brut, quand `auditNotes` n'est ni vide ni un objet JSON parseable. */
  raw: string | null;
}

function parseAuditNotes(auditNotes: unknown): ParsedAudit {
  if (auditNotes == null) return { sections: null, raw: null };

  if (typeof auditNotes === 'object') {
    // Déjà un objet (ex: passé pré-parsé par un appelant) — pas de tableau, sections string uniquement.
    if (Array.isArray(auditNotes)) return { sections: null, raw: null };
    return { sections: auditNotes as Record<string, string>, raw: null };
  }

  if (typeof auditNotes === 'string') {
    const trimmed = auditNotes.trim();
    if (!trimmed) return { sections: null, raw: null };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { sections: parsed as Record<string, string>, raw: null };
      }
      // JSON valide mais pas un objet de sections (ex: nombre, tableau) → traiter comme texte brut.
      return { sections: null, raw: trimmed };
    } catch {
      // Pas du JSON — audit legacy en texte libre.
      return { sections: null, raw: trimmed };
    }
  }

  return { sections: null, raw: null };
}

export default function AuditView({ auditNotes }: { auditNotes?: string | Record<string, unknown> | null }) {
  const { sections, raw } = parseAuditNotes(auditNotes);

  if (!sections && !raw) {
    return (
      <div className="text-center py-10 space-y-2">
        <div className="w-10 h-10 rounded-lg bg-naya-mauve/12 flex items-center justify-center mx-auto">
          <Sparkles className="w-5 h-5 text-naya-mauve" />
        </div>
        <p className="text-sm font-medium text-foreground">Audit non généré</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          Lance « Enrichir (IA) » depuis l'onglet Profil pour générer un audit structuré.
        </p>
      </div>
    );
  }

  if (!sections) {
    // Fallback texte brut : rendu tel quel, sans découpage en sections.
    return (
      <div className="rounded-lg bg-muted/40 p-4">
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{raw}</p>
      </div>
    );
  }

  // Sections non vides, dans l'ordre reçu — l'angle projet est toujours déplacé en dernier et
  // mis en avant visuellement (c'est la synthèse actionnable de l'audit).
  const keys = Object.keys(sections).filter((k) => sections[k]);
  const orderedKeys = keys.includes(HIGHLIGHT_KEY)
    ? [...keys.filter((k) => k !== HIGHLIGHT_KEY), HIGHLIGHT_KEY]
    : keys;

  if (orderedKeys.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-10">
        Audit généré mais vide.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {orderedKeys.map((key, i) => {
        const isHighlight = key === HIGHLIGHT_KEY;
        return (
          <div
            key={key}
            className={
              isHighlight
                ? 'rounded-lg border border-naya-mauve/40 bg-naya-mauve/10 p-4'
                : 'rounded-lg bg-muted/40 p-4'
            }
          >
            <p className={`text-xs font-semibold mb-1.5 ${isHighlight ? 'text-naya-mauve' : 'text-foreground'}`}>
              {isHighlight ? '✦' : `${i + 1}.`} {auditSectionLabel(key)}
            </p>
            <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {String(sections[key])}
            </p>
          </div>
        );
      })}
    </div>
  );
}
