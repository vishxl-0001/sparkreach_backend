const express = require('express');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

// ── GET /admin/metrics ────────────────────────────────────────────────────────
router.get('/metrics', async (req, res) => {
  try {
    const [[userCount]] = await pool.query('SELECT COUNT(*) AS total FROM users');
    const [[stationCount]] = await pool.query('SELECT COUNT(*) AS total FROM chargers WHERE is_active = TRUE');
    const [[bookingCount]] = await pool.query('SELECT COUNT(*) AS total FROM bookings');
    const [[revenue]] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'captured'"
    );
    const [[activeBookings]] = await pool.query(
      "SELECT COUNT(*) AS total FROM bookings WHERE status IN ('confirmed','active')"
    );
    const [[pendingHosts]] = await pool.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'host' AND is_host_approved = FALSE"
    );

    res.json({
      success: true,
      data: {
        total_users: userCount.total,
        total_stations: stationCount.total,
        total_bookings: bookingCount.total,
        total_revenue: parseFloat(revenue.total),
        active_bookings: activeBookings.total,
        pending_host_approvals: pendingHosts.total,
      },
    });
  } catch (err) {
    console.error('🔥 Admin metrics error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch metrics' });
  }
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { page = 1, limit = 20, role, status } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = 'SELECT id, full_name AS name, email, phone, role, status, is_host_approved, is_email_verified, created_at FROM users WHERE 1=1';
    const params = [];

    if (role) { query += ' AND role = ?'; params.push(role); }
    if (status) { query += ' AND status = ?'; params.push(status); }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await pool.query(query, params);
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');

    res.json({ success: true, data: users, meta: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (err) {
    console.error('🔥 SQL Error in /users:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// ── GET /admin/stations ───────────────────────────────────────────────────────
router.get('/stations', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const [stations] = await pool.query(
      `SELECT s.id, s.location_name AS title, s.address, s.rating, s.total_reviews,
              s.charger_type AS connector_type, s.price_per_hour AS price_per_kwh, 
              s.power_output_kw AS power_kw, s.is_active,
              s.created_at, u.full_name AS host_name, u.email AS host_email
       FROM chargers s JOIN users u ON u.id = s.host_id
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, data: stations });
  } catch (err) {
    console.error('🔥 SQL Error in /stations:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stations' });
  }
});

// ── GET /admin/stations/pending ───────────────────────────────────────────────
router.get('/stations/pending', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const [stations] = await pool.query(
      `SELECT s.id, s.location_name AS title, s.address, s.rating, s.total_reviews,
              s.charger_type AS connector_type, s.price_per_hour AS price_per_kwh, 
              s.power_output_kw AS power_kw, s.is_active,
              s.created_at, u.full_name AS host_name, u.email AS host_email
       FROM chargers s JOIN users u ON u.id = s.host_id
       WHERE s.is_active = FALSE
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, data: stations });
  } catch (err) {
    console.error('🔥 SQL Error in /stations/pending:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pending stations' });
  }
});

// ── PUT /admin/stations/:id/approve ───────────────────────────────────────────
router.put('/stations/:id/approve', async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE chargers SET is_active = TRUE WHERE id = ?',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Charger not found' });
    }

    const [charger] = await pool.query('SELECT * FROM chargers WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Charger approved', data: charger[0] });
  } catch (err) {
    console.error('🔥 SQL Error in /stations/approve:', err);
    res.status(500).json({ success: false, message: 'Failed to approve charger' });
  }
});

// ── PUT /admin/stations/:id/reject ────────────────────────────────────────────
router.put('/stations/:id/reject', async (req, res) => {
  const { reason } = req.body;
  try {
    const [result] = await pool.query(
      'DELETE FROM chargers WHERE id = ? AND is_active = FALSE',
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Charger not found or already active' });
    }

    res.json({ success: true, message: 'Charger rejected and removed' });
  } catch (err) {
    console.error('🔥 SQL Error in /stations/reject:', err);
    res.status(500).json({ success: false, message: 'Failed to reject charger' });
  }
});

