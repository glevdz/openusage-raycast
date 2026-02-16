import { useState } from "react";
import { Action, ActionPanel, Detail, Form } from "@raycast/api";
import { estimateProject, type EstimateResult } from "./lib/estimator";
import type { ModelType, TaskType } from "./lib/velocity";

function ResultView({ result, humanHours }: { result: EstimateResult; humanHours: number }) {
  const hours = Math.floor(result.estimatedMinutes / 60);
  const mins = result.estimatedMinutes % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const source = result.basedOnNProjects > 0
    ? `Based on ${result.basedOnNProjects} logged projects`
    : "Using default multipliers";

  const md = `
# Project Estimate

| Metric | Value |
|--------|-------|
| **Human Estimate** | ${humanHours}h |
| **Estimated AI Time** | ${timeStr} |
| **Speedup Factor** | ${result.speedupFactor}x |
| **Confidence** | ${result.confidence} (+${result.confidence === "high" ? "20" : result.confidence === "medium" ? "50" : "100"}% buffer) |
| **Data Source** | ${source} |
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
  const [result, setResult] = useState<{ estimate: EstimateResult; humanHours: number } | null>(null);

  async function handleSubmit(values: {
    humanEstimateHours: string;
    taskType: TaskType;
    model: ModelType;
    subAgents: string;
    confidence: "high" | "medium" | "low";
  }) {
    const humanHours = parseFloat(values.humanEstimateHours);
    const subAgents = parseInt(values.subAgents || "1", 10);

    if (isNaN(humanHours) || humanHours <= 0) return;

    const estimate = await estimateProject(
      humanHours,
      values.taskType,
      values.model,
      subAgents,
      values.confidence
    );

    setResult({ estimate, humanHours });
  }

  if (result) {
    return <ResultView result={result.estimate} humanHours={result.humanHours} />;
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Estimate" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="humanEstimateHours" title="Human Estimate (hours)" placeholder="e.g. 40" />
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
      <Form.TextField id="subAgents" title="Sub-Agents" placeholder="e.g. 3" defaultValue="1" />
      <Form.Dropdown id="confidence" title="Confidence">
        <Form.Dropdown.Item value="high" title="High (+20% buffer)" />
        <Form.Dropdown.Item value="medium" title="Medium (+50% buffer)" />
        <Form.Dropdown.Item value="low" title="Low (+100% buffer)" />
      </Form.Dropdown>
    </Form>
  );
}
