# pi-organizer

**Zero-overhead, lazy, non-destructive workspace organizer for [pi](https://github.com/earendil-works/pi-coding-agent).**  
**零心智负担、按需创建、只移动不删除的 pi 编码代理工作区自动整理扩展。**

[中文说明](#中文说明) | [English](#english)

---

## 中文说明

安装后无需任何命令或手动干预：AI 在工作区里创建或读取的每一个文件，都会自动归入对应目录，保持项目根目录整洁。

### 核心原则

* **绝对按需创建（Lazy）**：启动 `pi` 或纯文字问答时**不会**提前生成任何空文件夹；只有当文件实际写入或被读取归位时，对应目录才会出现。
* **只移动，不删除**：插件永远不会删除或覆盖你的任何文件；所有移动操作均记录在 `organize.manifest.json` 中，支持随时撤回。
* **零命令干扰**：不注册任何 `/slash` 斜杠命令，仅提供两个供 AI 在需要时自动调用的内部工具（`organizer_task` 与 `organizer_undo`）。

### 安装

```bash
pi install npm:pi-organizer
```

### 工作区结构

当实际产生文件后，你的项目目录会自动维持如下结构：

```text
你的项目/
├── 01_uploads/              ← 你在会话中拖入根目录让 AI 读取的参考资料（PDF、截图、数据表等）
├── 02_deliverables/         ← AI 交付给你的正式成果（docx、pdf、xlsx、pptx 及带“定稿/报告”的 md 等）
├── 03_agent_aux/            ← AI 的中间产物（草稿 md、脚本、临时文件、日志等）
├── organize.manifest.json   ← 自动生成的文件移动账本（记录每次路由与撤回状态）
└── （根目录保持干净，原有的项目代码与配置文件原封不动）
```

### 它是怎么工作的

#### 1. 关键词 + 后缀双层智能分流
当 AI 在工作区根目录创建文件时，插件会先检查文件名中的语义关键词，再匹配文件扩展名：

| 目标目录 | 优先匹配的关键词 | 默认匹配的文件后缀 |
| :--- | :--- | :--- |
| **`02_deliverables/`**（正式交付） | `final`、`deliverable`、`report`、`summary`、`proposal`、`spec`、`manual`、`guide`、`定稿`、`终稿`、`最终版`、`报告`、`总结`、`方案`、`交付`、`试卷`、`答案`、`讲义`、`大纲` | `.docx`、`.pdf`、`.xlsx`、`.pptx`、`.epub`、`.csv` |
| **`03_agent_aux/`**（中间产物） | `draft`、`wip`、`tmp`、`temp`、`scratch`、`preview`、`backup`、`notes`、`草稿`、`临时`、`预览`、`备份`、`笔记` | `.md`、`.txt`、`.html`、`.py`、`.js`、`.ts`、`.sh`、`.ps1`、`.sql`、`.json`、`.yaml`、`.xml`、`.log`、`.tex` |
| **`01_uploads/`**（参考资料） | 会话启动后新拖入根目录并被 `read` 工具读取的文件 | 其他未归类的二进制或附件类型 |

> **示例**：`项目总结报告_final.md` 会直接进入 `02_deliverables/`，而 `合同_draft.docx` 会自动进入 `03_agent_aux/`。

#### 2. 多文件任务自动成对归组（`organizer_task`）
当你要求“帮我出 10 份试卷，另附答案”时，AI 会调用内置的 `organizer_task` 工具。文件夹依然在真正写入文件时才按需创建，并自动成对归入同名任务子目录：

```text
02_deliverables/10份试卷/   ← 10 份试卷放这里
03_agent_aux/10份试卷/      ← 答案与草稿放这里
```

任务结束后 AI 可调用 `action: "end"` 恢复为顶层目录归类。

#### 3. 命令行脚本产物自动清扫
如果 AI 通过 `bash` / 终端命令（例如 `pandoc` 或 Python 脚本）在根目录直接生成了新文件，插件会在本轮对话结束（`agent_end`）时自动将它们扫入对应的分类文件夹。

#### 4. 一键无损撤回（`organizer_undo`）
每次文件移动都会追加记录到 `organize.manifest.json`。如果你想撤销整理，只需直接对 AI 说：
* “把刚才移动的文件放回原处”
* “撤销 `10份试卷` 这个任务的文件整理”

AI 会调用 `organizer_undo` 将文件还原到原始路径，并自动清理因此变空的受管子目录（若原路径已存在同名新文件则安全跳过，绝不覆盖）。

### 严格安全边界（以下文件一律不碰）

1. **启动前已存在的文件**：打开 `pi` 之前根目录里就已经有的所有文件（无论修改时间是否变化）。
2. **核心项目文件与隐藏文件**：所有 `.` 开头的隐藏文件（如 `.gitignore`、`.env`），以及 `README.md`、`LICENSE`、`package.json`、`tsconfig.json`、`organize.config.json`、`organize.manifest.json` 等白名单文件。
3. **明确指定子路径的文件**：例如 AI 写入 `src/utils/helper.ts` 或 `02_deliverables/custom/a.docx` 时，插件仅确保父目录存在，绝不篡改路径。
4. **工作区之外的路径**：任何指向当前工作区目录外部的文件操作一律放行。

### 可选配置（`organize.config.json`）

开箱即用，无需任何配置。如需按月归档、自定义目录名或追加白名单/关键词，可在项目根目录创建 `organize.config.json`：

```json
{
  "groupByMonth": true,
  "folders": {
    "uploads": "01_uploads",
    "deliverables": "02_deliverables",
    "aux": "03_agent_aux"
  },
  "keepInRoot": ["CLAUDE.md", "AGENTS.md"],
  "deliverableKeywords": ["白皮书", "标书"],
  "auxKeywords": ["演草"]
}
```

* `groupByMonth`（默认 `false`）：设为 `true` 后，`02_deliverables` 和 `03_agent_aux` 下会自动按 `YYYY-MM`（如 `2026-11`）分层归档。

---

## English

Once installed, `pi-organizer` automatically routes files created or read in your workspace into structured folders—keeping your project root clean with zero manual effort.

### Core Principles

* **Strictly Lazy**: Starting `pi` or having text-only conversations creates **zero** empty folders. Directories are created on demand only when files are actually written or swept.
* **Move-Only, Never Delete**: Files are never deleted or overwritten. Every move is logged in `organize.manifest.json` and can be safely undone.
* **Zero Slash Commands**: Adds no `/commands` clutter; exposes only two internal tools (`organizer_task` and `organizer_undo`) for the agent to invoke automatically when appropriate.

### Installation

```bash
pi install npm:pi-organizer
```

### Workspace Layout

```text
your-project/
├── 01_uploads/              ← User-dropped reference files in root read by the agent
├── 02_deliverables/         ← Final deliverables (.docx, .pdf, .xlsx, .pptx, final reports)
├── 03_agent_aux/            ← Intermediate agent artifacts (drafts, scripts, logs, temp files)
├── organize.manifest.json   ← Append-only audit log of all file moves and rollbacks
└── (project root stays clean; existing repo/config files remain untouched)
```

### How It Works

1. **Keyword + Extension Smart Routing**:
   * **Deliverables (`02_deliverables/`)**: Files matching deliverable keywords (`final`, `deliverable`, `report`, `summary`, `proposal`, `spec`, `manual`, `guide`, etc.) or deliverable extensions (`.docx`, `.pdf`, `.xlsx`, `.pptx`, `.epub`, `.csv`).
   * **Auxiliary Artifacts (`03_agent_aux/`)**: Files matching draft/temp keywords (`draft`, `wip`, `tmp`, `temp`, `scratch`, `preview`, `backup`, `notes`, etc.) or code/note extensions (`.md`, `.txt`, `.html`, `.py`, `.js`, `.ts`, `.sh`, `.ps1`, `.sql`, `.json`, `.yaml`, `.xml`, `.log`, `.tex`).
   * **User Uploads (`01_uploads/`)**: New files dropped into the workspace root during a session and read via the `read` tool, or unclassified binary attachments.
2. **Paired Task Subfolders (`organizer_task`)**: For multi-file requests (e.g., generating a report alongside scripts and notes), the agent sets an active task name so deliverables and auxiliary files land in matching subfolders (`02_deliverables/<task>/` and `03_agent_aux/<task>/`), still created lazily on write.
3. **Shell Output Sweeping (`agent_end`)**: Files generated directly in the root by CLI tools (such as `pandoc` or Python scripts) are swept into their proper buckets at the end of the turn.
4. **Safe Rollback (`organizer_undo`)**: Ask the agent to undo recent file moves (by count or by task name). Files are restored to their original paths, empty managed subfolders are cleaned up, and existing files are never overwritten.

### Safety Boundaries

`pi-organizer` never touches:
* Any file or folder that already existed in the root when `session_start` ran.
* Dotfiles (`.gitignore`, `.env`, etc.) and protected root files (`README.md`, `LICENSE`, `package.json`, `tsconfig.json`, `organize.config.json`, `organize.manifest.json`).
* Explicit nested paths (e.g., `src/utils/helper.ts` or `02_deliverables/custom/a.docx`).
* Any path outside the current workspace.

### Optional Configuration (`organize.config.json`)

Place an optional `organize.config.json` in your workspace root to customize behavior:

```json
{
  "groupByMonth": true,
  "folders": {
    "uploads": "01_uploads",
    "deliverables": "02_deliverables",
    "aux": "03_agent_aux"
  },
  "keepInRoot": ["CLAUDE.md", "AGENTS.md"],
  "deliverableKeywords": ["whitepaper"],
  "auxKeywords": ["scratchpad"]
}
```

## License

MIT