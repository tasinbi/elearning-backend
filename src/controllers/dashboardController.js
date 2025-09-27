const { pool } = require('../config/database');

// Student Dashboard
const getStudentDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get enrolled courses with progress
        const [enrolledCourses] = await pool.execute(`
            SELECT 
                e.id as enrollment_id,
                e.payment_status,
                e.progress_percentage,
                e.enrolled_at,
                c.id as course_id,
                c.title,
                c.slug,
                c.thumbnail,
                c.course_code,
                c.course_type,
                u.name as teacher_name,
                cat.name as category_name,
                
                -- Course structure info
                total_modules.count as total_modules,
                total_lessons.count as total_lessons,
                completed_lessons.count as completed_lessons,
                total_duration.minutes as total_duration_minutes,
                watched_duration.minutes as watched_duration_minutes
                
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN users u ON c.teacher_id = u.id
            JOIN categories cat ON c.category_id = cat.id
            
            -- Total modules count
            LEFT JOIN (
                SELECT course_id, COUNT(*) as count 
                FROM course_modules 
                WHERE is_published = TRUE 
                GROUP BY course_id
            ) total_modules ON c.id = total_modules.course_id
            
            -- Total lessons count
            LEFT JOIN (
                SELECT cm.course_id, COUNT(cl.id) as count
                FROM course_modules cm
                JOIN course_lessons cl ON cm.id = cl.module_id
                WHERE cm.is_published = TRUE AND cl.is_published = TRUE
                GROUP BY cm.course_id
            ) total_lessons ON c.id = total_lessons.course_id
            
            -- Completed lessons count
            LEFT JOIN (
                SELECT cm.course_id, COUNT(lp.id) as count
                FROM course_modules cm
                JOIN course_lessons cl ON cm.id = cl.module_id
                JOIN lesson_progress lp ON cl.id = lp.lesson_id
                WHERE lp.user_id = ? AND lp.is_completed = TRUE
                GROUP BY cm.course_id
            ) completed_lessons ON c.id = completed_lessons.course_id
            
            -- Total course duration
            LEFT JOIN (
                SELECT cm.course_id, SUM(cl.video_duration) as minutes
                FROM course_modules cm
                JOIN course_lessons cl ON cm.id = cl.module_id
                WHERE cm.is_published = TRUE AND cl.is_published = TRUE
                GROUP BY cm.course_id
            ) total_duration ON c.id = total_duration.course_id
            
            -- Watched duration
            LEFT JOIN (
                SELECT cm.course_id, SUM(lp.watch_time_seconds)/60 as minutes
                FROM course_modules cm
                JOIN course_lessons cl ON cm.id = cl.module_id
                JOIN lesson_progress lp ON cl.id = lp.lesson_id
                WHERE lp.user_id = ?
                GROUP BY cm.course_id
            ) watched_duration ON c.id = watched_duration.course_id
            
            WHERE e.user_id = ? AND e.payment_status = 'completed'
            ORDER BY e.enrolled_at DESC
        `, [userId, userId, userId]);

        // Calculate actual progress for each course
        const coursesWithProgress = enrolledCourses.map(course => {
            const totalLessons = course.total_lessons || 0;
            const completedLessons = course.completed_lessons || 0;
            const actualProgress = totalLessons > 0 ? (completedLessons / totalLessons * 100) : 0;
            
            return {
                ...course,
                actual_progress: Math.round(actualProgress * 100) / 100,
                total_lessons: totalLessons,
                completed_lessons: completedLessons || 0,
                total_duration_minutes: course.total_duration_minutes || 0,
                watched_duration_minutes: course.watched_duration_minutes || 0
            };
        });

        // Recent activity (recent lesson completions)
        const [recentActivity] = await pool.execute(`
            SELECT 
                lp.completed_at,
                cl.title as lesson_title,
                c.title as course_title,
                c.slug as course_slug,
                'lesson_completed' as activity_type
            FROM lesson_progress lp
            JOIN course_lessons cl ON lp.lesson_id = cl.id
            JOIN course_modules cm ON cl.module_id = cm.id
            JOIN courses c ON cm.course_id = c.id
            WHERE lp.user_id = ? AND lp.is_completed = TRUE
            ORDER BY lp.completed_at DESC
            LIMIT 5
        `, [userId]);

        // Learning statistics
        const [learningStats] = await pool.execute(`
            SELECT 
                COUNT(DISTINCT e.course_id) as total_enrolled_courses,
                COUNT(DISTINCT CASE WHEN e.progress_percentage >= 100 THEN e.course_id END) as completed_courses,
                COUNT(DISTINCT lp.lesson_id) as total_completed_lessons,
                COALESCE(SUM(lp.watch_time_seconds), 0) as total_watch_time_seconds,
                COUNT(DISTINCT DATE(lp.completed_at)) as active_learning_days
            FROM enrollments e
            LEFT JOIN course_modules cm ON e.course_id = cm.course_id
            LEFT JOIN course_lessons cl ON cm.id = cl.module_id
            LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = e.user_id
            WHERE e.user_id = ? AND e.payment_status = 'completed'
        `, [userId]);

        // Upcoming/Continue learning (courses with < 100% progress)
        const continueLearning = coursesWithProgress.filter(course => 
            course.actual_progress < 100
        ).slice(0, 3);

        // Certificates earned (completed courses)
        const certificatesEarned = coursesWithProgress.filter(course => 
            course.actual_progress >= 100
        ).length;

        const stats = learningStats[0];

        res.json({
            success: true,
            message: 'Student dashboard data retrieved successfully',
            data: {
                overview: {
                    total_enrolled_courses: stats.total_enrolled_courses,
                    completed_courses: stats.completed_courses,
                    total_completed_lessons: stats.total_completed_lessons,
                    total_watch_time_hours: Math.round(stats.total_watch_time_seconds / 3600 * 100) / 100,
                    active_learning_days: stats.active_learning_days,
                    certificates_earned: certificatesEarned
                },
                enrolled_courses: coursesWithProgress,
                continue_learning: continueLearning,
                recent_activity: recentActivity,
                learning_streak: stats.active_learning_days // Simplified streak calculation
            }
        });

    } catch (error) {
        console.error('Student dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load student dashboard'
        });
    }
};

