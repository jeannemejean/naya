// @ts-nocheck
/**
 * Contextual Recommendations Engine
 * Analyzes user behavior patterns to provide personalized, intelligent recommendations
 *
 * This system learns from:
 * - Task completion patterns over time
 * - User working hours and energy levels
 * - Recurring blockers (tasks never completed)
 * - Project momentum and engagement patterns
 * - Historical performance data
 */

import type { IStorage } from "../storage";
import { storage } from "../storage";

interface BehaviorPattern {
  preferredWorkingHours: number[]; // Hours when user is most productive
  averageCompletionRate: number; // Overall task completion rate
  taskCompletionVelocity: number; // Tasks completed per week
  consistencyScore: number; // How consistently user engages with the system
  energyPattern: 'morning' | 'afternoon' | 'evening' | 'mixed';
}

interface BlockerAnalysis {
  recurringIncompleteTasks: Array<{
    title: string;
    timesPostponed: number;
    firstCreated: Date;
    lastSeen: Date;
  }>;
  stuckProjects: Array<{
    projectId: number;
    projectName: string;
    daysSinceLastActivity: number;
    goalCompletionRate: number;
  }>;
  commonObstacles: string[]; // Patterns in why tasks aren't completed
}

interface ContextualRecommendation {
  type: 'behavioral' | 'blocker' | 'momentum' | 'optimization' | 'energy';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  insight?: string; // Why this recommendation matters
  basedOn?: string; // What data informed this recommendation
}

export class ContextualRecommendationsEngine {
  private storage: IStorage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  /**
   * Generate contextual recommendations based on user behavior
   */
  async generateRecommendations(
    userId: string,
    projectId?: number
  ): Promise<ContextualRecommendation[]> {
    // Gather behavioral data
    const behaviorPattern = await this.analyzeBehaviorPattern(userId);
    const blockers = await this.identifyBlockers(userId, projectId);
    const momentumAnalysis = await this.analyzeMomentum(userId, projectId);

    const recommendations: ContextualRecommendation[] = [];

    // Critical blockers get highest priority
    if (blockers.recurringIncompleteTasks.length > 0) {
      recommendations.push(...this.generateBlockerRecommendations(blockers));
    }

    // Energy-based recommendations
    if (behaviorPattern) {
      recommendations.push(...this.generateEnergyRecommendations(behaviorPattern));
    }

    // Momentum recommendations
    if (momentumAnalysis) {
      recommendations.push(...this.generateMomentumRecommendations(momentumAnalysis));
    }

    // Behavioral optimization
    if (behaviorPattern) {
      recommendations.push(...this.generateOptimizationRecommendations(behaviorPattern));
    }

    // Sort by priority and return top recommendations
    return this.prioritizeRecommendations(recommendations).slice(0, 5);
  }

  /**
   * Analyze user's working patterns over the last 30 days
   */
  private async analyzeBehaviorPattern(userId: string): Promise<BehaviorPattern | null> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Get all tasks from last 30 days
      const tasks = await this.storage.getTasksInRange(
        userId,
        thirtyDaysAgo.toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      );

      if (tasks.length === 0) {
        return null; // Not enough data
      }

      // Calculate completion rate
      const completedTasks = tasks.filter(t => t.completed);
      const averageCompletionRate = completedTasks.length / tasks.length;

      // Calculate velocity (tasks per week)
      const taskCompletionVelocity = (completedTasks.length / 30) * 7;

      // Analyze working hours (when tasks are completed)
      const completionHours = completedTasks
        .filter(t => t.completedAt)
        .map(t => new Date(t.completedAt!).getHours());

      const preferredWorkingHours = this.identifyPreferredHours(completionHours);

      // Determine energy pattern
      const energyPattern = this.determineEnergyPattern(completionHours);

      // Calculate consistency (how many days out of 30 had activity)
      const activeDays = new Set(
        completedTasks
          .filter(t => t.completedAt)
          .map(t => new Date(t.completedAt!).toDateString())
      ).size;
      const consistencyScore = activeDays / 30;

