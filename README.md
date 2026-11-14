# pi-organizer

Pi extension that keeps your workspace tidy **automatically** — no commands needed. On every
session it creates a standard folder set and routes every file the agent creates into the right
folder. **Never deletes anything.**

Pi 扩展：全自动保持工作区整洁——无需任何命令。每个会话自动创建标准文件夹结构，agent 创建的文件自动归类。**只移动，从不删除。**

## Folder set / 文件夹结构

| Folder | Purpose | 用途 |
|---|---|---|
| `01_uploads/` | Materials you uploaded (papers, course books, data, screenshots) | 你上传的原始资料 |
| `02_deliverables/` | Files you asked the agent to produce (preferred formats: `.docx` / `.pdf`) | 你要求生成的交付成果 |
| `03_agent_aux/` | Auxiliary agent files (`.md` sources, scripts, intermediate `.html`/`.txt`) | Agent 的辅助文件 |

## Install / 安装

```bash
pi install git:github.com/<you>/pi-organizer@main   # after pushing to GitHub
pi install ./pi-organizer                            # or from a local copy
```

## How it works / 全自动工作流

**No commands.** The moment a session starts in any workspace:

1. **Session start** — the folder set is created (if missing).
2. **While the agent works** — every file it creates with `write`/`edit` directly in the
   workspace root is transparently rerouted:
   - `.docx` / `.pdf` → `02_deliverables/`
   - `.md` / `.py` / `.html` / `.txt` / `.js` / `.ts` / `.json` → `03_agent_aux/`
   - anything else → `01_uploads/`
3. **After each agent turn** — files the agent generated through shell tools (pandoc,
   compilers, …) are swept from the root into the same folders.

**"Unless the user asks otherwise" / 用户额外要求优先：** paths that are already nested
(e.g. `reports/custom/x.docx` or `02_deliverables/y.md`) are respected and never touched —
so when you ask for a specific location, the agent simply writes there. Files outside the
workspace are never modified.

Every routing decision is logged to `organize.manifest.json` for reference.

## Customization / 自定义

Drop an `organize.config.json` in the project root:

```json
{
  "auto": true,
  "uploads": "01_uploads",
  "deliverables": "02_deliverables",
  "aux": "03_agent_aux",
  "deliverableExtensions": [".docx", ".pdf"],
  "auxExtensions": [".md", ".py", ".html", ".txt"],
  "keepInRoot": ["readme.md", "organize.config.json"]
}
```

- `"auto": false` disables all automatic behaviour (folders are not created, files stay put).
- `keepInRoot` lists root files that are never moved.

## Safety / 安全

- **Never deletes**: files are only moved; on name collision a `-2`/`-3` suffix is added.
- Subfolders are never traversed or reorganized.
- Pre-existing files (created before the session) are left where they are.
- All routing decisions are visible as toast notifications and in `organize.manifest.json`.

## Development / 开发

```bash
node test_organizer_v2.mjs   # 10 unit tests (mock Pi API, temp sandboxes)
```

## License

MIT
