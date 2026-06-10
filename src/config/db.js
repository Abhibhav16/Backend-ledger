const mongoose = require("mongoose")
const logger = require("../utils/logger")


function connectToDB() {

    mongoose.connect(process.env.MONGO_URI)
        .then(() => {
            logger.info("Server is connected to DB")
        })
        .catch(err => {
            logger.error("Error connecting to DB:", err)
            process.exit(1)
        })

}


module.exports = connectToDB