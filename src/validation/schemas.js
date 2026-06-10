const { z } = require("zod");

// Helper to validate MongoDB ObjectId
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
    message: "Invalid account ID format (must be a 24-character hex string)"
});

const registerSchema = z.object({
    email: z.string({
        required_error: "Email is required"
    }).email({ message: "Invalid email address" }),
    name: z.string({
        required_error: "Name is required"
    }).min(2, { message: "Name must be at least 2 characters long" }).max(50),
    password: z.string({
        required_error: "Password is required"
    }).min(6, { message: "Password must be at least 6 characters long" })
});

const loginSchema = z.object({
    email: z.string({
        required_error: "Email is required"
    }).email({ message: "Invalid email address" }),
    password: z.string({
        required_error: "Password is required"
    }).min(1, { message: "Password is required" })
});

const createAccountSchema = z.object({
    currency: z.string().length(3, { message: "Currency code must be exactly 3 characters (e.g., INR, USD)" }).optional().default("INR")
}).optional();

const createTransactionSchema = z.object({
    fromAccount: objectIdSchema,
    toAccount: objectIdSchema,
    amount: z.number({
        required_error: "Amount is required"
    }).positive({ message: "Amount must be a positive number greater than 0" }),
    idempotencyKey: z.string({
        required_error: "Idempotency key is required"
    }).min(1, { message: "Idempotency key cannot be empty" })
});

const createInitialFundsSchema = z.object({
    toAccount: objectIdSchema,
    amount: z.number({
        required_error: "Amount is required"
    }).positive({ message: "Amount must be a positive number greater than 0" }),
    idempotencyKey: z.string({
        required_error: "Idempotency key is required"
    }).min(1, { message: "Idempotency key cannot be empty" })
});

module.exports = {
    registerSchema,
    loginSchema,
    createAccountSchema,
    createTransactionSchema,
    createInitialFundsSchema
};
