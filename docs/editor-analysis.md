# Bilibili 专栏编辑器分析（2026-10-29）

当前投稿页不是在外层创作中心直接实现编辑器，而是嵌入同源页面：

- 新建稿件：`https://member.bilibili.com/york/read-draft`
- 编辑稿件：`https://member.bilibili.com/york/read-editor`

外层创作中心的异步包会把这两个地址放进 iframe。编辑器当前资源来自 `sunflower/read-editor`。

## 关键事实

编辑器是 TipTap/ProseMirror。公式节点定义为内联、原子节点，HTML 形态为：

```html
<img
  data-type="latex"
  data-formula="P(A)=\\frac{a}{b}"
  src="https://api.bilibili.com/x/web-frontend/mathjax/tex?formula=..."
  alt="P(A)=\\frac{a}{b}"
>
```

节点转换时使用的业务对象是：

```json
{
  "node_type": 5,
  "formula": { "latex_content": "P(A)=\\frac{a}{b}" }
}
```

因此公式可以真正存在于段落文字中；之前把公式变成图片的方案绕过了这个能力。

## Markdown 导入为什么丢公式

当前导入流程的核心逻辑是：

1. `FileReader.readAsText()` 读取 `.md`。
2. `preprocessMarkdown()` 做表格、任务列表等清理。
3. `markdown-it` 执行 `render()`。
4. `postProcessHtml()` 做少量 HTML 清理。
5. 通过 `DataTransfer` 构造 `ClipboardEvent('paste')`，把 HTML 交给 ProseMirror。

`markdown-it` 默认没有 `$...$` / `$$...$$` 规则，所以公式只是普通文本；后面的 ProseMirror HTML 解析器也就没有机会创建 `latex` 节点。

## 增强点

`userscripts/bilibili-latex-import.user.js` 有两个保护层：首先包装 `.md` 文件的 `FileReader.readAsText()` 结果，把公式临时替换为带 `data-type="latex"` 的 HTML 图片，躲过 Bilibili 的 `^...^`、`~...~` 清理；随后在编辑器捕获粘贴事件阶段，把 HTML 中的保护节点交给原有 ProseMirror 粘贴流程。普通粘贴事件只修改现有 `DataTransfer`，不再重新派发事件，因此不会重入导入状态机。脚本还跳过代码块、行内代码和未闭合分隔符，并在重复安装时先卸载上一次监听器。

这样仍使用 Bilibili 自己的 Markdown 解析、撤销、校验和保存逻辑，公式由现有原生节点承载，行内位置也由 `latex` 节点的 `inline: true` 定义保持。

这是对当前打包脚本行为的适配，Bilibili 更新 `read-editor` 资源后需要重新检查节点属性和导入流程。脚本仅包装当前编辑器页面中的 `.md` 文本读取并处理粘贴事件，不自动点击发布、不提交稿件。公式渲染仍使用 Bilibili 自己的 MathJax 接口，会向该接口发送公式内容。

## 本次死循环及修复

扫描器遇到文本节点末尾的单独 `$` / `$$` 时，查找闭合符号的内层循环不执行，外层索引保持不变，因此浏览器主线程被占满。`markdown-it` 使用 `<br>` 拆分多行公式后，单独的 `$$` 文本节点能稳定触发问题。本地 VM 的 200ms 执行期限复现了 `$`、`$$`、`text $` 三种超时；这与修改粘贴数据是否重入无关。

修复首先保证每次遇到起始符都会推进索引，再跨 `<br>` 聚合文本并使用 DOM Range 替换，避免把多行公式分隔符当作独立公式。离线扫描器的同类未闭合分隔符问题也已修复。回归测试使用 VM 执行超时和子进程执行超时保护，因此再次引入该问题时测试会失败而不会一直卡住。

随后在真实页面上发现 Bilibili 的 `removeSuperscriptMarkers()` 会提前删除公式中的 `^`。`0.1.3` 将 `.md` 原始 TeX 提前保护为 HTML 属性数字实体，保留反斜杠、下标、上标及波浪符，再让 Bilibili 的现有 HTML 解析器创建公式节点。测试覆盖了真实 FileReader 的 load/result 流程、重复安装和卸载还原。

2026-10-29 用户安装并重新导入 `0.1.3` 后，已视觉确认行内公式、多行公式、上标和代码保留正常；原始截图不公开；后续脱敏演示见 [公式与图片混排](screenshots/image-spacing-0.2.3.png)。验证范围为编辑器和手机预览，未执行发布。

## 首行标题移动（0.2.1）

首行 `# 标题` 在公式保护前提取，使用编辑器自带解析器将标题里的内联格式转为纯文本，正文只移除这一行。识别遵循 ATX 一级标题语法：允许 BOM、最多三个前导空格及可选结尾井号；空行之后的标题、二级标题、转义井号和代码均不提取。

普通导入将标题编码为临时 HTML 注释，直到原生粘贴事件才移除注释并填写标题，避免仅仅读取文件就改动标题。原生 Vue 标题组件是 `.title-input__inner` textarea，通过标准 value setter 和冒泡 `input` 事件更新 v-model。文件夹导入在预检查阶段提取标题，上传和正文核对成功后才写入，同时检查上传期间标题是否被用户修改。

`0.2.1` 的标题提取、普通 FileReader/粘贴链路、文件夹导入及失败保护已通过本地测试；新增标题功能尚未安装到真实页面验证。之前 `0.2.0` 的图片上传、公式和草稿重开验证仍见本地图片分析文档。

## 行间公式自动居中（0.2.7）

2026-10-30 在现有全功能测试稿中检查了用户手动居中的两处公式。公式仍是原生内联 `latex` 节点，对齐方式保存在其父段落：`<p style="text-align: center;">`。普通正文、列表内公式及同行多公式仍为 `start`。因此不需要新增 Markdown 对齐语法，也不需要为编辑器注入全局 CSS。

实现分两步：在原始 Markdown 保护阶段为 `$$...$$` 公式临时添加 `data-bili-md-display="true"`，保留与 `$...$` 的区别；捕获导入 HTML 时，移除临时标记，并对只包含该公式及空白/换行的段落写入 `text-align: center`。markdown-it 有时把保护用的独立 `<img>` 当作 HTML 块输出，不生成 `<p>`，此时先包裹段落。最后仍由 B 站原生粘贴解析器导入这个段落属性。文件导入、文件夹导入和原有美元公式 HTML 转换共用处理逻辑。

正文与公式混合的段落不会整段居中，独占的 `$...$` 也不会被误认为行间公式。代码仍按原规则跳过；不修改已有文章中的段落、DOM 或全局样式。35 项本地测试通过；用户更新 0.2.7 并重新导入后，已验证两处行间公式自动居中，保存草稿并刷新页面后保持 `center`；五处行内公式仍为 `start`，七处公式 TeX 均保留。

原生手动居中的[段落属性记录](validation/display-alignment-native-2026-10-30.json)与[截图](screenshots/display-alignment-manual.png)记录研究阶段的目标属性。自动导入验收另见 [0.2.7 保存刷新前后核对数据](validation/display-alignment-auto-2026-10-30.json)及[重开截图](screenshots/display-alignment-auto-reopened.png)，不以手动居中截图替代自动导入证据。
