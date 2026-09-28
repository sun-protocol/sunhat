# Hardhat 3 P0 验证记录

结论：Hardhat 3.15.0 的公共 API 足以承载 EVM、tron-solc 自定义构建、连接级 Sunhat 扩展和 Vyper 独立编译；TVM 执行尚未验证，因此 P0 仍有一个外部环境门槛，不能进入 TRON 部署实现验收。

验证日期：2026-09-23。P0 夹具已在 P4 归并为 `src/v2` 生产实现与 `test-v2/build-integration.test.ts`、`test-v2/fixtures/hardhat3-release` 回归用例；重复 POC 已删除，原始验证版本由 Git 历史保留。

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| Hardhat 3 公共 Solidity 构建 | 通过 | `hardhat build --build-profile production` 产出 `hh3-artifact-1` |
| build-info 关联 | 通过 | artifact 的 `buildInfoId` 同时关联 `hh3-sol-build-info-1` 和 `hh3-sol-build-info-output-1` |
| 显式网络连接 | 通过 | 两次 `network.create()` 分别部署合约，链状态互不共享 |
| `newConnection` hook | 通过 | 每条连接挂载独立 `ProbeManager`，对象、connection ID 和可变状态均隔离 |
| ethers v6 部署与写入 | 通过 | Counter 部署、交易确认和 `bigint` 读取通过 |
| tron-solc 0.8.25 自定义路径 | 通过 | 官方 WASM SHA-256 校验后构建成功，build-info 为 `0.8.25+commit.77bd169f` |
| Vyper 0.4.3 JSON 编译 | 通过 | `vyper-json` 版本/哈希校验、Standard JSON 编译和独立 artifact 生成通过 |
| Vyper artifact 执行 | 通过 | 使用 ethers v6 `ContractFactory` 部署，构造、读取和写入通过 |
| npm 依赖审计 | 通过 | 安全版本与精确 override 安装后 `npm audit` 为 0 |
| TVM 部署与执行 | 未验证 | Docker daemon 未运行；禁止以 Hardhat EVM 结果替代 |

## 已确认的实现约束

1. Sunhat 2.x 插件入口必须返回显式 `HardhatPlugin`，网络扩展使用懒加载 `network` hook；不再使用 `extendEnvironment`。
2. `DeploymentsManager` 必须按 `NetworkConnection` 创建。`WeakMap` 可用于生命周期关联，但运行 API 应直接挂载只读的 `connection.sunhat`。
3. Solidity 与 tron-solc 可复用 Hardhat `path` 配置，但 Sunhat 构建快照仍需显式记录 `kind`、目标链和 SHA-256；只凭 artifact 的 `solcVersion` 不足以表达部署目标。
4. Hardhat 3 的 build-info 输入与输出分离。后续验证资料包必须同时归档两者，不能沿用 Hardhat 2 的单文件读取逻辑。
5. Vyper artifact 不伪装成 Hardhat Solidity artifact。首期格式固定为带版本号的 Sunhat artifact，并保留原始 input/output、编译器文件哈希、Python 版本和完整依赖列表。
6. 编译器路径加载前必须核对可信清单中的 SHA-256。P0 使用 TRON GitHub Release API 的 asset digest；生产实现应把经复核的版本清单签入仓库，配置加载和构建阶段不得联网取最新值。

## 下一开发切片

P1 先实现纯配置层和目标解析器：校验 `sunhat.compilation.targets`、解析 `--target`/`--network`/`--all` 冲突，并把解析结果映射到隔离的 build profile。该层不读取私钥、不连接 RPC、不下载编译器。TVM 环境恢复后并行补齐 P0 的真实部署、读取、写入、回执失败和 Energy/Bandwidth 证据。
