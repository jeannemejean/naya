// Intelligent fallback task generation when AI service is unavailable
import type { BrandDnaInput } from "./openai";

interface FallbackTask {
  title: string;
  description: string;
  type: string;
  category: string;
  priority: number;
}

export function generateFallbackTasks(brandDna: BrandDnaInput): {
  focus: string;
  reasoning: string;
  tasks: FallbackTask[];
} {
  const tasks: FallbackTask[] = [];
  
  // Strategic task generation based on business type and goals
  const businessType = brandDna.businessType?.toLowerCase() || "";
  const revenueUrgency = brandDna.revenueUrgency?.toLowerCase() || "";
  const primaryGoal = brandDna.primaryGoal || "";
  const platformPriority = brandDna.platformPriority?.toLowerCase() || "";
  
  // High-impact tasks based on revenue urgency
  if (revenueUrgency.includes("immediate") || revenueUrgency.includes("urgent")) {
    tasks.push({
      title: "Reach out to 3 warm prospects",
      description: "Focus on immediate revenue opportunities by connecting with potential clients who already know you.",
      type: "outreach",
      category: "conversion",
      priority: 5
    });
    
    tasks.push({
      title: "Create conversion-focused content",
      description: "Share content that showcases your results and includes a clear call-to-action for your services.",
      type: "content",
      category: "conversion", 
      priority: 4
    });
  } else {
    // Trust and visibility building for longer-term goals
    tasks.push({
      title: "Share valuable insight from your expertise",
      description: "Create content that demonstrates your knowledge and helps your audience solve a problem.",
      type: "content",
      category: "trust",
      priority: 4
    });
  }
  
  // Platform-specific tasks
  if (platformPriority.includes("linkedin")) {
    tasks.push({
      title: "Engage meaningfully on LinkedIn",
      description: "Comment thoughtfully on 5 posts from your ideal clients or industry leaders.",
      type: "outreach",
      category: "engagement",
      priority: 3
    });
  } else if (platformPriority.includes("twitter") || platformPriority.includes("x")) {
    tasks.push({
      title: "Join relevant Twitter conversations",
      description: "Find and contribute to discussions in your industry with valuable insights.",
      type: "outreach", 
      category: "engagement",
      priority: 3
    });
  } else {
    tasks.push({
      title: "Engage on your priority platform",
      description: `Connect with your audience on ${brandDna.platformPriority} through meaningful interactions.`,
      type: "outreach",
      category: "engagement", 
      priority: 3
    });
  }
  
  // Business-type specific tasks
  if (businessType.includes("coach") || businessType.includes("consultant")) {
    tasks.push({
      title: "Follow up with recent prospects",
      description: "Check in with people who showed interest in your services in the past week.",
      type: "outreach",
      category: "conversion",
      priority: 3
    });
  } else if (businessType.includes("course") || businessType.includes("digital")) {
    tasks.push({
      title: "Optimize your sales funnel",
      description: "Review and improve one element of your customer journey (landing page, email sequence, etc.).",
      type: "admin",
      category: "conversion",
      priority: 3
    });
  }
  
  // Always include planning task
  tasks.push({
    title: "Plan tomorrow's strategic focus",
    description: "Review today's progress and set intentions for tomorrow based on your 90-day goal.",
    type: "planning",
    category: "planning",
    priority: 2
  });
  
  // Determine focus based on tasks
  let focus = "Strategic Growth Actions";
  if (revenueUrgency.includes("immediate")) {
    focus = "Revenue Generation & Conversion";
  } else if (businessType.includes("new") || businessType.includes("startup")) {
    focus = "Foundation Building & Visibility";
  }
  
  const reasoning = `Based on your ${businessType} business with ${revenueUrgency} revenue needs, focusing on ${focus.toLowerCase()} will best serve your 90-day goal: ${primaryGoal}.`;
  
  return {
    focus,
    reasoning,
    tasks: tasks.slice(0, 4) // Limit to 4 tasks
  };
}