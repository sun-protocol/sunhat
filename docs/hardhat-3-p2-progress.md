# Hardhat 3 P2 开发记录

P2 已闭合三类编译器的统一构建路径：`sunhat compile` 通过项目本地 Hardhat 3 任务解析目标，按目标隔离 Solidity、tron-solc 与 Vyper 产物，成功后提交内容寻址的不可变快照，失败时清除旧工作产物并写入结构化诊断。

## 已实现

| 模块 | 代码 | 已验证行为 |
| --- | --- | --- |
| 构建协调器 | `src/v2/build/coordinator.ts` | 默认目标、显式目标和全目标复用 P1 解析规则；构建按目标串行执行，产物位于 `artifacts/sunhat/<target>` |
| Hardhat 3 Solidity 适配 | `poc/hardhat3-p0/src/p2-hardhat-backend.ts` | 仅使用 `hardhat/hre` 与 `hre.solidity` 公共 API；solc、tron-solc 自定义路径、多版本和逐文件 override 交给 Hardhat 构建图校验 |
| 依赖闭包 | `poc/hardhat3-p0/src/p2-hardhat-backend.ts` | Hardhat compilation job 的完整依赖图、包版本、源码哈希和原生 build ID 进入 Sunhat build ID；npm 依赖源码归档到 `sources/npm/...` |
| Vyper 适配 | `src/v2/build/vyper.ts` | 精确版本/范围 pragma、最高兼容版本、逐文件 override、编译器路径与哈希、实际版本、Python/pip 环境锁、超时和 64 MiB 输出上限 |
| Vyper 隔离 | `src/v2/build/vyper.ts` | Standard JSON 只包含配置目录中收集的 `.vy`、`.vyi` 与 JSON 接口；编译进程使用空临时工作目录和 `shell: false`，不从项目目录隐式读取依赖 |
| Vyper 产物 | `src/v2/build/vyper.ts` | 生成 `sunhat-vyper-artifact-1`，并按 build ID 分离保存 `sunhat-vyper-build-info-1` 与 `sunhat-vyper-build-info-output-1` |
| 不可变快照 | `src/v2/build/snapshot.ts` | build ID 覆盖链、编译器、settings、override、Hardhat 依赖闭包和源码；manifest 校验拒绝哈希变化、缺失文件、额外文件与符号链接 |
| 失败关闭 | `src/v2/build/coordinator.ts` | 编译器哈希不符、依赖解析失败、编译错误或快照篡改均清除旧工作产物，只保留 `compilation-errors.json` |
| CLI 与任务 | `src/v2/cli/main.ts`、`poc/hardhat3-p0/src/sunhat-v2-plugin.ts` | `sunhat compile`/`sunhat build` 映射到懒加载的 `sunhat compile` Hardhat 任务；支持 `--target`、`--network`、`--all` 和 `--force` |

Sunhat 配置仍是被管理目标的唯一编译配置来源。任务发现原生 `solidity` 与 `sunhat.compilation` 同时存在时直接失败，不合并两套 compiler/settings。

## 验证结果

- 构建协调器与快照：12 项通过。
- Vyper 多版本与 override 路由：4 项通过。
- 真实编译集成：5 项通过。临时项目从空的项目级 artifacts/cache 开始，完成 EVM solc + Vyper 混合构建、tron-solc + Vyper 独立目标构建、npm 依赖变更失效，以及三类编译器失败关闭。
- P1 配置、CLI、模板与插件回归通过；TypeScript `noEmit` 检查通过。
- 真实 Hardhat CLI 连续执行两次得到相同 build ID `0b423cfea1cb2da7bfad795a6dac83a934b9f409fc6a18a8d3e97f52dd78d9e4`，第二次返回 `cacheHit: true`。

Vyper 0.4.3 的 JSON 错误对象会结构化返回文件名和错误类型，但部分错误只在 `formattedMessage` 中携带行列号。实现优先读取结构化字段，仅在字段缺失时解析 JSON 内的 `line N:C`，不读取 stderr 或终端彩色输出。

Hardhat 管理的标准 solc 通过原生 compilation build ID、完整版本和 Hardhat 版本锁定；显式 `path` 的 solc、tron-solc 与 Vyper 额外记录并校验文件 SHA-256。标准 solc 下载文件的独立 SHA-256 归档需要后续受信任编译器清单，当前实现不导入 Hardhat 私有下载器路径获取该值。

## 阶段边界

根包仍维持 Sunhat 1.x / Hardhat 2 发布边界。Hardhat 3 的 `definePlugin`、任务 builder 和 Solidity backend 暂放在固定版本 POC 适配层，纯配置、协调器、快照、Vyper 和任务执行逻辑位于 `src/v2`。根入口切换、`npm pack` 安装验证和测试任务接管留在 P4，避免在 `compile → test → deploy` 闭环形成前破坏 1.x。

P0 尚未完成的真实 TVM 部署/执行门槛不由本阶段编译成功替代。P2 只证明 tron-solc 构建目标隔离与编译失败语义；Vyper/TRON 字节码兼容和 Energy/Bandwidth 结果必须由后续真实 TVM 验收提供。
