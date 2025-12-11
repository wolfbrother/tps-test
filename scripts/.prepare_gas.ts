import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { getActiveConfig } from './.config';

// 加载环境变量
dotenv.config();
const cfg = getActiveConfig();

// ================= 配置区域 =================
const MIN_SUI_THRESHOLD = Number(cfg.fee.minSuiThreshold || 0.04); 
const TARGET_COUNT = Number(cfg.targetCount || 5);
const MIST_PER_SUI = 1_000_000_000;
const SPLIT_AMOUNT_SUI = Number(cfg.fee.splitAmountSui || 0.07);

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const NETWORK = (cfg.network || 'testnet') as SuiNetwork
// ===========================================

/**
 * 主入口：获取符合条件的 Gas 对象 ID 列表
 */
export async function getGasCoinIds(): Promise<string[]> {
    // 1. 初始化
    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) throw new Error('未找到 SUI_PRIVATE_KEY');
    
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.toSuiAddress();

    // 2. 检查当前状态
    // 获取金额达标的 Coins
    const validCoins = await getValidCoins(client, address);
    
    // 如果数量达标，截取指定数量返回
    if (validCoins.length >= TARGET_COUNT) {
        console.log(`✅ 当前可用 Gas 对象充足: ${validCoins.length} 个 (将返回其中余额最大的 ${TARGET_COUNT} 个)`);
        
        return validCoins
            // 按余额降序排序，优先使用余额大的
            .sort((a, b) => Number(b.balance) - Number(a.balance))
            // 只取前 TARGET_COUNT 个
            .slice(0, TARGET_COUNT)
            // 提取 ID
            .map(coin => coin.coinObjectId);
    }

    console.log(`⚠️ Gas 对象不足 (当前有效: ${validCoins.length}, 目标: ${TARGET_COUNT})，开始执行 [合并 -> 拆分] 流程...`);

    // 3. 执行合并并拆分逻辑
    await mergeAndSplit(client, keypair, address);

    // 4. 递归调用（等待几秒后重新检查状态）
    console.log(`⏳ 等待 3 秒以确保链上状态同步...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return getGasCoinIds();
}

/**
 * 核心逻辑：先合并所有 Coin 到最大的一块，然后从中拆分出指定数量的小块
 */
async function mergeAndSplit(client: SuiClient, keypair: Ed25519Keypair, address: string) {
    // 1. 获取账户下所有的 Coin (不限金额)
    const allCoins = await getAllCoins(client, address);

    if (allCoins.length === 0) {
        throw new Error("❌ 账户下没有任何 SUI 对象，请先充值或领水！");
    }

    // 2. 排序：余额从大到小
    const sortedCoins = allCoins.sort((a, b) => Number(b.balance) - Number(a.balance));
    
    // 主 Coin (余额最大的)，作为 Gas 支付对象，也是合并的目标容器
    const primaryCoin = sortedCoins[0];
    const totalBalance = sortedCoins.reduce((sum, coin) => sum + Number(coin.balance), 0);
    
    // 计算需要的总金额 (目标个数 * 单个拆分金额)
    const requiredAmountMist = BigInt(TARGET_COUNT) * BigInt(Math.floor(SPLIT_AMOUNT_SUI * MIST_PER_SUI));
    
    // 检查总余额是否足够 (预留 0.05 SUI 作为 Gas 缓冲)
    const gasBuffer = BigInt(0.05 * MIST_PER_SUI);
    if (BigInt(totalBalance) < (requiredAmountMist + gasBuffer)) {
        const currentSui = (totalBalance / MIST_PER_SUI).toFixed(4);
        const requiredSui = ((Number(requiredAmountMist) + Number(gasBuffer)) / MIST_PER_SUI).toFixed(4);
        throw new Error(`❌ 账户总余额不足！当前: ${currentSui} SUI, 需要至少: ${requiredSui} SUI (含Gas)`);
    }

    console.log(`🔨 正在重组 Gas 对象...`);
    console.log(`   - 主对象: ${primaryCoin.coinObjectId} (余额: ${(Number(primaryCoin.balance)/MIST_PER_SUI).toFixed(2)} SUI)`);
    console.log(`   - 待合并小对象数: ${sortedCoins.length - 1}`);
    console.log(`   - 目标拆分数量: ${TARGET_COUNT} 个 (每份 ${SPLIT_AMOUNT_SUI} SUI)`);

    // 3. 构建交易 (合并 + 拆分 在同一个 PTB 中完成)
    const tx = new Transaction();
    
    // 设置 Gas 支付对象
    tx.setGasPayment([{
        objectId: primaryCoin.coinObjectId,
        version: primaryCoin.version,
        digest: primaryCoin.digest
    }]);

    // Step A: 合并 (Merge)
    // 将除了主对象以外的所有对象合并进来
    // 注意：PTB 输入对象数量有限制（通常建议不超过 500），这里做个简单的切片防止溢出
    const coinsToMerge = sortedCoins.slice(1, 500).map(c => c.coinObjectId);
    
    if (coinsToMerge.length > 0) {
        tx.mergeCoins(tx.gas, coinsToMerge);
    }

    const splitAmountMist = BigInt(Math.floor(SPLIT_AMOUNT_SUI * MIST_PER_SUI));
    
    console.log(`   - 开始执行拆分与分发 (共 ${TARGET_COUNT} 次)...`);

    for (let i = 0; i < TARGET_COUNT; i++) {
        // 1. 从 Gas 对象拆分出 1 个指定金额的新 Coin
        // 注意：splitCoins 返回的是一个 Result (代表 vector<Coin>)
        const coin = tx.splitCoins(tx.gas, [splitAmountMist]);

        // 2. 将这个新 Coin 转移给当前地址
        // SDK 会正确处理这里 Result 的传递
        tx.transferObjects([coin], address);
    }

    // 4. 执行交易
    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: { showEffects: true }
        });
        console.log(`🚀 重组交易成功! Digest: ${result.digest}`);
    } catch (e) {
        console.error("❌ 重组交易失败:", e);
        throw e;
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