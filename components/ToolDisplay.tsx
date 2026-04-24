"use client";

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlarmClock,
  Bell,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FilePen,
  FilePlus,
  FileText,
  Files,
  Globe,
  ListChecks,
  ListPlus,
  Notebook,
  PackageSearch,
  Pencil,
  Plug,
  Route,
  Search,
  Slash,
  Square,
  Terminal,
  Workflow,
  Zap,
} from "lucide-react";

export function shortPath(p: string): string {
  const basename = p.split("/").filter(Boolean).pop() ?? p;
  return basename.replace(/\.md$/i, "");
}

function stripMcpPrefix(name: string): string {
  // mcp__<server>__<tool> → <server>/<tool>
  if (!name.startsWith("mcp__")) return name;
  const rest = name.slice(5);
  const sep = rest.indexOf("__");
  if (sep === -1) return rest;
  return `${rest.slice(0, sep)}/${rest.slice(sep + 2)}`;
}

// Gray by default. Only assign a color when it carries real information at
// a glance: destructive (red), file mutation (amber), network (blue),
// spawning a subagent (emerald). Everything else stays gray — status
// (running/error) is conveyed separately so we don't steal these colors for it.
const COLOR_MAP: Record<string, string> = {
  // destructive
  KillShell: "text-red-400",
  TaskStop: "text-red-400",
  CronDelete: "text-red-400",
  ExitWorktree: "text-red-400",
  // file mutations — Write (whole-file replace) is bolder than Edit
  // (surgical) so they're easy to tell apart at a glance.
  Write: "text-orange-400",
  Edit: "text-amber-400",
  MultiEdit: "text-amber-400",
  NotebookEdit: "text-amber-400",
  // spawn a subagent
  Task: "text-emerald-400",
  Agent: "text-emerald-400",
  // network / external
  WebFetch: "text-blue-400",
  WebSearch: "text-blue-400",
  RemoteTrigger: "text-blue-400",
};
const DEFAULT_ICON_COLOR = "text-zinc-400";

const ICON_MAP: Record<string, LucideIcon> = {
  // Claude Code built-in tools
  Bash: Terminal,
  BashOutput: Terminal,
  KillShell: Square,
  Read: FileText,
  Write: FilePlus,
  Edit: Pencil,
  MultiEdit: FilePen,
  Glob: Files,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Search,
  Task: Workflow,
  Agent: Workflow,
  TodoWrite: ListChecks,
  NotebookEdit: Notebook,
  NotebookRead: BookOpen,
  SlashCommand: Slash,
  ExitPlanMode: Route,
  EnterPlanMode: Route,
  // Harness-provided
  TaskCreate: ListPlus,
  TaskUpdate: ClipboardCheck,
  TaskList: ClipboardList,
  TaskGet: ClipboardList,
  TaskOutput: FileText,
  TaskStop: Square,
  ToolSearch: PackageSearch,
  ScheduleWakeup: AlarmClock,
  CronCreate: Clock,
  CronList: Clock,
  CronDelete: Clock,
  PushNotification: Bell,
  Monitor: Activity,
  RemoteTrigger: Zap,
  EnterWorktree: Route,
  ExitWorktree: Route,
};

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    const p = u.pathname === "/" ? "" : u.pathname;
    return u.hostname + p;
  } catch {
    return url;
  }
}

type TodoItem = { content?: string; status?: string };

function todoSummary(todos: TodoItem[]): string {
  if (todos.length === 0) return "empty list";
  const done = todos.filter((t) => t.status === "completed").length;
  const inProg = todos.find((t) => t.status === "in_progress");
  const counts = `${done}/${todos.length}`;
  if (inProg?.content) {
    const c = inProg.content.slice(0, 80);
    return `${counts} · ${c}`;
  }
  return counts + " done";
}

/**
 * Returns a clean one-line summary for the most useful payload of a tool call.
 * Designed against real session data — prefers human-readable fields
 * (description, first line of command, hostname) over raw serialization.
 */
