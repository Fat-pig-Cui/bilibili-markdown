# 第三方组件与素材

本项目原创代码、文档和 `examples/local-images/assets/` 中为本项目绘制的曲线图、流程图采用根目录 MIT 许可证。第三方组件不因本项目许可而改变其原有许可。

仓库不提交 `node_modules`，独立用户脚本也不打包以下 npm 依赖。开发及 CLI 依赖由 npm 安装，各包中的完整许可证和 NOTICE（如有）随安装内容保留。

| 直接依赖 | 用途 | 当前锁定版本 | 许可证 |
| :---: | :---: | :---: | :---: |
| [mathjax-full](https://github.com/mathjax/MathJax-src) | CLI 公式渲染 | 3.2.2 | Apache-2.0 |
| [sharp](https://github.com/lovell/sharp) | CLI 图片转换 | 0.35.5 | Apache-2.0 |
| [jsdom](https://github.com/jsdom/jsdom) | 自动测试 | 29.1.1 | MIT |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 自动测试 | 15.0.3 | MIT |

上表不是完整的传递依赖清单；具体版本及其他依赖见 `package-lock.json`。重新分发包含依赖的发行包或原生二进制时，应一并核对并保留对应许可证和通知。

用户脚本在浏览器中调用 Bilibili 页面已经加载的编辑器、Markdown 解析器、公式渲染与图片上传能力，不在仓库中分发 Bilibili 的打包脚本。分析文档中的节点结构和接口示例用于说明兼容方式。

演示截图包含 Bilibili 界面元素，已裁去账号信息；相关商标、界面及服务不属于本项目 MIT 授权范围。本项目与 Bilibili、Tampermonkey 等无隶属或官方背书关系。
