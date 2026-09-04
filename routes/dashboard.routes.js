import { Router } from 'express';
import { query, queryOne } from '../config/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

/** GET / — dashboard utama (hanya user login\) */
router.get('/', requireAuth, async (req, res) => {
  const modules = await fetchModules(req.session.user.roleId);
  res.send(renderShell(req.session.user, modules));
});

/** GET /modules/:code — halaman placeholder per modul (gated by module_access\) */
router.get('/modules/:code', requireAuth, async (req, res) => {
  const { code } = req.params;
  const modules = await fetchModules(req.session.user.roleId);
  const mod = modules.find((m) => m.module_code === code);
  if (!mod || !mod.can_view) {
    return res.status(403).send(forbiddenPage());
  }
  res.send(renderModulePage(req.session.user, mod, modules));
});

/** GET /admin/users — manajemen user (admin+\) */
router.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await query(
    `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at,
            r.name AS role_name, r.level AS role_level
       FROM users u JOIN roles r ON r.id = u.role_id
      ORDER BY u.created_at DESC`,
  );
  const roles = await query(`SELECT id, code, name, level FROM roles ORDER BY level DESC`);
  res.send(renderUserAdmin(req.session.user, users, roles));
});

export default router;

/* ===================== HTML RENDER HELPERS ===================== */

async function fetchModules(roleId) {
  return query(
    `SELECT m.id, m.module_code, m.module_name, m.icon, m.sort_order,
            COALESCE(a.can_view, 0) AS can_view
       FROM modules m
       LEFT JOIN module_access a ON a.module_id = m.id AND a.role_id = ?
      ORDER BY m.sort_order`,
    [roleId],
  );
}

function moduleIcon(m) {
  return m.icon || 'fa-cube';
}

function navTree(user, modules) {
  const isAdmin = user.roleLevel >= 3;
  return `
  <li class="nav-item">
    <a href="/" class="nav-link ${''}">
      <i class="nav-icon fas fa-gauge-high"></i>
      <p>Dashboard</p>
    </a>
  </li>
  <li class="nav-header">MODUL ERP</li>
  ${modules.filter((m) => m.can_view).map((m) => `
    <li class="nav-item">
      <a href="/modules/${m.module_code}" class="nav-link">
        <i class="nav-icon fas ${moduleIcon(m)}"></i>
        <p>${m.module_name}</p>
      </a>
    </li>
  `).join('')}
  ${isAdmin ? `
  <li class="nav-header">ADMINISTRASI</li>
  <li class="nav-item">
    <a href="/admin/users" class="nav-link">
      <i class="nav-icon fas fa-user-shield"></i>
      <p>Manajemen User & Level</p>
    </a>
  </li>
  <li class="nav-item">
    <a href="/admin/modules" class="nav-link">
      <i class="nav-icon fas fa-puzzle-piece"></i>
      <p>Hak Akses Modul</p>
    </a>
  </li>` : ''}
  <li class="nav-header">SESI</li>
  <li class="nav-item">
    <form method="POST" action="/logout" id="logoutForm">
      <button type="submit" class="nav-link" style="background:none;border:0;width:100%;text-align:left;cursor:pointer">
        <i class="nav-icon fas fa-arrow-right-from-bracket"></i>
        <p>Keluar</p>
      </button>
    </form>
  </li>`;
}

