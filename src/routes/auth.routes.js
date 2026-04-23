const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();

// 🔐 JWT Token
const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });


// ── REGISTER ─────────────────────────────────────────────
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('phone').notEmpty(),
], async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  const { name, email, password, phone, role = 'RIDER' } = req.body;

  try {
    // Check existing user
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();

    // Insert user (FIXED COLUMN NAMES)
    await pool.query(
      `INSERT INTO users (id, full_name, email, password_hash, phone, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, name, email, passwordHash, phone, role]
    );

    const [user] = await pool.query(
      `SELECT id, full_name AS name, email, phone, role, created_at
       FROM users WHERE id = ?`,
      [userId]
    );

    const token = generateToken(userId);

    res.status(201).json({
      success: true,
      token,
      data: { user: user[0] },
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});


// ── LOGIN ─────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid input' });
  }

  const { email, password } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT id, full_name AS name, email, phone, password_hash, role, created_at
       FROM users WHERE email = ?`,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const { password_hash, ...userData } = user;
    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      data: { user: userData },
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});


// ── GET PROFILE ─────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, full_name AS name, email, phone, role, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, data: rows[0] });

  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// ── UPDATE PROFILE ─────────────────────────────────────────────
router.put('/profile', authenticate, async (req, res) => {
  const { name, phone } = req.body;

  try {
    await pool.query(
      `UPDATE users 
       SET full_name = COALESCE(?, full_name),
           phone = COALESCE(?, phone)
       WHERE id = ?`,
      [name, phone, req.user.id]
    );

    const [updated] = await pool.query(
      `SELECT id, full_name AS name, email, phone, role
       FROM users WHERE id = ?`,
      [req.user.id]
    );

    res.json({ success: true, data: updated[0] });

  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});


// ── LOGOUT ─────────────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});


module.exports = router;