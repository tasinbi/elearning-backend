const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
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
    
    // Create upload directories if they don't exist
    createUploadDirectories();
};

// Create upload directories
const createUploadDirectories = () => {
    const uploadDirs = [
        'src/uploads',
        'src/uploads/images',
        'src/uploads/videos',
        'src/uploads/documents',
        'src/uploads/audios',
        'src/uploads/temp'
    ];
    
    uploadDirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Created directory: ${dir}`);
        }
    });
};

// Enhanced static file serving with better organization
app.use('/uploads/images', express.static(path.join(__dirname, 'src/uploads/images')));
app.use('/uploads/videos', express.static(path.join(__dirname, 'src/uploads/videos')));
app.use('/uploads/documents', express.static(path.join(__dirname, 'src/uploads/documents')));
app.use('/uploads/audios', express.static(path.join(__dirname, 'src/uploads/audios')));

// Fallback for legacy uploads
app.use('/uploads', express.static(path.join(__dirname, 'src/uploads')));

// File download route with access control
app.get('/api/files/download/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const { pool } = require('./src/config/database');
        
        // Get file info
        const [files] = await pool.execute(
            'SELECT * FROM uploaded_files WHERE id = ?',
            [fileId]
        );
        
        if (!files.length) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        const file = files[0];
        
        // Check if file exists
        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({
                success: false,
                message: 'Physical file not found'
            });
        }
        
        // Set appropriate headers
        res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
        res.setHeader('Content-Type', file.mime_type);
        
        // Log download (optional)
        if (req.headers.authorization) {
            console.log(`📥 File downloaded: ${file.original_name} by user`);
        }
        
        // Send file
        res.sendFile(path.resolve(file.file_path));
        
    } catch (error) {
        console.error('File download error:', error);
        res.status(500).json({
            success: false,
            message: 'Download failed'
        });
    }
});

// File preview route (for images and documents)
app.get('/api/files/preview/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const { pool } = require('./src/config/database');
        
        const [files] = await pool.execute(
            'SELECT * FROM uploaded_files WHERE id = ?',
            [fileId]
        );
        
        if (!files.length) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        const file = files[0];
        
        // Only allow preview for certain file types
        const previewableTypes = ['image/', 'application/pdf', 'text/'];
        const isPreviewable = previewableTypes.some(type => file.mime_type.startsWith(type));
        
        if (!isPreviewable) {
            return res.status(400).json({
                success: false,
                message: 'File type not previewable'
            });
        }
        
        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({
                success: false,
                message: 'Physical file not found'
            });
        }
        
        // Set headers for inline display
        res.setHeader('Content-Type', file.mime_type);
        res.setHeader('Content-Disposition', 'inline');
        
        res.sendFile(path.resolve(file.file_path));
        
    } catch (error) {
        console.error('File preview error:', error);
        res.status(500).json({
            success: false,
            message: 'Preview failed'
        });
    }
});

// File streaming route (for videos/audios)
app.get('/api/files/stream/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        const { pool } = require('./src/config/database');
        
        const [files] = await pool.execute(
            'SELECT * FROM uploaded_files WHERE id = ? AND file_category IN ("video", "audio")',
            [fileId]
        );
        
        if (!files.length) {
            return res.status(404).json({
                success: false,
                message: 'Media file not found'
            });
        }
        
        const file = files[0];
        
        if (!fs.existsSync(file.file_path)) {
            return res.status(404).json({
                success: false,
                message: 'Physical file not found'
            });
        }
        
        const stat = fs.statSync(file.file_path);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
            // Support for video/audio streaming with range requests
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file_stream = fs.createReadStream(file.file_path, { start, end });
            
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': file.mime_type,
            };
            
            res.writeHead(206, head);
            file_stream.pipe(res);
        } else {
            const head = {
                'Content-Length': fileSize,
                'Content-Type': file.mime_type,
            };
            
            res.writeHead(200, head);
            fs.createReadStream(file.file_path).pipe(res);
        }
        
    } catch (error) {
        console.error('File streaming error:', error);
        res.status(500).json({
            success: false,
            message: 'Streaming failed'
        });
    }
});

// Routes
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/profile', require('./src/routes/profile'));
app.use('/api/courses', require('./src/routes/courses'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/upload', require('./src/routes/upload'));

// Test route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'E-learning Backend Server is running!',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        features: ['Authentication', 'Courses', 'Payments', 'File Upload', 'User Management'],
        routes: {
            auth: '/api/auth',
            profile: '/api/profile', 
            courses: '/api/courses',
            payment: '/api/payment',
            upload: '/api/upload',
            files: '/api/files'
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
        memory: process.memoryUsage(),
        features: {
            database: 'MySQL',
            fileStorage: 'Local',
            payment: 'SSL Commerz',
            authentication: 'JWT + OTP'
        }
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
                total_users: rows[0].user_count,
                database: process.env.DB_NAME,
                host: process.env.DB_HOST
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

// File system test route
app.get('/api/file-system-test', (req, res) => {
    try {
        const uploadDirs = [
            'src/uploads/images',
            'src/uploads/videos',
            'src/uploads/documents',
            'src/uploads/audios'
        ];
        
        const dirStatus = uploadDirs.map(dir => ({
            directory: dir,
            exists: fs.existsSync(dir),
            writable: fs.existsSync(dir) ? true : false
        }));
        
        res.json({
            success: true,
            message: 'File system test completed',
            data: {
                uploadDirectories: dirStatus,
                maxFileSize: process.env.MAX_FILE_SIZE,
                uploadDir: process.env.UPLOAD_DIR
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'File system test failed',
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
                'GET /api/upload/config': 'Get upload configuration',
                'POST /api/upload/test': 'Test file upload (Protected)',
                'POST /api/upload/course-thumbnail': 'Upload course thumbnail (Teacher)',
                'POST /api/upload/course-video': 'Upload course video (Teacher)',
                'POST /api/upload/course-document': 'Upload course document (Teacher)',
                'POST /api/upload/course-audio': 'Upload course audio (Teacher)',
                'POST /api/upload/profile-picture': 'Upload profile picture (Protected)',
                'POST /api/upload/bulk-upload': 'Bulk file upload (Teacher)',
                'GET /api/upload/my-files': 'Get user files (Protected)',
                'GET /api/upload/course-files/:courseId': 'Get course files (Teacher)',
                'GET /api/upload/stats': 'Get file statistics (Protected)',
                'DELETE /api/upload/files/:fileId': 'Delete file (Protected)'
            },
            files: {
                'GET /api/files/download/:fileId': 'Download file',
                'GET /api/files/preview/:fileId': 'Preview file (images/PDFs)',
                'GET /api/files/stream/:fileId': 'Stream media file (videos/audios)'
            },
            system: {
                'GET /api/health': 'Health check',
                'GET /api/db-test': 'Database connection test',
                'GET /api/file-system-test': 'File system test',
                'GET /api/routes': 'List all routes'
            }
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.path}`,
        suggestion: 'Check /api/routes for available endpoints',
        timestamp: new Date().toISOString()
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error:', error);
    
    // Multer file upload errors
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            message: 'File too large',
            maxSize: process.env.MAX_FILE_SIZE
        });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
            success: false,
            message: 'Too many files',
            maxFiles: process.env.MAX_BULK_FILES || 10
        });
    }
    
    res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🔄 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 E-Learning Backend Server Started Successfully!
