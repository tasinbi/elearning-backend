const { pool } = require('../config/database');
const { validationResult } = require('express-validator');

// Get all categories
const getCategories = async (req, res) => {
    try {
        const [categories] = await pool.execute(
            'SELECT id, name, slug, description FROM categories WHERE is_active = TRUE ORDER BY name'
        );

        res.json({
            success: true,
            message: 'Categories retrieved successfully',
            data: categories
        });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve categories'
        });
    }
};

// Get all courses with filtering and pagination
const getCourses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const category = req.query.category;
        const search = req.query.search;
        const level = req.query.level;
        const type = req.query.type;
        const university = req.query.university;
        const sortBy = req.query.sortBy || 'created_at';
        const sortOrder = req.query.sortOrder || 'DESC';

        const offset = (page - 1) * limit;
        
        let whereConditions = ['c.is_published = TRUE'];
        let params = [];

        // Add filters
        if (category) {
            whereConditions.push('cat.slug = ?');
            params.push(category);
        }

        if (search) {
            whereConditions.push('(MATCH(c.title, c.description, c.short_description) AGAINST(? IN NATURAL LANGUAGE MODE) OR c.course_code LIKE ?)');
            params.push(search, `%${search}%`);
        }

        if (level) {
            whereConditions.push('c.academic_level = ?');
            params.push(level);
        }

        if (type) {
            whereConditions.push('c.course_type = ?');
            params.push(type);
        }

        if (university) {
            whereConditions.push('c.university LIKE ?');
            params.push(`%${university}%`);
        }

        const whereClause = whereConditions.join(' AND ');

        // Count total courses
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM courses c
            LEFT JOIN categories cat ON c.category_id = cat.id
            WHERE ${whereClause}
        `;
        const [countResult] = await pool.execute(countQuery, params);
        const total = countResult[0].total;

        // Get courses
        const coursesQuery = `
            SELECT 
                c.id, c.title, c.slug, c.short_description, c.course_code,
                c.course_type, c.academic_level, c.semester, c.credits,
                c.university, c.department, c.price, c.discount_price,
                c.duration_weeks, c.max_students, c.thumbnail, c.created_at,
                cat.name as category_name, cat.slug as category_slug,
                u.name as teacher_name,
                COALESCE(c.discount_price, c.price) as final_price,
                (c.max_students - COALESCE(enrolled_count.count, 0)) as spots_available,
                COALESCE(enrolled_count.count, 0) as current_enrolled,
                COALESCE(review_stats.avg_rating, 0) as avg_rating,
                COALESCE(review_stats.review_count, 0) as review_count
            FROM courses c
            LEFT JOIN categories cat ON c.category_id = cat.id
            LEFT JOIN users u ON c.teacher_id = u.id
            LEFT JOIN (
                SELECT course_id, COUNT(*) as count 
                FROM enrollments 
                WHERE payment_status = 'completed' 
                GROUP BY course_id
            ) enrolled_count ON c.id = enrolled_count.course_id
            LEFT JOIN (
                SELECT course_id, AVG(rating) as avg_rating, COUNT(*) as review_count
                FROM course_reviews 
                WHERE is_approved = TRUE
                GROUP BY course_id
            ) review_stats ON c.id = review_stats.course_id
            WHERE ${whereClause}
            ORDER BY c.${sortBy} ${sortOrder}
            LIMIT ? OFFSET ?
        `;
        
        params.push(limit, offset);
        const [courses] = await pool.execute(coursesQuery, params);

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            message: 'Courses retrieved successfully',
            data: {
                courses: courses,
                pagination: {
                    page: page,
                    limit: limit,
                    total: total,
                    totalPages: totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                filters: {
                    category,
                    search,
                    level,
                    type,
                    university,
                    sortBy,
                    sortOrder
                }
            }
        });
    } catch (error) {
        console.error('Get courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve courses'
        });
    }
};

// Get single course by slug
const getCourse = async (req, res) => {
    try {
        const { slug } = req.params;
        
        const [courses] = await pool.execute(`
            SELECT 
                c.*, 
                cat.name as category_name, cat.slug as category_slug,
                u.name as teacher_name, u.email as teacher_email, u.bio as teacher_bio,
                COALESCE(c.discount_price, c.price) as final_price,
                (c.max_students - COALESCE(enrolled_count.count, 0)) as spots_available,
                COALESCE(enrolled_count.count, 0) as current_enrolled,
                COALESCE(review_stats.avg_rating, 0) as avg_rating,
                COALESCE(review_stats.review_count, 0) as review_count
            FROM courses c
            LEFT JOIN categories cat ON c.category_id = cat.id
            LEFT JOIN users u ON c.teacher_id = u.id
            LEFT JOIN (
                SELECT course_id, COUNT(*) as count 
                FROM enrollments 
                WHERE payment_status = 'completed' 
                GROUP BY course_id
            ) enrolled_count ON c.id = enrolled_count.course_id
            LEFT JOIN (
                SELECT course_id, AVG(rating) as avg_rating, COUNT(*) as review_count
                FROM course_reviews 
                WHERE is_approved = TRUE
                GROUP BY course_id
            ) review_stats ON c.id = review_stats.course_id
            WHERE c.slug = ? AND c.is_published = TRUE
        `, [slug]);

        if (!courses.length) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        const course = courses[0];

        // Get course modules
        const [modules] = await pool.execute(`
            SELECT id, title, description, order_index, duration_minutes
            FROM course_modules 
            WHERE course_id = ? AND is_published = TRUE 
            ORDER BY order_index
        `, [course.id]);

        // Get lessons for each module
        for (let module of modules) {
            const [lessons] = await pool.execute(`
                SELECT id, title, description, lesson_type, video_duration, order_index, is_free
                FROM course_lessons 
                WHERE module_id = ? AND is_published = TRUE 
                ORDER BY order_index
            `, [module.id]);
            module.lessons = lessons;
        }

        // Get recent reviews
        const [reviews] = await pool.execute(`
            SELECT r.rating, r.review_text, r.created_at, u.name as student_name
            FROM course_reviews r
            JOIN users u ON r.user_id = u.id
            WHERE r.course_id = ? AND r.is_approved = TRUE
            ORDER BY r.created_at DESC
            LIMIT 5
        `, [course.id]);

        course.modules = modules;
        course.recent_reviews = reviews;

        res.json({
            success: true,
            message: 'Course retrieved successfully',
            data: course
        });
    } catch (error) {
        console.error('Get course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve course'
        });
    }
};

// Create new course (Teacher only)
const createCourse = async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const teacherId = req.user.id;
        const {
            title, description, short_description, course_code, category_id,
            course_type, academic_level, semester, credits, university, department,
            price, discount_price, duration_weeks, max_students,
            learning_objectives, course_outline, prerequisites, thumbnail
        } = req.body;

        // Generate slug from title
        const slug = title.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

        // Check if slug already exists
        const [existingSlugs] = await connection.execute(
            'SELECT id FROM courses WHERE slug = ?',
            [slug]
        );

        const finalSlug = existingSlugs.length ? `${slug}-${Date.now()}` : slug;

        // Insert course
        const [result] = await connection.execute(`
            INSERT INTO courses (
                title, slug, description, short_description, course_code, category_id, teacher_id,
                course_type, academic_level, semester, credits, university, department,
                price, discount_price, duration_weeks, max_students,
                learning_objectives, course_outline, prerequisites, thumbnail
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            title, finalSlug, description, short_description, course_code, category_id, teacherId,
            course_type, academic_level, semester, credits, university, department,
            price, discount_price, duration_weeks, max_students,
            learning_objectives, course_outline, prerequisites, thumbnail
        ]);

        const courseId = result.insertId;

        await connection.commit();

        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            data: {
                courseId: courseId,
                slug: finalSlug,
                title: title
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Create course error:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                success: false,
                message: 'Course code already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create course'
        });
    } finally {
        connection.release();
    }
};

