import { getMetrics, type ModelType, type TaskType } from "./velocity";

const DEFAULT_TASK_MULTIPLIERS: Record<TaskType, number> = {
  greenfield: 6,
  refactoring: 4,
  integration: 5,
  architecture: 3,
  documentation: 5,
  testing: 4,
};

const MODEL_SPEED: Record<ModelType, number> = {
  haiku: 10,
  sonnet: 1,
  opus: 0.7,
};

function getSubAgentMultiplier(count: number): number {
  if (count <= 1) return 1;
  if (count <= 3) return 1.8;
  if (count <= 6) return 2.5;
  return 2.8;
}

function getConfidenceBuffer(confidence: "high" | "medium" | "low"): number {
  switch (confidence) {
    case "high":
      return 1.2;
    case "medium":
      return 1.5;
    case "low":
      return 2.0;
  }
}

export interface EstimateResult {
  estimatedMinutes: number;
  speedupFactor: number;
  confidence: "high" | "medium" | "low";
  basedOnNProjects: number;
}

export async function estimateProject(
  humanHours: number,
  taskType: TaskType,
  model: ModelType,
  subAgents: number,
  confidence: "high" | "medium" | "low"
): Promise<EstimateResult> {
  const metrics = await getMetrics();
  const matching = metrics.filter((m) => m.taskType === taskType);

  let baseSpeedup: number;
  let basedOnN: number;

  if (matching.length >= 3) {
    // Use actual data
    baseSpeedup = matching.reduce((s, m) => s + m.speedupFactor, 0) / matching.length;
    basedOnN = matching.length;
  } else {
    // Use defaults
    baseSpeedup = DEFAULT_TASK_MULTIPLIERS[taskType];
    basedOnN = 0;
  }

  // Adjust for model speed relative to sonnet baseline
  const modelAdjustment = MODEL_SPEED[model];

  // Adjust for sub-agents
  const subAgentMult = getSubAgentMultiplier(subAgents);

  // Combined speedup
  const speedupFactor = Math.round(baseSpeedup * modelAdjustment * subAgentMult * 10) / 10;

  // Estimated time with confidence buffer
  const buffer = getConfidenceBuffer(confidence);
  const humanMinutes = humanHours * 60;
  const rawEstimate = humanMinutes / speedupFactor;
  const estimatedMinutes = Math.round(rawEstimate * buffer);

  return {
    estimatedMinutes,
    speedupFactor,
    confidence,
    basedOnNProjects: basedOnN,
  };
}
