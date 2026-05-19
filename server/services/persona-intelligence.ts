import { storage } from "../storage";
import type { BrandDna, InsertUserPersona, InsertTargetPersona, InsertPersonaAnalysisResult } from "@shared/schema";

// ─── Persona Knowledge Library ───────────────────────────────────────────────

export const USER_PERSONA_ARCHETYPES: InsertUserPersona[] = [
  {
    name: "Strategist",
    description: "Thinks in systems, frameworks, and long-term positioning. Values clarity and high-level direction over tactical details.",
    behaviorTraits: [
      "Plans several moves ahead",
      "Comfortable with ambiguity but needs a framework to work within",
      "Prefers strategic options over prescriptive checklists",
      "Asks 'why' before 'how'",
      "Communicates in positioning and narrative"
    ],
    decisionStyle: "Top-down: starts with vision, breaks into phases, delegates or assigns execution",
    preferredOutputStyle: "Strategic frameworks, positioning maps, phased roadmaps, and insight-led analysis with reasoning"
  },
  {
    name: "Builder",
    description: "Execution-first, thrives on shipping, building systems, and seeing progress. Needs clear next steps and immediate wins.",
    behaviorTraits: [
      "Bias for action and momentum",
      "Finds detailed checklists motivating, not restrictive",
      "Measures success by output and completion rates",
      "Gets energized by shipping, not planning",
      "Prefers direct, no-fluff communication"
    ],
    decisionStyle: "Bottom-up: identifies what needs to be done today and builds upward from execution",
    preferredOutputStyle: "Actionable checklists, step-by-step instructions, immediate next actions, and concrete timelines"
  },
  {
    name: "Creative",
    description: "Story-driven, audience-first thinker. Builds through authentic expression and genuine connection rather than conversion logic.",
    behaviorTraits: [
      "Thinks in narratives and visual metaphors",
      "Highly attuned to audience emotion and energy",
      "Resists anything that feels 'salesy' or inauthentic",
      "Creates from personal experience and perspective",
      "Drawn to resonance over reach"
    ],
    decisionStyle: "Intuition-led: makes decisions based on what feels authentic and resonant with their audience",
    preferredOutputStyle: "Story angles, authentic content hooks, connection-focused messaging, and resonance-driven strategies"
  },
  {
    name: "Analytical",
    description: "Data-driven decision maker. Needs evidence, metrics, and structured reasoning before committing to a direction.",
    behaviorTraits: [
      "Always asks for data before making decisions",
      "Builds systems to track and measure everything",
      "Prefers proven approaches over experimental ones",
      "Communicates in structured, evidence-backed arguments",
      "Identifies patterns and anomalies quickly"
    ],
    decisionStyle: "Evidence-based: collects data, identifies patterns, models outcomes before acting",
    preferredOutputStyle: "Data-backed insights, performance comparisons, metric-framed recommendations, and structured analysis"
  }
];

