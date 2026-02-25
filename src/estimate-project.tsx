import { useEffect, useState } from "react";
import { Action, ActionPanel, Detail, Form } from "@raycast/api";
import {
  estimateProject,
  type EstimateResult,
  type ModelType,
  type TaskType,
} from "./lib/estimator";
import {
  scanRepos,
  matchReposToSessions,
  getRepoEstimate,
  type EnrichedRepo,
} from "./lib/github";
import { getProjectStats } from "./lib/velocity";
import { estimateSessionCarbon } from "./lib/carbon";

// Model efficiency ratios relative to Opus
const MODEL_CARBON_RATIOS: Record<string, { label: string; ratio: number }> = {
  opus: { label: "Opus", ratio: 1.0 },
  sonnet: { label: "Sonnet", ratio: 0.6 },
  haiku: { label: "Haiku", ratio: 0.3 },
};

function ResultView({
  result,
  humanHours,
  repo,
  carbonG,
  selectedModel,
}: {
  result: EstimateResult;
  humanHours: number;
  repo?: EnrichedRepo;
  carbonG?: number;
  selectedModel: ModelType;
}) {
  const hours = Math.floor(result.estimatedMinutes / 60);
  const mins = result.estimatedMinutes % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const source =
    result.basedOnNSessions > 0
      ? `${result.basedOnNSessions} scanned sessions`
      : "Default multipliers";
  const tokensInfo = result.avgTokensPerMin
    ? `${result.avgTokensPerMin} tokens/min avg`
    : "N/A";

  const repoSection = repo
    ? `

## GitHub Repo: ${repo.owner}/${repo.name}

| Metric | Value |
|--------|-------|
| **Primary Language** | ${repo.primaryLanguage} |
| **Size** | ${repo.sizeKB >= 1000 ? `${(repo.sizeKB / 1000).toFixed(1)} MB` : `${repo.sizeKB} KB`} |
| **Languages** | ${Object.keys(repo.languages).length} |
| **Commits (90d)** | ${repo.commitCount} |
| **Velocity** | ${repo.commitVelocity} commits/week |
| **Complexity** | ${Math.round(getRepoEstimate(repo).complexityScore * 100)}% |
${repo.matchedProject ? `| **Matched Sessions** | ${repo.matchedProject.sessions} |` : ""}
`
    : "";

  const md = `
# Project Estimate

| Metric | Value |
|--------|-------|
| **Human Estimate** | ${humanHours}h |
| **Estimated AI Time** | ${timeStr} |
| **Speedup Factor** | ${result.speedupFactor}x |
| **Confidence** | ${result.confidence} (+${result.confidence === "high" ? "20" : result.confidence === "medium" ? "50" : "100"}% buffer) |
| **Data Source** | ${source} |
| **Avg Output Rate** | ${tokensInfo} |
${carbonG !== undefined ? `| **Projected CO2** | ${carbonG >= 1000 ? `${(carbonG / 1000).toFixed(2)} kg` : `${carbonG.toFixed(1)} g`} (${MODEL_CARBON_RATIOS[selectedModel]?.label ?? selectedModel}) |\n` : ""}${
    carbonG !== undefined
      ? Object.entries(MODEL_CARBON_RATIOS)
          .filter(([key]) => key !== selectedModel)
          .map(([, info]) => {
            const selectedRatio =
              MODEL_CARBON_RATIOS[selectedModel]?.ratio ?? 1.0;
            const altCarbonG = (carbonG * info.ratio) / selectedRatio;
            const savings = Math.round((1 - info.ratio / selectedRatio) * 100);
            const sign = savings > 0 ? "-" : "+";
            return `| **Alt: ${info.label}** | ~${altCarbonG >= 1000 ? `${(altCarbonG / 1000).toFixed(2)} kg` : `${altCarbonG.toFixed(1)} g`} (${sign}${Math.abs(savings)}%) |`;
          })
          .join("\n") + "\n"
      : ""
  }${repoSection}
  `.trim();

  return (
    <Detail
      markdown={md}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Estimate"
            content={`Estimated: ${timeStr} (${result.speedupFactor}x speedup, ${result.confidence} confidence)`}
          />
        </ActionPanel>
      }
    />
  );
}