// Teacher Dashboard
const getTeacherDashboard = async (req, res) => {
    try {
        const teacherId = req.user.id;

        // Teacher's courses overview
        const [coursesOverview] = await pool.execute(`
            SELECT 
                c.id,
                c.title,
                c.slug,
                c.thumbnail,
                c.course_code,
                c.price,
                c.discount_price,
                c.is_published,
                c.created_at,
                
                -- Enrollment stats
                COALESCE(enrollment_stats.total_students, 0) as total_students,
                COALESCE(enrollment_stats.total_revenue, 0) as total_revenue,
                COALESCE(enrollment_stats.pending_enrollments, 0) as pending_enrollments,
                
                -- Course structure
                COALESCE(course_structure.total_modules, 0) as total_modules,
                COALESCE(course_structure.total_lessons, 0) as total_lessons,
                COALESCE(course_structure.total_duration, 0) as total_duration_minutes,
                
                -- Reviews
                COALESCE(review_stats.avg_rating, 0) as avg_rating,
                COALESCE(review_stats.total_reviews, 0) as total_reviews
                
            FROM courses c
            
            -- Enrollment statistics
            LEFT JOIN (
                SELECT 
                    course_id,
                    COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as total_students,
                    SUM(CASE WHEN payment_status = 'completed' THEN amount_paid ELSE 0 END) as total_revenue,
                    COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_enrollments
                FROM enrollments
                GROUP BY course_id
            ) enrollment_stats ON c.id = enrollment_stats.course_id
            
            -- Course structure
            LEFT JOIN (
                SELECT 
                    c.id as course_id,
                    COUNT(DISTINCT cm.id) as total_modules,
                    COUNT(cl.id) as total_lessons,
                    SUM(cl.video_duration) as total_duration
                FROM courses c
                LEFT JOIN course_modules cm ON c.id = cm.course_id AND cm.is_published = TRUE
                LEFT JOIN course_lessons cl ON cm.id = cl.module_id AND cl.is_published = TRUE
                GROUP BY c.id
            ) course_structure ON c.id = course_structure.course_id
            
            -- Review statistics
            LEFT JOIN (
                SELECT 
                    course_id,
                    AVG(rating) as avg_rating,
                    COUNT(*) as total_reviews
                FROM course_reviews
                WHERE is_approved = TRUE
                GROUP BY course_id
            ) review_stats ON c.id = review_stats.course_id
            
            WHERE c.teacher_id = ?
            ORDER BY c.created_at DESC
        `, [teacherId]);

        // Overall teacher statistics
        const [teacherStats] = await pool.execute(`
            SELECT 
                COUNT(DISTINCT c.id) as total_courses,
                COUNT(CASE WHEN c.is_published = TRUE THEN 1 END) as published_courses,
                COALESCE(SUM(enrollment_stats.total_students), 0) as total_students,
                COALESCE(SUM(enrollment_stats.total_revenue), 0) as total_revenue,
                COALESCE(AVG(review_stats.avg_rating), 0) as overall_rating,
                COALESCE(SUM(review_stats.total_reviews), 0) as total_reviews
            FROM courses c
            LEFT JOIN (
                SELECT 
                    course_id,
                    COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as total_students,
                    SUM(CASE WHEN payment_status = 'completed' THEN amount_paid ELSE 0 END) as total_revenue
                FROM enrollments
                GROUP BY course_id
            ) enrollment_stats ON c.id = enrollment_stats.course_id
            LEFT JOIN (
                SELECT 
                    course_id,
                    AVG(rating) as avg_rating,
                    COUNT(*) as total_reviews
                FROM course_reviews
                WHERE is_approved = TRUE
                GROUP BY course_id
            ) review_stats ON c.id = review_stats.course_id
            WHERE c.teacher_id = ?
        `, [teacherId]);

        // Recent enrollments
        const [recentEnrollments] = await pool.execute(`
            SELECT 
                e.enrolled_at,
                e.amount_paid,
                u.name as student_name,
                u.mobile as student_mobile,
                c.title as course_title,
                c.slug as course_slug
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            JOIN courses c ON e.course_id = c.id
            WHERE c.teacher_id = ? AND e.payment_status = 'completed'
            ORDER BY e.enrolled_at DESC
            LIMIT 10
        `, [teacherId]);

        // Monthly revenue trend (last 6 months)
        const [monthlyRevenue] = await pool.execute(`
            SELECT 
                DATE_FORMAT(e.payment_completed_at, '%Y-%m') as month,
                COUNT(e.id) as enrollments,
                SUM(e.amount_paid) as revenue
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            WHERE c.teacher_id = ? 
                AND e.payment_status = 'completed'
                AND e.payment_completed_at >= DATE_SUB(CURRENT_DATE, INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(e.payment_completed_at, '%Y-%m')
            ORDER BY month DESC
        `, [teacherId]);

        // Course performance (top performing courses)
        const topCourses = coursesOverview
            .filter(course => course.total_students > 0)
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 5);

        const stats = teacherStats[0];

        res.json({
            success: true,
            message: 'Teacher dashboard data retrieved successfully',
            data: {
                overview: {
                    total_courses: stats.total_courses,
                    published_courses: stats.published_courses,
                    total_students: stats.total_students,
                    total_revenue: parseFloat(stats.total_revenue),
                    overall_rating: Math.round(stats.overall_rating * 100) / 100,
                    total_reviews: stats.total_reviews
                },
                courses: coursesOverview,
                top_performing_courses: topCourses,
                recent_enrollments: recentEnrollments,
                monthly_revenue_trend: monthlyRevenue,
                quick_stats: {
                    this_month_enrollments: recentEnrollments.filter(e => 
                        new Date(e.enrolled_at).getMonth() === new Date().getMonth()
                    ).length,
                    pending_reviews: 0 // This would need a separate query for pending course reviews
                }
            }
        });

    } catch (error) {
        console.error('Teacher dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load teacher dashboard'
        });
    }
};

