const { pool } = require('../config/database');

// Get all categories (simplified)
const getCategories = async (req, res) => {
    try {
        // For now, return static data
        const categories = [
            { id: 1, name: 'Computer Science & Engineering', slug: 'computer-science' },
            { id: 2, name: 'Mathematics', slug: 'mathematics' },
            { id: 3, name: 'Physics', slug: 'physics' },
            { id: 4, name: 'Economics', slug: 'economics' },
            { id: 5, name: 'Business Administration', slug: 'business' }
        ];

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

// Get all courses (simplified)
const getCourses = async (req, res) => {
    try {
        // For now, return static data
        const courses = [
            {
                id: 1,
                title: 'Data Structures and Algorithms - CSE 201',
                slug: 'data-structures-algorithms-cse201',
                short_description: 'Master data structures and algorithms essential for computer science students.',
                course_code: 'CSE201',
                course_type: 'hybrid',
                price: 3500,
                discount_price: 2999,
                academic_level: 'undergraduate',
                semester: 'Spring 2024',
                credits: 3,
                university: 'Dhaka University',
                department: 'Computer Science & Engineering',
                teacher_name: 'Dr. Mahmud Hassan',
                category_name: 'Computer Science & Engineering'
            },
            {
                id: 2, 
                title: 'Calculus I - MATH 101',
                slug: 'calculus-1-math101',
                short_description: 'Learn the fundamentals of calculus including limits, derivatives, and integrals.',
                course_code: 'MATH101',
                course_type: 'pre_recorded',
                price: 2800,
                academic_level: 'undergraduate',
                semester: 'Spring 2024',
                credits: 4,
                university: 'BUET',
                department: 'Mathematics',
                teacher_name: 'Prof. Rashida Rahman',
                category_name: 'Mathematics'
            }
        ];

        res.json({
            success: true,
            message: 'Courses retrieved successfully',
            data: {
                courses: courses,
                pagination: {
                    page: 1,
                    limit: 12,
                    total: courses.length,
                    totalPages: 1
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

// Get single course (simplified)
const getCourse = async (req, res) => {
    try {
        const { slug } = req.params;
        
        // Static course data for testing
        const course = {
            id: 1,
            title: 'Data Structures and Algorithms - CSE 201',
            slug: 'data-structures-algorithms-cse201',
            description: 'Comprehensive course covering fundamental data structures and algorithms essential for computer science students.',
            short_description: 'Master data structures and algorithms essential for computer science students.',
            course_code: 'CSE201',
            course_type: 'hybrid',
            price: 3500,
            discount_price: 2999,
            academic_level: 'undergraduate',
            semester: 'Spring 2024',
            credits: 3,
            university: 'Dhaka University',
            department: 'Computer Science & Engineering',
            duration_weeks: 16,
            max_students: 50,
            current_enrolled: 25,
            teacher_name: 'Dr. Mahmud Hassan',
            category_name: 'Computer Science & Engineering',
            learning_objectives: 'Understand and implement fundamental data structures; Analyze algorithm complexity',
            course_outline: 'Week 1-2: Arrays & Strings; Week 3-4: Linked Lists; Week 5-6: Stacks & Queues',
            spots_available: 25,
            is_enrollment_open: true
        };

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

// Create course (simplified)
const createCourse = async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Course creation endpoint - implementation coming soon',
            data: {
                note: 'This is a placeholder. Full implementation in next step.'
            }
        });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create course'
        });
    }
};

// Update course (simplified)
const updateCourse = async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Course update endpoint - implementation coming soon'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update course'
        });
    }
};

// Get teacher courses (simplified)
const getTeacherCourses = async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Teacher courses endpoint working',
            data: {
                courses: [],
                note: 'Full implementation coming soon'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get teacher courses'
        });
    }
};

// Delete course (simplified)
const deleteCourse = async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Course deletion endpoint - implementation coming soon'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete course'
        });
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