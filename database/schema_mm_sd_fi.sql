-- =====================================================================
-- Nexus ERP — Operational Schema: Integrasi SD + MM + FI (+ WM/EWM)
-- ---------------------------------------------------------------------
-- Fokus #1: "Skema database awal yang mengintegrasikan Modul SD
-- (Sales Order & Delivery) langsung dengan Modul MM (Inventory Stock)
-- dan Modul FI (General Ledger) saat terjadi Goods Issue."
--
-- Alur yang dimodelkan:
--   SD  sales_order -> sales_order_items
--      -> deliveries (+ delivery_items)
--      -> goods_issues (GI) — goods_issues.delivery_id UNIQUE = "ID GI terikat
--         dengan ID Delivery", dan goods_issues.journal_entry_id = "GI otomatis
--         memicu pembuatan ID Journal Entry di FI".
--   MM  goods_issue_items mengurasi inventory_stock (+catat stock_ledger).
--   FI   journal_entries(+lines): Debit COGS / Kredit Inventory saat GI.
--
-- #2 Dilayani service backend: goods_receipt menambah inventory_stock
--     (WM) dan posting jurnal Debit Inventory / Kredit GR-IR Clearing (FI).
-- #3  Dilayani services/mrp: analisa onhand + demand SD -> draft Purchase
--     Requisition (MM) jika stok kurang.
--
-- Jalankan SETELAH database/schema.sql (auth) diimport (MySQL 8+.Engine InnoDB.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `goods_receipt_items`;
DROP TABLE IF EXISTS `goods_receipts`;
DROP TABLE IF EXISTS `purchase_order_items`;
DROP TABLE IF EXISTS `purchase_orders`;
DROP TABLE IF EXISTS `purchase_requisition_items`;
DROP TABLE IF EXISTS `purchase_requisitions`;
DROP TABLE IF EXISTS `journal_entry_lines`;
DROP TABLE IF EXISTS `journal_entries`;
DROP TABLE IF EXISTS `goods_issue_items`;
DROP TABLE IF EXISTS `goods_issues`;
DROP TABLE IF EXISTS `delivery_items`;
DROP TABLE IF EXISTS `deliveries`;
DROP TABLE IF EXISTS `sales_order_items`;
DROP TABLE IF EXISTS `sales_orders`;
DROP TABLE IF EXISTS `stock_ledger`;
DROP TABLE IF EXISTS `inventory_stock`;
DROP TABLE IF EXISTS `materials`;
DROP TABLE IF EXISTS `storage_locations`;
DROP TABLE IF EXISTS `warehouses`;
DROP TABLE IF EXISTS `gl_accounts`;
DROP TABLE IF EXISTS `business_partners`;

-- =====================================================================
-- MASTER DATA
-- =====================================================================

CREATE TABLE `business_partners` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `partner_type` VARCHAR(20) NOT NULL COMMENT 'CUSTOMER/VENDOR',
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `credit_limit` DECIMAL(20,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bp_type_code` (`partner_type`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `warehouses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `company_code` VARCHAR(20) NOT NULL DEFAULT '1000',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_warehouse_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `storage_locations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `warehouse_id` INT UNSIGNED NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_storage_loc_wh_code` (`warehouse_id`, `code`),
  KEY `ix_storageloc_wh` (`warehouse_id`),
  CONSTRAINT `fk_storageloc_wh` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `materials` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `material_code` VARCHAR(40) NOT NULL,
  `name` VARCHAR(300) NOT NULL,
  `base_uom` VARCHAR(10) NOT NULL DEFAULT 'EA',
  `standard_price` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `safety_stock` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `valuation_class` VARCHAR(30) NOT NULL DEFAULT 'RAW',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_material_code` (`material_code`),
  KEY `ix_material_valuation` (`valuation_class`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- MM: INVENTORY (dikonsumsi SD, diisi GR, dibaca MRP/PP)
-- =====================================================================

CREATE TABLE `inventory_stock` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `material_id` INT UNSIGNED NOT NULL,
  `storage_location_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stock_mat_loc` (`material_id`, `storage_location_id`),
  KEY `ix_stock_loc` (`storage_location_id`),
  CONSTRAINT `fk_stock_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`),
  CONSTRAINT `fk_stock_storageloc` FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `stock_ledger` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `material_id` INT UNSIGNED NOT NULL,
  `storage_location_id` INT UNSIGNED NOT NULL,
  `movement_type` VARCHAR(20) NOT NULL COMMENT 'GR=Goods Receipt, GI=Goods Issue, ST=Stock Transfer, PI=Physical Inventory',
  `quantity_delta` DECIMAL(20,6) NOT NULL COMMENT 'positif = tambah, negatif = keluar',
  `reference_doc_type` VARCHAR(30) NOT NULL,
  `reference_doc_id` BIGINT UNSIGNED NOT NULL,
  `posted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_stockledger_material` (`material_id`),
  KEY `ix_stockledger_ref` (`reference_doc_type`, `reference_doc_id`),
  CONSTRAINT `fk_stockledger_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`),
  CONSTRAINT `fk_stockledger_loc` FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- FI: GENERAL LEDGER
-- =====================================================================

CREATE TABLE `gl_accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_number` VARCHAR(20) NOT NULL,
  `name` VARCHAR(300) NOT NULL,
  `account_type` VARCHAR(20) NOT NULL COMMENT 'ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE',
  `is_reconciliation` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gl_account_number` (`account_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `journal_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `je_number` VARCHAR(30) NOT NULL,
  `company_code` VARCHAR(20) NOT NULL DEFAULT '1000',
  `posting_date` DATE NOT NULL,
  `reference_doc_type` VARCHAR(30) NOT NULL COMMENT 'GOODS_RECEIPT/GOODS_ISSUE/INVOICE...',
  `reference_doc_id` BIGINT UNSIGNED NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED' COMMENT 'POSTED/REVERSED',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_je_number` (`je_number`),
  KEY `ix_je_reference` (`reference_doc_type`, `reference_doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `journal_entry_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `journal_entry_id` BIGINT UNSIGNED NOT NULL,
  `line_no` INT UNSIGNED NOT NULL,
  `posting_key` VARCHAR(10) NOT NULL COMMENT 'DEBIT/CREDIT',
  `gl_account_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(20,6) NOT NULL,
  `material_id` INT UNSIGNED DEFAULT NULL,
  `text` VARCHAR(300) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_jel_je` (`journal_entry_id`),
  KEY `ix_jel_account` (`gl_account_id`),
  CONSTRAINT `fk_jel_je` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`),
  CONSTRAINT `fk_jel_account` FOREIGN KEY (`gl_account_id`) REFERENCES `gl_accounts` (`id`),
  CONSTRAINT `fk_jel_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- SD: SALES ORDER -> DELIVERY -> GOODS ISSUE (terikat FI + MM)
-- =====================================================================

CREATE TABLE `sales_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `so_number` VARCHAR(30) NOT NULL,
  `customer_id` INT UNSIGNED NOT NULL,
  `order_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/IN_DELIVERY/COMPLETED/CANCELLED',
  `currency` VARCHAR(3) NOT NULL DEFAULT 'IDR',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_so_number` (`so_number`),
  KEY `ix_so_customer` (`customer_id`),
  CONSTRAINT `fk_so_customer` FOREIGN KEY (`customer_id`) REFERENCES `business_partners` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sales_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sales_order_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  `delivered_quantity` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `unit_price` DECIMAL(20,6) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/PARTIALLY_DELIVERED/DELIVERED/CANCELLED',
  PRIMARY KEY (`id`),
  KEY `ix_soitem_so` (`sales_order_id`),
  KEY `ix_soitem_material` (`material_id`),
  CONSTRAINT `fk_soitem_so` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`),
  CONSTRAINT `fk_soitem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `deliveries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_number` VARCHAR(30) NOT NULL,
  `sales_order_id` BIGINT UNSIGNED NOT NULL,
  `delivery_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/PICKED/PACKED/SHIPPED/GOODS_ISSUED',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_number` (`delivery_number`),
  KEY `ix_delivery_so` (`sales_order_id`),
  CONSTRAINT `fk_delivery_so` FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `delivery_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `delivery_id` BIGINT UNSIGNED NOT NULL,
  `sales_order_item_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_deliveryitem_delivery` (`delivery_id`),
  KEY `ix_deliveryitem_soitem` (`sales_order_item_id`),
  CONSTRAINT `fk_deliveryitem_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`),
  CONSTRAINT `fk_deliveryitem_soitem` FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items` (`id`),
  CONSTRAINT `fk_deliveryitem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_issues` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `gi_number` VARCHAR(30) NOT NULL,
  `delivery_id` BIGINT UNSIGNED NOT NULL,
  `posting_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  `journal_entry_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'auto-generated FI Journal Entry',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gi_number` (`gi_number`),
  UNIQUE KEY `uq_gi_delivery` (`delivery_id`),
  KEY `ix_gi_je` (`journal_entry_id`),
  CONSTRAINT `fk_gi_delivery` FOREIGN KEY (`delivery_id`) REFERENCES `deliveries` (`id`),
  CONSTRAINT `fk_gi_je` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_issue_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `goods_issue_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `storage_location_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  `unit_cost` DECIMAL(20,6) NOT NULL,
  `gl_inventory_account_id` INT UNSIGNED NOT NULL COMMENT 'Kredit: Inventory saat GI',
  PRIMARY KEY (`id`),
  KEY `ix_giitem_gi` (`goods_issue_id`),
  KEY `ix_giitem_material` (`material_id`),
  CONSTRAINT `fk_giitem_gi` FOREIGN KEY (`goods_issue_id`) REFERENCES `goods_issues` (`id`),
  CONSTRAINT `fk_giitem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`),
  CONSTRAINT `fk_giitem_loc` FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_giitem_gl_account` FOREIGN KEY (`gl_inventory_account_id`) REFERENCES `gl_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- MM: PURCHASE REQUISITION (output MRP) -> PURCHASE ORDER -> GOODS RECEIPT
-- =====================================================================

CREATE TABLE `purchase_requisitions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pr_number` VARCHAR(30) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT/RELEASED/ORDERED/CANCELLED',
  `required_date` DATE NOT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'MANUAL' COMMENT 'MANUAL/MRP',
  `created_by` INT UNSIGNED DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pr_number` (`pr_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `purchase_requisition_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_requisition_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  `required_date` DATE NOT NULL,
  `suggestion_source` VARCHAR(20) NOT NULL DEFAULT 'MRP',
  PRIMARY KEY (`id`),
  KEY `ix_pritem_pr` (`purchase_requisition_id`),
  KEY `ix_pritem_material` (`material_id`),
  CONSTRAINT `fk_pritem_pr` FOREIGN KEY (`purchase_requisition_id`) REFERENCES `purchase_requisitions` (`id`),
  CONSTRAINT `fk_pritem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `purchase_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `po_number` VARCHAR(30) NOT NULL,
  `vendor_id` INT UNSIGNED NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN/RECEIVED/CLOSED/CANCELLED',
  `order_date` DATE NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_po_number` (`po_number`),
  KEY `ix_po_vendor` (`vendor_id`),
  CONSTRAINT `fk_po_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `business_partners` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_order_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  `received_quantity` DECIMAL(20,6) NOT NULL DEFAULT 0,
  `unit_price` DECIMAL(20,6) NOT NULL,
  `gl_inventory_account_id` INT UNSIGNED NOT NULL,
  `gl_gr_ir_clearing_account_id` INT UNSIGNED NOT NULL COMMENT 'Kredit saat GR',
  PRIMARY KEY (`id`),
  KEY `ix_poitem_po` (`purchase_order_id`),
  KEY `ix_poitem_material` (`material_id`),
  CONSTRAINT `fk_poitem_po` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_poitem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`),
  CONSTRAINT `fk_poitem_gl_inv` FOREIGN KEY (`gl_inventory_account_id`) REFERENCES `gl_accounts` (`id`),
  CONSTRAINT `fk_poitem_gl_grir` FOREIGN KEY (`gl_gr_ir_clearing_account_id`) REFERENCES `gl_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_receipts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `gr_number` VARCHAR(30) NOT NULL,
  `purchase_order_id` BIGINT UNSIGNED DEFAULT NULL,
  `vendor_id` INT UNSIGNED DEFAULT NULL,
  `posting_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  `journal_entry_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'auto-generated FI Journal Entry',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gr_number` (`gr_number`),
  KEY `ix_gr_po` (`purchase_order_id`),
  KEY `ix_gr_je` (`journal_entry_id`),
  CONSTRAINT `fk_gr_po` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_gr_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `business_partners` (`id`),
  CONSTRAINT `fk_gr_je` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `goods_receipt_id` BIGINT UNSIGNED NOT NULL,
  `material_id` INT UNSIGNED NOT NULL,
  `storage_location_id` INT UNSIGNED NOT NULL,
  `quantity` DECIMAL(20,6) NOT NULL,
  `unit_price` DECIMAL(20,6) NOT NULL,
  `gl_inventory_account_id` INT UNSIGNED NOT NULL COMMENT 'Debit: Inventory',
  `gl_gr_ir_clearing_account_id` INT UNSIGNED NOT NULL COMMENT 'Kredit: GR/IR Clearing',
  PRIMARY KEY (`id`),
  KEY `ix_gritem_gr` (`goods_receipt_id`),
  KEY `ix_gritem_material` (`material_id`),
  CONSTRAINT `fk_gritem_gr` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts` (`id`),
  CONSTRAINT `fk_gritem_material` FOREIGN KEY (`material_id`) REFERENCES `materials` (`id`),
  CONSTRAINT `fk_gritem_loc` FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations` (`id`),
  CONSTRAINT `fk_gritem_gl_inv` FOREIGN KEY (`gl_inventory_account_id`) REFERENCES `gl_accounts` (`id`),
  CONSTRAINT `fk_gritem_gl_grir` FOREIGN KEY (`gl_gr_ir_clearing_account_id`) REFERENCES `gl_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- SEED MASTER MINIMAL (contoh akun FI + gudang + material + partner)
-- =====================================================================

INSERT INTO `business_partners` (`id`, `partner_type`, `code`, `name`) VALUES
  (1, 'CUSTOMER', 'CUST-001', 'PT Pelanggan Utama'),
  (2, 'VENDOR',   'VEND-001', 'PT Supplier Andal');

INSERT INTO `warehouses` (`id`, `code`, `name`) VALUES
  (1, 'WH-01', 'Gudang Pusat');

INSERT INTO `storage_locations` (`id`, `warehouse_id`, `code`, `name`) VALUES
  (1, 1, 'FG', 'Finished Goods'),
  (2, 1, 'RM', 'Raw Material');

INSERT INTO `materials` (`id`, `material_code`, `name`, `standard_price`, `safety_stock`, `valuation_class`) VALUES
  (1, 'MAT-1000', 'Produk Jadi A', 100000.000000, 50, 'FG'),
  (2, 'MAT-2000', 'Bahan Baku B', 25000.000000, 200, 'RAW');

INSERT INTO `gl_accounts` (`id`, `account_number`, `name`, `account_type`, `is_reconciliation`) VALUES
  (1, '100000', 'Inventory - Finished Goods', 'ASSET', 0),
  (2, '100100', 'Inventory - Raw Material', 'ASSET', 0),
  (3, '211000', 'GR/IR Clearing', 'LIABILITY', 0);

INSERT INTO `inventory_stock` (`material_id`, `storage_location_id`, `quantity`) VALUES
  (1, 1, 500),
  (2, 2, 1000);

SET FOREIGN_KEY_CHECKS = 1;