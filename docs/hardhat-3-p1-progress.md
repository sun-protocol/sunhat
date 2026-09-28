# Hardhat 3 P1 开发记录

P1 已闭合配置、CLI 和 Hardhat 3 插件接入基础：配置规范化与目标解析、全局命令到项目本地运行时的委派、`init`、本地 Hardhat 命令调度、项目模板以及 config hook 均有独立测试。旧 `src/cli.ts` 尚未切换到新入口；2.x 代码保留在 `src/v2` ESM 边界内，避免破坏当前 Sunhat 1.x 发布线。

## 已实现

| 模块 | 代码 | 已验证行为 |
| --- | --- | --- |
| 配置规范化 | `src/v2/config/normalize.ts` | 精确编译器版本、Vyper path/SHA-256、链与编译器匹配、override 引用、项目内路径、网络目标绑定、不可变结果 |
| 编译目标解析 | `src/v2/config/selection.ts` | `--target`、`--network`、`--all` 优先级与冲突；默认/单目标回退；多目标歧义失败 |
| 测试目标解析 | `src/v2/config/selection.ts` | `sunhat.test.target`、唯一 EVM 自动选择、TRON 必须显式选择 TVM 网络 |
| 项目定位 | `src/v2/cli/project.ts` | 从任意子目录向上查找配置，支持 `--config`，拒绝多配置歧义 |
| 本地运行时解析 | `src/v2/cli/project.ts` | 只解析项目/workspace 的 Sunhat 和 Hardhat；执行前校验 Node `>=22.13.0`、Sunhat 2.x、Hardhat `>=3.15.0 <4` |
| 全局转本地 | `src/v2/cli/delegate.ts` | 参数、cwd、环境、退出码和 SIGINT/SIGTERM 传递；环境标记阻断递归启动 |
| CLI 调度 | `src/v2/cli/main.ts` | `init` 默认安装依赖；本地 `compile/build/test/clean` 映射到项目锁定的 Hardhat 3；校验委派标记与真实包路径 |
| 项目模板 | `src/v2/cli/template.ts` | Hardhat 3 + ESM、显式插件、配置驱动双目标、Mocha/ethers v6、`sunhat` scripts；无 Forge 和旧 Vyper 插件 |
| Hardhat config hook | `src/v2/plugin/config-hook.ts` | 输出 Hardhat 原生校验路径；解析 `configVariable` 后执行完整路径/SHA-256 校验；向 HRE 发布不可变配置 |

## 安全约束

- 所有 sources、override 和模板文件路径限制在项目目录内；拒绝绝对路径与 `..` 穿越。
- Vyper 自定义编译器必须同时声明绝对路径和 SHA-256；编译阶段仍需执行文件哈希与版本实测。
- EVM 目标不能配置 tron-solc，TRON 目标不能配置 EVM solc；TRON 目标不能绑定 EDR、`l1` 或 `op` 网络。
- 编译器版本必须是精确版本，不接受 `latest`、caret 或范围。
- 模板先写入同级临时目录，内容完整后再重命名；非空目标目录不会被覆盖。
- 全局启动器不加载全局 Hardhat，也不会在非 `init` 流程自动修改项目依赖。
- 本地进程必须证明委派标记指向当前解析到的 Sunhat 包，不能通过伪造环境变量跳过全局到本地边界。
- `init` 依赖安装失败时返回独立错误，保留已经生成的项目供检查和重试，不做破坏性回滚。

## 测试结果

- 配置规范化与目标解析：21 项通过。
- 项目发现、本地运行时、真实子进程委派、`init` 与本地调度：16 项通过。
- 模板内容、原子写入、覆盖保护与根目录保护：5 项通过。
- config hook、配置变量解析与原型污染防护：5 项通过。
- Hardhat 3 真实 HRE config hook、ethers v6 部署和连接隔离：3 项通过。
- TypeScript `noEmit` 检查通过。

## 下一阶段边界

P2 实现三类编译器构建协调器、目标隔离、不可变构建快照和结构化诊断。当前 CLI 仅把稳定命令名映射到 Hardhat 3 公共任务；`--target`、`--all`、tron-solc 与 Vyper 的统一编译必须由 P2 任务接管，不能在 CLI 中复制编译逻辑。

根包切换到 ESM/Hardhat 3 时，还需把 P0 夹具中的 `definePlugin` 和类型扩展适配层迁入正式包入口，并执行 `npm pack` 安装测试。该切换不能早于 P2 `compile` 和 P4 `test` 形成端到端闭环。