// Update course (Teacher only)
const updateCourse = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { id } = req.params;
        const teacherId = req.user.id;
        const userRole = req.user.role;

        // Check if course exists and belongs to teacher (unless admin)
        let query = 'SELECT id, teacher_id, title FROM courses WHERE id = ?';
        let params = [id];

        if (userRole !== 'admin') {
            query += ' AND teacher_id = ?';
            params.push(teacherId);
        }

        const [courses] = await pool.execute(query, params);

        if (!courses.length) {
            return res.status(404).json({
                success: false,
                message: 'Course not found or you do not have permission to edit it'
            });
        }

        // Build update query dynamically
        const allowedFields = [
            'title', 'description', 'short_description', 'course_type',
            'academic_level', 'semester', 'credits', 'price', 'discount_price',
            'duration_weeks', 'max_students', 'learning_objectives',
            'course_outline', 'prerequisites', 'thumbnail', 'is_published'
        ];

        const updateFields = [];
        const updateValues = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updateFields.push(`${field} = ?`);
                updateValues.push(req.body[field]);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(id);

        const updateQuery = `UPDATE courses SET ${updateFields.join(', ')} WHERE id = ?`;
        await pool.execute(updateQuery, updateValues);

        res.json({
            success: true,
            message: 'Course updated successfully'
        });

    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update course'
        });
    }
};

