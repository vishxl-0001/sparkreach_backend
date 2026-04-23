const express = require('express');
const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireHost } = require('../middleware/auth.middleware');

const router = express.Router();


// ── GET /stations ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.id,
        s.host_id,
        u.full_name AS host_name,
        s.location_name AS title,
        s.location_name AS address,
        s.latitude AS approx_lat,
        s.longitude AS approx_lng,
        s.price_per_hour AS price_per_kwh,
        s.charger_type AS connector_type,
        s.is_active
      FROM chargers s
      JOIN users u ON u.id = s.host_id
      WHERE s.is_active = 1
    `);

    res.json({ success: true, data: rows });

  } catch (err) {
    console.error('Get stations error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stations' });
  }
});


// ── GET /stations/host/me ─────────────────────────────────────
router.get('/host/me', authenticate, requireHost, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        s.id,
        s.host_id,
        u.full_name AS host_name,
        s.location_name AS title,
        s.location_name AS address,
        s.latitude AS approx_lat,
        s.longitude AS approx_lng,
        s.price_per_hour AS price_per_kwh,
        s.charger_type AS connector_type,
        s.is_active
       FROM chargers s
       JOIN users u ON u.id = s.host_id
       WHERE s.host_id = ?`,
      [req.user.id]
    );

    res.json({ success: true, data: rows });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch your chargers' });
  }
});


// ── GET /stations/:id ─────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        s.id,
        s.host_id,
        u.full_name AS host_name,
        s.location_name AS title,
        s.location_name AS address,
        s.latitude AS approx_lat,
        s.longitude AS approx_lng,
        s.price_per_hour AS price_per_kwh,
        s.charger_type AS connector_type,
        s.is_active
       FROM chargers s
       JOIN users u ON u.id = s.host_id
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Charger not found' });
    }

    res.json({ success: true, data: rows[0] });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch charger' });
  }
});


// ── POST /stations ────────────────────────────────────────────
router.post('/', authenticate, requireHost, async (req, res) => {
  const { location_name, latitude, longitude, price_per_hour, charger_type, address, power_output_kw } = req.body;

  try {
    const chargerId = uuidv4();
    await pool.query(
     
      `INSERT INTO chargers 
       (id, host_id, location_name, latitude, longitude, price_per_hour, charger_type, address, power_output_kw, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [chargerId, req.user.id, location_name, latitude, longitude, price_per_hour, charger_type, address || null, power_output_kw || 60]
    );

    const [row] = await pool.query(
      `SELECT * FROM chargers WHERE id = ?`,
      [chargerId]
    );

    res.status(201).json({ success: true, data: row[0] });

  } catch (err) {
    console.error('Create charger error:', err);
    res.status(500).json({ success: false, message: 'Failed to create charger' });
  }
});


// ── PUT /stations/:id ─────────────────────────────────────────
router.put('/:id', authenticate, requireHost, async (req, res) => {
  const { location_name, price_per_hour, charger_type, is_available, is_active } = req.body;

  try {
    // Handle both is_available (from Flutter) and is_active (backend standard)
    const activeValue = is_available !== undefined ? is_available : is_active;

    await pool.query(
      `UPDATE chargers 
       SET location_name = COALESCE(?, location_name),
           price_per_hour = COALESCE(?, price_per_hour),
           charger_type = COALESCE(?, charger_type),
           is_active = COALESCE(?, is_active)
       WHERE id = ? AND host_id = ?`,
      [location_name, price_per_hour, charger_type, activeValue, req.params.id, req.user.id]
    );

    const [updated] = await pool.query(
      `SELECT * FROM chargers WHERE id = ?`,
      [req.params.id]
    );

    res.json({ success: true, data: updated[0] });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update charger' });
  }
});


// ── DELETE /stations/:id ─────────────────────────────────────
router.delete('/:id', authenticate, requireHost, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM chargers WHERE id = ? AND host_id = ?`,
      [req.params.id, req.user.id]
    );

    res.json({ success: true, message: 'Charger deleted' });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete charger' });
  }
});

module.exports = router;