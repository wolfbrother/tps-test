

import { getActiveConfig } from './config.ts';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';

const cfg = getActiveConfig();
const globalState = cfg.globalStateId;

async function fetchAllTxsForFilter(client: SuiClient, filterValue: string) {
	const limit = 100; // 每页大小
	let cursor: string | null = null;
	const all: any[] = [];

	// 一组可尝试的 filter 形态（从最常见到备用）
	const candidateFilters: any[] = [
		{ InputObject: filterValue },
		{ InputObject: { objectId: filterValue } },
		{ InputObject: [filterValue] },
		{ MutatedObject: filterValue },
		{ MutatedObject: { objectId: filterValue } },
		{ ChangedObject: filterValue },
		{ ChangedObject: { objectId: filterValue } },
		{ FromAddress: filterValue },
		{ ToAddress: filterValue },
	];

	// 尝试每一种 filter 形态，直到 RPC 接受为止
	let workingFilter: any | null = null;
	for (const f of candidateFilters) {
		try {
			// 只请求一页用于验证 filter 是否被 RPC 接受
			await client.queryTransactionBlocks({ filter: f, cursor: null, limit: 1 });
			workingFilter = f;
			// console.log(`使用 filter 形态: ${JSON.stringify(f)}`);
			break;
		} catch (e: any) {
			// 如果是参数无效，继续尝试其它形态；否则抛出
			if (e && e.code === -32602) {
				continue;
			}
			throw e;
		}
	}

	if (!workingFilter) {
		throw new Error('无法为 queryTransactionBlocks 找到兼容的 filter 形态，请检查 RPC 版本或对象 ID');
	}

	// 使用被接受的形态分页拉取全部结果
	while (true) {
		const res = await client.queryTransactionBlocks({ filter: workingFilter, cursor, limit });
		if (!res) break;

		// 支持两种返回形态：旧版数组直接返回或新版分页对象 { data: [], nextCursor }
		let items: any[] = [];
		if (Array.isArray(res)) {
			items = res;
		} else if ('data' in res && Array.isArray((res as any).data)) {
			items = (res as any).data;
		} else if ((res as any).transactions && Array.isArray((res as any).transactions)) {
			items = (res as any).transactions;
		}

		if (items.length === 0) break;
		all.push(...items);

		// 优先使用 RPC 返回的 nextCursor / cursor 字段
		const nextCursor = (res as any).nextCursor ?? (res as any).cursor ?? null;
		if (nextCursor) {
			cursor = nextCursor as string;
			continue;
		}

		// 否则退回到使用最后一条的 digest
		const last = items[items.length - 1];
		cursor = (last as any).digest ?? null;
		if (!cursor) break;
	}

	return all;
}

async function main() {
	if (!globalState) {
		console.error('请在 config 中配置 `globalStateId`');
		process.exit(1);
	}

	const network = (cfg.network || 'testnet') as any;
	const client = new SuiClient({ url: getFullnodeUrl(network) });

	console.log(`查询对象 ${globalState} 的相关交易...`);

	// 查询两类：作为输入对象的交易，和被修改(mutated)的交易
	const [inputTxs, mutatedTxs] = await Promise.all([
		fetchAllTxsForFilter(client, globalState),
		fetchAllTxsForFilter(client, globalState),
	]);

	// 合并去重（按 digest）
	const mergedMap = new Map<string, any>();
	for (const t of inputTxs) mergedMap.set(t.digest, t);
	for (const t of mutatedTxs) mergedMap.set(t.digest, t);

	const txs = Array.from(mergedMap.values());

	console.log(`找到 ${txs.length} 条相关交易（包含 InputObject / MutatedObject）:`);

	for (const tx of txs) {
		const digest = tx.digest;
		const timestamp = (tx.timestampMs) ? new Date(Number(tx.timestampMs)).toISOString() : 'unknown';
		const sender = tx.transaction?.data?.sender || tx.transaction?.intent_message?.value?.sender || 'unknown';
		const status = tx.effects?.status?.status || tx.effects?.status || 'unknown';
		const changed = tx.objectChanges?.filter((c: any) => (c.objectId === globalState) || (c.digest === globalState)).length || 0;

		console.log(`- digest: ${digest} | sender: ${sender} | time: ${timestamp} | status: ${status} | relatedChanges: ${changed}`);
	}

	if (txs.length === 0) console.log('没有找到相关交易。');
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});

