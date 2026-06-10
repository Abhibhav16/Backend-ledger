require("dotenv").config()

const app = require("./src/app")
const connectToDB = require("./src/config/db")
const logger = require("./src/utils/logger")

connectToDB()

app.listen(3000, () => {
    logger.info("Server is running on port 3000")
})