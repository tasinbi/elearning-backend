const express = require('express');
const cors = require('cors');
const path = require('path'); // <- Add this line
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

// Serve uploaded files (FIXED - path now imported)
app.use('/uploads', express.static(path.join(__dirname, 'src/uploads')));

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/courses', require('./src/routes/courses'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/upload', require('./src/routes/upload')); // <- Add this line

// Test route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'E-learning Backend Server is running!',
        timestamp: new Date().toISOString(),
        routes: {
            auth: '/api/auth',
            profile: '/api/profile', 
            courses: '/api/courses',
            payment: '/api/payment',
            upload: '/api/upload'  // <- Add this
        }
    });
});

// Health check route
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is healthy',
        port: PORT,
        environment: process.env.NODE_ENV
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
                'GET /api/payment/enrollment-status/:courseId': 'Check enrollment status (Protected)'
            },
            upload: {
                'POST /api/upload/test': 'Test file upload (Protected)',
                'POST /api/upload/course-thumbnail': 'Upload course thumbnail (Teacher only)'
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
        message: error.message || 'Internal server error'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 Server running on port ${PORT}
🌍 Environment: ${process.env.NODE_ENV}
🔗 URL: http://localhost:${PORT}
📱 API Health: http://localhost:${PORT}/api/health
📋 All Routes: http://localhost:${PORT}/api/routes

🔐 Auth Routes:
   POST /api/auth/send-otp
   POST /api/auth/verify-otp

👤 Profile Routes:
   GET    /api/profile (Protected)
   PUT    /api/profile (Protected)  
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
    `);
    
    startServer();
});