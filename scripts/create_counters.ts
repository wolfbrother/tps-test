import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// ================= 配置区域 =================
// 1. Package ID
const PACKAGE_ID = '0x7395d305e3530c68adaf0d1b5e932e267048e7daf3f701a0eb2e24125039ee09';

// 2. 模块名与函数名
const MODULE_NAME = 'tps_test';
const FUNCTION_NAME = 'create_counter';

// 3. create_counter 需要的那个参数 (根据你提供的 CLI 命令)
const ARGS_OBJECT_ID = '0x3fea3215978af68d44f53a56ee286c1f0e05042e9daf7f3fb6971b13166c2fbc';

// 4. 单次批量创建的数量 (建议一次 50-100 个，太多可能会导致 Gas 超限或包过大)
const BATCH_SIZE = 20; 
// ===========================================

async function main() {
    // 1. 初始化 Client
    const client = new SuiClient({ url: getFullnodeUrl('testnet') });

    // 2. 加载私钥
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
        throw new Error('请在 .env 文件中配置 SUI_PRIVATE_KEY');
    }
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.toSuiAddress();

    console.log(`👤 执行账户: ${address}`);
    console.log(`📦 准备批量创建 ${BATCH_SIZE} 个计数器...`);

    // 3. 构建交易块 (PTB)
    const tx = new Transaction();

    // 循环添加 moveCall 命令
    // 这样可以在 1 笔交易内完成 N 次创建，极大地节省时间和 Gas
    for (let i = 0; i < BATCH_SIZE; i++) {
        tx.moveCall({
            target: `${PACKAGE_ID}::${MODULE_NAME}::${FUNCTION_NAME}`,
            arguments: [
                tx.object(ARGS_OBJECT_ID) // 传入那个固定的参数对象
            ]
        });
    }

    // 设置 Gas 预算 (批量操作 Gas 消耗较高，设置充足一些，这里约 0.05 SUI)
    tx.setGasBudget(500_000_000);

    // 4. 执行交易并获取结果
    try {
        const startTime = Date.now();
        
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showObjectChanges: true, // 【关键】必须开启这个才能看到新创建的对象ID
            }
        });

        const endTime = Date.now();

        if (result.effects?.status.status === 'success') {
            console.log(`✅ 交易执行成功! Digest: ${result.digest}`);
            console.log(`⏱️ 耗时: ${endTime - startTime} ms`);
            
            // 5. 解析并提取新创建的对象 ID
            const createdObjectIds: string[] = [];

            if (result.objectChanges) {
                // 遍历变更列表
                for (const change of result.objectChanges) {
                    // 筛选类型为 'created' 的变更
                if (
                    change.type === 'created' && 
                    change.objectType.includes('Counter')
                ) {
                        createdObjectIds.push(change.objectId);
                    }
                }
            }
            console.log(result.objectChanges)

            console.log(`\n🎉 成功创建了 ${createdObjectIds.length} 个计数器对象:`);
            console.log(`===========================================`);
            
            // 打印整齐的 JSON 格式，方便复制
            console.log(JSON.stringify(createdObjectIds, null, 2));
            
            console.log(`===========================================`);
            
            // 如果你想直接生成可以直接粘贴到 counter.ts 的字符串格式：
            console.log("\n👇 可直接复制到 counter.ts 的格式:");
            const tsFormat = createdObjectIds.map(id => `"${id}"`).join(",\n");
            console.log(tsFormat);

        } else {
            console.error(`❌ 交易失败: ${result.effects?.status.error}`);
        }

    } catch (e) {
        console.error("执行过程中发生错误:", e);
    }
}

main();