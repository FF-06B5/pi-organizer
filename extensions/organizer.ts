/**
 * pi-organizer v2 — automatic workspace organizer for Pi sessions.
 *
 * No commands needed. On every session in a workspace this extension:
 *   1. session_start → creates the standard folder set (01_uploads / 02_deliverables / 03_agent_aux)
 *   2. tool_call (write/edit) → rewrites bare root-level target paths so files land in
 *      the right subfolder automatically (.docx/.pdf → 02_deliverables, else → 03_agent_aux)
 *   3. agent_end → sweeps loose files the agent created in the root during the session
 *      (e.g. pandoc/script outputs) into the same folders
 *
 * "Unless the user asks otherwise": any path the agent writes that is ALREADY nested
 * (e.g. 02_deliverables/x.docx or reports/x.md) is respected and never touched.
 * Files outside the workspace are never touched. Nothing is ever deleted.
 *
 * Config (optional): organize.config.json in the project root — see README.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

interface OrganizerConfig {
	auto: boolean;
	uploads: string;
	deliverables: string;
	aux: string;
	deliverableExtensions: string[];
	auxExtensions: string[];
	keepInRoot: string[];
}

const DEFAULT_CONFIG: OrganizerConfig = {
	auto: true,
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

function ensureFolders(root: string, cfg: OrganizerConfig): string[] {
	const dirs = [join(root, cfg.uploads), join(root, cfg.deliverables), join(root, cfg.aux)];
	for (const d of dirs) {
		mkdirSync(d, { recursive: true });
	}
	return dirs;
}

function classify(relName: string, cfg: OrganizerConfig): "deliverables" | "aux" | "uploads" {
	const ext = relName.slice(relName.lastIndexOf(".")).toLowerCase();
	if (cfg.deliverableExtensions.includes(ext)) return "deliverables";
	if (cfg.auxExtensions.includes(ext)) return "aux";
	return "uploads";
}

function uniqueDest(dest: string): string {
	if (!existsSync(dest)) return dest;
	const ext = dest.slice(dest.lastIndexOf("."));
	const stem = dest.slice(0, dest.length - ext.length);
	let i = 2;
	while (existsSync(`${stem}-${i}${ext}`)) i++;
	return `${stem}-${i}${ext}`;
}

/**
 * Move with retry: antivirus/indexers can hold a just-created file locked for a
 * moment (EPERM/EBUSY), so give the rename a few short attempts before giving up.
 */
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

export default function organizerExtension(pi: ExtensionAPI) {
	let sessionStart = Date.now();

	pi.on("session_start", async (_event, ctx) => {
		sessionStart = Date.now();
		const root = process.cwd();
		const cfg = loadConfig(root);
		if (!cfg.auto) return;
		ensureFolders(root, cfg);
		if (ctx.hasUI) {
			ctx.ui.notify("pi-organizer: workspace folders ready (01_uploads / 02_deliverables / 03_agent_aux)", "info");
		}
	});

	// Intercept write/edit: rewrite bare root-level paths into the right subfolder.
	pi.on("tool_call", async (event, ctx) => {
		const name = String(event.toolName || "").toLowerCase();
		if (name !== "write" && name !== "edit") return undefined;
		const cfg = loadConfig(process.cwd());
		if (!cfg.auto) return undefined;

		const input = (event.input || {}) as Record<string, unknown>;
		const pathKey = "path" in input ? "path" : "file_path" in input ? "file_path" : null;
		if (!pathKey) return undefined;
		const raw = String(input[pathKey] ?? "");
		if (!raw) return undefined;

		const root = process.cwd();
		const abs = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);
		const rel = relative(root, abs);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined; // outside workspace
		if (rel.includes("/") || rel.includes("\\")) return undefined; // already nested → respect it

		const lower = rel.toLowerCase();
		if (lower.startsWith(".")) return undefined;
		if (cfg.keepInRoot.some((k) => k === lower)) return undefined;

		const bucket = classify(rel, cfg);
		const destDir = bucket === "deliverables" ? join(root, cfg.deliverables) : bucket === "aux" ? join(root, cfg.aux) : join(root, cfg.uploads);
		mkdirSync(destDir, { recursive: true });
		const finalAbs = uniqueDest(join(destDir, rel));

		input[pathKey] = finalAbs;
		recordManifest(root, rel, relative(root, finalAbs));
		if (ctx.hasUI) {
			ctx.ui.notify(`pi-organizer: ${rel} → ${relative(root, finalAbs)}`, "info");
		}
		return undefined;
	});

	// Sweep: after each agent turn, file loose root files created this session
	// (catches bash-generated outputs like pandoc documents).
	pi.on("agent_end", async (_event, ctx) => {
		const root = process.cwd();
		const cfg = loadConfig(root);
		if (!cfg.auto) return;
		ensureFolders(root, cfg);

		const keep = new Set(cfg.keepInRoot.map((k) => k.toLowerCase()));
		const delivDir = join(root, cfg.deliverables);
		const auxDir = join(root, cfg.aux);
		const folders = [delivDir, auxDir, join(root, cfg.uploads)];

		const moved: string[] = [];
		for (const entry of readdirSync(root)) {
			const full = join(root, entry);
			let st;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (!st.isFile() || entry.startsWith(".") || folders.includes(full)) continue;
			if (keep.has(entry.toLowerCase())) continue;
			if (st.mtimeMs < sessionStart) continue; // not created this session
			const bucket = classify(entry, cfg);
			const destDir = bucket === "deliverables" ? delivDir : auxDir; // session-built → never uploads
			const finalAbs = uniqueDest(join(destDir, entry));
			try {
				const finalAbs2 = uniqueDest(finalAbs);
				moveWithRetry(full, finalAbs2);
				moved.push(`${entry} → ${relative(root, finalAbs2)}`);
				recordManifest(root, entry, relative(root, finalAbs2));
			} catch {
				moved.push(`FAILED: ${entry}`);
			}
		}
		if (moved.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`pi-organizer: filed ${moved.length} new file(s)\n${moved.join("\n")}`, "info");
		}
	});
}
