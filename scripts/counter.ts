// 1. 定义字符串池
const counterList: string[] = [
  "0x38e6474e963e3ffb9fb7ebb2b54c27c75e92669491f5c7eab311b313a76ead66",
  "0xc833525099fd595ecaecc2f0f1f290d1dffc44bbdb0fd01c764c897d69d000f3",
  "0xfea424be2324d75c4853cf1aa4c4274178d83805c14d521072c5a125ae154aed",
  "0x22303062d0293add4ba6f2076e50ca65805a134e3aea546b133e3de4a6a501f0",
  "0x33f26ec47e673c1e3b85ac2ed8b04aecd31abbbacc85f4e27c0595e17a02cb05",
  "0x75543bc304d07a1b8e2ce8111983e472d509f6e9397b2a67ac4f599f87d5feeb",
  "0xa81b8a23f9949673fff76c54598f1c785236fc62208d8cd515a2bd0f0cb246ad",
  "0xf0dda880d0254b841fa7047eb8165233178d7dd994090cba1eb9adc4de670c50",
  "0xed23e463545d9a6c0b11a8855c74a7782f03b482707204c2755d7ff40ef5006e",
  "0x7b32839e3720dcb1f941ce139b95e862f30dea5f3f2d3497691f779c3057d927",
  "0x28ca20318e34c436443ff62c137de1ec2d7d25e8c0bd5655bc40d6d68e10b985",
  "0x1d99d99f9d386bd5004bb83148154d6fd04870bc32453a44988d5bf00e347cf4",
  "0xb7c0e9fe1df2d8adbdda2eb5fb97e5112c8604666a08ccfc584fdaee96cdd1d5"
];

/**
 * 从列表中随机获取一个字符串
 * @returns {string} 随机的 Key
 */
export function getRandomCounter(): string {
  if (counterList.length === 0) {
    throw new Error("Key list is empty");
  }
  const randomIndex = Math.floor(Math.random() * counterList.length);
  return counterList[randomIndex]!;
}

// --- 测试使用 ---
//console.log("第1次获取:", getRandomCounter());
//console.log("第2次获取:", getRandomCounter());
//console.log("第3次获取:", getRandomCounter());


/**
 * 获取 Counter 列表的总数量
 * @returns {number} 列表长度
 */
export function getCounterCount(): number {
  return counterList.length;
}

/**
 * 根据序号获取对应的 Counter
 * @param index 序号 (0 到 length-1)
 * @returns {string} 如果序号有效返回对应 Counter，否则返回随机 Counter
 */
export function getCounterByIndex(index: number): string {
  // 检查索引是否在有效范围内
  if (index >= 0 && index < counterList.length) {
    return counterList[index]!;
  }
  
  // 如果越界，打印一个提示（可选）并返回随机值
  // console.warn(`Index ${index} is out of bounds, returning random counter.`);
  return getRandomCounter();
}

/**
 * 根据账户地址和当前时间打乱 Counter 列表顺序
 * @param address 账户地址字符串
 * @returns {string[]} 打乱后的新列表
 */
export function getShuffledCounterList(address: string): string[] {
  // 1. 克隆原数组，防止修改原数据
  const shuffledList = [...counterList];
  
  // 2. 生成种子 (Seed)
  // 算法：将地址所有字符的 Unicode 码相加，再加上当前时间戳
  let seed = Date.now();
  for (let i = 0; i < address.length; i++) {
    seed += address.charCodeAt(i);
  }

  // 3. 定义一个简单的带种子的伪随机数生成器
  // (这是为了替代 Math.random()，因为 Math.random 不支持种子)
  const seededRandom = () => {
    // 简单的线性同余生成器 (LCG) 参数
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280.0;
  };

  // 4. 使用 Fisher-Yates 洗牌算法
  for (let i = shuffledList.length - 1; i > 0; i--) {
    // 使用自定义的 seededRandom 生成 0 到 i 之间的随机索引
    const j = Math.floor(seededRandom() * (i + 1));
    
    // 交换元素
    // 修改点：在右侧的数组元素后添加 '!'
    [shuffledList[i], shuffledList[j]] = [shuffledList[j]!, shuffledList[i]!];
  }

  return shuffledList;
}



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

//console.log(getCounterCount())
//console.log(getCounterByIndex(6))
//console.log(getCounterByIndex(18))
//console.log(getShuffledCounterList("ssasdfd"))
//console.log(getRandomNCounters('ssssadfsd', 3))