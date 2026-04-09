import { callClaude, callClaudeWithContext, CLAUDE_MODELS } from "./claude";
import { storage } from "../storage";
import { NAYA_SYSTEM_VOICE } from "../naya-voice";

function stripMarkdownJSON(raw: string | null | undefined): string {
  if (!raw) return '{}';
  let cleaned = raw.trim();

  // Remove markdown code fences - try multiple patterns
  if (cleaned.startsWith('```')) {
    // Pattern 1: ```json\n{...}\n```
    cleaned = cleaned.replace(/^```(?:json)?\s*\n/i, '').replace(/\n```\s*$/i, '');
    // Pattern 2: Any remaining backticks at start/end
    cleaned = cleaned.replace(/^```\s*/g, '').replace(/\s*```$/g, '');
  }

  // Remove any remaining leading/trailing backticks
  cleaned = cleaned.replace(/^`+|`+$/g, '');
  cleaned = cleaned.trim();

  // Extract just the JSON object/array — discard any trailing prose after closing brace
  const startBrace = cleaned.indexOf('{');
  const startBracket = cleaned.indexOf('[');
  const startIdx = startBrace === -1 ? startBracket
    : startBracket === -1 ? startBrace
    : Math.min(startBrace, startBracket);

  if (startIdx !== -1) {
    const openChar = cleaned[startIdx];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === openChar) depth++;
      else if (cleaned[i] === closeChar) {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx !== -1) {
      cleaned = cleaned.substring(startIdx, endIdx + 1);
    }
  }

  return cleaned.trim();
}

export async function getMemoryContext(userId: string): Promise<string> {
  try {
    const memories = await storage.getBusinessMemories(userId, { archived: false, limit: 10 });
    if (memories.length === 0) return '';
    const lines = memories.map(m => `- [${m.type.toUpperCase()}] ${m.content}`);
    return `\nBUSINESS MEMORY (chronological decisions, lessons, pivots, milestones, and observations — use as context):\n${lines.join('\n')}\n`;
  } catch {
    return '';
  }
}

export interface ProjectContext {
  projectId?: number;
  projectType?: string;
  projectName?: string;
  monetizationIntent?: string;
  activeGoalTitle?: string;
  activeGoalSuccessMode?: string;
  currentStage?: string;
}

export interface PersonaContext {
  userPersonaName?: string;
  userPersonaOutputStyle?: string;
  targetPersonaName?: string;
  targetPersonaDecisionTriggers?: string[];
  targetPersonaPersuasionDrivers?: string[];
  targetPersonaPreferredChannels?: string[];
}

export interface BrandDnaInput {
  businessType?: string;
  businessModel?: string;
  revenueUrgency?: string;
  targetAudience?: string;
  corePainPoint?: string;
  audienceAspiration?: string;
  authorityLevel?: string;
  communicationStyle?: string;
  uniquePositioning?: string;
  platformPriority?: string;
  currentPresence?: string;
  primaryGoal?: string;
  contentBandwidth?: string;
  successDefinition?: string;
  currentChallenges?: string;
  pastSuccess?: string;
  inspiration?: string;
  businessName?: string;
  website?: string;
  linkedinProfile?: string;
  instagramHandle?: string;
  offers?: string;
  contentPillarsDetailed?: any[];
  brandVoiceKeywords?: string[];
  brandVoiceAntiKeywords?: string[];
  priceRange?: string;
  clientJourney?: string;
  revenueTarget?: string;
  activeBusinessPriority?: string;
  competitorLandscape?: string;
  editorialTerritory?: string;
  geographicFocus?: string;
  currentBusinessStage?: string;
  teamStructure?: string;
  operationalConstraints?: string;

  tone?: any;
  contentPillars?: string[];
  audience?: string;
  painPoints?: string[];
  desires?: string[];
  offer?: string;
  businessGoal?: string;
}

export interface ContentGenerationRequest {
  userId: string;
  platform: string;
  goal: string;
  pillar?: string;
  topic?: string;
  brandDna: BrandDnaInput;
  projectContext?: ProjectContext;
  personaContext?: PersonaContext;
}

export interface DailyTasksRequest {
  userId: string;
  brandDna: BrandDnaInput;
  recentContent: any[];
  recentOutreach: any[];
  weeklyGoals: any;
  completedTasksToday: any[];
  projectContext?: ProjectContext;
  personaContext?: PersonaContext;
  recentWorkspaceNotes?: string;
  rejectedTasksContext?: string;
  operatingProfileSummary?: string;
  positiveEffectivenessContext?: string;
  workDayStart?: string;
  workDayEnd?: string;
  breaks?: Array<{ start: string; end: string; label?: string }>;
  maxTasks?: number;
  energyLevel?: string;
  emotionalContext?: string;
  activeGoals?: Array<{
    id: number;
    title: string;
    successMode: string;
    goalType: string;
    dueDate?: Date | null;
  }>;
  operatingMode?: string; // create | build | grow | explore | maintain
}

export interface StrategyAnalysisRequest {
  userId: string;
  brandDna: BrandDnaInput;
  weeklyMetrics: any;
  contentPerformance: any[];
  outreachPerformance: any[];
  currentGoals: any;
  weekContext?: string;
  projectContext?: ProjectContext;
  personaContext?: PersonaContext;
}

export interface OutreachMessageRequest {
  userId: string;
  leadInfo: {
    name: string;
    platform: string;
    company?: string;
    notes?: string;
  };
  messageType: "initial" | "follow_up";
  goal: string;
  brandDna: BrandDnaInput;
  projectContext?: ProjectContext;
  personaContext?: PersonaContext;
}

function buildProjectPersonaBlock(projectContext?: ProjectContext, personaContext?: PersonaContext): string {
  const parts: string[] = [];
  
  if (projectContext && (projectContext.projectType || projectContext.monetizationIntent)) {
    parts.push(`\nPROJECT CONTEXT:`);
    if (projectContext.projectName) parts.push(`- Project: ${projectContext.projectName}`);
    if (projectContext.projectType) parts.push(`- Type: ${projectContext.projectType}`);
    if (projectContext.monetizationIntent) {
      const intentMap: Record<string, string> = {
        'revenue-now': 'Revenue-generating (urgent commercial focus)',
        'authority-building': 'Authority building (credibility first, revenue later)',
        'exploratory': 'Exploratory (experimenting, no commercial pressure)',
        'none': 'Non-commercial (passion/impact driven)',
      };
      parts.push(`- Revenue Intent: ${intentMap[projectContext.monetizationIntent] || projectContext.monetizationIntent}`);
    }
    if (projectContext.activeGoalTitle) parts.push(`- Active Goal: ${projectContext.activeGoalTitle}`);
    if (projectContext.activeGoalSuccessMode) {
      const modeMap: Record<string, string> = {
        'revenue': 'Revenue generation — prioritize conversion, sales, and commercial outcomes',
        'visibility': 'Visibility — prioritize reach, awareness, and discoverability',
        'consistency': 'Consistency — prioritize showing up regularly and building habits',
        'exploration': 'Exploration — prioritize curiosity and experimentation without pressure',
        'learning': 'Learning — prioritize skill development and knowledge acquisition',
        'wellbeing': 'Wellbeing — prioritize sustainable pace and personal flourishing',
      };
      parts.push(`- Goal Mode: ${modeMap[projectContext.activeGoalSuccessMode] || projectContext.activeGoalSuccessMode}`);
    }
    if (projectContext.currentStage) parts.push(`- Stage: ${projectContext.currentStage}`);
  }

  if (personaContext && (personaContext.userPersonaName || personaContext.targetPersonaName)) {
    parts.push(`\nPERSONA CONTEXT:`);
    if (personaContext.userPersonaName) {
      parts.push(`- User Archetype: ${personaContext.userPersonaName}`);
      if (personaContext.userPersonaOutputStyle) parts.push(`  Output Style: ${personaContext.userPersonaOutputStyle}`);
    }
    if (personaContext.targetPersonaName) {
      parts.push(`- Target Persona: ${personaContext.targetPersonaName}`);
      if (personaContext.targetPersonaDecisionTriggers?.length) {
        parts.push(`  Decision Triggers: ${personaContext.targetPersonaDecisionTriggers.join(', ')}`);
      }
      if (personaContext.targetPersonaPersuasionDrivers?.length) {
        parts.push(`  Persuasion Drivers: ${personaContext.targetPersonaPersuasionDrivers.join(', ')}`);
      }
      if (personaContext.targetPersonaPreferredChannels?.length) {
        parts.push(`  Preferred Channels: ${personaContext.targetPersonaPreferredChannels.join(', ')}`);
      }
    }
  }

  return parts.join('\n');
}

