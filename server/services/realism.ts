// Naya Realism Engine — pre-save task validation and auto-correction
// Ensures generated tasks fit realistically into a user's day,
// accounting for existing scheduled work, workflow bundles, energy density, and context switching.
//
// The engine accepts a `deferTarget` parameter (not hardcoded to "tomorrow"),
// making it reusable for week/month planning flows by simply changing the target date.

export interface CandidateTask {
  title: string;
  estimatedDuration: number;
  taskEnergyType: string;
  priority: number;
  canBeFragmented: boolean;
  workflowGroup?: string;
  scheduledDate: string;
}

export interface WorkflowSuggestion {
  label: string;
  taskIndexes: number[];
  recommendedBlockMinutes: number;
}

export interface OperatingProfileForRealism {
  energyRhythm?: string;       // morning | afternoon | evening | variable
  contentBandwidth?: string;   // low | medium | high (from brand DNA)
  avoidanceTriggers?: string[];
}

export interface RealismInput {
  candidateTasks: CandidateTask[];
  existingTaskMinutes: number;
  operatingProfile: OperatingProfileForRealism;
  workflowSuggestions: WorkflowSuggestion[];
  targetDate: string;
  deferTarget: string;  // explicitly parameterized — not always "tomorrow"
  remainingMinutesOverride?: number; // when set, replaces deriveCapacity() — used when part of the day has already elapsed
}

export interface RealismReport {
  capacityMinutes: number;
  existingMinutes: number;
  totalCandidateMinutes: number;
  deferredCount: number;
  deferredTitles: string[];
  workflowBundlesDeferredCount: number;
  contextSwitchCorrected: boolean;
  deepWorkDeferredCount: number;
}

export interface RealismResult {
  tasks: CandidateTask[];
  realismReport: RealismReport;
}

function deriveCapacity(profile: OperatingProfileForRealism): number {
  // Multi-signal capacity estimation: contentBandwidth + energyRhythm
  // Both signals contribute independently — this is more robust than either alone.
  // As real usage data becomes available, actualDuration averages can further adjust this.
  let base = 300; // default (medium bandwidth)

  if (profile.contentBandwidth === 'high') base = 420;
  else if (profile.contentBandwidth === 'medium') base = 300;
  else if (profile.contentBandwidth === 'low') base = 180;

  // Energy rhythm modifier
  let rhythmMod = 0;
  if (profile.energyRhythm === 'morning') rhythmMod = +30;      // peak efficiency bonus
  else if (profile.energyRhythm === 'variable') rhythmMod = -30; // less reliable scheduling
  else if (profile.energyRhythm === 'evening') rhythmMod = -30;  // lower daytime reliability

  return base + rhythmMod;
}

export function runRealismValidation(input: RealismInput): RealismResult {
  const { candidateTasks, existingTaskMinutes, operatingProfile, workflowSuggestions, targetDate, deferTarget } = input;

  const capacityMinutes = input.remainingMinutesOverride !== undefined
    ? input.remainingMinutesOverride
    : deriveCapacity(operatingProfile);
  const availableMinutes = Math.max(capacityMinutes - existingTaskMinutes, 60);

  // Work on a mutable copy
  const tasks: CandidateTask[] = candidateTasks.map(t => ({ ...t }));

  const report: RealismReport = {
    capacityMinutes,
    existingMinutes: existingTaskMinutes,
    totalCandidateMinutes: tasks.reduce((s, t) => s + (t.estimatedDuration || 0), 0),
    deferredCount: 0,
    deferredTitles: [],
    workflowBundlesDeferredCount: 0,
    contextSwitchCorrected: false,
    deepWorkDeferredCount: 0,
  };

  let remainingMinutes = availableMinutes;

  // Build workflow bundle index (label → task objects)
  const bundleMap = new Map<string, CandidateTask[]>();
  for (const task of tasks) {
    if (task.workflowGroup) {
      if (!bundleMap.has(task.workflowGroup)) bundleMap.set(task.workflowGroup, []);
      bundleMap.get(task.workflowGroup)!.push(task);
    }
  }

  // Step 1 — Workflow block preservation
  // If a bundle's recommended block doesn't fit, defer ALL its tasks together.
  for (const suggestion of workflowSuggestions) {
    const bundleMinutes = suggestion.recommendedBlockMinutes;
    if (bundleMinutes > remainingMinutes) {
      // Defer the whole bundle — keep it intact, just shift to deferTarget
      const bundleTasks = bundleMap.get(suggestion.label) || [];
      for (const task of bundleTasks) {
        if (task.scheduledDate === targetDate) {
          task.scheduledDate = deferTarget;
          report.deferredTitles.push(task.title);
          report.deferredCount++;
        }
      }
      if (bundleTasks.length > 0) {
        report.workflowBundlesDeferredCount++;
      }
    } else {
      remainingMinutes -= bundleMinutes;
    }
  }

  // Step 2 — Workload cap
  // Sort remaining (non-deferred) tasks by priority ascending (1 = highest)
  const activeAfterBundles = tasks
    .filter(t => t.scheduledDate === targetDate)
    .sort((a, b) => a.priority - b.priority);

  let usedMinutes = 0;
  for (const task of activeAfterBundles) {
    // Skip tasks already deferred in step 1
    const dur = task.estimatedDuration || 30;
    if (usedMinutes + dur > remainingMinutes) {
      task.scheduledDate = deferTarget;
      report.deferredTitles.push(task.title);
      report.deferredCount++;
    } else {
      usedMinutes += dur;
    }
  }

  // Step 3 — Deep work density
  // At most 2 deep_work tasks per day
  const todayDeepWork = tasks
    .filter(t => t.scheduledDate === targetDate && t.taskEnergyType === 'deep_work')
    .sort((a, b) => a.priority - b.priority);

  if (todayDeepWork.length > 2) {
    for (let i = 2; i < todayDeepWork.length; i++) {
      const task = todayDeepWork[i];
      if (task.scheduledDate === targetDate) {
        task.scheduledDate = deferTarget;
        report.deferredTitles.push(task.title);
        report.deferredCount++;
        report.deepWorkDeferredCount++;
      }
    }
  }

  // Step 4 — Context switch auto-correction
  // If unique energy types > 4, defer lowest-priority singleton energy type task
  // Repeat until ≤ 4 unique types or no more singletons
  let correctionPasses = 0;
  while (correctionPasses < 10) {
    const todayTasks = tasks.filter(t => t.scheduledDate === targetDate);
    const energyCounts = new Map<string, number>();
    for (const t of todayTasks) {
      if (t.taskEnergyType) {
        energyCounts.set(t.taskEnergyType, (energyCounts.get(t.taskEnergyType) || 0) + 1);
      }
    }
    if (energyCounts.size <= 4) break;

    // Find singleton energy types (appears only once)
    const singletonTypes = Array.from(energyCounts.entries())
      .filter(([, count]) => count === 1)
      .map(([type]) => type);

    if (singletonTypes.length === 0) break;

    // Find lowest-priority task with a singleton energy type
    const candidates = todayTasks
      .filter(t => singletonTypes.includes(t.taskEnergyType))
      .sort((a, b) => b.priority - a.priority); // highest number = lowest priority

    if (candidates.length === 0) break;

    const toDefer = candidates[0];
    toDefer.scheduledDate = deferTarget;
    report.deferredTitles.push(toDefer.title);
    report.deferredCount++;
    report.contextSwitchCorrected = true;
    correctionPasses++;
  }

  return { tasks, realismReport: report };
}
