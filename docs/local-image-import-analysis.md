# Markdown 本地图片导入分析（2026-10-29）

## 结论

可以实现，并可与当前原生公式导入脚本共存。需要补齐两个步骤：取得本地图片文件，以及在正文导入前把图片上传到 Bilibili。

仅选择一个 `.md` 文件，网页无法自动读取它旁边的文件。这不是修改图片 URL 就能解决的问题。推荐新增“导入 Markdown 和图片”入口，让用户选择包含文档和图片的文件夹，再自动完成匹配、上传、替换及导入。

分析后已在 `userscripts/bilibili-latex-import.user.js` 的 `0.2.0` 实现文件夹导入、预检查、上传去重、取消及失败保护。原有普通 `.md` 导入的公式增强继续保留。21 项本地自动化测试通过；随后完成示例 PNG 文档的真实上传、导入、保存和重新打开草稿验证，详情见下文。

## 当前为什么无法一起上传

例如本地目录为：

```text
article/
├── article.md
└── assets/
    └── diagram.png
```

Markdown 中写：

```markdown
![示意图](assets/diagram.png)
```

Bilibili 当前的 `importMarkdownFile()` 只读取传入的 Markdown 文件，渲染为 HTML 后派发粘贴事件；没有收集附属图片文件的步骤。生成的 HTML 仍是 `<img src="assets/diagram.png">`。

这里的地址只是字符串，不是浏览器已获准读取的本地 `File`。浏览器若直接解析它，会相对于网页地址解析；Bilibili 服务端图片转存也无法访问用户电脑中的这个路径。绝对路径和 `file://` 同样不能赋予 HTTPS 页面本地文件读取权限。

文件选择框不会提供可用于读取相邻文件的真实绝对路径。给脚本增加 Tampermonkey 的普通网络权限，也不能因此取得用户硬盘上的任意文件。

## 已找到的 Bilibili 上传能力

当前编辑器主资源：