function getOutputStyleInstruction(personaContext?: PersonaContext, projectContext?: ProjectContext): string {
  const persona = personaContext?.userPersonaName;
  const successMode = projectContext?.activeGoalSuccessMode;

  let style = '';

  if (persona === 'Strategist') {
    style = 'Frame with strategic frameworks, big-picture thinking, and positioning language. Use structured sections.';
  } else if (persona === 'Builder') {
    style = 'Be concise and action-oriented. Use checklists, numbered steps, and concrete immediate actions.';
  } else if (persona === 'Creative Marketer') {
    style = 'Lead with story, emotion, and connection. Use vivid examples and audience-centric language.';
  } else if (persona === 'Analytical Thinker') {
    style = 'Lead with data, metrics, and structured analysis. Use frameworks and measurable outcomes.';
  }

  const commercialCTA = ['exploration', 'wellbeing', 'learning'].includes(successMode || '');
  if (commercialCTA) {
    style += ' IMPORTANT: Do NOT include hard sales CTAs, conversion pressure, or commercial urgency language. This is an exploration/wellbeing-mode goal.';
  } else if (successMode === 'revenue') {
    style += ' Include clear, action-oriented CTAs that drive commercial outcomes — consultations, purchases, or direct inquiry.';
  }

  return style;
}

// Generate content based on brand DNA, project, and persona context
// Now uses callClaudeWithContext() for automatic full context injection
export async function generateContent(request: ContentGenerationRequest): Promise<{
  title: string;
  body: string;
  cta: string;
  strategicNote: string;
}> {
  try {
    // Extract projectId from request (it should be added to the request interface if needed)
    const projectId = (request as any).projectId || request.projectContext?.projectId || null;

    const outputStyle = getOutputStyleInstruction(request.personaContext, request.projectContext);

    const prompt = `Generate ${request.platform} content for this specific business.

Content Requirements:
- Platform: ${request.platform}
- Goal: ${request.goal}
- Pillar: ${request.pillar || "Most relevant pillar from the business context"}
- Topic: ${request.topic || "Choose based on brand positioning, offers, and current priorities"}

${outputStyle ? `Output Style Guidance: ${outputStyle}` : ''}

${request.personaContext?.targetPersonaDecisionTriggers?.length
  ? `Address these target persona decision triggers: ${request.personaContext.targetPersonaDecisionTriggers.join(', ')}`
  : ''}

IMPORTANT: Reference specific offers, positioning, voice keywords, and audience pain points from the business context above. Every piece of content should be so specific it could only work for THIS business.

Respond with JSON only:
{
  "title": "Brief title/hook",
  "body": "Full content text with appropriate platform formatting",
  "cta": "Call-to-action appropriate for the goal mode",
  "strategicNote": "Why this content works for their specific business, project, and goal"
}`;

    // Use callClaudeWithContext for automatic Brand DNA + project + persona injection
    const raw = await callClaudeWithContext({
      userId: request.userId,
      projectId,
      userMessage: prompt,
      model: CLAUDE_MODELS.fast,
      max_tokens: 2000,
      additionalSystemContext: `You are an expert content strategist who creates engaging, on-brand content that drives results for entrepreneurs. You adapt your output based on project type, monetization intent, and active goal mode. Always respond with valid JSON only.`,
    });

    return JSON.parse(stripMarkdownJSON(raw));
  } catch (error) {
    throw new Error("Failed to generate content: " + (error as Error).message);
  }
}

