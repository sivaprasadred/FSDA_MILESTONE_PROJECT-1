-- ============================================================
-- TrackWise: Relational Expense Analytics Platform
-- MySQL Database Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS trackwise_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE trackwise_db;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar_color VARCHAR(7) DEFAULT '#4f46e5',
    role ENUM('user', 'admin') DEFAULT 'user',
    monthly_budget DECIMAL(12,2) DEFAULT 5000.00,
    currency VARCHAR(10) DEFAULT 'INR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    icon VARCHAR(50) DEFAULT '💰',
    color VARCHAR(7) DEFAULT '#4f46e5',
    budget_limit DECIMAL(12,2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT,
    title VARCHAR(200) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    type ENUM('expense', 'income') DEFAULT 'expense',
    date DATE NOT NULL,
    description TEXT,
    payment_method ENUM('cash', 'card', 'upi', 'netbanking', 'other') DEFAULT 'cash',
    tags VARCHAR(500),
    is_recurring BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(512) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Budget alerts
CREATE TABLE IF NOT EXISTS budget_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category_id INT,
    alert_type VARCHAR(50),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX idx_expenses_user_date ON expenses(user_id, date);
CREATE INDEX idx_expenses_category ON expenses(category_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ============================================================
-- Default categories (for each new user - handled in app)
-- ============================================================

-- Sample admin user (password: Admin@123)
INSERT INTO users (name, email, password_hash, role, avatar_color) VALUES
('Admin User', 'admin@trackwise.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaRgRl3uJmR5Dl1ZHiMVXpPHa', 'admin', '#dc2626');

-- ============================================================
-- VIEWS for analytics
-- ============================================================

CREATE OR REPLACE VIEW monthly_summary AS
SELECT 
    u.id as user_id,
    YEAR(e.date) as year,
    MONTH(e.date) as month,
    SUM(CASE WHEN e.type = 'expense' THEN e.amount ELSE 0 END) as total_expenses,
    SUM(CASE WHEN e.type = 'income' THEN e.amount ELSE 0 END) as total_income,
    COUNT(CASE WHEN e.type = 'expense' THEN 1 END) as expense_count,
    COUNT(CASE WHEN e.type = 'income' THEN 1 END) as income_count
FROM users u
LEFT JOIN expenses e ON u.id = e.user_id
GROUP BY u.id, YEAR(e.date), MONTH(e.date);

CREATE OR REPLACE VIEW category_spending AS
SELECT 
    e.user_id,
    c.id as category_id,
    c.name as category_name,
    c.icon,
    c.color,
    c.budget_limit,
    YEAR(e.date) as year,
    MONTH(e.date) as month,
    SUM(e.amount) as total_spent,
    COUNT(*) as transaction_count
FROM expenses e
JOIN categories c ON e.category_id = c.id
WHERE e.type = 'expense'
GROUP BY e.user_id, c.id, YEAR(e.date), MONTH(e.date);
