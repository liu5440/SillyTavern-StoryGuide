# 发布到 GitHub 并通过 URL 安装

目标公开仓库：https://github.com/liu5440/SillyTavern-StoryGuide 。FR-01 发布范围：默认分支提供清单、样式与预构建脚本，用户无需本地构建。发布验证结果见 verification.md。

## 仓库内容

GitHub 默认分支根目录必须有 `manifest.json`、`style.css`、`dist/index.js`，保留三者的相对路径。源代码、锁文件、文档与测试也一起提交。不要只上传 src，也不要把项目套在额外的文件夹下。

`.gitignore` 已排除 node_modules、测试截图、独立酒馆测试数据与日志。发布前运行检查，不上传个人角色卡、聊天、模型配置与密钥。

## 发布

1. 在自己的 GitHub 账号下创建一个空仓库，建议名称 `SillyTavern-StoryGuide`。公开仓库便于酒馆 Git URL 安装；私有仓库需要酒馆服务端具备 Git 访问权限。
2. 在当前项目目录运行 `npm ci` 和 `npm run check`，确认成功。
3. 初始化 Git（如尚未初始化），提交项目文件，包括 dist/index.js。
4. 将真实 GitHub 地址设置为 origin，推送 main 分支。不要将占位地址照抄执行。
5. 在一份干净酒馆中，使用仓库首页 URL 安装并刷新，验证扩展入口。

如果使用 GitHub 网页上传，也必须上传预构建 dist 目录，不要求安装者运行 npm。

## 更新

修改后执行检查和构建，源代码与 dist 一起提交，按实际发布更新 manifest/package 版本。用户可在酒馆“管理扩展程序”中更新，之后刷新页面。

CI 会重新构建并检查 dist 是否与源代码一致，还会执行浏览器夹具测试。CI 不代表所有模型及全部酒馆版本都兼容。

## 账号与远程状态

用户已指定公开仓库，连接账号具有推送权限。保留仓库初始化时选择的 AGPL-3.0 许可证；不上传本地测试数据、密钥和 node_modules。未提交的工作区变更保留在原目录，本次发布基于已提交的 4fc1689 版本。