export const TARGET_PERSONA_LIBRARY = [
  {
    name: "CMO / VP Marketing",
    industry: "Corporate / Enterprise",
    jobTitle: "CMO or VP of Marketing",
    companySize: "100-5000+ employees",
    motivations: ["Brand equity growth", "Measurable ROI on marketing spend", "Team performance and alignment", "Staying ahead of trends"],
    frustrations: ["Fragmented tools and data silos", "Proving marketing ROI to the C-suite", "Agency work that lacks strategic depth", "Vendors who don't understand their industry"],
    decisionTriggers: ["Strong case studies from similar companies", "Clear ROI projections", "Executive-level credibility", "Peer recommendations"],
    persuasionDrivers: ["Strategic authority", "Data and proof points", "Industry credibility", "Reduced risk narrative"],
    preferredChannels: ["LinkedIn", "Email", "Industry events", "Executive briefings"]
  },
  {
    name: "Startup Founder",
    industry: "Tech / SaaS / Consumer",
    jobTitle: "Founder or Co-Founder",
    companySize: "1-50 employees",
    motivations: ["Rapid traction and growth", "Finding product-market fit", "Building a fundable story", "Proving the model works"],
    frustrations: ["Limited time and budget", "Too many tools promising too much", "Unclear direction on what to prioritize", "Slow vendors and agencies"],
    decisionTriggers: ["Speed to value", "Low financial risk", "Founders who've been in their shoes", "Quick, tangible results"],
    persuasionDrivers: ["Speed and simplicity", "Founder empathy", "Immediate impact", "Lean/efficient framing"],
    preferredChannels: ["Twitter/X", "LinkedIn", "Slack communities", "Direct referrals"]
  },
  {
    name: "Head of Marketing",
    industry: "Mid-market B2B",
    jobTitle: "Head of Marketing or Marketing Manager",
    companySize: "20-200 employees",
    motivations: ["Hitting pipeline and lead generation targets", "Building scalable content systems", "Proving department value internally"],
    frustrations: ["Small team with big expectations", "Keeping up with algorithm changes", "Getting budget approved", "Content that doesn't convert"],
    decisionTriggers: ["Demonstrated expertise in their niche", "Templates and processes they can steal", "Peer validation", "Specific platform expertise"],
    persuasionDrivers: ["Efficiency and leverage", "Proven playbooks", "Team productivity narrative", "Reduction of complexity"],
    preferredChannels: ["LinkedIn", "Email newsletters", "Marketing podcasts", "Slack communities"]
  },
  {
    name: "Communication Director",
    industry: "Corporate / Nonprofit / Public sector",
    jobTitle: "Director of Communications or PR Manager",
    companySize: "50-500 employees",
    motivations: ["Brand reputation and narrative control", "Media coverage and visibility", "Stakeholder alignment", "Crisis prevention"],
    frustrations: ["Being left out of strategic decisions", "Reactive rather than proactive PR", "Measuring the impact of communications", "Inconsistent brand voice"],
    decisionTriggers: ["Reputation and track record", "Sensitivity and discretion", "Strategic communications expertise", "Long-term relationship potential"],
    persuasionDrivers: ["Credibility and trust", "Reputation management narrative", "Stakeholder empathy", "Proven strategic approach"],
    preferredChannels: ["Email", "LinkedIn", "Industry associations", "Direct referrals"]
  },
  {
    name: "Small Business Owner",
    industry: "Services / Retail / Local",
    jobTitle: "Business Owner or Operator",
    companySize: "1-20 employees",
    motivations: ["Consistent client pipeline", "Building something that lasts", "Work-life balance while growing", "Being seen as the expert in their area"],
    frustrations: ["Wearing too many hats", "Marketing feels overwhelming and time-consuming", "Not knowing where to focus", "Seeing competitors grow faster"],
    decisionTriggers: ["Simple, clear value proposition", "No long contracts", "Local or niche credibility", "Testimonials from similar businesses"],
    persuasionDrivers: ["Simplicity and time-savings", "Local/niche relevance", "Personal relationship", "Visible quick wins"],
    preferredChannels: ["Facebook", "Instagram", "Email", "Local networks"]
  },
  {
    name: "Solopreneur / Freelancer",
    industry: "Creative / Consulting / Digital services",
    jobTitle: "Independent professional",
    companySize: "1 (solo)",
    motivations: ["Freedom and autonomy", "Consistent income without burnout", "Building a reputation that attracts inbound", "Working with ideal clients"],
    frustrations: ["Feast-or-famine client cycles", "Undercharging and scope creep", "Feeling isolated in decision-making", "Doing everything themselves"],
    decisionTriggers: ["Peer testimonials from solo operators", "Tools that free up time", "Genuine understanding of solo challenges", "Affordable or ROI-justified pricing"],
    persuasionDrivers: ["Freedom and independence narrative", "Income stability", "Time leverage", "Community and belonging"],
    preferredChannels: ["LinkedIn", "Instagram", "Twitter/X", "Email newsletters", "Online communities"]
  },
  {
    name: "Creative Professional",
    industry: "Design / Film / Music / Art / Writing",
    jobTitle: "Designer, Artist, Writer, Filmmaker, or creative director",
    companySize: "1-10 people",
    motivations: ["Creative recognition and visibility", "Building a body of work that means something", "Sustainable income from creative practice", "Collaborating with inspiring people"],
    frustrations: ["Business and marketing feeling incompatible with creativity", "Being undervalued or underpaid for creative work", "Platforms that don't reward quality work", "Having to self-promote"],
    decisionTriggers: ["Aesthetic alignment and taste", "Community reputation", "Portfolio-fit evidence", "Authentic brand that resonates"],
    persuasionDrivers: ["Creative dignity", "Aesthetic quality", "Cultural alignment", "Authentic expression over marketing logic"],
    preferredChannels: ["Instagram", "Behance/Dribbble", "LinkedIn", "YouTube", "Podcasts in their niche"]
  },
  {
    name: "Corporate Executive",
    industry: "Finance / Legal / Healthcare / Enterprise",
    jobTitle: "C-Suite or Senior VP",
    companySize: "500+ employees",
    motivations: ["Organizational performance", "Personal and professional legacy", "Board-level credibility", "Staying ahead of industry disruption"],
    frustrations: ["Information overload with no signal", "Vendors who waste their time", "Lack of strategic depth in proposals", "Anything that feels like a pitch"],
    decisionTriggers: ["Executive-level access and conversation", "Independent research and credibility", "Peer network validation", "Demonstrable track record"],
    persuasionDrivers: ["Peer-level positioning", "Strategic ROI framing", "Time respect and brevity", "Exclusive access narrative"],
    preferredChannels: ["LinkedIn", "Email (brief)", "Speaking engagements", "Trusted peer referrals"]
  }
];

