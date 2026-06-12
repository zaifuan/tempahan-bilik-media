// ============================================================
// server.js — Express main entry point
// SISTEM TEMPAHAN BILIK MEDIA
// ============================================================

require('dotenv').config();

// Set timezone (penting untuk Date operations)
process.env.TZ = process.env.TZ || 'Asia/Kuala_Lumpur';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { pool } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ── Trust proxy (di belakang Nginx) ──────────────────────────
app.set('trust proxy', 1);

// ── Security & utility middleware ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // izinkan inline script/styles untuk index.html
}));
app.use(compression());
app.use(cors({
  origin: process.env.PUBLIC_URL ? [process.env.PUBLIC_URL, /localhost/] : true,
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Rate limiting (untuk mutating endpoints) ─────────────────
const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minit
  max: 30,                    // 30 request/minit
  message: { ok: false, error: 'Terlalu banyak permintaan. Cuba lagi sebentar.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Terlalu banyak cubaan login. Cuba lagi 15 minit.' }
});

// ── Health check ─────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, status: 'healthy', time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, status: 'unhealthy', error: e.message });
  }
});

// ── Apply rate limiting ──────────────────────────────────────
app.use('/api/admin/login', loginLimiter);
app.use('/api/tempahan/', writeLimiter);

// ── API routes ───────────────────────────────────────────────
app.use('/api', publicRoutes);
app.use('/api/admin', adminRoutes);

// ── Static frontend ──────────────────────────────────────────
const publicPath = path.join(__dirname, '../../frontend/public');
app.use(express.static(publicPath, {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, file) => {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// SPA fallback (admin)
app.get('/admin', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(publicPath, 'admin.html')));

// Default route → index.html
app.get('/', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Endpoint tidak dijumpai.' });
  }
  res.status(404).sendFile(path.join(publicPath, 'index.html'));
});

// ── Error handler ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ ok: false, error: err.message || 'Ralat pelayan.' });
});

// ── Start ────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  SISTEM TEMPAHAN BILIK MEDIA                                  ║
║  SABK Maahad Al Khair Lil Banat                               ║
╠══════════════════════════════════════════════════════════════╣
║  Server     : http://localhost:${PORT}                          
║  Environment: ${process.env.NODE_ENV || 'development'}                                
║  Timezone   : ${process.env.TZ}                            
║  DB         : ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}
╚══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing server...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});

module.exports = app;
