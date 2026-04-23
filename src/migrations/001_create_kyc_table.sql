-- Create KYC Requests Table
CREATE TABLE IF NOT EXISTS kyc_requests (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  document_type ENUM('aadhar', 'pan', 'voter_id') NOT NULL,
  document_path VARCHAR(500) NOT NULL,
  document_url VARCHAR(500),
  charger_image_path VARCHAR(500),
  charger_image_url VARCHAR(500),
  upi_id VARCHAR(100) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  additional_documents JSON,
  rejection_reason VARCHAR(500),
  approved_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- Add KYC-related columns to users table (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_kyc_submitted BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP NULL;