// Generate daily tasks with full project, persona, and behavioral intelligence
export async function generateDailyTasks(request: DailyTasksRequest): Promise<{
  focus: string;
  reasoning: string;
  tasks: Array<{
    title: string;
    description: string;
    type: string;
    category: string;
    priority: number;
    estimatedDuration: number;
    taskEnergyType: string;
    setupCost: string;
    canBeFragmented: boolean;
    recommendedTimeOfDay: string;
    scheduledTime?: string;
    workflowGroup?: string;
    activationPrompt?: string;
    goalIndex?: number;
  }>;
  dependencies?: Array<{
    taskIndex: number;
    dependsOnIndex: number;
    relationType: "blocked_by" | "follows" | "subtask_of";
  }>;
  workflowSuggestions?: Array<{
    label: string;
    taskIndexes: number[];
    recommendedBlockMinutes: number;
  }>;
}> {
  try {
    // Extract projectId from request
    const projectId = (request as any).projectId || request.projectContext?.projectId || null;
    const successMode = request.projectContext?.activeGoalSuccessMode;
    const monetizationIntent = request.projectContext?.monetizationIntent;

    const workspaceSection = request.recentWorkspaceNotes
      ? `\nRECENT THINKING NOTES (use for continuity):\n${request.recentWorkspaceNotes}\n`
      : '';
    const rejectedSection = request.rejectedTasksContext
      ? `\nREJECTED/REMOVED TASKS — Do NOT regenerate similar patterns:\n${request.rejectedTasksContext}\n`
      : '';
    const positiveSection = request.positiveEffectivenessContext
      ? `\nPOSITIVE COMPLETION PATTERNS — Bias toward these when relevant:\n${request.positiveEffectivenessContext}\n`
      : '';
    const profileSection = request.operatingProfileSummary
      ? `\nUSER BEHAVIORAL PROFILE:\n${request.operatingProfileSummary}\n`
      : '';

    // Derive framing rules from operating profile
    const profileFramingRules = (() => {
      const summary = request.operatingProfileSummary || '';
      const rules: string[] = [];
      if (summary.includes('morning')) rules.push('- Schedule deep_work tasks as morning, admin/social tasks as afternoon');
      if (summary.includes('smallest next step') || summary.includes('activation style: smallest')) {
        rules.push('- Write task titles as the first specific physical action, not the outcome (e.g. "Open doc and write first 3 sentences" not "Write blog post")');
      }
      if (summary.includes('avoid') && summary.includes('visibility')) {
        rules.push('- Avoid suggesting public-facing tasks unless strategically critical. If included, frame as low-stakes: "draft only, no publish required"');
      }
      if (summary.includes('avoid') && summary.includes('selling')) {
        rules.push('- Avoid overt sales tasks. Frame commercial tasks in terms of relationship or value delivery');
      }
      if (summary.includes('warm and supportive')) {
        rules.push('- Task descriptions use gentle, encouraging language: "this is a good moment to...", "you might find it useful to..."');
      }
      if (summary.includes('direct and brief')) {
        rules.push('- Task descriptions: one-line imperative verbs. No padding.');
      }
      if (summary.includes('deadline pressure')) {
        rules.push('- Include specific urgency or deadline context in descriptions where relevant');
      }
      return rules.length > 0 ? `\nPERSONALITY FRAMING RULES (apply to all tasks):\n${rules.join('\n')}\n` : '';
    })();

    const urgencyInstruction = (() => {
      if (monetizationIntent === 'revenue-now' && successMode === 'revenue') {
        return 'GOAL MODE: Revenue-generating. Prioritize conversion, outreach, and commercial execution tasks.';
      } else if (monetizationIntent === 'none' || successMode === 'exploration') {
        return 'GOAL MODE: Exploratory. Use curiosity-driven language. No sales pressure. Focus on creating and experimenting.';
      } else if (successMode === 'visibility') {
        return 'GOAL MODE: Visibility. Prioritize publishing, engagement, and reach-building activities.';
      } else if (successMode === 'consistency') {
        return 'GOAL MODE: Consistency. Prioritize sustainable habits and showing up regularly over big leaps.';
      } else if (successMode === 'learning') {
        return 'GOAL MODE: Learning. Include skill-building, research, and knowledge acquisition.';
      } else if (successMode === 'wellbeing') {
        return 'GOAL MODE: Wellbeing. Prioritize sustainable pace and quality over quantity.';
      }
      return '';
    })();

    const workDayStart = request.workDayStart || '09:00';
    const workDayEnd = request.workDayEnd || '18:00';
    const maxTasks = request.maxTasks || 5;

    const energyBlock = (() => {
      const el = request.energyLevel;
      if (!el || el === 'high') return '';
      const emotionalNote = request.emotionalContext
        ? `- Emotional context: "${request.emotionalContext}"`
        : '';
      const isGriefOrRecovery = request.emotionalContext &&
        /grief|recovery|loss|mourning|burnout/i.test(request.emotionalContext);
      const griefBlock = isGriefOrRecovery
        ? `\nGRIEF/RECOVERY MODE ACTIVE:
- Use reduced urgency in ALL task descriptions. Remove words like "urgent", "critical", "must".
- Suggest only 1-2 anchor tasks that feel safe and grounding.
- Frame tasks as invitations, not obligations: "When you're ready…", "If it feels right…"
- Include at least one reflection or self-care task.`
        : '';
      const rules: Record<string, string> = {
        medium: `\nENERGY LEVEL: MEDIUM — User has moderate energy today.
- Reduce deep_work tasks to max 1-2. Bias toward admin, creative, and execution tasks.
- Keep descriptions practical and grounded. No ambitious language.
${emotionalNote}`,
        low: `\nENERGY LEVEL: LOW — User has limited energy today.
- Maximum ${maxTasks} tasks total. Bias toward admin and creative taskEnergyType over deep_work.
- Use gentle, supportive language. Frame as "just this one thing" or "start small."
- Avoid deep_work tasks entirely unless absolutely critical.
${emotionalNote}${griefBlock}`,
        depleted: `\nENERGY LEVEL: DEPLETED — User needs rest.
- Maximum ${maxTasks} tasks. Prioritize admin and creative taskEnergyType. No deep_work.
- Use compassionate language. Give explicit permission to rest. Frame tasks as optional.
- Include at least one self-care or reflection task.
${emotionalNote}${griefBlock}`,
      };
      return rules[el] || '';
    })();
    const breaksBlock = request.breaks && request.breaks.length > 0
      ? `Scheduled breaks:\n${request.breaks.map(b => `- ${b.start}–${b.end}${b.label ? ` (${b.label})` : ''}`).join('\n')}`
      : 'No scheduled breaks.';

    const goalsBlock = request.activeGoals && request.activeGoals.length > 0
      ? `\n═══ ACTIVE GOALS FOR THIS PROJECT ═══\n${request.activeGoals.map((g, i) =>
          `[${i}] "${g.title}" — type: ${g.goalType}, success mode: ${g.successMode}${g.dueDate ? `, due: ${new Date(g.dueDate).toISOString().slice(0, 10)}` : ''}`
        ).join('\n')}\n`
      : '';

    const operatingModeBlock = (() => {
      const mode = request.operatingMode?.toLowerCase();
      if (!mode) return '';
      const mixes: Record<string, string> = {
        create:   'Task mix for CREATE mode: 40% deep creation (writing, building, designing), 30% strategy & planning, 30% research. Minimize outreach and admin this week.',
        build:    'Task mix for BUILD mode: 50% execution (implementing, producing, delivering), 30% planning & coordination, 20% selective outreach to early adopters. Ship things.',
        grow:     'Task mix for GROW mode: 50% direct outreach & relationship building, 30% visibility content, 20% offer refinement. Zero exploration or major new features.',
        explore:  'Task mix for EXPLORE mode: 40% research & discovery, 40% small experiments & prototypes, 20% documentation. No premature execution of unvalidated ideas.',
        maintain: 'Task mix for MAINTAIN mode: 50% client & customer relationships, 30% operational & admin, 20% selective visibility content. No major new initiatives.',
      };
      return mixes[mode]
        ? `\n═══ PROJECT OPERATING MODE: ${mode.toUpperCase()} ═══\n${mixes[mode]}\nThis directive overrides generic task variety — optimize the task mix for the current mode.\n`
        : '';
    })();

    const prompt = `Your job is NOT to generate a generic to-do list. Your job is to identify the highest-leverage moves for this specific business for THE WEEK AHEAD — expressed as concrete, executable actions that reference the founder's actual offers, audience, voice, and positioning.

IMPORTANT: Generate DIVERSE tasks that will be distributed across the week (Monday-Friday). Each task should be unique and different. DO NOT repeat similar tasks. Ensure variety in types of actions (content creation, outreach, admin, planning, etc.) and platforms.

Every task must be so specific it could only apply to THIS person. If a task could apply to any business, it is wrong.

═══ WORKING HOURS ═══
Work day: ${workDayStart} – ${workDayEnd}
${breaksBlock}

═══ CURRENT STATE ═══
- Content created recently: ${request.recentContent.length} | Outreach sent: ${request.recentOutreach.length} | Completed recently: ${request.completedTasksToday.length}
${workspaceSection}
${rejectedSection}
${positiveSection}
${energyBlock}

═══ NAYA'S 5-STEP STRATEGIC REASONING ═══

Before generating tasks, work through each step:

STEP 1 — GOAL ANCHOR: Review the active goals indexed below.${goalsBlock}For each task, decide which goal index [0–N] it primarily advances. Tasks that don't advance any listed goal are NOT acceptable. What does a winning week look like for each goal?

STEP 2 — HIGHEST LEVERAGE: Given this business's offers, audience pain point, and platform, what action categories move the needle most THIS WEEK? Ensure variety across: authority content | direct outreach | offer refinement | platform presence | relationship nurturing | operational | strategy.${operatingModeBlock}

STEP 3 — TASK SELECTION: Pick exactly ${maxTasks} DIVERSE tasks that will be spread across the week. Each task must: (a) directly advance the goal, (b) reference the actual offer or positioning, (c) target the actual audience, (d) be on the right platform, (e) be DIFFERENT from other tasks. Ensure variety in task types and approaches. If any answer is no — rewrite.

STEP 4 — SPECIFICITY CHECK: Every task title must name WHAT specifically (not "write content" — write what, about what angle, for which audience, on which platform). Tasks that could apply to any business fail this check.

STEP 5 — SCHEDULE: Assign scheduledTime values within ${workDayStart}–${workDayEnd}. Deep work first (morning). Each task starts exactly when the previous ends (scheduledTime + estimatedDuration). Zero overlaps.

═══ WHAT NOT TO GENERATE ═══

❌ "Create content about your business"
❌ "Do outreach to potential clients"
❌ "Prepare a strategy document"
❌ "Review your week"
❌ "Update your LinkedIn profile"

✅ "Write 200-word LinkedIn post: angle — [specific editorial territory angle]. Open with [audience pain point] moment. Close with soft CTA to [offer]. Save as draft."
✅ "DM 5 [platform] followers who engaged with your last post — acknowledge their comment, share one insight about [audience aspiration], zero pitch. List their names in the task."
✅ "Draft the first 3 bullet points of [offer] sales page — transformation from [pain point] → [aspiration], in [brand voice] tone."

═══ OUTPUT FORMAT — JSON only ═══

{
  "focus": "Strategic focus — name the exact goal move and who it serves",
  "reasoning": "2-3 sentences: why these specific DIVERSE tasks are the right moves for the week ahead, ensuring variety and progression",
  "tasks": [
    {
      "goalIndex": 0,
      "title": "Specific first-physical-action (not the outcome)",
      "description": "Step-by-step. Must reference the actual business: offer, audience pain point, platform, brand voice. Specific enough to execute without thinking.",
      "type": "content|outreach|admin|planning",
      "category": "trust|conversion|engagement|planning|visibility",
      "priority": 1,
      "estimatedDuration": 45,
      "taskEnergyType": "deep_work|creative|admin|social|logistics|execution",
      "setupCost": "low|medium|high",
      "canBeFragmented": false,
      "recommendedTimeOfDay": "morning|afternoon|evening|flexible",
      "scheduledTime": "09:00",
      "workflowGroup": null,
      "activationPrompt": "One sentence that gets them started in 30 seconds"
    }
  ],
  "dependencies": [],
  "workflowSuggestions": []
}

RULES: Exactly ${maxTasks} tasks. scheduledTime must not overlap. taskEnergyType must be one of the 6 exact values. No markdown fences in output. goalIndex must be a valid index into the goals list (0 to N-1), or 0 if no goals provided.`;

    const raw = await callClaudeWithContext({
      userId: request.userId,
      projectId,
      userMessage: prompt,
      model: CLAUDE_MODELS.smart,
      max_tokens: 8000,
      additionalSystemContext: `You are Naya — the strategic intelligence engine of an AI Operating System for independent founders.

You think like a business strategist who knows this founder's business as well as they do. You never give generic advice. Every task is derived from the specific business intelligence you've been given.

Naya's voice (apply to all task descriptions): Direct. Warm. Never corporate. Second person. Every sentence earns its place. Never: "It looks like...", "Here's a summary...", "Great!", "Certainly!". Reference the brand's own voice keywords in descriptions.

Always respond with valid JSON only. No markdown fences. No preamble.

${profileSection}
${profileFramingRules}
${urgencyInstruction}`,
    });

    return JSON.parse(stripMarkdownJSON(raw));
  } catch (error) {
    throw new Error("Failed to generate daily tasks: " + (error as Error).message);
  }
}

