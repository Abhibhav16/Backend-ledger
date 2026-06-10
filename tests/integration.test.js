const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const app = require("../src/app");
const userModel = require("../src/models/user.model");
const accountModel = require("../src/models/account.model");
const transactionModel = require("../src/models/transaction.model");
const ledgerModel = require("../src/models/ledger.model");

let mongoServer;
let user1Token;
let user2Token;
let systemToken;
let user1Id;
let user2Id;
let systemUserId;

let user1Account1;
let user1Account2;
let user2Account1;
let systemAccount;

beforeAll(async () => {
    // 1. Setup MongoMemoryReplSet for testing transactions
    mongoServer = await MongoMemoryReplSet.create({
        replSet: {
            count: 1,
            storageEngine: "wiredTiger"
        }
    });
    const mongoUri = mongoServer.getUri();

    // Set JWT SECRET environment variable if not already set
    process.env.JWT_SECRET = "test-secret-key-12345";
    process.env.NODE_ENV = "test";

    // Connect mongoose
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    await mongoose.connect(mongoUri);
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
});

describe("Backend Ledger Integration Test Suite", () => {
    
    // Clear database collections between tests if needed, but here we run sequentially
    it("should register two users and one system user", async () => {
        // Register User 1
        const res1 = await request(app)
            .post("/api/auth/register")
            .send({
                email: "user1@example.com",
                name: "User One",
                password: "password123"
            });
        expect(res1.statusCode).toBe(201);
        expect(res1.body).toHaveProperty("token");
        user1Token = res1.body.token;
        user1Id = res1.body.user._id;

        // Register User 2
        const res2 = await request(app)
            .post("/api/auth/register")
            .send({
                email: "user2@example.com",
                name: "User Two",
                password: "password123"
            });
        expect(res2.statusCode).toBe(201);
        user2Token = res2.body.token;
        user2Id = res2.body.user._id;

        // Register/Create a System User manually since systemUser flag is immutable in schema
        // and defaults to false. We will create it via database directly or log in.
        const systemUser = new userModel({
            email: "system@ledger.com",
            name: "System Ledger",
            password: "systemPassword123"
        });
        // We set systemUser directly using private mongoose bypassing immutability if needed,
        // or since it is immutable on update, set it on creation:
        systemUser.set("systemUser", true);
        await systemUser.save();
        systemUserId = systemUser._id;

        // Login as System User to get token
        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: "system@ledger.com",
                password: "systemPassword123"
            });
        expect(loginRes.statusCode).toBe(200);
        systemToken = loginRes.body.token;
    });

    it("should fail registration if validation fails", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .send({
                email: "invalid-email",
                name: "U",
                password: "123"
            });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe("Validation failed");
        expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it("should create accounts for users", async () => {
        // Create User 1 Account 1
        const acc1 = await request(app)
            .post("/api/accounts")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({ currency: "INR" });
        expect(acc1.statusCode).toBe(201);
        user1Account1 = acc1.body.account._id;

        // Create User 1 Account 2
        const acc2 = await request(app)
            .post("/api/accounts")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({ currency: "USD" });
        expect(acc2.statusCode).toBe(201);
        user1Account2 = acc2.body.account._id;

        // Create User 2 Account 1
        const acc3 = await request(app)
            .post("/api/accounts")
            .set("Authorization", `Bearer ${user2Token}`)
            .send(); // should default to INR
        expect(acc3.statusCode).toBe(201);
        expect(acc3.body.account.currency).toBe("INR");
        user2Account1 = acc3.body.account._id;

        // Create System User Account directly so we have a source of funds
        const sysAcc = await accountModel.create({
            user: systemUserId,
            currency: "INR"
        });
        systemAccount = sysAcc._id;
    });

    it("should show balance as 0 for new accounts", async () => {
        const res = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.balance).toBe(0);
    });

    it("should distribute initial funds via system endpoint", async () => {
        const res = await request(app)
            .post("/api/transactions/system/initial-funds")
            .set("Authorization", `Bearer ${systemToken}`)
            .send({
                toAccount: user1Account1,
                amount: 10000,
                idempotencyKey: "init-key-user1-1"
            });
        expect(res.statusCode).toBe(201);
        expect(res.body.transaction.status).toBe("COMPLETED");

        // Verify balance of user1 account 1 is 10000
        const balRes = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(balRes.body.balance).toBe(10000);
    });

    it("should prevent duplicate processing via idempotency key", async () => {
        // Submit the exact same initial funds request
        const res = await request(app)
            .post("/api/transactions/system/initial-funds")
            .set("Authorization", `Bearer ${systemToken}`)
            .send({
                toAccount: user1Account1,
                amount: 10000,
                idempotencyKey: "init-key-user1-1"
            });
        expect(res.statusCode).toBe(200);
        expect(res.body.message).toBe("Initial funds transaction already processed");
        expect(res.body.transaction.status).toBe("COMPLETED");

        // Balance should still be 10000
        const balRes = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(balRes.body.balance).toBe(10000);
    });

    it("should successfully transfer funds between users", async () => {
        const res = await request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({
                fromAccount: user1Account1,
                toAccount: user2Account1,
                amount: 3000,
                idempotencyKey: "tx-key-1"
            });
        expect(res.statusCode).toBe(201);
        expect(res.body.transaction.status).toBe("COMPLETED");

        // Check balances
        const bal1 = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(bal1.body.balance).toBe(7000);

        const bal2 = await request(app)
            .get(`/api/accounts/balance/${user2Account1}`)
            .set("Authorization", `Bearer ${user2Token}`);
        expect(bal2.body.balance).toBe(3000);
    });

    it("should fail transfer if balance is insufficient", async () => {
        const res = await request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({
                fromAccount: user1Account1,
                toAccount: user2Account1,
                amount: 9000, // exceeds 7000
                idempotencyKey: "tx-key-insufficient"
            });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain("Insufficient balance");
    });

    it("should prevent double-spending in concurrent transfer requests", async () => {
        // User 1 has 7000. Let's send two concurrent requests for 4000 each.
        // Combined (8000) exceeds balance, but individually they are valid.
        // A naive non-locking setup would allow both to pass.
        
        const req1 = request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({
                fromAccount: user1Account1,
                toAccount: user2Account1,
                amount: 4000,
                idempotencyKey: "tx-key-concurrent-1"
            });

        const req2 = request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({
                fromAccount: user1Account1,
                toAccount: user2Account1,
                amount: 4000,
                idempotencyKey: "tx-key-concurrent-2"
            });

        // Trigger concurrently
        const [res1, res2] = await Promise.all([req1, req2]);

        // One must succeed (201) and one must fail (400)
        const statusCodes = [res1.statusCode, res2.statusCode];
        expect(statusCodes).toContain(201);
        expect(statusCodes).toContain(400);

        // Verify balance is exactly 3000 (7000 - 4000)
        const bal1 = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(bal1.body.balance).toBe(3000);

        const bal2 = await request(app)
            .get(`/api/accounts/balance/${user2Account1}`)
            .set("Authorization", `Bearer ${user2Token}`);
        expect(bal2.body.balance).toBe(7000); // 3000 + 4000
    });

    it("should successfully reverse a completed transaction", async () => {
        // Find a completed transaction. The one from the previous test is "tx-key-1"
        const tx = await transactionModel.findOne({ idempotencyKey: "tx-key-1" });
        expect(tx).toBeDefined();
        expect(tx.status).toBe("COMPLETED");

        // User 1 (owner of original fromAccount) initiates the reversal
        const res = await request(app)
            .post(`/api/transactions/${tx._id}/reverse`)
            .set("Authorization", `Bearer ${user1Token}`);
        
        expect(res.statusCode).toBe(201);
        expect(res.body.originalTransaction.status).toBe("REVERSED");
        expect(res.body.reversalTransaction.status).toBe("COMPLETED");

        // Check balances: User 1 account should go back from 3000 to 6000 (3000 + 3000)
        // User 2 account should go down from 7000 to 4000 (7000 - 3000)
        const bal1 = await request(app)
            .get(`/api/accounts/balance/${user1Account1}`)
            .set("Authorization", `Bearer ${user1Token}`);
        expect(bal1.body.balance).toBe(6000);

        const bal2 = await request(app)
            .get(`/api/accounts/balance/${user2Account1}`)
            .set("Authorization", `Bearer ${user2Token}`);
        expect(bal2.body.balance).toBe(4000);
    });

    it("should prevent unauthorized users from reversing a transaction", async () => {
        const tx = await transactionModel.findOne({ idempotencyKey: "init-key-user1-1" });
        expect(tx).toBeDefined();

        // User 2 tries to reverse system initial funds transaction (neither owner nor system user)
        const res = await request(app)
            .post(`/api/transactions/${tx._id}/reverse`)
            .set("Authorization", `Bearer ${user2Token}`);
        
        expect(res.statusCode).toBe(403);
        expect(res.body.message).toContain("Forbidden");
    });

    it("should fail to reverse if recipient has insufficient funds", async () => {
        // User 1 transfers 5000 to User 2. User 2 spends all of it, leaving them with 0.
        // Then User 1 tries to reverse, which should fail due to insufficient funds.
        
        // 1. Transfer 5000 from User 1 (bal 6000) to User 2 (bal 4000)
        const txRes = await request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user1Token}`)
            .send({
                fromAccount: user1Account1,
                toAccount: user2Account1,
                amount: 5000,
                idempotencyKey: "tx-key-for-reversal-fail"
            });
        expect(txRes.statusCode).toBe(201);
        const txId = txRes.body.transaction._id;

        // Balances: User 1 = 1000, User 2 = 9000
        
        // 2. User 2 transfers 8500 to User 1 (or another account), leaving User 2 with 500
        const drainRes = await request(app)
            .post("/api/transactions")
            .set("Authorization", `Bearer ${user2Token}`)
            .send({
                fromAccount: user2Account1,
                toAccount: user1Account1,
                amount: 8500,
                idempotencyKey: "tx-key-drain"
            });
        expect(drainRes.statusCode).toBe(201);

        // Balances: User 2 = 500 (9000 - 8500). User 1 = 9500 (1000 + 8500).
        
        // 3. User 1 tries to reverse the first transaction (5000).
        // Since User 2 only has 500 left, this should fail because we cannot debit 5000 from User 2's account.
        const revRes = await request(app)
            .post(`/api/transactions/${txId}/reverse`)
            .set("Authorization", `Bearer ${user1Token}`);

        expect(revRes.statusCode).toBe(400);
        expect(revRes.body.message).toContain("Insufficient funds in recipient account");
    });

});
