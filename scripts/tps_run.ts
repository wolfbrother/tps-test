import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { getRandomNCounters } from './counter.ts';
import { getGasCoinIds } from './prepare_gas.ts';
import { getActiveConfig } from './config';

// 加载环境变量
dotenv.config();
const cfg = getActiveConfig();

// ================= 配置区域 =================
const PACKAGE_ID = cfg.packageId;
const MODULE_NAME = cfg.module;
const FUNCTION_NAME = cfg.opOperate;
const OPERATIONS_PER_TX = 1023;

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
console.log(`👤 当前地址: ${address}`);

async function runTest() {
    console.log(`🚀 开始新一轮并行 TPS 测试`);
    

    // 2. 获取资源列表
    console.log("正在获取可用 Gas 对象...");
    const gasObjectIds = await getGasCoinIds();
    const count = gasObjectIds.length;
    console.log(`✅以此建立并行通道: ${count} 个`);

    if (count === 0) throw new Error("没有可用的 Gas 对象，请检查 prepare_gas.ts");

    // 3. 获取对应数量的随机 Counter
    // 假设 gas 数量肯定小于 counter 池子总数
    console.log("正在分配随机 Counter 对象...");
    const counterIds = getRandomNCounters(address, count);

    // 4. 并行执行交易
    console.log(`🔥 正在并发发送 ${count} 笔交易，每笔包含 ${OPERATIONS_PER_TX} 次操作...`);
    const startTime = Date.now();

    // 使用 map 将每组 (Gas, Counter) 映射为一个异步任务
    const tasks = gasObjectIds.map((gasId, index) => {
        const counterId = counterIds[index]!;
        // 调用封装好的单任务函数
        return runSingleTask(client, keypair, gasId, counterId, index + 1);
    });

    // Promise.all 同时等待所有任务完成
    const results = await Promise.allSettled(tasks);

    // 5. 统计结果
    const endTime = Date.now();
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`\n================ 测试报告 ================`);
    console.log(`总耗时: ${endTime - startTime} ms | 并发线程数: ${count} | 成功交易: ${successful} | 失败交易: ${failed}`);
    console.log(`理论总操作数 (TPS基数): ${successful * OPERATIONS_PER_TX}`);
    console.log(`==========================================`);
}

/**
 * 单个“线程”任务：处理一笔独立的 PTB 交易
 */
async function runSingleTask(
    client: SuiClient, 
    keypair: Ed25519Keypair, 
    gasId: string, 
    counterId: string,
    taskIndex: number
) {
    try {
        // 1. 获取 Gas 对象的详细信息 (Version & Digest)
        // 每个并行任务独立查询，互不干扰
        const coinInfo = await client.getObject({ id: gasId });
        
        if (!coinInfo.data) {
            throw new Error(`Gas对象 ${gasId} 数据不可用`);
        }

        const gasPaymentObject = {
            objectId: coinInfo.data.objectId,
            version: coinInfo.data.version,
            digest: coinInfo.data.digest
        };

        // 2. 构建 PTB
        const tx = new Transaction();
        tx.setGasPayment([gasPaymentObject]); // 强制指定 Gas

        // 循环添加 MoveCall
        for (let i = 0; i < OPERATIONS_PER_TX; i++) {
            tx.moveCall({
                target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
                arguments: [ tx.object(counterId) ],
            });
        }

        tx.setGasBudget(5_000_000); 

        // 3. 发送交易
        // console.log(`[线程 ${taskIndex}] 发送中... (Gas: ...${gasId.slice(-4)} -> Counter: ...${counterId.slice(-4)})`);
        
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true },
        });

        if (result.effects?.status.status === 'success') {
            //console.log(`✅ [线程 ${taskIndex}] 成功: ${result.digest}`);
            return result.digest;
        } else {
            throw new Error(`链上执行失败: ${result.effects?.status.error}`);
        }

    } catch (e: any) {
        console.error(`❌ [线程 ${taskIndex}] 失败: ${e.message || e}`);
        throw e; // 抛出异常以便 Promise.allSettled 统计
    }
}

async function main() {
    const iters = 5;
    for (let i = 0; i < iters; i++) {
        await runTest();
        await sleep(8000); 
    }
}

main().catch(console.error);