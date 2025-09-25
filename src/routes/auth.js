const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');

const {
    sendOTPController,
    verifyOTPController
} = require('../controllers/authController');

// Rate limiting for OTP requests (3 attempts per 15 minutes)
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 requests per window per IP
    message: {
        success: false,
        message: 'Too many OTP requests. Try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Validation rules
const sendOTPValidation = [
    body('mobile')
        .matches(/^01[3-9]\d{8}$/)
        .withMessage('Please provide a valid Bangladeshi mobile number (e.g., 01700000000)')
];

const verifyOTPValidation = [
    body('mobile')
        .matches(/^01[3-9]\d{8}$/)
        .withMessage('Please provide a valid Bangladeshi mobile number'),
    body('otp')
        .isLength({ min: 6, max: 6 })
        .withMessage('OTP must be exactly 6 digits')
        .isNumeric()
        .withMessage('OTP must contain only numbers')
];

// Routes
router.post('/send-otp', otpLimiter, sendOTPValidation, sendOTPController);
router.post('/verify-otp', verifyOTPValidation, verifyOTPController);

module.exports = router;