      return {
        preferredWorkingHours,
        averageCompletionRate,
        taskCompletionVelocity,
        consistencyScore,
        energyPattern,
      };
    } catch (error) {
      console.error("Error analyzing behavior pattern:", error);
      return null;
    }
  }

  /**
   * Identify recurring blockers and stuck tasks
   */
  private async identifyBlockers(
    userId: string,
    projectId?: number
  ): Promise<BlockerAnalysis> {
    try {
      // Get tasks from last 60 days to see patterns
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

      const allTasks = await this.storage.getTasksInRange(
        userId,
        sixtyDaysAgo.toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      );

      // Find recurring incomplete tasks (same/similar title appearing multiple times)
      const incompleteTasks = allTasks.filter(t => !t.completed);
      const recurringIncompleteTasks = this.findRecurringTasks(incompleteTasks);

      // Identify stuck projects
      const projects = await this.storage.getProjects(userId);
      const stuckProjects = [];

      for (const project of projects) {
        if (projectId && project.id !== projectId) continue;

        const projectTasks = allTasks.filter(t => t.projectId === project.id);
        const recentActivity = projectTasks.filter(t => {
          const taskDate = new Date(t.createdAt);
          const daysSince = (Date.now() - taskDate.getTime()) / (1000 * 60 * 60 * 24);
          return daysSince <= 14;
        });

        if (projectTasks.length > 0 && recentActivity.length === 0) {
          const goals = await this.storage.getActiveGoalsForProject(project.id);
          const completedGoals = goals.filter(g => g.progress >= 100);
          const goalCompletionRate = goals.length > 0 ? completedGoals.length / goals.length : 0;

          const lastActivity = projectTasks.sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0];

          const daysSinceLastActivity = Math.floor(
            (Date.now() - new Date(lastActivity.createdAt).getTime()) / (1000 * 60 * 60 * 24)
          );

          stuckProjects.push({
            projectId: project.id,
            projectName: project.name,
            daysSinceLastActivity,
            goalCompletionRate,
          });
        }
      }

      return {
        recurringIncompleteTasks,
        stuckProjects,
        commonObstacles: [], // Could be enhanced with AI analysis
      };
    } catch (error) {
      console.error("Error identifying blockers:", error);
      return {
        recurringIncompleteTasks: [],
        stuckProjects: [],
        commonObstacles: [],
      };
    }
  }

  /**
   * Analyze project momentum and engagement
   */
  private async analyzeMomentum(userId: string, projectId?: number) {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentTasks = await this.storage.getTasksInRange(
        userId,
        sevenDaysAgo.toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      );
      const completedThisWeek = recentTasks.filter(t => t.completed).length;

      // Get previous week for comparison
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const previousWeekTasks = await this.storage.getTasksInRange(
        userId,
        fourteenDaysAgo.toISOString().split('T')[0],
        sevenDaysAgo.toISOString().split('T')[0]
      );
      const completedLastWeek = previousWeekTasks.filter(t => t.completed).length;

      const momentumTrend = completedThisWeek - completedLastWeek;
      const isGainingMomentum = momentumTrend > 0;
      const isLosingMomentum = momentumTrend < -2;

      return {
        completedThisWeek,
        completedLastWeek,
        momentumTrend,
        isGainingMomentum,
        isLosingMomentum,
        weeklyEngagement: completedThisWeek > 0 ? 'active' : 'low',
      };
    } catch (error) {
      console.error("Error analyzing momentum:", error);
      return null;
    }
  }

  /**
   * Generate recommendations for identified blockers
   */
  private generateBlockerRecommendations(blockers: BlockerAnalysis): ContextualRecommendation[] {
    const recommendations: ContextualRecommendation[] = [];

    // Recurring incomplete tasks
    if (blockers.recurringIncompleteTasks.length > 0) {
      const topBlocker = blockers.recurringIncompleteTasks[0];
      recommendations.push({
        type: 'blocker',
        priority: 'critical',
        title: `Break through: "${topBlocker.title}"`,
        description: `This task has appeared ${topBlocker.timesPostponed} times without completion. It might be too big, unclear, or not actually important.`,
        action: "Either break it into smaller steps, clarify what \"done\" looks like, or remove it if it's not serving you",
        insight: 'Recurring incomplete tasks drain mental energy and create false urgency',
        basedOn: `Appeared ${topBlocker.timesPostponed} times since ${topBlocker.firstCreated.toLocaleDateString()}`,
      });
    }

    // Stuck projects
    if (blockers.stuckProjects.length > 0) {
      const stuckProject = blockers.stuckProjects[0];
      recommendations.push({
        type: 'blocker',
        priority: 'high',
        title: `Revive ${stuckProject.projectName}`,
        description: `No activity for ${stuckProject.daysSinceLastActivity} days. This project is stalling.`,
        action: stuckProject.daysSinceLastActivity > 30
          ? 'Decide: Is this project still aligned with your goals? If yes, schedule one small action. If no, archive it.'
          : 'Schedule 30 minutes this week to make progress on one goal',
        insight: 'Stuck projects create mental clutter and decision fatigue',
        basedOn: `${stuckProject.daysSinceLastActivity} days without activity`,
      });
    }

    return recommendations;
  }

  /**
   * Generate energy-based recommendations
   */
  private generateEnergyRecommendations(pattern: BehaviorPattern): ContextualRecommendation[] {
    const recommendations: ContextualRecommendation[] = [];

    // Low completion rate
    if (pattern.averageCompletionRate < 0.5) {
      recommendations.push({
        type: 'energy',
        priority: 'high',
        title: "You're overcommitting",
        description: `Your completion rate is ${Math.round(pattern.averageCompletionRate * 100)}%. You're creating more tasks than you can realistically complete.`,
        action: 'Try limiting yourself to 3 important tasks per day instead of filling your list',
        insight: 'Fewer, completed tasks build momentum better than many incomplete ones',
        basedOn: `${Math.round(pattern.averageCompletionRate * 100)}% completion rate over 30 days`,
      });
    }

    // Energy pattern insights
    if (pattern.energyPattern === 'morning' && pattern.consistencyScore > 0.5) {
      recommendations.push({
        type: 'energy',
        priority: 'medium',
        title: 'Optimize for your morning energy',
        description: 'You complete most tasks in the morning. Your afternoon performance drops off.',
        action: 'Schedule your hardest, most important work before noon. Use afternoons for admin and communication',
        insight: 'Working with your natural energy creates better results with less effort',
        basedOn: 'Morning completion pattern over last 30 days',
      });
    }

    return recommendations;
  }

  /**
   * Generate momentum recommendations
   */
  private generateMomentumRecommendations(momentum: any): ContextualRecommendation[] {
    const recommendations: ContextualRecommendation[] = [];

    if (momentum.isLosingMomentum) {
      recommendations.push({
        type: 'momentum',
        priority: 'high',
        title: 'Momentum is dropping',
        description: `You completed ${momentum.completedLastWeek} tasks last week but only ${momentum.completedThisWeek} this week.`,
        action: 'Pick one small win today to rebuild momentum. Sometimes the best thing is just to start.',
        insight: 'Momentum compounds — small consistent action beats irregular intensity',
        basedOn: `${momentum.momentumTrend} fewer tasks completed this week`,
      });
    } else if (momentum.isGainingMomentum) {
      recommendations.push({
        type: 'momentum',
        priority: 'medium',
        title: "You're building momentum",
        description: `${momentum.completedThisWeek} tasks completed this week, up from ${momentum.completedLastWeek} last week. Keep this energy going.`,
        action: "Maintain this pace — don't increase task volume yet. Consistency matters more than intensity.",
        insight: 'Sustainable momentum beats unsustainable sprints',
        basedOn: `+${momentum.momentumTrend} tasks completed vs last week`,
      });
    }

    return recommendations;
  }

  /**
   * Generate optimization recommendations
   */
  private generateOptimizationRecommendations(pattern: BehaviorPattern): ContextualRecommendation[] {
    const recommendations: ContextualRecommendation[] = [];

    // Low consistency
    if (pattern.consistencyScore < 0.4) {
      recommendations.push({
        type: 'optimization',
        priority: 'medium',
        title: 'Build a daily ritual',
        description: `You're active ${Math.round(pattern.consistencyScore * 30)} days out of 30. Sporadic engagement makes progress harder.`,
        action: 'Set a daily 5-minute check-in time. Consistency beats intensity.',
        insight: 'Daily touchpoints create compound progress over time',
        basedOn: `Active ${Math.round(pattern.consistencyScore * 100)}% of days`,
      });
    }

    return recommendations;
  }

  /**
   * Prioritize recommendations by impact and urgency
   */
  private prioritizeRecommendations(
    recommendations: ContextualRecommendation[]
  ): ContextualRecommendation[] {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

    return recommendations.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Within same priority, blockers come first
      if (a.type === 'blocker' && b.type !== 'blocker') return -1;
      if (b.type === 'blocker' && a.type !== 'blocker') return 1;

      return 0;
    });
  }

  /**
   * Helper: Identify preferred working hours from completion patterns
   */
  private identifyPreferredHours(hours: number[]): number[] {
    if (hours.length === 0) return [];

    // Count frequency of each hour
    const hourCounts = hours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    // Return hours with above-average frequency
    const avgCount = hours.length / 24;
    return Object.entries(hourCounts)
      .filter(([_, count]) => count > avgCount)
      .map(([hour]) => parseInt(hour))
      .sort((a, b) => a - b);
  }

  /**
   * Helper: Determine energy pattern from completion hours
   */
  private determineEnergyPattern(hours: number[]): 'morning' | 'afternoon' | 'evening' | 'mixed' {
    if (hours.length === 0) return 'mixed';

    const morningCount = hours.filter(h => h >= 6 && h < 12).length;
    const afternoonCount = hours.filter(h => h >= 12 && h < 18).length;
    const eveningCount = hours.filter(h => h >= 18 || h < 6).length;

    const total = hours.length;
    const morningPercent = morningCount / total;
    const afternoonPercent = afternoonCount / total;
    const eveningPercent = eveningCount / total;

    if (morningPercent > 0.5) return 'morning';
    if (afternoonPercent > 0.5) return 'afternoon';
    if (eveningPercent > 0.5) return 'evening';

    return 'mixed';
  }

  /**
   * Helper: Find recurring incomplete tasks
   */
  private findRecurringTasks(tasks: any[]) {
    // Group tasks by similar titles
    const titleGroups = tasks.reduce((acc, task) => {
      // Normalize title for comparison
      const normalizedTitle = task.title.toLowerCase().trim();
      if (!acc[normalizedTitle]) {
        acc[normalizedTitle] = [];
      }
      acc[normalizedTitle].push(task);
      return acc;
    }, {} as Record<string, any[]>);

    // Find groups that appear 3+ times
    const recurring = [];
    for (const [title, taskGroup] of Object.entries(titleGroups)) {
      if (taskGroup.length >= 3) {
        const sortedByDate = taskGroup.sort((a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        recurring.push({
          title: taskGroup[0].title,
          timesPostponed: taskGroup.length,
          firstCreated: new Date(sortedByDate[0].createdAt),
          lastSeen: new Date(sortedByDate[sortedByDate.length - 1].createdAt),
        });
      }
    }

    return recurring.sort((a, b) => b.timesPostponed - a.timesPostponed);
  }
}

// Export singleton instance
export const contextualRecommendationsEngine = new ContextualRecommendationsEngine(storage);
