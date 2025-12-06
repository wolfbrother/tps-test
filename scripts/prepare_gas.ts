import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// ================= 配置区域 =================
const MIN_SUI_THRESHOLD = Number(process.env.MIN_SUI_THRESHOLD || 0.04); 
const TARGET_COUNT = Number(process.env.TARGET_COUNT || 5);
const MIST_PER_SUI = 1_000_000_000;
const SPLIT_AMOUNT_SUI = 0.07
// ===========================================

/**
 * 主入口：获取符合条件的 Gas 对象 ID 列表
 */
export async function getGasCoinIds(): Promise<string[]> {
    // 1. 初始化基础信息
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) throw new Error('未找到 SUI_PRIVATE_KEY');
    
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.toSuiAddress();

    // =========================================================
    // 【新增步骤】在开始任何检查前，先清理多余的小对象
    await mergeExcessCoins(client, keypair, address);
    // =========================================================

    // 2. 获取当前满足条件的 Coin (金额筛选)
    const validCoins = await getValidCoins(client, address);
    
    // 3. 判断是否满足数量要求
    if (validCoins.length >= TARGET_COUNT) {
        console.log(`✅ Gas 准备就绪，可用对象: ${validCoins.length} 个`);
        return validCoins.map(coin => coin.coinObjectId);
    }

    // 4. 如果数量不足，执行拆分逻辑
    const needed = TARGET_COUNT - validCoins.length;
    console.log(`⚠️ Gas 对象数量不足 (当前 ${validCoins.length}, 需要 ${TARGET_COUNT})，正在拆分补充 ${needed} 个...`);

    // 4.1 找到余额最大的对象
    const sortedCoins = validCoins.sort((a, b) => Number(b.balance) - Number(a.balance));
    const primaryCoin = sortedCoins[0];

    if (!primaryCoin) {
        throw new Error("❌ 没有任何余额大于 0.05 SUI 的对象，无法拆分，请先去 Discord 领水！");
    }

    console.log(`🔨 使用主对象拆分: ${primaryCoin.coinObjectId} (余额: ${(Number(primaryCoin.balance)/MIST_PER_SUI).toFixed(2)} SUI)`);

    // 4.2 构建拆分交易
    const tx = new Transaction();
    tx.setGasPayment([{
        objectId: primaryCoin.coinObjectId,
        version: primaryCoin.version,
        digest: primaryCoin.digest
    }]);

    const splitAmountMist = BigInt(SPLIT_AMOUNT_SUI * MIST_PER_SUI);
    
    for (let i = 0; i < needed; i++) {
        const [newCoin] = tx.splitCoins(tx.gas, [splitAmountMist]);
        tx.transferObjects([newCoin], address);
    }

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true }
        });
        console.log(`🚀 拆分交易发送成功: ${result.digest}`);
    } catch (e) {
        console.error("拆分交易失败:", e);
        throw e;
    }

    console.log(`⏳ 等待 5 秒以确保链上状态同步...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 递归调用
    return getGasCoinIds();
}

/**
 * 【新增函数】合并多余的小对象
 * 逻辑：如果 N >= TARGET_COUNT + 2，则合并最小的 (N - TARGET_COUNT) 个对象到最大的对象中
 */
async function mergeExcessCoins(client: SuiClient, keypair: Ed25519Keypair, address: string) {
    // 获取账户下所有的 SUI Coin (不限金额)
    const allCoins = await getAllCoins(client, address);
    const N = allCoins.length;
    const limit = TARGET_COUNT + 2;

    // 只有当对象数量确实过多时才触发合并
    if (N < limit) {
        return; 
    }

    console.log(`🧹 检测到对象数量过多 (${N} 个)，开始合并清理...`);

    // 1. 排序：从小到大
    // (a - b) 结果为负数时 a 排在前面 (升序)
    const sortedCoins = allCoins.sort((a, b) => Number(a.balance) - Number(b.balance));

    // 2. 确定目标和来源
    // 最大的对象在数组最后
    const destinationCoin = sortedCoins[N - 1]; 
    
    // 需要合并掉的数量 = 当前总数 - 目标保留数
    // 比如当前 10 个，目标 5 个，我们要合并掉 5 个，最后剩下 5 个
    const countToMerge = N - TARGET_COUNT;
    
    // 取出最小的 countToMerge 个对象
    // slice(0, 5) 取前5个(最小的)
    const sourceCoins = sortedCoins.slice(0, countToMerge);
    
    // 防御性检查：确保我们要合并的源里不包含目标对象
    if (sourceCoins.find(c => c.coinObjectId === destinationCoin.coinObjectId)) {
        console.warn("合并逻辑异常：源对象包含目标对象，跳过本次合并");
        return;
    }

    console.log(`🔄 正在将 ${sourceCoins.length} 个小对象合并到 -> ${destinationCoin.coinObjectId} (大额对象)`);

    // 3. 构建合并交易
    const tx = new Transaction();
    
    // 使用最大的对象作为 Gas 支付方（它也是合并的目标，这很合理）
    tx.setGasPayment([{
        objectId: destinationCoin.coinObjectId,
        version: destinationCoin.version,
        digest: destinationCoin.digest
    }]);

    // 批量添加输入
    // mergeCoins 第一个参数是目标，第二个参数是源对象数组
    // 注意：PTB 有最大输入限制，这里做个简单截断防止报错 (一次最多合 500 个)
    const batchSources = sourceCoins.slice(0, 500).map(c => c.coinObjectId);
    
    if (batchSources.length > 0) {
        tx.mergeCoins(tx.gas, batchSources);

        // 4. 执行交易
        try {
            const result = await client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
                options: { showEffects: true }
            });
            console.log(`✅ 合并完成，Digest: ${result.digest}`);
            console.log(`⏳ 等待 3 秒同步状态...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
            console.error("❌ 合并交易失败:", e);
            // 合并失败不抛错，继续执行主流程，下次再试
        }
    }
}

/**
 * 辅助：获取账户下所有 SUI 对象（无金额门槛）
 */
async function getAllCoins(client: SuiClient, address: string) {
    let hasNext = true;
    let cursor = null;
    const allCoins = [];

    while (hasNext) {
        const res: any = await client.getCoins({
            owner: address,
            coinType: '0x2::sui::SUI',
            cursor: cursor
        });
        allCoins.push(...res.data);
        hasNext = res.hasNextPage;
        cursor = res.nextCursor;
    }
    return allCoins;
}

/**
 * 辅助：获取余额达标的对象
 */
async function getValidCoins(client: SuiClient, address: string) {
    const allCoins = await getAllCoins(client, address);
    const thresholdMist = MIN_SUI_THRESHOLD * MIST_PER_SUI;
    return allCoins.filter(coin => Number(coin.balance) >= thresholdMist);
}