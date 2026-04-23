require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  console.log('🔄 Running migrations...');

  try {
    // Create database
    await conn.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
    await conn.query(`USE ${process.env.DB_NAME}`);

    // Users table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        full_name VARCHAR(100),
        name VARCHAR(100),
        email VARCHAR(150) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar_url VARCHAR(500),
        role ENUM('rider','host','admin') DEFAULT 'rider',
        status ENUM('active','pending','banned','suspended') DEFAULT 'active',
        is_host_approved BOOLEAN DEFAULT FALSE,
        is_email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_role (role)
      )
    `);
    console.log('✅ Users table created');

    // Chargers table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS chargers (
        id VARCHAR(36) PRIMARY KEY,
        host_id VARCHAR(36) NOT NULL,
        location_name VARCHAR(200) NOT NULL,
        address VARCHAR(500),
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        price_per_hour DECIMAL(8,2) NOT NULL,
        power_output_kw DECIMAL(6,2) DEFAULT 60,
        charger_type VARCHAR(50) DEFAULT 'Type 2',
        is_active BOOLEAN DEFAULT TRUE,
        rating DECIMAL(3,2) DEFAULT 0.00,
        total_reviews INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_host (host_id),
        INDEX idx_active (is_active),
        INDEX idx_location (latitude, longitude)
      )
    `);
    console.log('✅ Chargers table created');

    // Bookings table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(36) PRIMARY KEY,
        rider_id VARCHAR(36) NOT NULL,
        host_id VARCHAR(36) NOT NULL,
        station_id VARCHAR(36) NOT NULL,
        scheduled_start DATETIME NOT NULL,
        scheduled_end DATETIME NOT NULL,
        estimated_kwh DECIMAL(8,2),
        total_amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending','confirmed','active','completed','cancelled','expired') DEFAULT 'pending',
        payment_id VARCHAR(200),
        razorpay_order_id VARCHAR(200),
        exact_lat DECIMAL(10,8),
        exact_lng DECIMAL(11,8),
        exact_address VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        cancelled_at TIMESTAMP NULL,
        cancellation_reason TEXT,
        FOREIGN KEY (rider_id) REFERENCES users(id),
        FOREIGN KEY (host_id) REFERENCES users(id),
        FOREIGN KEY (station_id) REFERENCES chargers(id),
        INDEX idx_rider (rider_id),
        INDEX idx_host (host_id),
        INDEX idx_station (station_id),
        INDEX idx_status (status)
      )
    `);
    console.log('✅ Bookings table created');

    // Payments table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id VARCHAR(36) PRIMARY KEY,
        booking_id VARCHAR(36) NOT NULL,
        rider_id VARCHAR(36) NOT NULL,
        razorpay_payment_id VARCHAR(200),
        razorpay_order_id VARCHAR(200),
        razorpay_signature VARCHAR(500),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'INR',
        status ENUM('created','authorized','captured','failed','refunded') DEFAULT 'created',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (booking_id) REFERENCES bookings(id),
        FOREIGN KEY (rider_id) REFERENCES users(id)
      )
    `);
    console.log('✅ Payments table created');

    console.log('✅ Migrations completed successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    throw err;
  } finally {
    await conn.end();
  }
}

migrate().catch(err => {
  console.error('❌ Migration error:', err);
  process.exit(1);
});
