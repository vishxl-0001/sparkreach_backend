const mysql = require('mysql2/promise');
const fs = require('fs');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,

  ssl: {
    ca: fs.readFileSync(process.env.DB_CA_PATH || './CA.pem')
  },

  timezone: '+00:00',
});