// Get teacher's courses
const getTeacherCourses = async (req, res) => {
    try {
        const teacherId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status; // published, draft, all

        const offset = (page - 1) * limit;
        
        let whereCondition = 'c.teacher_id = ?';
        let params = [teacherId];

        if (status === 'published') {
            whereCondition += ' AND c.is_published = TRUE';
        } else if (status === 'draft') {
            whereCondition += ' AND c.is_published = FALSE';
        }

        // Count total courses
        const [countResult] = await pool.execute(
            `SELECT COUNT(*) as total FROM courses c WHERE ${whereCondition}`,
            params
        );
        const total = countResult[0].total;

        // Get courses
        const [courses] = await pool.execute(`
            SELECT 
                c.id, c.title, c.slug, c.course_code, c.course_type,
                c.academic_level, c.semester, c.price, c.discount_price,
                c.is_published, c.is_enrollment_open, c.created_at, c.updated_at,
                cat.name as category_name,
                COALESCE(enrolled_count.count, 0) as total_students,
                COALESCE(revenue.total, 0) as total_revenue
            FROM courses c
            LEFT JOIN categories cat ON c.category_id = cat.id
            LEFT JOIN (
                SELECT course_id, COUNT(*) as count 
                FROM enrollments 
                WHERE payment_status = 'completed' 
                GROUP BY course_id
            ) enrolled_count ON c.id = enrolled_count.course_id
            LEFT JOIN (
                SELECT course_id, SUM(amount_paid) as total 
                FROM enrollments 
                WHERE payment_status = 'completed' 
                GROUP BY course_id
            ) revenue ON c.id = revenue.course_id
            WHERE ${whereCondition}
            ORDER BY c.updated_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            message: 'Teacher courses retrieved successfully',
            data: {
                courses: courses,
                pagination: {
                    page: page,
                    limit: limit,
                    total: total,
                    totalPages: totalPages
                }
            }
        });

    } catch (error) {
        console.error('Get teacher courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get teacher courses'
        });
    }
};

// Delete course (Teacher only)
const deleteCourse = async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const { id } = req.params;
        const teacherId = req.user.id;
        const userRole = req.user.role;

        // Check if course exists and belongs to teacher
        let query = 'SELECT id, teacher_id, title FROM courses WHERE id = ?';
        let params = [id];

        if (userRole !== 'admin') {
            query += ' AND teacher_id = ?';
            params.push(teacherId);
        }

        const [courses] = await connection.execute(query, params);

        if (!courses.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Course not found or you do not have permission to delete it'
            });
        }

        // Check if there are any completed enrollments
        const [enrollments] = await connection.execute(
            'SELECT COUNT(*) as count FROM enrollments WHERE course_id = ? AND payment_status = "completed"',
            [id]
        );

        if (enrollments[0].count > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Cannot delete course with active enrollments'
            });
        }

        // Delete course (cascading will handle modules and lessons)
        await connection.execute('DELETE FROM courses WHERE id = ?', [id]);

        await connection.commit();

        res.json({
            success: true,
            message: 'Course deleted successfully'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Delete course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete course'
        });
    } finally {
        connection.release();
    }
};

module.exports = {
    getCategories,
    getCourses,
    getCourse,
    createCourse,
    updateCourse,
    getTeacherCourses,
    deleteCourse
};