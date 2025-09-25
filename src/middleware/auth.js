const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Verify JWT Token Middleware
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access token required. Please provide Bearer token in headers.'
            });
        }
        
        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Get user details from database
        const [users] = await pool.execute(
            'SELECT id, mobile, name, email, role, is_verified, is_active FROM users WHERE id = ?',
            [decoded.userId]
        );
        
        if (!users.length) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        
        if (!user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'User account is deactivated'
            });
        }
        
        if (!user.is_verified) {
            return res.status(401).json({
                success: false,
                message: 'User account is not verified'
            });
        }
        
        // Add user info to request object
        req.user = user;
        next();
        
    } catch (error) {
        console.error('Token verification error:', error);
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired. Please login again.'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token. Please login again.'
            });
        }
        
        return res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
};

// Role-based Authorization Middleware
const authorizeRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Access forbidden. Required role: ${allowedRoles.join(' or ')}`
            });
        }
        
        next();
    };
};

// Optional Authentication (for routes that work both with and without auth)
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const [users] = await pool.execute(
                'SELECT id, mobile, name, email, role, is_verified, is_active FROM users WHERE id = ?',
                [decoded.userId]
            );
            
            if (users.length && users[0].is_active && users[0].is_verified) {
                req.user = users[0];
            }
        }
        
        next();
    } catch (error) {
        // Continue without authentication
        next();
    }
};

module.exports = {
    authenticateToken,
    authorizeRole,
    optionalAuth
};