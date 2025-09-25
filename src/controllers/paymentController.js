const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const SSLCommerzPayment = require('sslcommerz-lts');
const { v4: uuidv4 } = require('uuid');

// Initialize SSL Commerz (will be false for sandbox)
const sslcz = new SSLCommerzPayment(
    process.env.SSLCOMMERZ_STORE_ID || 'testbox',
    process.env.SSLCOMMERZ_STORE_PASSWORD || 'qwerty',
    process.env.SSLCOMMERZ_IS_LIVE === 'true'
);

// Get available payment methods
const getPaymentMethods = async (req, res) => {
    try {
        const [methods] = await pool.execute(
            'SELECT name, display_name, is_active FROM payment_methods WHERE is_active = TRUE ORDER BY display_name'
        );

        res.json({
            success: true,
            message: 'Payment methods retrieved successfully',
            data: methods
        });
    } catch (error) {
        console.error('Get payment methods error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve payment methods'
        });
    }
};

// Initiate payment for course enrollment
const initiatePayment = async (req, res) => {
    const connection = await pool.getConnection();
    
    try {
        await connection.beginTransaction();
        
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const userId = req.user.id;
        const { courseId, paymentMethod = 'sslcommerz' } = req.body;

        console.log(`💳 Payment initiation - User: ${userId}, Course: ${courseId}, Method: ${paymentMethod}`);

        // Validate payment method
        const [paymentMethods] = await connection.execute(
            'SELECT name FROM payment_methods WHERE name = ? AND is_active = TRUE',
            [paymentMethod]
        );

        if (!paymentMethods.length) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: 'Invalid or inactive payment method'
            });
        }

        // Get course details
        const [courses] = await connection.execute(`
            SELECT id, title, slug, price, discount_price, is_published
            FROM courses 
            WHERE id = ? AND is_published = TRUE
        `, [courseId]);

        if (!courses.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Course not found or not available for enrollment'
            });
        }

        const course = courses[0];

        // Check if user already enrolled
        const [existingEnrollments] = await connection.execute(
            'SELECT id, payment_status FROM enrollments WHERE user_id = ? AND course_id = ?',
            [userId, courseId]
        );

        if (existingEnrollments.length > 0) {
            const enrollment = existingEnrollments[0];
            if (enrollment.payment_status === 'completed') {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'You are already enrolled in this course'
                });
            } else if (['pending', 'processing'].includes(enrollment.payment_status)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'A payment is already in progress for this course'
                });
            }
        }

        // Calculate payment amount
        const originalPrice = parseFloat(course.price);
        const finalPrice = course.discount_price ? parseFloat(course.discount_price) : originalPrice;
        const discountAmount = originalPrice - finalPrice;

        // Generate unique transaction ID
        const transactionId = `TXN_${Date.now()}_${userId}_${courseId}_${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

        // Get user details
        const [users] = await connection.execute(
            'SELECT name, mobile, email FROM users WHERE id = ?',
            [userId]
        );

        if (!users.length) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Create or update enrollment record
        const [enrollmentResult] = await connection.execute(`
            INSERT INTO enrollments (
                user_id, course_id, payment_status, amount_paid, original_price, 
                discount_applied, payment_method, transaction_id
            ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                payment_status = 'pending',
                amount_paid = VALUES(amount_paid),
                original_price = VALUES(original_price),
                discount_applied = VALUES(discount_applied),
                payment_method = VALUES(payment_method),
                transaction_id = VALUES(transaction_id),
                enrolled_at = CURRENT_TIMESTAMP
        `, [userId, courseId, finalPrice, originalPrice, discountAmount, paymentMethod, transactionId]);

        // Get enrollment ID
        let enrollmentId;
        if (enrollmentResult.insertId) {
            enrollmentId = enrollmentResult.insertId;
        } else {
            const [enrollments] = await connection.execute(
                'SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?',
                [userId, courseId]
            );
            enrollmentId = enrollments[0].id;
        }

        if (paymentMethod === 'sslcommerz') {
            // SSL Commerz payment initialization
            const sslData = {
                total_amount: finalPrice,
                currency: 'BDT',
                tran_id: transactionId,
                success_url: process.env.SSLCOMMERZ_SUCCESS_URL || `http://localhost:5000/api/payment/ssl/success`,
                fail_url: process.env.SSLCOMMERZ_FAIL_URL || `http://localhost:5000/api/payment/ssl/fail`,
                cancel_url: process.env.SSLCOMMERZ_CANCEL_URL || `http://localhost:5000/api/payment/ssl/cancel`,
                ipn_url: process.env.SSLCOMMERZ_IPN_URL || `http://localhost:5000/api/payment/ssl/ipn`,
                
                // Product details
                shipping_method: 'NO',
                product_name: course.title,
                product_category: 'Education',
                product_profile: 'non-physical-goods',
                
                // Customer details
                cus_name: user.name || 'Student',
                cus_email: user.email || `student${userId}@example.com`,
                cus_add1: 'Dhaka',
                cus_add2: 'Bangladesh',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: user.mobile,
                cus_fax: user.mobile,
                
                // Shipping details
                ship_name: user.name || 'Student',
                ship_add1: 'Dhaka',
                ship_add2: 'Bangladesh',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: '1000',
                ship_country: 'Bangladesh',
                
                // Custom values for tracking
                value_a: userId.toString(),
                value_b: courseId.toString(),
                value_c: enrollmentId.toString()
            };

            try {
                console.log('🔄 Initializing SSL Commerz with data:', {
                    amount: sslData.total_amount,
                    tran_id: sslData.tran_id,
                    customer: sslData.cus_name
                });

                const sslResponse = await sslcz.init(sslData);
                
                console.log('📄 SSL Commerz Response:', sslResponse);
                
                if (sslResponse.status === 'SUCCESS') {
                    // Save payment record
                    await connection.execute(`
                        INSERT INTO payments (
                            user_id, course_id, enrollment_id, amount, payment_method,
                            gateway_name, transaction_id, session_key, gateway_response,
                            success_url, fail_url, cancel_url, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
                    `, [
                        userId, courseId, enrollmentId, finalPrice, paymentMethod,
                        'sslcommerz', transactionId, sslResponse.sessionkey || '',
                        JSON.stringify(sslResponse), sslData.success_url, sslData.fail_url, sslData.cancel_url
                    ]);

                    // Update enrollment status
                    await connection.execute(
                        'UPDATE enrollments SET payment_status = "processing", session_key = ? WHERE id = ?',
                        [sslResponse.sessionkey || '', enrollmentId]
                    );

                    await connection.commit();

                    res.json({
                        success: true,
                        message: 'Payment initiated successfully',
                        data: {
                            payment_url: sslResponse.redirectGatewayURL || sslResponse.GatewayPageURL,
                            transaction_id: transactionId,
                            session_key: sslResponse.sessionkey,
                            amount: finalPrice,
                            course_title: course.title
                        }
                    });
                } else {
                    throw new Error(`SSL Commerz initialization failed: ${sslResponse.failedreason || 'Unknown error'}`);
                }
            } catch (sslError) {
                console.error('❌ SSL Commerz error:', sslError);
                
                await connection.execute(
                    'UPDATE enrollments SET payment_status = "failed" WHERE id = ?',
                    [enrollmentId]
                );

                await connection.commit();

                res.status(500).json({
                    success: false,
                    message: 'Payment gateway initialization failed',
                    error: sslError.message
                });
            }
        } else {
            await connection.rollback();
            res.status(400).json({
                success: false,
                message: 'Unsupported payment method'
            });
        }

    } catch (error) {
        await connection.rollback();
        console.error('❌ Initiate payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Payment initiation failed'
        });
    } finally {
        connection.release();
    }
};

