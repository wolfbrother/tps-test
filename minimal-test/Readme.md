
## 创建合约项目
+ 创建合约项目：sui move new minimal_test
+ 编译合约：sui move build

## 部署合约到链上
+ 查看当前网络类型：sui client active-env
+ 查看当前账户和余额：sui client active-address && sui client balance
+ 部署：sui client publish 
+ 删除升级对象（节省gas费）：sui client call  --package 0x2   --module package   --function make_immutable   --args [可升级对象]   --gas-budget 10000000

## 脚本
