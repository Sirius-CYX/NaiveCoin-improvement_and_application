// Do not change these configurations after the blockchain is initialized
module.exports = {
    // INFO: The mining reward could decreases over time like bitcoin. See https://en.bitcoin.it/wiki/Mining#Reward.
    MINING_REWARD: 5000000000,
    // INFO: Usually it's a fee over transaction size (not quantity)
    FEE_PER_TRANSACTION: 1,
    // INFO: Usually the limit is determined by block size (not quantity)
    TRANSACTIONS_PER_BLOCK: 2,
    genesisBlock: {
        index: 0,
        previousHash: '0',
        timestamp: 1465154705,
        nonce: 0,
        transactions: [
            {
                id: '63ec3ac02f822450039df13ddf7c3c0f19bab4acd4dc928c62fcd78d5ebc6dba',
                hash: null,
                type: 'regular',
                data: {
                    inputs: [],
                    outputs: []
                }
            }
        ]
    },
    pow: {//这是新的pow实现，为了实现动态难度调整，从时间角度判断，将区块生成时间控制在稳定范围。

        BASE_DIFFICULTY : Number.MAX_SAFE_INTEGER,
        EVERY_X_BLOCKS : 5,
        POW_CURVE : 5,
        EXPECTED_BLOCK_TIME : 5,

        getEveryXBlocks: function() {
            return this.EVERY_X_BLOCKS;
        },
        // getDifficulty 函数
        getDifficulty: function(blocks, index, timestampDiff, currentDifficulty) {
            
            // 如果时间戳差值为0，说明还不需要调整难度
            if (timestampDiff === 0) {
            return currentDifficulty;
            }

            // 计算预期的时间
            const expectedTime = this.EXPECTED_BLOCK_TIME * this.EVERY_X_BLOCKS;

             // 计算实际时间与预期时间的比例
            const timeRatio = timestampDiff / expectedTime;
            console.log(`Debug info: timestampDiff=${timestampDiff}, expectedTime=${expectedTime}, timeRatio=${timeRatio.toFixed(4)}`);

            // 定义死区范围（±5%）
            const deadZoneLower = 0.95;
            const deadZoneUpper = 1.05;
            // 检查是否在死区内，如果在，则说明时间差值在正常范围内，不需要调整难度。
            if (timeRatio >= deadZoneLower && timeRatio <= deadZoneUpper) {
                console.log(`No adjustment needed. Time ratio (${timeRatio.toFixed(2)}) within dead zone.`);
                return currentDifficulty;
            }

            // 直接使用 timeRatio 作为调整因子
            let adjustmentFactor = timeRatio;
    
            // 限制调整因子在 0.25 到 4 之间
            adjustmentFactor = Math.max(0.25, Math.min(4, adjustmentFactor));
    
            // 计算新的难度值，并确保是整数
            let newDifficulty = Math.round(currentDifficulty * adjustmentFactor);
    
            // 确保新难度不会小于1（假设1是最大难度）
            newDifficulty = Math.max(1, newDifficulty);

            console.log(`Difficulty adjusted: ${currentDifficulty} -> ${newDifficulty.toFixed(0)} (factor: ${adjustmentFactor.toFixed(2)})`);
    
            return newDifficulty;
        },

    }
    //旧的pow实现过程，我们不改动它
    // pow: {
    //     getDifficulty: (blocks, index) => {
    //         // Proof-of-work difficulty settings
    //         const BASE_DIFFICULTY = Number.MAX_SAFE_INTEGER;
    //         const EVERY_X_BLOCKS = 5;
    //         const POW_CURVE = 5;

    //         // INFO: The difficulty is the formula that naivecoin choose to check the proof a work, this number is later converted to base 16 to represent the minimal initial hash expected value.
    //         // INFO: This could be a formula based on time. Eg.: Check how long it took to mine X blocks over a period of time and then decrease/increase the difficulty based on that. See https://en.bitcoin.it/wiki/Difficulty
    //         return Math.max(
    //             Math.floor(
    //                 BASE_DIFFICULTY / Math.pow(
    //                     Math.floor(((index || blocks.length) + 1) / EVERY_X_BLOCKS) + 1
    //                     , POW_CURVE)
    //             )
    //             , 0);
    //     }
    // }
};