// Mock harness for pi-organizer v2 (automatic mode) — run: node test_organizer_v2.mjs
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, utimesSync, rmSync } from "node:fs";
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
  constructor() { this.handlers = {}; }
  on(event, handler) { this.handlers[event] = handler; return () => {}; }
  registerCommand() { throw new Error("v2 must not register commands"); }
}
class Ctx {
  constructor(ui) { this.hasUI = true; this.ui = ui; }
}

const runner = { pass: 0, fail: 0 };
async function test(name, fn) {
  const sandbox = mkdtempSync(join(tmpdir(), "orgv2-"));
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
  } finally {
    process.chdir(tmpdir());
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await test("session_start creates folder set", async (sb, pi, ctx) => {
  for (const d of ["01_uploads", "02_deliverables", "03_agent_aux"]) {
    assert(existsSync(join(sb, d)), d);
  }
});

await test("write .docx routed to deliverables", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "report.docx" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, join(sb, "02_deliverables", "report.docx"));
});

await test("write .md routed to aux", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "notes.md" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, join(sb, "03_agent_aux", "notes.md"));
});

await test("nested path respected (user-specified location)", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "reports/custom/x.docx" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, "reports/custom/x.docx");
});

await test("keepInRoot respected (README.md)", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "README.md" } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, "README.md");
});

await test("outside-workspace absolute path respected", async (sb, pi, ctx) => {
  const outside = join(tmpdir(), "outside-asset.png");
  const ev = { toolName: "write", input: { path: outside } };
  await pi.handlers.tool_call(ev, ctx);
  assert.equal(ev.input.path, outside);
});

await test("agent_end sweeps bash-generated pdf into deliverables", async (sb, pi, ctx) => {
  writeFileSync(join(sb, "output.pdf"), "%PDF-");
  await pi.handlers.agent_end({}, ctx);
  assert(existsSync(join(sb, "02_deliverables", "output.pdf")));
  assert(!existsSync(join(sb, "output.pdf")));
});

await test("agent_end keeps pre-session files", async (sb, pi, ctx) => {
  const old = join(sb, "old.csv");
  writeFileSync(old, "x");
  const past = Date.now() / 1000 - 86400;
  utimesSync(old, past, past);
  await pi.handlers.agent_end({}, ctx);
  assert(existsSync(old), "old file must stay in root");
});

await test("manifest records routing", async (sb, pi, ctx) => {
  const ev = { toolName: "write", input: { path: "a.py" } };
  await pi.handlers.tool_call(ev, ctx);
  const manifest = JSON.parse(readFileSync(join(sb, "organize.manifest.json"), "utf8"));
  assert.equal(manifest.at(-1).from, "a.py");
  assert.equal(manifest.at(-1).to.replaceAll("\\", "/"), "03_agent_aux/a.py");
});

await test("v2 registers no slash commands", async () => {
  const pi = new MockPi();
  let threw = false;
  try { mod.default(pi); } catch { threw = true; }
  assert.ok(!threw, "factory must not throw");
  assert.ok(!pi.handlers.command, "no command handler expected");
});

console.log(`\n${runner.pass} passed, ${runner.fail} failed`);
process.exit(runner.fail ? 1 : 0);
