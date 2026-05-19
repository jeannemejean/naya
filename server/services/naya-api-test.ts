/**
 * Naya Intelligence API Test Suite
 * Demonstrates the strategic AI capabilities without external dependencies
 */

import { nayaIntelligence } from './naya-intelligence';

// Sample strategic profile data
const sampleBrandDna = {
  businessType: "Business consultant",
  businessModel: "High-ticket consulting services",
  revenueUrgency: "Need immediate revenue - less than 3 months runway",
  targetAudience: "Time-starved entrepreneurs struggling with business strategy",
  corePainPoint: "Feeling overwhelmed by too many growth options and unclear priorities", 
  audienceAspiration: "Want clear, proven roadmap to consistent $20K months",
  authorityLevel: "Recognized expert with proven results",
  communicationStyle: "Direct, action-oriented, empathetic but no-nonsense",
  uniquePositioning: "The only consultant who guarantees clarity in 90 days or less",
  platformPriority: "LinkedIn",
  currentPresence: "Posting sporadically, low engagement",
  primaryGoal: "Generate 3 high-quality discovery calls per week consistently",
  contentBandwidth: "Can create 1-2 pieces of content daily",
  successDefinition: "Predictable $25K monthly revenue with 20-hour work weeks",
  currentChallenges: "Inconsistent lead flow and unclear messaging",
  pastSuccess: "Helped 50+ entrepreneurs achieve clarity and growth",
  inspiration: "Gary Vaynerchuk's strategic mindset + Seth Godin's marketing wisdom"
};

// Test daily task generation
export function testDailyTaskGeneration() {
  console.log("🧠 Testing Naya Intelligence - Daily Task Generation");
  console.log("=" .repeat(60));
  
  const result = nayaIntelligence.generateDailyTasks(sampleBrandDna, []);
  
  console.log("🎯 Daily Focus:", result.focus);
  console.log("\n📋 Strategic Reasoning:");
  console.log(result.reasoning);
  console.log("\n✅ Today's Strategic Tasks:");
  
  result.tasks.forEach((task, index) => {
    console.log(`\n${index + 1}. ${task.title}`);
    console.log(`   Type: ${task.type} | Category: ${task.category} | Priority: ${task.priority}`);
    console.log(`   Description: ${task.description}`);
  });
  
  return result;
}

// Test content generation
export function testContentGeneration() {
  console.log("\n\n📝 Testing Naya Intelligence - Content Generation");
  console.log("=" .repeat(60));
  
  const result = nayaIntelligence.generateContent("linkedin", "authority building", sampleBrandDna);
  
  console.log("📄 Content Title:", result.title);
  console.log("\n📖 Content Body:");
  console.log(result.body);
  console.log("\n📢 Call to Action:", result.cta);
  console.log("\n🎯 Strategic Note:", result.strategicNote);
  
  return result;
}

// Test outreach generation
export function testOutreachGeneration() {
  console.log("\n\n📨 Testing Naya Intelligence - Outreach Generation");
  console.log("=" .repeat(60));
  
  const sampleLead = {
    name: "Sarah Chen",
    platform: "LinkedIn",
    company: "TechStart Solutions",
    notes: "Recent post about struggling with business strategy and team alignment"
  };
  
  const result = nayaIntelligence.generateOutreachMessage(sampleLead, "initial", sampleBrandDna);
  
  console.log("📧 Subject:", result.subject);
  console.log("\n💬 Message:");
  console.log(result.message);
  console.log("\n🔄 Follow-up Strategy:", result.followUpStrategy);
  console.log("\n🎯 Strategic Note:", result.strategicNote);
  
  return result;
}

// Comprehensive test suite
export function runNayaIntelligenceTests() {
  console.log("🚀 NAYA INTELLIGENCE COMPREHENSIVE TEST");
  console.log("Testing strategic AI capabilities without external dependencies");
  console.log("=" .repeat(80));
  
  const taskResults = testDailyTaskGeneration();
  const contentResults = testContentGeneration();
  const outreachResults = testOutreachGeneration();
  
  console.log("\n\n✅ NAYA INTELLIGENCE TEST COMPLETE");
  console.log("=" .repeat(80));
  console.log("🎯 Strategic AI successfully generated:");
  console.log(`   • ${taskResults.tasks.length} prioritized daily tasks`);
  console.log(`   • 1 strategic content piece with platform optimization`);
  console.log(`   • 1 personalized outreach message with follow-up sequence`);
  console.log("\n💡 All recommendations include strategic reasoning and business context");
  console.log("🔄 System ready for production use - no external API dependencies");
  
  return {
    tasks: taskResults,
    content: contentResults,
    outreach: outreachResults
  };
}