# tps-test

## 运行脚本
+ 环境：
  + 初始化npm项目：npm init -y 
  + 安装 SUI SDK 和 dotenv (管理私钥)： npm install @mysten/sui dotenv
  + 安装 TypeScript 开发工具： npm install -D typescript ts-node @types/node

+ 创建文件scripts\.env，并填充私钥： SUI_PRIVATE_KEY=suiprivkey1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
+ 首次运行要安装tsx： npm install -D tsx
+ 运行脚本命令：npx tsx tps_run.ts