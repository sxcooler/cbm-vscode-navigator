# CBM Navigator 中英文多语言设计

## 状态

已确认，待实现。

## 背景

CBM Navigator 当前在扩展清单、状态栏、CodeLens、通知、确认框和日志中直接使用英文。首期多语言支持需要覆盖英文和简体中文，同时保持扩展轻量、遵循 VS Code 的语言选择方式，并避免把本地化逻辑耦合进导航与索引业务代码。

VS Code 对静态清单和运行时字符串使用两套原生机制：`package.nls*.json` 本地化 `package.json`，`vscode.l10n.t` 与 `bundle.l10n*.json` 本地化扩展运行时。该方案不需要运行时第三方依赖，并能自动使用 VS Code 的显示语言和英文回退。

## 目标

- 支持英文和简体中文，英文为默认及回退语言。
- 自动跟随 VS Code 显示语言，不增加扩展自己的语言设置。
- 覆盖扩展清单、状态栏、CodeLens、通知、确认操作和扩展生成的用户可见状态说明。
- 提供完整的英文与简体中文 README，并共用现有功能截图。
- 保持纯业务模块不依赖 `vscode`，使单元测试仍可在普通 Node.js 环境运行。
- 在测试和打包阶段检测遗漏的键、占位符和发布文件。

## 非目标

- 不支持扩展内手动切换语言。
- 不支持繁体中文或其他语言。
- 不在运行中热切换语言；VS Code 的显示语言变更按宿主行为在重启后生效。
- 不翻译文件路径、代码、符号名、命令 ID、配置键、状态枚举或 CBM 返回的原始诊断内容。
- 不引入机器翻译、在线翻译服务、README 自动生成或完整翻译管理平台。

## 方案选择

采用 VS Code 原生双通道本地化：

1. 静态清单使用根目录下的 `package.nls.json` 和 `package.nls.zh-cn.json`。
2. 运行时使用 `vscode.l10n.t`，语言包位于 `l10n/bundle.l10n.json` 和 `l10n/bundle.l10n.zh-cn.json`。
3. `package.json` 增加 `"l10n": "./l10n"`，并用 `%key%` 引用可本地化的清单字符串。

不采用自建语言设置，因为它会重复 VS Code 已有的 locale、回退和语言包加载能力。也不采用只翻译清单的最小方案，因为那会留下状态栏、CodeLens 和交互提示等主要功能界面为英文。

参考：

- <https://github.com/microsoft/vscode-l10n>
- <https://code.visualstudio.com/api/references/vscode-api#l10n>

## 本地化边界

| 表面 | 本地化内容 | 保持原样的内容 |
|---|---|---|
| Marketplace 与扩展清单 | 扩展描述、命令标题、设置标题与说明、枚举值说明 | `CBM Navigator` 品牌名、命令 ID、设置键、`vscode`/`idea` 配置值 |
| 状态栏 | Trust Required、Install、Upgrade、Index、Indexing、Ready、Stale、Degraded、Error | Codicon 标识和内部状态枚举 |
| CodeLens | declaration、implementation(s)、caller(s)、reference(s) | 数量、箭头符号、目标位置 |
| 通知与确认框 | 提示正文、按钮、安装/升级/索引动作 | 工作区路径、版本号、CBM 项目名 |
| 状态详情与日志 | 扩展生成的说明和错误上下文 | CBM、Node.js、文件系统等下层返回的原始错误文本 |
| 导航结果 | Peek 标题中由扩展提供的文字（如有） | 文件名、符号签名、代码和路径 |

原始错误不二次翻译，避免破坏可搜索的诊断信息。需要上下文时使用“已本地化前缀 + 原始错误”的组合，例如中文界面显示本地化的“索引失败：”，后接 CBM 原始错误。

## 静态清单设计

`package.json` 中以下字段改用 `%key%`：

- 顶层 `description`。
- `contributes.commands[*].title`。
- `contributes.configuration.title` 和每项设置的 `description`。
- 若增加 `enumDescriptions`，其内容也必须使用本地化键；枚举值本身保持不变。

`displayName` 和命令 `category` 保持 `CBM Navigator`，因为它们是产品品牌而非自然语言。`package.nls.json` 保存英文基准文本，`package.nls.zh-cn.json` 保存相同键集合的简体中文翻译。VS Code 负责根据 locale 选择文件，缺失翻译时回退英文。

## 运行时架构

新增 `src/localization.ts`，它是唯一直接调用 `vscode.l10n.t` 的业务源文件，并导出类型化的 `UiMessages`：

- `status`：按 `RootStateKind` 返回状态栏文本。
- `codeLens`：生成声明、实现、调用和引用标题，并处理英文单复数。
- `notifications`：安装、升级、索引、状态展示和错误提示。
- `actions`：Continue、Install、Upgrade、Start、Refresh 等交互按钮。
- `logs`：扩展生成的日志前缀与说明。

每个 `vscode.l10n.t` 调用使用静态英文源字符串和位置占位符，如 `{0}`，以便官方工具抽取。参数化文本不使用字符串拼接构造待翻译句子；工作区路径、版本号和错误信息作为占位符传入。

`ExtensionController` 在激活时创建一次 `UiMessages` 并传给需要展示文本的组件。`status.ts`、`codeLensModel.ts` 等纯模块只接收各自所需的窄消息接口，不导入 `vscode`：

