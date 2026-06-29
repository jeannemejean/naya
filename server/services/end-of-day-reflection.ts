import { storage } from "../storage";
import { callClaude, CLAUDE_MODELS } from "./claude";

// ════════════════════════════════════════════════════════════════════════════════
// BILAN DE FIN DE JOURNÉE (Part 4)
// En fin de journée, Naya regarde quelles tâches ont glissé (non faites), comprend
// POURQUOI (journée surchargée / type de tâche évité / énergie basse), et programme une
// question Companion. Elle s'affiche quand l'utilisateur rouvre l'app — donc le lendemain
// matin. Si le MÊME motif se répète sur plusieurs jours, la question devient plus profonde
// (l'escalade « +3 jours » émerge naturellement quand le motif récidive).
//
// Garde-fous : best-effort (ne jamais planter), seuil ≥ 2 tâches glissées, une seule
// question par jour, planification en pause ignorée.
// ════════════════════════════════════════════════════════════════════════════════

const TRIGGER_TYPE = "end_of_day_reflection";
const SLIP_THRESHOLD = 2; // on ne questionne qu'à partir de 2 tâches glissées
const RECURRENCE_WINDOW_DAYS = 7;
const SIGNAL_TYPE = "avoidance_pattern"; // marqueur dans behavioral_signals (historique des motifs)

type Reason = { key: string; label: string };

function parisToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); // YYYY-MM-DD
}

// Infère le motif dominant des tâches non faites.
function inferReason(incomplete: any[], total: number, energyLevel: string | undefined): Reason {
  // 1) Type/énergie de tâche systématiquement évité (≥ 2 tâches du même type)
  const byType = new Map<string, number>();
  for (const t of incomplete) {
    const k = (t.taskEnergyType || t.type || "").toString();
    if (k) byType.set(k, (byType.get(k) || 0) + 1);
  }
  let dominant: { k: string; n: number } | null = null;
  for (const [k, n] of Array.from(byType.entries())) if (!dominant || n > dominant.n) dominant = { k, n };
  if (dominant && dominant.n >= 2) {
    return { key: `avoid:${dominant.k}`, label: `tâches de type « ${dominant.k} » repoussées` };
  }
  // 2) Journée surchargée
  if (total >= 8) {
    return { key: "overload", label: "journée trop chargée" };
  }
  // 3) Énergie basse
  if (energyLevel === "low" || energyLevel === "depleted") {
    return { key: "low_energy", label: "énergie basse" };
  }
  // 4) Générique
  return { key: "general", label: "plusieurs tâches non faites" };
}

// Formule la question (voix Naya), best-effort via Haiku, sinon template.
async function craftQuestion(args: {
  reason: Reason; slippedTitles: string[]; count: number; recurring: boolean;
}): Promise<string> {
  const { reason, slippedTitles, count, recurring } = args;
  const fallback = recurring
    ? `Ça fait plusieurs jours que ça coince sur le même point (${reason.label}). On regarde ensemble ce qui bloque vraiment, et on ajuste ?`
    : `Hier, ${count} tâches ont glissé (${reason.label}). C'était quoi — journée trop pleine, pas le bon moment, ou la tâche elle-même ? Dis-moi, j'ajuste.`;
  try {
    const out = await callClaude({
      model: CLAUDE_MODELS.fast,
      taskKind: "fast_generation",
      max_tokens: 160,
      system:
        "Tu es Naya. Tu écris UNE question courte, chaleureuse et directe (2e personne, tutoiement, " +
        "jamais corporate, pas de blabla) pour comprendre pourquoi des tâches n'ont pas été faites hier. " +
        "Pas de liste, pas de préambule. Une à deux phrases max. Termine par une vraie question.",
      messages: [{
        role: "user",
        content:
          `Motif détecté : ${reason.label}. Nombre de tâches glissées : ${count}. ` +
          `Récurrent sur plusieurs jours : ${recurring ? "oui" : "non"}. ` +
          `Exemples de tâches : ${slippedTitles.slice(0, 3).join(" ; ") || "—"}. ` +
          `Écris la question.`,
      }],
    });
    const txt = (out || "").trim();
    return txt.length >= 8 ? txt : fallback;
  } catch {
    return fallback;
  }
}

