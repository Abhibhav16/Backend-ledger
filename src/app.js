const express = require("express")
const cookieParser = require("cookie-parser")
const setupSwagger = require("./config/swagger")



const app = express()


app.use(express.json())
app.use(cookieParser())

// Initialize Swagger Documentation
setupSwagger(app)

/**
 * - Routes required
 */
const authRouter = require("./routes/auth.routes")
const accountRouter = require("./routes/account.routes")
const transactionRoutes = require("./routes/transaction.routes")

/**
 * - Use Routes
 */

app.get("/", (req, res) => {
    res.send("Ledger Service is up and running, Also make sure it is backend focused and not frontend focused, so no need to worry about CORS or anything like that, just focus on the backend logic and functionality.")
})

app.use("/api/auth", authRouter)
app.use("/api/accounts", accountRouter)
app.use("/api/transactions", transactionRoutes)

module.exports = app