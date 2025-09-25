const jwt = require('jsonwebtoken');

// Generate JWT Token
const generateToken = (userId, role = 'student') => {
    return jwt.sign(
        { userId, role },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
    );
};

// Generate OTP (6 digit)
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Verify JWT Token
const verifyToken = (token) => {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        throw new Error('Invalid token');
    }
};

module.exports = {
    generateToken,
    generateOTP,
    verifyToken
};