// ── GET /admin/bookings ───────────────────────────────────────────────────────
router.get('/bookings', async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;
  const offset = (page - 1) * limit;

  try {
    let query = `
      SELECT b.*, r.full_name AS rider_name, h.full_name AS host_name, s.location_name AS station_title
      FROM bookings b
      LEFT JOIN users r ON r.id = b.rider_id
      LEFT JOIN users h ON h.id = b.host_id
      LEFT JOIN chargers s ON s.id = b.station_id
    `;
    const params = [];
    if (status) { query += ' WHERE b.status = ?'; params.push(status); }
    query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [bookings] = await pool.query(query, params);
    res.json({ success: true, data: bookings });
  } catch (err) {
    console.error('🔥 SQL Error in /bookings:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// ── PUT /admin/users/:id/approve-host ────────────────────────────────────────
router.put('/users/:id/approve-host', async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET is_host_approved = TRUE, status = 'active' WHERE id = ? AND role = 'host'",
      [req.params.id]
    );
    res.json({ success: true, message: 'Host approved successfully' });
  } catch (err) {
    console.error('🔥 SQL Error in /approve-host:', err);
    res.status(500).json({ success: false, message: 'Failed to approve host' });
  }
});

// ── PUT /admin/users/:id/ban ─────────────────────────────────────────────────
router.put('/users/:id/ban', async (req, res) => {
  const { reason } = req.body;
  try {
    // Prevent banning other admins
    const [user] = await pool.query('SELECT role FROM users WHERE id = ?', [req.params.id]);
    if (user[0]?.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Cannot ban another admin' });
    }

    await pool.query(
      "UPDATE users SET status = 'banned' WHERE id = ?",
      [req.params.id]
    );

    // Cancel all pending bookings for banned user
    await pool.query(
      "UPDATE bookings SET status = 'cancelled', cancellation_reason = ? WHERE rider_id = ? AND status = 'pending'",
      [`Account banned: ${reason}`, req.params.id]
    );

    res.json({ success: true, message: 'User banned successfully' });
  } catch (err) {
    console.error('🔥 SQL Error in /ban user:', err);
    res.status(500).json({ success: false, message: 'Failed to ban user' });
  }
});

// ── PUT /admin/users/:id/unban ───────────────────────────────────────────────
router.put('/users/:id/unban', async (req, res) => {
  try {
    await pool.query("UPDATE users SET status = 'active' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'User reinstated successfully' });
  } catch (err) {
    console.error('🔥 SQL Error in /unban user:', err);
    res.status(500).json({ success: false, message: 'Failed to unban user' });
  }
});

// ── GET /admin/disputes ───────────────────────────────────────────────────────
router.get('/disputes', async (req, res) => {
  const { status = 'open' } = req.query;
  try {
    const [disputes] = await pool.query(
      `SELECT d.*, rb.full_name AS raised_by_name, ab.full_name AS against_name
       FROM disputes d
       LEFT JOIN users rb ON rb.id = d.raised_by
       LEFT JOIN users ab ON ab.id = d.against
       WHERE d.status = ? ORDER BY d.created_at DESC`,
      [status]
    );
    res.json({ success: true, data: disputes });
  } catch (err) {
    console.error('🔥 SQL Error in /disputes:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch disputes' });
  }
});

// ── PUT /admin/disputes/:id/resolve ──────────────────────────────────────────
router.put('/disputes/:id/resolve', async (req, res) => {
  const { resolution } = req.body;
  try {
    await pool.query(
      `UPDATE disputes SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = NOW()
       WHERE id = ?`,
      [resolution, req.user.id, req.params.id]
    );
    res.json({ success: true, message: 'Dispute resolved' });
  } catch (err) {
    console.error('🔥 SQL Error resolving dispute:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve dispute' });
  }
});

module.exports = router;