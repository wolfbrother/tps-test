import { getActiveConfig } from './.config';

const cfg = getActiveConfig();
// 1. 定义字符串池
const counterList = cfg.counterList;

/**
 * 根据地址和时间作为种子，从列表中随机选择 N 个不重复的 Counter
 * 返回的列表也是乱序的
 * @param address 账户地址 (作为随机种子的一部分)
 * @param n 需要获取的数量
 * @returns {string[]} 包含 N 个 Counter 的字符串数组
 */
export function getRandomNCounters(address: string, n: number): string[] {
  // 1. 参数校验
  if (n > counterList.length) {
    throw new Error(`请求的数量 N (${n}) 超出了列表总长度 (${counterList.length})`);
  }
  if (n < 0) {
    throw new Error("数量 N 不能为负数");
  }

  // 2. 克隆原数组 (避免修改原数据)
  const temp = [...counterList];

  // 3. 生成随机种子 (算法：地址字符码累加 + 当前时间戳)
  let seed = Date.now();
  for (let i = 0; i < address.length; i++) {
    seed += address.charCodeAt(i);
  }

  // 4. 定义带种子的伪随机数生成器 (LCG 算法)
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280.0;
  };

  // 5. 执行 Fisher-Yates 洗牌算法
  // 将整个列表打乱，确保随机性
  for (let i = temp.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    
    // 交换元素 (使用 ! 非空断言解决 TS 严格检查问题)
    [temp[i], temp[j]] = [temp[j]!, temp[i]!];
  }

  // 6. 截取前 N 个元素返回
  return temp.slice(0, n);
}


/**
 * 从列表中按顺序获取 N 个 Counter，从 startIndex 开始。
 * 如果 (startIndex + n) 超过列表长度，则自动循环回到列表开头继续获取。
 * 
 * @param address 账户地址 (保留参数，以符合统一接口规范，但在当前顺序获取逻辑中暂不参与计算)
 * @param n 需要获取的数量
 * @param startIndex 起始索引位置
 * @returns {string[]} 包含 N 个 Counter 的字符串数组
 */
export function getNCounters(address: string, n: number, startIndex: number): string[] {
  // 1. 校验：如果列表的总数量不足 n 个，则抛出异常
  if (counterList.length < n) {
    throw new Error(`请求的数量 N (${n}) 超过了列表总长度 (${counterList.length})，无法满足请求。`);
  }

  if (n < 0) {
    throw new Error("数量 N 不能为负数");
  }

  const result: string[] = [];
  const len = counterList.length;

  // 2. 循环获取
  for (let i = 0; i < n; i++) {
    // 计算当前索引：
    // (startIndex + i) % len 实现了循环队列逻辑
    // 当索引达到 len 时，取模结果变回 0，从而实现“溢出后从0开始”
    const currentIndex = (startIndex + i) % len;
    
    // 既然 counterList 是常量池且长度已校验，这里肯定存在，可以用 ! 断言或直接取值
    result.push(counterList[currentIndex]!);
  }

  return result;
}