// Generate strategy insights with persona and project awareness
// Now uses callClaudeWithContext() for automatic full context injection
export async function generateStrategyInsights(request: StrategyAnalysisRequest): Promise<{
  weeklyFocus: string;
  insights: string[];
  recommendations: string[];
  nextWeekPlan: any;
}> {
  try {
    const projectId = (request as any).projectId || request.projectContext?.projectId || null;

    const prompt = `Analyze this week's performance and provide strategic insights:

This Week's Focus:
- ${request.weekContext || 'General weekly review'}

Performance Data:
- Metrics: ${JSON.stringify(request.weeklyMetrics)}
- Content Performance: ${JSON.stringify(request.contentPerformance)}
- Outreach Performance: ${JSON.stringify(request.outreachPerformance)}
- Goals Status: ${JSON.stringify(request.currentGoals)}

${request.personaContext?.userPersonaName === 'Strategist' ? 'Frame insights using strategic frameworks and big-picture positioning.' : ''}
${request.personaContext?.userPersonaName === 'Analytical Thinker' ? 'Lead with data-driven observations and measurable recommendations.' : ''}
${request.projectContext?.activeGoalSuccessMode === 'exploration' ? 'Focus on what was learned and explored, not commercial outcomes.' : ''}
${request.projectContext?.monetizationIntent === 'revenue-now' ? 'Prioritize revenue-related insights and conversion optimization.' : ''}

IMPORTANT: Reference specific offers, audience pain points, and business priorities from the context above. Connect performance to the actual business model and positioning.

Respond with JSON only:
{
  "weeklyFocus": "Strategic focus for next week based on business priorities",
  "insights": ["Key insight 1", "Key insight 2", "Key insight 3"],
  "recommendations": ["Specific action 1", "Specific action 2", "Specific action 3"],
  "nextWeekPlan": {
    "contentStrategy": "Content focus aligned with business positioning",
    "outreachStrategy": "Outreach approach for target audience",
    "metrics": "Metrics to prioritize"
  }
}`;

    // Use callClaudeWithContext for automatic Brand DNA + project + persona injection
    const raw = await callClaudeWithContext({
      userId: request.userId,
      projectId,
      userMessage: prompt,
      model: CLAUDE_MODELS.smart,
      max_tokens: 2000,
      additionalSystemContext: `You are a strategic business advisor who provides actionable insights based on performance data, project context, and goal mode. Always respond with valid JSON only.`,
    });

    return JSON.parse(stripMarkdownJSON(raw));
  } catch (error) {
    throw new Error("Failed to generate strategy insights: " + (error as Error).message);
  }
}

