// Mock harness for pi-organizer v3.1 (strictly lazy + task folders) — run: node test_organizer_v2.mjs
import { mkdtempSync, writeFileSync, existsSync, readFileSync, utimesSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const EXT = new URL("./extensions/organizer.ts", import.meta.url).href;
const mod = await import(EXT);

class MockUI {
  constructor() { this.notifications = []; }
  notify(msg) { this.notifications.push(msg); }
}
class MockPi {
  constructor() { this.handlers = {}; this.tools = {}; }
  on(event, handler) { this.handlers[event] = handler; return () => {}; }
  registerTool(spec) { this.tools[spec.name] = spec; }
  registerCommand() { throw new Error("v3 must not register commands"); }
}
class Ctx {
  constructor(ui) { this.hasUI = true; this.ui = ui; }
}

const runner = { pass: 0, fail: 0 };
async function test(name, fn) {
  const sandbox = mkdtempSync(join(tmpdir(), "orgv3-"));
  process.chdir(sandbox);
  const pi = new MockPi();
  mod.default(pi);
  const ctx = new Ctx(new MockUI());
  await pi.handlers.session_start({}, ctx);
  try {
    await fn(sandbox, pi, ctx);
    runner.pass++;
    console.log("PASS", name);
  } catch (e) {
    runner.fail++;
    console.log("FAIL", name, "::", e.message);
    console.log("  notifications:", JSON.stringify(ctx.ui.notifications));
    console.log("  root now:", readdirSync(sandbox));
  } finally {
    process.chdir(tmpdir());
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await test("lazy: session_start creates NOTHING", async (sb) => {
  assert.ok(!existsSync(join(sb, "01_uploads")), "uploads must not exist yet");
  assert.ok(!existsSync(join(sb, "02_deliverables")), "deliverables must not exist yet");
  assert.ok(!existsSync(join(sb, "03_agent_aux")), "aux must not exist yet");
});

await test("routing a .docx creates deliverables on demand", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "report.docx" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, join(sb, "02_deliverables", "report.docx"));
  assert.ok(existsSync(join(sb, "02_deliverables")), "folder created on demand");
  assert.ok(!existsSync(join(sb, "03_agent_aux")), "unused folders stay unborn");
});

await test("routing a .md creates aux on demand", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "notes.md" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, join(sb, "03_agent_aux", "notes.md"));
});

await test("nested path inside deliverables: parent auto-created, path untouched", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "02_deliverables/期中试卷/卷1.docx" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, "02_deliverables/期中试卷/卷1.docx", "nested path must stay untouched");
  assert.ok(existsSync(join(sb, "02_deliverables", "期中试卷")), "parent folder auto-created");
});

await test("nested path elsewhere: parent auto-created, untouched", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "reports/custom/x.md" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, "reports/custom/x.md", "nested path must stay untouched");
  assert.ok(existsSync(join(sb, "reports", "custom")), "parent auto-created");
});

await test("organizer_task does NOT create empty folders until files are written", async (sb, pi, ctx) => {
  assert.ok(pi.tools.organizer_task, "tool must be registered");
  const res = await pi.tools.organizer_task.execute("t1", { name: "10份试卷" });
  assert.match(res.content[0].text, /10份试卷/);
  assert.ok(!existsSync(join(sb, "02_deliverables")), "must not create deliverables before a file is written");
  assert.ok(!existsSync(join(sb, "03_agent_aux")), "must not create aux before a file is written");

  // Once a deliverable is actually written, only the deliverables task folder appears
  const ev = { toolName: "write", input: { path: "卷1.docx" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, join(sb, "02_deliverables", "10份试卷", "卷1.docx"));
  assert.ok(existsSync(join(sb, "02_deliverables", "10份试卷")));
  assert.ok(!existsSync(join(sb, "03_agent_aux")), "unused aux folder must still not exist");
});

await test("keepInRoot respected (README.md)", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "README.md" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, "README.md");
});

await test("outside-workspace path respected", async (sb, pi, ctx) => {
  const outside = join(tmpdir(), "outside-asset.png");
  const ev = { toolName: "write", input: { path: outside } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, outside);
});

await test("agent_end sweeps bash-generated pdf (folder on demand)", async (sb, pi, ctx) => {
  writeFileSync(join(sb, "output.pdf"), "%PDF-");
  await pi.handlers.agent_end({}, ctx);
  assert(existsSync(join(sb, "02_deliverables", "output.pdf")));
  assert(!existsSync(join(sb, "output.pdf")));
});

await test("agent_end with no new files creates NOTHING (lazy)", async (sb, pi, ctx) => {
  await pi.handlers.agent_end({}, ctx);
  assert.ok(!existsSync(join(sb, "02_deliverables")), "no empty folders");
  assert.ok(!existsSync(join(sb, "01_uploads")), "no empty folders");
});

await test("agent_end keeps pre-session files even if mtime is touched", async (sb, pi, ctx) => {
  const old = join(sb, "old.csv");
  writeFileSync(old, "x");
  // Re-trigger session_start so old.csv is part of initial root snapshot
  await pi.handlers.session_start({}, ctx);
  const now = Date.now() / 1000 + 10;
  utimesSync(old, now, now);
  await pi.handlers.agent_end({}, ctx);
  assert(existsSync(old), "pre-session file must stay in root even if mtime updates");
  assert(!existsSync(join(sb, "01_uploads")), "no folder created for pre-session file");
});

await test("agent_end keeps pre-session files with old mtime", async (sb, pi, ctx) => {
  const old = join(sb, "legacy.csv");
  writeFileSync(old, "x");
  const past = Date.now() / 1000 - 86400;
  utimesSync(old, past, past);
  await pi.handlers.agent_end({}, ctx);
  assert(existsSync(old), "pre-session file must stay in root");
});

await test("manifest records routing", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "a.py" } };
  await pi.handlers.tool_call(ev, ctx);
  const manifest = JSON.parse(readFileSync(join(sb, "organize.manifest.json"), "utf8"));
  assert.equal(manifest.at(-1).from, "a.py");
  assert.equal(manifest.at(-1).to.replaceAll("\\", "/"), "03_agent_aux/a.py");
});

await test("v3 registers no slash commands", async () => {
  const pi = new MockPi();
  let threw = false;
  try { mod.default(pi); } catch { threw = true; }
  assert.ok(!threw, "factory must not throw");
  assert.ok(pi.tools.organizer_task, "organizer_task tool must exist");
});

console.log(`\n${runner.pass} passed, ${runner.fail} failed`);
process.exit(runner.fail ? 1 : 0);