const errorHandler = (err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ success: false, message: 'Duplicate entry — record already exists' });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({ success: false, message: err.message });
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
};

module.exports = { errorHandler };
