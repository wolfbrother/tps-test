import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { getRandomNCounters } from './counter.ts';
import { getGasCoinIds } from './prepare_gas.ts';
import { getActiveConfig } from './config.ts';


interface CachedObject {
    objectId: string;
    version: string;
    digest: string;
}

// 加载环境变量
dotenv.config();
const cfg = getActiveConfig();

// ================= 配置区域 =================
const PACKAGE_ID = cfg.packageId;
const MODULE_NAME = cfg.module;
const FUNCTION_NAME = cfg.opOperate;
const OPERATIONS_PER_TX = 1023;
const startTimeStr = cfg.startTime;

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const NETWORK = (cfg.network || 'testnet') as SuiNetwork
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// ===========================================

    // 1. 初始化 Client 和 账户
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

const privateKey = process.env.SUI_PRIVATE_KEY;
if (!privateKey) throw new Error('请在 .env 文件中配置 SUI_PRIVATE_KEY');
    
const { secretKey } = decodeSuiPrivateKey(privateKey);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const address = keypair.getPublicKey().toSuiAddress();
const beforeBalance = await client.getBalance({ owner: address });
console.log(`👤 当前地址: ${address}， 网络: ${NETWORK}，当前余额: ${Number(beforeBalance.totalBalance)/1_000_000_000}SUI`);

console.log(`================ 执行测试 ================`);
// 2. 获取资源列表
const gasObjectIds = await getGasCoinIds();
const count = gasObjectIds.length;

if (count === 0) throw new Error("没有可用的 Gas 对象，请检查 prepare_gas.ts");

// 3. 获取对应数量的随机 Counter
// 假设 gas 数量肯定小于 counter 池子总数
const counterIds = getRandomNCounters(address, count);
console.log(`✅准备就绪，可用余额对象: ${count} 个, 随机分配计数器对象： ${count} 个, 以此建立并行通道: ${count} 个`);

async function runTest() {
    // 4. 并行执行交易
    console.log(`🔥 每个通道迭代 ${cfg.iters} 次，每次发出一笔PTB交易， 每笔包含 ${OPERATIONS_PER_TX} 次操作...`);
    const startTime = Date.now();

    // 使用 map 将每组 (Gas, Counter) 映射为一个异步任务
    const tasks = gasObjectIds.map((gasId, index) => {
        const counterId = counterIds[index]!;
        // 调用封装好的单任务函数
        return runSingleTask(client, keypair, gasId, counterId, index + 1, cfg.iters, cfg.iterInterval);
    });

    // Promise.all 同时等待所有任务完成
    const results = await Promise.allSettled(tasks);

    // 5. 统计结果
    const endTime = Date.now();
    const successful = results.filter(r => r.status === 'fulfilled').length;
    //const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`\n================ 测试报告 ================`);
    console.log(`总耗时: ${endTime - startTime} ms | 并发通道数: ${count} | 成功通道数: ${successful} | 迭代次数: ${cfg.iters}`);
    console.log(`成功的总操作数 (TPS基数): ${successful * OPERATIONS_PER_TX * cfg.iters}，平均TPS: ${(successful * OPERATIONS_PER_TX * cfg.iters*1000 / (endTime - startTime)).toFixed(2)}`);
    const afterBalance = await client.getBalance({ owner: address });
    const changeBalance = Number(BigInt(beforeBalance.totalBalance) - BigInt(afterBalance.totalBalance))/1_000_000_000;
    console.log(`当前余额: ${Number(afterBalance.totalBalance)/1_000_000_000}SUI， 余额减少: ${changeBalance}SUI，平均每次迭代消耗 ${(changeBalance/cfg.iters).toFixed(2)}SUI`);
    console.log(`==========================================`);
}

/**
 * 单个“线程”任务：处理一笔独立的 PTB 交易
 */
