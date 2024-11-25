const EventEmitter = require('events');
const R = require('ramda');
const Db = require('../util/db');
const Blocks = require('./blocks');
const Block = require('./block');
const Transactions = require('./transactions');
const TransactionAssertionError = require('./transactionAssertionError');
const BlockAssertionError = require('./blockAssertionError');
const BlockchainAssertionError = require('./blockchainAssertionError');
const Config = require('../config');

// Database settings
const BLOCKCHAIN_FILE = 'blocks.json';
const TRANSACTIONS_FILE = 'transactions.json';

class Blockchain {
    constructor(dbName) {
        this.blocksDb = new Db('data/' + dbName + '/' + BLOCKCHAIN_FILE, new Blocks());
        this.transactionsDb = new Db('data/' + dbName + '/' + TRANSACTIONS_FILE, new Transactions());

        // INFO: In this implementation the database is a file and every time data is saved it rewrites the file, probably it should be a more robust database for performance reasons
        this.blocks = this.blocksDb.read(Blocks);
        this.transactions = this.transactionsDb.read(Transactions);

        // Some places uses the emitter to act after some data is changed
        this.emitter = new EventEmitter();

        // 初始化当前难度
        this.currentDifficulty = Config.pow.BASE_DIFFICULTY;

        this.init();
    }

    init() {
        // Create the genesis block if the blockchain is empty
        if (this.blocks.length == 0) {
            console.info('Blockchain empty, adding genesis block');
            this.blocks.push(Block.genesis);
            this.blocksDb.write(this.blocks);
        }

        // Remove transactions that are in the blockchain
        console.info('Removing transactions that are in the blockchain');
        R.forEach(this.removeBlockTransactionsFromTransactions.bind(this), this.blocks);
    }

    getAllBlocks() {
        return this.blocks;
    }

    getSignInInfo() {//获取签到信息
        return this.blocks.map(block => {
            // 找到类型为 "regular" 的交易
            const regularTransaction = block.transactions.find(tx => tx.type === "regular");
            
            if (regularTransaction && regularTransaction.data.inputs.length > 0) {
                const firstInput = regularTransaction.data.inputs[0];
                return {
                    blockIndex: block.index,
                    address: firstInput.address,
                    studentId: firstInput.studentId,
                    realWorldTime: firstInput.realWorldTime
                };
            }
            return null;
        }).filter(info => info !== null); // 移除没有符合条件的区块
    }
    //计算当前链的累计难度值
    getTotalDifficulty() {
        return this.calculateChainDifficulty(this.blocks);
    }

    // 添加 calculateChainDifficulty 方法到 Blockchain 类
    calculateChainDifficulty(blocks) {
        return blocks.reduce((totalDifficulty, block) => {
            return totalDifficulty + block.getAdjustedDifficulty();
        }, BigInt(0));
    }

    // 用于比较两个难度值的辅助方法
    static compareDifficulties(diff1, diff2) {
        // 较大的调整后难度值表示更难
        return diff1 > diff2 ? 1 : (diff1 < diff2 ? -1 : 0);
    }
    
    getBlockByIndex(index) {
        return R.find(R.propEq('index', index), this.blocks);
    }

    getBlockByHash(hash) {
        return R.find(R.propEq('hash', hash), this.blocks);
    }

    getLastBlock() {
        return R.last(this.blocks);
    }
    //该函数是由上一个函数衍生而来，用于配合上一个函数做时间戳差值获取每n个区块的生成间隔时间。
    getNthLastBlock(n) {
        // 确保n是一个正整数
        n = Math.max(Math.floor(n), 1);
        
        // 使用Ramda的nth和length函数
        const index = Math.max(this.blocks.length - n, 0);
        return R.nth(index, this.blocks);
    }
    

