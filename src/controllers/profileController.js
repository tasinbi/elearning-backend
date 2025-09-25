const { pool } = require('../config/database');
const { validationResult } = require('express-validator');

// Get Current User Profile (Simplified - no stats for now)
const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        
        const [users] = await pool.execute(
            `SELECT id, mobile, name, email, role, is_verified, is_active, 
             created_at, updated_at FROM users WHERE id = ?`,
            [userId]
        );
        
        if (!users.length) {
            return res.status(404).json({
                success: false,
                message: 'User profile not found'
            });
        }
        
        const user = users[0];
        
        res.json({
            success: true,
            message: 'Profile retrieved successfully',
            data: user
        });
        
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve profile'
        });
    }
};

// Update User Profile
const updateProfile = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        
        const userId = req.user.id;
        const { name, email } = req.body;
        
        // Check if email is already taken by another user
        if (email) {
            const [existingUsers] = await pool.execute(
                'SELECT id FROM users WHERE email = ? AND id != ?',
                [email, userId]
            );
            
            if (existingUsers.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already exists'
                });
            }
        }
        
        // Update profile
        await pool.execute(
            'UPDATE users SET name = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, email, userId]
        );
        
        // Get updated user data
        const [users] = await pool.execute(
            'SELECT id, mobile, name, email, role, updated_at FROM users WHERE id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: users[0]
        });
        
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
};

// Change User Role (Admin only)
const changeUserRole = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }
        
        const { userId, newRole } = req.body;
        const adminId = req.user.id;
        
        // Can't change own role
        if (userId === adminId) {
            return res.status(400).json({
                success: false,
                message: 'Cannot change your own role'
            });
        }
        
        // Check if target user exists
        const [users] = await pool.execute(
            'SELECT id, mobile, name, role FROM users WHERE id = ?',
            [userId]
        );
        
        if (!users.length) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = users[0];
        
        // Update role
        await pool.execute(
            'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newRole, userId]
        );
        
        res.json({
            success: true,
            message: `User role changed from ${user.role} to ${newRole}`,
            data: {
                userId: userId,
                mobile: user.mobile,
                name: user.name,
                oldRole: user.role,
                newRole: newRole
            }
        });
        
    } catch (error) {
        console.error('Change role error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change user role'
        });
    }
};

// Get All Users (Admin only)
const getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const role = req.query.role; // Optional role filter
        const search = req.query.search; // Optional search
        
        const offset = (page - 1) * limit;
        
        let query = 'SELECT id, mobile, name, email, role, is_verified, is_active, created_at FROM users';
        let countQuery = 'SELECT COUNT(*) as total FROM users';
        let params = [];
        let whereConditions = [];
        
        // Add role filter
        if (role && ['student', 'teacher', 'admin'].includes(role)) {
            whereConditions.push('role = ?');
            params.push(role);
        }
        
        // Add search filter
        if (search) {
            whereConditions.push('(name LIKE ? OR mobile LIKE ? OR email LIKE ?)');
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        }
        
        // Apply WHERE conditions
        if (whereConditions.length > 0) {
            const whereClause = ' WHERE ' + whereConditions.join(' AND ');
            query += whereClause;
            countQuery += whereClause;
        }
        
        // Add ordering and pagination
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);
        
        // Execute queries
        const [users] = await pool.execute(query, params);
        const [countResult] = await pool.execute(countQuery, params.slice(0, -2)); // Remove limit and offset for count
        
        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);
        
        res.json({
            success: true,
            message: 'Users retrieved successfully',
            data: {
                users: users,
                pagination: {
                    page: page,
                    limit: limit,
                    total: total,
                    totalPages: totalPages,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }
        });
        
    } catch (error) {
        console.error('Get all users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve users'
        });
    }
};

// Delete User Account
const deleteAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Soft delete - deactivate account instead of hard delete
        await pool.execute(
            'UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Account deactivated successfully'
        });
        
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete account'
        });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    changeUserRole,
    getAllUsers,
    deleteAccount
};