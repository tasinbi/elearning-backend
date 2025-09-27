const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');

const {
    updateLessonProgress,
    getCourseProgress,
    getLessonWithProgress,
    markLessonCompleted,
    getLearningStatistics
} = require('../controllers/progressController');

const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Validation rules
const updateProgressValidation = [
    body('lessonId')
        .isInt({ min: 1 })
        .withMessage('Valid lesson ID is required'),
    body('watchTimeSeconds')
        .isInt({ min: 0 })
        .withMessage('Watch time must be a positive number'),
    body('isCompleted')
        .isBoolean()
        .withMessage('Completion status must be boolean')
];

const courseIdValidation = [
    param('courseId')
        .isInt({ min: 1 })
        .withMessage('Valid course ID is required')
];

const lessonIdValidation = [
    param('lessonId')
        .isInt({ min: 1 })
        .withMessage('Valid lesson ID is required')
];

// Routes

// Update lesson progress (when student watches a lesson)
router.post('/lesson',
    authenticateToken,
    authorizeRole('student'),
    updateProgressValidation,
    updateLessonProgress
);

// Get course progress for a student
router.get('/course/:courseId',
    authenticateToken,
    authorizeRole('student'),
    courseIdValidation,
    getCourseProgress
);

// Get lesson details with progress
router.get('/lesson/:lessonId',
    authenticateToken,
    authorizeRole('student'),
    lessonIdValidation,
    getLessonWithProgress
);

// Mark lesson as completed
router.post('/lesson/:lessonId/complete',
    authenticateToken,
    authorizeRole('student'),
    lessonIdValidation,
    markLessonCompleted
);

// Get learning statistics for student
router.get('/statistics',
    authenticateToken,
    authorizeRole('student'),
    getLearningStatistics
);

// Get overall progress summary for all enrolled courses
router.get('/overview',
    authenticateToken,
    authorizeRole('student'),
    async (req, res) => {
        try {
            const userId = req.user.id;

            const [progressOverview] = await pool.execute(`
                SELECT 
                    e.course_id,
                    c.title as course_title,
                    c.slug as course_slug,
                    c.thumbnail,
                    e.progress_percentage,
                    e.enrolled_at,
                    COUNT(DISTINCT cl.id) as total_lessons,
                    COUNT(DISTINCT CASE WHEN lp.is_completed = TRUE THEN lp.lesson_id END) as completed_lessons,
                    MAX(lp.completed_at) as last_activity
                FROM enrollments e
                JOIN courses c ON e.course_id = c.id
                LEFT JOIN course_modules cm ON c.id = cm.course_id AND cm.is_published = TRUE
                LEFT JOIN course_lessons cl ON cm.id = cl.module_id AND cl.is_published = TRUE
                LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = e.user_id
                WHERE e.user_id = ? AND e.payment_status = 'completed'
                GROUP BY e.course_id, c.title, c.slug, c.thumbnail, e.progress_percentage, e.enrolled_at
                ORDER BY e.enrolled_at DESC
            `, [userId]);

            res.json({
                success: true,
                message: 'Progress overview retrieved successfully',
                data: {
                    courses: progressOverview
                }
            });

        } catch (error) {
            console.error('Progress overview error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve progress overview'
            });
        }
    }
);

module.exports = router;