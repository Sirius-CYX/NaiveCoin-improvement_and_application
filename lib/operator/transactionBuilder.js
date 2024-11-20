const R = require('ramda');
const CryptoUtil = require('../util/cryptoUtil');
const CryptoEdDSAUtil = require('../util/cryptoEdDSAUtil');
const ArgumentError = require('../util/argumentError');
const Transaction = require('../blockchain/transaction');

class TransactionBuilder {
    constructor() {
        this.listOfUTXO = null;
        this.outputAddresses = null;
        this.totalAmount = null;
        this.changeAddress = null;
        this.feeAmount = 0;
        this.secretKey = null;
        this.type = 'regular';
        this.studentId = null;//新增的学生id
        this.realWorldTime = null; // 新增：用于存储现实时间
        this.transactionId = CryptoUtil.randomId(64); // 生成交易ID
    }

    from(listOfUTXO) {
        this.listOfUTXO = listOfUTXO;
        return this;
    }

    to(address, amount) {
        this.outputAddress = address;
        this.totalAmount = amount;
        return this;
    }

    change(changeAddress) {
        this.changeAddress = changeAddress;
        return this;
    }

    fee(amount) {
        this.feeAmount = amount;
        return this;
    }

    sign(secretKey) {
        this.secretKey = secretKey;
        return this;
    }

    type(type) {
        this.type = type;
    }

    //新的设置学生id的函数
    setStudentId(studentId) {
        this.studentId = studentId;
        return this;
    }

    

    build() {
        // Check required information
        if (this.listOfUTXO == null) throw new ArgumentError('It\'s necessary to inform a list of unspent output transactions.');
        if (this.outputAddress == null) throw new ArgumentError('It\'s necessary to inform the destination address.');
        if (this.totalAmount == null) throw new ArgumentError('It\'s necessary to inform the transaction value.');

        // Calculates the change amount
        let totalAmountOfUTXO = R.sum(R.pluck('amount', this.listOfUTXO));
        let changeAmount = totalAmountOfUTXO - this.totalAmount - this.feeAmount;
        //计算当前时间
        const now = new Date();
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        this.realWorldTime = months[now.getMonth()] + ' ' + 
                     now.getDate() + ', ' + 
                     now.getFullYear() + ' ' + 
                     now.getHours().toString().padStart(2, '0') + ':' + 
                     now.getMinutes().toString().padStart(2, '0') + ':' + 
                     now.getSeconds().toString().padStart(2, '0');

        // For each transaction input, calculates the hash of the input and sign the data.
        let self = this;

        // 获取当前时间戳
        let currentTimestamp = Date.now();
        let inputs = R.map((utxo) => {
            let txiHash = CryptoUtil.hash({
                transaction: utxo.transaction,
                index: utxo.index,
                address: utxo.address,
                studentId: self.studentId,
                eventId: self.transactionId,
                timestamp: currentTimestamp
            });
        // let inputs = R.map((utxo) => {
        //     let txiHash = CryptoUtil.hash({
        //         transaction: utxo.transaction,
        //         index: utxo.index,
        //         address: utxo.address
        //     });

            utxo.signature = CryptoEdDSAUtil.signHash(CryptoEdDSAUtil.generateKeyPairFromSecret(self.secretKey), txiHash);
            //新增：
            utxo.studentId = self.studentId;
            utxo.eventId = self.transactionId;
            utxo.timestamp = currentTimestamp;
            utxo.realWorldTime = self.realWorldTime; // 新增：添加现实时间
    
            return utxo;
        }, this.listOfUTXO);

        let outputs = [];

        // Add target receiver
        outputs.push({
            amount: this.totalAmount,
            address: this.outputAddress
        });

        // Add change amount
        if (changeAmount > 0) {
            outputs.push({
                amount: changeAmount,
                address: this.changeAddress
            });
        } else {
            throw new ArgumentError('The sender does not have enough to pay for the transaction.');
        }        

        // The remaining value is the fee to be collected by the block's creator.        

        return Transaction.fromJson({
            //id: CryptoUtil.randomId(64),
            id: this.transactionId,
            hash: null,
            type: this.type,
            data: {
                inputs: inputs,
                outputs: outputs
            }
        });
    }
}

module.exports = TransactionBuilder;