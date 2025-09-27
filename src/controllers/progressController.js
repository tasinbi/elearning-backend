const { pool } = require('../config/database');
const { validationResult } = require('express-validator');

// Update lesson progress (when student watches a lesson)
const updateLessonProgress = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const userId = req.user.id;
        const { lessonId, watchTimeSeconds, isCompleted } = req.body;

        // Verify student is enrolled in the course containing this lesson
        const [enrollmentCheck] = await pool.execute(`
            SELECT e.id as enrollment_id, e.course_id, cl.title as lesson_title
            FROM enrollments e
            JOIN course_modules cm ON e.course_id = cm.course_id
            JOIN course_lessons cl ON cm.id = cl.module_id
            WHERE e.user_id = ? AND cl.id = ? AND e.payment_status = 'completed'
        `, [userId, lessonId]);

        if (!enrollmentCheck.length) {
            return res.status(403).json({
                success: false,
                message: 'You are not enrolled in this course or lesson not found'
            });
        }

        const enrollment = enrollmentCheck[0];

        // Update or create lesson progress
        await pool.execute(`
            INSERT INTO lesson_progress (user_id, lesson_id, watch_time_seconds, is_completed, completed_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                watch_time_seconds = GREATEST(watch_time_seconds, VALUES(watch_time_seconds)),
                is_completed = VALUES(is_completed),
                completed_at = CASE 
                    WHEN VALUES(is_completed) = TRUE AND is_completed = FALSE 
                    THEN CURRENT_TIMESTAMP 
                    ELSE completed_at 
                END,
                updated_at = CURRENT_TIMESTAMP
        `, [userId, lessonId, watchTimeSeconds, isCompleted, isCompleted ? new Date() : null]);

        // Recalculate course progress
        await updateCourseProgress(userId, enrollment.course_id);

        res.json({
            success: true,
            message: 'Lesson progress updated successfully',
            data: {
                lesson_id: lessonId,
                watch_time_seconds: watchTimeSeconds,
                is_completed: isCompleted
            }
        });

    } catch (error) {
        console.error('Update lesson progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update lesson progress'
        });
    }
};

// Helper function to recalculate course progress
const updateCourseProgress = async (userId, courseId) => {
    try {
        // Calculate progress percentage based on completed lessons
        const [progressData] = await pool.execute(`
            SELECT 
                COUNT(cl.id) as total_lessons,
                COUNT(CASE WHEN lp.is_completed = TRUE THEN 1 END) as completed_lessons
            FROM course_modules cm
            JOIN course_lessons cl ON cm.id = cl.module_id
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = ?
            WHERE cm.course_id = ? AND cm.is_published = TRUE AND cl.is_published = TRUE
        `, [userId, courseId]);

        const { total_lessons, completed_lessons } = progressData[0];
        const progressPercentage = total_lessons > 0 ? (completed_lessons / total_lessons) * 100 : 0;

        // Update enrollment progress
        await pool.execute(`
            UPDATE enrollments 
            SET progress_percentage = ?
            WHERE user_id = ? AND course_id = ?
        `, [Math.round(progressPercentage * 100) / 100, userId, courseId]);

        return progressPercentage;
    } catch (error) {
        console.error('Update course progress error:', error);
        throw error;
    }
};

