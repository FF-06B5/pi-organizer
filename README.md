# pi-organizer（工作区自动整理器）

一个 pi 扩展。装上之后**你什么都不用做**：AI 在工作区里创建的每一个文件，都会自动放进对应的文件夹，工作区永远保持整齐。**它只移动文件，从来不删除任何东西。**

---

## 它帮你维持的样子

每个工作区最终长这样：

```
你的项目/
├── 01_uploads/          ← 你上传给 AI 的资料（PDF、课件、截图……）
├── 02_deliverables/     ← AI 交付给你的成果（docx、pdf 等）
├── 03_agent_aux/        ← AI 的中间产物（md 源稿、脚本、临时文件）
└── （工作区根目录保持干净）
```

## 它是怎么工作的（不用你操心）

1. **平时什么都没有**——刚打开 pi 不会出现一堆空文件夹。
2. **AI 第一次创建文件时**，对应的文件夹才自动出现，文件直接放进去：
   - `.docx` / `.pdf` → `02_deliverables/`
   - `.md` / `.py` / `.html` / `.txt` 等 → `03_agent_aux/`
   - 其他类型 → `01_uploads/`
3. **你要一批文件时**（比如"帮我出 10 份试卷，另附答案"），AI 会调用一次内置工具，自动创建两个任务文件夹：
   ```
   02_deliverables/10份试卷/     ← 10 份试卷放这里
   03_agent_aux/10份试卷/        ← 答案放这里
   ```
   然后所有文件各归各位。
4. AI 用命令行工具生成的文件（比如 pandoc 转的 PDF）也不会散在根目录——每轮对话结束自动归位。

**你明确说"放到 XX 文件夹"的话，AI 照你说的放，插件不干预。** 工作区之外的文件也一律不碰。每次移动都记录在 `organize.manifest.json` 里，随时可查。

---

## 安装

```bash
pi install git:github.com/<你的用户名>/pi-organizer@main   # 从 GitHub 装
pi install ./pi-organizer                                   # 或从本地文件夹装
```

## 想改规则？

在项目根目录放一个 `organize.config.json`（没有就用默认规则）：

```json
{
  "uploads": "01_uploads",
  "deliverables": "02_deliverables",
  "aux": "03_agent_aux",
  "deliverableExtensions": [".docx", ".pdf"],
  "auxExtensions": [".md", ".py", ".html", ".txt"],
  "keepInRoot": ["readme.md", "organize.config.json"]
}
```

## 安全保证

- **只移动，从不删除**；目标位置重名时自动加 `-2` 后缀
- 子文件夹内部永远不翻动；会话开始前就存在的文件不动
- 每次移动都有屏幕提示和 manifest 记录

## 开发

```bash
npm install          # 安装测试依赖
node test_organizer_v2.mjs   # 13 项单元测试
```

## License

MIT
