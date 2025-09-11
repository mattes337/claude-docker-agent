// 404 Not Found handler
const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

// Global error handler
const errorHandler = (err, req, res, next) => {
    // Set default error status if not already set
    let statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    let message = err.message;

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation Error';
    } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid ID format';
    } else if (err.code === 'ENOENT') {
        statusCode = 404;
        message = 'Resource not found';
    } else if (err.code === 'EACCES') {
        statusCode = 403;
        message = 'Permission denied';
    } else if (err.code === 'EEXIST') {
        statusCode = 409;
        message = 'Resource already exists';
    }

    // Log error details (in production, use proper logging)
    console.error(`Error ${statusCode}: ${message}`);
    if (process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    // Send error response
    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = {
    notFound,
    errorHandler
};
