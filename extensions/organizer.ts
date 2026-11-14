import fs from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Bucket = "uploads" | "deliverables" | "aux";

interface OrganizerConfig {
  folders: Record<Bucket, string>;
  keepInRoot: string[];
  deliverableKeywords: string[];
  auxKeywords: string[];
  groupByMonth: boolean;
}

interface ManifestEntry {
  timestamp: string;
  action: "routed" | "swept" | "uploaded";
  bucket: Bucket;
  task: string | null;
  from: string;
  to: string;
  undone?: boolean;
}

interface ManifestFile {
  version: number;
  entries: ManifestEntry[];
}

const DEFAULT_CONFIG: OrganizerConfig = {
  folders: {
    uploads: "01_uploads",
    deliverables: "02_deliverables",
    aux: "03_agent_aux",
  },
  keepInRoot: [
    "README.md",
    "README.zh.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "LICENSE.md",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "tsconfig.json",
    "jsconfig.json",
    ".gitignore",
    ".env",
    ".env.example",
    "organize.config.json",
    "organize.manifest.json",
  ],
  deliverableKeywords: [
    "final",
    "deliverable",
    "report",
    "summary",
    "proposal",
    "spec",
    "manual",
    "guide",
    "定稿",
    "终稿",
    "最终版",
    "报告",
    "总结",
    "方案",
    "交付",
    "试卷",
    "讲义",
    "大纲",
  ],
  auxKeywords: [
    "draft",
    "wip",
    "tmp",
    "temp",
    "scratch",
    "preview",
    "backup",
    "notes",
    "草稿",
    "临时",
    "预览",
    "备份",
    "笔记",
  ],
  groupByMonth: false,
};

const DELIVERABLE_EXTS = new Set([
  ".docx",
  ".pdf",
  ".xlsx",
  ".pptx",
  ".epub",
  ".csv",
]);

const AUX_EXTS = new Set([
  ".md",
  ".txt",
  ".html",
  ".htm",
  ".py",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".sh",
  ".ps1",
  ".bat",
  ".sql",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".log",
  ".tex",
]);

function normalizeKey(name: string): string {
  return process.platform === "win32" ? name.toLowerCase() : name;
}

function sanitizeSegment(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || "task";
}

function loadConfig(cwd: string): OrganizerConfig {
  const configPath = path.join(cwd, "organize.config.json");
  if (!fs.existsSync(configPath)) {
    return {
      folders: { ...DEFAULT_CONFIG.folders },
      keepInRoot: [...DEFAULT_CONFIG.keepInRoot],
      deliverableKeywords: [...DEFAULT_CONFIG.deliverableKeywords],
      auxKeywords: [...DEFAULT_CONFIG.auxKeywords],
      groupByMonth: DEFAULT_CONFIG.groupByMonth,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      folders: {
        uploads: parsed?.folders?.uploads || DEFAULT_CONFIG.folders.uploads,
        deliverables:
          parsed?.folders?.deliverables || DEFAULT_CONFIG.folders.deliverables,
        aux: parsed?.folders?.aux || DEFAULT_CONFIG.folders.aux,
      },
      keepInRoot: Array.from(
        new Set([
          ...DEFAULT_CONFIG.keepInRoot,
          ...(Array.isArray(parsed?.keepInRoot) ? parsed.keepInRoot : []),
        ])
      ),
      deliverableKeywords: Array.from(
        new Set([
          ...DEFAULT_CONFIG.deliverableKeywords,
          ...(Array.isArray(parsed?.deliverableKeywords)
            ? parsed.deliverableKeywords
            : []),
        ])
      ),
      auxKeywords: Array.from(
        new Set([
          ...DEFAULT_CONFIG.auxKeywords,
          ...(Array.isArray(parsed?.auxKeywords) ? parsed.auxKeywords : []),
        ])
      ),
      groupByMonth: Boolean(parsed?.groupByMonth),
    };
  } catch {
    return {
      folders: { ...DEFAULT_CONFIG.folders },
      keepInRoot: [...DEFAULT_CONFIG.keepInRoot],
      deliverableKeywords: [...DEFAULT_CONFIG.deliverableKeywords],
      auxKeywords: [...DEFAULT_CONFIG.auxKeywords],
      groupByMonth: DEFAULT_CONFIG.groupByMonth,
    };
  }
}

