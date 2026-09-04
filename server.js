import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import sessionConfig from './config/session.js';
import authRoutes from './routes/auth.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import mmApiRoutes from './routes/api/mm.routes.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.disable('x-powered-by');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessionConfig));

// Static assets (login page, module pages, dll\)
app.use(express.static('public'));

// Routes
app.use(authRoutes);                     // /login, /logout, /api/auth/me
app.use(dashboardRoutes);                 // /, /modules/:code, /admin/users
app.use('/api/mm', mmApiRoutes);          // Goods Receipt MM -> WM + FI

// 404 + error handler
app.use((req, res) => {
  res.status(404).send('<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>404</title></head><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h1 style="color:#dc3545">404</h1><p>Halaman tidak ditemukan.</p><a href="/" style="color:#0d6efd">Kembali ke Dashboard</a></div></body></html>');
});

app.use((err, req, res, next) => {
  console.error('[server] error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[nexus-erp] AdminLTE 4 ERP running on http://localhost:${PORT}`);
});