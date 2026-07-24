// Plan de remise à zéro d'un compte (« Reset » des Réglages).
//
// Pourquoi ce fichier existe : beaucoup de FK sont en ON DELETE NO ACTION.
// UNE SEULE table enfant oubliée fait échouer TOUT le reset (transaction annulée,
// l'utilisateur voit « Échec de la sauvegarde des paramètres »). C'est déjà arrivé
// deux fois — d'abord à l'ajout de prospection_usage, puis de lead_step_messages.
//
// Le plan ci-dessous décrit, DANS L'ORDRE, ce que fait `storage.resetUserOnboardingState`.
// `findUnsafeReferences` le confronte au graphe de FK réel du schéma Drizzle :
// si quelqu'un ajoute une table qui référence une table supprimée par le reset,
// le test `account-reset-plan.test.ts` échoue avant que la prod ne casse.
//
// ⚠️ Toute modification de `resetUserOnboardingState` doit être reflétée ici.

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

export type ResetMode =
  | "delete" // les lignes sont supprimées
  | "detach"; // les lignes sont GARDÉES, seules les colonnes FK listées passent à NULL

export interface ResetStep {
  table: string; // nom SQL de la table
  mode: ResetMode;
  columns?: string[]; // requis pour "detach" : colonnes FK mises à NULL
  note?: string;
}

// Ce que le reset NE touche JAMAIS (décision produit, 2026-07-24) :
//  - users, subscriptions, access_code_redemptions → compte et facturation
//  - social_accounts, google_calendar_tokens       → connexions (pas de OAuth à refaire)
//  - user_preferences                              → réglages (seul active_project_id est détaché)
//  - ai_invocations                                → corpus propriétaire Naya (FK en SET NULL)

/** Ordre exact des opérations de `storage.resetUserOnboardingState`. */
export const ACCOUNT_RESET_PLAN: ResetStep[] = [
  // ── Phase 1 : libérer les FK des enregistrements qu'on GARDE ────────────────
  {
    table: "user_preferences",
    mode: "detach",
    columns: ["active_project_id"],
    note: "les réglages sont conservés",
  },

  // ── Phase 2 : mémoire, captures et contenus transverses ─────────────────────
  // behavioral_signals et business_memory pointent sur quick_capture_entries,
  // qui pointe elle-même sur tasks et projects → tout part en premier.
  { table: "behavioral_signals", mode: "delete" },
  { table: "business_memory", mode: "delete" },
  { table: "quick_capture_entries", mode: "delete" },
  { table: "companion_conversations", mode: "delete" },
  { table: "saved_articles", mode: "delete" },
  { table: "metrics", mode: "delete" },
  { table: "day_availability", mode: "delete" },
  { table: "media_library", mode: "delete", note: "⚠️ les fichiers R2 eux-mêmes ne sont pas supprimés" },
  { table: "prospection_usage", mode: "delete", note: "remet aussi le compteur LinkedIn hebdo à zéro" },

  // ── Phase 3 : enfants de tasks, puis tasks ──────────────────────────────────
  { table: "companion_pending_messages", mode: "delete" },
  { table: "task_workspace_entries", mode: "delete" },
  { table: "task_feedback", mode: "delete" },
  { table: "task_schedule_events", mode: "delete" },
  { table: "tasks", mode: "delete", note: "task_dependencies suit en ON DELETE CASCADE" },

  // ── Phase 4 : enfants de leads, puis leads ──────────────────────────────────
  { table: "lead_step_messages", mode: "delete", note: "cache de messages sur-mesure" },
  { table: "lead_sequence_state", mode: "delete" },
  { table: "outreach_messages", mode: "delete" },
  { table: "leads", mode: "delete" },

  // ── Phase 5 : content, séquences, puis campagnes ────────────────────────────
  { table: "content", mode: "delete" },
  { table: "campaigns", mode: "delete" },
  { table: "campaign_sequence_steps", mode: "delete" },
  { table: "prospection_campaigns", mode: "delete" },

  // ── Phase 6 : jalons ────────────────────────────────────────────────────────
  { table: "milestone_conditions", mode: "delete" },
  { table: "project_milestones", mode: "delete" },
  { table: "milestone_triggers", mode: "delete" },

  // ── Phase 7 : listes de tâches ──────────────────────────────────────────────
  { table: "task_list_items", mode: "delete" },
  { table: "task_lists", mode: "delete" },

  // ── Phase 8 : personas ──────────────────────────────────────────────────────
  { table: "persona_strategy_mapping", mode: "delete" },
  { table: "persona_analysis_results", mode: "delete" },
  { table: "target_personas", mode: "delete" },

  // ── Phase 9 : autres enfants de projects ────────────────────────────────────
  { table: "project_goals", mode: "delete" },
  { table: "project_strategy_profiles", mode: "delete" },
  { table: "clients", mode: "delete" },
  { table: "strategy_reports", mode: "delete" },
  { table: "brand_dna", mode: "delete" },
  { table: "memory_entries", mode: "delete" },

  // ── Phase 10 : projects ──────────────────────────────────────────────────────
  { table: "projects", mode: "delete" },

  // ── Phase 11 : profil opératoire ────────────────────────────────────────────
  { table: "user_operating_profiles", mode: "delete" },
];

export interface UnsafeReference {
  child: string;
  column: string;
  parent: string;
  reason: string;
}

/**
 * Confronte un plan de reset au graphe de FK réel.
 *
 * Une référence est SÛRE si, pour chaque FK enfant → parent supprimé par le plan :
 *  - la FK est en ON DELETE cascade / set null (Postgres s'en charge), OU
 *  - la ligne enfant est supprimée AVANT le parent, OU
 *  - la colonne FK est détachée (mise à NULL) AVANT le parent.
 *
 * Fonction pure : `tables` est injecté par l'appelant (les tables du schéma Drizzle).
 */
export function findUnsafeReferences(tables: PgTable[], plan: ResetStep[] = ACCOUNT_RESET_PLAN): UnsafeReference[] {
  const deletedAt = new Map<string, number>();
  const detachedAt = new Map<string, number>(); // clé "table.colonne"

  plan.forEach((step, index) => {
    if (step.mode === "delete") {
      deletedAt.set(step.table, index);
    } else {
      for (const column of step.columns ?? []) {
        detachedAt.set(`${step.table}.${column}`, index);
      }
    }
  });

  const unsafe: UnsafeReference[] = [];

  for (const table of tables) {
    const config = getTableConfig(table);
    const childName = config.name;

    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const parentName = getTableConfig(reference.foreignTable as PgTable).name;

      const parentDeletedAt = deletedAt.get(parentName);
      if (parentDeletedAt === undefined) continue; // le parent survit au reset

      const onDelete = (foreignKey as { onDelete?: string }).onDelete;
      if (onDelete === "cascade" || onDelete === "set null") continue; // Postgres gère

      for (const column of reference.columns) {
        const columnName = (column as { name: string }).name;

        const childDeletedAt = deletedAt.get(childName);
        if (childDeletedAt !== undefined && childDeletedAt < parentDeletedAt) continue;

        const columnDetachedAt = detachedAt.get(`${childName}.${columnName}`);
        if (columnDetachedAt !== undefined && columnDetachedAt < parentDeletedAt) continue;

        const reason =
          childDeletedAt === undefined
            ? `« ${childName} » n'est pas traitée par le plan de reset`
            : `« ${childName} » est traitée APRÈS « ${parentName} » (position ${childDeletedAt} > ${parentDeletedAt})`;

        unsafe.push({ child: childName, column: columnName, parent: parentName, reason });
      }
    }
  }

  return unsafe;
}