🌍 Environment: ${process.env.NODE_ENV}
🔗 URL: http://localhost:${PORT}
📱 API Health: http://localhost:${PORT}/api/health
📋 All Routes: http://localhost:${PORT}/api/routes
🧪 File System Test: http://localhost:${PORT}/api/file-system-test

🔐 Authentication Routes:
   POST /api/auth/send-otp               - Send OTP for login
   POST /api/auth/verify-otp             - Verify OTP and login

👤 Profile Management:
   GET  /api/profile                     - Get user profile (Protected)
   PUT  /api/profile                     - Update profile (Protected)  
   GET  /api/profile/all-users           - Get all users (Admin)
   PUT  /api/profile/change-role         - Change user role (Admin)

🎓 Course Management:
   GET  /api/courses/categories          - Get all categories
   GET  /api/courses                     - Get all courses
   GET  /api/courses/:slug               - Get single course by slug
   POST /api/courses                     - Create course (Teacher)
   PUT  /api/courses/:id                 - Update course (Teacher)
   GET  /api/courses/teacher/my-courses  - Get teacher courses (Teacher)
   DELETE /api/courses/:id               - Delete course (Teacher)

💳 Payment System:
   GET  /api/payment/methods             - Get payment methods (Protected)
   POST /api/payment/initiate            - Initiate payment (Protected)
   GET  /api/payment/my-enrollments      - Get user enrollments (Protected)
   GET  /api/payment/enrollment-status/:courseId - Check enrollment status

📁 File Upload System:
   GET  /api/upload/config               - Get upload configuration
   POST /api/upload/test                 - Test file upload (Protected)
   POST /api/upload/course-thumbnail     - Upload course thumbnail (Teacher)
   POST /api/upload/course-video         - Upload course video (Teacher)
   POST /api/upload/course-document      - Upload course document (Teacher)
   POST /api/upload/course-audio         - Upload course audio (Teacher)
   POST /api/upload/profile-picture      - Upload profile picture (Protected)
   POST /api/upload/bulk-upload          - Bulk file upload (Teacher)
   GET  /api/upload/my-files             - Get user files (Protected)
   GET  /api/upload/stats                - Get file statistics (Protected)
   DELETE /api/upload/files/:fileId      - Delete file (Protected)

🎬 File Access System:
   GET  /api/files/download/:fileId      - Download file
   GET  /api/files/preview/:fileId       - Preview file (images/PDFs)
   GET  /api/files/stream/:fileId        - Stream media file (videos/audios)

🔧 System Routes:
   GET  /api/health                      - Health check
   GET  /api/db-test                     - Database connection test
   GET  /api/file-system-test            - File system test

📊 File Storage Info:
   Images: Max 10MB      → /uploads/images/
   Videos: Max 500MB     → /uploads/videos/
   Documents: Max 50MB   → /uploads/documents/
   Audios: Max 100MB     → /uploads/audios/
   
🔒 Security: JWT + OTP Authentication
💾 Database: MySQL (${process.env.DB_NAME})
💳 Payment: SSL Commerz (Sandbox Mode)
📁 Storage: Local File System (Ready for Cloud Migration)
    `);
    
    startServer();
});