// Get course progress for a student
const getCourseProgress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { courseId } = req.params;

        // Verify enrollment
        const [enrollmentCheck] = await pool.execute(`
            SELECT id, progress_percentage, enrolled_at 
            FROM enrollments 
            WHERE user_id = ? AND course_id = ? AND payment_status = 'completed'
        `, [userId, courseId]);

        if (!enrollmentCheck.length) {
            return res.status(403).json({
                success: false,
                message: 'You are not enrolled in this course'
            });
        }

        // Get detailed progress by modules and lessons
        const [moduleProgress] = await pool.execute(`
            SELECT 
                cm.id as module_id,
                cm.title as module_title,
                cm.order_index as module_order,
                cm.duration_minutes as module_duration,
                
                cl.id as lesson_id,
                cl.title as lesson_title,
                cl.lesson_type,
                cl.video_duration,
                cl.order_index as lesson_order,
                cl.is_free,
                
                lp.is_completed,
                lp.watch_time_seconds,
                lp.completed_at
                
            FROM course_modules cm
            LEFT JOIN course_lessons cl ON cm.id = cl.module_id AND cl.is_published = TRUE
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = ?
            WHERE cm.course_id = ? AND cm.is_published = TRUE
            ORDER BY cm.order_index, cl.order_index
        `, [userId, courseId]);

        // Group lessons by modules
        const modules = {};
        moduleProgress.forEach(row => {
            if (!modules[row.module_id]) {
                modules[row.module_id] = {
                    id: row.module_id,
                    title: row.module_title,
                    order_index: row.module_order,
                    duration_minutes: row.module_duration,
                    lessons: []
                };
            }

            if (row.lesson_id) {
                modules[row.module_id].lessons.push({
                    id: row.lesson_id,
                    title: row.lesson_title,
                    lesson_type: row.lesson_type,
                    video_duration: row.video_duration,
                    order_index: row.lesson_order,
                    is_free: row.is_free,
                    is_completed: row.is_completed || false,
                    watch_time_seconds: row.watch_time_seconds || 0,
                    completed_at: row.completed_at
                });
            }
        });

        const moduleArray = Object.values(modules);

        // Calculate overall statistics
        const totalLessons = moduleProgress.filter(row => row.lesson_id).length;
        const completedLessons = moduleProgress.filter(row => row.is_completed).length;
        const totalWatchTime = moduleProgress.reduce((sum, row) => sum + (row.watch_time_seconds || 0), 0);

        res.json({
            success: true,
            message: 'Course progress retrieved successfully',
            data: {
                enrollment: enrollmentCheck[0],
                modules: moduleArray,
                statistics: {
                    total_lessons: totalLessons,
                    completed_lessons: completedLessons,
                    progress_percentage: enrollmentCheck[0].progress_percentage,
                    total_watch_time_seconds: totalWatchTime,
                    total_watch_time_minutes: Math.round(totalWatchTime / 60)
                }
            }
        });

    } catch (error) {
        console.error('Get course progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve course progress'
        });
    }
};

// Get lesson details with progress
const getLessonWithProgress = async (req, res) => {
    try {
        const userId = req.user.id;
        const { lessonId } = req.params;

        // Get lesson details with progress
        const [lessonData] = await pool.execute(`
            SELECT 
                cl.*,
                cm.title as module_title,
                cm.course_id,
                c.title as course_title,
                c.slug as course_slug,
                lp.is_completed,
                lp.watch_time_seconds,
                lp.completed_at
            FROM course_lessons cl
            JOIN course_modules cm ON cl.module_id = cm.id
            JOIN courses c ON cm.course_id = c.id
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = ?
            WHERE cl.id = ? AND cl.is_published = TRUE
        `, [userId, lessonId]);

        if (!lessonData.length) {
            return res.status(404).json({
                success: false,
                message: 'Lesson not found'
            });
        }

        const lesson = lessonData[0];

        // Verify enrollment
        const [enrollmentCheck] = await pool.execute(`
            SELECT id FROM enrollments 
            WHERE user_id = ? AND course_id = ? AND payment_status = 'completed'
        `, [userId, lesson.course_id]);

        if (!enrollmentCheck.length && !lesson.is_free) {
            return res.status(403).json({
                success: false,
                message: 'You are not enrolled in this course'
            });
        }

        // Get next and previous lessons
        const [navigationData] = await pool.execute(`
            (SELECT 'previous' as type, id, title, order_index
             FROM course_lessons 
             WHERE module_id = ? AND order_index < ? AND is_published = TRUE
             ORDER BY order_index DESC 
             LIMIT 1)
            UNION ALL
            (SELECT 'next' as type, id, title, order_index
             FROM course_lessons 
             WHERE module_id = ? AND order_index > ? AND is_published = TRUE
             ORDER BY order_index ASC 
             LIMIT 1)
        `, [lesson.module_id, lesson.order_index, lesson.module_id, lesson.order_index]);

        const navigation = {
            previous: navigationData.find(item => item.type === 'previous') || null,
            next: navigationData.find(item => item.type === 'next') || null
        };

        res.json({
            success: true,
            message: 'Lesson details retrieved successfully',
            data: {
                lesson: {
                    ...lesson,
                    is_completed: lesson.is_completed || false,
                    watch_time_seconds: lesson.watch_time_seconds || 0,
                    completed_at: lesson.completed_at
                },
                navigation: navigation
            }
        });

    } catch (error) {
        console.error('Get lesson with progress error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve lesson details'
        });
    }
};

