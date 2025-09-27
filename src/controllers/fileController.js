const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './src/uploads';
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

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
    },
    fileFilter: (req, file, cb) => {
        // Allow images and PDFs
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only images and PDFs are allowed'));
        }
    }
});

// Upload course thumbnail
const uploadCourseThumbnail = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        // If it's an image, optimize it
        if (req.file.mimetype.startsWith('image/')) {
            const optimizedPath = req.file.path.replace(path.extname(req.file.path), '-optimized.jpg');
            
            await sharp(req.file.path)
                .resize(800, 600, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toFile(optimizedPath);
            
            // Delete original and use optimized
            fs.unlinkSync(req.file.path);
            req.file.path = optimizedPath;
            req.file.filename = path.basename(optimizedPath);
        }

        res.json({
            success: true,
            message: 'File uploaded successfully',
            data: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                path: req.file.path,
                size: req.file.size,
                url: `/uploads/${req.file.filename}`
            }
        });

    } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({
            success: false,
            message: 'File upload failed'
        });
    }
};

module.exports = {
    upload,
    uploadCourseThumbnail
};