[index-ogfP4aUi.js](https://s1.hdslb.com/bfs/static/sunflower/read-editor/assets/index-ogfP4aUi.js)

2026-10-29 重新获取该资源，SHA-256 为：

```text
b20d84c6dbc5a0c0fc119042baa5aeb996282dad077690ad6b0768b792ccb9e0
```

资源中的 `uploadImg()` 使用下列请求上传本地图片：

```text
POST https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs
Content-Type: multipart/form-data（boundary 由浏览器生成）

file_up = File
biz = new_dyn
category = daily
```

编辑器的请求中间件负责登录态、CSRF 和可能的风控处理。启用水印时，还会根据当前账号添加水印参数。业务返回 `code === 0` 后，读取 `data.image_url`、`image_width`、`image_height`、`image_size`、`ai_gen_pic`。

另一个 `transferImg()` 对应 `/x/dynamic/feed/draw/transfer_image`，传入 `origin_path`。它适用于服务端可访问的图片 URL，不能代替本地文件上传。

`0.2.0` 从 `.ProseMirror.editor` 获取编辑器实例，从 `editor.storage.importMarkdown.md` 取得解析器，并从扩展管理器寻找 `biliImage.options.uploadHandler(File)`，沿用现有账号、水印及请求中间件。这些入口已从当前资源确认，并已通过示例文档的真实浏览器导入验证，但不是承诺稳定的公共 API。当前实现不自行拼接登录请求，也不读取或导出账号 Cookie。

`0.2.2` 调整水印行为：导入面板新增“图片添加水印”，默认关闭。上传前由本次选择显式设置 `File.watermark`，不再继承扩展默认的 `options.watermark`。缓存按文件及水印开关分别保存，防止切换后复用另一版本。默认关闭、勾选上传及缓存切换已通过本地测试；此选项的新行为尚未进行真实浏览器上传验证。

`0.2.3` 修复图片前额外出现空段落：在真实测试草稿的 DOM 中确认，每个独立图片块前均有一个空 `p`。Markdown-it 输出的 `<p><img data-eva-image="enhanced" ...></p>` 中，图片是块节点；原生图片插件遇到内部图片会提前返回，其图片段落解包结果不会传入后续解析器。因此在捕获导入粘贴时，将仅含增强图片、空白和换行的段落解包，再交给原生编辑器。此操作不读取或重写现有编辑器正文，不删除原有空段落，不解包原生行内公式。连续图片、换行分隔图片、公式混排、题注/尺寸和代码保留已通过本地回归测试。2026-10-29 用户更新并重新导入示例后，真实编辑器 DOM 中三张图片分别直接跟随正文段落，原先三个空段落均消失，两处公式、图片尺寸、题注和代码保留；桌面编辑器与手机预览已视觉核对。证据见 [image-spacing-0.2.3.json](validation/image-spacing-0.2.3.json) 和 [截图](screenshots/image-spacing-0.2.3.png)。

`0.2.4` 调整导入入口的界面样式：面板采用分区布局、响应式宽度、状态卡片、主次操作按钮和打开动画。`0.2.5` 将标题栏关闭图标与底部操作按钮的样式、选择器分开，分别绑定关闭事件，修复底部按钮无响应与标题栏按钮尺寸被覆盖的问题。33 项本地测试通过，包括两个关闭入口和重新打开的回归验证。用户已在真实页面验证两个关闭按钮有效，浏览器也已确认底部关闭和重新打开、右上角图标对齐；[面板截图](screenshots/import-panel-0.2.5.png)。

当前扩展默认允许 PNG、JPEG、GIF、WebP；普通图片默认上限 20 MiB，GIF 默认上限 8 MiB。图片数量上限由页面配置 `maxPicCount` 传给扩展，不能把扩展默认值 18 当作所有账号的固定限制。上线实现时应以运行中配置和服务端结果为准。SVG 等未包含的格式需要单独转换或明确报错。

## 与现有公式脚本有关的陷阱

`BiliImage` 的原生 `handlePaste()` 有提前返回分支：粘贴 HTML 中只要有任意一张“内部图片”，就不再执行这个插件的普通图片上传/转存处理。`isInternalImage()` 把 `data-type="latex"` 也归为内部图片。

因此混合文档经当前公式脚本转换后，不能依赖普通图片粘贴插件继续补做上传。单纯把本地图片变成 Base64 或 Blob URL 再粘贴，也不足以解决混合文档的上传和持久化问题。

本次从上述资源提取实际 `handlePaste()` 和 `isInternalImage()`，在 JSDOM/VM 中执行，得到：

| 输入 HTML | 普通图片插件是否接管 | 进入后续图片处理的路径 |
| :---: | :---: | :---: |
| 原生公式 + `assets/demo.png` | 否 | 无 |
| 只有 `assets/demo.png` | 是 | `assets/demo.png` |
| 已标记 `data-eva-image="enhanced"` 的站内图片 | 否 | 无 |

探针仅验证原生分支选择；下游上传/转存使用替身，没有执行网络请求。第二种结果只说明路径被交给后续逻辑，不代表本地图片可以上传成功。

预上传后，可生成原生普通图片 HTML，交给 ProseMirror 直接解析：

```html
<img
  src="https://i0.hdslb.com/bfs/new_dyn/UPLOAD_RESULT.png"
  data-url="https://i0.hdslb.com/bfs/new_dyn/UPLOAD_RESULT.png"
  data-eva-image="enhanced"
  data-status="1"
  data-width="640"
  data-height="360"
  data-size="12.34"
  data-caption="示意图"
>
```

其中 URL、尺寸、大小等均须来自实际上传结果；示例数值不可直接用于真实图片。`data-size` 的原生文件处理使用 KB，应核对上传返回字段的单位。`data-eva-image="enhanced"` 是当前节点的原生标记，可避免纯图片文档在粘贴时再次转存；公式混合示例的 HTML 到草稿保存链路已验证，纯图片文档尚未单独进行线上验证。

`EnhancedImage` 定义了 `data-width`、`data-height`、`data-size`、`data-url` 等属性；保存转换中的 `OpusNodeFactory.createPicture()` 使用 `src` 作为图片 URL。应将 `src` 直接设为实际站内地址，不能只填 `data-url` 而把 `src` 留为本地路径或临时 Blob URL。

这些普通图片仍是块级节点；已有公式继续使用原生内联 `latex` 节点。

## 推荐的交互和实现顺序

1. 在用户脚本中新增“导入 Markdown 和图片”按钮。点击后通过目录选择框取得用户选择的文件集合，不在异步读取回调中临时弹出需要用户手势的目录权限请求。
2. 文件夹内只有一个 `.md` 时自动选用；有多个时列出文档供选择。使用文档在所选目录中的位置作为相对路径基准。
3. 先用现有公式保护逻辑保护 TeX，再用 Markdown 解析器解析图片；覆盖普通图片语法、引用式图片和计划支持的 HTML `<img>`。不要用一个正则扫描全部 `![]()`，否则会误改代码块、括号路径或漏掉引用式图片。对所有非公式图片按来源分类：本地文件上传、已有站内图片保留、外站图片如需导入则先转存，避免依赖已经被公式或原生图片标记跳过的自动处理分支。
4. 根据目录结构匹配文件，列出缺失、歧义及不支持格式。所有资源检查完成后，再开始上传。只上传选定文档实际引用的图片，不上传整个目录。
5. 每个文件在一次导入中只上传一次，多处引用复用结果。按规范化路径定位文件，不仅按 basename 匹配；需要进一步去重时再计算内容哈希。
6. 限制并发，显示上传进度、失败项和可控重试。完成后将图片替换为带原生属性的 HTML，保留公式、代码和正文顺序。HTML 属性必须安全转义；若重新经过原生 Markdown 预处理，也要像当前公式属性一样保护 `^`、`~` 等内容，避免文件名或题注被预处理改写。
7. 全部必需图片准备好后，调用 `editor.commands.importMarkdown()`。渲染时暂时包装原生解析器的图片和 HTML 渲染规则，生成已上传的原生图片 HTML，随后立即还原规则。该命令同步渲染、在微任务中执行原生粘贴；无需构造假文件或调用打包作用域里的 `importMarkdownFile()`。
8. 导入后核对图片节点、公式及预览，再验证保存并重新打开草稿的结果。

当前 `FileReader.result` getter 是同步的，不能在其中 `await` 图片上传，也不能返回 Promise 冒充文本。图片增强应建立独立的异步准备阶段，完成后再进入现有公式导入链路。上传完成前保留原正文；失败时展示具体文件并停止导入，避免 Bilibili 原生的 `clearContent()` 提前清空正文。

这不是服务器事务：若前几张图片已经成功上传，后续失败或用户取消，已上传文件不会因停止导入而自动撤回。重试可在本次会话内复用已确认成功的结果；不应承诺完整回滚。

`0.2.0` 在提交前检查正文是否被修改，提交后核对原生图片节点的数量及地址。若提交结果与预期不符，使用导入前的文档快照还原正文。上传最多同时进行两个，不自动重试失败的 POST 请求。站内 URL 通过浏览器图片加载取得尺寸，暂以 0 作为未知大小；外站 URL 使用原生 `transferHandler`，本地文件使用 `uploadHandler`。

## 本地文件取得方式比较

| 方式 | 用户操作 | 路径信息 | 建议 |
| :---: | :---: | :---: | :---: |
| 只选 `.md` | 选择一个文件 | 无相邻图片内容 | 无法实现自动读图 |
| 选择文档文件夹 | 选择一个目录，必要时再选其中的文档 | `webkitRelativePath` 保留目录层次 | 首选；最接近一次导入 |
| `.md` + 多选图片 | 选文档，再多选图片 | 普通多选往往只有文件名 | 可作补充，同名文件须显式映射 |
| ZIP 包 | 选择含文档及资源的 ZIP | 解压后可保留相对路径 | 可作备选，需解压及包大小控制 |
| 本地辅助程序 | 选择文件或运行命令 | 可读取本地文件系统 | 更灵活，但增加安装和维护成本 |

目录选择可以使用 `<input type="file" webkitdirectory multiple>`，通过 `File.webkitRelativePath` 建立索引；也可在支持的浏览器中使用 `showDirectoryPicker()`。后者要求安全上下文和用户主动操作，需要做能力检测和回退，不应作为唯一入口。

若目录为 `project/docs/article.md`，引用 `../assets/a.png`，应选择共同祖先 `project/`；只授权 `docs/` 时无法访问其外的 `assets/`。绝对路径、`file://`、Windows 盘符路径及其他编辑器私有图片语法应明确识别并提示改为相对路径或补选文件，不能猜测用户本地路径。

路径解析还应覆盖中文、空格、百分号编码、`.`/`..`、不同目录同名图片。先区分 HTTP(S)、data、blob、本地相对路径等类型；编码仅解码一次，规范化后不得越出用户选定范围。远程图片继续走明确的远程处理分支，不误当本地文件。Markdown 中的 query/fragment 与字面文件名需要约定处理规则，不能无条件截断文件名。

## 后续验收重点

- 同一文档同时含美元公式、本地图片、代码块；代码中的示例图片语法不上传。
- 相对路径、引用式图片、中文/空格路径、括号路径、跨子目录引用及同名图片。
- 同一图片重复引用，上传一次、插入多处；图片顺序及题注保留。
- 找不到图片、格式/大小/数量超限、网络超时或接口失败时，原正文保留且指出具体文件。
- 纯图片文档和公式混合文档都能导入，不重复上传，不产生永久加载占位符。
- 编辑器、手机预览及保存后重新打开草稿时均正常；持久化数据中没有本地路径、Blob URL 或 Base64 冒充已上传图片。

## 已完成的真实浏览器验证

2026-10-29，用户安装 `0.2.0`，在独立空白测试稿中选择 `examples/local-images`。预检查显示三个图片位置、两个本地文件。使用新增按钮执行上传和导入后，编辑器显示成功；随后保存为草稿，并从草稿箱点击“编辑”重新打开。

测试草稿的标识已从公开材料移除。只保存为草稿，没有发布；原有其他稿件没有被用于本次导入测试。

| 检查项 | 结果 |
| :---: | :---: |
| 普通 PNG `assets/curve.png` | 上传并加载成功，720×320 |
| 中文、空格及括号文件名 `assets/中文 图(1).png` | 引用式图片匹配成功，720×260 |
| 同一图片的 `assets/curve.png` 和 `./assets/curve.png` | 两个正文位置使用同一站内 URL |
| 行内公式 `P(A)=\frac{a}{b}` | 原生 `data-type="latex"`，与文字同段 |
| 二项分布公式 | `p^k` 和 `(1-p)^{n-k}` 保留 |
| 代码中的缺失图片路径 | 未上传，保留原代码 |
| 保存后重新打开 | 三处图片、两处公式、三处题注及代码均保留 |
| 桌面编辑器和手机预览 | 已视觉检查图片、水印及公式 |

重开草稿后的五张内容图片（含两张公式渲染图）均已加载且自然尺寸非零。三处普通图片的 `src` 为 B 站 `hdslb.com` 地址，没有本地路径、Blob URL 或 Base64。核对依据是重开后的 DOM，不是仅检查首次导入成功提示。

证据文件：

- [重开草稿后的 DOM 核对结果](validation/local-image-import-0.2.0.json)
- [后续版本的脱敏演示截图](screenshots/image-spacing-0.2.3.png)

原始账号截图仅在本机保留，不随开源仓库分发。公开 JSON 的上传图片地址使用一致占位符，保留重复引用关系；该 JSON 是历史人工核验记录，不是可执行测试输入。

线上验证只覆盖上述示例。其他格式、外站图片转存、纯图片文档及异常分支仍需要进一步验证；本地测试中的上传失败、取消、正文并发修改及还原保护使用替身验证，不等同于线上风控或断网实测。

## 浏览器文件能力参考

- [文件输入框：不暴露真实文件路径](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)
- [目录选择及文件集合](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory)
- [File.webkitRelativePath](https://developer.mozilla.org/en-US/docs/Web/API/File/webkitRelativePath)
- [showDirectoryPicker 的用户手势和安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker)
