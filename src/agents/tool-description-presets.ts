export const EXEC_TOOL_DISPLAY_SUMMARY = "Run shell commands that start now.";
export const PROCESS_TOOL_DISPLAY_SUMMARY = "Inspect and control running exec sessions.";
export const CRON_TOOL_DISPLAY_SUMMARY = "Schedule cron jobs, reminders, and wake events.";
export const SESSIONS_LIST_TOOL_DISPLAY_SUMMARY =
  "List visible sessions and optional recent messages.";
export const SESSIONS_HISTORY_TOOL_DISPLAY_SUMMARY =
  "Read sanitized message history for a visible session.";
export const SESSIONS_SEND_TOOL_DISPLAY_SUMMARY = "Send a message to another visible session.";
export const SESSIONS_SPAWN_TOOL_DISPLAY_SUMMARY = "Spawn sub-agent or ACP sessions.";
export const SESSION_STATUS_TOOL_DISPLAY_SUMMARY = "Show session status, usage, and model state.";
export const UPDATE_PLAN_TOOL_DISPLAY_SUMMARY = "Track a short structured work plan.";
export const TOOL_SEARCH_TOOL_DISPLAY_SUMMARY = "Search the current tool inventory by intent.";
export const ENTER_PLAN_MODE_TOOL_DISPLAY_SUMMARY = "Persist and activate structured plan mode.";
export const EXIT_PLAN_MODE_TOOL_DISPLAY_SUMMARY =
  "Close structured plan mode and persist the outcome.";
export const ENTER_WORKTREE_TOOL_DISPLAY_SUMMARY = "Create and activate a session worktree.";
export const EXIT_WORKTREE_TOOL_DISPLAY_SUMMARY =
  "Deactivate the session worktree and optionally remove it.";
export const TEAM_CREATE_TOOL_DISPLAY_SUMMARY =
  "Create a managed sub-agent team for the current session.";
export const TEAM_STATUS_TOOL_DISPLAY_SUMMARY =
  "Inspect a managed team/swarm and sync worker status.";
export const TEAM_CLOSE_TOOL_DISPLAY_SUMMARY =
  "Close a managed team/swarm and optionally stop active workers.";

export function describeSessionsListTool(): string {
  return [
    "List visible sessions with optional filters for kind, recent activity, and last messages.",
    "Use this to discover a target session before calling sessions_history or sessions_send.",
  ].join(" ");
}

export function describeSessionsHistoryTool(): string {
  return [
    "Fetch sanitized message history for a visible session.",
    "Supports limits and optional tool messages; use this to inspect another session before replying, debugging, or resuming work.",
  ].join(" ");
}

export function describeSessionsSendTool(): string {
  return [
    "Send a message into another visible session by sessionKey or label.",
    "Use this to delegate follow-up work to an existing session; waits for the target run and returns the updated assistant reply when available.",
  ].join(" ");
}

export function describeSessionsSpawnTool(): string {
  return [
    'Spawn an isolated session with `runtime="subagent"` or `runtime="acp"`.',
    '`mode="run"` is one-shot and `mode="session"` is persistent or thread-bound.',
    "Subagents inherit the parent workspace directory automatically.",
    "Use this when the work should happen in a fresh child session instead of the current one.",
  ].join(" ");
}

export function describeSessionStatusTool(): string {
  return [
    "Show a /status-equivalent session status card for the current or another visible session, including usage, time, cost when available, and linked background task context.",
    "Optional `model` sets a per-session model override; `model=default` resets overrides.",
    "Use this for questions like what model is active or how a session is configured.",
  ].join(" ");
}

export function describeUpdatePlanTool(): string {
  return [
    "Update the current structured work plan for this run.",
    "Use this for non-trivial multi-step work so the plan stays current while execution continues.",
    "Keep steps short, mark at most one step as `in_progress`, and skip this tool for simple one-step tasks.",
  ].join(" ");
}

export function describeToolSearchTool(): string {
  return [
    "Search the currently available tool inventory using intent words, tool names, or capability hints.",
    "Use `select:<tool>` to confirm one or more tool names after discovery.",
    "Current selection is advisory only; the runtime already exposes available tools directly.",
  ].join(" ");
}

export function describeEnterPlanModeTool(): string {
  return [
    "Persist and activate structured plan mode for the current session.",
    "Use this before longer multi-step work when you want a durable goal and planning artifact tied to the session.",
  ].join(" ");
}

export function describeExitPlanModeTool(): string {
  return [
    "Persist the final plan outcome and mark plan mode inactive for the current session.",
    "Use this when the planned work is complete, cancelled, or explicitly approved.",
  ].join(" ");
}

export function describeEnterWorktreeTool(): string {
  return [
    "Create a git worktree for the current session and persist it as the active session workspace.",
    "Use this for isolated branch work, risky edits, or parallel implementation tracks without changing the primary checkout.",
  ].join(" ");
}

export function describeExitWorktreeTool(): string {
  return [
    "Deactivate the current session worktree and optionally remove it from disk.",
    "Use this after finishing isolated branch work or when you want the session to return to its default workspace.",
  ].join(" ");
}

export function describeTeamCreateTool(): string {
  return [
    "Create a managed orchestration flow for a small worker team and optionally spawn worker sub-agents immediately.",
    "Use this when the task benefits from multiple tracked workers instead of ad-hoc manual subagent bookkeeping.",
  ].join(" ");
}

export function describeTeamStatusTool(): string {
  return [
    "Inspect a managed team/swarm flow, refresh worker lifecycle state from subagent runs, and summarize progress.",
    "Use this to check which workers are still running, which ones failed, and whether the team is complete.",
  ].join(" ");
}

export function describeTeamCloseTool(): string {
  return [
    "Close a managed team/swarm flow and optionally stop active worker runs owned by the current session.",
    "Use this when the team goal is complete, cancelled, or needs cleanup before merging results.",
  ].join(" ");
}
