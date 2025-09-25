const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');

const {
    getProfile,
    updateProfile,
    changeUserRole,
    getAllUsers,
    deleteAccount
} = require('../controllers/profileController');

const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Validation rules
const updateProfileValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address')
];

const changeRoleValidation = [
    body('userId')
        .isInt({ min: 1 })
        .withMessage('Valid user ID is required'),
    body('newRole')
        .isIn(['student', 'teacher', 'admin'])
        .withMessage('Role must be student, teacher, or admin')
];

const getAllUsersValidation = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive number'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    query('role')
        .optional()
        .isIn(['student', 'teacher', 'admin'])
        .withMessage('Role must be student, teacher, or admin')
];

// Protected Routes (All require authentication)
router.get('/', authenticateToken, getProfile);
router.put('/', authenticateToken, updateProfileValidation, updateProfile);
router.delete('/', authenticateToken, deleteAccount);

// Admin Only Routes
router.put('/change-role', 
    authenticateToken, 
    authorizeRole('admin'), 
    changeRoleValidation, 
    changeUserRole
);

router.get('/all-users', 
    authenticateToken, 
    authorizeRole('admin'), 
    getAllUsersValidation, 
    getAllUsers
);

module.exports = router;