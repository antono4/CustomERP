-- =====================================================================
-- Nexus ERP — MySQL Schema (User Level / Role-Based Access + Modules)
-- AdminLTE 4 + Node.js/Express + MySQL
-- =====================================================================
-- User level hierarchy:
--   1 superadmin  — full access + manage users/roles
--   2 admin       — all modules, no user management of superadmin
--   3 manager      — operational modules (no FI/CO closing, no user mgmt)
--   4 user         — view/entry restricted by module_access
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `login_logs`;
DROP TABLE IF EXISTS `module_access`;
DROP TABLE IF EXISTS `roles`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `modules`;

CREATE TABLE `roles` (
  `id` TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `level` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1=user 2=manager 3=admin 4=superadmin',
  `description` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) DEFAULT NULL,
  `role_id` TINYINT UNSIGNED NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `ix_users_role` (`role_id`),
  CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `modules` (
  `id` SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module_code` VARCHAR(20) NOT NULL,
  `module_name` VARCHAR(150) NOT NULL,
  `icon` VARCHAR(50) NOT NULL DEFAULT 'fa-cube',
  `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_modules_code` (`module_code`),
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `module_access` (
  `role_id` TINYINT UNSIGNED NOT NULL,
  `module_id` SMALLINT UNSIGNED NOT NULL,
  `can_view` TINYINT(1) NOT NULL DEFAULT 1,
  `can_create` TINYINT(1) NOT NULL DEFAULT 1,
  `can_edit` TINYINT(1) NOT NULL DEFAULT 1,
  `can_delete` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`role_id`, `module_id`),
  KEY `ix_module_access_module` (`module_id`),
  CONSTRAINT `fk_module_access_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_module_access_module` FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `login_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED DEFAULT NULL,
  `username` VARCHAR(50) NOT NULL,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(255) DEFAULT NULL,
  `success` TINYINT(1) NOT NULL DEFAULT 0,
  `login_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_login_logs_user` (`user_id`),
  CONSTRAINT `fk_login_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- Seed Data
-- =====================================================================

INSERT INTO `roles` (`id`, `code`, `name`, `level`, `description`) VALUES
  (1, 'user',      'User',            1, 'Operational entry — module access dikontrol per modul'),
  (2, 'manager',   'Manager',         2, 'Akses penuh modul operasional'),
  (3, 'admin',     'Admin',           3, 'Akses seluruh modul + kelola user (non-superadmin)'),
  (4, 'superadmin', 'Super Admin',     4, 'Akses penuh sistem + kelola role/user');

-- Password default: password123 (bcrypt hash), ganti segera setelah login pertama.

Nah, saya akan seeding users dengan bcrypt hash yang sudah digenerate oleh Node (dijalankan terpisah di setup.js).
INSERT INTO `modules` (`id`, `module_code`, `module_name`, `icon`, `sort_order`) VALUES
  (1,  'fi-co',    'Finance & Controlling (FI/CO)',      'fa-scale-balanced',       1),
  (2,  'sd',       'Sales & Distribution (SD)',          'fa-cart-shopping',         2),
  (3,  'mm',      'Material Management (MM)',            'fa-boxes-stacked',         3),
  (4,  'pp',      'Production Planning (PP)',           'fa-industry',              4),
  (5,  'wm',      'Warehouse Management (WM/EWM)',      'fa-warehouse',            5),
  (6,  'hcm',     'Human Capital (HCM/HR)',            'fa-users',                  6),
  (7,  'scm',     'Supply Chain Mgmt (SCM/APO)',      'fa-truck-fast',            7),
  (8,  'ps',      'Project System (PS)',                  'fa-diagram-project',       8),
  (9,  'crm',     'Customer Relationship (CRM)',         'fa-handshake',             9),
  (10, 'pm',      'Plant Maintenance (PM)',             'fa-screwdriver-wrench',    10);

-- Akses default per role (semua modul; superadmin/admin full,
-- manager tanpa user-mgmt; user hanya view+create untuk modul operasional tertentu.

INSERT INTO `module_access` (`role_id`, `module_id`, `can_view`, `can_create`, `can_edit`, `can_delete`) VALUES
  (1,  1,  1,  0,  0),
  (1,  2,  1,  1,  0,  0),
  (1,  3,  1,  1,  0,  0),
  (1,  4,  1,  1,  0,  0),
  (2,  1,  1,  1,  1,  0),
  (2,  2,  1,  1,  1,  0),
  (2,  3,  1,  1,  1,  0),
  (2,  4,  1,  1,  1,  0),
  (3,  1,  1,  1,  1,  1),
  (4,  1,  1,  1,  1,  1);

-- Semua akses untuk admin dan superadmin: full untuk seluruh modul (2-10).
INSERT INTO `module_access` (`role_id`, `module_id`, `can_view`, `can_create`, `can_edit`, `can_delete`)
SELECT r.`id`, m.`id`, 1, 1, 1, 1 FROM `roles` r CROSS JOIN `modules` m
WHERE r.`id` IN (3, 4) AND m.`id` NOT IN (1);

SET FOREIGN_KEY_CHECKS = 1;
