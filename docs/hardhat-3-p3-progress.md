# Hardhat 3 P3 开发记录

P3 已形成部署状态机和地址级验证资料包的核心闭环。EVM 路径已在 Hardhat 3 EDR 上完成真实创建交易、回执读取、链上 runtime 获取和归档；TRON 路径完成了独立适配边界与故障恢复测试，但真实 TVM 验收仍受 P0 的本地节点条件限制，不能把模拟适配测试写成链上执行结论。

## Vulnerability / Issue（隐患/问题）

旧部署流程将“交易已广播”“交易执行成功”和“验证资料已保存”混为一个结果，并从可变工作目录收集源码。进程在广播后中断时，重跑可能再次发送；源码、依赖或 artifact 随后变化时，部署地址也无法再证明对应哪次构建。

P3 仍有两个明确边界：生产 CLI 的部署脚本加载与连接 hook 要随 P4 的 ESM 根入口一起接通；TRON 适配器尚未在真实 TVM 上验证签名、回执、Energy 和 Bandwidth。当前实现不向测试网或主网广播，也不宣称完成这两项验收。

## Optimized Implementation（优化实现）

| 模块 | 代码 | 已验证行为 |
| --- | --- | --- |
| 部署状态机 | `src/v2/deploy/manager.ts` | 绑定 P2 build ID 和规范快照；发送前保存 attempt；pending、failed、executed、archive-failed、archived 分态；未知广播结果禁止自动重发 |
| Attempt 存储 | `src/v2/deploy/attempt-store.ts` | 内容寻址 ID、十进制大整数、原子替换、父目录符号链接拒绝；重复计划要求恢复旧记录，不再次广播 |
| 链身份 | `src/v2/deploy/network-key.ts` | `chain + chainId + genesisHash/instanceId` 生成隔离键，避免同地址跨链或本地重置链碰撞 |
| EVM/TRON 边界 | `src/v2/deploy/evm-adapter.ts`、`tron-adapter.ts` | 只依赖公开客户端接口；TRON 不继承 ethers Provider，sun、Energy、Bandwidth 由客户端以独立十进制字段保存 |
| Runtime 比对 | `src/v2/deploy/runtime-match.ts` | 区分 exact、normalized、mismatch、insufficient；仅屏蔽 artifact 声明的链接和 immutable 字节范围，不裁剪 metadata |
| 验证归档 | `src/v2/deploy/archive.ts` | 输出 `verfication-<address>`；复制快照源码、artifact、原始 build-info 和编译器元数据；保存部署输入、原始回执和链上代码；文件二次哈希后原子 rename |
| 恢复 | `DeploymentManager.sync()` | 只使用 attempt 指向的旧快照；重复同步不广播；每次重取回执并在 attempt 中保留去重后的观察历史 |

资料包默认使用多文件源码。Solidity 的 `both`/`flatten` 会额外生成明确标记为 `UNVERIFIED` 的确定性拼接视图，原始 source unit 与 Standard JSON 始终保留为权威输入；未完成重编译匹配前不会把拼接文本标成可提交源码。Vyper 显式选择 `flatten` 会在广播前失败，`both` 只保留多文件视图。

验证结果：

- P3 状态机与归档测试 10 项通过，包括 EVM/TRON 成功归档、initcode/快照绑定、广播结果不明、重复部署阻断、失败回执、归档失败、路径穿越/符号链接、幂等同步和 runtime 范围比对。
- Hardhat 3 EDR 真实部署测试 1 项通过，创建交易后的链上 runtime 与快照 artifact 精确匹配。
- P1 配置/CLI/模板/插件 49 项、P2 构建与 Vyper 路由 16 项回归通过；P3 TypeScript `noEmit` 检查通过。
- P2 真实三编译器集成本轮未重跑，因为当前 shell 未提供 `TRON_SOLC_PATH`、`TRON_SOLC_SHA256`、`VYPER_JSON_PATH` 和 `VYPER_JSON_SHA256`；其已提交测试未被修改。

## Gas & Security Trade-offs（权衡分析）

- `+` 广播前持久化恢复标识，未知结果只允许 sync，消除自动重发导致的双部署风险。
- `+` 归档仅从哈希校验后的不可变快照读取，当前源码、缓存和 `node_modules` 变化不会污染旧地址资料。
- `+` 精确的 runtime 差异范围避免把链接地址或 immutable 正常变化误报，也不会屏蔽任意字节差异。
- `+` EVM wei 与 TRON sun/资源字段保持十进制字符串，避免 `number` 精度丢失和 gas/Energy 单位混用。
- `-` 每个地址保存完整依赖、artifact、build-info 和回执，磁盘占用高于共享缓存；这是离线复现和独立交接的成本。
- `-` 发送前写盘、归档二次哈希与确认等待增加本地 I/O 和完成时延，不增加合约部署 gas 或 TRON Energy/Bandwidth。
- `=` 当前 TRON 测试证明的是适配器协议和归档语义，不是 TVM 执行兼容性；必须在可用节点上补齐真实部署、读写、失败回执和资源消耗验收。
