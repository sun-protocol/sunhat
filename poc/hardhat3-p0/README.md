# Hardhat 3 P0 可行性验证

该夹具验证 Sunhat 2.x 的四个前置边界：Hardhat 3 公共构建接口、连接级插件状态、tron-solc 自定义编译器路径，以及 Vyper JSON 产物能否在 Hardhat 3 EVM 连接中部署执行。它与 Sunhat 1.x 依赖隔离，不是可发布运行时。

## 固定版本

- Node.js：`>=22.13.0`，本次验证使用 `24.15.0`
- Hardhat：`3.15.0`
- `@nomicfoundation/hardhat-ethers`：`4.0.3`
- `@nomicfoundation/hardhat-mocha`：`3.1.0`
- ethers：`6.17.0`
- TypeScript：`5.9.3`
- Ethereum solc：`0.8.25+commit.b61c2a91`
- TRON solc：`0.8.25+commit.77bd169f`
- Vyper：`0.4.3+commit.bff19ea2`

`package-lock.json` 固定 npm 依赖。Mocha 11 的依赖范围尚未纳入已修复的 `diff` 和 `serialize-javascript`，因此 `package.json` 临时使用精确 `overrides`；官方插件升级依赖后应删除 override 并重新审计。

## 运行

安装 npm 依赖：

```bash
npm install --ignore-scripts
```

准备 Vyper 0.4.3 的隔离环境，并记录 `vyper-json` 文件 SHA-256：

```bash
python3.13 -m venv /tmp/sunhat-vyper-0.4.3-py313
/tmp/sunhat-vyper-0.4.3-py313/bin/pip install vyper==0.4.3
shasum -a 256 /tmp/sunhat-vyper-0.4.3-py313/bin/vyper-json
```

执行 EVM、连接隔离与 Vyper 验证：

```bash
VYPER_JSON_PATH=/tmp/sunhat-vyper-0.4.3-py313/bin/vyper-json \
VYPER_JSON_SHA256=<sha256> \
npm run verify
```

从 TRON 官方 `tv_0.8.25` Release 下载 `soljson.js`，核对 Release API 提供的 SHA-256 后执行：

```bash
TRON_SOLC_PATH=/tmp/sunhat-tron-solc-0.8.25/soljson.js \
TRON_SOLC_SHA256=70a068c5b090ef1b1b2410f92713eabc459501edfebb127034a46f9448d9d244 \
npm run verify:tron-solc
```

Vyper 和 tron-solc 路径必须是绝对路径。任一哈希、版本或编译错误不匹配时，验证立即以非零状态退出。

## 结论边界

- `network.create()` 与 `newConnection` hook 可实现每条连接独立 Manager；夹具直接验证对象和可变状态互不共享。
- Hardhat 3 artifact 使用 `hh3-artifact-1`；build-info 输入和输出分别保存为 `<id>.json` 与 `<id>.output.json`。
- `solidity.profiles.<name>.path` 可直接加载官方 tron-solc WASM，TRON fork 的 commit 会进入 build-info。
- Vyper 必须走独立 `vyper-json` 管线；夹具生成 `sunhat-vyper-artifact-1`，保存编译输入、原始输出、可执行文件哈希和 Python 依赖锁。
- Vyper 0.4.3 需要较新的 Python；本机默认 Python 3.9 只能解析到旧版 Vyper，不能作为编译环境。
- 当前机器 Docker daemon 未运行，本夹具没有验证 TVM 部署、Energy/Bandwidth 或 TRON 失败语义。上述能力在 TVM 集成测试通过前不得标记为支持。
