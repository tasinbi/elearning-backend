const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Database import
const { testConnection } = require('./src/config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Test database connection on server start
const startServer = async () => {
    const dbConnected = await testConnection();
    if (!dbConnected) {
        console.log('⚠️  Server starting without database connection');
    }
};

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'src/uploads')));

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/courses', require('./src/routes/courses'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/dashboard', require('./src/routes/dashboard')); // New dashboard routes
app.use('/api/progress', require('./src/routes/progress')); // New progress routes

// Test route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'E-learning Backend Server is running!',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        routes: {
            auth: '/api/auth',
            profile: '/api/profile', 
            courses: '/api/courses',
            payment: '/api/payment',
            upload: '/api/upload',
            dashboard: '/api/dashboard',
            progress: '/api/progress'
        }
    });
});

// Health check route
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is healthy',
        port: PORT,
        environment: process.env.NODE_ENV,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Database test route
app.get('/api/db-test', async (req, res) => {
    try {
        const { pool } = require('./src/config/database');
        const [rows] = await pool.execute('SELECT COUNT(*) as user_count FROM users');
        
        res.json({
            success: true,
            message: 'Database connection working!',
            data: {
                total_users: rows[0].user_count
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

// List all available routes
app.get('/api/routes', (req, res) => {
    res.json({
        success: true,
        message: 'Available API routes',
        data: {
            auth: {
                'POST /api/auth/send-otp': 'Send OTP for login',
                'POST /api/auth/verify-otp': 'Verify OTP and login'
            },
            profile: {
                'GET /api/profile': 'Get user profile (Protected)',
                'PUT /api/profile': 'Update profile (Protected)',
                'DELETE /api/profile': 'Delete account (Protected)',
                'GET /api/profile/all-users': 'Get all users (Admin only)',
                'PUT /api/profile/change-role': 'Change user role (Admin only)'
            },
            courses: {
                'GET /api/courses/categories': 'Get all categories',
                'GET /api/courses': 'Get all courses with filters',
                'GET /api/courses/:slug': 'Get single course by slug',
                'POST /api/courses': 'Create course (Teacher only)',
                'PUT /api/courses/:id': 'Update course (Teacher only)',
                'GET /api/courses/teacher/my-courses': 'Get teacher courses (Teacher only)',
                'DELETE /api/courses/:id': 'Delete course (Teacher only)'
            },
            payment: {
                'GET /api/payment/methods': 'Get payment methods (Protected)',
                'POST /api/payment/initiate': 'Initiate payment (Protected)',
                'GET /api/payment/my-enrollments': 'Get user enrollments (Protected)',
                'GET /api/payment/enrollment-status/:courseId': 'Check enrollment status (Protected)',
                'POST /api/payment/ssl/success': 'SSL Commerz success callback',
                'POST /api/payment/ssl/fail': 'SSL Commerz fail callback',
                'POST /api/payment/ssl/cancel': 'SSL Commerz cancel callback'
            },
            upload: {
                'POST /api/upload/test': 'Test file upload (Protected)',
                'POST /api/upload/course-thumbnail': 'Upload course thumbnail (Teacher only)'
            },
            dashboard: {
                'GET /api/dashboard': 'Get dashboard redirect based on role (Protected)',
                'GET /api/dashboard/student': 'Student dashboard (Student only)',
                'GET /api/dashboard/teacher': 'Teacher dashboard (Teacher only)',
                'GET /api/dashboard/admin': 'Admin dashboard (Admin only)',
                'GET /api/dashboard/analytics': 'User analytics (Protected)'
            },
            progress: {
                'POST /api/progress/lesson': 'Update lesson progress (Student only)',
                'GET /api/progress/course/:courseId': 'Get course progress (Student only)',
                'GET /api/progress/lesson/:lessonId': 'Get lesson with progress (Student only)',
                'POST /api/progress/lesson/:lessonId/complete': 'Mark lesson completed (Student only)',
                'GET /api/progress/statistics': 'Get learning statistics (Student only)',
                'GET /api/progress/overview': 'Get progress overview (Student only)'
            }
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.path}`,
        suggestion: 'Check /api/routes for available endpoints'
    });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 E-Learning Backend Server v2.0
🌟 Enhanced with Dashboard & Progress Tracking

📊 Server Info:
   Port: ${PORT}
   Environment: ${process.env.NODE_ENV || 'development'}
   URL: http://localhost:${PORT}

🔍 Quick Links:
   📋 All Routes: http://localhost:${PORT}/api/routes
   🏥 Health Check: http://localhost:${PORT}/api/health
   💾 DB Test: http://localhost:${PORT}/api/db-test

🔐 Authentication Routes:
   POST /api/auth/send-otp
   POST /api/auth/verify-otp

👤 Profile Routes:
   GET    /api/profile (Protected)
   PUT    /api/profile (Protected)  
   DELETE /api/profile (Protected)
   GET    /api/profile/all-users (Admin)
   PUT    /api/profile/change-role (Admin)

🎓 Course Routes:
   GET    /api/courses/categories
   GET    /api/courses
   GET    /api/courses/:slug  
   POST   /api/courses (Teacher)
   PUT    /api/courses/:id (Teacher)
   GET    /api/courses/teacher/my-courses (Teacher)
   DELETE /api/courses/:id (Teacher)

💳 Payment Routes:
   GET    /api/payment/methods (Protected)
   POST   /api/payment/initiate (Protected)
   GET    /api/payment/my-enrollments (Protected)
   GET    /api/payment/enrollment-status/:courseId (Protected)

📁 Upload Routes:
   POST   /api/upload/test (Protected)
   POST   /api/upload/course-thumbnail (Teacher)

📊 Dashboard Routes:
   GET    /api/dashboard (Protected - Role-based redirect)
   GET    /api/dashboard/student (Student)
   GET    /api/dashboard/teacher (Teacher)
   GET    /api/dashboard/admin (Admin)
   GET    /api/dashboard/analytics (Protected)

📈 Progress Routes:
   POST   /api/progress/lesson (Student - Update lesson progress)
   GET    /api/progress/course/:courseId (Student)
   GET    /api/progress/lesson/:lessonId (Student)
   POST   /api/progress/lesson/:lessonId/complete (Student)
   GET    /api/progress/statistics (Student)
   GET    /api/progress/overview (Student)

🎯 Ready for Frontend Development!
    `);
    
    startServer();
});