async function runSingleTask(
    client: SuiClient,
    keypair: Ed25519Keypair,
    gasId: string,
    counterId: string, // 对于 Shared Object，这个 ID 是常量，不需要更新
    taskIndex: number,
    iter: number,
    iterInterval: number
) {
    // 1. 初始化：仅获取 Gas 对象的初始状态
    // (Counter 是 Shared Object，不需要查它的 version/digest，直接用 ID 即可)
    const gasInfo = await client.getObject({ id: gasId });
    
    if (!gasInfo.data) {
        throw new Error(`[线程 ${taskIndex}] Gas对象 ${gasId} 不可用`);
    }

    // 建立本地 Gas 缓存
    let currentGas: CachedObject = {
        objectId: gasInfo.data.objectId,
        version: gasInfo.data.version,
        digest: gasInfo.data.digest
    };

    const digests: string[] = [];

    // 2. 循环迭代：本地闭环
    for (let i = 0; i < iter; i++) {
        try {
            const tx = new Transaction();

            // A. 强制使用本地缓存的 Gas (核心优化)
            tx.setGasPayment([currentGas]);

            // B. 构建 MoveCall
            for (let k = 0; k < OPERATIONS_PER_TX; k++) {
                tx.moveCall({
                    target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
                    arguments: [ tx.object(counterId) ], // 直接传 ID 字符串，SDK 会自动处理 Shared Object
                });
            }

            tx.setGasBudget(5_000_000);

            // C. 发送交易 (开启 showObjectChanges 以获取新 Gas 版本)
            const result = await client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
                options: { showEffects: true, showObjectChanges: true },
            });

            if (result.effects?.status.status !== 'success') {
                throw new Error(`链上执行失败: ${result.effects?.status.error}`);
            }

            digests.push(result.digest);

            // D. 极简缓存更新：只找 Gas 对象
            if (result.objectChanges) {
                // 在变更列表中找到 Gas 对象
                const gasChange = result.objectChanges.find(
                    c => c.type === 'mutated' && 'objectId' in c && c.objectId === currentGas.objectId
                );

                if (gasChange && gasChange.type === 'mutated' && 'version' in gasChange && 'digest' in gasChange) {
                    // 更新缓存，闭环完成
                    currentGas = {
                        objectId: gasChange.objectId,
                        version: gasChange.version,
                        digest: gasChange.digest
                    };
                } else {
                    // 兜底：如果没找到 Gas 变更，说明出现严重问题
                    throw new Error(`[线程 ${taskIndex}] 严重错误: 无法捕获 Gas 对象的新版本`);
                }
            }

            // E. 间隔等待
            if (i < iter - 1 && iterInterval > 0) {
                await sleep(iterInterval);
            }

        } catch (e: any) {
            console.error(`❌ [线程 ${taskIndex}] 迭代 ${i+1} 失败: ${e.message || e}`);
            throw e;
        }
    }

    return digests[digests.length - 1];
}

/**
 * 将时间字符串解析为 Date 对象，格式: "YYYY-MM-DD HH:mm:ss"
 * 如果格式不正确或时间已过期，立即返回
 * 否则等待到指定时间
 */
async function waitUntilStartTime(timeStr: string): Promise<void> {
    // 时间格式: "2023-12-09 14:30:05"
    const timeRegex = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/;

    if (!timeRegex.test(timeStr)) {
        console.log(`⚠️  起始时间格式不合法: "${timeStr}"，将立即开始`);
        return;
    }

    try {
        // 解析时间字符串为 Date 对象
        const targetTime = new Date(timeStr.replace(' ', 'T')); // 转换为 ISO 格式

        // 验证时间是否有效
        if (isNaN(targetTime.getTime())) {
            console.log(`⚠️  起始时间无效: "${timeStr}"，将立即开始`);
            return;
        }

        const now = new Date();
        const diff = targetTime.getTime() - now.getTime();

        if (diff <= 0) {
            console.log(`⚠️  起始时间已过期或为当前时间，将立即开始`);
            return;
        }

        console.log(`⏰ 等待至 ${timeStr}（还需等待 ${(diff / 1000).toFixed(0)} 秒）...`);
        await sleep(diff);
        console.log(`✅ 时间已到，开始执行测试`);

    } catch (e) {
        console.log(`⚠️  解析起始时间失败: ${e}，将立即开始`);
    }
}

async function main() {
    await waitUntilStartTime(startTimeStr);
    await runTest();
}

main().catch(console.error);