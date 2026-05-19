/**
 * Task Pre-Generation Service
 * Creates strategic tasks immediately when user completes onboarding
 */

import { nayaIntelligence } from './naya-intelligence';
import { companyResearchService } from './company-research';
import { storage } from '../storage';
import type { BrandDnaInput } from './openai';

export class TaskPreGenerationService {
  
  async generateWelcomeTasks(userId: string, brandDna: any): Promise<void> {
    console.log('🎯 Generating welcome tasks for new user...');
    
    try {
      // Analyze company online presence for additional context
      let companyProfile;
      if (brandDna.businessName || brandDna.website) {
        companyProfile = await companyResearchService.analyzeCompanyOnlinePresence(
          brandDna.businessName || 'User Business',
          brandDna.website,
          brandDna.linkedinProfile,
          brandDna.instagramHandle
        );
      }
      
      // Generate comprehensive strategic tasks using Naya Intelligence
      const taskResponse = nayaIntelligence.generateDailyTasks({
        businessType: brandDna.businessType,
        businessModel: brandDna.businessModel,
        revenueUrgency: brandDna.revenueUrgency,
        targetAudience: brandDna.targetAudience,
        corePainPoint: brandDna.corePainPoint,
        audienceAspiration: brandDna.audienceAspiration,
        authorityLevel: brandDna.authorityLevel,
        communicationStyle: brandDna.communicationStyle,
        uniquePositioning: brandDna.uniquePositioning,
        platformPriority: brandDna.platformPriority,
        currentPresence: brandDna.currentPresence,
        primaryGoal: brandDna.primaryGoal,
        contentBandwidth: brandDna.contentBandwidth,
        successDefinition: brandDna.successDefinition,
        currentChallenges: brandDna.currentChallenges,
        pastSuccess: brandDna.pastSuccess,
        inspiration: brandDna.inspiration,
      }, []);
      
      // Create strategic welcome tasks based on analysis
      const welcomeTasks = [
        ...taskResponse.tasks,
        ...this.generateOnboardingTasks(brandDna, companyProfile),
        ...this.generateQuickWinTasks(brandDna)
      ];
      
      // Save tasks to database
      for (const task of welcomeTasks) {
        await storage.createTask({
          userId,
          title: task.title,
          description: task.description,
          type: task.type,
          category: task.category,
          priority: task.priority,
          dueDate: new Date(),
          completed: false
        });
      }
      
      console.log(`✅ Generated ${welcomeTasks.length} strategic tasks for user`);
      
    } catch (error) {
      console.error('Task pre-generation error:', error);
      
      // Generate fallback tasks if intelligence fails
      await this.generateFallbackTasks(userId, brandDna);
    }
  }
  
  private generateOnboardingTasks(brandDna: any, companyProfile?: any) {
    const tasks = [];
    
    // Profile optimization tasks
    if (companyProfile?.onlinePresence.gaps?.length > 0) {
      tasks.push({
        title: "Complete your online presence audit",
        description: `Based on analysis, focus on: ${companyProfile.onlinePresence.gaps.slice(0, 2).join(', ')}. This will strengthen your professional credibility.`,
        type: "optimization",
        category: "foundation",
        priority: 4
      });
    }
    
    // Platform-specific setup
    if (!brandDna.linkedinProfile && brandDna.businessModel?.includes('B2B')) {
      tasks.push({
        title: "Set up professional LinkedIn presence",
        description: `For ${brandDna.businessType} targeting ${brandDna.targetAudience}, LinkedIn is essential for credibility and lead generation.`,
        type: "setup",
        category: "platform",
        priority: 3
      });
    }
    
    if (!brandDna.instagramHandle && brandDna.businessType?.includes('creative')) {
      tasks.push({
        title: "Create Instagram business account",
        description: `Visual storytelling on Instagram can help showcase your ${brandDna.uniquePositioning} to ${brandDna.targetAudience}.`,
        type: "setup", 
        category: "platform",
        priority: 2
      });
    }
    
    // Strategic foundation tasks
    tasks.push({
      title: "Define your content calendar structure",
      description: `Plan weekly content themes around your core message: ${brandDna.uniquePositioning}. This ensures consistent authority building.`,
      type: "planning",
      category: "content",
      priority: 3
    });
    
    return tasks;
  }
  
  private generateQuickWinTasks(brandDna: any) {
    return [
      {
        title: "Engage with 5 ideal prospects today",
        description: `Find ${brandDna.targetAudience} discussing ${brandDna.corePainPoint} and provide valuable insights. Build relationships before pitching.`,
        type: "outreach",
        category: "engagement",
        priority: 4
      },
      {
        title: "Create your signature story",
        description: `Craft a 2-minute story about how you discovered ${brandDna.uniquePositioning}. This becomes your authority-building foundation.`,
        type: "content",
        category: "messaging",
        priority: 3
      },
      {
        title: "Set up basic lead tracking system",
        description: `Create a simple system to track conversations with potential clients. Consistent follow-up drives 60% of conversions.`,
        type: "optimization",
        category: "systems",
        priority: 2
      }
    ];
  }
  
  private async generateFallbackTasks(userId: string, brandDna: any) {
    console.log('Generating fallback welcome tasks...');
    
    const fallbackTasks = [
      {
        title: "Welcome to Naya! Start with your content strategy",
        description: `Create your first piece of content addressing ${brandDna.corePainPoint} for ${brandDna.targetAudience}. Focus on providing immediate value.`,
        type: "content",
        category: "foundation",
        priority: 5
      },
      {
        title: "Identify 10 ideal prospects to connect with",
        description: `Research ${brandDna.targetAudience} on ${brandDna.platformPriority}. Look for those discussing challenges related to ${brandDna.corePainPoint}.`,
        type: "outreach", 
        category: "prospecting",
        priority: 4
      },
      {
        title: "Optimize your bio/profile for conversions", 
        description: `Update your ${brandDna.platformPriority} profile to clearly communicate how you help ${brandDna.targetAudience} achieve ${brandDna.audienceAspiration}.`,
        type: "optimization",
        category: "profile",
        priority: 3
      },
      {
        title: "Plan your week's content themes",
        description: `Map out 3-4 content themes that demonstrate your ${brandDna.uniquePositioning} and build trust with your audience.`,
        type: "planning",
        category: "content",
        priority: 2
      }
    ];
    
    for (const task of fallbackTasks) {
      await storage.createTask({
        userId,
        title: task.title,
        description: task.description,
        type: task.type,
        category: task.category,
        priority: task.priority,
        dueDate: new Date(),
        completed: false
      });
    }
  }
}

export const taskPreGenerationService = new TaskPreGenerationService();