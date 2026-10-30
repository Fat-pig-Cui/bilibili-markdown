# 发布流程

本项目在 GitHub 开源，不发布到 npm；`package.json` 保留 `private: true`。用户脚本直接作为 Release 附件分发，不构建或打包 npm 依赖。

1. 同步 `package.json`、`package-lock.json`、脚本元数据及脚本 `VERSION`，更新 README 和 CHANGELOG。
2. 使用 Node.js 24，运行 `npm ci`、`npm run check`、`npm test` 和示例 CLI 转换。
3. 检查所有待提交文件、截图与示例；不得包含凭据、账号信息、真实草稿链接、本机绝对路径及上传图片标识。
4. 将整个 `examples/local-images/` 目录及根目录 LICENSE 打包到 `local-images-example.zip`，并确认 ZIP 保留目录层次和中文文件名。
5. 提交并推送 `main`，确认 GitHub Actions。发布前检查 package/脚本版本一致。
6. 使用 `gh release create vX.Y.Z --target <完整提交 SHA> --title vX.Y.Z --notes-file <说明文件> userscripts/bilibili-latex-import.user.js <local-images-example.zip>`。该命令在目标提交创建标签，并将脚本和示例作为附件上传。
7. 核对 Release 目标提交、附件字节、安装链接和最新版本。发布附件必须来自已验证的提交；稳定版才设为 latest。

安装及更新地址指向 `releases/latest/download/bilibili-latex-import.user.js`，避免将开发中的主分支直接用于用户自动更新。未来若需要回退已发布的缺陷，发布更高版本修复，不悄悄替换旧版本附件。

首次发布 0.2.6 的导入代码沿用已在浏览器验证的 0.2.5，仅变更项目分发元数据；后续行为改动需要重新进行浏览器验证。
