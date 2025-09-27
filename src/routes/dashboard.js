const express = require('express');
const router = express.Router();

const {
    getStudentDashboard,
    getTeacherDashboard,
    getAdminDashboard,
    getUserAnalytics
} = require('../controllers/dashboardController');

const { authenticateToken, authorizeRole } = require('../middleware/auth');

// Student Dashboard
router.get('/student', 
    authenticateToken, 
    authorizeRole('student'), 
    getStudentDashboard
);

// Teacher Dashboard  
router.get('/teacher', 
    authenticateToken, 
    authorizeRole('teacher', 'admin'), 
    getTeacherDashboard
);

// Admin Dashboard
router.get('/admin', 
    authenticateToken, 
    authorizeRole('admin'), 
    getAdminDashboard
);

// User Analytics (for any authenticated user)
router.get('/analytics', 
    authenticateToken, 
    getUserAnalytics
);

// Dashboard redirect based on role
router.get('/', authenticateToken, (req, res) => {
    const userRole = req.user.role;
    
    res.json({
        success: true,
        message: 'Dashboard access',
        data: {
            user_role: userRole,
            redirect_to: `/api/dashboard/${userRole}`,
            user_info: {
                id: req.user.id,
                name: req.user.name,
                mobile: req.user.mobile,
                role: req.user.role
            }
        }
    });
});

module.exports = router;