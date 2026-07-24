/**
 * Environment validation — fail-fast for missing critical secrets in production.
 * Safe: never logs secret values, only presence.
 */
function validateEnv() {
  const issues = [];
  const isProduction = process.env.NODE_ENV === 'production';
  const isTest = process.env.NODE_ENV === 'test';

  // Required in ALL environments
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'replace_with_a_long_random_secret') {
    if (isProduction) issues.push('SESSION_SECRET: debe ser un valor seguro único en producción.');
    else if (!isTest) issues.push('SESSION_SECRET: se recomienda configurar un valor seguro.');
  }

  // Production-critical
  if (isProduction) {
    if (!process.env.DB_PASSWORD && process.env.DB_HOST !== 'localhost') {
      issues.push('DB_PASSWORD: requerido en producción con host remoto.');
    }
    if (process.env.TILOPAY_ENABLED === 'true') {
      if (!process.env.TILOPAY_API_KEY) issues.push('TILOPAY_API_KEY: requerido cuando Tilopay está habilitado.');
      if (!process.env.TILOPAY_API_USER) issues.push('TILOPAY_API_USER: requerido cuando Tilopay está habilitado.');
      if (!process.env.TILOPAY_API_PASSWORD) issues.push('TILOPAY_API_PASSWORD: requerido cuando Tilopay está habilitado.');
    }
  }

  // Port validation
  const port = parseInt(process.env.PORT, 10);
  if (process.env.PORT && (Number.isNaN(port) || port < 1 || port > 65535)) {
    issues.push('PORT: debe ser un número de puerto válido (1-65535).');
  }

  // URL validation
  if (process.env.APP_URL) {
    try { new URL(process.env.APP_URL); } catch (_err) {
      issues.push('APP_URL: no es una URL válida.');
    }
  }

  // Upload path validation
  const path = require('path');
  const uploadPublic = process.env.UPLOAD_PUBLIC_DIR;
  const uploadProofs = process.env.UPLOAD_PROOFS_DIR;
  if (uploadPublic && uploadProofs) {
    const absPublic = path.resolve(uploadPublic);
    const absProofs = path.resolve(uploadProofs);
    if (absPublic === absProofs) {
      issues.push('UPLOAD_PUBLIC_DIR y UPLOAD_PROOFS_DIR no deben apuntar al mismo directorio.');
    } else if (absProofs.startsWith(absPublic + path.sep)) {
      issues.push('UPLOAD_PROOFS_DIR no debe estar dentro de UPLOAD_PUBLIC_DIR (los comprobantes serían públicos).');
    } else if (absPublic.startsWith(absProofs + path.sep)) {
      issues.push('UPLOAD_PUBLIC_DIR no debe estar dentro de UPLOAD_PROOFS_DIR.');
    }
  }
  if (isProduction) {
    if (!uploadPublic) issues.push('UPLOAD_PUBLIC_DIR: se recomienda configurar en un volumen persistente en producción.');
    if (!uploadProofs) issues.push('UPLOAD_PROOFS_DIR: se recomienda configurar en un volumen persistente en producción.');
  }

  return issues;
}

function fail(issues) {
  console.error('❌ Error de configuración:');
  for (const issue of issues) console.error(`  • ${issue}`);
  process.exit(1);
}

function warn(issues) {
  console.warn('⚠️  Advertencias de configuración:');
  for (const issue of issues) console.warn(`  • ${issue}`);
}

module.exports = { validateEnv };

if (require.main === module) {
  const issues = validateEnv();
  if (issues.length) {
    if (process.env.NODE_ENV === 'production') fail(issues);
    else warn(issues);
  } else {
    console.log('✅ Configuración de entorno válida.');
  }
}