// SSL Commerz Success Callback
const sslSuccess = async (req, res) => {
    try {
        const data = req.method === 'POST' ? req.body : req.query;
        const { tran_id, val_id, status, amount } = data;

        console.log('✅ SSL Success callback received:', { tran_id, val_id, status, amount });

        if (status === 'VALID' || status === 'VALIDATED') {
            // Update enrollment status
            const [updateResult] = await pool.execute(`
                UPDATE enrollments SET 
                    payment_status = 'completed',
                    gateway_transaction_id = ?,
                    payment_completed_at = CURRENT_TIMESTAMP
                WHERE transaction_id = ?
            `, [val_id, tran_id]);

            if (updateResult.affectedRows > 0) {
                // Update payment record
                await pool.execute(
                    'UPDATE payments SET status = "completed", gateway_transaction_id = ?, completed_at = CURRENT_TIMESTAMP WHERE transaction_id = ?',
                    [val_id, tran_id]
                );

                console.log('✅ Payment completed successfully for transaction:', tran_id);
                
                // Redirect to success page
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                res.redirect(`${frontendUrl}/payment/success?transaction=${tran_id}`);
            } else {
                res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/error?message=enrollment_not_found`);
            }
        } else {
            res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/error?message=payment_invalid`);
        }
    } catch (error) {
        console.error('❌ SSL Success callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/error?message=server_error`);
    }
};

// SSL Commerz Fail Callback
const sslFail = async (req, res) => {
    try {
        const data = req.method === 'POST' ? req.body : req.query;
        const { tran_id, status } = data;
        
        console.log('❌ SSL Fail callback received:', { tran_id, status });

        await pool.execute(
            'UPDATE enrollments SET payment_status = "failed" WHERE transaction_id = ?',
            [tran_id]
        );

        await pool.execute(
            'UPDATE payments SET status = "failed" WHERE transaction_id = ?',
            [tran_id]
        );

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failed?transaction=${tran_id}`);
    } catch (error) {
        console.error('❌ SSL Fail callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/error?message=server_error`);
    }
};