function isProtectedRoot(baseName: string, config: OrganizerConfig): boolean {
  if (baseName.startsWith(".")) return true;
  const target = normalizeKey(baseName);
  return config.keepInRoot.some((item) => normalizeKey(item) === target);
}

function matchesKeyword(stem: string, rawKeyword: string): boolean {
  const kw = rawKeyword.trim().toLowerCase();
  if (!kw) return false;
  if (/^[a-z0-9_-]+$/.test(kw)) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
    return re.test(stem);
  }
  return stem.includes(kw);
}

function classifyFile(fileName: string, config: OrganizerConfig): Bucket {
  const parsed = path.parse(fileName);
  const stem = parsed.name.toLowerCase();
  const ext = parsed.ext.toLowerCase();

  for (const kw of config.auxKeywords) {
    if (matchesKeyword(stem, kw)) {
      return "aux";
    }
  }

  for (const kw of config.deliverableKeywords) {
    if (matchesKeyword(stem, kw)) {
      return "deliverables";
    }
  }

  if (DELIVERABLE_EXTS.has(ext)) return "deliverables";
  if (AUX_EXTS.has(ext)) return "aux";
  return "uploads";
}

function getMonthStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function buildTargetDir(
  cwd: string,
  bucket: Bucket,
  activeTask: string | null,
  config: OrganizerConfig
): string {
  const parts = [cwd, config.folders[bucket]];
  if (bucket !== "uploads") {
    if (config.groupByMonth) {
      parts.push(getMonthStamp());
    }
    if (activeTask) {
      parts.push(activeTask);
    }
  }
  return path.join(...parts);
}

