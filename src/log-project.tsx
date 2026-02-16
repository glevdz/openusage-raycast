import { Action, ActionPanel, Form, showToast, Toast } from "@raycast/api";
import { saveMetric, type ModelType, type TaskType } from "./lib/velocity";

export default function LogProject() {
  async function handleSubmit(values: {
    name: string;
    humanEstimateHours: string;
    actualWallClockMin: string;
    agentTimeMin: string;
    model: ModelType;
    subAgentsSpawned: string;
    taskType: TaskType;
    notes: string;
  }) {
    const humanEstimateHours = parseFloat(values.humanEstimateHours);
    const actualWallClockMin = parseFloat(values.actualWallClockMin);
    const agentTimeMin = parseFloat(values.agentTimeMin);
    const subAgentsSpawned = parseInt(values.subAgentsSpawned || "0", 10);

    if (isNaN(humanEstimateHours) || isNaN(actualWallClockMin) || isNaN(agentTimeMin)) {
      await showToast({ style: Toast.Style.Failure, title: "Invalid numbers" });
      return;
    }

    const metric = await saveMetric({
      name: values.name,
      humanEstimateHours,
      actualWallClockMin,
      agentTimeMin,
      model: values.model,
      subAgentsSpawned,
      taskType: values.taskType,
      notes: values.notes,
    });

    await showToast({
      style: Toast.Style.Success,
      title: "Project Logged",
      message: `${metric.name} — ${metric.speedupFactor}x speedup`,
    });
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Log Project" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Project Name" placeholder="e.g. Auth system refactor" />
      <Form.TextField id="humanEstimateHours" title="Human Estimate (hours)" placeholder="e.g. 40" />
      <Form.TextField id="actualWallClockMin" title="Actual Wall-Clock (min)" placeholder="e.g. 120" />
      <Form.TextField id="agentTimeMin" title="Agent Time (min)" placeholder="e.g. 90" />
      <Form.Dropdown id="model" title="Model">
        <Form.Dropdown.Item value="opus" title="Opus" />
        <Form.Dropdown.Item value="sonnet" title="Sonnet" />
        <Form.Dropdown.Item value="haiku" title="Haiku" />
      </Form.Dropdown>
      <Form.TextField id="subAgentsSpawned" title="Sub-Agents Spawned" placeholder="e.g. 3" defaultValue="0" />
      <Form.Dropdown id="taskType" title="Task Type">
        <Form.Dropdown.Item value="greenfield" title="Greenfield" />
        <Form.Dropdown.Item value="refactoring" title="Refactoring" />
        <Form.Dropdown.Item value="integration" title="Integration" />
        <Form.Dropdown.Item value="architecture" title="Architecture" />
        <Form.Dropdown.Item value="documentation" title="Documentation" />
        <Form.Dropdown.Item value="testing" title="Testing" />
      </Form.Dropdown>
      <Form.TextArea id="notes" title="Notes" placeholder="Optional notes about this project" />
    </Form>
  );
}
