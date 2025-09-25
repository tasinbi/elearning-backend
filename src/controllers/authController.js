const { pool } = require('../config/database');
const { generateToken, generateOTP } = require('../utils/auth');
const { sendOTP } = require('../utils/sms');
const { validationResult } = require('express-validator');

// Send OTP Controller
const sendOTPController = async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { mobile } = req.body;
        console.log(`📱 OTP request for: ${mobile}`);

        // Generate OTP
        const otp = generateOTP();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

        // Delete old OTPs for this mobile
        await pool.execute(
            'DELETE FROM otp_verifications WHERE mobile = ?',
            [mobile]
        );

        // Save new OTP to database
        await pool.execute(
            'INSERT INTO otp_verifications (mobile, otp, expires_at) VALUES (?, ?, ?)',
            [mobile, otp, expiresAt]
        );

        // Send OTP via SMS
        await sendOTP(mobile, otp);

        res.json({
            success: true,
            message: 'OTP sent successfully',
            data: {
                mobile: mobile,
                expiresIn: 300 // 5 minutes in seconds
            }
        });

    } catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send OTP'
        });
    }
};

// Verify OTP and Login Controller
const verifyOTPController = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { mobile, otp } = req.body;
        console.log(`🔐 OTP verification for: ${mobile}, OTP: ${otp}`);

        // Check OTP in database
        const [otpRows] = await pool.execute(
            'SELECT * FROM otp_verifications WHERE mobile = ? AND otp = ? AND expires_at > NOW() AND is_used = FALSE',
            [mobile, otp]
        );

        if (!otpRows.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired OTP'
            });
        }

        // Mark OTP as used
        await pool.execute(
            'UPDATE otp_verifications SET is_used = TRUE WHERE id = ?',
            [otpRows[0].id]
        );

        // Check if user exists
        let [users] = await pool.execute(
            'SELECT * FROM users WHERE mobile = ?',
            [mobile]
        );

        let userId;
        let isNewUser = false;

        if (!users.length) {
            // Create new user
            const [result] = await pool.execute(
                'INSERT INTO users (mobile, is_verified) VALUES (?, TRUE)',
                [mobile]
            );
            userId = result.insertId;
            isNewUser = true;

            // Get the newly created user
            [users] = await pool.execute(
                'SELECT * FROM users WHERE id = ?',
                [userId]
            );
            console.log(`👤 New user created with ID: ${userId}`);
        } else {
            userId = users[0].id;
            // Mark existing user as verified
            await pool.execute(
                'UPDATE users SET is_verified = TRUE WHERE id = ?',
                [userId]
            );
            console.log(`👤 Existing user logged in: ${userId}`);
        }

        const user = users[0];
        const token = generateToken(userId, user.role);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token: token,
                user: {
                    id: user.id,
                    mobile: user.mobile,
                    name: user.name,
                    role: user.role,
                    isNewUser: isNewUser
                }
            }
        });

    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed'
        });
    }
};

module.exports = {
    sendOTPController,
    verifyOTPController
};