export async function runEndOfDayReflectionForUser(
  userId: string,
  today: string,
  opts?: { dryRun?: boolean },
): Promise<{ asked: boolean; reason?: string; question?: string; slipped?: number; recurring?: boolean }> {
  const dryRun = opts?.dryRun === true;
  try {
    const prefs = await storage.getUserPreferences(userId).catch(() => null);
    if ((prefs as any)?.planningStatus === "paused") return { asked: false };

    const todayTasks = await storage.getTasksInRange(userId, today, today).catch(() => []);
    const real = (todayTasks as any[]).filter((t) => t.type !== "milestone" && t.source !== "milestone");
    const incomplete = real.filter((t) => !t.completed);
    if (incomplete.length < SLIP_THRESHOLD) return { asked: false, slipped: incomplete.length };

    // Une seule question de ce type par jour.
    if (!dryRun) {
      const pending = await storage.getPendingMessages(userId).catch(() => []);
      const already = (pending as any[]).some(
        (m) => m.triggerType === TRIGGER_TYPE && String(m.createdAt).slice(0, 10) === today,
      );
      if (already) return { asked: false };
    }

    const reason = inferReason(incomplete, real.length, (prefs as any)?.currentEnergyLevel);

    // Récurrence : ce motif est-il déjà apparu ces derniers jours ? (avant d'enregistrer aujourd'hui)
    const signals = await storage.getBehavioralSignals(userId).catch(() => []);
    const cutoff = Date.now() - RECURRENCE_WINDOW_DAYS * 86400000;
    const priorSameMotif = (signals as any[]).filter(
      (s) => s.signalType === SIGNAL_TYPE && s.linkedContext === reason.key && new Date(s.createdAt).getTime() >= cutoff,
    ).length;
    const recurring = priorSameMotif >= 1;

    const question = await craftQuestion({
      reason,
      slippedTitles: incomplete.map((t) => t.title),
      count: incomplete.length,
      recurring,
    });

    if (dryRun) {
      return { asked: true, reason: reason.key, question, slipped: incomplete.length, recurring };
    }

    // Historise le motif du jour (sert à détecter la récurrence les jours suivants).
    await storage.createBehavioralSignal({
      userId,
      signalType: SIGNAL_TYPE,
      content: `${incomplete.length} tâches non faites — motif : ${reason.label}`,
      linkedContext: reason.key,
    } as any).catch(() => {});

    await storage.createPendingMessage({
      userId,
      message: question,
      triggerType: TRIGGER_TYPE,
    });

    console.log(`[EoD] Reflection queued for ${userId} — motif=${reason.key} recurring=${recurring} slipped=${incomplete.length}`);
    return { asked: true, reason: reason.key, question, slipped: incomplete.length, recurring };
  } catch (err: any) {
    console.error(`[EoD] Reflection error for ${userId}:`, err?.message);
    return { asked: false };
  }
}

export async function runEndOfDayReflection(): Promise<void> {
  const today = parisToday();
  const userIds = await storage.getActiveUserIds().catch(() => [] as string[]);
  console.log(`[EoD] Running end-of-day reflection for ${userIds.length} users (${today})`);
  for (const userId of userIds) {
    await runEndOfDayReflectionForUser(userId, today);
  }
  console.log("[EoD] Done");
}

// Planifié à 16:45 UTC (18:45 Paris) — AVANT le rollover de fin de journée (17:00 UTC),
// pour que les tâches du jour soient encore datées aujourd'hui au moment de l'analyse.
export function scheduleEndOfDayReflection(): void {
  const TARGET_H = 16, TARGET_M = 45;
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(TARGET_H, TARGET_M, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    console.log(`[EoD] Next reflection at ${next.toISOString()} (in ${Math.round(ms / 60000)}min)`);
    setTimeout(async () => {
      try { await runEndOfDayReflection(); } catch (e) { console.error("[EoD] run error:", e); }
      scheduleNext();
    }, ms);
  };
  scheduleNext();
}
