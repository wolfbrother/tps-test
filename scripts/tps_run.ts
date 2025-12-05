import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';

// 加载 .env 里的私钥
dotenv.config();

// ================= 配置区域 =================
// 1. 你的 Package ID (Object 3)
const PACKAGE_ID = '0x7395d305e3530c68adaf0d1b5e932e267048e7daf3f701a0eb2e24125039ee09';

// 2. 你的 Counter 对象 ID (你刚才获取的)
const COUNTER_ID = '0x38e6474e963e3ffb9fb7ebb2b54c27c75e92669491f5c7eab311b313a76ead66';

// 3. 模块名和函数名
const MODULE_NAME = 'tps_test';
const FUNCTION_NAME = 'operate';

// 4. 单次交易内循环次数 (TPS 核心)
const OPERATIONS_PER_TX = 1020;
// ===========================================

async function main() {
    // 1. 初始化 Client (连接测试网)
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // 2. 加载私钥
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('请在 .env 文件中配置 SUI_PRIVATE_KEY');
    }
    
    // 解析私钥并创建 Keypair
    const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    
    console.log(`正在使用地址: ${keypair.getPublicKey().toSuiAddress()}`);
    console.log(`目标 Counter ID: ${COUNTER_ID}`);

    // 3. 构建 PTB (Programmable Transaction Block)
    const tx = new Transaction();

    // 核心逻辑：在一个 Block 里塞入 1000 个 MoveCall
    console.log(`正在构建包含 ${OPERATIONS_PER_TX} 次操作的交易...`);
    
    for (let i = 0; i < OPERATIONS_PER_TX; i++) {
        tx.moveCall({
            target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
            arguments: [
                tx.object(COUNTER_ID) // 传入 Counter 对象
            ],
        });
    }

    // 设置较高的 Gas 预算，因为计算量大
    tx.setGasBudget(50_000_000); // 0.05 SUI，通常够了

    // 4. 签名并执行
    const startTime = Date.now();
    console.log("正在发送交易...");

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showObjectChanges: true,
            },
        });

        const endTime = Date.now();
        console.log(`\n✅ 交易成功!`);
        console.log(`交易 Digest: ${result.digest}`);
        console.log(`耗时: ${endTime - startTime} ms`);
        console.log(`状态: ${result.effects?.status.status}`);
        
        // 打印浏览器链接
        console.log(`\n在浏览器查看: https://suiscan.xyz/testnet/tx/${result.digest}`);

    } catch (e) {
        console.error("\n❌ 交易失败:", e);
    }
}

main();