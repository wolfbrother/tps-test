# Sui TPS 性能测试工具 (Sui TPS Benchmark)

这是一个基于 Sui Move 智能合约和 TypeScript 脚本的高性能压力测试项目。该工具利用 Sui 区块链的 **并行执行模型** 和 **可编程交易块 (PTB)** 技术，旨在测试网络在极端负载下的 TPS (Transactions Per Second) 和 CPS (Commands Per Second)。

## 📊 实测性能数据

本工具在 Sui Mainnet 上进行了实测，表现出了极高的吞吐能力：

### 1. 单机压测峰值
在单台机器上运行本工具，峰值达到了 **29,709 CPS**。
![单机压测结果](./images/single-peak-cps.jpg)

### 2. 多实例并发压测峰值
同时启动三个测试实例进行压测，Sui 网络承受住了 **103,435 CPS** 的惊人吞吐量。
![多机压测结果](./images/multiple-peak-cps.png)

> **注**: 上述数据来自 SuiScan 区块浏览器截图。

---

## 📁 项目结构与模块说明

项目包含两个核心 Move 合约包和一套 TypeScript 客户端脚本。

### 1. 智能合约 (Move)
*   **`tps_test/` (核心压测合约)**
    *   **Counter 对象**: 简单的共享对象，用于承载高频写入操作。
    *   **create_counter**: 批量创建计数器，建立并行的状态锚点。
    *   **operate**: 计数器自增操作（压测负载函数）。
    *   **GlobalState**: 维护计数器索引的全局状态表。
    *   *状态*: 已在 Mainnet 验证通过 (Verified Source Code: https://suiscan.xyz/mainnet/object/0x392d03b7bfe5cdd17a73bfada66eccd59d207d7bf128665a6d6052a80126c98f )。
      ![合约验证](./images/SuiMainnetCodes.jpg)

*   **`minimal_test/` (部署压测合约)**
    *   **minimal_module**: 一个极简的空模块。
    *   **用途**: 专门用于测试网络对 **Publish (合约发布)** 交易的处理吞吐量，通过反复部署该合约来给网络施加“部署压力”。

### 2. 客户端脚本 (`scripts/`)
*   **核心压测流程**:
    *   `deploy_tps_test.ts`: 部署 `tps_test` 合约。
    *   `create_new_counters.ts`: 调用合约批量创建链上 `Counter` 对象。
    *   `tps_run.ts`: **核心脚本**。自动拆分 Gas，建立并行通道，利用 PTB 打包（1笔交易包含1023次操作）发送海量交易。
    *   `fetch_onchain_counters.ts`: 辅助脚本，从链上拉取已创建的 Counter ID。

*   **部署压测流程**:
    *   `deploy_minimal_test.ts`: 循环编译并部署 `minimal_test` 合约，测试网络的包发布性能。

*   **配置与基础设施**:
    *   `.prepare_gas.ts`: 智能 Gas 管理。将大额 SUI 拆分为多个小的 Gas Coin，实现多线程并行发送，互不阻塞。
    *   `config.json` / `.config.ts`: 项目配置文件。

---

## 🚀 快速开始

### 1. 环境准备

安装npm和npx的版本11.6.1，node的版本v24.10.0。

安装依赖：
```bash
cd scripts
npm init -y
npm install @mysten/sui dotenv bip39 typescript ts-node @types/node @types/bip39
```

### 2. 配置私钥

在 `scripts/` 目录下创建 `.env` 文件：
```env
SUI_PRIVATE_KEY=suiprivkey1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
> ⚠️ 建议准备至少 5 SUI 用于 Gas 拆分和高频交易费用。

---

## 🧪 场景一：TPS/CPS 交易性能压测

这是本项目的主要用途，测试网络处理并发交易的能力。

### 1. 部署合约 (可选)
如果使用现有的合约（见 `config.json`），可跳过此步。如需部署新合约：
```bash
npx tsx deploy_tps_test.ts
```
记录输出的 `Package ID`, `GlobalState ID`, `UpgradeCap ID` 并填入 `scripts/config.json`。

### 2. 创建计数器对象（可选）
为了支持并发，需要创建多个共享对象供不同的“线程”写入。
```bash
npx tsx create_new_counters.ts
```
*   脚本会根据 `config.json` 中的 `globalStateId` 批量创建 Counter。
*   创建成功后，控制台会打印 Counter ID 列表。

### 3. 获取/验证计数器（可选）
如果忘记了 Counter ID，或者想同步链上现有的计数器：
```bash
npx tsx fetch_onchain_counters.ts
```
将获取到的 ID 列表更新到 `config.json` 的 `counters` 字段中。

### 4. 运行压测 (Run)
```bash
npx tsx tps_run.ts
```
**执行逻辑**:
1.  **Gas 准备**: 自动检查并拆分 Gas Coin (Split Coins)，确保每个并发通道有独立的 Gas 对象。
2.  **通道建立**: 将 Gas 对象与 Counter 对象一一映射。
3.  **本地计算**: 缓存 Gas 对象的 Version/Digest，在本地构建交易，极大降低 RPC 交互延迟。
4.  **并行发送**: 所有通道同时发送包含 1023 个命令的 PTB 交易。

---

## 📦 场景二：合约部署吞吐量测试

测试网络在短时间内接收大量 `Publish` 交易的稳定性。

### 运行部署压测
```bash
npx tsx deploy_minimal_test.ts
```
*   该脚本会读取 `minimal_test` 目录下的合约。
*   默认循环执行 1000 次部署操作（可在代码中修改 `REPEAT_COUNT`）。
*   实时统计部署成功率和耗时。

---

## ⚙️ 详细配置说明 (`config.json`)

配置文件 `scripts/config.json` 控制着整个压测工具的行为。以下是各参数的详细含义及底层代码逻辑说明：

### 1. 基础控制参数

| 参数名 | 类型 | 默认值示例 | 详细说明 |
| :--- | :--- | :--- | :--- |
| `network` | string | `"testnet"` | **运行网络环境**。<br>可选值：`"mainnet"` 或 `"testnet"`。<br>脚本会根据此字段自动读取下方 `object`、`fee`、`counters` 中对应的子配置。 |
| `targetCount` | number | `50` | **并发通道数 (核心参数)**。<br>1. **Gas 准备阶段** (`prepare_gas.ts`)：脚本会确保你的账户下至少有这么多个独立的 Gas Coin。<br>2. **压测运行阶段** (`tps_run.ts`)：决定启动多少个并行 Promise 任务同时发送交易。<br>⚠️ *建议值：单机 50-100。过高可能导致 Node.js 内存溢出或本地 CPU 瓶颈。* |
| `iters` | number | `5` | **单通道循环次数**。<br>每个并发通道内部循环发送交易的次数。总交易数 = `targetCount` × `iters`。<br>总操作数(CPS基数) ≈ 总交易数 × 1023。 |
| `iterInterval` | number | `2` | **发送间隔 (毫秒)**。<br>在 `tps_run.ts` 的循环中，每笔交易发送后的休眠时间。<br>设置为 `0` 表示全速运行（Fire-and-Forget 模式），最大化压力。 |
| `startTime` | string | `"2025-..."` | **定时启动时间** (格式: `YYYY-MM-DD HH:mm:ss`)。<br>`tps_run.ts` 启动时会检查此时间：<br>- 如果时间未到，脚本会倒计时等待。<br>- **用途**：用于多台机器分布式压测时，协调所有机器在同一秒瞬间启动，制造峰值脉冲。 |

### 2. 资源索引与 RPC

| 参数名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `startCounterIndex` | number | **计数器列表起始偏移量**。<br>**用途**：当多台机器共用同一个 `config.json` 时，防止它们操作同一个 Counter 对象导致冲突。<br>- 机器 A 设置 `0` (使用数组索引 0~49)<br>- 机器 B 设置 `50` (使用数组索引 50~99) |
| `rpcs` | object | **RPC 节点池**。<br>包含 `mainnet` 和 `testnet` 的节点 URL 数组。建议填入多个付费/私有节点以防公共节点限流。 |
| `rpcIndex` | number | **当前使用的 RPC 索引**。<br>指定脚本连接 `rpcs` 数组中的第几个节点。方便在节点挂掉时快速切换。 |

### 3. 对象与合约配置 (`object`)

此部分定义了 Move 合约在链上的具体地址，分为 `mainnet` 和 `testnet` 两套配置。

*   **`module`**: Move 合约的模块名 (如 `tps_test`)。
*   **`opCreateCounter`**: 创建计数器的函数名。
*   **`opOperate`**: 压测核心函数名 (执行自增操作)。
*   **`package`**: 合约部署后的 Package ID。
*   **`globalState`**: 全局状态共享对象的 ID (用于创建新 Counter)。
*   **`upgradeCap`**: 合约升级权限对象 ID (仅部署者关心)。

### 4. Gas 策略配置 (`fee`)

此配置直接影响 `prepare_gas.ts` 的行为，用于自动管理 Gas Coin 的拆分与合并。

```json
"fee": {
  "mainnet": {
    "minSuiThreshold": 0.03, 
    "splitAmountSui": 0.04
  }
}
```

*   **`minSuiThreshold` (SUI)**: **最小可用阈值**。
    *   脚本会检查当前账户下的 Coin，只有余额 > 这个值的 Coin 才会用于充当 Gas 对象。
    *   *逻辑*：如果一个 Gas Coin 余额太少，压测过程中容易耗尽导致交易失败，因此需过滤掉过小的碎片。
*   **`splitAmountSui` (SUI)**: **拆分目标金额**。
    *   当可用 Gas 对象不足 `targetCount` 时，脚本会将大额 SUI 拆分为多个小 Coin，每个 Coin 的金额设为多少。
    *   *建议*：应略大于 `minSuiThreshold`。

### 5. 目标对象列表 (`counters`)

```json
"counters": {
  "mainnet": [ "0x...", "0x..." ],
  "testnet": [ "0x...", "0x..." ]
}
```
*   **数据来源**：由 `create_new_counters.ts` 生成或 `fetch_onchain_counters.ts` 拉取。
*   **作用**：压测时，`tps_run.ts` 会从这里按顺序读取 Object ID，与 Gas Coin 一一配对，确保每个并发线程操作独立的 Counter 对象，避免产生**写冲突 (Write Contention)**，这是实现高 TPS 的关键。

---

### 📝 配置示例与调优建议

**场景 A：单机极限性能测试**
```json
{
  "targetCount": 100,      // 开启 100 个并发通道
  "iterInterval": 0,       // 无等待，全力发送
  "startCounterIndex": 0,  
  "rpcIndex": 1            // 建议使用付费的私有 RPC 节点
}
```

**场景 B：三台机器分布式压测**
*   **机器 1**: `targetCount: 50`, `startCounterIndex: 0`
*   **机器 2**: `targetCount: 50`, `startCounterIndex: 50`
*   **机器 3**: `targetCount: 50`, `startCounterIndex: 100`
*   **所有机器**: 设置相同的 `startTime` (例如 2分钟后的时间)，运行脚本后它们会进入倒计时，然后同时开火。

---

## 🌟 核心设计原理

1.  **PTB 聚合 (Aggregation)**: 利用 Sui 的 PTB 特性，一笔交易携带 ~1023 次状态变更。这是实现 100k+ CPS 的关键。
2.  **资源隔离 (Isolation)**: `prepare_gas.ts` 确保了 N 个并发任务拥有 N 个独立的 Gas Coin，且分别操作 N 个不同的 Counter 对象，完全消除了链上资源争用 (Contention)。
3.  **客户端预测 (Client-side Prediction)**: `tps_run.ts` 实现了本地 Gas 版本推演。在连续提交交易时，不需要等待 RPC 返回最新的 Object Version，而是直接在本地更新状态并发起下一笔交易，将客户端延迟降至最低。