// ─── User Persona Detection ───────────────────────────────────────────────────

export interface UserPersonaDetectionResult {
  personaName: string;
  confidence: number;
  reasoning: string;
  outputStyleGuidelines: string;
}

export function detectUserPersona(brandDna: Partial<BrandDna>): UserPersonaDetectionResult {
  const scores = { Strategist: 0, Builder: 0, Creative: 0, Analytical: 0 };

  // Communication style signals
  const commStyle = (brandDna.communicationStyle || "").toLowerCase();
  if (commStyle.includes("professional") || commStyle.includes("authoritative") || commStyle.includes("thought leader")) {
    scores.Strategist += 2;
  }
  if (commStyle.includes("direct") || commStyle.includes("actionable") || commStyle.includes("practical")) {
    scores.Builder += 2;
  }
  if (commStyle.includes("story") || commStyle.includes("authentic") || commStyle.includes("personal") || commStyle.includes("creative")) {
    scores.Creative += 2;
  }
  if (commStyle.includes("data") || commStyle.includes("analytical") || commStyle.includes("research")) {
    scores.Analytical += 2;
  }

  // Business type signals
  const bizType = (brandDna.businessType || "").toLowerCase();
  if (bizType.includes("consulting") || bizType.includes("advisory") || bizType.includes("strategy")) {
    scores.Strategist += 2;
  }
  if (bizType.includes("agency") || bizType.includes("service") || bizType.includes("development") || bizType.includes("build")) {
    scores.Builder += 2;
  }
  if (bizType.includes("content") || bizType.includes("creator") || bizType.includes("personal brand") || bizType.includes("coach")) {
    scores.Creative += 2;
  }
  if (bizType.includes("saas") || bizType.includes("data") || bizType.includes("analytics") || bizType.includes("research")) {
    scores.Analytical += 2;
  }

  // Revenue urgency signals — Builders and Strategists tend to have higher urgency
  const urgency = (brandDna.revenueUrgency || "").toLowerCase();
  if (urgency.includes("asap") || urgency.includes("need") || urgency.includes("critical")) {
    scores.Builder += 2;
  }
  if (urgency.includes("stable") || urgency.includes("scale") || urgency.includes("long")) {
    scores.Strategist += 1;
  }

  // Authority level signals
  const authority = (brandDna.authorityLevel || "").toLowerCase();
  if (authority.includes("thought") || authority.includes("visionary") || authority.includes("expert")) {
    scores.Strategist += 1;
  }

  // Success definition signals
  const success = (brandDna.successDefinition || "").toLowerCase();
  if (success.includes("revenue") || success.includes("clients") || success.includes("sales")) {
    scores.Builder += 1;
  }
  if (success.includes("impact") || success.includes("influence") || success.includes("brand")) {
    scores.Strategist += 1;
  }
  if (success.includes("community") || success.includes("audience") || success.includes("followers")) {
    scores.Creative += 1;
  }
  if (success.includes("data") || success.includes("metrics") || success.includes("numbers") || success.includes("measurable")) {
    scores.Analytical += 1;
  }

  // Determine winner
  const maxScore = Math.max(...Object.values(scores));
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const winner = (Object.entries(scores) as [keyof typeof scores, number][])
    .find(([_, v]) => v === maxScore)?.[0] || "Builder";

  const confidence = totalScore > 0 ? Math.round((maxScore / totalScore) * 100) : 50;

  const archetype = USER_PERSONA_ARCHETYPES.find(p => p.name === winner)!;

  return {
    personaName: winner,
    confidence: Math.min(confidence, 95),
    reasoning: `Based on your ${bizType || 'business'} focus and ${commStyle || 'communication'} style, you show strong ${winner} characteristics: ${archetype.behaviorTraits.slice(0, 2).join(' and ')}.`,
    outputStyleGuidelines: archetype.preferredOutputStyle
  };
}

