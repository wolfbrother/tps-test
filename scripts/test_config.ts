// main.ts (或者 tps_run.ts)
import { getActiveConfig } from './config';

async function main() {
  // 1. 获取当前激活的配置 (自动根据 json 里的 network 字段切换)
  const cfg = getActiveConfig();

  console.log(`🚀 当前运行网络: ${cfg.network}`);
  console.log(`📦 Package ID: ${cfg.packageId}`);
  console.log(`💰 拆分金额: ${cfg.fee.splitAmountSui} SUI`);
  console.log(`wm 计数器数量: ${cfg.counterList.length}`);

  // 2. 使用配置 (示例)
  // 因为 cfg 已经是扁平化的结构，不需要再写 config.object[network].package
  const target = `${cfg.packageId}::${cfg.module}::${cfg.opOperate}`;
  
  console.log(`➡️ 正在调用目标: ${target}`);
  
  // 遍历计数器
  cfg.counterList.forEach((id, index) => {
      if (index < 3) console.log(`   - Counter[${index}]: ${id}`);
  });
}

main();