// Generate outreach messages with target persona awareness
export async function generateOutreachMessage(request: OutreachMessageRequest): Promise<{
  subject?: string;
  body: string;
  followUp: string;
  reasoning: string;
}> {
  try {
    const projectId = (request as any).projectId || request.projectContext?.projectId || null;

    const persuasionDrivers = request.personaContext?.targetPersonaPersuasionDrivers?.length
      ? `\nPersona Persuasion Drivers: ${request.personaContext.targetPersonaPersuasionDrivers.join(', ')}`
      : '';

    const prompt = `Generate a ${request.messageType} message for this lead:

Lead Information:
- Name: ${request.leadInfo.name}
- Platform: ${request.leadInfo.platform}
- Company: ${request.leadInfo.company || "Unknown"}
- Notes: ${request.leadInfo.notes || "None"}

Goal: ${request.goal}

${request.personaContext?.targetPersonaDecisionTriggers?.length
  ? `Lead's likely decision triggers: ${request.personaContext.targetPersonaDecisionTriggers.join(', ')}`
  : ''}

${persuasionDrivers}

${request.projectContext?.monetizationIntent === 'none' ? 'This is a non-commercial project — focus on genuine connection and value sharing, not sales.' : ''}

Create a personalized, authentic message that feels human. Avoid being pushy.

Respond with JSON:
{
  "subject": "Email subject (if email platform)",
  "body": "The outreach message",
  "followUp": "Follow-up if no response",
  "reasoning": "Why this approach resonates with this specific lead and their decision style"
}`;

    const raw = await callClaudeWithContext({
      userId: request.userId,
      projectId,
      userMessage: prompt,
      model: CLAUDE_MODELS.fast,
      max_tokens: 1500,
      additionalSystemContext: `You are an expert at authentic, relationship-based outreach that uses target persona psychology to craft messages that convert — while always feeling human and genuine. Always respond with valid JSON only.`,
    });

    return JSON.parse(stripMarkdownJSON(raw));
  } catch (error) {
    throw new Error("Failed to generate outreach message: " + (error as Error).message);
  }
}

// Classify a quick capture entry — includes emotional signals and behavioral insights
export async function classifyCapture(text: string): Promise<{
  type: 'task' | 'idea' | 'note' | 'reminder' | 'emotional_signal' | 'behavioral_insight' | 'unknown';
  summary: string;
  isActionable: boolean;
  linkedContext?: string; // extracted context e.g. "instagram_posting", "client_outreach"
}> {
  try {
    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      messages: [
        {
          role: "system",
          content: "You are a behavioral intelligence classifier for an independent builder productivity tool. Classify user input and return valid JSON only.",
        },
        {
          role: "user",
          content: `Classify this capture: "${text}"\n\nRespond with JSON:\n{"type": "task|idea|note|reminder|emotional_signal|behavioral_insight|unknown", "summary": "one short sentence (max 80 chars)", "isActionable": true|false, "linkedContext": "optional short context tag like instagram_posting or client_outreach or null"}\n\nRules:\n- task: a clear concrete action (e.g. "buy milk", "call client", "post on Instagram")\n- idea: a thought, concept, or creative possibility\n- reminder: time/event-based (contains a specific time, date, or "don't forget")\n- note: general information or observation\n- emotional_signal: the user is expressing how they *feel* (e.g. "I feel anxious about posting", "I'm exhausted today", "I don't want to")\n- behavioral_insight: the user is describing a pattern about how they *work* (e.g. "I always procrastinate on admin", "I work best in the morning", "I struggle to start")\n- isActionable: true only for task type that should create a board item\n- linkedContext: extract what the signal is about if clear (e.g. "visibility", "posting", "client_work"), else null`,
        },
      ],
      max_tokens: 150,
    });
    const result = JSON.parse(stripMarkdownJSON(raw));
    return {
      type: result.type || 'note',
      summary: result.summary || text.substring(0, 80),
      isActionable: result.isActionable ?? false,
      linkedContext: result.linkedContext || undefined,
    };
  } catch {
    // Rule-based fallback with emotional signal detection
    const lower = text.toLowerCase();
    const emotionalPhrases = ['i feel', "i'm feeling", "i feel like", "i don't feel like", "i can't bring myself", "i keep avoiding", "i always procrastinate", "i struggle with", 'exhausted', 'overwhelmed', 'anxious', 'uncomfortable', "don't want to", 'dreading'];
    const behaviorPhrases = ['i always', 'i never', 'i tend to', 'i work best', 'i find it hard', 'i notice i', 'i realize i', 'i keep'];
    if (emotionalPhrases.some(p => lower.includes(p))) {
      return { type: 'emotional_signal', summary: text.substring(0, 80), isActionable: false };
    }
    if (behaviorPhrases.some(p => lower.includes(p))) {
      return { type: 'behavioral_insight', summary: text.substring(0, 80), isActionable: false };
    }
    const actionVerbs = ['write', 'call', 'send', 'review', 'create', 'finish', 'follow up', 'draft', 'schedule', 'prepare', 'edit', 'post', 'reach out', 'reply', 'update', 'fix', 'build', 'buy', 'get', 'pick up'];
    const isAction = actionVerbs.some(v => lower.startsWith(v));
    const isIdea = lower.includes('idea') || lower.includes('what if');
    const isReminder = /\btomorrow\b|\bnext week\b|\bat \d/.test(lower);
    return { type: isAction ? 'task' : isIdea ? 'idea' : isReminder ? 'reminder' : 'note', summary: text.substring(0, 80), isActionable: isAction };
  }
}

// Generate an activation prompt for a task given user operating profile
export async function generateActivationPrompt(taskTitle: string, activationStyle?: string, avoidanceTriggers?: string[]): Promise<string | null> {
  try {
    const triggerContext = avoidanceTriggers?.length ? `User tends to avoid: ${avoidanceTriggers.join(', ')}.` : '';
    const styleContext = activationStyle ? `User's preferred activation style: ${activationStyle}.` : '';
    const raw = await callClaude({
      model: CLAUDE_MODELS.fast,
      messages: [
        {
          role: "system",
          content: "You generate gentle, practical activation prompts for independent builders. Be brief, warm, and human. Max 120 chars.",
        },
        {
          role: "user",
          content: `Task: "${taskTitle}"\n${triggerContext}\n${styleContext}\n\nWrite one short, gentle activation nudge to help the user start this task. Focus on the smallest concrete first step or a reframe that reduces friction. Respond with just the prompt text, no JSON, no quotes.`,
        },
      ],
      max_tokens: 60,
    });
    const prompt = raw?.trim();
    return prompt || null;
  } catch {
    return null;
  }
}

// ─── Monthly Planning Engine ──────────────────────────────────────────────────

export interface MonthlyPlanRequest {
  userId: string;
  brandDna: BrandDnaInput;
  projectContext: ProjectContext;
  goals: { title: string; description?: string; goalType: string; successMode: string; dueDate?: string }[];
  existingTaskCount: number;
  operatingProfileSummary?: string;
  targetMonth: { year: number; month: number }; // month is 1-indexed
  todayFloor: string; // YYYY-MM-DD — no task may be scheduled before this date
}

export interface MonthlyPlanTask {
  title: string;
  description: string;
  type: string;
  category: string;
  priority: number;
  estimatedDuration: number;
  taskEnergyType: string;
  setupCost: string;
  canBeFragmented: boolean;
  recommendedTimeOfDay: string;
  workflowGroup?: string;
  activationPrompt?: string;
  scheduledDate: string; // YYYY-MM-DD required for monthly plan
}

export interface MonthlyPlanResult {
  tasks: MonthlyPlanTask[];
  dependencies: { taskIndex: number; dependsOnIndex: number; relationType: string }[];
  workflowSuggestions: { label: string; taskIndexes: number[]; recommendedBlockMinutes: number }[];
  monthlyRationale: string;
}

