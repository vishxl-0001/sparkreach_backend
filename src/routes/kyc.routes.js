const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// ────────────────────────────────────────────────────────────────────────────
// 🔐 PROTECTED ROUTES - Require authentication
// ────────────────────────────────────────────────────────────────────────────

// ── POST /kyc/submit - Submit or Resubmit KYC documents ──────────────────────
router.post('/submit', authenticate, [
  body('document_type').isIn(['aadhar', 'pan', 'voter_id']).withMessage('Invalid document type'),
  body('upi_id').notEmpty().withMessage('UPI ID is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { document_type, upi_id, document_url, charger_image_url, additional_documents } = req.body;
  const userId = req.user.id;

  try {
    // 1. Fetch the user's latest KYC record
    const [existing] = await pool.query(
      `SELECT id, status FROM kyc_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (existing.length > 0) {
      const kyc = existing[0];

      if (kyc.status === 'approved') {
        return res.status(409).json({ success: false, message: 'KYC already approved.' });
      }
      if (kyc.status === 'pending') {
        return res.status(409).json({ success: false, message: 'KYC already submitted. Waiting for admin approval.' });
      }

      // 🔥 THE FIX: If it was rejected, UPDATE the existing record instead of crashing!
      if (kyc.status === 'rejected') {
        await pool.query(
          `UPDATE kyc_requests 
           SET document_type = ?, 
               document_url = ?, 
               charger_image_url = ?, 
               upi_id = ?, 
               additional_documents = ?, 
               status = 'pending', 
               rejection_reason = NULL, 
               updated_at = NOW()
           WHERE id = ?`,
          [
            document_type,
            document_url || null,
            charger_image_url || null,
            upi_id,
            additional_documents ? JSON.stringify(additional_documents) : null,
            kyc.id
          ]
        );
        return res.json({ success: true, message: 'KYC resubmitted successfully' });
      }
    }

    // 2. First-time submission (if no existing record was found)
    const kycId = uuidv4();
    await pool.query(
      `INSERT INTO kyc_requests 
       (id, user_id, document_type, document_url, charger_image_url, upi_id, additional_documents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        kycId, 
        userId, 
        document_type, 
        document_url || null, 
        charger_image_url || null, 
        upi_id, 
        additional_documents ? JSON.stringify(additional_documents) : null
      ]
    );

    res.json({ success: true, message: 'KYC submitted successfully' });
  } catch (err) {
    console.error('🔥 KYC Submit Error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit KYC' });
  }
});

// ── GET /kyc/my-kyc - Get user's KYC status ───────────────────────────────────
router.get('/my-kyc', authenticate, async (req, res) => {
  const userId = req.user.id;

  try {
    const [kycs] = await pool.query(
      `SELECT id, document_type, upi_id, status, rejection_reason, created_at, updated_at
       FROM kyc_requests 
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    if (!kycs.length) {
      // 🔥 FIX: Changed 404 to 200 so Flutter doesn't treat this as an API crash
      return res.status(200).json({
        success: true,
        message: 'No KYC found',
        data: null,
      });
    }

    // Return the most recent KYC
    res.json({
      success: true,
      data: kycs[0],
    });
  } catch (err) {
    console.error('❌ Get KYC error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC status' });
  }
});

// ── GET /kyc/all - Get all pending KYC requests ─────────────────────────────
router.get('/all', authenticate, requireAdmin, async (req, res) => {
  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const [kycs] = await pool.query(
      `SELECT 
        kr.id, kr.user_id, kr.document_type, kr.upi_id, kr.status, 
        kr.document_url, kr.charger_image_url, kr.rejection_reason,
        kr.created_at, kr.updated_at,
        u.full_name AS user_name, u.email, u.phone
       FROM kyc_requests kr
       JOIN users u ON kr.user_id = u.id
       WHERE kr.status = ?
       ORDER BY kr.created_at DESC
       LIMIT ? OFFSET ?`,
      [status, parseInt(limit), offset]
    );

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM kyc_requests WHERE status = ?',
      [status]
    );

    res.json({
      success: true,
      data: kycs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('❌ Get all KYC error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC requests' });
  }
});

// ── POST /kyc/:id/approve - Approve KYC request ───────────────────────────────
router.post('/:id/approve', authenticate, requireAdmin, async (req, res) => {
  const kycId = req.params.id;
  const adminId = req.user.id;

  try {
    // Get KYC request
    const [kyc] = await pool.query(
      'SELECT user_id, status FROM kyc_requests WHERE id = ?',
      [kycId]
    );

    if (!kyc.length) {
      return res.status(404).json({ success: false, message: 'KYC request not found' });
    }

    if (kyc[0].status === 'approved') {
      return res.status(409).json({ success: false, message: 'KYC already approved' });
    }

    const userId = kyc[0].user_id;

    // Update KYC status
    await pool.query(
      `UPDATE kyc_requests 
       SET status = 'approved', approved_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [adminId, kycId]
    );

    // Update user as approved host
    await pool.query(
      `UPDATE users 
       SET is_host_approved = TRUE, kyc_verified_at = NOW()
       WHERE id = ?`,
      [userId]
    );

    res.json({
      success: true,
      message: 'KYC approved successfully',
    });
  } catch (err) {
    console.error('❌ KYC approval error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve KYC' });
  }
});

// ── POST /kyc/:id/reject - Reject KYC request ────────────────────────────────
router.post('/:id/reject', authenticate, requireAdmin, [
  body('rejection_reason').trim().notEmpty().withMessage('Rejection reason is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const kycId = req.params.id;
  const { rejection_reason } = req.body;

  try {
    // Get KYC request
    const [kyc] = await pool.query(
      'SELECT status FROM kyc_requests WHERE id = ?',
      [kycId]
    );

    if (!kyc.length) {
      return res.status(404).json({ success: false, message: 'KYC request not found' });
    }

    if (kyc[0].status === 'rejected') {
      return res.status(409).json({ success: false, message: 'KYC already rejected' });
    }

    // Update KYC status
    await pool.query(
      `UPDATE kyc_requests 
       SET status = 'rejected', rejection_reason = ?, updated_at = NOW()
       WHERE id = ?`,
      [rejection_reason, kycId]
    );

    res.json({
      success: true,
      message: 'KYC rejected successfully',
    });
  } catch (err) {
    console.error('❌ KYC rejection error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject KYC' });
  }
});

// ── GET /kyc/:id - Get specific KYC details (admin) ──────────────────────────
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  const kycId = req.params.id;

  try {
    const [kyc] = await pool.query(
      `SELECT 
        kr.*, u.full_name AS user_name, u.email, u.phone
       FROM kyc_requests kr
       JOIN users u ON kr.user_id = u.id
       WHERE kr.id = ?`,
      [kycId]
    );

    if (!kyc.length) {
      return res.status(404).json({ success: false, message: 'KYC not found' });
    }

    // Parse JSON fields
    if (kyc[0].additional_documents) {
      kyc[0].additional_documents = JSON.parse(kyc[0].additional_documents);
    }

    res.json({
      success: true,
      data: kyc[0],
    });
  } catch (err) {
    console.error('❌ Get KYC details error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC details' });
  }
});

module.exports = router;