// Mark lesson as completed
const markLessonCompleted = async (req, res) => {
    try {
        const userId = req.user.id;
        const { lessonId } = req.params;

        // Update lesson progress to completed
        const result = await updateLessonProgress({
            user: { id: userId },
            body: { lessonId: parseInt(lessonId), watchTimeSeconds: 0, isCompleted: true }
        }, res);

        // Don't send response again if updateLessonProgress already sent it
        if (res.headersSent) return;

        res.json({
            success: true,
            message: 'Lesson marked as completed',
            data: {
                lesson_id: lessonId,
                completed_at: new Date()
            }
        });

    } catch (error) {
        console.error('Mark lesson completed error:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to mark lesson as completed'
            });
        }
    }
};

// Get learning statistics for student
const getLearningStatistics = async (req, res) => {
    try {
        const userId = req.user.id;

        // Overall learning statistics
        const [overallStats] = await pool.execute(`
            SELECT 
                COUNT(DISTINCT e.course_id) as enrolled_courses,
                COUNT(DISTINCT CASE WHEN e.progress_percentage >= 100 THEN e.course_id END) as completed_courses,
                COUNT(DISTINCT lp.lesson_id) as total_lessons_completed,
                COALESCE(SUM(lp.watch_time_seconds), 0) as total_watch_time_seconds,
                COUNT(DISTINCT DATE(lp.completed_at)) as active_learning_days
            FROM enrollments e
            LEFT JOIN course_modules cm ON e.course_id = cm.course_id
            LEFT JOIN course_lessons cl ON cm.id = cl.module_id
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = e.user_id
            WHERE e.user_id = ? AND e.payment_status = 'completed'
        `, [userId]);

        // Weekly learning activity (last 4 weeks)
        const [weeklyActivity] = await pool.execute(`
            SELECT 
                YEARWEEK(lp.completed_at, 1) as week,
                COUNT(lp.id) as lessons_completed,
                SUM(lp.watch_time_seconds) as watch_time_seconds
            FROM lesson_progress lp
            WHERE lp.user_id = ? 
                AND lp.completed_at >= DATE_SUB(CURDATE(), INTERVAL 4 WEEK)
                AND lp.is_completed = TRUE
            GROUP BY YEARWEEK(lp.completed_at, 1)
            ORDER BY week DESC
        `, [userId]);

        // Subject-wise progress
        const [subjectProgress] = await pool.execute(`
            SELECT 
                cat.name as subject,
                COUNT(DISTINCT e.course_id) as enrolled_courses,
                AVG(e.progress_percentage) as avg_progress,
                COUNT(DISTINCT lp.lesson_id) as lessons_completed
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN categories cat ON c.category_id = cat.id
            LEFT JOIN course_modules cm ON c.id = cm.course_id
            LEFT JOIN course_lessons cl ON cm.id = cl.module_id
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = e.user_id AND lp.is_completed = TRUE
            WHERE e.user_id = ? AND e.payment_status = 'completed'
            GROUP BY cat.id, cat.name
            ORDER BY avg_progress DESC
        `, [userId]);

        const stats = overallStats[0];

        res.json({
            success: true,
            message: 'Learning statistics retrieved successfully',
            data: {
                overall: {
                    enrolled_courses: stats.enrolled_courses,
                    completed_courses: stats.completed_courses,
                    completion_rate: stats.enrolled_courses > 0 ? 
                        Math.round((stats.completed_courses / stats.enrolled_courses) * 100) : 0,
                    total_lessons_completed: stats.total_lessons_completed,
                    total_watch_time_hours: Math.round(stats.total_watch_time_seconds / 3600 * 100) / 100,
                    active_learning_days: stats.active_learning_days
                },
                weekly_activity: weeklyActivity,
                subject_progress: subjectProgress
            }
        });

    } catch (error) {
        console.error('Get learning statistics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve learning statistics'
        });
    }
};

module.exports = {
    updateLessonProgress,
    getCourseProgress,
    getLessonWithProgress,
    markLessonCompleted,
    getLearningStatistics,
    updateCourseProgress // Export for use in other controllers
};