// ─── Target Persona Analyzer ─────────────────────────────────────────────────

export interface TargetPersonaProfile {
  name: string;
  industry: string;
  jobTitle: string;
  companySize: string;
  motivations: string[];
  frustrations: string[];
  decisionTriggers: string[];
  persuasionDrivers: string[];
  preferredChannels: string[];
  messagingApproach: string;
}

export function analyzeTargetPersona(
  targetAudience: string,
  corePainPoint: string,
  audienceAspiration: string,
  projectContext?: { type?: string; monetizationIntent?: string }
): TargetPersonaProfile {
  const audienceLower = (targetAudience || "").toLowerCase();
  const painLower = (corePainPoint || "").toLowerCase();
  const aspirationLower = (audienceAspiration || "").toLowerCase();

  // Find best matching library persona
  let bestMatch = TARGET_PERSONA_LIBRARY[1]; // default to Startup Founder
  let bestScore = 0;

  for (const persona of TARGET_PERSONA_LIBRARY) {
    let score = 0;
    const nameLower = persona.name.toLowerCase();
    const titleLower = persona.jobTitle.toLowerCase();

    // Direct keyword matching
    if (audienceLower.includes("cmo") || audienceLower.includes("vp marketing") || audienceLower.includes("marketing executive")) {
      if (nameLower.includes("cmo")) score += 5;
    }
    if (audienceLower.includes("founder") || audienceLower.includes("startup") || audienceLower.includes("entrepreneur")) {
      if (nameLower.includes("founder") || nameLower.includes("startup")) score += 5;
    }
    if (audienceLower.includes("freelancer") || audienceLower.includes("solopreneur") || audienceLower.includes("independent")) {
      if (nameLower.includes("solo") || nameLower.includes("freelance")) score += 5;
    }
    if (audienceLower.includes("small business") || audienceLower.includes("local business")) {
      if (nameLower.includes("small business")) score += 5;
    }
    if (audienceLower.includes("creative") || audienceLower.includes("designer") || audienceLower.includes("artist")) {
      if (nameLower.includes("creative")) score += 5;
    }
    if (audienceLower.includes("executive") || audienceLower.includes("c-suite") || audienceLower.includes("director")) {
      if (nameLower.includes("executive") || nameLower.includes("director")) score += 3;
    }

    // Pain point matching
    for (const frustration of persona.frustrations) {
      if (painLower.includes(frustration.toLowerCase().substring(0, 15))) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = persona;
    }
  }

  // Enrich with context
  const channels = [...bestMatch.preferredChannels];
  if (projectContext?.monetizationIntent === 'none' || projectContext?.type === 'Passion Project') {
    // For passion projects, messaging is softer
  }

  const messagingApproach = buildMessagingApproach(bestMatch, corePainPoint, audienceAspiration, projectContext);

  return {
    name: bestMatch.name,
    industry: bestMatch.industry,
    jobTitle: bestMatch.jobTitle,
    companySize: bestMatch.companySize,
    motivations: bestMatch.motivations,
    frustrations: [corePainPoint, ...bestMatch.frustrations.slice(0, 3)].filter(Boolean),
    decisionTriggers: bestMatch.decisionTriggers,
    persuasionDrivers: bestMatch.persuasionDrivers,
    preferredChannels: channels,
    messagingApproach
  };
}

