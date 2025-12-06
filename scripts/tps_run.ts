import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { getRandomNCounters } from './counter.ts';
import { getGasCoinIds} from './prepare_gas.ts';

// 加载 .env 里的私钥
dotenv.config();

// ================= 配置区域 =================
// 1. 你的 Package ID (Object 3)
const PACKAGE_ID = '0x7395d305e3530c68adaf0d1b5e932e267048e7daf3f701a0eb2e24125039ee09';

// 3. 模块名和函数名
const MODULE_NAME = 'tps_test';
const FUNCTION_NAME = 'operate';

// 4. 单次TX内循环次数 (TPS 核心)
const OPERATIONS_PER_TX = 1023;
// ===========================================

async function main() {

    

    // 1. 初始化 Client (连接测试网)
    // 注意：我们将 Client 初始化提前，因为查询 Gas 对象详情需要用到它
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // 2. 获取 Gas 列表
    const gasObjectIds = await getGasCoinIds();
    console.log(`当前可用 Gas 对象总数: ${gasObjectIds.length}`);

    if (gasObjectIds.length === 0) {
        throw new Error("没有可用的 Gas 对象，请检查 prepare_gas.ts");
    }

    // =========================================================
    // 【核心修改】随机选择一个 Gas 对象并获取其详细信息
    // =========================================================
    
    // 2.1 随机生成索引
    const randomIndex = Math.floor(Math.random() * gasObjectIds.length);
    const selectedGasId = gasObjectIds[randomIndex];
    
    console.log(`🎲 随机选中的 Gas ID: ${selectedGasId}`);

    // 2.2 获取该对象的 Version 和 Digest (setGasPayment 需要这三样信息)
    const coinInfo = await client.getObject({
        id: selectedGasId!
    });

    if (!coinInfo.data) {
        throw new Error(`无法获取对象 ${selectedGasId} 的链上数据`);
    }

    // 2.3 准备好 Gas 对象结构
    const gasPaymentObject = {
        objectId: coinInfo.data.objectId,
        version: coinInfo.data.version,
        digest: coinInfo.data.digest
    };

    

    // 2. 加载私钥
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('请在 .env 文件中配置 SUI_PRIVATE_KEY');
    }
    
    // 解析私钥并创建 Keypair
    const { schema, secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    
    console.log(`正在使用地址: ${keypair.getPublicKey().toSuiAddress()}`);


    const counterIds = getRandomNCounters(keypair.getPublicKey().toSuiAddress(), gasObjectIds.length);
    const counterId = counterIds[randomIndex]!


    console.log(`目标计数器对象: ${counterId}`);

    // 3. 构建 PTB (Programmable Transaction Block)
    const tx = new Transaction();
    tx.setGasPayment([gasPaymentObject]);

    // 核心逻辑：在一个 Block 里塞入 1000 个 MoveCall
    console.log(`正在构建包含 ${OPERATIONS_PER_TX} 次操作的TX...`);
    
    for (let i = 0; i < OPERATIONS_PER_TX; i++) {
        tx.moveCall({
            target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
            arguments: [
                tx.object(counterId) // 传入 Counter 对象
            ],
        });
    }

    // 设置较高的 Gas 预算，因为计算量大
    tx.setGasBudget(5_000_000); // 0.005 SUI，通常够了

    // 4. 签名并执行
    const startTime = Date.now();
    console.log("正在发送TX...");

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
        console.log(`TX 哈希: ${result.digest}`);
        console.log(`耗时: ${endTime - startTime} ms`);
        console.log(`状态: ${result.effects?.status.status}`);
        
        // 打印浏览器链接
        console.log(`\n在浏览器查看: https://suiscan.xyz/testnet/tx/${result.digest}`);

    } catch (e) {
        console.error("\n TX失败:", e);
    }
}

main();