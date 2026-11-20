# 发布 CBM Navigator 到 VS Code Marketplace

扩展 ID 为 `sxcooler.cbm-vscode-navigator`，发布者 ID 为 `sxcooler`。在 GitHub Releases 上传 VSIX 供用户下载，与在 Marketplace 发布是两个操作。后者让用户能在 VS Code 的扩展面板搜索、安装和更新。两处可上传同一个已验证的 VSIX。

## 1. 准备发布包

先在 Marketplace 管理后台查看现有版本。更新扩展时，保留 `package.json` 中的 `publisher` 和 `name`，为 `version` 选择一个高于商店当前版本且未用过的版本号，同时更新 `package-lock.json` 和 `CHANGELOG.md`。已经发布过的版本不能覆盖，修正后需要用新版本重新打包。 [微软发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#auto-increment-the-extension-version)

在仓库根目录使用 PowerShell，确认每一步成功后再继续。

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd run package
$version = npm.cmd pkg get version | ConvertFrom-Json
$vsix = ".\cbm-vscode-navigator-$version.vsix"
```

`npm.cmd run package` 会先构建扩展，再在仓库根目录生成 VSIX。如果已有正式发布的候选包，直接选定该文件作为 `$vsix`。上传前核对 VSIX 内 `extension/package.json` 的扩展名、发布者和版本，并在兼容的 VS Code 中通过 **Extensions: Install from VSIX...** 安装试用。 [微软打包指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#packaging-extensions)

## 2. 上传到 Marketplace

首次使用 Marketplace 发布者后台时，如果账号还没有发布者身份，选择 **Create publisher**，填写显示名称和唯一 ID。本项目的清单使用 `sxcooler`。如果这个 ID 已注册，请使用对该发布者有权限的 Microsoft 账号。发布者 ID 在创建后无法更改。 [微软发布者注册说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#create-a-publisher)

手工发布使用有 `sxcooler` 发布权限的 Microsoft 账号登录 [Marketplace 发布者管理后台](https://marketplace.visualstudio.com/manage)，进入 `sxcooler`，按页面提示上传选定的 VSIX。首次上架选择 **New extension → Visual Studio Code**，更新版本则在现有扩展条目中选择 **Update**。网页上传通过浏览器账号认证。 [微软手工发布步骤](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-an-extension)

如果已获授权的发布身份使用 Microsoft Entra ID，且本机已安装 Azure CLI，也可以交互登录后，用项目安装的 `vsce` 上传同一个包。使用未设置 `VSCE_PAT` 的终端，避免它优先于 Entra 凭据。

```powershell
az login --allow-no-subscriptions
npm.cmd exec -- vsce publish --azure-credential --packagePath $vsix
```

旧流程的 `vsce login` 使用 Azure DevOps 全局 PAT。微软计划退役这类 PAT，日常手工发布可用网页上传，自动发布可配置 GitHub Actions Trusted Publishing 或 Azure Pipelines 的 Microsoft Entra ID。 [微软 PAT 退役公告](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/) · [微软安全自动发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace) · [Azure CLI 交互登录](https://learn.microsoft.com/cli/azure/authenticate-azure-cli-interactively)

## 3. 验证商店版本

上传后在管理后台确认版本通过验证并可用。打开公开商店页，检查发布者和版本，再用未安装该扩展的 VS Code 搜索 `@id:sxcooler.cbm-vscode-navigator`，从扩展面板安装并确认版本。首次发布或更新后，等商店显示目标版本再确认上线。 [CBM Navigator 商店页](https://marketplace.visualstudio.com/items?itemName=sxcooler.cbm-vscode-navigator)
