/**
 * Sentry Error Tracking Service
 * Provides production error monitoring and alerting
 */

const Sentry = require('@sentry/node');
const logger = require('./logger');

/**
 * Initialize Sentry for request tracking
 * Call this BEFORE other middleware
 */
function initSentry(app) {
    if (!process.env.SENTRY_DSN) {
        logger.info('Sentry DSN not configured - error tracking disabled');
        return;
    }

    try {
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV || 'development',

            // Performance monitoring
            tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,

            // Profiling (optional)
            profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE) || 0.0,

            integrations: [
                // HTTP integration
                new Sentry.Integrations.Http({ tracing: true }),

                // Express integration
                new Sentry.Integrations.Express({ app })
            ],

            // Filter sensitive data
            beforeSend(event, hint) {
                // Remove sensitive headers
                if (event.request?.headers) {
                    delete event.request.headers.authorization;
                    delete event.request.headers.cookie;
                }

                // Remove sensitive body data
                if (event.request?.data) {
                    const data = event.request.data;
                    if (typeof data === 'object') {
                        delete data.password;
                        delete data.password_hash;
                        delete data.token;
                        delete data.secret;
                    }
                }

                return event;
            },

            // Ignore certain errors
            ignoreErrors: [
                // Client disconnection errors
                'ECONNRESET',
                'EPIPE',
                'ETIMEDOUT',

                // Validation errors (expected)
                'Validation Error',

                // Authentication errors (expected)
                'Unauthorized',
                'Invalid token'
            ]
        });

        // Request handler - must be first middleware
        app.use(Sentry.Handlers.requestHandler());

        // Tracing handler - for performance monitoring
        app.use(Sentry.Handlers.tracingHandler());

        logger.info('Sentry error tracking initialized', {
            environment: process.env.NODE_ENV,
            tracesSampleRate: Sentry.getCurrentHub().getClient()?.getOptions().tracesSampleRate
        });

    } catch (error) {
        logger.error('Failed to initialize Sentry:', error);
    }
}

/**
 * Initialize Sentry error handler
 * Call this AFTER all routes but BEFORE other error handlers
 */
function initSentryErrorHandler(app) {
    if (!process.env.SENTRY_DSN) {
        return;
    }

    try {
        // Error handler - must be before other error middleware
        app.use(Sentry.Handlers.errorHandler({
            shouldHandleError(error) {
                // Only send errors with status >= 500 to Sentry
                // This filters out 4xx client errors
                if (error.status && error.status < 500) {
                    return false;
                }
                return true;
            }
        }));

        logger.info('Sentry error handler initialized');
    } catch (error) {
        logger.error('Failed to initialize Sentry error handler:', error);
    }
}

/**
 * Manually capture an exception
 */
function captureException(error, context = {}) {
    if (!process.env.SENTRY_DSN) {
        logger.error('Error (Sentry disabled):', error);
        return;
    }

    Sentry.captureException(error, {
        contexts: {
            custom: context
        }
    });
}

/**
 * Manually capture a message
 */
function captureMessage(message, level = 'info', context = {}) {
    if (!process.env.SENTRY_DSN) {
        logger[level](message, context);
        return;
    }

    Sentry.captureMessage(message, {
        level,
        contexts: {
            custom: context
        }
    });
}

/**
 * Set user context for error tracking
 */
function setUser(user) {
    if (!process.env.SENTRY_DSN) {
        return;
    }

    if (!user) {
        Sentry.setUser(null);
        return;
    }

    Sentry.setUser({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
    });
}

/**
 * Add breadcrumb for debugging
 */
function addBreadcrumb(category, message, data = {}, level = 'info') {
    if (!process.env.SENTRY_DSN) {
        return;
    }

    Sentry.addBreadcrumb({
        category,
        message,
        data,
        level
    });
}

/**
 * Create a transaction for performance monitoring
 */
function startTransaction(name, op) {
    if (!process.env.SENTRY_DSN) {
        return null;
    }

    return Sentry.startTransaction({
        name,
        op
    });
}

module.exports = {
    initSentry,
    initSentryErrorHandler,
    captureException,
    captureMessage,
    setUser,
    addBreadcrumb,
    startTransaction
};
