# Sunhat 2.x / Hardhat 3 迁移指南

迁移目标是让配置、编译、测试和部署都使用项目锁定的 Sunhat 2.x 与 Hardhat 3。旧项目在 2.x 发布包完成前应继续锁定 Sunhat 1.x；不要把当前分支的 POC 适配文件复制到生产仓库。

## Vulnerability / Issue（迁移风险）

Hardhat 2 的全局 HRE 扩展、CommonJS 部署脚本、内部 compile subtask 和 ethers v5 类型不能逐项原样搬到 Hardhat 3。混用两套 Solidity 配置会让测试或部署选到另一组 optimizer/settings；复用旧的进程级 deployment manager 还会把不同网络连接的 signer、nonce 和 fixture 状态串在一起。

## Optimized Implementation（迁移步骤）

1. 使用 Node.js 24、Hardhat 3.15.0、ethers 6.17.0，并把项目 `package.json` 设为 `"type": "module"`。依赖使用精确版本和 lockfile，不使用 `latest`。
2. 删除原生 `solidity` 配置，把编译器移入 `sunhat.compilation.targets`。每个网络通过 `networks.<name>.sunhat.target` 绑定 EVM 或 TRON 目标；同一个 `.sol` 文件不能靠扩展名推断目标链。
3. 使用 `sunhat compile` 和 `sunhat test`。测试目标由 `sunhat.test.target` 指定；TRON 测试必须显式传入绑定 TVM 的 `--network`，不会回退到 EVM。
4. 把部署脚本改为 ESM 默认导出的 async function，并通过传入 context 调用 `deploy()`。脚本不得直接发送原始交易，否则不会获得 attempt 恢复和验证资料包。
5. 部署始终显式选择网络：`sunhat deploy --network <name>`。广播结果不明或资料归档失败时，使用输出中的交易 ID执行 `sunhat verification sync --network <name> --tx <txId>`；不要重跑 deploy 作为恢复手段。
6. 保留 `build-snapshots/`、`deployments/.sunhat/attempts/` 和 `verification/`。前者绑定实际编译输入，后两者用于避免重复广播和离线复现，不属于普通 build cache。
7. 删除 Forge 初始化、`foundry.toml` 和自动 `forge test` 调用。原生 Solidity 测试可保留 `.t.sol` 命名，但由 Hardhat 3 Solidity runner 执行；新模板不依赖 `forge-std`。

最小配置以 `src/v2/cli/template.ts` 生成内容为准。自定义 tron-solc 和 Vyper 编译器必须同时配置绝对路径与 SHA-256；配置加载不下载编译器，也不会在 tron-solc 缺失时回退到 solc。

## Gas & Security Trade-offs（权衡分析）

- `+` 单一编译配置和 build ID 消除测试、部署、验证使用不同 bytecode 的风险。
- `+` 连接级 adapter 隔离 signer、nonce 和链身份；未知广播结果通过 sync 恢复，不自动重发。
- `+` 完整验证资料包不依赖当前源码或 `node_modules`，适合离线复现和审计交接。
- `-` ethers v6、ESM 部署签名和连接级 API 是破坏性迁移，旧脚本需要逐个改造并回归。
- `-` TVM 组合必须重新测量 Energy/Bandwidth；EVM gas 数据不能用于推断 TRON 成本。
- `=` 2.x 发布包尚未完成前，本指南只描述已实现接口和迁移方向，不构成升级通知。
