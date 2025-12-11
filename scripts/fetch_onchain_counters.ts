

import { getActiveConfig } from './.config.ts';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

const cfg = getActiveConfig();

// =================配置区域=================

// 请替换为你实际部署后的 GlobalState 对象 ID
const GLOBAL_STATE_ID = cfg.globalStateId;

type SuiNetwork = 'mainnet' | 'testnet' | 'devnet' | 'localnet';
const NETWORK = (cfg.network || 'testnet') as SuiNetwork

// =========================================

async function main() {
    // 1. 初始化客户端
    const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });
    console.log(`正在连接到 ${NETWORK}...`);

    try {
        // 2. 获取 GlobalState 对象以拿到 registry (Table) ID 和 total_created
        console.log(`正在读取 GlobalState: ${GLOBAL_STATE_ID}`);
        const globalStateObj = await client.getObject({
            id: GLOBAL_STATE_ID,
            options: { showContent: true }
        });

        if (!globalStateObj.data || !globalStateObj.data.content) {
            throw new Error("无法找到 GlobalState 对象或内容为空");
        }

        const fields = (globalStateObj.data.content as any).fields;
        
        // 这里的字段名对应 Move 合约中的结构体定义
        const totalCreated = Number(fields.total_created);
        const registryTableId = fields.registry.fields.id.id;

        console.log(`Total Created: ${totalCreated}`);
        console.log(`Registry Table ID: ${registryTableId}`);

        if (totalCreated === 0) {
            console.log("当前没有创建任何 Counter 对象。");
            return;
        }

        // 3. 遍历 Table 获取所有 Counter 的 ID
        // 由于 key 是从 0 到 total_created - 1 的连续 u64，我们可以生成 key 列表
        console.log(`正在从 Table 中获取 ${totalCreated} 个 Counter ID...`);

        const counterIds: string[] = [];

        // 为了防止请求过多导致被限流，我们使用简单的并发控制（例如每批 10 个）
        const batchSize = 10;
        for (let i = 0; i < totalCreated; i += batchSize) {
            const promises = [];
            for (let j = i; j < i + batchSize && j < totalCreated; j++) {
                promises.push(
                    client.getDynamicFieldObject({
                        parentId: registryTableId,
                        name: {
                            type: 'u64',
                            value: j.toString()
                        }
                    })
                );
            }

            const results = await Promise.all(promises);

            for (const res of results) {
                if (res.data && res.data.content) {
                    const content = res.data.content as any;
                    const counterId = content.fields.bytes || content.fields.id;
                    if (typeof counterId === 'string') {
                        counterIds.push(counterId);
                    } else if (counterId && typeof counterId === 'object' && typeof counterId.id === 'string') {
                        counterIds.push(counterId.id);
                    }
                }
            }
            console.log(`已解析进度: ${Math.min(i + batchSize, totalCreated)} / ${totalCreated}`);
        }

        //console.log("找到的所有 Counter ID:", counterIds);

        // 4. 批量获取这些 Counter 对象的具体信息 (value)
        console.log("正在获取所有 Counter 对象的详细信息...");

        // multiGetObjects 一次最多支持查询一定数量的对象（通常是 50），所以需要分块
        const objectDetails = [];
        const multiGetChunkSize = 50;

        for (let i = 0; i < counterIds.length; i += multiGetChunkSize) {
            const chunk = counterIds.slice(i, i + multiGetChunkSize);
            // 修正：multiGetObjects 只接受字符串数组
            const chunkRes = await client.multiGetObjects({
                ids: chunk,
                options: { showContent: true }
            });
            objectDetails.push(...chunkRes);
        }

        // 5. 收集所有 value 并打印完整列表
        const allValues: string[] = [];
        objectDetails.forEach((item) => {
            if (item.data && item.data.content) {
                const fields = (item.data.content as any).fields;
                const value = fields.value;
                if (typeof value === 'string' || typeof value === 'number') {
                    allValues.push(String(value));
                }
            }
        });

        console.log("\n========= Counter Values =========");
        console.log(JSON.stringify(allValues, null, 2));

    } catch (e) {
        console.error("执行出错:", e);
    }
}

main();