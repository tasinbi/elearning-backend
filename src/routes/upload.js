const express = require('express');
const router = express.Router();
const multer = require('multer'); // <- Missing import added
const { body, param, query } = require('express-validator');
const { pool } = require('../config/database');

const {
    // Middlewares
    imageUpload,
    videoUpload,
    documentUpload,
    audioUpload,
    multipleUpload,
    
    // Controllers
    uploadCourseThumbnail,
    uploadCourseVideo,
    uploadCourseDocument,
    uploadBulkFiles,
    getUserFiles,
    deleteFile
} = require('../controllers/fileController');

const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Validation rules
const fileUploadValidation = [
    body('courseId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Course ID must be a valid number')
];

const getUserFilesValidation = [
    query('category')
        .optional()
        .isIn(['image', 'video', 'document', 'audio'])
        .withMessage('Invalid file category'),
    query('courseId')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Course ID must be a valid number'),
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive number'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('Limit must be between 1 and 50')
];

const deleteFileValidation = [
    param('fileId')
        .isInt({ min: 1 })
        .withMessage('File ID must be a valid number')
];

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
    console.error('Upload error:', error);
    
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'File too large. Please check file size limits.',
                maxSize: process.env.MAX_FILE_SIZE || '10MB'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: 'Too many files. Maximum 10 files allowed.',
                maxFiles: 10
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: 'Unexpected field name. Check your form field names.'
            });
        }
    }
    
    if (error.message) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
    
    // Pass to global error handler
    next(error);
};

