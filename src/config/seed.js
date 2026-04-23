const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');

async function seedDatabase() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Vishal123!',
    database: 'flutter_sparkreach',
  });

  try {
    console.log('🌱 Starting seeding...');

    // ✅ USERS (same as before)
    const hashedPassword = await bcrypt.hash('demo123', 10);

    const users = [
      { email: 'admin@demo.com', role: 'admin' },
      { email: 'host@demo.com', role: 'host' },
      { email: 'rider@demo.com', role: 'rider' },
    ];

    let hostId = null;

    for (const user of users) {
      const userId = uuidv4();
      await pool.execute(
        `INSERT IGNORE INTO users (id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
        [userId, user.email, user.email.split('@')[0], hashedPassword, user.role]
      );

      if (user.role === 'host') {
        hostId = userId;
      }
    }

    if (!hostId) {
      // Get the existing host's ID if insert was ignored
      const [rows] = await pool.execute(
        `SELECT id FROM users WHERE email = ?`,
        ['host@demo.com']
      );
      hostId = rows[0].id;
    }

    console.log('✅ Users done');

    // 🔥 CSV PART (THIS WAS MISSING BEFORE)
    console.log("📂 Reading CSV...");

    const chargers = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(__dirname + '/ev-charging-stations-india.csv')
        .pipe(csv())
        .on('data', (row) => chargers.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log("📊 Chargers found:", chargers.length);
    console.log("🧪 Sample:", chargers[0]);

    // 🔥 INSERT CHARGERS
    for (const row of chargers) {
  try {
    const lat = parseFloat(
      row.latitude || row.lat || row.Latitude || row.lattitude
    );

    const lng = parseFloat(
      row.longitude || row.lng || row.Longitude
    );

    if (isNaN(lat) || isNaN(lng)) {
      console.log("❌ Skipping invalid:", row);
      continue;
    }

    await pool.execute(
      `INSERT INTO chargers 
      (id, host_id, location_name, charger_type, power_output_kw, price_per_hour, address, latitude, longitude, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        uuidv4(),
        hostId,
        row.name || "Station",
        "Type 2",
        60,
        50,
        row.address || "India",
        lat,
        lng
      ]
    );

  } catch (err) {
    console.log("❌ REAL ERROR:", err.message);
  }
}

    console.log('🚀 Chargers inserted!');
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await pool.end();
  }
}

seedDatabase();