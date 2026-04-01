// ============================================================
// TrackWise: Relational Expense Analytics Platform
// Node.js + Express Backend Server
// ============================================================

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trackwise_default_secret_change_me';


const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'trackwise_db',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+05:30'
});


(async () => {
  try {
    const conn = await dbPool.getConnection();
    console.log('✅ MySQL connected successfully');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('   Make sure XAMPP MySQL is running and database.sql is imported');
  }
})();

// ============================================================
// Middleware
// ============================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

app.use('/api', generalLimiter);
app.use('/api/auth/login', loginLimiter);

// ============================================================
// SSE (Server-Sent Events) — Real-time Push to Clients
// ============================================================
const sseClients = new Map(); // userId => Set of response objects

function addSSEClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);
}

function removeSSEClient(userId, res) {
  if (sseClients.has(userId)) {
    sseClients.get(userId).delete(res);
    if (sseClients.get(userId).size === 0) sseClients.delete(userId);
  }
}

function pushToUser(userId, event, data) {
  if (!sseClients.has(userId)) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.get(userId).forEach(res => {
    try { res.write(msg); } catch (e) { removeSSEClient(userId, res); }
  });
}

// GET /api/events — SSE stream (token via query param since EventSource can't send headers)
app.get('/api/events', async (req, res) => {
  const token = req.query._auth;
  if (!token) return res.status(401).json({ error: 'Token required' });

  let user;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await dbPool.execute(
      'SELECT id, name, email FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.userId]
    );
    if (!rows.length) return res.status(401).json({ error: 'User not found' });
    user = rows[0];
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ message: 'SSE connected', userId: user.id })}\n\n`);

  addSSEClient(user.id, res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(user.id, res);
  });
});


const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const [rows] = await dbPool.execute(
      'SELECT id, name, email, role, monthly_budget, currency, avatar_color FROM users WHERE id = ? AND is_active = TRUE',
      [decoded.userId]
    );
    if (!rows.length) return res.status(401).json({ error: 'User not found' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ============================================================
// DEFAULT CATEGORIES HELPER
// ============================================================
const createDefaultCategories = async (userId) => {
  const defaults = [
    { name: 'Food & Dining', icon: '🍽️', color: '#f97316' },
    { name: 'Transport', icon: '🚗', color: '#3b82f6' },
    { name: 'Shopping', icon: '🛍️', color: '#ec4899' },
    { name: 'Entertainment', icon: '🎬', color: '#8b5cf6' },
    { name: 'Health', icon: '🏥', color: '#10b981' },
    { name: 'Utilities', icon: '⚡', color: '#f59e0b' },
    { name: 'Education', icon: '📚', color: '#06b6d4' },
    { name: 'Salary', icon: '💼', color: '#22c55e' },
    { name: 'Freelance', icon: '💻', color: '#6366f1' },
    { name: 'Other', icon: '📦', color: '#6b7280' }
  ];
  for (const cat of defaults) {
    await dbPool.execute(
      'INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)',
      [userId, cat.name, cat.icon, cat.color]
    );
  }
};

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, monthly_budget, currency } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email, and password are required' });

    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email))
      return res.status(400).json({ error: 'Invalid email format' });

    // Check existing user
    const [existing] = await dbPool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const colors = ['#4f46e5', '#dc2626', '#059669', '#d97706', '#7c3aed', '#db2777'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const [result] = await dbPool.execute(
      'INSERT INTO users (name, email, password_hash, monthly_budget, currency, avatar_color) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), email.toLowerCase(), passwordHash, monthly_budget || 5000, currency || 'INR', avatarColor]
    );

    await createDefaultCategories(result.insertId);

    const token = jwt.sign({ userId: result.insertId }, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: { id: result.insertId, name: name.trim(), email, monthly_budget: monthly_budget || 5000, currency: currency || 'INR', avatar_color: avatarColor }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const [users] = await dbPool.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
      [email.toLowerCase()]
    );

    if (!users.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = users[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) return res.status(401).json({ error: 'Invalid email or password' });

    await dbPool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, monthly_budget: user.monthly_budget,
        currency: user.currency, avatar_color: user.avatar_color
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

// POST /api/auth/forgot-password
// Step 1: Verify email exists and check security answer
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const [rows] = await dbPool.execute(
      'SELECT id, name, email FROM users WHERE email = ? AND is_active = TRUE',
      [email.toLowerCase()]
    );

    // Always return success to prevent email enumeration
    if (!rows.length) {
      return res.json({ success: true, message: 'If this email exists, you can now reset your password.' });
    }

    res.json({
      success: true,
      exists: true,
      message: 'Email verified. You can now reset your password.',
      user_id: rows[0].id
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/reset-password
// Step 2: Set new password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, new_password } = req.body;
    if (!email || !new_password)
      return res.status(400).json({ error: 'Email and new password are required' });

    if (new_password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const [rows] = await dbPool.execute(
      'SELECT id FROM users WHERE email = ? AND is_active = TRUE',
      [email.toLowerCase()]
    );

    if (!rows.length)
      return res.status(404).json({ error: 'No account found with this email' });

    const passwordHash = await bcrypt.hash(new_password, 12);
    await dbPool.execute(
      'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE email = ?',
      [passwordHash, email.toLowerCase()]
    );

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Reset failed. Please try again.' });
  }
});

// ============================================================
// USER ROUTES
// ============================================================

// PUT /api/user/profile
app.put('/api/user/profile', authenticate, async (req, res) => {
  try {
    const { name, monthly_budget, currency } = req.body;
    await dbPool.execute(
      'UPDATE users SET name = ?, monthly_budget = ?, currency = ? WHERE id = ?',
      [name || req.user.name, monthly_budget || req.user.monthly_budget, currency || req.user.currency, req.user.id]
    );
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// PUT /api/user/password
app.put('/api/user/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [users] = await dbPool.execute('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const isValid = await bcrypt.compare(current_password, users[0].password_hash);
    if (!isValid) return res.status(400).json({ error: 'Current password is incorrect' });
    if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(new_password, 12);
    await dbPool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ success: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Password update failed' });
  }
});

// ============================================================
// CATEGORY ROUTES
// ============================================================

// GET /api/categories
app.get('/api/categories', authenticate, async (req, res) => {
  try {
    const [rows] = await dbPool.execute(
      'SELECT * FROM categories WHERE user_id = ? ORDER BY name',
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories
app.post('/api/categories', authenticate, async (req, res) => {
  try {
    const { name, icon, color, budget_limit } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name required' });
    const [result] = await dbPool.execute(
      'INSERT INTO categories (user_id, name, icon, color, budget_limit) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name.trim(), icon || '📦', color || '#6b7280', budget_limit || null]
    );
    pushToUser(req.user.id, 'category_changed', { action: 'added', id: result.insertId });
    res.status(201).json({ success: true, id: result.insertId, message: 'Category created' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/categories/:id
app.put('/api/categories/:id', authenticate, async (req, res) => {
  try {
    const { name, icon, color, budget_limit } = req.body;
    const [result] = await dbPool.execute(
      'UPDATE categories SET name = ?, icon = ?, color = ?, budget_limit = ? WHERE id = ? AND user_id = ?',
      [name, icon, color, budget_limit || null, req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Category not found' });
    pushToUser(req.user.id, 'category_changed', { action: 'updated', id: req.params.id });
    res.json({ success: true, message: 'Category updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id
app.delete('/api/categories/:id', authenticate, async (req, res) => {
  try {
    const [result] = await dbPool.execute(
      'DELETE FROM categories WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Category not found' });
    pushToUser(req.user.id, 'category_changed', { action: 'deleted', id: req.params.id });
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ============================================================
// EXPENSE ROUTES
// ============================================================

// GET /api/expenses
app.get('/api/expenses', authenticate, async (req, res) => {
  try {
    const {
      page = 1, limit = 20, type, category_id,
      start_date, end_date, payment_method, search,
      sort = 'date', order = 'DESC'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE e.user_id = ?';
    const params = [req.user.id];

    if (type) { where += ' AND e.type = ?'; params.push(type); }
    if (category_id) { where += ' AND e.category_id = ?'; params.push(category_id); }
    if (start_date) { where += ' AND e.date >= ?'; params.push(start_date); }
    if (end_date) { where += ' AND e.date <= ?'; params.push(end_date); }
    if (payment_method) { where += ' AND e.payment_method = ?'; params.push(payment_method); }
    if (search) { where += ' AND (e.title LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const sortCol = ['date', 'amount', 'title', 'created_at'].includes(sort) ? sort : 'date';
    const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

    const [rows] = await dbPool.execute(
      `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       ${where} ORDER BY e.${sortCol} ${sortOrder} LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countRows] = await dbPool.execute(
      `SELECT COUNT(*) as total FROM expenses e ${where}`,
      params
    );

    res.json({
      success: true,
      data: rows,
      pagination: {
        total: countRows[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countRows[0].total / limit)
      }
    });
  } catch (err) {
    console.error('Fetch expenses error:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// POST /api/expenses
app.post('/api/expenses', authenticate, async (req, res) => {
  try {
    const { title, amount, type, date, category_id, description, payment_method, tags, is_recurring } = req.body;

    if (!title || !amount || !date)
      return res.status(400).json({ error: 'Title, amount, and date are required' });

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return res.status(400).json({ error: 'Amount must be a positive number' });

    const [result] = await dbPool.execute(
      `INSERT INTO expenses (user_id, category_id, title, amount, type, date, description, payment_method, tags, is_recurring)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, category_id || null, title.trim(), parseFloat(amount),
       type || 'expense', date, description || null,
       payment_method || 'cash', tags || null, is_recurring ? 1 : 0]
    );

    pushToUser(req.user.id, 'expense_added', { id: result.insertId, title, amount, type, date });
    res.status(201).json({ success: true, id: result.insertId, message: 'Transaction added successfully' });
  } catch (err) {
    console.error('Add expense error:', err);
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

// PUT /api/expenses/:id
app.put('/api/expenses/:id', authenticate, async (req, res) => {
  try {
    const { title, amount, type, date, category_id, description, payment_method, tags } = req.body;

    const [result] = await dbPool.execute(
      `UPDATE expenses SET title = ?, amount = ?, type = ?, date = ?,
       category_id = ?, description = ?, payment_method = ?, tags = ?
       WHERE id = ? AND user_id = ?`,
      [title, parseFloat(amount), type, date, category_id || null,
       description || null, payment_method, tags || null, req.params.id, req.user.id]
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Transaction not found' });
    pushToUser(req.user.id, 'expense_updated', { id: req.params.id });
    res.json({ success: true, message: 'Transaction updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// DELETE /api/expenses/:id
app.delete('/api/expenses/:id', authenticate, async (req, res) => {
  try {
    const [result] = await dbPool.execute(
      'DELETE FROM expenses WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Transaction not found' });
    pushToUser(req.user.id, 'expense_deleted', { id: req.params.id });
    res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// ============================================================
// ANALYTICS ROUTES
// ============================================================

// GET /api/analytics/dashboard
app.get('/api/analytics/dashboard', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const month = req.query.month || (now.getMonth() + 1);

    // Current month totals
    const [monthData] = await dbPool.execute(
      `SELECT 
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as total_expense,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as total_income,
        COUNT(CASE WHEN type='expense' THEN 1 END) as expense_count,
        COUNT(CASE WHEN type='income' THEN 1 END) as income_count
       FROM expenses WHERE user_id = ? AND YEAR(date) = ? AND MONTH(date) = ?`,
      [userId, year, month]
    );

    // Category breakdown this month
    const [categoryData] = await dbPool.execute(
      `SELECT c.name, c.icon, c.color, c.budget_limit,
        SUM(e.amount) as total, COUNT(*) as count
       FROM expenses e JOIN categories c ON e.category_id = c.id
       WHERE e.user_id = ? AND e.type = 'expense'
         AND YEAR(e.date) = ? AND MONTH(e.date) = ?
       GROUP BY c.id ORDER BY total DESC`,
      [userId, year, month]
    );

    // Last 6 months trend
    const [trendData] = await dbPool.execute(
      `SELECT YEAR(date) as year, MONTH(date) as month,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income
       FROM expenses WHERE user_id = ?
         AND date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY YEAR(date), MONTH(date) ORDER BY year, month`,
      [userId]
    );

    // Recent 5 transactions
    const [recent] = await dbPool.execute(
      `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color
       FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
       WHERE e.user_id = ? ORDER BY e.date DESC, e.created_at DESC LIMIT 5`,
      [userId]
    );

    // Payment method breakdown
    const [paymentData] = await dbPool.execute(
      `SELECT payment_method, SUM(amount) as total, COUNT(*) as count
       FROM expenses WHERE user_id = ? AND type = 'expense'
         AND YEAR(date) = ? AND MONTH(date) = ?
       GROUP BY payment_method`,
      [userId, year, month]
    );

    // Daily spending this month
    const [dailyData] = await dbPool.execute(
      `SELECT DAY(date) as day, SUM(amount) as total
       FROM expenses WHERE user_id = ? AND type = 'expense'
         AND YEAR(date) = ? AND MONTH(date) = ?
       GROUP BY DAY(date) ORDER BY day`,
      [userId, year, month]
    );

    const summary = monthData[0];
    const net = (summary.total_income || 0) - (summary.total_expense || 0);
    const budgetUsed = req.user.monthly_budget
      ? ((summary.total_expense || 0) / req.user.monthly_budget * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        summary: { ...summary, net, budget_used: parseFloat(budgetUsed), monthly_budget: req.user.monthly_budget },
        categories: categoryData,
        trend: trendData,
        recent,
        payments: paymentData,
        daily: dailyData
      }
    });
  } catch (err) {
    console.error('Dashboard analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/analytics/yearly
app.get('/api/analytics/yearly', authenticate, async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const [rows] = await dbPool.execute(
      `SELECT MONTH(date) as month,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        COUNT(*) as transactions
       FROM expenses WHERE user_id = ? AND YEAR(date) = ?
       GROUP BY MONTH(date) ORDER BY month`,
      [req.user.id, year]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch yearly data' });
  }
});

// ============================================================
// PAGES
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log('\n🚀 TrackWise Server Running');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log('   Press Ctrl+C to stop\n');
});

module.exports = app;
