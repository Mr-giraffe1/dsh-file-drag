# dsh-file-drag

把右侧文件栏里的文件**直接拖进输入框**，插入一个 `@` 文件引用——和手动输入 `@` 选文件得到的是同一种引用 chip。

> 一个 DeepSeek Harness（DSH）Web UI 客户端插件。装上之后，在右侧「文件」标签里按住任意文件（或文件夹）行，拖到输入框上松手即可。

## 特性

- **拖拽引用**：按住文件行拖动超过约 6px 进入拖拽，指针旁出现文件名 chip；拖到输入框上方时输入框出现品牌色描边，松手插入引用。
- **真实引用**：走 DSH 输入框自己的引用通道（`conversation.input.shell(sessionId).addFiles(...)`），草稿里立刻渲染成文件 chip，自动补空格；不是把纯文本硬塞进去。
- **相对路径**：自动转成相对当前会话工作目录的 `@src/a.ts`；带空格的路径使用 `@"my file.txt"` 语法；文件夹生成 `@dir/`（文件夹引用）。
- **不干扰原有交互**：单击文件行仍然打开预览（拖拽后的那一次 click 会被吞掉）；拖到别处、按 `Esc`、窗口失焦都会取消；鼠标/触控笔生效，触摸输入不劫持滚动。
- **不替换官方 UI**：不改文件树、不改附件栏、不写别人的 DOM；只在 `shell.overlay`（拖拽浮层）和 `conversation.input.overlay`（输入框投放区）注册两个附加组件。

## 环境要求

- DeepSeek Harness，Web GUI（桌面版或浏览器访问 `dsh web` 均可）。
- 开发验证版本：`0.2.1-rc.3`。
- 依赖 DSH 自带的右侧「文件」标签与 `@` 引用能力（默认均可用）。

## 安装

这是一个 DSH bundle 包（宿主半边为空，功能全在浏览器端）。

1. 克隆或下载本仓库到本地。
2. 在 DSH 中通过插件管理器把它作为本地 bundle 安装：
   - 让 Harness 的 Agent 执行 `plugin_manager` 的 `install_bundle`，`target` 填本仓库目录的绝对路径；或
   - 使用插件管理器的本地安装入口选择该目录。
3. 安装结果应显示 `applied`，插件列表中出现「文件拖拽引用」。
4. 刷新页面（首次安装通常会热生效；若仍是旧代码，重启 DSH）。

安装后 profile 会记录 `"dsh-file-drag": "link:<本仓库路径>"`，所以本地改动重新加载即可生效。

## 使用

1. 打开右侧栏的「文件」标签（桌面版 `Ctrl+P`）。
2. 按住一个文件行，拖动。
3. 拖到输入框上方，松手。
4. 输入框获得焦点，出现 `@相对路径` 的文件引用 chip，继续输入或发送即可。

| 操作 | 结果 |
| --- | --- |
| 单击文件行 | 打开文件预览（保持官方行为） |
| 拖动文件行 → 输入框 | 插入文件引用 |
| 拖动文件夹行 → 输入框 | 插入文件夹引用（尾部 `/`） |
| 拖动后松手在别处 / `Esc` / 失焦 | 取消，不改动草稿 |
| 会话正在提交、输入框暂不接受 | 不插入，控制台给出 `[dsh-file-drag]` 告警 |

## 工作原理

- **拖拽源**：在 document 上做指针事件委托，识别官方文件树行自带的 `[data-files-body] li[data-files-entry][data-files-path]`，超过阈值后进入自定义拖拽。不向官方 DOM 写入任何属性。
- **浮层**：`shell.overlay` 里的组件渲染跟随指针的文件 chip，以及命中输入框时的描边（仅使用 `--dsw-alias-*` 主题变量，自动适配明暗主题）。
- **投放区**：`conversation.input.overlay` 里的 session 级组件发布输入框卡片的矩形和插入回调；松手时按指针位置命中对应会话的输入框。
- **插入**：`conversation.input.shell(sessionId).addFiles([{ source: 'reference', ref, label, appearance, clipboardText }], [])`，与官方「把系统文件拖进输入框」走同一条路径；另有 `insertReference` / `inputActions.insertText` 两级降级。

## 兼容性与已知限制

- 依赖 DSH 内部标记（`data-files-*`、`data-composer-card`）和 `conversation.input.shell` 接口。它们目前可用但非版本化契约；若未来 DSH 改动，插件会静默失效（控制台有 `[dsh-file-drag]` 告警），不会破坏原有 UI。
- 仅支持鼠标/触控笔拖拽；触摸拖拽未实现。
- 暂不支持从文件预览标签、搜索结果等其他位置拖动。
- 同一时间一个输入框只会插入一条引用（重复拖拽会依次追加，并有空格分隔）。

## 目录结构

```
dsh-file-drag/
├─ package.json          bundle 清单 + dsh.client 声明
├─ cordis.patch.yml      插入 file-drag 这一行插件
├─ index.js              Host 半边（空实现，只为拥有 Loader 行）
├─ client.js             功能全部实现（拖拽、浮层、投放、引用插入）
├─ icon.svg              插件图标
├─ locale/{zh,en}.json   插件管理页标题/描述
└─ README.md / LICENSE
```

## 开发

- 修改 `client.js` 后刷新页面；若控制台仍是旧版本日志，重启 DSH。
- 控制台日志前缀：`[dsh-file-drag]`。
- 卸载：插件管理器中移除 `dsh-file-drag`，源码目录不受影响。

## English

Drag a file from the right Sidebar **Files** tab onto the chat composer to insert an `@` file reference — the same reference chip produced by the `@` picker.

- Insertion uses the composer's own path (`conversation.input.shell(sessionId).addFiles([reference], [])`), so spacing and chip rendering match the built-in behavior.
- Relative paths, quoted `@"path with spaces"` mentions, and folder references with a trailing `/` are handled automatically.
- The plugin only adds two additive slot components (drag overlay + composer drop zone); it does not replace or mutate shipped UI.
- Mouse/pen only. Requires a DSH build with the Sidebar Files tab and `@` references (verified on `0.2.1-rc.3`). Internal DOM markers and `conversation.input.shell` are not versioned APIs; a future DSH change makes the plugin degrade silently with a `[dsh-file-drag]` console warning.

## License

MIT. See [LICENSE](LICENSE).