// SSL Commerz Cancel Callback
const sslCancel = async (req, res) => {
    try {
        const data = req.method === 'POST' ? req.body : req.query;
        const { tran_id, status } = data;
        
        console.log('🚫 SSL Cancel callback received:', { tran_id, status });

        await pool.execute(
            'UPDATE enrollments SET payment_status = "pending" WHERE transaction_id = ?',
            [tran_id]
        );

        await pool.execute(
            'UPDATE payments SET status = "cancelled" WHERE transaction_id = ?',
            [tran_id]
        );

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancelled?transaction=${tran_id}`);
    } catch (error) {
        console.error('❌ SSL Cancel callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/error?message=server_error`);
    }
};

// Get user enrollments
const getUserEnrollments = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status;

        const offset = (page - 1) * limit;

        let query = `
            SELECT e.id, e.payment_status, e.amount_paid, e.progress_percentage,
                   e.enrolled_at, e.payment_completed_at, e.transaction_id,
                   c.id as course_id, c.title, c.slug, c.price, c.discount_price
            FROM enrollments e
            JOIN courses c ON e.course_id = c.id
            WHERE e.user_id = ?
        `;

        let params = [userId];

        if (status) {
            query += ' AND e.payment_status = ?';
            params.push(status);
        }

        query += ' ORDER BY e.enrolled_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [enrollments] = await pool.execute(query, params);

        res.json({
            success: true,
            message: 'User enrollments retrieved successfully',
            data: {
                enrollments: enrollments
            }
        });
    } catch (error) {
        console.error('❌ Get user enrollments error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve enrollments'
        });
    }
};

// Check enrollment status for a specific course
const checkEnrollmentStatus = async (req, res) => {
    try {
        const userId = req.user.id;
        const { courseId } = req.params;

        const [enrollments] = await pool.execute(
            'SELECT id, payment_status, amount_paid, progress_percentage, enrolled_at FROM enrollments WHERE user_id = ? AND course_id = ?',
            [userId, courseId]
        );

        if (enrollments.length > 0) {
            const enrollment = enrollments[0];
            res.json({
                success: true,
                message: 'Enrollment status retrieved',
                data: {
                    isEnrolled: enrollment.payment_status === 'completed',
                    enrollmentStatus: enrollment.payment_status,
                    progress: enrollment.progress_percentage,
                    enrolledAt: enrollment.enrolled_at
                }
            });
        } else {
            res.json({
                success: true,
                message: 'Not enrolled in this course',
                data: {
                    isEnrolled: false,
                    enrollmentStatus: null
                }
            });
        }
    } catch (error) {
        console.error('❌ Check enrollment status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check enrollment status'
        });
    }
};

module.exports = {
    getPaymentMethods,
    initiatePayment,
    sslSuccess,
    sslFail,
    sslCancel,
    getUserEnrollments,
    checkEnrollmentStatus
};