// Helper function to save file to database (if not available in controller)
const saveFileToDatabase = async (fileData, userId, courseId = null) => {
    try {
        const detectFileCategory = (mimetype) => {
            if (mimetype.startsWith('image/')) return 'image';
            if (mimetype.startsWith('video/')) return 'video';
            if (mimetype.startsWith('audio/')) return 'audio';
            if (mimetype === 'application/pdf' || mimetype.includes('document')) return 'document';
            return 'other';
        };
        
        const [result] = await pool.execute(`
            INSERT INTO uploaded_files (
                user_id, course_id, original_name, file_name, file_path, 
                file_size, mime_type, file_category, storage_type, is_processed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            userId, courseId, fileData.originalname, fileData.filename, 
            fileData.path, fileData.size, fileData.mimetype, 
            detectFileCategory(fileData.mimetype), 'local', true
        ]);
        
        return result.insertId;
    } catch (error) {
        console.error('Database save error:', error);
        throw error;
    }
};

// ================== PUBLIC ROUTES ==================

// Get file info (for public access - if needed later)
router.get('/info/:fileId', async (req, res) => {
    try {
        const { fileId } = req.params;
        
        const [files] = await pool.execute(
            'SELECT id, original_name, file_size, mime_type, file_category, created_at FROM uploaded_files WHERE id = ?',
            [fileId]
        );
        
        if (!files.length) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        res.json({
            success: true,
            data: files[0]
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get file info'
        });
    }
});

// ================== PROTECTED ROUTES ==================

// Course thumbnail upload (Teachers only)
router.post('/course-thumbnail', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    imageUpload.single('thumbnail'),
    handleUploadError,
    fileUploadValidation,
    uploadCourseThumbnail
);

// Course video upload (Teachers only)
router.post('/course-video', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    videoUpload.single('video'),
    handleUploadError,
    fileUploadValidation,
    uploadCourseVideo
);

// Course document upload (Teachers only)
router.post('/course-document', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    documentUpload.single('document'),
    handleUploadError,
    fileUploadValidation,
    uploadCourseDocument
);

// Course audio upload (Teachers only)
router.post('/course-audio', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    audioUpload.single('audio'),
    handleUploadError,
    fileUploadValidation,
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No audio file uploaded'
                });
            }

            const userId = req.user.id;
            const fileData = req.file;

            // Save to database
            const fileId = await saveFileToDatabase(fileData, userId, req.body.courseId);

            res.json({
                success: true,
                message: 'Audio uploaded successfully',
                data: {
                    fileId: fileId,
                    filename: fileData.filename,
                    originalName: fileData.originalname,
                    size: fileData.size,
                    url: `/uploads/audios/${fileData.filename}`,
                    category: 'audio'
                }
            });

        } catch (error) {
            console.error('Audio upload error:', error);
            res.status(500).json({
                success: false,
                message: 'Audio upload failed',
                error: error.message
            });
        }
    }
);

// Bulk file upload (Teachers only)
router.post('/bulk-upload', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    multipleUpload.array('files', 10),
    handleUploadError,
    fileUploadValidation,
    uploadBulkFiles
);

// Profile picture upload (All authenticated users)
router.post('/profile-picture', 
    authenticateToken,
    imageUpload.single('profile'),
    handleUploadError,
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No profile picture uploaded'
                });
            }

            const userId = req.user.id;
            let fileData = req.file;

            // Get optimizeImage function (if available)
            try {
                const { optimizeImage } = require('../controllers/fileController');
                const optimized = await optimizeImage(fileData.path, 'profile');
                fileData.path = optimized.path;
                fileData.filename = optimized.filename;
            } catch (error) {
                console.log('Image optimization not available, using original file');
            }

            // Save to database
            const fileId = await saveFileToDatabase(fileData, userId);

            // Update user profile picture in users table
            await pool.execute(
                'UPDATE users SET profile_picture = ? WHERE id = ?',
                [`/uploads/images/${fileData.filename}`, userId]
            );

            res.json({
                success: true,
                message: 'Profile picture uploaded successfully',
                data: {
                    fileId: fileId,
                    url: `/uploads/images/${fileData.filename}`
                }
            });

        } catch (error) {
            console.error('Profile picture upload error:', error);
            res.status(500).json({
                success: false,
                message: 'Profile picture upload failed',
                error: error.message
            });
        }
    }
);

// Get user's uploaded files
router.get('/my-files', 
    authenticateToken,
    getUserFilesValidation,
    getUserFiles
);

// Get files for a specific course (Teachers only)
router.get('/course-files/:courseId', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    param('courseId').isInt({ min: 1 }),
    async (req, res) => {
        try {
            const { courseId } = req.params;
            const userId = req.user.id;
            
            // Get course files
            const [files] = await pool.execute(`
                SELECT uf.*, 
                       CONCAT('/uploads/', 
                              CASE uf.file_category 
                                  WHEN 'image' THEN 'images'
                                  WHEN 'video' THEN 'videos'
                                  WHEN 'document' THEN 'documents'
                                  WHEN 'audio' THEN 'audios'
                                  ELSE 'misc'
                              END, 
                              '/', uf.file_name) as url
                FROM uploaded_files uf 
                WHERE uf.course_id = ? AND uf.user_id = ?
                ORDER BY uf.created_at DESC
            `, [courseId, userId]);
            
            res.json({
                success: true,
                message: 'Course files retrieved successfully',
                data: {
                    courseId: parseInt(courseId),
                    files: files,
                    totalFiles: files.length
                }
            });
            
        } catch (error) {
            console.error('Get course files error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve course files'
            });
        }
    }
);

// Delete file
router.delete('/files/:fileId', 
    authenticateToken,
    deleteFileValidation,
    deleteFile
);

// ================== UTILITY ROUTES ==================

// Get file statistics
router.get('/stats', 
    authenticateToken,
    async (req, res) => {
        try {
            const userId = req.user.id;
            
            const [stats] = await pool.execute(`
                SELECT 
                    COUNT(*) as total_files,
                    SUM(file_size) as total_size,
                    SUM(CASE WHEN file_category = 'image' THEN 1 ELSE 0 END) as total_images,
                    SUM(CASE WHEN file_category = 'video' THEN 1 ELSE 0 END) as total_videos,
                    SUM(CASE WHEN file_category = 'document' THEN 1 ELSE 0 END) as total_documents,
                    SUM(CASE WHEN file_category = 'audio' THEN 1 ELSE 0 END) as total_audios
                FROM uploaded_files 
                WHERE user_id = ?
            `, [userId]);
            
            const formatFileSize = (bytes) => {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            };
            
            const result = stats[0];
            
            res.json({
                success: true,
                message: 'File statistics retrieved successfully',
                data: {
                    totalFiles: parseInt(result.total_files),
                    totalSize: result.total_size || 0,
                    totalSizeFormatted: formatFileSize(result.total_size || 0),
                    breakdown: {
                        images: parseInt(result.total_images),
                        videos: parseInt(result.total_videos),
                        documents: parseInt(result.total_documents),
                        audios: parseInt(result.total_audios)
                    }
                }
            });
            
        } catch (error) {
            console.error('Get file stats error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve file statistics'
            });
        }
    }
);

// Test file upload endpoint (All authenticated users)
router.post('/test', 
    authenticateToken,
    imageUpload.single('file'),
    handleUploadError,
    (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No file uploaded'
                });
            }
            
            res.json({
                success: true,
                message: 'Test upload successful',
                data: {
                    file: {
                        originalName: req.file.originalname,
                        filename: req.file.filename,
                        size: req.file.size,
                        mimetype: req.file.mimetype,
                        path: req.file.path
                    },
                    user: req.user.id,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: 'Test upload failed',
                error: error.message
            });
        }
    }
);

// Get supported file types and limits
router.get('/config', (req, res) => {
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    
    res.json({
        success: true,
        message: 'Upload configuration',
        data: {
            maxFileSizes: {
                image: formatFileSize(10 * 1024 * 1024),
                video: formatFileSize(500 * 1024 * 1024),
                document: formatFileSize(50 * 1024 * 1024),
                audio: formatFileSize(100 * 1024 * 1024)
            },
            allowedTypes: {
                image: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
                video: ['mp4', 'avi', 'mov', 'wmv', 'mkv'],
                document: ['pdf', 'doc', 'docx'],
                audio: ['mp3', 'wav', 'ogg', 'm4a']
            },
            maxBulkFiles: 10,
            storageType: 'local',
            uploadDirectory: process.env.UPLOAD_DIR || './src/uploads'
        }
    });
});

module.exports = router;