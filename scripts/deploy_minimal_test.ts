import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getActiveConfig } from './.config.ts';

dotenv.config();
const cfg = getActiveConfig();

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const NETWORK = (cfg.network || 'testnet') as SuiNetwork

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === 配置区域 ===
const REPEAT_COUNT = 1000; // 执行次数
// ================

async function main() {
    console.log(`>>> 初始化批量部署脚本 (目标: ${REPEAT_COUNT} 次)...`);

    const ABSOLUTE_PROJECT_PATH = path.resolve(__dirname, '../minimal_test/');
    const tomlPath = path.join(ABSOLUTE_PROJECT_PATH, 'Move.toml');
    
    if (!fs.existsSync(tomlPath)) {
        throw new Error(`找不到 Move.toml: ${tomlPath}`);
    }
    const CLIENT_INDEX = cfg.rpcIndex || 0;
    const client = !cfg.rpcList[CLIENT_INDEX]
    ? new SuiClient({ url: getFullnodeUrl(NETWORK) })
    : new SuiClient({ url: cfg.rpcList[CLIENT_INDEX] as string });
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) throw new Error('请配置 SUI_PRIVATE_KEY');
    
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.toSuiAddress();

    console.log(`👤 部署账户: ${address}`);
    const balance = await client.getBalance({ owner: address });
    console.log(`💰 当前余额: ${(Number(balance.totalBalance) / 1e9).toFixed(4)} SUI`);

    // ---------------------------------------------------------
    // 1. 编译 Move 合约 (只编译一次，为了效率)
    // ---------------------------------------------------------
    console.log(`\n🔨 正在编译 Move 合约...`);
    let buildOutput;
    try {
        const command = `sui move build --dump-bytecode-as-base64`;
        const stdout = execSync(command, { 
            encoding: 'utf-8', 
            stdio: 'pipe', 
            maxBuffer: 10 * 1024 * 1024,
            cwd: ABSOLUTE_PROJECT_PATH 
        }); 
        buildOutput = JSON.parse(stdout);
    } catch (e: any) {
        console.error("❌ 编译失败", e.message);
        return;
    }

    const { modules, dependencies } = buildOutput;
    console.log(`✅ 编译成功! 准备开始 ${REPEAT_COUNT} 次部署循环。\n`);

    // ---------------------------------------------------------
    // 2. 循环执行部署
    // ---------------------------------------------------------
    let successCount = 0;
    let failCount = 0;
    const packageIds: string[] = [];
    const startTimeTotal = Date.now();

    for (let i = 1; i <= REPEAT_COUNT; i++) {
        process.stdout.write(`[${i}/${REPEAT_COUNT}] 正在部署... `);
        
        try {
            const tx = new Transaction();

            // A. 发布合约
            const [upgradeCap] = tx.publish({
                modules: modules,
                dependencies: dependencies,
            });

            // B. 立即销毁升级权限 (Make Immutable)
            tx.moveCall({
                target: '0x2::package::make_immutable',
                arguments: [upgradeCap],
            });

            tx.setGasBudget(1_000_000_000); // 1 SUI 预算

            // C. 执行交易
            const result = await client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
                options: {
                    showEffects: true,
                    showObjectChanges: true, // 需要这个来获取 PackageID
                }
            });

            if (result.effects?.status.status === 'success') {
                // 提取 Package ID
                let pkgId = '未知';
                if (result.objectChanges) {
                    for (const change of result.objectChanges) {
                        if (change.type === 'published') {
                            pkgId = change.packageId;
                            break;
                        }
                    }
                }
                packageIds.push(pkgId);
                successCount++;
                console.log(`✅ 成功 (Pkg: ${pkgId.slice(0, 6)}...${pkgId.slice(-4)})`);
            } else {
                failCount++;
                console.log(`❌ 链上失败: ${result.effects?.status.error}`);
            }

        } catch (e: any) {
            failCount++;
            console.log(`❌ 请求异常: ${e.message}`);
            // 遇到错误稍微等待一下，避免 RPC 限制
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // ---------------------------------------------------------
    // 3. 总结
    // ---------------------------------------------------------
    const duration = ((Date.now() - startTimeTotal) / 1000).toFixed(1);
    console.log(`\n==========================================`);
    console.log(`🏁 执行完成！耗时 ${duration} 秒`);
    console.log(`✅ 成功: ${successCount}`);
    console.log(`❌ 失败: ${failCount}`);
    console.log(`📦 生成的 Package 列表 (前5个):`);
    console.log(packageIds.slice(0, 5));
    if (packageIds.length > 5) console.log(`... 以及其他 ${packageIds.length - 5} 个`);
    console.log(`==========================================`);
}

main().catch(console.error);