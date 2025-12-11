import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import * as dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url'; // 新增导入
import { getActiveConfig } from './.config.ts';

dotenv.config();
const cfg = getActiveConfig();

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const NETWORK = (cfg.network || 'testnet') as SuiNetwork
// ===========================================

// 【修复关键点】手动定义 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log(">>> 初始化部署脚本...");

    // 1. 计算 Move 项目的绝对路径
    // 现在 __dirname 可以正常使用了
    const ABSOLUTE_PROJECT_PATH = path.resolve(__dirname, '../tps_test/');
    
    console.log(`📂 项目绝对路径: ${ABSOLUTE_PROJECT_PATH}`);

    // 检查一下 Move.toml 是否真的存在，避免后面报错看不懂
    const tomlPath = path.join(ABSOLUTE_PROJECT_PATH, 'Move.toml');
    if (!fs.existsSync(tomlPath)) {
        throw new Error(`找不到 Move.toml 文件！请检查路径是否正确: ${tomlPath}`);
    }

    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) throw new Error('请在 .env 文件中配置 SUI_PRIVATE_KEY');
    
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    const address = keypair.toSuiAddress();

    console.log(`👤 部署账户: ${address}`);

    const balance = await client.getBalance({ owner: address });
    const balanceSui = Number(balance.totalBalance) / 1_000_000_000;
    console.log(`💰 当前余额: ${balanceSui.toFixed(4)} SUI`);

     // 4. 编译 Move 合约
    console.log(`\n🔨 正在编译 Move 合约...`);
    
    let buildOutput;
    try {
        // 【修改点 1】去掉 --path 参数
        // 因为我们下面通过 cwd 选项直接切换到该目录下执行，就像你手动 cd .. 一样
        const command = `sui move build --dump-bytecode-as-base64`;
        
        console.log(`   工作目录: ${ABSOLUTE_PROJECT_PATH}`);
        console.log(`   执行命令: ${command}`);

        const stdout = execSync(command, { 
            encoding: 'utf-8', 
            stdio: 'pipe', 
            maxBuffer: 10 * 1024 * 1024,
            // 【修改点 2】关键！设置当前工作目录 (Current Working Directory) 为项目根目录
            cwd: ABSOLUTE_PROJECT_PATH 
        }); 
        
        buildOutput = JSON.parse(stdout);
    } catch (e: any) {
        // ... 错误处理代码保持不变 ...
        console.error("\n❌ 编译命令执行失败！");
        if (e.stderr) {
            console.error("↓↓↓ 详细错误日志 (STDERR) ↓↓↓");
            console.error(e.stderr.toString());
        } else {
            console.error(e.message);
        }
        return;
    }

    const { modules, dependencies } = buildOutput;
    console.log(`✅ 编译成功! 包含 ${modules.length} 个模块。`);

    // 5. 构建 Publish 交易
    const tx = new Transaction();

    const [upgradeCap] = tx.publish({
        modules: modules,
        dependencies: dependencies,
    });

    tx.transferObjects([upgradeCap], address);
    tx.setGasBudget(1_000_000_000); 

    // 6. 发送交易
    console.log("\n🚀 正在发送部署交易...");
    const startTime = Date.now();

    try {
        const result = await client.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
            options: {
                showEffects: true,
                showObjectChanges: true,
            }
        });

        const endTime = Date.now();

        if (result.effects?.status.status === 'success') {
            console.log(`✅ 部署成功! Digest: ${result.digest}`);
            
            let packageId;
            if (result.objectChanges) {
                for (const change of result.objectChanges) {
                    if (change.type === 'published') {
                        packageId = change.packageId;
                        break;
                    }
                }
            }

            console.log(`📦 Package ID: ${packageId}`);
            console.log(`🔗 浏览器查看: https://suiscan.xyz/${NETWORK}/tx/${result.digest}`);

        } else {
            console.error(`❌ 部署上链失败: ${result.effects?.status.error}`);
        }

    } catch (e: any) {
        console.error("❌ 交易执行出错:", e);
    }
}

main().catch(console.error);