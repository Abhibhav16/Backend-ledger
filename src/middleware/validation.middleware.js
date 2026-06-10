const { ZodError } = require("zod");

/**
 * Middleware to validate request bodies against a Zod schema.
 */
const validateBody = (schema) => (req, res, next) => {
    try {
        req.body = schema.parse(req.body);
        next();
    } catch (error) {
        if (error instanceof ZodError) {
            const errs = error.errors || error.issues || [];
            return res.status(400).json({
                status: "failed",
                message: "Validation failed",
                errors: errs.map(err => ({
                    field: err.path.join('.'),
                    message: err.message
                }))
            });
        }
        next(error);
    }
};

module.exports = {
    validateBody
};
