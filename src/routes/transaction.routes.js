const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const transactionController = require("../controllers/transaction.controller")
const { validateBody } = require("../middleware/validation.middleware")
const { createTransactionSchema, createInitialFundsSchema } = require("../validation/schemas")

const transactionRoutes = Router();

/**
 * @openapi
 * /api/transactions:
 *   post:
 *     summary: Create a standard peer-to-peer transfer
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromAccount
 *               - toAccount
 *               - amount
 *               - idempotencyKey
 *             properties:
 *               fromAccount:
 *                 type: string
 *                 example: 60d0fe4f5311236168a109ca
 *               toAccount:
 *                 type: string
 *                 example: 60d0fe4f5311236168a109cb
 *               amount:
 *                 type: number
 *                 example: 1500.00
 *               idempotencyKey:
 *                 type: string
 *                 example: unique-uuid-or-nanoid
 *     responses:
 *       201:
 *         description: Transaction completed successfully
 *       400:
 *         description: Insufficient funds or invalid parameters
 *       401:
 *         description: Unauthorized
 */
transactionRoutes.post("/", authMiddleware.authMiddleware, validateBody(createTransactionSchema), transactionController.createTransaction)

/**
 * @openapi
 * /api/transactions/system/initial-funds:
 *   post:
 *     summary: Distribute initial seeding funds (System User Only)
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - toAccount
 *               - amount
 *               - idempotencyKey
 *             properties:
 *               toAccount:
 *                 type: string
 *                 example: 60d0fe4f5311236168a109cb
 *               amount:
 *                 type: number
 *                 example: 10000.00
 *               idempotencyKey:
 *                 type: string
 *                 example: init-seed-key-1
 *     responses:
 *       201:
 *         description: Initial funds seeded successfully
 *       400:
 *         description: Invalid parameter or system account error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not a system user)
 */
transactionRoutes.post("/system/initial-funds", authMiddleware.authSystemUserMiddleware, validateBody(createInitialFundsSchema), transactionController.createInitialFundsTransaction)

/**
 * @openapi
 * /api/transactions/{transactionId}/reverse:
 *   post:
 *     summary: Reverse a completed transaction
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         example: 60d0fe4f5311236168a109cc
 *     responses:
 *       201:
 *         description: Transaction reversed successfully
 *       400:
 *         description: Insufficient funds or invalid transaction state
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Not authorized to reverse this transaction)
 */
transactionRoutes.post("/:transactionId/reverse", authMiddleware.authMiddleware, transactionController.reverseTransaction)

module.exports = transactionRoutes;