function isInsideWorkspace(cwd: string, targetAbs: string): boolean {
  const rel = path.relative(cwd, targetAbs);
  if (!rel || rel === ".") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function moveFileSafe(srcAbs: string, destAbs: string): void {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  try {
    fs.renameSync(srcAbs, destAbs);
  } catch {
    fs.copyFileSync(srcAbs, destAbs);
    fs.unlinkSync(srcAbs);
  }
}

function appendManifest(cwd: string, entry: ManifestEntry): void {
  const manifestPath = path.join(cwd, "organize.manifest.json");
  let data: ManifestFile = { version: 1, entries: [] };
  if (fs.existsSync(manifestPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (existing && Array.isArray(existing.entries)) {
        data = existing;
      }
    } catch {
      // Preserve fresh structure if corrupted
    }
  }
  data.entries.push(entry);
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function removeEmptyAncestors(
  startDir: string,
  stopDir: string,
  allowedRoots: Set<string>
): void {
  let current = startDir;
  while (current !== stopDir && current.startsWith(stopDir)) {
    const rel = path.relative(stopDir, current);
    const topFolder = rel.split(path.sep)[0];
    if (!allowedRoots.has(topFolder)) break;
    try {
      const items = fs.readdirSync(current);
      if (items.length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

export default function piOrganizer(pi: ExtensionAPI) {
  let preSessionEntries = new Set<string>();
  let activeTask: string | null = null;
  let initializedCwd: string | null = null;

  function ensureSnapshot(cwd: string) {
    if (initializedCwd === cwd) return;
    initializedCwd = cwd;
    preSessionEntries = new Set<string>();
    try {
      for (const entry of fs.readdirSync(cwd)) {
        preSessionEntries.add(normalizeKey(entry));
      }
    } catch {
      // Ignore unreadable cwd
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    activeTask = null;
    initializedCwd = null;
    ensureSnapshot(ctx.cwd);
  });

  pi.on("tool_call", async (event, ctx) => {
    const cwd = ctx.cwd;
    ensureSnapshot(cwd);
    const config = loadConfig(cwd);

    // 1. Intercept file writes: route root files lazily, keep explicit subfolders untouched
    if (event.toolName === "write" && typeof event.input?.path === "string") {
      const rawPath = event.input.path;
      const absTarget = path.resolve(cwd, rawPath);

      if (!isInsideWorkspace(cwd, absTarget)) {
        return;
      }

      const rel = path.relative(cwd, absTarget);
      const segments = rel.split(path.sep).filter(Boolean);

      if (segments.length > 1) {
        fs.mkdirSync(path.dirname(absTarget), { recursive: true });
        return;
      }

      const baseName = segments[0];
      if (!baseName || isProtectedRoot(baseName, config)) {
        return;
      }

      const bucket = classifyFile(baseName, config);
      const targetDir = buildTargetDir(cwd, bucket, activeTask, config);
      const destAbs = path.join(targetDir, baseName);
      const destRel = path.relative(cwd, destAbs);

      fs.mkdirSync(targetDir, { recursive: true });
      event.input.path = destRel;

      appendManifest(cwd, {
        timestamp: new Date().toISOString(),
        action: "routed",
        bucket,
        task: activeTask,
        from: baseName,
        to: destRel.split(path.sep).join("/"),
      });
      return;
    }

    // 2. Intercept file reads: auto-organize user-dropped reference files in root into 01_uploads/
    if (event.toolName === "read" && typeof event.input?.path === "string") {
      const rawPath = event.input.path;
      const absTarget = path.resolve(cwd, rawPath);

      if (!isInsideWorkspace(cwd, absTarget)) {
        return;
      }

      const rel = path.relative(cwd, absTarget);
      const segments = rel.split(path.sep).filter(Boolean);
      if (segments.length !== 1) return;

      const baseName = segments[0];
      if (
        !baseName ||
        preSessionEntries.has(normalizeKey(baseName)) ||
        isProtectedRoot(baseName, config)
      ) {
        return;
      }

      try {
        if (!fs.existsSync(absTarget) || !fs.statSync(absTarget).isFile()) {
          return;
        }
        const uploadsDir = buildTargetDir(cwd, "uploads", null, config);
        const destAbs = path.join(uploadsDir, baseName);
        const destRel = path.relative(cwd, destAbs);

        moveFileSafe(absTarget, destAbs);
        event.input.path = destRel;

        appendManifest(cwd, {
          timestamp: new Date().toISOString(),
          action: "uploaded",
          bucket: "uploads",
          task: null,
          from: baseName,
          to: destRel.split(path.sep).join("/"),
        });
      } catch {
        // Leave original path intact if move fails
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    const cwd = ctx.cwd;
    ensureSnapshot(cwd);
    const config = loadConfig(cwd);
    const managedRoots = new Set(Object.values(config.folders).map(normalizeKey));

    let entries: string[] = [];
    try {
      entries = fs.readdirSync(cwd);
    } catch {
      return;
    }

    for (const entry of entries) {
      const key = normalizeKey(entry);
      if (preSessionEntries.has(key) || managedRoots.has(key)) {
        continue;
      }
      if (isProtectedRoot(entry, config)) {
        continue;
      }

      const srcAbs = path.join(cwd, entry);
      try {
        const stat = fs.statSync(srcAbs);
        if (!stat.isFile()) continue;

        const bucket = classifyFile(entry, config);
        const targetDir = buildTargetDir(cwd, bucket, activeTask, config);
        const destAbs = path.join(targetDir, entry);
        const destRel = path.relative(cwd, destAbs);

        moveFileSafe(srcAbs, destAbs);

        appendManifest(cwd, {
          timestamp: new Date().toISOString(),
          action: "swept",
          bucket,
          task: activeTask,
          from: entry,
          to: destRel.split(path.sep).join("/"),
        });
      } catch {
        // Never fail the session on sweep errors
      }
    }
  });

  pi.registerTool({
    name: "organizer_task",
    label: "Organizer Task",
    description:
      "Set or clear the active task subfolder for multi-file deliverables and auxiliary files. Folders are created lazily only when files are actually written.",
    parameters: Type.Object({
      task: Type.String({
        description:
          "Short descriptive task name (e.g. '10份试卷' or 'q4-financial-report').",
      }),
      action: Type.Optional(
        Type.Union([Type.Literal("start"), Type.Literal("end")], {
          description:
            "'start' (default) sets the active task folder; 'end' clears it so subsequent files go to top-level buckets.",
        })
      ),
    }),
    async execute(_toolCallId, params) {
      const action = params.action ?? "start";
      if (action === "end") {
        const prev = activeTask;
        activeTask = null;
        return {
          content: [
            {
              type: "text",
              text: prev
                ? `Ended task "${prev}". Subsequent files will route to top-level folders.`
                : "No active task was set.",
            },
          ],
          details: { activeTask: null },
        };
      }

      activeTask = sanitizeSegment(params.task);
      return {
        content: [
          {
            type: "text",
            text: `Active task set to "${activeTask}". Matching folders will be created on demand when files are written.`,
          },
        ],
        details: { activeTask },
      };
    },
  });

  pi.registerTool({
    name: "organizer_undo",
    label: "Organizer Undo",
    description:
      "Restore recently organized files back to their original workspace paths using organize.manifest.json without overwriting existing files.",
    parameters: Type.Object({
      count: Type.Optional(
        Type.Number({
          description: "Number of recent file moves to undo (default: 1).",
        })
      ),
      task: Type.Optional(
        Type.String({
          description:
            "Optional task name: if provided, undoes all active file moves for that task.",
        })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const manifestPath = path.join(cwd, "organize.manifest.json");
      if (!fs.existsSync(manifestPath)) {
        return {
          content: [
            { type: "text", text: "No organize.manifest.json found; nothing to undo." },
          ],
          details: { restored: [], skipped: [] },
        };
      }

      let data: ManifestFile;
      try {
        data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch {
        return {
          content: [{ type: "text", text: "Failed to parse organize.manifest.json." }],
          details: { restored: [], skipped: [] },
        };
      }

      const config = loadConfig(cwd);
      const allowedRoots = new Set(Object.values(config.folders));
      const activeEntries = data.entries
        .map((entry, idx) => ({ entry, idx }))
        .filter(({ entry }) => !entry.undone);

      let targets = activeEntries;
      if (params.task) {
        const normalizedTask = sanitizeSegment(params.task);
        targets = activeEntries.filter(
          ({ entry }) => entry.task === normalizedTask || entry.task === params.task
        );
      } else {
        const limit = Math.max(1, Math.floor(params.count ?? 1));
        targets = activeEntries.slice(-limit);
      }

      if (targets.length === 0) {
        return {
          content: [{ type: "text", text: "No matching file moves available to undo." }],
          details: { restored: [], skipped: [] },
        };
      }

      const restored: string[] = [];
      const skipped: string[] = [];

      for (const { entry, idx } of targets.reverse()) {
        const currentAbs = path.resolve(cwd, entry.to);
        const originalAbs = path.resolve(cwd, entry.from);

        if (!fs.existsSync(currentAbs)) {
          skipped.push(`${entry.to} (missing)`);
          continue;
        }
        if (fs.existsSync(originalAbs)) {
          skipped.push(`${entry.from} (already exists)`);
          continue;
        }

        moveFileSafe(currentAbs, originalAbs);
        removeEmptyAncestors(path.dirname(currentAbs), cwd, allowedRoots);
        data.entries[idx].undone = true;
        restored.push(`${entry.to} -> ${entry.from}`);
      }

      fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2) + "\n", "utf8");

      const summary = [
        restored.length ? `Restored:\n- ${restored.join("\n- ")}` : "",
        skipped.length ? `Skipped:\n- ${skipped.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: summary || "Nothing restored." }],
        details: { restored, skipped },
      };
    },
  });
}