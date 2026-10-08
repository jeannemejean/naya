/**
 * Task Pre-Generation Service
 * Creates strategic tasks immediately when user completes onboarding
 */

import { nayaIntelligence } from './naya-intelligence';
import { companyResearchService } from './company-research';
import { storage } from '../storage';
import { imposerLangueDuCompte } from './garde-langue';
import { filtrerTachesGenerees } from './filtre-taches-generees';
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
      
      // Create strategic welcome tasks based on analysis. Contenu et prospection écartés :
      // ils viennent du calendrier éditorial et du pipeline de prospection.
      const welcomeTasks = filtrerTachesGenerees([
        ...taskResponse.tasks,
        ...this.generateOnboardingTasks(brandDna, companyProfile),
        ...this.generateQuickWinTasks(brandDna)
      ], 'bienvenue');

      // Modèles écrits en français (langue par défaut) : la garde les remet dans la langue
      // du compte, y compris les tâches de naya-intelligence, rédigées en anglais.
      await imposerLangueDuCompte(welcomeTasks, userId);

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
          // Donne une date → createTask auto-planifie sur la grille (jamais "non planifié").
          scheduledDate: new Date().toISOString().slice(0, 10),
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
        title: "Terminer l'audit de ta présence en ligne",
        description: `D'après l'analyse, concentre-toi sur : ${companyProfile.onlinePresence.gaps.slice(0, 2).join(', ')}. C'est ce qui renforcera ta crédibilité professionnelle.`,
        type: "optimization",
        category: "foundation",
        priority: 4
      });
    }
    
    // Platform-specific setup
    if (!brandDna.linkedinProfile && brandDna.businessModel?.includes('B2B')) {
      tasks.push({
        title: "Mettre en place ton profil LinkedIn professionnel",
        description: `Pour ${brandDna.businessType} qui s'adresse à ${brandDna.targetAudience}, LinkedIn est essentiel pour ta crédibilité.`,
        type: "setup",
        category: "platform",
        priority: 3
      });
    }
    
    if (!brandDna.instagramHandle && brandDna.businessType?.includes('creative')) {
      tasks.push({
        title: "Ouvrir ton compte Instagram professionnel",
        description: `Instagram t'aidera à montrer en images ${brandDna.uniquePositioning} à ${brandDna.targetAudience}.`,
        type: "setup", 
        category: "platform",
        priority: 2
      });
    }
    
    // Strategic foundation tasks
    tasks.push({
      title: "Définir la structure de ton calendrier éditorial",
      description: `Pose les thèmes de la semaine autour de ton message central : ${brandDna.uniquePositioning}. C'est ce qui rend ta prise de parole régulière.`,
      type: "planning",
      category: "content",
      priority: 3
    });
    
    return tasks;
  }
  
  // Ni prospection ni contenu ici : ils viennent du pipeline et du calendrier éditorial.
  private generateQuickWinTasks(brandDna: any) {
    return [
      {
        title: "Formuler ton histoire fondatrice en 5 phrases",
        description: `Note en 5 phrases comment tu en es venue à ${brandDna.uniquePositioning}. Elle servira de socle à ton positionnement et à ton offre.`,
        type: "planning",
        category: "messaging",
        priority: 3
      },
      {
        title: "Mettre en place un suivi simple de tes échanges clients",
        description: `Un tableau simple pour suivre tes conversations avec tes clients et futurs clients : qui, où vous en êtes, prochaine étape.`,
        type: "optimization",
        category: "systems",
        priority: 2
      }
    ];
  }
  
  private async generateFallbackTasks(userId: string, brandDna: any) {
    console.log('Generating fallback welcome tasks...');
    
    // Modèles en français (langue par défaut), remis dans la langue du compte par la garde.
    // Ni prospection ni création de contenu : pipeline et calendrier éditorial s'en chargent.
    const fallbackTasks = [
      {
        title: "Bienvenue dans Naya ! Clarifie ce que tu résous pour ton audience",
        description: `Écris en une phrase le problème que tu règles (${brandDna.corePainPoint}) et pour qui (${brandDna.targetAudience}). Tout le reste de Naya s'appuiera dessus.`,
        type: "planning",
        category: "foundation",
        priority: 5
      },
      {
        title: "Revoir ta bio pour dire clairement qui tu aides",
        description: `Mets à jour ton profil ${brandDna.platformPriority} pour dire clairement comment tu aides ${brandDna.targetAudience} à atteindre ${brandDna.audienceAspiration}.`,
        type: "optimization",
        category: "profile",
        priority: 3
      },
      {
        title: "Choisir 3 ou 4 thèmes éditoriaux pour ton calendrier",
        description: `Choisis 3 ou 4 thèmes qui montrent ${brandDna.uniquePositioning} et installent la confiance avec ton audience.`,
        type: "planning",
        category: "strategy",
        priority: 2
      }
    ];
    await imposerLangueDuCompte(fallbackTasks, userId);
    
    for (const task of fallbackTasks) {
      await storage.createTask({
        userId,
        title: task.title,
        description: task.description,
        type: task.type,
        category: task.category,
        priority: task.priority,
        dueDate: new Date(),
        // Donne une date → createTask auto-planifie sur la grille (jamais "non planifié").
        scheduledDate: new Date().toISOString().slice(0, 10),
        completed: false
      });
    }
  }
}

export const taskPreGenerationService = new TaskPreGenerationService();