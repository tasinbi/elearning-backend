const express = require('express');
const router = express.Router();
const { upload, uploadCourseThumbnail } = require('../controllers/fileController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Upload course thumbnail (teachers only)
router.post('/course-thumbnail', 
    authenticateToken,
    authorizeRole('teacher', 'admin'),
    upload.single('thumbnail'),
    uploadCourseThumbnail
);

// Test file upload endpoint
router.post('/test', 
    authenticateToken,
    upload.single('file'),
    (req, res) => {
        res.json({
            success: true,
            message: 'Test upload successful',
            file: req.file
        });
    }
);

module.exports = router;