function buildMessagingApproach(
  persona: typeof TARGET_PERSONA_LIBRARY[0],
  corePainPoint: string,
  aspiration: string,
  projectContext?: { type?: string; monetizationIntent?: string }
): string {
  const isCommercial = projectContext?.monetizationIntent === 'revenue-now';
  const isPassion = projectContext?.monetizationIntent === 'none' || projectContext?.type === 'Passion Project';

  if (isPassion) {
    return `Open with shared values and genuine curiosity. Avoid any sales-oriented framing. Focus on connection and community. Lead with "${aspiration || 'shared goals'}" as the common ground.`;
  }

  const primaryDriver = persona.persuasionDrivers[0] || "credibility";
  const primaryTrigger = persona.decisionTriggers[0] || "proof of results";

  if (isCommercial) {
    return `Lead with their pain: "${corePainPoint || persona.frustrations[0]}". Establish credibility through ${primaryDriver}. Move to a clear outcome they desire: "${aspiration}". Close with ${primaryTrigger}.`;
  }

  return `Start by acknowledging their world. Build trust through ${primaryDriver}. Bridge to how your approach helps them achieve "${aspiration || 'their goals'}". Let ${primaryTrigger} do the final conversion work.`;
}

// ─── Persona Matching Engine ─────────────────────────────────────────────────

export interface PersonaStrategyMatch {
  strategyType: string;
  strategyLabel: string;
  messagingFramework: string;
  toneGuidelines: string;
  contentFormats: string[];
  urgencyLevel: string;
  reasoning: string;
}

