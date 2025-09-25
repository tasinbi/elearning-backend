const mysql = require('mysql2/promise');

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
    try {
        console.log('🔄 Testing database connection...');
        
        const connection = await pool.getConnection();
        console.log('✅ Database connected successfully');
        
        // Test query
        const [rows] = await connection.execute('SELECT * FROM test_connection LIMIT 1');
        console.log('📄 Test data:', rows[0]);
        
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
};

module.exports = { pool, testConnection };