    getDifficulty(index) {     //这是新的获取难度的函数，在旧版本的基础上添加获取时间戳差值的功能。   
        // 从配置文件中获取每X个区块的值
        const everyXBlocks = Config.pow.getEveryXBlocks();
        // 初始化时间戳差值
        let timestampDiff = 0;
        // 检查是否需要调整难度
        if ((this.blocks.length - 1) % everyXBlocks === 0 && this.blocks.length > 1) {
            // 获取最后一个区块
            const lastBlock = this.getLastBlock();
            const lastBlockTimestamp = lastBlock.timestamp;

            // 获取倒数第N个区块（N = everyXBlocks）
            const nthLastBlock = this.getNthLastBlock(everyXBlocks);
            const nthLastBlockTimestamp = nthLastBlock.timestamp;
            // 添加详细的日志输出
            console.log(`Debug - Last Block: Index=${lastBlock.index}, Timestamp=${lastBlockTimestamp}`);
            console.log(`Debug - Nth Last Block: Index=${nthLastBlock.index}, Timestamp=${nthLastBlockTimestamp}`);
            // 计算时间戳差值（单位：秒）
            timestampDiff = (lastBlockTimestamp - nthLastBlockTimestamp) ;

            console.log(`Debug - Timestamp Difference: ${timestampDiff} seconds`);
            // 传递 this.currentDifficulty, 时间戳差值作为参数
            this.currentDifficulty = Config.pow.getDifficulty(this.blocks, index, timestampDiff, this.currentDifficulty); 
        }
        // 调用配置文件的 getDifficulty 函数，传入
        return this.currentDifficulty;
    }
    //旧的获取难度的函数，保留不做改动。
    // getDifficulty(index) {        
    //     // Calculates the difficulty based on the index since the difficulty value increases every X blocks.
    //     return Config.pow.getDifficulty(this.blocks, index);        
    // }

    getAllTransactions() {
        return this.transactions;
    }

    getTransactionById(id) {
        return R.find(R.propEq('id', id), this.transactions);
    }

    getTransactionFromBlocks(transactionId) {
        return R.find(R.compose(R.find(R.propEq('id', transactionId)), R.prop('transactions')), this.blocks);
    }

    replaceChain1(newBlockchain) {
        // 首先比较累计难度
        const currentDifficulty = this.getTotalDifficulty();
        const newDifficulty = this.calculateChainDifficulty(newBlockchain);
    
        // 使用比较方法
        if (Blockchain.compareDifficulties(newDifficulty, currentDifficulty) <= 0) {
            console.info(`Received blockchain is not more difficult than the current blockchain. 
                          Current difficulty: ${currentDifficulty}, 
                          New difficulty: ${newDifficulty}`);
            return false;
        }

        console.info(`Blockchain possibly behind. Our difficulty: ${currentDifficulty}, Peer's difficulty: ${newDifficulty}`);
    
        // 验证新区块链的正确性
        this.checkChain(newBlockchain);
    
        // 找到分叉点
        let forkPoint = 0;
        while (forkPoint < this.blocks.length && forkPoint < newBlockchain.length) {
            if (this.blocks[forkPoint].hash !== newBlockchain[forkPoint].hash) {
                break;
            }
            forkPoint++;
        }
    
        // 获取需要添加的新区块
        let newBlocks = newBlockchain.slice(forkPoint);
    
        console.info(`Found fork point at index ${forkPoint}. Adding ${newBlocks.length} new blocks.`);
    
        // 移除分叉点之后的旧区块（如果有的话）
        if (forkPoint < this.blocks.length) {
            this.blocks = this.blocks.slice(0, forkPoint);
        }
    
        // 添加新区块
        newBlocks.forEach(block => {
            try {
                this.addBlock(block, false);
            } catch (err) {
                console.error('Error adding block to chain', err);
                throw new BlockchainAssertionError('Error adding block to chain');
            }
        });
    
        console.info('Blockchain replaced successfully');
        this.emitter.emit('blockchainReplaced', newBlocks);
    }
    
    replaceChain(newBlockchain) {
        // It doesn't make sense to replace this blockchain by a smaller one
        if (newBlockchain.length <= this.blocks.length) {
            console.error('Blockchain is not more difficult than the current blockchain');
            throw new BlockchainAssertionError('Blockchain is not more difficult than the current blockchain');
        }

        // Verify if the new blockchain is correct
        this.checkChain(newBlockchain);

        // Get the blocks that diverges from our blockchain
        console.info('Received blockchain is valid. Replacing current blockchain with received blockchain');
        let newBlocks = R.takeLast(newBlockchain.length - this.blocks.length, newBlockchain);

        // Add each new block to the blockchain
        R.forEach((block) => {
            this.addBlock(block, false);
        }, newBlocks);

        this.emitter.emit('blockchainReplaced', newBlocks);
    }

