/**
 * pi-organizer v3.1 — automatic workspace organizer for Pi sessions (strictly lazy edition).
 *
 * Zero commands, zero upfront clutter:
 *   - No folders are created when a session starts or when `organizer_task` is called.
 *     Folders appear ONLY at the exact moment a new file is actually written or swept.
 *   - Files the agent writes straight into the workspace root are rerouted:
 *       .docx/.pdf -> 02_deliverables/   .md/.py/.html/.txt/... -> 03_agent_aux/
 *   - For multi-file deliverables (e.g. "10 worksheets + answers") the agent calls
 *     `organizer_task` once to register a subfolder name; folders are created lazily
 *     when files are actually written into them.
 *   - After each agent turn, shell-generated files (pandoc, compilers...) newly created
 *     in the root during this session are swept into the same folders.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "typebox";

interface OrganizerConfig {
	uploads: string;
	deliverables: string;
	aux: string;
	deliverableExtensions: string[];
	auxExtensions: string[];
	keepInRoot: string[];
}

const DEFAULT_CONFIG: OrganizerConfig = {
	uploads: "01_uploads",
	deliverables: "02_deliverables",
	aux: "03_agent_aux",
	deliverableExtensions: [".docx", ".pdf"],
	auxExtensions: [".md", ".py", ".html", ".txt", ".js", ".ts", ".json"],
	keepInRoot: ["readme.md", "organize.config.json", "organize.manifest.json", "package.json"],
};

const MANIFEST = "organize.manifest.json";

function loadConfig(root: string): OrganizerConfig {
	const p = join(root, "organize.config.json");
	if (!existsSync(p)) {
		return DEFAULT_CONFIG;
	}
	try {
		const user = JSON.parse(readFileSync(p, "utf8")) as Partial<OrganizerConfig>;
		return { ...DEFAULT_CONFIG, ...user };
	} catch {
		return DEFAULT_CONFIG;
	}
}

function captureRootSnapshot(root: string): Set<string> {
	const entries = new Set<string>();
	try {
		for (const entry of readdirSync(root)) {
			entries.add(entry.toLowerCase());
		}
	} catch {
		// ignore unreadable directory
	}
	return entries;
}

function classify(relName: string, cfg: OrganizerConfig): "deliverables" | "aux" | "uploads" {
	const ext = relName.slice(relName.lastIndexOf(".")).toLowerCase();
	if (cfg.deliverableExtensions.includes(ext)) return "deliverables";
	if (cfg.auxExtensions.includes(ext)) return "aux";
	return "uploads";
}

function bucketDir(root: string, cfg: OrganizerConfig, bucket: "deliverables" | "aux" | "uploads"): string {
	return join(root, bucket === "deliverables" ? cfg.deliverables : bucket === "aux" ? cfg.aux : cfg.uploads);
}

function uniqueDest(dest: string): string {
	if (!existsSync(dest)) return dest;
	const ext = dest.slice(dest.lastIndexOf("."));
	const stem = dest.slice(0, dest.length - ext.length);
	let i = 2;
	while (existsSync(`${stem}-${i}${ext}`)) i++;
	return `${stem}-${i}${ext}`;
}

/** Move with retry: antivirus/indexers can lock a just-created file (EPERM/EBUSY). */
function moveWithRetry(src: string, dest: string, attempts = 3, delayMs = 150): void {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			renameSync(src, dest);
			return;
		} catch (err) {
			if (attempt === attempts) throw err;
			const busy = String((err as Error).code || "").match(/EBUSY|EPERM|EACCES/);
			if (!busy) throw err;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
		}
	}
}

function recordManifest(root: string, originalRel: string, finalRel: string): void {
	try {
		const mfPath = join(root, MANIFEST);
		let manifest: Array<{ from: string; to: string; at: string }> = [];
		if (existsSync(mfPath)) {
			try {
				manifest = JSON.parse(readFileSync(mfPath, "utf8")) as Array<{ from: string; to: string; at: string }>;
			} catch {
				manifest = [];
			}
		}
		manifest.push({ from: originalRel, to: finalRel, at: new Date().toISOString() });
		writeFileSync(mfPath, JSON.stringify(manifest, null, 2), "utf8");
	} catch {
		// best-effort audit log; never block the tool call
	}
}

const TASK_PARAMS = Type.Object({
	name: Type.String({ description: "Short task folder name, e.g. 'worksheets-week5' or '期中试卷'" }),
});