// Admin Dashboard
const getAdminDashboard = async (req, res) => {
    try {
        // Overall platform statistics
        const [platformStats] = await pool.execute(`
            SELECT 
                (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
                (SELECT COUNT(*) FROM users WHERE role = 'teacher') as total_teachers,
                (SELECT COUNT(*) FROM courses WHERE is_published = TRUE) as total_courses,
                (SELECT COUNT(*) FROM categories WHERE is_active = TRUE) as total_categories,
                (SELECT COUNT(*) FROM enrollments WHERE payment_status = 'completed') as total_enrollments,
                (SELECT COALESCE(SUM(amount_paid), 0) FROM enrollments WHERE payment_status = 'completed') as total_revenue,
                (SELECT COUNT(*) FROM course_reviews WHERE is_approved = TRUE) as total_reviews,
                (SELECT COUNT(*) FROM users WHERE created_at >= CURDATE()) as new_users_today
        `);

        // Monthly growth metrics (last 12 months)
        const [monthlyGrowth] = await pool.execute(`
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(CASE WHEN role = 'student' THEN 1 END) as new_students,
                COUNT(CASE WHEN role = 'teacher' THEN 1 END) as new_teachers
            FROM users
            WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month DESC
        `);

        // Revenue trend (last 12 months)
        const [revenueTrend] = await pool.execute(`
            SELECT 
                DATE_FORMAT(payment_completed_at, '%Y-%m') as month,
                COUNT(*) as enrollments,
                SUM(amount_paid) as revenue
            FROM enrollments
            WHERE payment_status = 'completed'
                AND payment_completed_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
            GROUP BY DATE_FORMAT(payment_completed_at, '%Y-%m')
            ORDER BY month DESC
        `);

        // Top performing courses
        const [topCourses] = await pool.execute(`
            SELECT 
                c.id,
                c.title,
                c.course_code,
                u.name as teacher_name,
                COUNT(e.id) as total_enrollments,
                SUM(e.amount_paid) as total_revenue,
                AVG(r.rating) as avg_rating
            FROM courses c
            JOIN users u ON c.teacher_id = u.id
            LEFT JOIN enrollments e ON c.id = e.course_id AND e.payment_status = 'completed'
            LEFT JOIN course_reviews r ON c.id = r.course_id AND r.is_approved = TRUE
            WHERE c.is_published = TRUE
            GROUP BY c.id, c.title, c.course_code, u.name
            HAVING total_enrollments > 0
            ORDER BY total_revenue DESC
            LIMIT 10
        `);

        // Recent activities
        const [recentActivities] = await pool.execute(`
            (SELECT 
                'new_user' as type,
                CONCAT(name, ' joined as ', role) as description,
                created_at as timestamp
            FROM users 
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY created_at DESC
            LIMIT 5)
            
            UNION ALL
            
            (SELECT 
                'new_enrollment' as type,
                CONCAT(u.name, ' enrolled in ', c.title) as description,
                e.enrolled_at as timestamp
            FROM enrollments e
            JOIN users u ON e.user_id = u.id
            JOIN courses c ON e.course_id = c.id
            WHERE e.payment_status = 'completed' 
                AND e.enrolled_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY e.enrolled_at DESC
            LIMIT 5)
            
            UNION ALL
            
            (SELECT 
                'new_course' as type,
                CONCAT('New course: ', title, ' by ', u.name) as description,
                c.created_at as timestamp
            FROM courses c
            JOIN users u ON c.teacher_id = u.id
            WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            ORDER BY c.created_at DESC
            LIMIT 5)
            
            ORDER BY timestamp DESC
            LIMIT 15
        `);

        // Category-wise course distribution
        const [categoryStats] = await pool.execute(`
            SELECT 
                cat.name as category_name,
                COUNT(c.id) as course_count,
                COUNT(e.id) as total_enrollments,
                SUM(e.amount_paid) as total_revenue
            FROM categories cat
            LEFT JOIN courses c ON cat.id = c.category_id AND c.is_published = TRUE
            LEFT JOIN enrollments e ON c.id = e.course_id AND e.payment_status = 'completed'
            WHERE cat.is_active = TRUE
            GROUP BY cat.id, cat.name
            ORDER BY course_count DESC
        `);

        // Top teachers by revenue
        const [topTeachers] = await pool.execute(`
            SELECT 
                u.id,
                u.name,
                u.email,
                COUNT(DISTINCT c.id) as total_courses,
                COUNT(e.id) as total_students,
                SUM(e.amount_paid) as total_revenue,
                AVG(r.rating) as avg_rating
            FROM users u
            JOIN courses c ON u.id = c.teacher_id
            LEFT JOIN enrollments e ON c.id = e.course_id AND e.payment_status = 'completed'
            LEFT JOIN course_reviews r ON c.id = r.course_id AND r.is_approved = TRUE
            WHERE u.role = 'teacher' AND c.is_published = TRUE
            GROUP BY u.id, u.name, u.email
            HAVING total_revenue > 0
            ORDER BY total_revenue DESC
            LIMIT 10
        `);

        const stats = platformStats[0];

        res.json({
            success: true,
            message: 'Admin dashboard data retrieved successfully',
            data: {
                overview: {
                    total_students: stats.total_students,
                    total_teachers: stats.total_teachers,
                    total_courses: stats.total_courses,
                    total_categories: stats.total_categories,
                    total_enrollments: stats.total_enrollments,
                    total_revenue: parseFloat(stats.total_revenue),
                    total_reviews: stats.total_reviews,
                    new_users_today: stats.new_users_today
                },
                monthly_growth: monthlyGrowth,
                revenue_trend: revenueTrend,
                top_courses: topCourses,
                top_teachers: topTeachers,
                category_stats: categoryStats,
                recent_activities: recentActivities,
                quick_metrics: {
                    avg_revenue_per_course: stats.total_courses > 0 ? 
                        Math.round(stats.total_revenue / stats.total_courses) : 0,
                    avg_students_per_course: stats.total_courses > 0 ? 
                        Math.round(stats.total_enrollments / stats.total_courses) : 0,
                    teacher_to_student_ratio: stats.total_students > 0 ? 
                        Math.round((stats.total_teachers / stats.total_students) * 100) / 100 : 0
                }
            }
        });

    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load admin dashboard'
        });
    }
};