function renderShell(user, modules) {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard — Nexus ERP</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/overlayscrollbars@2.4.6/styles/overlayscrollbars.min.css">
  <style>
    .user-card { display:flex; align-items:center; gap:.75rem; }
    .user-card img { width:2.4rem; height:2.4rem; border-radius:50%; }
    .brand-link { text-decoration:none; }
    .content-wrapper { background:#f4f6f9; }
    .small-box { border-radius:.8rem; overflow:hidden; }
  </style>
</head>
<body class="layout-fixed sidebar-expand-lg bg-body-tertiary">
  <div class="app-wrapper">
    <!-- ====== Sidebar ====== -->
    <aside class="app-sidebar bg-dark" data-bs-theme="dark">
      <a href="/" class="brand-link">
        <img src="https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/img/AdminLTELogo.png" alt="Nexus ERP" class="brand-image opacity-75 shadow">
        <span class="brand-text fw-light">Nexus <b>ERP</b></span>
      </a>
      <div class="sidebar-wrapper">
        <nav class="mt-2">
          <ul class="nav sidebar-menu flex-column" data-lte-toggle="treeview" role="menu" data-accordion="false">
            ${navTree(user, modules)}
          </ul>
        </nav>
      </div>
    </aside>

    <!-- ====== Header ====== -->
    <header class="app-header navbar navbar-expand bg-body">
      <ul class="navbar-nav">
        <li class="nav-item">
          <a class="nav-link" data-lte-toggle="sidebar" href="#" role="button"><i class="fas fa-bars"></i></a>
        </li>
        <li class="nav-item d-none d-md-block">
          <a href="/" class="nav-link">Dashboard</a>
        </li>
      </ul>
      <ul class="navbar-nav ms-auto">
        <li class="nav-item">
          <div class="user-card py-1 px-2">
            <img src="https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/img/user2-160x160.jpg" alt="User">
            <div>
              <div style="font-weight:600;font-size:.9rem">${user.fullName}</div>
              <span class="badge text-bg-${roleBadge(user)}">${user.roleName}</span>
            </div>
          </div>
        </li>
      </ul>
    </header>

    <!-- ====== Content ====== -->
    <main class="app-main">
      <div class="app-content-header">
        <div class="container-fluid">
          <div class="row">
            <div class="col-sm-6"><h3 class="mb-0">Dashboard</h3></div>
            <div class="col-sm-6">
              <ol class="breadcrumb float-sm-end">
                <li class="breadcrumb-item"><a href="/">Home</a></li>
                <li class="breadcrumb-item active">Dashboard</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      <div class="app-content">
        <div class="container-fluid">
          <!-- Stat cards -->
          <div class="row">
            <div class="col-lg-3 col-6">
              <div class="small-box text-bg-primary">
                <div class="inner"><h3>${modules.length}</h3><p>Modul Aktif</p></div>
                <div class="icon"><i class="fas fa-cubes"></i></div>
                <a href="#" class="small-box-footer">Lebih lanjut <i class="fas fa-arrow-circle-right"></i></a>
              </div>
            </div>
            <div class="col-lg-3 col-6">
              <div class="small-box text-bg-success">
                <div class="inner"><h3>10</h3><p>Modul ERP Inti</p></div>
                <div class="icon"><i class="fas fa-layer-group"></i></div>
                <a href="#" class="small-box-footer">Blueprint SAP <i class="fas fa-arrow-circle-right"></i></a>
              </div>
            </div>
            <div class="col-lg-3 col-6">
              <div class="small-box text-bg-warning">
                <div class="inner"><h3>${user.roleLevel}</h3><p>Level Akses</p></div>
                <div class="icon"><i class="fas fa-user-shield"></i></div>
                <a href="#" class="small-box-footer">${user.roleName} <i class="fas fa-arrow-circle-right"></i></a>
              </div>
            </div>
            <div class="col-lg-3 col-6">
              <div class="small-box text-bg-danger">
                <div class="inner"><h3>${new Date().getFullYear()}</h3><p>Tahun Buku</p></div>
                <div class="icon"><i class="fas fa-calendar-days"></i></div>
                <a href="#" class="small-box-footer">Periode saat ini <i class="fas fa-arrow-circle-right"></i></a>
              </div>
            </div>
          </div>

          <!-- Module grid -->
          <div class="card mt-3">
            <div class="card-header"><h3 class="card-title">Modul yang dapat diakses</h3></div>
            <div class="card-body">
              <div class="row">
                ${modules.filter((m) => m.can_view).map((m) => `
                  <div class="col-md-6 col-lg-3 mb-3">
                    <a href="/modules/${m.module_code}" class="text-decoration-none text-dark">
                      <div class="card h-100 shadow-sm border-0 module-card">
                        <div class="card-body text-center p-4">
                          <i class="fas ${moduleIcon(m)} fa-2x text-primary mb-2"></i>
                          <h6 class="card-title fw-bold">${m.module_name}</h6>
                          <p class="text-secondary small mb-0">${m.sort_order}. ${m.can_view ? 'Aktif' : 'Terkunci'}</p>
                        </div>
                      </div>
                    </a>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
    <footer class="app-footer">
      <div class="float-end d-none d-sm-inline">AdminLTE 4</div>
      <strong>Nexus ERP &copy; 2024-2026.</strong> Hak cipta dilindungi.
    </footer>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/overlayscrollbars@2.4.6/browser/overlayscrollbars.browser.umd.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/js/adminlte.min.js"></script>
</body>
</html>`;
}

function renderModulePage(user, mod, modules) {
  return renderShell(user, modules).replace(
    /<h3 class="mb-0">Dashboard<\/h3>/,
    `<h3 class="mb-0">${mod.module_name}</h3>`,
  ).replace(
    /<!-- Module grid -->.*?<!-- \/Module grid -->/s,
    `<div class="card mt-3">
        <div class="card-header"><h3 class="card-title">${mod.module_name}</h3></div>
        <div class="card-body">
          <div class="callout callout-info">
            <h5><i class="fas ${moduleIcon(mod)}"></i> Modul ${mod.module_name}</h5>
            <p>Halaman ini adalah kerangka modul. Alur transaksi, form entry, dan laporan
            akan dikembangkan per modul sesuai blueprint SAP (${mod.module_code}).</p>
          </div>
          <div class="alert alert-warning">
            <i class="fas fa-info-circle"></i> Anda login sebagai <b>${user.roleName}</b> dengan level <b>${user.roleLevel}</b>.
            Hak akses modul ini: View ${mod.can_view ? '✓' : '✗'}.
          </div>
        </div>
      </div>`,
  );
}

function renderUserAdmin(user, users, roles) {
  const page = renderShell(user, []);
  return page.replace(
    /<h3 class="mb-0">Dashboard<\/h3>/,
    `<h3 class="mb-0">Manajemen User & Level</h3>`,
  ).replace(
    /<!-- Module grid -->.*?<!-- \/Module grid -->/s,
    `
    <div class="row">
      <div class="col-12">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Daftar User</h3>
            <div class="card-tools">
              <button class="btn btn-primary btn-sm" data-bs-toggle="modal" data-bs-target="#userModal"><i class="fas fa-plus"></i> Tambah User</button>
            </div>
          </div>
          <div class="card-body table-responsive p-0">
            <table class="table table-hover table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>ID</th><th>Username</th><th>Nama Lengkap</th><th>Email</th><th>Role / Level</th><th>Status</th><th>Login Terakhir</th><th style="width:120px">Aksi</th>
                </tr>
              </thead>
              <tbody>
                ${users.map((u) => `
                  <tr>
                    <td>#${u.id}</td>
                    <td><b>${u.username}</b></td>
                    <td>${u.full_name}</td>
                    <td>${u.email ?? '-'}</td>
                    <td><span class="badge text-bg-${roleBadge(u)}">${u.role_name} (Lv.${u.role_level})</span></td>
                    <td>${u.is_active ? '<span class="badge text-bg-success">Aktif</span>' : '<span class="badge text-bg-secondary">Nonaktif</span>'}</td>
                    <td>${u.last_login_at ? new Date(u.last_login_at).toLocaleString('id-ID') : '-'}</td>
                    <td>
                      <button class="btn btn-sm btn-outline-primary" title="Edit"><i class="fas fa-edit"></i></button>
                      <button class="btn btn-sm btn-outline-danger" title="Nonaktifkan"><i class="fas fa-ban"></i></button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div class="row">
      <div class="col-md-4">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Role & Level</h3></div>
          <div class="card-body p-0">
            <table class="table table-sm mb-0">
              <thead><tr><th>Level</th><th>Role</th><th>Deskripsi</th></tr></thead>
              <tbody>
                ${roles.map((r) => `<tr><td><span class="badge text-bg-${roleBadge(r)}">${r.level}</span></td><td><b>${r.name}</b></td><td class="small text-secondary">Level ${r.level}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    `,
  );
}

function forbiddenPage() {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Akses Ditolak</title></head>
  <body style="font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f6f9">
  <div style="text-align:center;padding:2rem;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.1);max-width:420px">
    <h1 style="color:#dc3545">403 — Akses Ditolak</h1>
    <p>Anda tidak memiliki hak akses untuk modul ini.</p>
    <a href="/" style="display:inline-block;margin-top:1rem;padding:.6rem 1.4rem;background:#0d6efd;color:#fff;border-radius:6px;text-decoration:none">Kembali ke Dashboard</a>
  </div></body></html>`;
}

function roleBadge(u) {
  const lvl = Number(u.role_level ?? u.level ?? 0);
  if (lvl >= 4) return 'dark';
  if (lvl === 3) return 'danger';
  if (lvl === 2) return 'warning';
  return 'info';
}