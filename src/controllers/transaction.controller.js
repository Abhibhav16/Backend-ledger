const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailService = require("../services/email.service")
const mongoose = require("mongoose")
const logger = require("../utils/logger")
const userModel = require("../models/user.model")

/**
 * - Create a new transaction
 * THE 10-STEP TRANSFER FLOW (REFACTORED):
 * 1. Validate request
 * 2. Validate idempotency key
 * 3. Start MongoDB session & transaction
 * 4. Lock sender account (pessimistic update lock) and fetch recipient
 * 5. Check account status of both accounts
 * 6. Derive sender balance from ledger inside session
 * 7. Create transaction record (PENDING)
 * 8. Create DEBIT and CREDIT ledger entries
 * 9. Mark transaction COMPLETED and commit
 * 10. Send email notification asynchronously
 */
async function createTransaction(req, res) {
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body

    // 1. Validate request parameters
    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "FromAccount, toAccount, amount and idempotencyKey are required"
        })
    }

    // 2. Validate idempotency key
    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTransactionAlreadyExists) {
        if (isTransactionAlreadyExists.status === "COMPLETED") {
            return res.status(200).json({
                message: "Transaction already processed",
                transaction: isTransactionAlreadyExists
            })
        }
        if (isTransactionAlreadyExists.status === "PENDING") {
            return res.status(200).json({
                message: "Transaction is still processing"
            })
        }
        if (isTransactionAlreadyExists.status === "FAILED") {
            return res.status(500).json({
                message: "Transaction processing failed, please retry"
            })
        }
        if (isTransactionAlreadyExists.status === "REVERSED") {
            return res.status(500).json({
                message: "Transaction was reversed, please retry"
            })
        }
    }

    // 3. Start MongoDB session and transaction
    const session = await mongoose.startSession()
    session.startTransaction()

    try {
        // 4. Lock sender account (write-lock using findOneAndUpdate inside transaction)
                const fromUserAccount = await accountModel.findOneAndUpdate(
            { _id: fromAccount },
            { $set: { updatedAt: new Date() } },
            { session, returnDocument: "after" }
        )

        const toUserAccount = await accountModel.findOne({ _id: toAccount }).session(session)

        if (!fromUserAccount || !toUserAccount) {
            throw new Error("Invalid fromAccount or toAccount")
        }

        // 5. Check account status
        if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
            throw new Error("Both fromAccount and toAccount must be ACTIVE to process transaction")
        }

        // 6. Derive sender balance from ledger inside session
        const balance = await fromUserAccount.getBalance(session)

        if (balance < amount) {
            throw new Error(`Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`)
        }

        // 7. Create transaction (PENDING)
        const transaction = (await transactionModel.create([ {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey,
            status: "PENDING"
        } ], { session }))[ 0 ]

        // 8. Create DEBIT and CREDIT ledger entries
        await ledgerModel.create([ {
            account: fromAccount,
            amount: amount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        await ledgerModel.create([ {
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        // 9. Mark transaction COMPLETED
        transaction.status = "COMPLETED"
        await transaction.save({ session })

        await session.commitTransaction()
        session.endSession()

        // 10. Send email notification asynchronously
        emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toAccount)
            .catch(err => logger.error("Failed to send transaction email:", err))

        return res.status(201).json({
            message: "Transaction completed successfully",
            transaction: transaction
        })

    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }
        session.endSession()

        return res.status(400).json({
            message: error.message || "Transaction failed"
        })
    }
}

/**
 * - Create initial funds transaction from system user
 */
async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body

    // 1. Validate request
    if (!toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "toAccount, amount and idempotencyKey are required"
        })
    }

    // Check if system transaction already exists
    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTransactionAlreadyExists) {
        if (isTransactionAlreadyExists.status === "COMPLETED") {
            return res.status(200).json({
                message: "Initial funds transaction already processed",
                transaction: isTransactionAlreadyExists
            })
        }
        if (isTransactionAlreadyExists.status === "PENDING") {
            return res.status(200).json({
                message: "Initial funds transaction is still processing"
            })
        }
    }

    const fromUserAccount = await accountModel.findOne({
        user: req.user._id
    })

    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found"
        })
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
                const toUserAccount = await accountModel.findOneAndUpdate(
            { _id: toAccount },
            { $set: { updatedAt: new Date() } },
            { session, returnDocument: "after" }
        )

        if (!toUserAccount) {
            throw new Error("Invalid toAccount")
        }

        if (toUserAccount.status !== "ACTIVE") {
            throw new Error("Destination account must be ACTIVE to receive initial funds")
        }

        const transaction = new transactionModel({
            fromAccount: fromUserAccount._id,
            toAccount,
            amount,
            idempotencyKey,
            status: "PENDING"
        })

        await ledgerModel.create([ {
            account: fromUserAccount._id,
            amount: amount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        await ledgerModel.create([ {
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        transaction.status = "COMPLETED"
        await transaction.save({ session })

        await session.commitTransaction()
        session.endSession()

        return res.status(201).json({
            message: "Initial funds transaction completed successfully",
            transaction: transaction
        })
    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }
        session.endSession()

        return res.status(400).json({
            message: error.message || "Initial funds transaction failed"
        })
    }
}

/**
 * - Reverse a completed transaction
 */
async function reverseTransaction(req, res) {
    const { transactionId } = req.params

    const originalTransaction = await transactionModel.findById(transactionId)

    if (!originalTransaction) {
        return res.status(404).json({
            message: "Transaction not found"
        })
    }

    if (originalTransaction.status !== "COMPLETED") {
        return res.status(400).json({
            message: `Only completed transactions can be reversed. Current status is ${originalTransaction.status}`
        })
    }

    const fromUserAccount = await accountModel.findById(originalTransaction.fromAccount)
    const toUserAccount = await accountModel.findById(originalTransaction.toAccount)

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "One or both accounts associated with this transaction no longer exist"
        })
    }

    // Authorization: User must be the owner of the sending account, or a system user
    const userWithSystemField = await userModel.findById(req.user._id).select("+systemUser")
    const isOwner = fromUserAccount.user.toString() === req.user._id.toString()
    const isSystemUser = userWithSystemField && userWithSystemField.systemUser === true

    if (!isOwner && !isSystemUser) {
        return res.status(403).json({
            message: "Forbidden: You are not authorized to reverse this transaction"
        })
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
        // Lock both accounts to prevent race conditions during reversal
        const lockedFromAccount = await accountModel.findOneAndUpdate(
            { _id: originalTransaction.fromAccount },
            { $set: { updatedAt: new Date() } },
            { session, returnDocument: "after" }
        )

        const lockedToAccount = await accountModel.findOneAndUpdate(
            { _id: originalTransaction.toAccount },
            { $set: { updatedAt: new Date() } },
            { session, returnDocument: "after" }
        )

        if (!lockedFromAccount || !lockedToAccount) {
            throw new Error("Accounts not found during locking")
        }

        if (lockedFromAccount.status !== "ACTIVE" || lockedToAccount.status !== "ACTIVE") {
            throw new Error("Both accounts must be ACTIVE to perform a transaction reversal")
        }

        // Verify original recipient (lockedToAccount) has enough balance to refund the money
        const recipientBalance = await lockedToAccount.getBalance(session)
        if (recipientBalance < originalTransaction.amount) {
            throw new Error(`Insufficient funds in recipient account to reverse this transaction. Current balance: ${recipientBalance}`)
        }

        // Create new reversing transaction record
        const reversalKey = `reverse-${originalTransaction.idempotencyKey}`
        const reversalTransaction = (await transactionModel.create([ {
            fromAccount: originalTransaction.toAccount, // Swapped!
            toAccount: originalTransaction.fromAccount, // Swapped!
            amount: originalTransaction.amount,
            idempotencyKey: reversalKey,
            status: "PENDING"
        } ], { session }))[0]

        // Create DEBIT on recipient (original toAccount)
        await ledgerModel.create([ {
            account: originalTransaction.toAccount,
            amount: originalTransaction.amount,
            transaction: reversalTransaction._id,
            type: "DEBIT"
        } ], { session })

        // Create CREDIT on sender (original fromAccount)
        await ledgerModel.create([ {
            account: originalTransaction.fromAccount,
            amount: originalTransaction.amount,
            transaction: reversalTransaction._id,
            type: "CREDIT"
        } ], { session })

        // Mark reversal transaction COMPLETED
        reversalTransaction.status = "COMPLETED"
        await reversalTransaction.save({ session })

        // Mark original transaction as REVERSED
        originalTransaction.status = "REVERSED"
        await originalTransaction.save({ session })

        await session.commitTransaction()
        session.endSession()

        return res.status(201).json({
            message: "Transaction reversed successfully",
            reversalTransaction,
            originalTransaction
        })

    } catch (error) {
        if (session.inTransaction()) {
            await session.abortTransaction()
        }
        session.endSession()
        return res.status(400).json({
            message: error.message || "Reversal failed"
        })
    }
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction,
    reverseTransaction
}