export default function EstimateProject() {
  const [result, setResult] = useState<{
    estimate: EstimateResult;
    humanHours: number;
    repo?: EnrichedRepo;
    carbonG?: number;
    selectedModel: ModelType;
  } | null>(null);
  const [repos, setRepos] = useState<EnrichedRepo[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [rawRepos, projects] = await Promise.all([
          scanRepos(),
          getProjectStats(),
        ]);
        setRepos(matchReposToSessions(rawRepos, projects));
      } catch {
        // gh CLI not available or not authenticated — no repos shown
      }
    })();
  }, []);

  async function handleSubmit(values: {
    humanEstimateHours: string;
    taskType: TaskType;
    model: ModelType;
    subAgents: string;
    confidence: "high" | "medium" | "low";
    githubRepo: string;
  }) {
    const humanHours = parseFloat(values.humanEstimateHours);
    const subAgents = parseInt(values.subAgents || "1", 10);

    if (isNaN(humanHours) || humanHours <= 0) return;

    const selectedRepo = values.githubRepo
      ? repos.find((r) => `${r.owner}/${r.name}` === values.githubRepo)
      : undefined;

    const estimate = await estimateProject(
      humanHours,
      values.taskType,
      values.model,
      subAgents,
      values.confidence,
    );

    // Fetch projected carbon for the estimated AI time
    const carbonEstimate = await estimateSessionCarbon(
      estimate.estimatedMinutes,
    );

    setResult({
      estimate,
      humanHours,
      repo: selectedRepo,
      carbonG: carbonEstimate?.emissionsG,
      selectedModel: values.model,
    });
  }

  if (result) {
    return (
      <ResultView
        result={result.estimate}
        humanHours={result.humanHours}
        repo={result.repo}
        carbonG={result.carbonG}
        selectedModel={result.selectedModel}
      />
    );
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Estimate" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="humanEstimateHours"
        title="Human Estimate (hours)"
        placeholder="e.g. 40"
      />
      <Form.Dropdown id="taskType" title="Task Type">
        <Form.Dropdown.Item value="greenfield" title="Greenfield" />
        <Form.Dropdown.Item value="refactoring" title="Refactoring" />
        <Form.Dropdown.Item value="integration" title="Integration" />
        <Form.Dropdown.Item value="architecture" title="Architecture" />
        <Form.Dropdown.Item value="documentation" title="Documentation" />
        <Form.Dropdown.Item value="testing" title="Testing" />
      </Form.Dropdown>
      <Form.Dropdown id="model" title="Model">
        <Form.Dropdown.Item value="sonnet" title="Sonnet" />
        <Form.Dropdown.Item value="opus" title="Opus" />
        <Form.Dropdown.Item value="haiku" title="Haiku" />
      </Form.Dropdown>
      <Form.TextField
        id="subAgents"
        title="Sub-Agents"
        placeholder="e.g. 3"
        defaultValue="1"
      />
      <Form.Dropdown id="confidence" title="Confidence">
        <Form.Dropdown.Item value="high" title="High (+20% buffer)" />
        <Form.Dropdown.Item value="medium" title="Medium (+50% buffer)" />
        <Form.Dropdown.Item value="low" title="Low (+100% buffer)" />
      </Form.Dropdown>
      <Form.Dropdown id="githubRepo" title="GitHub Repo (optional)">
        <Form.Dropdown.Item value="" title="None" />
        {repos.map((r) => (
          <Form.Dropdown.Item
            key={`${r.owner}/${r.name}`}
            value={`${r.owner}/${r.name}`}
            title={`${r.name} — ${r.primaryLanguage}${r.matchedProject ? ` (${r.matchedProject.sessions} sessions)` : ""}`}
          />
        ))}
      </Form.Dropdown>
    </Form>
  );
}