export function summarize(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return "";
  const tool = stripMcpPrefix(name).split("/").pop() ?? name;

  switch (tool) {
    case "Bash": {
      // Agents usually write a short `description`; prefer it over the raw
      // command. Fall back to the first non-empty line of the command.
      if (typeof input.description === "string" && input.description.trim()) {
        return input.description.trim();
      }
      if (typeof input.command === "string") {
        const firstLine =
          input.command.split("\n").find((l: string) => l.trim()) ?? "";
        return firstLine.slice(0, 140);
      }
      return "";
    }
    case "BashOutput":
      if (typeof input.bash_id === "string") {
        const f = typeof input.filter === "string" ? ` ~ ${input.filter}` : "";
        return `bg ${input.bash_id.slice(0, 8)}${f}`;
      }
      return "";
    case "KillShell":
      if (typeof input.shell_id === "string") return `bg ${input.shell_id.slice(0, 8)}`;
      return "";
    case "Read": {
      if (typeof input.file_path !== "string") return "";
      const p = shortPath(input.file_path);
      const offset = typeof input.offset === "number" ? input.offset : null;
      const limit = typeof input.limit === "number" ? input.limit : null;
      if (offset !== null && limit !== null) return `${p} :${offset}-${offset + limit}`;
      if (offset !== null) return `${p} :${offset}+`;
      return p;
    }
    case "Write":
    case "Edit":
      if (typeof input.file_path === "string") return shortPath(input.file_path);
      return "";
    case "MultiEdit":
      if (typeof input.file_path === "string") {
        const n = Array.isArray(input.edits) ? input.edits.length : 0;
        return `${shortPath(input.file_path)} · ${n} edit${n === 1 ? "" : "s"}`;
      }
      return "";
    case "NotebookEdit":
      if (typeof input.notebook_path === "string") return shortPath(input.notebook_path);
      return "";
    case "Glob": {
      if (typeof input.pattern !== "string") return "";
      const p = typeof input.path === "string" ? ` in ${shortPath(input.path)}` : "";
      return input.pattern + p;
    }
    case "Grep": {
      if (typeof input.pattern !== "string") return "";
      const loc =
        typeof input.path === "string"
          ? ` in ${shortPath(input.path)}`
          : typeof input.glob === "string"
            ? ` in ${input.glob}`
            : typeof input.type === "string"
              ? ` in .${input.type}`
              : "";
      return input.pattern + loc;
    }
    case "WebFetch":
      if (typeof input.url === "string") return hostOf(input.url);
      return "";
    case "WebSearch":
      if (typeof input.query === "string") return input.query;
      return "";
    case "Task":
    case "Agent": {
      if (typeof input.description !== "string") return "";
      const st =
        typeof input.subagent_type === "string" ? `[${input.subagent_type}] ` : "";
      return st + input.description;
    }
    case "TodoWrite":
      if (Array.isArray(input.todos)) return todoSummary(input.todos as TodoItem[]);
      return "";
    case "SlashCommand":
      if (typeof input.command === "string") return input.command;
      return "";
    case "ExitPlanMode":
    case "EnterPlanMode":
      return "";
    case "TaskCreate":
      if (typeof input.subject === "string") return input.subject;
      return "";
    case "TaskUpdate": {
      const status =
        typeof input.status === "string" ? ` → ${input.status}` : "";
      if (typeof input.taskId === "string") return `#${input.taskId}${status}`;
      return status.slice(3) || "";
    }
    case "TaskList":
      return "list tasks";
    case "TaskGet":
      if (typeof input.taskId === "string") return `#${input.taskId}`;
      return "";
    case "TaskOutput":
    case "TaskStop":
      if (typeof input.taskId === "string") return `#${input.taskId}`;
      return "";
    case "ToolSearch":
      if (typeof input.query === "string") return input.query;
      return "";
    case "ScheduleWakeup":
      if (typeof input.delaySeconds === "number") {
        const reason =
          typeof input.reason === "string" ? ` · ${input.reason}` : "";
        return `in ${input.delaySeconds}s${reason}`;
      }
      return "";
    case "CronCreate":
      if (typeof input.cron === "string") return input.cron;
      return typeof input.description === "string" ? input.description : "";
    case "PushNotification":
      if (typeof input.title === "string") return input.title;
      return "";
    case "RemoteTrigger":
      if (typeof input.url === "string") return hostOf(input.url);
      return "";
  }

  // Fallback: try common keys
  if (typeof input.description === "string") return input.description;
  if (typeof input.query === "string") return input.query;
  if (typeof input.name === "string") return input.name;
  if (typeof input.path === "string") return shortPath(input.path);
  if (typeof input.file_path === "string") return shortPath(input.file_path);
  if (typeof input.url === "string") return hostOf(input.url);
  if (typeof input.prompt === "string") return input.prompt.slice(0, 120);
  return "";
}

export type ToolDisplayInfo = {
  icon: LucideIcon | null;
  /** Tailwind text-color class for the icon/name (semantic, not status). */
  iconColor: string;
  displayName: string;
  summary: string;
  isMcp: boolean;
};

export function toolDisplay(
  name: string,
  input: Record<string, unknown> | undefined,
): ToolDisplayInfo {
  const isMcp = name.startsWith("mcp__");
  const displayName = stripMcpPrefix(name);
  const lookupKey = displayName.split("/").pop() ?? displayName;
  const icon = ICON_MAP[lookupKey] ?? (isMcp ? Plug : null);
  const iconColor = COLOR_MAP[lookupKey] ?? DEFAULT_ICON_COLOR;
  return {
    icon,
    iconColor,
    displayName,
    summary: summarize(name, input),
    isMcp,
  };
}