export async function generateMonthlyPlan(request: MonthlyPlanRequest): Promise<MonthlyPlanResult> {
  const { brandDna, projectContext, goals, existingTaskCount, operatingProfileSummary, targetMonth, todayFloor } = request;
  const projectId = projectContext?.projectId || null;
  const monthLabel = new Date(targetMonth.year, targetMonth.month - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const goalsText = goals.length > 0
    ? goals.map(g => `- ${g.title} (${g.goalType} / ${g.successMode}${g.dueDate ? `, due ${g.dueDate}` : ''}): ${g.description || ''}`).join('\n')
    : 'No explicit goals defined — generate based on project type and stage.';

  const userPrompt = `Generate a monthly execution plan for ${monthLabel}.

⚠️ TODAY IS ${todayFloor}. Do NOT assign any task to a date before ${todayFloor}. Distribute tasks evenly from ${todayFloor} through the end of the month. Do not pile multiple tasks on a single day — aim for 3–5 tasks per working day.

ACTIVE GOALS:
${goalsText}

USER PROFILE:
${operatingProfileSummary || 'No operating profile available.'}
${brandDna.contentBandwidth ? `Content bandwidth: ${brandDna.contentBandwidth}` : ''}

EXISTING TASK COUNT FOR MONTH: ${existingTaskCount} tasks already exist this month. Generate additional tasks if < 15 total, or generate an enhanced plan.

TASK REQUIREMENTS:
Each task needs: title, description, type (content/outreach/admin/planning/execution), category, priority (1=highest, 5=lowest), estimatedDuration (minutes), taskEnergyType, setupCost (low/medium/high), canBeFragmented (boolean), recommendedTimeOfDay (morning/afternoon/evening/flexible), scheduledDate (YYYY-MM-DD), optionally workflowGroup and activationPrompt.
IMPORTANT: Every task MUST include "taskEnergyType" set to exactly one of: deep_work, creative, admin, social, logistics, execution. Leaving it null or omitting it is NOT allowed.

WORKFLOW BUNDLING:
Group 2–4 tasks that form a natural production chain into workflowSuggestions with recommendedBlockMinutes.

DEPENDENCIES:
Create dependency pairs for tasks that must follow others. Keep to max 5 dependency links.

Return JSON:
{
  "tasks": [...],
  "dependencies": [{ "taskIndex": N, "dependsOnIndex": M, "relationType": "blocked_by" }],
  "workflowSuggestions": [{ "label": "...", "taskIndexes": [...], "recommendedBlockMinutes": N }],
  "monthlyRationale": "2–3 sentence summary of the month's strategic focus and distribution logic"
}`;

  const raw = await callClaudeWithContext({
    userId: request.userId,
    projectId,
    userMessage: userPrompt,
    model: CLAUDE_MODELS.smart,
    max_tokens: 4000,
    additionalSystemContext: `You are Naya's Monthly Execution Engine. You design strategic execution roadmaps across a full month for independent builders and entrepreneurs.

CRITICAL SCHEDULING RULE: Today is ${todayFloor}. You MUST NOT schedule any task before ${todayFloor}. Tasks must be distributed starting from ${todayFloor} or later. Past dates are strictly forbidden.

Your monthly plans:
- Distribute work realistically across working days (Mon–Fri), leaving weekends light
- Respect workflow momentum — phases progress logically (research → draft → production → distribution)
- Spread tasks evenly across the remaining days of the month starting from ${todayFloor}; do not front-load onto a single day
- Limit deep_work tasks to max 1–2 per calendar day
- Limit total tasks per day to max 4–5 to avoid overloading any single day
- Build dependency chains for multi-step workflows — prerequisites must have earlier scheduledDate than dependents
- Generate 15–25 tasks total across the month
- Every task MUST have a scheduledDate (YYYY-MM-DD) on or after ${todayFloor} in ${monthLabel}

Always respond with valid JSON only.`,
  });

  const result = JSON.parse(stripMarkdownJSON(raw));
  return {
    tasks: result.tasks || [],
    dependencies: result.dependencies || [],
    workflowSuggestions: result.workflowSuggestions || [],
    monthlyRationale: result.monthlyRationale || '',
  };
}

// ─── Weekly Refinement Engine ─────────────────────────────────────────────────

export interface WeeklyRefinementRequest {
  userId: string;
  brandDna: BrandDnaInput;
  projectContext: ProjectContext;
  goals: { title: string; goalType: string; successMode: string }[];
  completedThisWeek: { id: number; title: string; type: string; category: string; scheduledDate?: string }[];
  incompleteThisWeek: { id: number; title: string; type: string; category: string; scheduledDate?: string; workflowGroup?: string }[];
  blockedChains: { taskId: number; taskTitle: string; blockedBy: string }[];
  operatingProfileSummary?: string;
  weekStart: string; // YYYY-MM-DD Monday
  weekEnd: string;   // YYYY-MM-DD Sunday
  todayFloor: string; // YYYY-MM-DD — no task may be scheduled before this date
}

export interface WeeklyRefinementResult {
  reschedules: { taskId: number; newDate: string }[];
  newTasks: MonthlyPlanTask[];
  weeklyRationale: string;
}

export async function generateWeeklyRefinement(request: WeeklyRefinementRequest): Promise<WeeklyRefinementResult> {
  const { brandDna, projectContext, goals, completedThisWeek, incompleteThisWeek, blockedChains, operatingProfileSummary, weekStart, weekEnd, todayFloor } = request;
  const projectId = projectContext?.projectId || null;

  const completionRate = completedThisWeek.length / Math.max(completedThisWeek.length + incompleteThisWeek.length, 1);
  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);

  const userPrompt = `Weekly refinement for week of ${weekStart} to ${weekEnd}.

⚠️ TODAY IS ${todayFloor}. All rescheduled tasks and new tasks MUST be on or after ${todayFloor}. Never assign to past dates.

COMPLETION RATE: ${Math.round(completionRate * 100)}% (${completedThisWeek.length} done, ${incompleteThisWeek.length} incomplete)

COMPLETED THIS WEEK:
${completedThisWeek.slice(0, 10).map(t => `- ${t.title} (${t.type}/${t.category})`).join('\n') || 'None'}

INCOMPLETE TASKS (need rescheduling):
${incompleteThisWeek.slice(0, 15).map(t => `- [ID:${t.id}] ${t.title} (${t.type}/${t.category}, was: ${t.scheduledDate || 'unscheduled'}${t.workflowGroup ? `, group: ${t.workflowGroup}` : ''})`).join('\n') || 'None'}

BLOCKED CHAINS:
${blockedChains.slice(0, 5).map(b => `- [ID:${b.taskId}] ${b.taskTitle} — blocked by: ${b.blockedBy}`).join('\n') || 'None'}

USER PROFILE: ${operatingProfileSummary || 'Not available'}

Available days from today: ${todayFloor} to ${weekEnd}
Next week available: Mon–Fri ${nextWeekStart.toISOString().split('T')[0]} to ${nextWeekEnd.toISOString().split('T')[0]}

Return JSON:
{
  "reschedules": [{ "taskId": N, "newDate": "YYYY-MM-DD" }],
  "newTasks": [...up to 3 tasks with all required fields including scheduledDate and taskEnergyType (must be one of: deep_work, creative, admin, social, logistics, execution)...],
  "weeklyRationale": "1–2 sentence summary of refinement decisions"
}`;

  const raw = await callClaudeWithContext({
    userId: request.userId,
    projectId,
    userMessage: userPrompt,
    model: CLAUDE_MODELS.smart,
    max_tokens: 2000,
    additionalSystemContext: `You are Naya's Weekly Refinement Engine. You analyse what happened in a week and intelligently rebalance the remaining work.

CRITICAL SCHEDULING RULE: Today is ${todayFloor}. You MUST NOT schedule any task before ${todayFloor}. Past dates are strictly forbidden.

Your priorities in order:
1. Finish in-progress workflow chains before starting new ones
2. Reschedule incomplete tasks to realistic future dates starting from ${todayFloor} (this week if capacity allows, next week otherwise)
3. Generate max 3 new fill-in tasks only where genuine gaps exist
4. Never overload any single day — max 4–5 tasks per day
5. Spread tasks evenly across available days from ${todayFloor} onward

Return rescheduled task IDs with their new date, and any new tasks. All dates must be on or after ${todayFloor}.

Always respond with valid JSON only.`,
  });

  const result = JSON.parse(stripMarkdownJSON(raw));
  return {
    reschedules: result.reschedules || [],
    newTasks: result.newTasks || [],
    weeklyRationale: result.weeklyRationale || '',
  };
}

export async function analyzeContentPerformance(contentData: any[], brandDna: BrandDnaInput, userId?: string): Promise<{
  insights: string[];
  recommendations: string[];
  bestPerformingTypes: string[];
}> {
  try {
    const prompt = `Analyze this content performance data:

Content Performance Data:
${JSON.stringify(contentData)}

Respond with JSON:
{
  "insights": ["Performance insight 1", "Performance insight 2", "Performance insight 3"],
  "recommendations": ["Specific recommendation 1", "Specific recommendation 2"],
  "bestPerformingTypes": ["Type 1", "Type 2"]
}`;

    let raw: string;
    if (userId) {
      raw = await callClaudeWithContext({
        userId,
        projectId: null,
        userMessage: prompt,
        model: CLAUDE_MODELS.fast,
        max_tokens: 1500,
        additionalSystemContext: `You are a content performance analyst who helps entrepreneurs optimize their content strategy based on data. Always respond with valid JSON only.`,
      });
    } else {
      // Fallback for when userId is not provided
      raw = await callClaude({
        model: CLAUDE_MODELS.fast,
        messages: [
          { role: "system", content: `You are a content performance analyst who helps entrepreneurs optimize their content strategy based on data. Always respond with valid JSON only.` },
          { role: "user", content: prompt },
        ],
        max_tokens: 1500,
      });
    }

    return JSON.parse(stripMarkdownJSON(raw));
  } catch (error) {
    throw new Error("Failed to analyze content performance: " + (error as Error).message);
  }
}

