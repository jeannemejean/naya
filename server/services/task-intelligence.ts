/**
 * Task Intelligence Service
 * ─────────────────────────────────────────────────────────────────
 * Orchestre la réponse de Naya face aux tâches non accomplies :
 * - Déduplication des pending messages
 * - Reformulation automatique des titres vagues (Claude Haiku)
 * - Push notifications Expo (si token disponible)
 * - Création de messages Companion pré-chargés
 */

import { Expo } from 'expo-server-sdk';
import { storage } from '../storage';
import { callClaude, CLAUDE_MODELS } from './claude';
import { buildNayaContext } from './naya-context';

const expo = new Expo();

// ─── Heuristique rapide (avant d'appeler Claude) ─────────────────

function isVagueHeuristic(title: string): boolean {
  const trimmed = title.trim();
  const words = trimmed.split(/\s+/);
  if (words.length < 4) return true;
  const vaguePatterns = /^(voir pour|s'occuper de|travailler sur|gérer|penser à|checker|check|traiter|regarder|finir|faire)/i;
  return vaguePatterns.test(trimmed);
}

// ─── Reformulation Claude Haiku ───────────────────────────────────

export async function reformulateIfVague(
  userId: string,
  task: { id: number; title: string; projectId?: number | null }
): Promise<{ rewrite: string | null }> {
  if (!isVagueHeuristic(task.title)) return { rewrite: null };

  try {
    const context = await buildNayaContext(userId, task.projectId ?? null);
    const response = await callClaude({
      model: CLAUDE_MODELS.fast,
      system: context,
      messages: [{
        role: 'user',
        content: `Tâche reportée 3 fois : "${task.title}"\n\nÉvalue si ce titre est trop vague pour être actionnable.\nSi oui, réécris-le en une formulation claire avec un verbe d'action précis (max 10 mots).\nSi non, retourne null.\n\nRéponds UNIQUEMENT en JSON valide : { "rewrite": "nouveau titre ou null" }\nSi pas de réécriture nécessaire : { "rewrite": null }`,
      }],
      max_tokens: 200,
    });

    // Extraire le JSON — claude peut entourer le JSON de backticks
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { rewrite: null };
    const parsed = JSON.parse(jsonMatch[0]);
    return { rewrite: parsed.rewrite && parsed.rewrite !== 'null' ? parsed.rewrite : null };
  } catch (e) {
    console.error('[TaskIntelligence] reformulateIfVague error:', e);
    return { rewrite: null };
  }
}

// ─── Push notification ────────────────────────────────────────────

export async function sendPushNotification(
  userId: string,
  taskTitle: string
): Promise<void> {
  try {
    const user = await storage.getUser(userId);
    const pushToken = (user as any)?.expoPushToken;
    if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;

    await expo.sendPushNotificationsAsync([{
      to: pushToken,
      title: 'Naya a une question',
      body: `'${taskTitle}' revient depuis plusieurs jours.`,
      data: { screen: 'companion' },
      sound: 'default',
    }]);
  } catch (e) {
    // Push failure is non-blocking — Companion message is created regardless
    console.error('[TaskIntelligence] Push notification failed:', e);
  }
}

// ─── Orchestrateur principal ──────────────────────────────────────

/**
 * Appelé après chaque déplacement automatique de tâche.
 * newCount = valeur de learnedAdjustmentCount APRÈS incrément.
 */
export async function handleTaskDeferral(
  userId: string,
  task: { id: number; title: string; projectId?: number | null; learnedAdjustmentCount?: number | null },
  newCount: number
): Promise<void> {
  if (newCount < 2) return;

  const triggerType = newCount === 2 ? 'task_deferred_2x' : 'task_deferred_3x';

  // Déduplication : ne pas créer de doublon si un message non lu existe déjà
  const existing = await storage.getPendingMessageByTaskAndType(task.id, triggerType).catch(() => undefined);
  if (existing) return;

  let message: string;
  let displayTitle = task.title;

  if (newCount >= 3) {
    // Tentative de reformulation
    const { rewrite } = await reformulateIfVague(userId, task);
    if (rewrite) {
      await storage.updateTask(task.id, { title: rewrite }).catch(e =>
        console.error('[TaskIntelligence] reformulate updateTask failed:', e)
      );
      message = `'${displayTitle}' revenait depuis 3 jours — je l'ai reformulée en '${rewrite}' pour que ce soit plus facile à démarrer. C'est quoi le vrai blocage ?`;
      displayTitle = rewrite;
    } else {
      message = `'${displayTitle}' revient depuis 3 jours. Un obstacle ? Je peux la découper, la reporter à la semaine prochaine, ou la supprimer.`;
    }
  } else {
    // newCount === 2
    message = `'${displayTitle}' a été reportée 2 fois cette semaine. Un obstacle ? Je peux la découper, la reprogrammer à la semaine prochaine, ou la supprimer si elle n'est plus d'actualité.`;
    // Push uniquement au seuil 2 (pas de spam à chaque report suivant)
    await sendPushNotification(userId, displayTitle);
  }

  await storage.createPendingMessage({
    userId,
    message,
    triggerType,
    relatedTaskId: task.id,
  }).catch(e => console.error('[TaskIntelligence] createPendingMessage failed:', e));
}
