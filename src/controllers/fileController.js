const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');

// Ensure upload directories exist
const ensureUploadDirs = () => {
    const dirs = [
        './src/uploads',
        './src/uploads/images',
        './src/uploads/videos',
        './src/uploads/documents',
        './src/uploads/audios'
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// Call this immediately
ensureUploadDirs();

// Simple storage configuration
const createStorage = (subfolder = 'images') => {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = `./src/uploads/${subfolder}`;
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueName = `${uuidv4()}-${Date.now()}${path.extname(file.originalname)}`;
            cb(null, uniqueName);
        }
    });
};

// File filter function
const createFileFilter = (allowedTypes) => {
    return (req, file, cb) => {
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Only these file types are allowed: ${allowedTypes.join(', ')}`), false);
        }
    };
};

// Image upload configuration
const imageUpload = multer({
    storage: createStorage('images'),
    limits: {
        fileSize: parseInt(process.env.MAX_IMAGE_SIZE) || 10 * 1024 * 1024 // 10MB
    },
    fileFilter: createFileFilter([
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
    ])
});

// Video upload configuration
const videoUpload = multer({
    storage: createStorage('videos'),
    limits: {
        fileSize: parseInt(process.env.MAX_VIDEO_SIZE) || 500 * 1024 * 1024 // 500MB
    },
    fileFilter: createFileFilter([
        'video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/mkv'
    ])
});

// Document upload configuration
const documentUpload = multer({
    storage: createStorage('documents'),
    limits: {
        fileSize: parseInt(process.env.MAX_DOCUMENT_SIZE) || 50 * 1024 * 1024 // 50MB
    },
    fileFilter: createFileFilter([
        'application/pdf', 
        'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ])
});

// Audio upload configuration
const audioUpload = multer({
    storage: createStorage('audios'),
    limits: {
        fileSize: parseInt(process.env.MAX_AUDIO_SIZE) || 100 * 1024 * 1024 // 100MB
    },
    fileFilter: createFileFilter([
        'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'
    ])
});

// Multiple files upload
const multipleUpload = multer({
    storage: createStorage('images'),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 10 // max 10 files
    },
    fileFilter: createFileFilter([
        'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
    ])
});

// Helper function to detect file category
const detectFileCategory = (mimetype) => {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype === 'application/pdf' || mimetype.includes('document')) return 'document';
    return 'other';
};

// Helper function to save file to database
const saveFileToDatabase = async (fileData, userId, courseId = null) => {
    try {
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

// Image optimization function
const optimizeImage = async (filePath, category = 'thumbnail') => {
    try {
        if (!sharp) {
            console.log('Sharp not available, using original image');
            return { path: filePath, filename: path.basename(filePath) };
        }
        
        const optimizedPath = filePath.replace(path.extname(filePath), '-optimized.webp');
        
        let sharpInstance = sharp(filePath);
        
        // Different optimization based on category
        switch (category) {
            case 'thumbnail':
                sharpInstance = sharpInstance.resize(800, 600, { fit: 'cover' });
                break;
            case 'profile':
                sharpInstance = sharpInstance.resize(300, 300, { fit: 'cover' });
                break;
            default:
                sharpInstance = sharpInstance.resize(1024, 768, { fit: 'inside', withoutEnlargement: true });
        }
        
        await sharpInstance
            .webp({ quality: 85 })
            .toFile(optimizedPath);
        
        // Delete original if optimization successful
        if (fs.existsSync(optimizedPath)) {
            fs.unlinkSync(filePath);
            return {
                path: optimizedPath,
                filename: path.basename(optimizedPath)
            };
        }
        
        return { path: filePath, filename: path.basename(filePath) };
    } catch (error) {
        console.error('Image optimization error:', error);
        return { path: filePath, filename: path.basename(filePath) };
    }
};

// Format file size utility
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Controller functions
const uploadCourseThumbnail = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No thumbnail uploaded'
            });
        }

        const userId = req.user.id;
        let fileData = req.file;

        // Optimize image if possible
        try {
            const optimized = await optimizeImage(fileData.path, 'thumbnail');
            fileData.path = optimized.path;
            fileData.filename = optimized.filename;
        } catch (error) {
            console.log('Image optimization failed, using original');
        }

        // Save to database
        const fileId = await saveFileToDatabase(fileData, userId, req.body.courseId);

        res.json({
            success: true,
            message: 'Thumbnail uploaded successfully',
            data: {
                fileId: fileId,
                filename: fileData.filename,
                originalName: fileData.originalname,
                size: fileData.size,
                sizeFormatted: formatFileSize(fileData.size),
                url: `/uploads/images/${fileData.filename}`,
                category: 'image'
            }
        });

    } catch (error) {
        console.error('Thumbnail upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Thumbnail upload failed',
            error: error.message
        });
    }
};

const uploadCourseVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No video uploaded'
            });
        }

        const userId = req.user.id;
        const fileData = req.file;

        // Save to database
        const fileId = await saveFileToDatabase(fileData, userId, req.body.courseId);

        res.json({
            success: true,
            message: 'Video uploaded successfully',
            data: {
                fileId: fileId,
                filename: fileData.filename,
                originalName: fileData.originalname,
                size: fileData.size,
                sizeFormatted: formatFileSize(fileData.size),
                url: `/uploads/videos/${fileData.filename}`,
                category: 'video'
            }
        });

    } catch (error) {
        console.error('Video upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Video upload failed',
            error: error.message
        });
    }
};

const uploadCourseDocument = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No document uploaded'
            });
        }

        const userId = req.user.id;
        const fileData = req.file;

        // Save to database
        const fileId = await saveFileToDatabase(fileData, userId, req.body.courseId);

        res.json({
            success: true,
            message: 'Document uploaded successfully',
            data: {
                fileId: fileId,
                filename: fileData.filename,
                originalName: fileData.originalname,
                size: fileData.size,
                sizeFormatted: formatFileSize(fileData.size),
                url: `/uploads/documents/${fileData.filename}`,
                category: 'document'
            }
        });

    } catch (error) {
        console.error('Document upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Document upload failed',
            error: error.message
        });
    }
};

const uploadBulkFiles = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No files uploaded'
            });
        }

        const userId = req.user.id;
        const uploadedFiles = [];
        const errors = [];

        for (const file of req.files) {
            try {
                // Save to database
                const fileId = await saveFileToDatabase(file, userId, req.body.courseId);
                
                uploadedFiles.push({
                    fileId: fileId,
                    filename: file.filename,
                    originalName: file.originalname,
                    size: file.size,
                    sizeFormatted: formatFileSize(file.size),
                    url: `/uploads/images/${file.filename}`,
                    category: detectFileCategory(file.mimetype)
                });

            } catch (error) {
                errors.push({
                    filename: file.originalname,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `${uploadedFiles.length} files uploaded successfully`,
            data: {
                uploadedFiles: uploadedFiles,
                errors: errors,
                totalUploaded: uploadedFiles.length,
                totalErrors: errors.length
            }
        });

    } catch (error) {
        console.error('Bulk upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Bulk upload failed',
            error: error.message
        });
    }
};

const getUserFiles = async (req, res) => {
    try {
        const userId = req.user.id;
        const { category, courseId, page = 1, limit = 20 } = req.query;
        
        let query = 'SELECT * FROM uploaded_files WHERE user_id = ?';
        let params = [userId];
        
        if (category) {
            query += ' AND file_category = ?';
            params.push(category);
        }
        
        if (courseId) {
            query += ' AND course_id = ?';
            params.push(parseInt(courseId));
        }
        
        const offset = (page - 1) * limit;
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);
        
        const [files] = await pool.execute(query, params);
        
        // Add full URLs and formatted sizes
        const filesWithUrls = files.map(file => {
            const folderMap = {
                'image': 'images',
                'video': 'videos',
                'document': 'documents',
                'audio': 'audios'
            };
            
            return {
                ...file,
                url: `/uploads/${folderMap[file.file_category] || 'misc'}/${file.file_name}`,
                size_formatted: formatFileSize(file.file_size)
            };
        });
        
        res.json({
            success: true,
            message: 'Files retrieved successfully',
            data: {
                files: filesWithUrls,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: files.length
                }
            }
        });
        
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve files'
        });
    }
};

const deleteFile = async (req, res) => {
    try {
        const { fileId } = req.params;
        const userId = req.user.id;
        
        // Get file info
        const [files] = await pool.execute(
            'SELECT * FROM uploaded_files WHERE id = ? AND user_id = ?',
            [fileId, userId]
        );
        
        if (!files.length) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }
        
        const file = files[0];
        
        // Delete physical file
        if (fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }
        
        // Delete from database
        await pool.execute('DELETE FROM uploaded_files WHERE id = ?', [fileId]);
        
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
        
    } catch (error) {
        console.error('Delete file error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete file'
        });
    }
};

module.exports = {
    // Upload middlewares
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
    deleteFile,
    
    // Utilities
    optimizeImage,
    detectFileCategory,
    formatFileSize,
    saveFileToDatabase
};