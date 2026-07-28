-- ============================================
-- ESQUEMA SQL — PLANTILLA WEB MODULAR
-- Importar en phpMyAdmin (XAMPP)
-- ============================================

CREATE DATABASE IF NOT EXISTS nlsite_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE nlsite_db;

-- ── Migration tracking (Phase 13) ──
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  checksum VARCHAR(64) NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  duration_ms INT NOT NULL DEFAULT 0,
  status ENUM('ok','failed') NOT NULL DEFAULT 'ok',
  error VARCHAR(500) NULL,
  INDEX idx_migrations_name (name),
  INDEX idx_migrations_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  published_value LONGTEXT NULL,
  has_unpublished_changes TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  value_type VARCHAR(20) NOT NULL DEFAULT 'string' COMMENT 'string | number | boolean | json | media',
  setting_group VARCHAR(40) NOT NULL DEFAULT 'general',
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Tabla de Categorías ──
CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  seo_title VARCHAR(160) NULL,
  seo_description VARCHAR(300) NULL,
  og_image VARCHAR(500) NULL,
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
  seo_title VARCHAR(160) NULL,
  seo_description VARCHAR(300) NULL,
  og_image VARCHAR(500) NULL,
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
  youtube_url VARCHAR(500) NULL,
  custom_cover_path VARCHAR(500) NULL,
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

-- ── Biblioteca multimedia del CMS (Fase 11A) ──
CREATE TABLE IF NOT EXISTS media_assets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL COMMENT 'UUID estable usado en URLs de admin y referencias de contenido',
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NULL COMMENT 'Nombre del navegador, solo metadato',
  storage_disk VARCHAR(30) NOT NULL DEFAULT 'public',
  storage_path VARCHAR(500) NOT NULL COMMENT 'Ruta relativa a la raíz de medios',
  public_url VARCHAR(500) NOT NULL,
  thumbnail_path VARCHAR(500) NULL,
  variants_json JSON NULL,
  mime_type VARCHAR(100) NOT NULL,
  extension VARCHAR(10) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  width INT NULL,
  height INT NULL,
  model_metadata JSON NULL,
  checksum CHAR(64) NOT NULL,
  title VARCHAR(150) NULL,
  alt_text VARCHAR(250) NULL,
  description VARCHAR(2000) NULL,
  category VARCHAR(20) NOT NULL DEFAULT 'other' COMMENT 'site | gallery | logo | carousel | icon | model | other',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active | archived | processing | failed',
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_media_assets_public_id (public_id),
  UNIQUE KEY uq_media_assets_storage_path (storage_path),
  KEY idx_media_assets_category_status (category, status, deleted_at),
  KEY idx_media_assets_status_created (status, created_at),
  KEY idx_media_assets_checksum (checksum),
  KEY idx_media_assets_creator (created_by),
  KEY idx_media_assets_title (title),
  CONSTRAINT fk_media_assets_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_media_assets_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Páginas administrables ──
CREATE TABLE IF NOT EXISTS pages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_key VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'published' COMMENT 'draft | published | archived',
  published_version INT NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pages_page_key (page_key),
  UNIQUE KEY uq_pages_slug (slug),
  KEY idx_pages_status (status),
  CONSTRAINT fk_pages_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pages_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Secciones de página ──
CREATE TABLE IF NOT EXISTS page_sections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page_id INT NOT NULL,
  section_key VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  content_json JSON NULL,
  style_json JSON NULL,
  published_content_json JSON NULL,
  published_style_json JSON NULL,
  published_at DATETIME NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft | published | archived',
  version INT NOT NULL DEFAULT 1,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_page_sections_page_section (page_id, section_key),
  KEY idx_page_sections_page_order (page_id, sort_order, id),
  KEY idx_page_sections_status (status, is_enabled),
  CONSTRAINT fk_page_sections_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
  CONSTRAINT fk_page_sections_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_page_sections_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Historial de revisiones de contenido ──
CREATE TABLE IF NOT EXISTS content_revisions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL COMMENT 'media_asset | page | page_section | site_setting',
  entity_id BIGINT NOT NULL,
  revision_number INT NOT NULL,
  action VARCHAR(30) NOT NULL COMMENT 'upload | metadata_edit | replace | archive | restore',
  previous_data JSON NULL,
  new_data JSON NULL,
  change_summary VARCHAR(300) NULL,
  changed_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_content_revisions_entity_revision (entity_type, entity_id, revision_number),
  KEY idx_content_revisions_entity_created (entity_type, entity_id, created_at),
  KEY idx_content_revisions_actor (changed_by),
  CONSTRAINT fk_content_revisions_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Phase 11C: Panel 2 & Panel 3 repeatable items ──

