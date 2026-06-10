const express = require("express")
const authMiddleware = require("../middleware/auth.middleware")
const accountController = require("../controllers/account.controller")
const { validateBody } = require("../middleware/validation.middleware")
const { createAccountSchema } = require("../validation/schemas")

const router = express.Router()

/**
 * @openapi
 * /api/accounts:
 *   post:
 *     summary: Create a new account
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               currency:
 *                 type: string
 *                 default: INR
 *                 example: INR
 *     responses:
 *       201:
 *         description: Account created successfully
 *       401:
 *         description: Unauthorized
 */
router.post("/", authMiddleware.authMiddleware, validateBody(createAccountSchema), accountController.createAccountController)

/**
 * @openapi
 * /api/accounts:
 *   get:
 *     summary: Get all accounts of the logged-in user
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Accounts list retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get("/", authMiddleware.authMiddleware, accountController.getUserAccountsController)

/**
 * @openapi
 * /api/accounts/balance/{accountId}:
 *   get:
 *     summary: Get balance of a specific account
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: 60d0fe4f5311236168a109ca
 *     responses:
 *       200:
 *         description: Balance data retrieved successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Account not found
 */
router.get("/balance/:accountId", authMiddleware.authMiddleware, accountController.getAccountBalanceController)

module.exports = router