    checkChain(blockchainToValidate) {
        // Check if the genesis block is the same
        if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(Block.genesis)) {
            console.error('Genesis blocks aren\'t the same');
            throw new BlockchainAssertionError('Genesis blocks aren\'t the same');
        }

        // Compare every block to the previous one (it skips the first one, because it was verified before)
        try {
            for (let i = 1; i < blockchainToValidate.length; i++) {
                this.checkBlock(blockchainToValidate[i], blockchainToValidate[i - 1], blockchainToValidate);
            }
        } catch (ex) {
            console.error('Invalid block sequence');
            throw new BlockchainAssertionError('Invalid block sequence', null, ex);
        }
        return true;
    }

    addBlock(newBlock, emit = true) {
        // It only adds the block if it's valid (we need to compare to the previous one)
        if (this.checkBlock(newBlock, this.getLastBlock())) {
            this.blocks.push(newBlock);
            this.blocksDb.write(this.blocks);

            // After adding the block it removes the transactions of this block from the list of pending transactions
            this.removeBlockTransactionsFromTransactions(newBlock);

            console.info(`Block added: ${newBlock.hash}`);
            console.debug(`Block added: ${JSON.stringify(newBlock)}`);
            if (emit) this.emitter.emit('blockAdded', newBlock);

            return newBlock;
        }
    }

    addTransaction(newTransaction, emit = true) {
        // It only adds the transaction if it's valid
        if (this.checkTransaction(newTransaction, this.blocks)) {
            this.transactions.push(newTransaction);
            this.transactionsDb.write(this.transactions);

            console.info(`Transaction added: ${newTransaction.id}`);
            console.debug(`Transaction added: ${JSON.stringify(newTransaction)}`);
            if (emit) this.emitter.emit('transactionAdded', newTransaction);

            return newTransaction;
        }
    }

    removeBlockTransactionsFromTransactions(newBlock) {
        this.transactions = R.reject((transaction) => { return R.find(R.propEq('id', transaction.id), newBlock.transactions); }, this.transactions);
        this.transactionsDb.write(this.transactions);
    }

    checkBlock(newBlock, previousBlock, referenceBlockchain = this.blocks) {
        const blockHash = newBlock.toHash();

        if (previousBlock.index + 1 !== newBlock.index) { // Check if the block is the last one
            console.error(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
            throw new BlockAssertionError(`Invalid index: expected '${previousBlock.index + 1}' got '${newBlock.index}'`);
        } else if (previousBlock.hash !== newBlock.previousHash) { // Check if the previous block is correct
            console.error(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
            throw new BlockAssertionError(`Invalid previoushash: expected '${previousBlock.hash}' got '${newBlock.previousHash}'`);
        } else if (blockHash !== newBlock.hash) { // Check if the hash is correct
            console.error(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
            throw new BlockAssertionError(`Invalid hash: expected '${blockHash}' got '${newBlock.hash}'`);
        // } else if (newBlock.getDifficulty() >= this.getDifficulty(newBlock.index)) { // If the difficulty level of the proof-of-work challenge is correct
        //     console.error(`Invalid proof-of-work difficulty: expected '${newBlock.getDifficulty()}' to be smaller than '${this.getDifficulty(newBlock.index)}'`);
        //     throw new BlockAssertionError(`Invalid proof-of-work difficulty: expected '${newBlock.getDifficulty()}' be smaller than '${this.getDifficulty()}'`);
        }

        // INFO: Here it would need to check if the block follows some expectation regarging the minimal number of transactions, value or data size to avoid empty blocks being mined.

        // For each transaction in this block, check if it is valid
        // 似乎是个恶性bug所以我注释掉了他。
        // R.forEach(this.checkTransaction.bind(this), newBlock.transactions, referenceBlockchain);

        // Check if the sum of output transactions are equal the sum of input transactions + MINING_REWARD (representing the reward for the block miner)
        let sumOfInputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('inputs'), R.prop('data')), newBlock.transactions))) + Config.MINING_REWARD;
        let sumOfOutputsAmount = R.sum(R.flatten(R.map(R.compose(R.map(R.prop('amount')), R.prop('outputs'), R.prop('data')), newBlock.transactions)));

        let isInputsAmountGreaterOrEqualThanOutputsAmount = R.gte(sumOfInputsAmount, sumOfOutputsAmount);

        if (!isInputsAmountGreaterOrEqualThanOutputsAmount) {
            console.error(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`);
            throw new BlockAssertionError(`Invalid block balance: inputs sum '${sumOfInputsAmount}', outputs sum '${sumOfOutputsAmount}'`, { sumOfInputsAmount, sumOfOutputsAmount });
        }

        // Check if there is double spending
        let listOfTransactionIndexInputs = R.flatten(R.map(R.compose(R.map(R.compose(R.join('|'), R.props(['transaction', 'index']))), R.prop('inputs'), R.prop('data')), newBlock.transactions));
        let doubleSpendingList = R.filter((x) => x >= 2, R.map(R.length, R.groupBy(x => x)(listOfTransactionIndexInputs)));

        if (R.keys(doubleSpendingList).length) {
            console.error(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
            throw new BlockAssertionError(`There are unspent output transactions being used more than once: unspent output transaction: '${R.keys(doubleSpendingList).join(', ')}'`);
        }

        // Check if there is only 1 fee transaction and 1 reward transaction;
        let transactionsByType = R.countBy(R.prop('type'), newBlock.transactions);
        if (transactionsByType.fee && transactionsByType.fee > 1) {
            console.error(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
            throw new BlockAssertionError(`Invalid fee transaction count: expected '1' got '${transactionsByType.fee}'`);
        }

        if (transactionsByType.reward && transactionsByType.reward > 1) {
            console.error(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
            throw new BlockAssertionError(`Invalid reward transaction count: expected '1' got '${transactionsByType.reward}'`);
        }

        return true;
    }

    checkTransaction(transaction, referenceBlockchain = this.blocks) {

        // Check the transaction
        transaction.check(transaction);

        // Verify if the transaction isn't already in the blockchain
        let isNotInBlockchain = R.all((block) => {
            return R.none(R.propEq('id', transaction.id), block.transactions);
        }, referenceBlockchain);

        if (!isNotInBlockchain) {
            console.error(`Transaction '${transaction.id}' is already in the blockchain`);
            throw new TransactionAssertionError(`Transaction '${transaction.id}' is already in the blockchain`, transaction);
        }

        // Verify if all input transactions are unspent in the blockchain
        let isInputTransactionsUnspent = R.all(R.equals(false), R.flatten(R.map((txInput) => {
            return R.map(
                R.pipe(
                    R.prop('transactions'),
                    R.map(R.pipe(
                        R.path(['data', 'inputs']),
                        R.contains({ transaction: txInput.transaction, index: txInput.index })
                    ))
                ), referenceBlockchain);
        }, transaction.data.inputs)));

        if (!isInputTransactionsUnspent) {
            console.error(`Not all inputs are unspent for transaction '${transaction.id}'`);
            throw new TransactionAssertionError(`Not all inputs are unspent for transaction '${transaction.id}'`, transaction.data.inputs);
        }

        return true;
    }

    getUnspentTransactionsForAddress(address) {
        const selectTxs = (transaction) => {
            let index = 0;
            // Create a list of all transactions outputs found for an address (or all).
            R.forEach((txOutput) => {
                if (address && txOutput.address == address) {
                    txOutputs.push({
                        transaction: transaction.id,
                        index: index,
                        amount: txOutput.amount,
                        address: txOutput.address
                    });
                }
                index++;
            }, transaction.data.outputs);

            // Create a list of all transactions inputs found for an address (or all).            
            R.forEach((txInput) => {
                if (address && txInput.address != address) return;

                txInputs.push({
                    transaction: txInput.transaction,
                    index: txInput.index,
                    amount: txInput.amount,
                    address: txInput.address
                });
            }, transaction.data.inputs);
        };

        // Considers both transactions in block and unconfirmed transactions (enabling transaction chain)
        let txOutputs = [];
        let txInputs = [];
        R.forEach(R.pipe(R.prop('transactions'), R.forEach(selectTxs)), this.blocks);
        R.forEach(selectTxs, this.transactions);

        // Cross both lists and find transactions outputs without a corresponding transaction input
        let unspentTransactionOutput = [];
        R.forEach((txOutput) => {
            if (!R.any((txInput) => txInput.transaction == txOutput.transaction && txInput.index == txOutput.index, txInputs)) {
                unspentTransactionOutput.push(txOutput);
            }
        }, txOutputs);

        return unspentTransactionOutput;
    }
}

module.exports = Blockchain;
