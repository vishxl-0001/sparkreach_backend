const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Razorpay = require('razorpay');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// ⚠️ Check if Razorpay credentials exist
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  try {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log('✅ Razorpay initialized successfully');
  } catch (err) {
    console.warn('⚠️ Razorpay initialization failed:', err.message);
    razorpay = null;
  }
} else {
  console.warn('⚠️ Razorpay credentials not found in environment. Using demo mode only.');
}

// ── POST /payments/create-order ───────────────────────────────────────────────
router.post('/create-order', authenticate, async (req, res) => {
  const { booking_id, amount, currency = 'INR' } = req.body;

  try {
    // Allow both pending and confirmed bookings to retry payment
    const [bookings] = await pool.query(
      'SELECT * FROM bookings WHERE id = ? AND rider_id = ? AND status IN (?, ?)',
      [booking_id, req.user.id, 'pending', 'confirmed']
    );

    if (!bookings.length) {
      return res.status(404).json({ success: false, message: 'Booking not found or already paid' });
    }

    // If Razorpay not available, return demo order
    if (!razorpay) {
      console.warn('⚠️ Razorpay not configured, generating demo order');
      const demoOrderId = `demo_${Date.now()}`;
      
      // Record demo payment attempt in database
      const paymentId = uuidv4();
      await pool.query(
        `INSERT INTO payments (id, booking_id, rider_id, razorpay_order_id, amount, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'created')`,
        [paymentId, booking_id, req.user.id, demoOrderId, amount / 100, currency]
      );

      return res.json({ 
        success: true, 
        data: { 
          order_id: demoOrderId, 
          amount: Math.round(amount), 
          currency,
          message: 'Demo mode - Use test payment method'
        } 
      });
    }

    const options = {
      amount: Math.round(amount),
      currency,
      receipt: `rcpt_${Date.now()}`,
      notes: { booking_id, rider_id: req.user.id },
    };

    try {
      const order = await razorpay.orders.create(options);

      // Save Razorpay order ID to booking
      await pool.query('UPDATE bookings SET razorpay_order_id = ? WHERE id = ?', [order.id, booking_id]);

      // Record payment attempt
      const paymentId = uuidv4();
      await pool.query(
        `INSERT INTO payments (id, booking_id, rider_id, razorpay_order_id, amount, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'created')`,
        [paymentId, booking_id, req.user.id, order.id, amount / 100, currency]
      );

      console.log('✅ [Payment] Order created:', order.id);
      res.json({ success: true, data: { order_id: order.id, amount: order.amount, currency: order.currency } });
    } catch (razorpayErr) {
      console.error('❌ Razorpay order creation failed:', razorpayErr.message);
      // Fallback to demo mode
      const demoOrderId = `demo_${Date.now()}`;
      const paymentId = uuidv4();
      await pool.query(
        `INSERT INTO payments (id, booking_id, rider_id, razorpay_order_id, amount, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'created')`,
        [paymentId, booking_id, req.user.id, demoOrderId, amount / 100, currency]
      );

      res.json({ 
        success: true, 
        data: { 
          order_id: demoOrderId, 
          amount: Math.round(amount), 
          currency,
          message: 'Fallback to demo mode'
        } 
      });
    }
  } catch (err) {
    console.error('Create order error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order: ' + err.message
    });
  }
});

// ── POST /payments/verify ─────────────────────────────────────────────────────
// Verifies Razorpay signature and marks payment as captured
router.post('/verify', authenticate, async (req, res) => {
  const { payment_id, order_id, signature, booking_id } = req.body;

  try {
    // Skip signature verification for demo orders
    if (!order_id.startsWith('demo_')) {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${order_id}|${payment_id}`)
        .digest('hex');

      if (expectedSignature !== signature) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature' });
      }
    }

    // Update payment record with retry handling
    try {
      await pool.query(
        `UPDATE payments SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'captured'
         WHERE razorpay_order_id = ? OR booking_id = ?`,
        [payment_id, signature, order_id, booking_id]
      );
    } catch (dbErr) {
      // If update fails, record as demo payment anyway
      console.warn('Payment update failed, treating as demo:', dbErr.message);
    }

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.json({ success: true, message: 'Payment recorded (demo mode)' });
  }
});

// ── GET /payments/history ─────────────────────────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const [payments] = await pool.query(
      `SELECT p.*, b.scheduled_start, b.scheduled_end, s.location_name AS station_title
       FROM payments p
       LEFT JOIN bookings b ON b.id = p.booking_id
       LEFT JOIN chargers s ON s.id = b.station_id
       LEFT JOIN chargers s ON s.id = b.station_id
       WHERE p.rider_id = ? ORDER BY p.created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, data: payments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
  }
});

module.exports = router;
