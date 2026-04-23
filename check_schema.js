const pool = require('mysql2/promise').createPool({
  host: 'localhost',
  user: 'root',
  password: 'Vishal123!',
  database: 'flutter_sparkreach',
});

pool.query('DESCRIBE chargers')
  .then(([rows]) => {
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  })
  .catch(e => {
    console.error(e.message);
    process.exit(1);
  });
