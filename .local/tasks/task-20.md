---
title: Show task description and campaign badge in Task Workspace
---
# Task Workspace: Description + Campaign Badge

## What & Why
The Task Workspace panel currently shows only the task title and project name in its header. When a task has a description (added via the API or campaign generation), it is not visible anywhere in the panel — users have no context for what the task involves. Similarly, campaign-generated tasks have no visual indicator distinguishing them from manually created tasks.

## Done looks like
- Opening the Task Workspace for a task that has a non-empty `description` shows a "Task brief" block just below the header and above the tabs, displaying the description text.
- If the task's `source` field equals `"campaign"`, a small amber "🚀 From campaign" pill badge appears above the brief block.
- Tasks with no description show no brief block (no empty space added).
- Non-campaign tasks show no badge.
- Both elements are dark-mode compatible.

## Out of scope
- Editing the task description from this panel.
- Any changes to routing, API routes, or the schema.

## Tasks
1. **Add campaign badge** — In the flex-1 scrollable area (before the tab row), render an amber pill badge when `task.source === 'campaign'`.
2. **Add description brief block** — Immediately after the badge (or alone if no badge), render the "Task brief" card block when `task.description` is non-empty; place both elements between the SheetHeader close and the tab row div inside `<div className="flex-1 flex flex-col overflow-hidden">`.

## Relevant files
- `client/src/components/task-workspace.tsx:143-183`