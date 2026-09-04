/**
 * Role-based access control helpers.
 * User levels: 1=user, 2=manager, 3=admin, 4=superadmin.
 */

/** Minimum level yang dibutuhkan untuk akses route tertentu */
export const requireLevel = (minimumLevel) => (req, res, next) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role_level < minimumLevel) {
    if (req.accepts('html')) {
      return res.status(403).send(
        `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Akses Ditolak</title></head>`
        `<body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f8f9fa">`
        `<div style="text-align:center;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.1)">`
        `<h1 style="color:#dc3545">403 — Akses Ditolak</h1>`
        `<p>Level akses anda (${req.session.user.role_name}) tidak cukup untuk halaman ini.</p>`
        `<a href="/" style="display:inline-block;margin-top:1rem;padding:.6rem 1.4rem;background:#0d6efd;color:#fff;border-radius:6px;text-decoration:none">Kembali ke Dashboard</a></div></body></html>`);
    }
    return res.status(403).json({ error: 'Forbidden: insufficient role level' });
  }
  next();
};

/** Pastikan user sudah login */
export const requireAuth = (req, res, next) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  next();
};

/** Pastikan hanya admin/superadmin (level >= 3) */
export const requireAdmin = requireLevel(3);

/** Middleware: muat akses modul dari DB ke session (dipanggil setelah login\) */
export async function loadModuleAccess(userId, roleId) {
  const { query } = await import('../config/db.js');
  const rows = await query(
    `SELECT m.module_code, a.can_view, a.can_create, a.can_edit, a.can_delete
       FROM module_access a
       JOIN modules m ON m.id = a.module_id
      WHERE a.role_id = ?`,
    [roleId],
  );
  const accessMap = {};
  for (const r of rows) {
    accessMap[r.module_code] = {
      view: Boolean(r.can_view),
      create: Boolean(r.can_create),
      edit: Boolean(r.can_edit),
      delete: Boolean(r.can_delete),
    };
  }
  return accessMap;
}

/** Middleware: cek izin per modul + aksi */
export const requireModule = (moduleCode, action = 'view') => (req, res, next) => {
  const access = req.session?.moduleAccess?.[moduleCode];
  if (!access || !access[action]) {
    return res.status(403).json({ error: 'Forbidden: module access denied', module: moduleCode, action });
  }
  next();
};