// Get user analytics (for profile insights)
const getUserAnalytics = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        if (userRole === 'student') {
            // Student analytics
            const [studentAnalytics] = await pool.execute(`
                SELECT 
                    -- Learning metrics
                    COUNT(DISTINCT e.course_id) as total_enrolled,
                    COUNT(DISTINCT CASE WHEN lp.is_completed = TRUE THEN lp.lesson_id END) as lessons_completed,
                    COALESCE(SUM(lp.watch_time_seconds), 0) as total_watch_time,
                    COUNT(DISTINCT DATE(lp.completed_at)) as active_days,
                    
                    -- Progress metrics
                    AVG(e.progress_percentage) as avg_progress,
                    COUNT(CASE WHEN e.progress_percentage >= 100 THEN 1 END) as completed_courses
                    
                FROM enrollments e
                LEFT JOIN course_modules cm ON e.course_id = cm.course_id
                LEFT JOIN course_lessons cl ON cm.id = cl.module_id
                LEFT JOIN lesson_progress lp ON cl.id = lp.lesson_id AND lp.user_id = e.user_id
                WHERE e.user_id = ? AND e.payment_status = 'completed'
            `, [userId]);

            // Learning activity by day (last 30 days)
            const [dailyActivity] = await pool.execute(`
                SELECT 
                    DATE(lp.completed_at) as date,
                    COUNT(lp.id) as lessons_completed,
                    SUM(lp.watch_time_seconds) as watch_time_seconds
                FROM lesson_progress lp
                WHERE lp.user_id = ? 
                    AND lp.completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    AND lp.is_completed = TRUE
                GROUP BY DATE(lp.completed_at)
                ORDER BY date DESC
            `, [userId]);

            res.json({
                success: true,
                data: {
                    type: 'student',
                    analytics: studentAnalytics[0],
                    daily_activity: dailyActivity
                }
            });

        } else if (userRole === 'teacher') {
            // Teacher analytics
            const [teacherAnalytics] = await pool.execute(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_courses,
                    COUNT(CASE WHEN c.is_published = TRUE THEN 1 END) as published_courses,
                    COUNT(DISTINCT e.user_id) as total_students,
                    SUM(e.amount_paid) as total_earnings,
                    AVG(r.rating) as avg_rating,
                    COUNT(r.id) as total_reviews
                FROM courses c
                LEFT JOIN enrollments e ON c.id = e.course_id AND e.payment_status = 'completed'
                LEFT JOIN course_reviews r ON c.id = r.course_id AND r.is_approved = TRUE
                WHERE c.teacher_id = ?
            `, [userId]);

            res.json({
                success: true,
                data: {
                    type: 'teacher',
                    analytics: teacherAnalytics[0]
                }
            });
        } else {
            res.status(403).json({
                success: false,
                message: 'Access denied'
            });
        }

    } catch (error) {
        console.error('User analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load user analytics'
        });
    }
};

module.exports = {
    getStudentDashboard,
    getTeacherDashboard,
    getAdminDashboard,
    getUserAnalytics
};