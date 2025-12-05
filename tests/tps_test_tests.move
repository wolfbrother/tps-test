/*
#[test_only]
module tps_test::tps_test_tests;
// uncomment this line to import the module
// use tps_test::tps_test;

const ENotImplemented: u64 = 0;

#[test]
fun test_tps_test() {
    // pass
}

#[test, expected_failure(abort_code = ::tps_test::tps_test_tests::ENotImplemented)]
fun test_tps_test_fail() {
    abort ENotImplemented
}
*/

#[test_only]
module tps_test::tests {
    use sui::test_scenario::{Self as ts};
    // 【已删除】 use sui::object::{Self}; // 这一行引起了警告，Move 2024 不需要它
    use tps_test::tps_test::{Self, GlobalState, Counter};

    // 定义测试地址
    const ADMIN: address = @0xA;
    const USER: address = @0xB;

    #[test]
    fun test_tps_workflow() {
        // 1. 启动测试场景
        let mut scenario = ts::begin(ADMIN);

        // =========================================================
        // 步骤 1: 初始化 (Init)
        // =========================================================
        {
            tps_test::init_for_testing(ts::ctx(&mut scenario));
        };

        // =========================================================
        // 步骤 2: 准备阶段 (Setup) - 创建 Counter
        // =========================================================
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            
            // 创建 Key = 0
            tps_test::create_counter(&mut state, ts::ctx(&mut scenario));
            // 创建 Key = 1
            tps_test::create_counter(&mut state, ts::ctx(&mut scenario));
            // 创建 Key = 2
            tps_test::create_counter(&mut state, ts::ctx(&mut scenario));

            assert!(tps_test::get_total_created(&state) == 3, 0);

            ts::return_shared(state);
        };

        // =========================================================
        // 步骤 3: 索引阶段 (Indexing) - 客户端查询 ID
        // =========================================================
        ts::next_tx(&mut scenario, USER);
        let target_id = {
            let state = ts::take_shared<GlobalState>(&scenario);
            let id = tps_test::get_counter_id(&state, 1);
            ts::return_shared(state);
            id
        };

        // =========================================================
        // 步骤 4: 运行阶段 (TPS Run) - 高频操作
        // =========================================================
        ts::next_tx(&mut scenario, USER);
        {
            // 直接通过 ID 获取特定的共享对象 Counter
            let mut counter = ts::take_shared_by_id<Counter>(&scenario, target_id);

            // 验证初始值
            assert!(tps_test::get_value(&counter) == 0, 1);

            // 模拟一个 PTB 包含 1000 次操作
            let mut i = 0;
            while (i < 1000) {
                tps_test::operate(&mut counter, ts::ctx(&mut scenario));
                i = i + 1;
            };

            // 验证最终结果
            assert!(tps_test::get_value(&counter) == 1000, 2);

            ts::return_shared(counter);
        };

        // =========================================================
        // 步骤 5: 验证互不干扰
        // =========================================================
        ts::next_tx(&mut scenario, USER);
        {
            let state = ts::take_shared<GlobalState>(&scenario);
            let id_0 = tps_test::get_counter_id(&state, 0);
            ts::return_shared(state); 

            let counter_0 = ts::take_shared_by_id<Counter>(&scenario, id_0);
            assert!(tps_test::get_value(&counter_0) == 0, 3);
            
            ts::return_shared(counter_0);
        };

        ts::end(scenario);
    }
}