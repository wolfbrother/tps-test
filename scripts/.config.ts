// config.ts
import rawConfig from './config.json';

// ==========================================
// 1. 定义类型接口 (根据 config.json 结构)
// ==========================================

export type NetworkType = 'mainnet' | 'testnet';

// 对象配置详情
export interface ChainObjectConfig {
  package: string;
  globalState: string;
  upgradeCap: string;
}

// 费用配置详情
export interface FeeConfig {
  minSuiThreshold: number;
  splitAmountSui: number;
}

// 完整的配置文件结构
export interface AppConfig {
  network: NetworkType;
  targetCount: number;
  startCounterIndex: number;
  rpcIndex: number;
  iters: number;
  iterInterval: number;
  startTime: string;
  object: {
    module: string;
    opCreateCounter: string;
    opOperate: string;
    mainnet: ChainObjectConfig;
    testnet: ChainObjectConfig;
  };
  fee: {
    mainnet: FeeConfig;
    testnet: FeeConfig;
  };
  counters: {
    mainnet: string[];
    testnet: string[];
  };
  rpcs: {
    mainnet: string[];
    testnet: string[];
  };
}

// ==========================================
// 2. 导出配置实例
// ==========================================

// 将导入的 JSON 强制转换为我们定义的接口，以获得类型提示
const config: AppConfig = rawConfig as AppConfig;

export default config;

// ==========================================
// 3. 辅助函数：获取当前激活网络的配置
// ==========================================

/**
 * 扁平化的当前网络配置结构
 * (业务代码直接用这个，不用关心是 mainnet 还是 testnet)
 */
export interface ActiveConfig {
  network: NetworkType;
  targetCount: number;
  startCounterIndex: number;
  rpcIndex: number;
  iters: number;
  iterInterval: number;
  startTime: string;
  module: string;
  opCreateCounter: string;
  opOperate: string;
  packageId: string;
  globalStateId: string;
  upgradeCapId: string;
  fee: FeeConfig;
  counterList: string[];
  rpcList: string[];
}

/**
 * 根据 config.json 中的 "network" 字段，自动组装当前环境的配置
 */
export function getActiveConfig(): ActiveConfig {
  const currentNetwork = config.network; // 'testnet' 或 'mainnet'

  // 提取对应网络的对象配置
  const objConfig = config.object[currentNetwork];

  return {
    network: currentNetwork,
    targetCount: config.targetCount,
    startCounterIndex: config.startCounterIndex,
    rpcIndex: config.rpcIndex,
    iters: config.iters,
    iterInterval: config.iterInterval,
    startTime: config.startTime,
    
    // 通用配置
    module: config.object.module,
    opCreateCounter: config.object.opCreateCounter,
    opOperate: config.object.opOperate,
    
    // 特定网络的 ID
    packageId: objConfig.package,
    globalStateId: objConfig.globalState,
    upgradeCapId: objConfig.upgradeCap,
    
    // 特定网络的费用配置
    fee: config.fee[currentNetwork],
    
    // 特定网络的 Counter 列表
    counterList: config.counters[currentNetwork],
    
    // 特定网络的 RPC 列表
    rpcList: config.rpcs[currentNetwork]
  };
}