export interface CampaignPhase {
  number: number;
  name: string;
  duration: string;
  objective: string;
  keyActions: string[];
  successSignal: string;
}

export interface ChannelConfig {
  platform: string;
  role: string;
  frequency: string;
  contentFormat: string[];
  tone: string;
}

export interface ContentPiece {
  phase: number;
  week: string;
  platform: string;
  format: string;
  angle: string;
  pillar: string;
  goal: string;
  copyDirections: string;
}

export interface MessagingFramework {
  coreMessage: string;
  proofPoints: string[];
  primaryCTA: string;
  secondaryCTA: string;
  toneKeywords: string[];
  thingsToAvoid: string[];
}

export interface CampaignKPI {
  metric: string;
  target: string;
  howToMeasure: string;
  phase: number;
}

export interface CampaignGenerationRequest {
  userId: string;
  objective: string;
  duration: string;
  brandDna: BrandDnaInput & {
    businessName?: string;
    offers?: string;
    priceRange?: string;
    audienceAspiration?: string;
    editorialTerritory?: string;
    brandVoiceKeywords?: string[];
    brandVoiceAntiKeywords?: string[];
    activeBusinessPriority?: string;
    revenueTarget?: string;
  };
  weekContext?: string;
}

export interface GeneratedCampaignProspection {
  needed: true;
  rationale: string;         // pourquoi la prospection est nécessaire pour cet objectif
  targetSector: string;      // secteur/segment à cibler
  channel: string;           // linkedin | email | both
  digitalLevel: string;      // fort | faible | tous
  campaignBrief: string;     // proposition en une phrase
  messageAngle: string;      // angle aligné avec le coreMessage de la campagne
  buyingSignals: string;     // critères pour identifier un prospect prêt
  prospectsPerDay: number;   // 1-5 recommandé
  offer: string;             // offre concrète à proposer
}

export interface GeneratedCampaign {
  name: string;
  campaignType: string;
  coreMessage: string;
  targetAudience: string;
  audienceSegment: string;
  insights: string[];
  messagingFramework: MessagingFramework;
  phases: CampaignPhase[];
  channels: ChannelConfig[];
  contentPlan: ContentPiece[];
  kpis: CampaignKPI[];
  tasks: Array<{
    title: string;
    description: string;
    type: string;
    category: string;
    priority: number;
    estimatedDuration: number;
    taskEnergyType: string;
    phase: number;
  }>;
  prospection: GeneratedCampaignProspection | null;
}

function getDurationGuidance(duration: string): string {
  switch (duration) {
    case '1_week':
      return 'This is a sprint campaign. Generate 3 phases (prep, execution, follow-up). Focus on 1 channel. 5-6 tasks max. No complex multi-channel strategy.';
    case '2_weeks':
      return 'This is a short burst campaign. Generate 3 phases (foundation, push, close). Focus on 1-2 channels. 6-8 tasks.';
    case '3_weeks':
      return 'This is a focused campaign. Generate 3 phases (build, accelerate, convert). 2 channels. 7-9 tasks.';
    case '1_month':
      return 'This is a standard campaign. Generate 3 phases (foundation, acceleration, conversion). 2-3 channels. 8-12 tasks.';
    case '2_months':
      return 'This is an extended campaign. Generate 3-4 phases. 2-3 channels. 10-13 tasks.';
    case '3_months':
      return 'This is a quarter-long campaign. Generate 4 phases (foundation, credibility, acceleration, conversion). 3+ channels. 10-15 tasks.';
    case '6_months':
      return 'This is a long-form campaign. Generate 5-6 distinct phases. Each phase should have a different strategic focus (e.g. foundation → credibility → acceleration → conversion → retention → optimization). Tasks should be distributed across all phases. 3-4 channels. 12-15 tasks.';
    case '12_months':
      return 'This is a year-long campaign. Generate 6 phases spanning quarterly milestones. Each phase must be distinct and build on the previous one. 3-4 channels. 12-15 tasks distributed across all phases.';
    default:
      return 'Generate 3-4 phases appropriate for the duration.';
  }
}

export async function generateCampaign(request: CampaignGenerationRequest): Promise<GeneratedCampaign> {
  try {
    const projectId = (request as any).projectId || null;

    const prompt = `Generate a comprehensive, professional digital communication campaign — not a task list. Think like a strategic communications director who deeply understands this brand.

CAMPAIGN REQUEST:
- Objective: ${request.objective}
- Campaign type (inferred): identify whether this is lead_generation | authority_building | product_launch | nurturing | visibility | conversion
- Duration: ${request.duration}
${request.weekContext ? `- Context: ${request.weekContext}` : ''}

STRATEGIC RULES:
- Authority building campaigns require minimum 3 months. Never generate a 1-week authority campaign.
- Lead generation campaigns require minimum 2 months for sustainable results.
- A product launch campaign for a premium offer requires minimum 4 weeks of pre-launch + launch + post-launch.
- Each phase must be distinct and build on the previous one — not just a repeat at higher frequency.
- Content pieces must be specific to THIS brand's positioning — not generic best practices.
- Channel roles must reflect the brand's actual platform priority, not generic digital marketing.
- Tasks must be executable by a founder working alone or with a small team. No vague "create content" tasks.

DURATION GUIDANCE:
${getDurationGuidance(request.duration)}

Return ONLY a JSON object matching this exact structure (no preamble, no markdown):
{
  "name": "Campaign name — 5 words max, evocative",
  "campaignType": "lead_generation|authority_building|product_launch|nurturing|visibility|conversion",
  "coreMessage": "The single sentence this entire campaign communicates",
  "targetAudience": "Specific audience for this campaign",
  "audienceSegment": "The specific sub-segment being addressed (more granular than brand DNA audience)",
  "insights": ["3 strategic observations about why this approach fits this brand right now"],
  "messagingFramework": {
    "coreMessage": "Same as above but as a headline-ready statement",
    "proofPoints": ["3 credibility anchors"],
    "primaryCTA": "The main action",
    "secondaryCTA": "The lower-commitment entry point",
    "toneKeywords": ["5 voice descriptors specific to this campaign"],
    "thingsToAvoid": ["3 messaging traps that would dilute this campaign"]
  },
  "phases": [
    {
      "number": 1,
      "name": "Phase name",
      "duration": "Weeks 1-2",
      "objective": "What this phase achieves",
      "keyActions": ["3-5 specific actions"],
      "successSignal": "How you know this phase worked"
    }
  ],
  "channels": [
    {
      "platform": "linkedin",
      "role": "Primary",
      "frequency": "3x/week",
      "contentFormat": ["text post", "carousel"],
      "tone": "How voice adapts on this platform"
    }
  ],
  "contentPlan": [
    {
      "phase": 1,
      "week": "Week 1",
      "platform": "linkedin",
      "format": "carousel",
      "angle": "Specific hook/angle",
      "pillar": "Content pillar name",
      "goal": "visibility|trust|conversion|engagement",
      "copyDirections": "What the copy should say and feel like"
    }
  ],
  "kpis": [
    {
      "metric": "Specific measurable metric",
      "target": "Quantified target",
      "howToMeasure": "Where and how to check",
      "phase": 1
    }
  ],
  "tasks": [
    {
      "title": "Specific executable task",
      "description": "1-2 sentences: what exactly to do and why it matters in this campaign",
      "type": "content|outreach|admin|planning",
      "category": "trust|conversion|engagement|planning",
      "priority": 1,
      "estimatedDuration": 60,
      "taskEnergyType": "deep_work|creative|admin|social|execution",
      "phase": 1
    }
  ],
  "prospection": null
}

The "prospection" field rules:
- Set to null if objective is purely content/visibility/authority.
- Set to an object (nested inside the main JSON above) if objective involves acquiring clients, leads, or partners:
  {"needed": true, "rationale": "why needed", "targetSector": "sector/profile", "channel": "linkedin|email|both", "digitalLevel": "fort|faible|tous", "campaignBrief": "one sentence proposition", "messageAngle": "unique angle", "buyingSignals": "readiness criteria", "prospectsPerDay": 3, "offer": "concrete offer"}
The prospection value must be either null or an inline object — never a separate JSON block.

Generate the right number of phases for the duration. For a 1-month campaign: 3 phases. For 3 months: 4 phases. For 6 months: 5-6 phases.
Generate 2-4 content pieces per phase. Generate 8-15 tasks distributed across phases. Generate 3-5 KPIs.`;

    // Build focused brand context from brandDna parameter (avoids double-context via buildNayaContext)
    const bd = request.brandDna || {};
    const brandContext = `\n\nBRAND CONTEXT:
- Business type: ${bd.businessType || 'Independent'}
- Unique positioning: ${bd.uniquePositioning || ''}
- Target audience: ${bd.targetAudience || bd.audience || ''}
- Core pain point: ${bd.corePainPoint || ''}
- Communication style: ${bd.communicationStyle || 'Professional'}
- Platform priority: ${bd.platformPriority || ''}
- Offers: ${bd.offers || ''}${bd.revenueTarget ? `\n- Revenue target: ${bd.revenueTarget}` : ''}${bd.brandVoiceKeywords?.length ? `\n- Voice keywords: ${bd.brandVoiceKeywords.join(', ')}` : ''}${bd.editorialTerritory ? `\n- Editorial territory: ${bd.editorialTerritory}` : ''}${bd.activeBusinessPriority ? `\n- Active priority: ${bd.activeBusinessPriority}` : ''}`;

    const raw = await callClaude({
      model: CLAUDE_MODELS.smart,
      system: `You are Naya's campaign planning intelligence. You generate comprehensive, strategic campaign architectures for independent builders. Return ONLY valid JSON matching the exact structure requested. No preamble, no markdown fences, no text outside the JSON object.`,
      messages: [{ role: 'user', content: prompt + brandContext }],
      max_tokens: 8000,
    });
    let parsed: GeneratedCampaign;
    try {
      parsed = JSON.parse(stripMarkdownJSON(raw)) as GeneratedCampaign;
    } catch (parseError) {
      throw new Error("Failed to parse campaign JSON from AI response: " + (parseError as Error).message);
    }
    return parsed;
  } catch (error) {
    if ((error as Error).message.startsWith("Failed to parse campaign JSON")) {
      throw error;
    }
    throw new Error("Failed to generate campaign: " + (error as Error).message);
  }
}

