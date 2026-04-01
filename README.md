# 📊 TrackWise — Relational Expense Analytics Platform

A full-stack multi-user expense tracking application built with **HTML5 + CSS3 + ES6** frontend, **Node.js + Express** backend, and **MySQL** database (via XAMPP).

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, ES6 (Vanilla JS) |
| Backend | Node.js + Express.js |
| Database | MySQL (via XAMPP) |
| Auth | JWT (JSON Web Tokens) + bcryptjs |
| Charts | Chart.js 4.x |
| Security | Helmet, CORS, Rate Limiting |

---

## ⚡ Quick Setup (Step-by-Step)

### Step 1: Install XAMPP
1. Download and install XAMPP from https://www.apachefriends.org/
2. Start **MySQL** service in XAMPP Control Panel
3. Open phpMyAdmin at http://localhost/phpmyadmin

### Step 2: Create the Database
1. In phpMyAdmin, click **"New"** on the left panel
2. Name it `trackwise_db` → Click **Create**
3. Click the new database → click **"Import"** tab
4. Upload the `database.sql` file from this project → click **Go**

### Step 3: Install Node.js
1. Download Node.js (v18 or higher) from https://nodejs.org/
2. Verify installation: `node --version` and `npm --version`

### Step 4: Install Project Dependencies
Open terminal/command prompt inside the `trackwise` folder:
```bash
npm install
```

### Step 5: Configure Environment
```bash
# Copy the example env file
cp .env.example .env

# Open .env and set your database password if needed
# For default XAMPP, root password is usually empty
```

### Step 6: Run the Application
```bash
npm start
```

Open your browser → http://localhost:3000

---

## 🔐 Demo Accounts (Pre-seeded)

To use demo accounts, first add them to the database.  
Run this SQL in phpMyAdmin (after importing database.sql):

```sql
-- Add demo users (password for both: Demo@123)
INSERT INTO users (name, email, password_hash, avatar_color, monthly_budget, currency) VALUES
('Alice Johnson', 'alice@demo.com', '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#4f46e5', 50000, 'INR'),
('Bob Smith', 'bob@demo.com', '$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '#059669', 75000, 'INR');

-- Add default categories for Alice (user_id = 2)
CALL create_user_categories(2);

-- Add default categories for Bob (user_id = 3)  
CALL create_user_categories(3);
```

Or simply register new accounts via the UI — default categories are auto-created on registration.

---

## 📁 Project Structure

```
trackwise/
├── server.js              # Node.js/Express backend (all API routes)
├── package.json           # Dependencies
├── .env.example           # Environment config template
├── .env                   # Your local config (create from example)
├── database.sql           # MySQL schema + views
└── public/
    ├── login.html         # Login & Registration page
    └── dashboard.html     # Main analytics dashboard
```

---

## 🗄️ Database Schema

### Tables
| Table | Description |
|-------|-------------|
| `users` | Multi-user accounts with budget settings |
| `expenses` | All income & expense transactions |
| `categories` | User-specific spending categories |
| `sessions` | JWT session management |
| `budget_alerts` | Budget overrun notifications |

### Views
| View | Description |
|------|-------------|
| `monthly_summary` | Aggregated monthly income/expense per user |
| `category_spending` | Category-wise spending with budget comparison |

---

## 🔌 API Endpoints

### Authentication
```
POST /api/auth/register    → Create new account
POST /api/auth/login       → Sign in, get JWT token
GET  /api/auth/me          → Get current user info
```

### Transactions
```
GET    /api/expenses          → List with filters + pagination
POST   /api/expenses          → Add new transaction
PUT    /api/expenses/:id      → Update transaction
DELETE /api/expenses/:id      → Delete transaction
```

Query params for GET: `page`, `limit`, `type`, `category_id`, `start_date`, `end_date`, `payment_method`, `search`, `sort`, `order`

### Categories
```
GET    /api/categories        → List user's categories
POST   /api/categories        → Create category
PUT    /api/categories/:id    → Update category
DELETE /api/categories/:id    → Delete category
```

### Analytics
```
GET /api/analytics/dashboard  → Full dashboard data (params: year, month)
GET /api/analytics/yearly     → Annual breakdown (param: year)
```

### User
```
PUT /api/user/profile         → Update name, budget, currency
PUT /api/user/password        → Change password
```

---

## ✨ Features

### Security
- ✅ **JWT Authentication** — stateless token-based auth
- ✅ **Password Hashing** — bcryptjs with salt rounds 12
- ✅ **Rate Limiting** — 10 login attempts per 15 minutes
- ✅ **Helmet.js** — secure HTTP headers
- ✅ **User Isolation** — all queries scoped to user_id (SQL injection safe)
- ✅ **Input Validation** — server-side validation on all endpoints

### Data
- ✅ **Multi-User System** — complete data isolation per user
- ✅ **10 Default Categories** — auto-created on registration
- ✅ **Custom Categories** — with icons, colors, budget limits
- ✅ **Income + Expense** — track both with net balance
- ✅ **Payment Methods** — cash, card, UPI, net banking, other
- ✅ **Search + Filter** — by type, category, payment, date range, keyword
- ✅ **Pagination** — 15 transactions per page

### Analytics
- ✅ **Doughnut Chart** — category spending breakdown
- ✅ **Line Chart** — 6-month income vs expense trend
- ✅ **Bar Chart** — daily spending pattern
- ✅ **Payment Chart** — payment method distribution
- ✅ **Annual Report** — 12-month bar chart
- ✅ **Savings Rate** — monthly savings % line chart
- ✅ **Transaction Volume** — monthly count chart

---

## 🚀 Development Mode

```bash
npm install -g nodemon   # Install nodemon globally
npm run dev              # Auto-restart on file changes
```

---

## 🔧 Common Issues

**MySQL connection failed**
- Make sure XAMPP MySQL is running
- Check DB credentials in `.env`
- Ensure `trackwise_db` database exists

**"Cannot find module" error**
- Run `npm install` in the project directory

**Port 3000 already in use**
- Change PORT in `.env` to 3001 or any free port

**Login page redirect loop**
- Clear browser localStorage: DevTools → Application → Local Storage → Clear

---

## 🌐 Production Deployment

For production deployment:
1. Set `NODE_ENV=production` in `.env`
2. Set a strong `JWT_SECRET` (at least 32 random characters)
3. Set MySQL password in `.env`
4. Use a process manager like **PM2**: `npm install -g pm2 && pm2 start server.js`
5. Use **Nginx** as a reverse proxy

---

*Built with Node.js + Express + MySQL + Vanilla JS — No frontend framework required.*
