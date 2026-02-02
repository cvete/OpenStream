/**
 * Input Validation Middleware
 * Provides reusable validation rules and error handling
 */

const { body, query, param, validationResult } = require('express-validator');

/**
 * Handle validation errors
 * Returns standardized error response
 */
function handleValidationErrors(req, res, next) {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid input data',
            details: errors.array().map(err => ({
                field: err.path || err.param,
                message: err.msg,
                value: err.value,
                location: err.location
            }))
        });
    }

    next();
}

/**
 * Pagination validation
 * Validates page and limit query parameters
 */
function validatePagination() {
    return [
        query('page')
            .optional()
            .isInt({ min: 1, max: 10000 })
            .withMessage('Page must be between 1 and 10000')
            .toInt(),
        query('limit')
            .optional()
            .isInt({ min: 1, max: 100 })
            .withMessage('Limit must be between 1 and 100')
            .toInt()
    ];
}

/**
 * Stream key validation
 * Validates stream key format (alphanumeric, 20-32 characters)
 */
function validateStreamKey(paramName = 'streamKey') {
    return param(paramName)
        .isAlphanumeric()
        .withMessage('Stream key must be alphanumeric')
        .isLength({ min: 20, max: 32 })
        .withMessage('Stream key must be between 20 and 32 characters');
}

/**
 * Stream ID validation
 */
function validateStreamId(paramName = 'id') {
    return param(paramName)
        .isInt({ min: 1 })
        .withMessage('Stream ID must be a positive integer')
        .toInt();
}

/**
 * User ID validation
 */
function validateUserId(paramName = 'userId') {
    return param(paramName)
        .isInt({ min: 1 })
        .withMessage('User ID must be a positive integer')
        .toInt();
}

/**
 * Email validation
 */
function validateEmail(fieldName = 'email') {
    return body(fieldName)
        .trim()
        .isEmail()
        .withMessage('Must be a valid email address')
        .normalizeEmail()
        .isLength({ max: 255 })
        .withMessage('Email must be less than 255 characters');
}

/**
 * Username validation
 */
function validateUsername(fieldName = 'username') {
    return body(fieldName)
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Username must be between 3 and 50 characters')
        .matches(/^[a-zA-Z0-9_-]+$/)
        .withMessage('Username can only contain letters, numbers, underscores, and hyphens');
}

/**
 * Password validation
 */
function validatePassword(fieldName = 'password') {
    return body(fieldName)
        .isLength({ min: 8, max: 128 })
        .withMessage('Password must be between 8 and 128 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number');
}

/**
 * Optional password validation (for updates)
 */
function validateOptionalPassword(fieldName = 'password') {
    return body(fieldName)
        .optional()
        .isLength({ min: 8, max: 128 })
        .withMessage('Password must be between 8 and 128 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number');
}

/**
 * Domain validation
 */
function validateDomain(fieldName = 'domain') {
    return body(fieldName)
        .trim()
        .matches(/^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/)
        .withMessage('Invalid domain format. Use format: example.com or *.example.com for wildcards')
        .isLength({ max: 253 })
        .withMessage('Domain must be less than 253 characters');
}

/**
 * URL validation
 */
function validateUrl(fieldName = 'url') {
    return body(fieldName)
        .trim()
        .isURL({ protocols: ['http', 'https'], require_protocol: true })
        .withMessage('Must be a valid HTTP or HTTPS URL')
        .isLength({ max: 2048 })
        .withMessage('URL must be less than 2048 characters');
}

/**
 * Date validation (ISO 8601)
 */
function validateDate(fieldName, options = {}) {
    const validator = options.location === 'query' ? query(fieldName) : body(fieldName);

    return validator
        .optional()
        .isISO8601()
        .withMessage('Must be a valid ISO 8601 date')
        .toDate();
}

/**
 * Date range validation
 */
function validateDateRange() {
    return [
        validateDate('startDate', { location: 'query' }),
        validateDate('endDate', { location: 'query' }),
        query('startDate')
            .optional()
            .custom((value, { req }) => {
                if (req.query.endDate && new Date(value) > new Date(req.query.endDate)) {
                    throw new Error('Start date must be before end date');
                }
                return true;
            })
    ];
}

/**
 * Stream name validation
 */
function validateStreamName(fieldName = 'name') {
    return body(fieldName)
        .trim()
        .notEmpty()
        .withMessage('Stream name is required')
        .isLength({ min: 1, max: 255 })
        .withMessage('Stream name must be between 1 and 255 characters');
}

/**
 * Stream description validation (optional)
 */
function validateStreamDescription(fieldName = 'description') {
    return body(fieldName)
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Description must be less than 1000 characters');
}

/**
 * Enum validation
 */
function validateEnum(fieldName, allowedValues, location = 'body') {
    const validator = location === 'query' ? query(fieldName) : body(fieldName);

    return validator
        .optional()
        .isIn(allowedValues)
        .withMessage(`Must be one of: ${allowedValues.join(', ')}`);
}

/**
 * Boolean validation
 */
function validateBoolean(fieldName, location = 'body') {
    const validator = location === 'query' ? query(fieldName) : body(fieldName);

    return validator
        .optional()
        .isBoolean()
        .withMessage('Must be a boolean value (true or false)')
        .toBoolean();
}

/**
 * Integer validation
 */
function validateInteger(fieldName, min = null, max = null, location = 'body') {
    const validator = location === 'query' ? query(fieldName) : body(fieldName);

    let chain = validator.optional().isInt();

    if (min !== null && max !== null) {
        chain = chain.isInt({ min, max }).withMessage(`Must be an integer between ${min} and ${max}`);
    } else if (min !== null) {
        chain = chain.isInt({ min }).withMessage(`Must be an integer >= ${min}`);
    } else if (max !== null) {
        chain = chain.isInt({ max }).withMessage(`Must be an integer <= ${max}`);
    }

    return chain.toInt();
}

/**
 * IP address validation
 */
function validateIpAddress(fieldName = 'ip') {
    return body(fieldName)
        .trim()
        .isIP()
        .withMessage('Must be a valid IP address (IPv4 or IPv6)');
}

/**
 * Array validation
 */
function validateArray(fieldName, itemValidator = null) {
    return body(fieldName)
        .optional()
        .isArray()
        .withMessage('Must be an array')
        .custom((value) => {
            if (itemValidator && Array.isArray(value)) {
                value.forEach(item => {
                    if (!itemValidator(item)) {
                        throw new Error('Invalid array item');
                    }
                });
            }
            return true;
        });
}

/**
 * Sanitize HTML input (prevent XSS)
 */
function sanitizeHtml(fieldName) {
    return body(fieldName)
        .trim()
        .escape();
}

/**
 * Validate JSON field
 */
function validateJson(fieldName) {
    return body(fieldName)
        .optional()
        .custom((value) => {
            try {
                if (typeof value === 'string') {
                    JSON.parse(value);
                }
                return true;
            } catch (e) {
                throw new Error('Must be valid JSON');
            }
        });
}

module.exports = {
    handleValidationErrors,
    validatePagination,
    validateStreamKey,
    validateStreamId,
    validateUserId,
    validateEmail,
    validateUsername,
    validatePassword,
    validateOptionalPassword,
    validateDomain,
    validateUrl,
    validateDate,
    validateDateRange,
    validateStreamName,
    validateStreamDescription,
    validateEnum,
    validateBoolean,
    validateInteger,
    validateIpAddress,
    validateArray,
    sanitizeHtml,
    validateJson
};
