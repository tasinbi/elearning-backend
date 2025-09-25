const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
    getPaymentMethods,
    initiatePayment,
    sslSuccess,
    sslFail,
    sslCancel,
    getUserEnrollments,
    checkEnrollmentStatus
} = require('../controllers/paymentController');

const { authenticateToken } = require('../middleware/auth');

// Validation rules
const initiatePaymentValidation = [
    body('courseId')
        .isInt({ min: 1 })
        .withMessage('Valid course ID is required'),
    body('paymentMethod')
        .optional()
        .isIn(['sslcommerz', 'bkash', 'nagad', 'rocket'])
        .withMessage('Invalid payment method')
];

const enrollmentStatusValidation = [
    param('courseId')
        .isInt({ min: 1 })
        .withMessage('Valid course ID is required')
];

// Public routes (SSL Commerz callbacks)
router.post('/ssl/success', sslSuccess);
router.get('/ssl/success', sslSuccess);
router.post('/ssl/fail', sslFail);
router.get('/ssl/fail', sslFail);
router.post('/ssl/cancel', sslCancel);
router.get('/ssl/cancel', sslCancel);

// SSL Commerz IPN
router.post('/ssl/ipn', (req, res) => {
    console.log('📬 SSL IPN received:', req.body);
    res.status(200).send('OK');
});

// Protected routes
router.get('/methods', authenticateToken, getPaymentMethods);

router.post('/initiate', 
    authenticateToken, 
    initiatePaymentValidation, 
    initiatePayment
);

router.get('/my-enrollments', 
    authenticateToken, 
    getUserEnrollments
);

router.get('/enrollment-status/:courseId', 
    authenticateToken, 
    enrollmentStatusValidation, 
    checkEnrollmentStatus
);

// Test route
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Payment routes are working',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;