export function matchPersonaStrategy(
  userPersonaName: string,
  targetPersonaName: string,
  projectType: string,
  monetizationIntent: string,
  goalSuccessMode: string
): PersonaStrategyMatch {
  const isRevenueGoal = goalSuccessMode === 'revenue' || monetizationIntent === 'revenue-now';
  const isExploration = goalSuccessMode === 'exploration' || monetizationIntent === 'none';
  const isVisibility = goalSuccessMode === 'visibility' || monetizationIntent === 'authority-building';

  // Strategy matrix
  const matrix: Record<string, Record<string, string>> = {
    Strategist: {
      "CMO / VP Marketing": "Executive Authority Framework",
      "Startup Founder": "Strategic Partnership Positioning",
      "Head of Marketing": "Strategic Advisor Positioning",
      "Communication Director": "Reputation Strategy Framework",
      "Small Business Owner": "Expert Mentorship Model",
      "Solopreneur / Freelancer": "Peer Strategist Approach",
      "Creative Professional": "Creative Direction Framework",
      "Corporate Executive": "Executive Peer Positioning",
      "default": "Strategic Thought Leadership"
    },
    Builder: {
      "CMO / VP Marketing": "Results-Driven Execution Proof",
      "Startup Founder": "Execution-First Partnership",
      "Head of Marketing": "Systems Builder Approach",
      "Communication Director": "Process-Driven Credibility",
      "Small Business Owner": "Done-For-You Execution",
      "Solopreneur / Freelancer": "Peer Builder Framework",
      "Creative Professional": "Creative Production Partnership",
      "Corporate Executive": "Operational Excellence Proof",
      "default": "Execution-First Positioning"
    },
    Creative: {
      "CMO / VP Marketing": "Brand Story Authority",
      "Startup Founder": "Authentic Founder Narrative",
      "Head of Marketing": "Creative Content Leadership",
      "Communication Director": "Narrative Communications",
      "Small Business Owner": "Human Brand Connection",
      "Solopreneur / Freelancer": "Authentic Peer Connection",
      "Creative Professional": "Creative Community Belonging",
      "Corporate Executive": "Strategic Storytelling",
      "default": "Authentic Story Sharing"
    },
    Analytical: {
      "CMO / VP Marketing": "Data-Backed Marketing Intelligence",
      "Startup Founder": "Evidence-Based Growth Framework",
      "Head of Marketing": "Performance Marketing Intelligence",
      "Communication Director": "Measurement-Led Communications",
      "Small Business Owner": "Proven Results Framework",
      "Solopreneur / Freelancer": "Performance-Driven Peer Approach",
      "Creative Professional": "Creative ROI Analysis",
      "Corporate Executive": "Executive Intelligence Briefing",
      "default": "Data-Driven Strategic Approach"
    }
  };

  const userMatrix = matrix[userPersonaName] || matrix.Builder;
  const strategyType = userMatrix[targetPersonaName] || userMatrix.default;

  // Messaging framework based on goal mode
  let messagingFramework = "";
  let urgencyLevel = "medium";
  let toneGuidelines = "";

  if (isRevenueGoal) {
    messagingFramework = "Problem → Credibility → Outcome → Clear CTA";
    urgencyLevel = "high";
    toneGuidelines = "Direct, confident, outcome-focused. Use specific numbers and timeframes. Avoid hedging language.";
  } else if (isExploration) {
    messagingFramework = "Shared Values → Curiosity → Connection → Open Invitation";
    urgencyLevel = "low";
    toneGuidelines = "Warm, curious, non-commercial. Focus on discovery and dialogue. No hard CTAs.";
  } else if (isVisibility) {
    messagingFramework = "Insight → Perspective → Value → Soft Invitation";
    urgencyLevel = "low-medium";
    toneGuidelines = "Thoughtful, authoritative but approachable. Lead with insights. CTAs focused on conversation, not conversion.";
  } else {
    messagingFramework = "Empathy → Expertise → Evidence → Invitation";
    urgencyLevel = "medium";
    toneGuidelines = "Balanced — human but professional. Mix personal stories with strategic insight.";
  }

  // Content formats based on user persona
  const contentFormats: Record<string, string[]> = {
    Strategist: ["Long-form articles", "Strategic frameworks", "Thought leadership posts", "Insight threads"],
    Builder: ["Step-by-step guides", "Behind-the-scenes process", "Quick win posts", "Execution checklists"],
    Creative: ["Story-driven posts", "Personal narratives", "Visual content", "Behind-the-scenes moments"],
    Analytical: ["Data breakdowns", "Research-backed posts", "Comparison analyses", "Performance case studies"]
  };

  return {
    strategyType,
    strategyLabel: `${userPersonaName} × ${targetPersonaName}`,
    messagingFramework,
    toneGuidelines,
    contentFormats: contentFormats[userPersonaName] || contentFormats.Builder,
    urgencyLevel,
    reasoning: `Your ${userPersonaName} approach combined with targeting ${targetPersonaName}, in a ${goalSuccessMode} goal phase, calls for the "${strategyType}" strategy. ${isRevenueGoal ? 'Revenue urgency means direct, conversion-focused messaging.' : isExploration ? 'Exploration mode means zero commercial pressure — build connection first.' : 'Focus on building authority and trust before conversion.'}`
  };
}

// ─── Seed Function ────────────────────────────────────────────────────────────

export async function seedUserPersonaArchetypes(): Promise<void> {
  try {
    const existing = await storage.getUserPersonaArchetypes();
    if (existing.length >= 4) return; // Already seeded
    
    for (const archetype of USER_PERSONA_ARCHETYPES) {
      await storage.upsertUserPersona(archetype);
    }
    console.log("[persona] Seeded 4 user persona archetypes");
  } catch (err) {
    console.error("[persona] Failed to seed archetypes:", err);
  }
}
