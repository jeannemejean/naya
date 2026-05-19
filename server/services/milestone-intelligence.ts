import { callClaude, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";
import type { MilestoneTrigger } from "@shared/schema";

export interface ParsedMilestoneTrigger {
  conditionType: string;
  conditionSummary: string;
  conditionKeywords: string[];
  tasksToUnlock: Array<{
    title: string;
    description: string;
    type: string;
    category: string;
    priority: number;
    estimatedDuration: number;
    taskEnergyType: string;
  }>;
  schedulingMode: string;
  reasoning: string;
}

export async function parseMilestoneTrigger(
  rawText: string,
  projectContext?: { projectName?: string; projectType?: string }
): Promise<ParsedMilestoneTrigger> {
  try {
    const prompt = `You are Naya, an AI planning assistant. The user wrote a conditional planning rule in natural language. Parse it into structured data.

USER INPUT: "${rawText}"

${projectContext?.projectName ? `PROJECT: ${projectContext.projectName} (${projectContext.projectType || 'general'})` : ''}

Extract:
1. conditionType: "task_completed" | "goal_reached" | "external_event" | "manual" | "date_reached" — what kind of trigger is this?
2. conditionSummary: A clean, short summary of the condition (e.g. "Sign first client")
3. conditionKeywords: Array of 3-8 keywords/phrases that would indicate this condition has been met when found in completed task titles or capture entries (e.g. ["client signed", "first client", "contract signed", "onboarding"])
4. tasksToUnlock: Array of 2-5 concrete tasks that should be created when this trigger fires. Each task needs: title, description, type (content|outreach|admin|planning), category (trust|conversion|engagement|planning), priority (1-5), estimatedDuration (minutes), taskEnergyType (deep_work|creative|admin|social|logistics|execution)
5. schedulingMode: "immediate" | "deferred" | "spread_week" — when should unlocked tasks be scheduled?
6. reasoning: Why you interpreted the rule this way

Respond with JSON only:
{
  "conditionType": "task_completed",
  "conditionSummary": "Sign first client",
  "conditionKeywords": ["client signed", "first client", "new client"],
  "tasksToUnlock": [
    {
      "title": "Create client onboarding document",
      "description": "Prepare a welcome document with next steps for the new client",
      "type": "admin",
      "category": "planning",
      "priority": 2,
      "estimatedDuration": 45,
      "taskEnergyType": "admin"
    }
  ],
  "schedulingMode": "immediate",
  "reasoning": "The user wants to prepare for client onboarding once they sign their first client"
}`;

    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      messages: [
        { role: "system", content: "You are Naya's milestone trigger parser. You extract structured conditional rules from natural language. Always respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    });

    const parsed = JSON.parse(raw || "{}") as ParsedMilestoneTrigger;
    return {
      conditionType: parsed.conditionType || "keyword",
      conditionSummary: parsed.conditionSummary || rawText.substring(0, 100),
      conditionKeywords: Array.isArray(parsed.conditionKeywords) ? parsed.conditionKeywords : [],
      tasksToUnlock: Array.isArray(parsed.tasksToUnlock) ? parsed.tasksToUnlock.map((t) => ({
        title: t.title || "Unlocked task",
        description: t.description || "",
        type: t.type || "admin",
        category: t.category || "planning",
        priority: t.priority || 3,
        estimatedDuration: t.estimatedDuration || 30,
        taskEnergyType: t.taskEnergyType || "execution",
      })) : [],
      schedulingMode: parsed.schedulingMode || "immediate",
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    console.error("Failed to parse milestone trigger:", error);
    const keywords = rawText.toLowerCase()
      .replace(/^(when|quand|si|if|dès que|once|après)\s+/i, '')
      .split(/[\s,]+/)
      .filter(w => w.length > 3)
      .slice(0, 5);
    return {
      conditionType: "manual",
      conditionSummary: rawText.substring(0, 100),
      conditionKeywords: keywords,
      tasksToUnlock: [{
        title: `Follow-up: ${rawText.substring(0, 60)}`,
        description: rawText,
        type: "admin",
        category: "planning",
        priority: 3,
        estimatedDuration: 30,
        taskEnergyType: "admin",
      }],
      schedulingMode: "immediate",
      reasoning: "Fallback parsing — AI unavailable",
    };
  }
}

export interface TriggeredMilestone {
  trigger: MilestoneTrigger;
  matchedKeywords: string[];
  confidence: number;
  matchSource: string;
}

export async function checkMilestoneTriggers(
  userId: string,
  projectId: number | null,
  context: {
    recentlyCompletedTasks?: Array<{ id: number; title: string }>;
    recentCaptures?: Array<{ content: string }>;
    recentWorkspaceNotes?: string;
  }
): Promise<TriggeredMilestone[]> {
  const allWatchingTriggers = await storage.getMilestoneTriggers(userId, "watching");
  if (allWatchingTriggers.length === 0) return [];

  const watchingTriggers = projectId
    ? allWatchingTriggers.filter(t => t.projectId === projectId || t.projectId === null)
    : allWatchingTriggers;

  if (watchingTriggers.length === 0) return [];

  const completedTitles = (context.recentlyCompletedTasks || []).map(t => t.title.toLowerCase());
  const captureTexts = (context.recentCaptures || []).map(c => c.content.toLowerCase());
  const notesText = (context.recentWorkspaceNotes || '').toLowerCase();
  const allText = [...completedTitles, ...captureTexts, notesText].join(' ');

  const triggered: TriggeredMilestone[] = [];

  for (const trigger of watchingTriggers) {
    const keywords = (trigger.conditionKeywords as string[]) || [];
    if (keywords.length === 0) continue;

    const matchedKeywords: string[] = [];
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (allText.includes(kwLower)) {
        matchedKeywords.push(kw);
      }
    }

    const confidence = keywords.length > 0
      ? Math.round((matchedKeywords.length / keywords.length) * 100)
      : 0;

    if (confidence >= 60) {
      let matchSource = 'unknown';
      const firstMatch = matchedKeywords[0]?.toLowerCase() || '';
      if (completedTitles.some(t => t.includes(firstMatch))) matchSource = 'completed_task';
      else if (captureTexts.some(c => c.includes(firstMatch))) matchSource = 'capture';
      else if (notesText.includes(firstMatch)) matchSource = 'workspace_note';

      triggered.push({ trigger, matchedKeywords, confidence, matchSource });
    }
  }

  return triggered;
}
