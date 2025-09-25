const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const {
    getCategories,
    getCourses,
    getCourse,
    createCourse,
    updateCourse,
    getTeacherCourses,
    deleteCourse
} = require('../controllers/courseController');

const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Academic Course Validation rules
const createCourseValidation = [
    body('title')
        .trim()
        .isLength({ min: 10, max: 200 })
        .withMessage('Course title must be between 10 and 200 characters'),
    body('description')
        .trim()
        .isLength({ min: 100 })
        .withMessage('Description must be at least 100 characters'),
    body('short_description')
        .trim()
        .isLength({ min: 20, max: 250 })
        .withMessage('Short description must be between 20 and 250 characters'),
    body('course_code')
        .trim()
        .matches(/^[A-Z]{2,4}[0-9]{3,4}$/)
        .withMessage('Course code must be in format like CSE101, MATH201'),
    body('course_type')
        .isIn(['pre_recorded', 'live', 'hybrid'])
        .withMessage('Course type must be pre_recorded, live, or hybrid'),
    body('price')
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number'),
    body('category_id')
        .isInt({ min: 1 })
        .withMessage('Valid category is required'),
    body('academic_level')
        .isIn(['undergraduate', 'graduate', 'postgraduate'])
        .withMessage('Academic level must be undergraduate, graduate, or postgraduate'),
    body('semester')
        .trim()
        .isLength({ min: 5, max: 20 })
        .withMessage('Semester must be specified (e.g., Spring 2024)'),
    body('credits')
        .isInt({ min: 1, max: 6 })
        .withMessage('Credits must be between 1 and 6'),
    body('university')
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('University name is required'),
    body('department')
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('Department name is required'),
    body('duration_weeks')
        .isInt({ min: 1, max: 52 })
        .withMessage('Duration must be between 1 and 52 weeks'),
    body('max_students')
        .isInt({ min: 1, max: 500 })
        .withMessage('Maximum students must be between 1 and 500'),
    body('learning_objectives')
        .trim()
        .isLength({ min: 50 })
        .withMessage('Learning objectives must be at least 50 characters'),
    body('course_outline')
        .trim()
        .isLength({ min: 100 })
        .withMessage('Course outline must be at least 100 characters')
];

const updateCourseValidation = [
    param('id')
        .isInt({ min: 1 })
        .withMessage('Valid course ID is required'),
    // Make all fields optional for updates
    body('title')
        .optional()
        .trim()
        .isLength({ min: 10, max: 200 }),
    body('description')
        .optional()
        .trim()
        .isLength({ min: 100 }),
    body('course_type')
        .optional()
        .isIn(['pre_recorded', 'live', 'hybrid']),
    body('academic_level')
        .optional()
        .isIn(['undergraduate', 'graduate', 'postgraduate']),
    body('is_published')
        .optional()
        .isBoolean()
        .withMessage('Published status must be boolean')
];

// Routes remain the same
router.get('/categories', getCategories);
router.get('/', getCourses);
router.get('/:slug', getCourse);

router.post('/', 
    authenticateToken, 
    authorizeRole('teacher', 'admin'), 
    createCourseValidation, 
    createCourse
);

router.put('/:id', 
    authenticateToken, 
    authorizeRole('teacher', 'admin'), 
    updateCourseValidation, 
    updateCourse
);

router.get('/teacher/my-courses', 
    authenticateToken, 
    authorizeRole('teacher', 'admin'), 
    getTeacherCourses
);

router.delete('/:id', 
    authenticateToken, 
    authorizeRole('teacher', 'admin'), 
    deleteCourse
);

module.exports = router;