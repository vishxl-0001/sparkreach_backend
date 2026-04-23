const express = require('express');
const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// ── Helper: Normalize numeric fields ────────────────────────────────────────────
// Some database drivers return decimal fields as strings, convert them to numbers
function normalizeBooking(booking) {
  if (!booking) return booking;
  
  const numericFields = [
    'estimated_kwh', 'total_amount', 'power_kw', 
    'approx_lat', 'approx_lng', 'exact_lat', 'exact_lng',
    'price_per_kwh'
  ];
  
  numericFields.forEach(field => {
    if (booking[field] !== null && booking[field] !== undefined && !isNaN(booking[field])) {
      booking[field] = parseFloat(booking[field]);
    }
  });
  
  return booking;
}

// ── POST /bookings ────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { station_id, scheduled_start, scheduled_end, estimated_kwh, total_amount } = req.body;

  try {
    // Validate input
    if (!station_id || !scheduled_start || !scheduled_end || !estimated_kwh || !total_amount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Get station + host info
    const [stations] = await pool.query(
      'SELECT id, host_id FROM chargers WHERE id = ? AND is_active = TRUE',
      [station_id]
    );

    if (!stations || stations.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found or not active' });
    }

    // Check for conflicting bookings
    const [conflicts] = await pool.query(
      `SELECT id FROM bookings WHERE station_id = ? AND status IN ('confirmed','active')
       AND NOT (scheduled_end <= ? OR scheduled_start >= ?)`,
      [station_id, scheduled_start, scheduled_end]
    );

    if (conflicts && conflicts.length) {
      return res.status(409).json({ success: false, message: 'Time slot already booked' });
    }

    const bookingId = uuidv4();
    await pool.query(
      `INSERT INTO bookings (id, rider_id, host_id, station_id, scheduled_start, scheduled_end, estimated_kwh, total_amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [bookingId, req.user.id, stations[0].host_id, station_id, scheduled_start, scheduled_end, estimated_kwh, total_amount]
    );

    const [booking] = await pool.query(
      `SELECT b.*, s.location_name AS station_title, s.latitude AS approx_lat, s.longitude AS approx_lng,
              s.charger_type AS connector_type, s.power_output_kw AS power_kw, s.address AS charger_address,
              u.full_name AS host_name, u.phone AS host_phone, u.email AS host_email
       FROM bookings b
       LEFT JOIN chargers s ON s.id = b.station_id 
       LEFT JOIN users u ON u.id = b.host_id
       WHERE b.id = ?`,
      [bookingId]
    );

    if (!booking || booking.length === 0) {
      return res.status(500).json({ success: false, message: 'Failed to create booking - could not retrieve booking data' });
    }

    // Normalize numeric fields (convert strings to numbers)
    const bookingData = normalizeBooking(booking[0]);

    console.log('✅ Booking created:', bookingId);
    res.status(201).json({ success: true, data: bookingData });
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ success: false, message: 'Failed to create booking: ' + err.message });
  }
});

// ── GET /bookings/user/me ─────────────────────────────────────────────────────
router.get('/user/me', authenticate, async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT b.*, s.location_name AS station_title, s.latitude AS approx_lat, s.longitude AS approx_lng,
              s.charger_type AS connector_type, s.power_output_kw AS power_kw, s.price_per_hour AS price_per_kwh, u.full_name AS host_name
       FROM bookings b
       LEFT JOIN chargers s ON s.id = b.station_id
       LEFT JOIN users u ON u.id = b.host_id
       WHERE b.rider_id = ? ORDER BY b.created_at DESC`,
      [req.user.id]
    );

    // Normalize numeric fields and filter location data
    const filtered = bookings.map(b => {
      const normalized = normalizeBooking(b);
      return {
        ...normalized,
        exact_lat: normalized.status === 'confirmed' || normalized.status === 'active' ? normalized.exact_lat : null,
        exact_lng: normalized.status === 'confirmed' || normalized.status === 'active' ? normalized.exact_lng : null,
        exact_address: normalized.status === 'confirmed' || normalized.status === 'active' ? normalized.exact_address : null,
      };
    });

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// ── GET /bookings/host/me ─────────────────────────────────────────────────────
router.get('/host/me', authenticate, async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT b.*, 
              u.full_name AS rider_name, u.phone AS rider_phone, u.email AS rider_email,
              s.location_name AS station_title, s.address AS charger_address,
              s.latitude AS approx_lat, s.longitude AS approx_lng,
              s.charger_type AS connector_type, s.power_output_kw AS power_kw,
              s.price_per_hour AS price_per_kwh
       FROM bookings b
       LEFT JOIN users u ON u.id = b.rider_id
       LEFT JOIN chargers s ON s.id = b.station_id
       WHERE b.host_id = ? ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    
    // Normalize numeric fields
    const normalized = bookings.map(b => normalizeBooking(b));
    res.json({ success: true, data: normalized });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

// ── GET /bookings/:id ─────────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT b.*, s.location_name AS station_title, s.latitude AS approx_lat, s.longitude AS approx_lng,
              s.charger_type AS connector_type, s.power_output_kw AS power_kw, s.address AS charger_address,
              u.full_name AS host_name, u.phone AS host_phone, u.email AS host_email
       FROM bookings b LEFT JOIN chargers s ON s.id = b.station_id
       LEFT JOIN users u ON u.id = b.host_id
       WHERE b.id = ? AND (b.rider_id = ? OR b.host_id = ?)`,
      [req.params.id, req.user.id, req.user.id]
    );

    if (!bookings.length) return res.status(404).json({ success: false, message: 'Booking not found' });

    const b = normalizeBooking(bookings[0]);
    // Privacy: mask exact location unless confirmed
    const isConfirmed = b.status === 'confirmed' || b.status === 'active';
    b.exact_lat = isConfirmed ? b.exact_lat : null;
    b.exact_lng = isConfirmed ? b.exact_lng : null;
    b.exact_address = isConfirmed ? b.exact_address : null;

    res.json({ success: true, data: b });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch booking' });
  }
});

// ── PATCH /bookings/:id/confirm ───────────────────────────────────────────────
// Called after successful Razorpay payment — REVEALS exact location
router.patch('/:id/confirm', authenticate, async (req, res) => {
  const { payment_id } = req.body;

  try {
    const [bookings] = await pool.query(
      `SELECT b.*, 
              s.id AS charger_id,
              s.latitude, s.longitude, s.address, 
              s.location_name AS station_title, s.charger_type AS connector_type,
              s.power_output_kw AS power_kw,
              u.full_name AS host_name, u.phone AS host_phone, u.email AS host_email
       FROM bookings b 
       JOIN chargers s ON s.id = b.station_id
       LEFT JOIN users u ON u.id = b.host_id
       WHERE b.id = ? AND b.rider_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!bookings.length) return res.status(404).json({ success: false, message: 'Booking not found' });

    const booking = bookings[0];
    if (booking.status !== 'pending') {
      return res.status(409).json({ success: false, message: 'Booking is not in pending state' });
    }

    // Use charger's latitude and longitude (not aliased yet)
    const chargerLat = booking.latitude;
    const chargerLng = booking.longitude;
    const chargerAddress = booking.address;
    
    console.log(`✅ [Confirm] Confirming booking ${req.params.id} with charger location: ${chargerLat}, ${chargerLng}`);

    // Update booking: confirm + reveal exact location using charger's actual coordinates
    await pool.query(
      `UPDATE bookings SET status = 'confirmed', payment_id = ?, confirmed_at = NOW(),
       exact_lat = ?, exact_lng = ?, exact_address = ?
       WHERE id = ?`,
      [payment_id, chargerLat, chargerLng, chargerAddress, req.params.id]
    );

    // Fetch updated booking with all details - verify what was saved
    const [updated] = await pool.query(
      `SELECT b.*, 
              s.location_name AS station_title, s.charger_type AS connector_type,
              s.power_output_kw AS power_kw,
              u.full_name AS host_name, u.phone AS host_phone, u.email AS host_email
       FROM bookings b
       JOIN chargers s ON s.id = b.station_id
       LEFT JOIN users u ON u.id = b.host_id
       WHERE b.id = ?`,
      [req.params.id]
    );
    
    console.log(`✅ [Confirm] Updated booking exact location: lat=${updated[0].exact_lat}, lng=${updated[0].exact_lng}`);
    
    const normalizedBooking = normalizeBooking(updated[0]);
    res.json({ success: true, data: normalizedBooking });
  } catch (err) {
    console.error('Confirm booking error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm booking' });
  }
});

