# Hardhat 3 P4 开发记录

P4 已把 Hardhat 3 适配层迁入根包并产出 `2.0.0-alpha.1` ESM tarball。干净项目从 tarball 安装后，项目本地 CLI、插件任务、Solidity 编译、TypeScript/Mocha 与原生 Solidity 测试全部通过；本地 EDR 也完成了 `compile → deploy → verification archive` 闭环。

## Vulnerability / Issue（隐患/问题）

直接把 `sunhat test` 转发到 `hardhat test` 会触发第二次原生构建，测试字节码可能与 Sunhat 目标产物不同。依赖聚合包使用宽松 peer 时还会在干净安装中自动选择未经验证的新插件版本，本次实际复现了 `hardhat-ethers@4.1.0` 与 Hardhat 3.15.0 的冲突。

P4 仍未达到 RC 门槛：TRON 真实 TVM、Vyper/TRON 执行和 Energy/Bandwidth 尚无验收环境；生产 task 因此拒绝 TRON deploy/sync。仓库保留的 1.x 源码仍含 Hardhat 2 内部导入，但不进入 2.x tarball；若发布规则要求对整个 `src/` 执行零匹配检查，还需把 1.x 实现移出 2.x 分支。

## Optimized Implementation（优化实现）

| 模块 | 代码 | 已验证行为 |
| --- | --- | --- |
| 正式插件入口 | `src/v2/index.ts`、`src/v2/hardhat/plugin.ts` | ESM 默认导出 Hardhat 3 plugin；compile/test/deploy/sync action 按需加载 |
| 测试协调器 | `src/v2/test/task.ts` | 选择单一测试目标；构建一次后向 runner 强制传入 `noCompile: true` |
| Artifact 绑定 | `src/v2/plugin/config-hook.ts` | 将测试 artifact 根绑定到目标的 `solidity/` 子树；多 EVM 目标不做隐式首选 |
| EVM 工作流 | `src/v2/hardhat/actions/deploy.ts`、`src/v2/hardhat/evm-client.ts` | 显式网络、ethers v6 capability check、P3 Manager 与资料归档；EDR 实例进入网络身份 |
| Sync 入口 | `src/v2/hardhat/actions/verification-sync.ts` | 按交易 ID 查找 attempt，只恢复归档，不重新广播；alpha 仅启用 EVM |
| 部署脚本 | `src/v2/deploy/scripts.ts` | ESM 动态加载、确定性顺序、受控 cache key、路径穿越与符号链接拒绝 |
| 项目模板 | `src/v2/cli/template.ts` | 精确锁定已验证插件版本；同时生成 TypeScript 和原生 Solidity 测试，不引入 Forge/toolbox |
| 发布包 | `package.json`、`tsconfig.v2.json` | NodeNext/ES2022、严格 exports、Hardhat 3 peer、根 lockfile；旧 1.x 源码不打包 |

验证结果：

- TypeScript `noEmit`、技能结构校验和 82 项无外部工具链回归全部通过。
- 正式入口运行 2 项 Hardhat 3 测试：1 项 TypeScript/Mocha、1 项原生 Solidity；测试阶段没有第二次编译。
- 本地 EDR 部署生成完整地址资料包，runtime 比对为 `exact`；未连接外部 RPC。
- `npm pack` 产出 88.4 kB、202 文件的 tarball。干净目录安装后，bin 可执行、插件可导入、`hardhat --help` 可见 Sunhat task，`sunhat compile` 和 `sunhat test` 均通过。
- 干净模板首次安装发现 toolbox 浮动 peer 会选中要求 Hardhat 3.17 的 ethers 插件；模板改为直接精确锁定 4.0.3/3.1.0 后复验通过，依赖审计为 0 个已知漏洞。
- 三编译器真实集成未重跑：当前环境未提供 `TRON_SOLC_PATH`、`TRON_SOLC_SHA256`、`VYPER_JSON_PATH` 和 `VYPER_JSON_SHA256`。

## Gas & Security Trade-offs（权衡分析）

- `+` 测试 runner 禁止二次编译，断言执行的 bytecode 与 build ID、部署快照保持一致。
- `+` 原生 Solidity 测试走 Hardhat 3 公开 runner，不安装或调用 Forge。
- `+` ESM 部署脚本按路径排序并拒绝 symlink，减少非确定执行和项目外代码注入面。
- `+` 发布包只有 ESM v2 产物和更新后的技能，不携带 Hardhat 2 运行时代码。
- `-` Solidity 测试 artifact 当前绑定到目标的 `solidity/` 子树；Vyper 仍通过 JS/TS 测试直接读取目标隔离产物。
- `-` 完整源码、build-info 和链上证据继续增加本地 I/O；不增加部署 gas、Energy 或 Bandwidth。
- `=` EVM EDR 和 tarball 验收不能替代 TVM。真实 TRON 测试完成前版本保持 alpha，P4 状态保持“进行中”。
