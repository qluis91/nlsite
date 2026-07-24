-- ============================================
-- ESQUEMA SQL — PLANTILLA WEB MODULAR
-- Importar en phpMyAdmin (XAMPP)
-- ============================================

CREATE DATABASE IF NOT EXISTS nlsite_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nlsite_db;

-- ── Tabla de Usuarios ──
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  last_name VARCHAR(100) NULL,
  phone VARCHAR(30) NULL,
  avatar_path VARCHAR(500) NULL,
  password_changed_at DATETIME NULL,
  role_id INT DEFAULT 2,             -- 1 = admin, 2 = user
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Direcciones guardadas de clientes ──
CREATE TABLE IF NOT EXISTS user_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(60) NOT NULL,
  province VARCHAR(60) NOT NULL,
  canton VARCHAR(80) NOT NULL,
  district VARCHAR(80) NOT NULL,
  address_line VARCHAR(300) NOT NULL,
  address_reference VARCHAR(200) NULL,
  contact_phone VARCHAR(15) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_addresses_user (user_id),
  INDEX idx_user_addresses_user_default (user_id, is_default),
  CONSTRAINT fk_user_addresses_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Registros pendientes de verificación ──
CREATE TABLE IF NOT EXISTS pending_registrations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pending_reg_email (email),
  UNIQUE KEY uq_pending_reg_token (token_hash),
  INDEX idx_pending_reg_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tokens de recuperación de contraseña ──
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pw_reset_token (token_hash),
  INDEX idx_pw_reset_user (user_id),
  INDEX idx_pw_reset_expires (expires_at),
  CONSTRAINT fk_pw_reset_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Sesiones (express-mysql-session) ──
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Configuración del Sitio ──
CREATE TABLE IF NOT EXISTS site_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Categorías ──
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  hero_title VARCHAR(160) NULL,
  hero_description VARCHAR(500) NULL,
  hero_image VARCHAR(500) NULL,
  hero_alt VARCHAR(200) NULL,
  hero_position VARCHAR(20) NULL DEFAULT 'center',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Productos ──
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  regular_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  promotional_price DECIMAL(10,2) NULL,
  web_price DECIMAL(10,2) NULL,
  weight INT NULL COMMENT 'grams',
  stock_quantity INT NOT NULL DEFAULT 0,
  description TEXT NULL,
  tags JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_slug (slug),
  INDEX idx_products_active (is_active),
  INDEX idx_products_published (is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Relaciones Producto-Categoría ──
CREATE TABLE IF NOT EXISTS product_categories (
  product_id INT NOT NULL,
  category_id INT NOT NULL,
  PRIMARY KEY (product_id, category_id),
  CONSTRAINT fk_pc_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Imágenes de Producto ──
CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(50) NOT NULL DEFAULT 'image/webp',
  width INT NULL,
  height INT NULL,
  size_bytes INT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_pi_product_position (product_id, position),
  INDEX idx_pi_product_primary (product_id, is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Categorías de Galería ──
CREATE TABLE IF NOT EXISTS gallery_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  description VARCHAR(1000) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gallery_categories_slug (slug),
  KEY idx_gallery_categories_active_order (is_active, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Elementos de Galería ──
CREATE TABLE IF NOT EXISTS gallery_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NULL,
  title VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  description TEXT NULL,
  media_type VARCHAR(10) NOT NULL,
  media_path VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500) NOT NULL,
  poster_path VARCHAR(500) NULL,
  alt_text VARCHAR(300) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gallery_items_slug (slug),
  KEY idx_gallery_items_category (category_id),
  KEY idx_gallery_items_type (media_type),
  KEY idx_gallery_items_published_order (is_published, is_featured, sort_order, published_at, id),
  KEY idx_gallery_items_featured (is_featured),
  CONSTRAINT fk_gallery_items_category
    FOREIGN KEY (category_id) REFERENCES gallery_categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Órdenes ──
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_reference VARCHAR(24) NOT NULL COMMENT 'Public order number (NL-XXXXXX)',
  user_id INT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(180) NOT NULL,
  customer_phone VARCHAR(30) NOT NULL,
  delivery_method VARCHAR(30) NOT NULL COMMENT 'local_pickup | uber_flash | private_courier | correos_cr',
  shipping_status VARCHAR(20) NOT NULL DEFAULT 'pending_quote' COMMENT 'not_required | pending_quote | quoted',
  shipping_amount DECIMAL(10,2) NULL DEFAULT NULL,
  carrier VARCHAR(40) NULL COMMENT 'Shipping carrier name',
  tracking_number VARCHAR(120) NULL COMMENT 'Carrier tracking number',
  tracking_url VARCHAR(500) NULL COMMENT 'Safe tracking URL',
  payment_method VARCHAR(20) NOT NULL COMMENT 'sinpe | bank_transfer',
  payment_status VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT 'pending | paid',
  order_status VARCHAR(40) NOT NULL DEFAULT 'pending_shipping_quote',
  province VARCHAR(60) NULL,
  canton VARCHAR(80) NULL,
  district VARCHAR(80) NULL,
  address_line VARCHAR(300) NULL,
  address_reference VARCHAR(200) NULL,
  product_subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  final_total DECIMAL(10,2) NULL DEFAULT NULL,
  idempotency_key VARCHAR(64) NOT NULL COMMENT 'SHA-256 hash for idempotency',
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_reference (order_reference),
  UNIQUE KEY uq_orders_idempotency (idempotency_key),
  INDEX idx_orders_user (user_id),
  INDEX idx_orders_status (payment_status, shipping_status),
  INDEX idx_orders_order_status_created (order_status, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial inmutable de eventos de pedido
CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  actor_user_id INT NULL,
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  metadata_json LONGTEXT NULL,
  note VARCHAR(500) NULL,
  migration_key VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_events_migration (order_id, migration_key),
  INDEX idx_order_events_order_created (order_id, created_at),
  INDEX idx_order_events_actor (actor_user_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Ítems de Orden ──
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  product_name VARCHAR(160) NOT NULL,
  product_slug VARCHAR(180) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  primary_image VARCHAR(300) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_product (product_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Comprobantes de Pago ──
CREATE TABLE IF NOT EXISTS payment_proofs (
  id BIGINT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  submitted_by_user_id INT DEFAULT NULL,
  submission_source VARCHAR(20) NOT NULL COMMENT 'account | guest | recent',
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
    COMMENT 'pending_review | approved | rejected',
  original_filename VARCHAR(255) DEFAULT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes INT NOT NULL,
  image_width INT DEFAULT NULL,
  image_height INT DEFAULT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  reviewed_by_user_id INT DEFAULT NULL,
  rejection_reason VARCHAR(500) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_proofs_order_created (order_id, created_at),
  KEY idx_payment_proofs_status (status),
  KEY idx_payment_proofs_submitter (submitted_by_user_id),
  KEY idx_payment_proofs_reviewer (reviewed_by_user_id),
  CONSTRAINT fk_payment_proofs_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_proofs_submitter
    FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_proofs_reviewer
    FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tilopay Transactions ──
-- One row per payment initiation attempt. New internal_reference on each retry.
-- idempotency_key and provider_transaction_id are UNIQUE to prevent duplicates.
CREATE TABLE IF NOT EXISTS tilopay_transactions (
  id BIGINT NOT NULL AUTO_INCREMENT,
  order_id INT NOT NULL,
  internal_reference VARCHAR(36) NOT NULL COMMENT 'UUID v4 for this payment attempt',
  idempotency_key VARCHAR(64) NOT NULL COMMENT 'SHA-256 of unique attempt payload',
  provider_transaction_id VARCHAR(100) DEFAULT NULL COMMENT 'Tilopay transaction identifier from API',
  provider_session_token VARCHAR(500) DEFAULT NULL COMMENT 'SDK token (ephemeral)',
  status VARCHAR(20) NOT NULL DEFAULT 'creating'
    COMMENT 'creating | pending | approved | declined | cancelled | expired | failed | unknown',
  amount DECIMAL(10,2) NOT NULL COMMENT 'Server-authoritative amount at creation',
  currency VARCHAR(3) NOT NULL DEFAULT 'CRC' COMMENT 'ISO 4217 currency code',
  checkout_url VARCHAR(1000) DEFAULT NULL COMMENT 'Provider-hosted redirect URL',
  provider_created_at TIMESTAMP NULL DEFAULT NULL,
  confirmed_at TIMESTAMP NULL DEFAULT NULL,
  failed_at TIMESTAMP NULL DEFAULT NULL,
  failure_code VARCHAR(50) DEFAULT NULL COMMENT 'Sanitized failure category',
  failure_message VARCHAR(500) DEFAULT NULL COMMENT 'Bounded sanitized description',
  raw_status VARCHAR(100) DEFAULT NULL COMMENT 'Last known provider status string',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY idx_tilopay_internal_ref (internal_reference),
  UNIQUE KEY idx_tilopay_idempotency (idempotency_key),
  UNIQUE KEY idx_tilopay_provider_id (provider_transaction_id),
  KEY idx_tilopay_order_created (order_id, created_at),
  KEY idx_tilopay_status (status),
  CONSTRAINT fk_tilopay_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tilopay payment transaction attempts';

-- ── Crear administrador ──
-- Usa: node create-admin.js
