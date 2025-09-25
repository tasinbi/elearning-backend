// SMS utility (For development - just console log)
const sendSMS = async (mobile, message) => {
    try {
        // For development - just log the OTP
        console.log(`📱 SMS to ${mobile}: ${message}`);
        
        // In production, integrate with actual SMS gateway
        // Example: SSL Wireless, Twilio, etc.
        
        return { success: true, message: 'SMS sent (development mode)' };
    } catch (error) {
        console.error('SMS send error:', error);
        throw new Error('Failed to send SMS');
    }
};

// Send OTP SMS
const sendOTP = async (mobile, otp) => {
    const message = `Your E-Learning verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`;
    return await sendSMS(mobile, message);
};

module.exports = { sendSMS, sendOTP };