- `statusPresentation(kind, statusMessages)` 组合 Codicon、已本地化标签和命令 ID。
- `buildDeclarationLenses(descriptor, bundle, codeLensMessages)` 保留关系选择逻辑，只委托消息接口生成标题。
- `registerNavigationProviders` 接收 CodeLens 消息接口并向 provider 传递。

这种边界让 VS Code API、翻译资源和导航逻辑可以独立测试，也避免为了本地化而让低层图查询或解析模块依赖扩展宿主。

## Catalog 与占位符规则

- 英文是所有键和占位符的基准。
- 简体中文 catalog 必须拥有完全相同的键集合。
- 同一个键的英文和中文必须拥有相同的 `{0}`、`{1}` 等占位符集合。
- CodeLens 英文分别定义单数和复数消息；中文可以把两者翻译成相同语法，但仍保留两个键，避免把英语语法规则写入通用逻辑。
- 翻译内容不得改变命令 ID、配置键、状态枚举、文件扩展名和产品名。
- 添加 `@vscode/l10n-dev` 作为开发依赖，用于从静态 `vscode.l10n.t` 调用抽取英文 runtime bundle；它不进入运行时 bundle。Catalog 键与占位符一致性仍由 Vitest 校验。

## README 双语设计

- `README.md` 保持英文，并在标题下提供 `[简体中文](README.zh-CN.md)`。
- 新增完整的 `README.zh-CN.md`，在标题下提供 `[English](README.md)`。
- 两份 README 章节顺序、功能范围、设置表格和已知限制保持一致。
- 两份 README 共用 `images/` 中的截图，各自提供对应语言的图片替代文字。
- 原始命令名和设置键保持英文并使用代码格式，便于用户在命令面板与设置中搜索。
- 修改功能或限制时，两份 README 必须在同一个任务中同步更新。

## 错误处理与回退

- VS Code locale 不是 `zh-cn` 时使用英文，除非未来提供对应语言包。
- 中文键缺失时使用 VS Code 的英文回退，不阻止扩展激活。
- Catalog 键或占位符不一致属于开发错误，由测试和发布检查阻止提交或打包。
- 翻译不能参与业务分支判断。需要比较用户选择时，保存传给 VS Code 的本地化按钮字符串并比较返回值；命令与状态分支仍使用稳定的内部 ID。
- 下层原始错误附加在本地化上下文之后，不修改原文，也不写入翻译 catalog。

## 测试策略

### 单元测试

- 校验英文与中文 `package.nls` 的键集合和占位符一致。
- 校验英文与中文 runtime bundle 的键集合和占位符一致。
- 校验 `package.json` 约定范围内的用户可见字段全部引用有效的 `%key%`。
- 用英文和中文消息对象验证所有状态栏状态映射。
- 验证 CodeLens 的声明、实现、调用、引用以及英文单复数标题。
- 验证本地化按钮不改变安装、升级和索引分支行为。

测试断言面向最终展示结果与分支行为，不断言实现源码中存在某一行文本。

### VS Code 集成测试

- 保留默认英文 Extension Host 冒烟测试。
- 增加以 `--locale=zh-cn` 启动的最小宿主测试：读取已本地化的扩展清单，并通过 `createUiMessages()` 验证至少一个状态栏标签和一个运行时交互字符串。该测试验证真实语言包加载，不依赖屏幕截图或 VS Code 私有 UI API。
- 中文宿主测试继续禁用 Java 运行时变量，确保本地化不改变现有轻量运行条件。

### 打包验证

生成 VSIX 后确认以下文件被收录：

- `package.nls.json`
- `package.nls.zh-cn.json`
- `l10n/bundle.l10n.json`
- `l10n/bundle.l10n.zh-cn.json`
- `README.md`
- `README.zh-CN.md`
- `images/` 中 README 使用的截图

当前 `.vscodeignore` 不排除根目录 `package.nls*`、`l10n/`、README 或 `images/`，无需为语言包放宽对源码、测试和设计文档的排除规则。

## 实施顺序

1. 先增加 catalog 一致性和清单本地化的失败测试。
2. 添加 `@vscode/l10n-dev` 开发依赖、抽取脚本和静态 `package.nls` 文件，再迁移 `package.json`。
3. 增加 `UiMessages`，再按状态栏、CodeLens、通知和日志的顺序迁移运行时字符串，每一步执行红绿重构循环。
4. 添加中文 Extension Host 冒烟测试。
5. 增加 `README.zh-CN.md` 和双向语言链接。
6. 运行类型检查、完整单元测试、英中文宿主测试、构建与 VSIX 打包检查。
7. 对源文件、语言包、README 和 VSIX 内容做隐私信息扫描。

## 发布与兼容性

- 继续使用当前 VS Code API 基线；`vscode.l10n.t` 自 VS Code 1.73 起可用，低于本项目当前引擎要求。
- 不增加运行时依赖，不改变 CBM 协议、索引、导航、热键或设置值。
- 已有用户无需迁移配置；语言由 VS Code 自动选择。
- 若后续增加语言，只需增加同结构 catalog 和文档，不修改业务协议。

## 验收标准

- 英文 VS Code 中现有用户体验保持一致。
- 简体中文 VS Code 中，约定范围内的清单和运行时文字均显示中文。
- 缺少翻译时安全回退英文，扩展仍能激活和导航。
- 英文与中文的按钮选择执行相同业务分支。
- 所有 catalog 键与占位符检查通过。
- 两份 README 内容同步、图片有效，VSIX 包含全部本地化资源。
- 完整测试、类型检查、构建和打包通过，发布内容不包含用户私有路径或项目数据。
