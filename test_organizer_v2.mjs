import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import piOrganizer from "./extensions/organizer.ts";

function createHarness(cwd) {
  const handlers = new Map();
  const tools = new Map();
  const commands = [];

  const mockPi = {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
    },
    registerTool(def) {
      tools.set(def.name, def);
    },
    registerCommand(name) {
      commands.push(name);
    },
  };

  piOrganizer(mockPi);

  return {
    tools,
    commands,
    async emit(eventName, event = {}) {
      for (const fn of handlers.get(eventName) ?? []) {
        await fn(event, { cwd });
      }
      return event;
    },
    async simulateWrite(relPath, content = "hello") {
      const event = { toolName: "write", input: { path: relPath } };
      await this.emit("tool_call", event);
      const finalAbs = path.resolve(cwd, event.input.path);
      fs.mkdirSync(path.dirname(finalAbs), { recursive: true });
      fs.writeFileSync(finalAbs, content, "utf8");
      return event.input.path;
    },
    async simulateRead(relPath) {
      const event = { toolName: "read", input: { path: relPath } };
      await this.emit("tool_call", event);
      return event.input.path;
    },
  };
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-org-"));
  try {
    await fn(tmpDir);
    console.log(`PASS ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}\n`, err);
    failed++;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

await test("lazy: session_start creates NOTHING", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  assert.deepEqual(fs.readdirSync(cwd), []);
});

await test("routing a .docx creates deliverables on demand", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("report.docx");
  assert.equal(routed, path.join("02_deliverables", "report.docx"));
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables", "report.docx")), true);
  assert.equal(fs.existsSync(path.join(cwd, "03_agent_aux")), false);
});

await test("routing a .md creates aux on demand", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("notes.md");
  assert.equal(routed, path.join("03_agent_aux", "notes.md"));
  assert.equal(fs.existsSync(path.join(cwd, "03_agent_aux", "notes.md")), true);
});

await test("keyword smart routing: final .md goes to deliverables", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("项目总结报告_final.md");
  assert.equal(routed, path.join("02_deliverables", "项目总结报告_final.md"));
});

await test("keyword smart routing: draft .docx goes to aux", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("合同_draft.docx");
  assert.equal(routed, path.join("03_agent_aux", "合同_draft.docx"));
});

await test("nested path inside deliverables: parent auto-created, path untouched", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("02_deliverables/custom/a.docx");
  assert.equal(routed, "02_deliverables/custom/a.docx");
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables", "custom", "a.docx")), true);
});

await test("nested path elsewhere: parent auto-created, untouched", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("src/utils/helper.ts");
  assert.equal(routed, "src/utils/helper.ts");
  assert.equal(fs.existsSync(path.join(cwd, "src", "utils", "helper.ts")), true);
});

await test("organizer_task does NOT create empty folders until files are written", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const taskTool = h.tools.get("organizer_task");
  await taskTool.execute("1", { task: "10份试卷" }, null, null, { cwd });
  assert.deepEqual(fs.readdirSync(cwd), []);

  await h.simulateWrite("试卷合集.pdf");
  await h.simulateWrite("答案解析.md");
  assert.equal(
    fs.existsSync(path.join(cwd, "02_deliverables", "10份试卷", "试卷合集.pdf")),
    true
  );
  assert.equal(
    fs.existsSync(path.join(cwd, "03_agent_aux", "10份试卷", "答案解析.md")),
    true
  );

  await taskTool.execute("2", { task: "10份试卷", action: "end" }, null, null, { cwd });
  await h.simulateWrite("standalone.pdf");
  assert.equal(
    fs.existsSync(path.join(cwd, "02_deliverables", "standalone.pdf")),
    true
  );
});

await test("keepInRoot respected (README.md)", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("README.md");
  assert.equal(routed, "README.md");
  assert.equal(fs.existsSync(path.join(cwd, "README.md")), true);
});

await test("outside-workspace path respected", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.txt`);
  try {
    const routed = await h.simulateWrite(outside);
    assert.equal(routed, outside);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

await test("agent_end sweeps bash-generated pdf (folder on demand)", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  fs.writeFileSync(path.join(cwd, "compiled.pdf"), "pdf");
  await h.emit("agent_end");
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables", "compiled.pdf")), true);
});

await test("agent_end with no new files creates NOTHING (lazy)", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  await h.emit("agent_end");
  assert.deepEqual(fs.readdirSync(cwd), []);
});

await test("agent_end keeps pre-session files even if mtime is touched", async (cwd) => {
  const preFile = path.join(cwd, "existing.pdf");
  fs.writeFileSync(preFile, "old");
  const h = createHarness(cwd);
  await h.emit("session_start");
  fs.utimesSync(preFile, new Date(), new Date());
  await h.emit("agent_end");
  assert.equal(fs.existsSync(preFile), true);
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables")), false);
});

await test("agent_end keeps pre-session files with old mtime", async (cwd) => {
  const preFile = path.join(cwd, "legacy.md");
  fs.writeFileSync(preFile, "legacy");
  const h = createHarness(cwd);
  await h.emit("session_start");
  await h.emit("agent_end");
  assert.equal(fs.existsSync(preFile), true);
});

await test("user-dropped reference file in root auto-routes to 01_uploads on read", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  const dropped = path.join(cwd, "客户需求扫描.pdf");
  fs.writeFileSync(dropped, "scan");
  const newPath = await h.simulateRead("客户需求扫描.pdf");
  assert.equal(newPath, path.join("01_uploads", "客户需求扫描.pdf"));
  assert.equal(fs.existsSync(path.join(cwd, "01_uploads", "客户需求扫描.pdf")), true);
  assert.equal(fs.existsSync(dropped), false);
});

await test("organizer_undo restores moved file and cleans empty folder", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  await h.simulateWrite("temp_report.pdf");
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables", "temp_report.pdf")), true);

  const undoTool = h.tools.get("organizer_undo");
  await undoTool.execute("1", { count: 1 }, null, null, { cwd });
  assert.equal(fs.existsSync(path.join(cwd, "temp_report.pdf")), true);
  assert.equal(fs.existsSync(path.join(cwd, "02_deliverables")), false);
});

await test("organize.config.json groupByMonth creates YYYY-MM subfolder", async (cwd) => {
  fs.writeFileSync(
    path.join(cwd, "organize.config.json"),
    JSON.stringify({ groupByMonth: true })
  );
  const h = createHarness(cwd);
  await h.emit("session_start");
  const routed = await h.simulateWrite("monthly.pdf");
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  assert.equal(routed, path.join("02_deliverables", ym, "monthly.pdf"));
});

await test("manifest records routing", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  await h.simulateWrite("deliverable.pdf");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cwd, "organize.manifest.json"), "utf8")
  );
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].to, "02_deliverables/deliverable.pdf");
});

await test("v3 registers no slash commands", async (cwd) => {
  const h = createHarness(cwd);
  await h.emit("session_start");
  assert.equal(h.commands.length, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);