CREATE TABLE IF NOT EXISTS logo_loop_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/showcase)',
  item_type VARCHAR(20) NOT NULL DEFAULT 'text' COMMENT 'text | image | logo',
  text_content VARCHAR(160) NULL,
  media_public_id CHAR(36) NULL,
  url VARCHAR(500) NULL,
  link_type VARCHAR(20) NOT NULL DEFAULT 'internal',
  target VARCHAR(20) NOT NULL DEFAULT '_self',
  alt_text VARCHAR(250) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  published_data JSON NULL,
  published_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_logo_loop_items_public_id (public_id),
  KEY idx_logo_loop_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_logo_loop_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_logo_loop_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_logo_loop_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_carousel_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/showcase)',
  eyebrow VARCHAR(120) NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(1200) NULL,
  button_label VARCHAR(80) NULL,
  button_url VARCHAR(500) NULL,
  button_target VARCHAR(20) NOT NULL DEFAULT '_self',
  media_public_id CHAR(36) NULL COMMENT 'Main/background image',
  preview_media_public_id CHAR(36) NULL,
  theme_key VARCHAR(40) NULL COMMENT 'graphite | lime | silver | ink',
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  published_data JSON NULL,
  published_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_home_carousel_items_public_id (public_id),
  KEY idx_home_carousel_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_home_carousel_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_home_carousel_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_home_carousel_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS home_feature_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  page_section_id INT NOT NULL COMMENT 'FK → page_sections (home/services)',
  title VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  detail_text VARCHAR(1500) NULL,
  icon_type VARCHAR(20) NOT NULL DEFAULT 'builtin' COMMENT 'builtin | media',
  icon_key VARCHAR(40) NULL COMMENT 'diseno-3d | escaneo-3d | diseno-grafico | desarrollo-web | prendas | impresion-3d',
  media_public_id CHAR(36) NULL,
  url VARCHAR(500) NULL,
  link_type VARCHAR(20) NOT NULL DEFAULT 'internal',
  target VARCHAR(20) NOT NULL DEFAULT '_self',
  style_variant VARCHAR(40) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  published_data JSON NULL,
  published_at DATETIME NULL,
  created_by INT NULL,
  updated_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY uq_home_feature_items_public_id (public_id),
  KEY idx_home_feature_items_section_status (page_section_id, status, deleted_at, sort_order),
  CONSTRAINT fk_home_feature_items_section FOREIGN KEY (page_section_id) REFERENCES page_sections(id) ON DELETE CASCADE,
  CONSTRAINT fk_home_feature_items_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_home_feature_items_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Phase 11D: Publication batches ──

CREATE TABLE IF NOT EXISTS publication_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'selected' COMMENT 'selected | homepage | module | restore',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | validating | published | failed | cancelled',
  summary VARCHAR(500) NULL,
  created_by INT NULL,
  published_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  failure_reason VARCHAR(1000) NULL,
  UNIQUE KEY uq_publication_batches_public_id (public_id),
  INDEX idx_pb_scope (scope),
  INDEX idx_pb_status (status),
  INDEX idx_pb_created_by (created_by),
  INDEX idx_pb_created_at (created_at),
  CONSTRAINT fk_pb_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_pb_published_by FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS publication_batch_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  module_key VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id INT NULL,
  source_revision_id BIGINT NULL,
  published_revision_id BIGINT NULL,
  previous_published_snapshot JSON NULL,
  new_published_snapshot JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | validated | published | failed | skipped',
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pbi_batch_id (batch_id),
  INDEX idx_pbi_module_key (module_key),
  INDEX idx_pbi_status (status),
  CONSTRAINT fk_pbi_batch_id FOREIGN KEY (batch_id) REFERENCES publication_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_pbi_source_revision FOREIGN KEY (source_revision_id) REFERENCES content_revisions(id) ON DELETE SET NULL,
  CONSTRAINT fk_pbi_published_revision FOREIGN KEY (published_revision_id) REFERENCES content_revisions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Crear administrador ──
-- Usa: node create-admin.js
