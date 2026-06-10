const { createLogger, format, transports } = require("winston");

const logFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});

const logger = createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.metadata({ fillExcept: ["message", "level", "timestamp"] })
    ),
    transports: [
        new transports.Console({
            format: process.env.NODE_ENV === "production"
                ? format.json()
                : format.combine(
                    format.colorize(),
                    logFormat
                )
        })
    ]
});

module.exports = logger;