// ── GET /bookings/:id/location ────────────────────────────────────────────────
// Explicit exact location endpoint (redundant safety check)
router.get('/:id/location', authenticate, async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT b.exact_lat, b.exact_lng, b.exact_address, b.status
       FROM bookings b WHERE b.id = ? AND b.rider_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!bookings.length) return res.status(404).json({ success: false, message: 'Booking not found' });

    const b = bookings[0];
    if (b.status !== 'confirmed' && b.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Location not yet available. Complete payment first.' });
    }

    res.json({ success: true, data: { lat: b.exact_lat, lng: b.exact_lng, address: b.exact_address } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch location' });
  }
});

// ── PATCH /bookings/:id/cancel ────────────────────────────────────────────────
router.patch('/:id/cancel', authenticate, async (req, res) => {
  const { reason } = req.body;

  try {
    console.log('🔍 [Cancel] Attempting to cancel booking:', req.params.id, 'by user:', req.user.id);
    
    // First, check if booking exists with debugging
    const [allBookings] = await pool.query(
      "SELECT id, rider_id, host_id, status FROM bookings WHERE id = ?",
      [req.params.id]
    );
    
    console.log('📋 [Cancel] Query result - All bookings found:', allBookings.length > 0);
    if (allBookings.length > 0) {
      console.log('📊 [Cancel] Booking details:', {
        id: allBookings[0].id,
        rider_id: allBookings[0].rider_id,
        host_id: allBookings[0].host_id,
        status: allBookings[0].status,
        auth_user_id: req.user.id,
        is_rider: allBookings[0].rider_id === req.user.id,
        is_host: allBookings[0].host_id === req.user.id
      });
    }

    // Check if user owns booking AND status is cancellable (not completed/cancelled)
    const [bookings] = await pool.query(
      "SELECT * FROM bookings WHERE id = ? AND (rider_id = ? OR host_id = ?) AND status NOT IN ('completed', 'cancelled', 'active')",
      [req.params.id, req.user.id, req.user.id]
    );

    console.log('✅ [Cancel] Matching bookings found:', bookings.length);

    if (!bookings.length) {
      console.log('❌ [Cancel] Booking not found or cannot be cancelled');
      return res.status(404).json({ success: false, message: 'Booking not found or cannot be cancelled' });
    }

    await pool.query(
      "UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), cancellation_reason = ? WHERE id = ?",
      [reason || null, req.params.id]
    );

    console.log('✅ [Cancel] Booking cancelled successfully:', req.params.id);
    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    console.error('❌ [Cancel] Error cancelling booking:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel booking: ' + err.message });
  }
});

// ── PATCH /bookings/:id/complete ──────────────────────────────────────────────
router.patch('/:id/complete', authenticate, async (req, res) => {
  try {
    await pool.query(
      "UPDATE bookings SET status = 'completed', completed_at = NOW() WHERE id = ? AND host_id = ?",
      [req.params.id, req.user.id]
    );

    res.json({ success: true, message: 'Session completed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to complete booking' });
  }
});

module.exports = router;