export default function organizerExtension(pi: ExtensionAPI) {
	let sessionStart = Date.now();
	let knownRootFiles = captureRootSnapshot(process.cwd());
	let activeTask: string | null = null;

	// Strictly lazy: nothing is created here — folders appear only when a file is actually written.
	pi.on("session_start", async () => {
		sessionStart = Date.now();
		knownRootFiles = captureRootSnapshot(process.cwd());
		activeTask = null;
	});

	// Intercept write/edit in the workspace:
	//  - bare root file  -> reroute into the right folder (create it on demand)
	//  - nested path     -> keep it, just make sure the parent folder exists
	pi.on("tool_call", async (event, ctx) => {
		const name = String(event.toolName || "").toLowerCase();
		if (name !== "write" && name !== "edit") return undefined;
		const cfg = loadConfig(process.cwd());

		const input = (event.input || {}) as Record<string, unknown>;
		const pathKey = "path" in input ? "path" : "file_path" in input ? "file_path" : null;
		if (!pathKey) return undefined;
		const raw = String(input[pathKey] ?? "");
		if (!raw) return undefined;

		const root = process.cwd();
		const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
		const rel = relative(root, abs);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined; // outside workspace

		const lower = rel.toLowerCase();
		if (lower.startsWith(".")) return undefined;
		if (cfg.keepInRoot.some((k) => k === lower)) return undefined;

		const isBareRoot = !rel.includes("/") && !rel.includes("\\");
		if (isBareRoot) {
			const bucket = classify(rel, cfg);
			const baseDir = bucketDir(root, cfg, bucket);
			const destDir = activeTask ? join(baseDir, activeTask) : baseDir;
			mkdirSync(destDir, { recursive: true }); // created only when an actual file is written
			const finalAbs = uniqueDest(join(destDir, rel));
			input[pathKey] = finalAbs;
			recordManifest(root, rel, relative(root, finalAbs));
			if (ctx.hasUI) {
				ctx.ui.notify(`pi-organizer: ${rel} → ${relative(root, finalAbs)}`, "info");
			}
			return undefined;
		}

		// Nested: respect the agent's/user's choice, creating the parent folder right as the file is written.
		mkdirSync(resolve(abs, ".."), { recursive: true });
		return undefined;
	});

	// Sweep: after each agent turn, file loose root files newly created during this
	// session (catches bash-generated outputs like pandoc documents).
	pi.on("agent_end", async (_event, ctx) => {
		const root = process.cwd();
		const cfg = loadConfig(root);

		const keep = new Set(cfg.keepInRoot.map((k) => k.toLowerCase()));
		const moved: string[] = [];
		for (const entry of readdirSync(root)) {
			const full = join(root, entry);
			let st;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (!st.isFile() || entry.startsWith(".") || entry === MANIFEST) continue;
			if (keep.has(entry.toLowerCase())) continue;
			if (knownRootFiles.has(entry.toLowerCase())) continue; // existed before session
			if ([cfg.uploads, cfg.deliverables, cfg.aux].includes(entry)) continue;
			if (st.mtimeMs < sessionStart) continue; // existed before the session

			const bucket = classify(entry, cfg);
			const baseDir = bucketDir(root, cfg, bucket);
			const destDir = activeTask ? join(baseDir, activeTask) : baseDir;
			mkdirSync(destDir, { recursive: true }); // created only when needed
			const finalAbs = uniqueDest(join(destDir, entry));
			try {
				moveWithRetry(full, finalAbs);
				moved.push(`${entry} → ${relative(root, finalAbs)}`);
				recordManifest(root, entry, relative(root, finalAbs));
			} catch {
				moved.push(`FAILED: ${entry}`);
			}
		}
		if (moved.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`pi-organizer: filed ${moved.length} new file(s)\n${moved.join("\n")}`, "info");
		}
	});

	// Task folder registration on demand: registers the subfolder name without creating empty directories upfront.
	pi.registerTool({
		name: "organizer_task",
		label: "Set task folder name",
		description:
			"Register a short task subfolder name for an upcoming multi-file deliverable (e.g. '10份试卷' or 'worksheets-week5'). " +
			"ONLY call this tool when you are actually about to write multiple files to disk — NEVER call it for normal Q&A or text-only responses. " +
			"Folders are created lazily only when you actually write files into them.",
		promptSnippet: "Register a task subfolder name right before writing multi-file deliverables",
		promptGuidelines: [
			"NEVER call organizer_task when answering questions or when no files will be written to disk.",
			"ONLY when you are actually about to write multiple files (e.g. 10 worksheets plus answers), call organizer_task once with a short name, then write the files into the returned folders.",
		],
		parameters: TASK_PARAMS,
		async execute(_toolCallId, params) {
			const cfg = loadConfig(process.cwd());
			const name = String(params.name || "").trim().replace(/[^\w\u4e00-\u9fa5-]+/g, "-") || "task";
			activeTask = name;
			const root = process.cwd();
			const deliv = join(root, cfg.deliverables, name);
			const aux = join(root, cfg.aux, name);
			return {
				content: [
					{
						type: "text",
						text: `Task folder name '${name}' registered (folders will be created automatically when you write files):\n- deliverables: ${deliv}\n- aux: ${aux}`,
					},
				],
				details: { deliverables: deliv, aux },
			};
		},
	});
}