export interface WeeklyBriefingInput {
  userId: string;
  brandDna: BrandDnaInput;
  projectSummaries: Array<{
    id?: number;
    name: string;
    type: string;
    priorityLevel: string;
    activeGoalTitle?: string;
    activeGoalSuccessMode?: string;
  }>;
  recentCompletedTasks: Array<{ title: string; type: string; category: string; completedAt?: string }>;
  recentIncompleteTasks: Array<{ title: string; type: string; scheduledDate?: string }>;
  activeCampaigns: Array<{ name: string; status: string; startDate?: string; endDate?: string }>;
  operatingProfileSummary?: string;
}

export interface WeeklyBriefingResult {
  strategicFocus: string;
  doingWell: string[];
  risks: string[];
  recommendedMoves: Array<{
    title: string;
    description: string;
    type: string;
    category: string;
    priority: number;
    estimatedDuration: number;
  }>;
  energyNote: string;
}

export async function generateWeeklyBriefing(input: WeeklyBriefingInput): Promise<WeeklyBriefingResult> {
  try {
    const projectId = input.projectSummaries.length > 0 ? input.projectSummaries[0]?.id || null : null;

    const projectBlock = input.projectSummaries.length > 0
      ? input.projectSummaries.map(p =>
        `- ${p.name} (${p.type}, ${p.priorityLevel})${p.activeGoalTitle ? ` — Goal: ${p.activeGoalTitle} (${p.activeGoalSuccessMode})` : ''}`
      ).join('\n')
      : 'No active projects';

    const completedBlock = input.recentCompletedTasks.length > 0
      ? input.recentCompletedTasks.slice(0, 20).map(t => `- [${t.type}/${t.category}] ${t.title}`).join('\n')
      : 'No tasks completed recently';

    const overdueBlock = input.recentIncompleteTasks.length > 0
      ? input.recentIncompleteTasks.slice(0, 10).map(t => `- ${t.title} (scheduled: ${t.scheduledDate || 'unscheduled'})`).join('\n')
      : 'No overdue tasks';

    const campaignBlock = input.activeCampaigns.length > 0
      ? input.activeCampaigns.map(c => `- ${c.name} (${c.status}, ${c.startDate || '?'} → ${c.endDate || '?'})`).join('\n')
      : 'No active campaigns';

    const prompt = `Generate a Weekly Intelligence Briefing — a calm, strategic overview of where this founder stands this week.

ACTIVE PROJECTS:
${projectBlock}

TASKS COMPLETED (last 14 days):
${completedBlock}

OVERDUE / INCOMPLETE TASKS:
${overdueBlock}

ACTIVE CAMPAIGNS:
${campaignBlock}

${input.operatingProfileSummary ? `USER PROFILE: ${input.operatingProfileSummary}` : ''}

RULES:
- Tone: calm, intelligent partner. Not a productivity coach. Not urgent. Not preachy.
- strategicFocus: one clear sentence about the primary leverage point this week
- doingWell: 2-3 specific observations based on the completed task patterns (not generic praise)
- risks: 1-2 specific flags based on gaps in activity, overdue tasks, or campaign timing. If nothing is at risk, say so calmly.
- recommendedMoves: exactly 3 specific, actionable tasks the user should consider adding to their plan. Each must have title, description, type, category, priority (1-3), and estimatedDuration (minutes).
- energyNote: a brief adaptive note (1-2 sentences) that feels human and supportive, not robotic

Return JSON only:
{
  "strategicFocus": "This week, your primary leverage is...",
  "doingWell": ["observation 1", "observation 2"],
  "risks": ["risk flag 1"],
  "recommendedMoves": [
    {
      "title": "Specific action",
      "description": "Why and how",
      "type": "content|outreach|admin|planning",
      "category": "trust|conversion|engagement|planning",
      "priority": 1,
      "estimatedDuration": 45
    }
  ],
  "energyNote": "A brief supportive note..."
}`;

    const raw = await callClaudeWithContext({
      userId: input.userId,
      projectId,
      userMessage: prompt,
      model: CLAUDE_MODELS.smart,
      max_tokens: 3000,
      additionalSystemContext: `You are Naya's strategic intelligence layer. You speak like a brilliant strategic advisor who knows the person deeply — their strengths, their tendencies, and their blind spots. You observe patterns in a founder's work and deliver calm, actionable weekly briefings. Never generic — always grounded in the specific data provided. Always respond with valid JSON only.`,
    });

    const result = JSON.parse(stripMarkdownJSON(raw));
    return {
      strategicFocus: result.strategicFocus || "Focus on your highest-leverage activity this week.",
      doingWell: result.doingWell || [],
      risks: result.risks || [],
      recommendedMoves: (result.recommendedMoves || []).slice(0, 3),
      energyNote: result.energyNote || "",
    };
  } catch (error) {
    throw new Error("Failed to generate weekly briefing: " + (error as Error).message);
  }
}
