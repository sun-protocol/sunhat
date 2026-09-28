# Hardhat 3 P4 开发记录

P4 已接通 Sunhat 自有构建与 Hardhat 3 测试执行器：TypeScript/Mocha 和原生 Solidity 测试共享同一目标快照，测试阶段固定 `noCompile: true`，不会再由 Hardhat 默认 profile 覆盖产物。本地 EDR 还完成了 `compile → deploy → verification archive` 实际闭环。

## Vulnerability / Issue（隐患/问题）

直接把 `sunhat test` 转发到 `hardhat test` 会触发第二次原生构建，测试使用的字节码可能与 Sunhat 目标产物不同。部署脚本若沿用 CommonJS cache 清理或允许符号链接，还会产生脚本顺序不稳定和项目外代码加载风险。

P4 尚未达到发布门槛：根包仍是 1.5.0/CommonJS，Hardhat 3 task action 仍放在固定版本 POC 适配层，尚未执行 2.x `npm pack` 安装验证；TRON 真实 TVM 和 Vyper/TRON 测试仍缺运行环境。当前提交不把这些未验证路径标成生产可用。

## Optimized Implementation（优化实现）

| 模块 | 代码 | 已验证行为 |
| --- | --- | --- |
| 测试协调器 | `src/v2/test/task.ts` | 按 test target/显式 target/网络绑定选取单一目标；构建一次后向 runner 强制传入 `noCompile: true`；失败原样传播 |
| CLI 语义 | `src/v2/cli/main.ts` | `sunhat test`、`sunhat deploy`、`sunhat verification sync` 映射到 Sunhat 命名空间任务 |
| Artifact 绑定 | `src/v2/plugin/config-hook.ts` | 无原生 Solidity 冲突时，将 Hardhat 测试 artifact 根绑定到 `artifacts/sunhat/<testTarget>/solidity`；多 EVM 目标不做隐式首选 |
| 测试任务 | `poc/hardhat3-p0/src/p4-test-task-action.ts` | 通过 Hardhat 公开 task manager 调用统一 test runner；Mocha 与 Solidity runner 共用 Sunhat 构建结果 |
| 部署脚本 | `src/v2/deploy/scripts.ts` | ESM 动态加载、确定性顺序、受控 cache key、目录穿越与符号链接拒绝 |
| EVM 工作流 | `p4-deploy-task-action.ts`、`p4-evm-client.ts` | 显式网络、公开 ethers v6 连接、部署脚本、P3 Manager、资料归档；EDR 进程实例进入网络身份 |
| Sync 入口 | `p4-verification-sync-task-action.ts` | 按交易 ID 查找保存的 attempt，只恢复归档，不重新广播；POC 仅启用 EVM 网络 |
| 项目模板 | `src/v2/cli/template.ts` | 同时生成 TypeScript 和原生 Solidity 测试；Solidity 测试使用 custom error，不引入 Forge |

验证结果：

- P4 测试协调器 4 项、部署脚本加载 3 项通过。
- Hardhat 3 统一测试任务实际运行 2 项：1 项 TypeScript/Mocha、1 项原生 Solidity；分别执行文件筛选也通过。
- 本地 EDR 部署任务成功生成地址级资料包，immutable runtime 比对结果为 `normalized`；命令未连接外部 RPC。
- P0 EVM 连接隔离回归 3 项通过；P1 49 项、P2 构建/Vyper 路由 16 项、P3 10 项全部通过；TypeScript `noEmit` 通过。

## Gas & Security Trade-offs（权衡分析）

- `+` 测试 runner 禁止二次编译，断言执行的 bytecode 与 build ID、部署快照保持一致。
- `+` 原生 Solidity 测试走 Hardhat 3 公开 runner，不安装或调用 Forge。
- `+` ESM 部署脚本按路径排序并拒绝 symlink，减少非确定执行和项目外代码注入面。
- `+` 本地 EDR 身份包含进程实例，节点重置后不会复用旧地址资料目录。
- `-` Solidity 测试 artifact 当前绑定到目标的 `solidity/` 子树；Vyper 仍通过 JS/TS 测试直接读取目标隔离产物。
- `-` 完整源码、build-info 和链上证据继续增加本地 I/O；不增加部署 gas、Energy 或 Bandwidth。
- `=` EVM EDR 通过不能替代 TVM 验收。根入口切换、发布包和真实 TRON 测试完成前，P4 状态保持“进行中”。
