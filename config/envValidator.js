/**
 * Environment validation — fail-fast for missing critical secrets in production.
 * Phase 16D: added DB_PASSWORD remote check, APP_URL HTTPS requirement,
 * mail credentials, analytics format validation, Railway volume warning.
 * Safe: never logs secret values, only presence and format.
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
    // DB_PASSWORD: required for any DB_HOST that isn't localhost/127.0.0.1
    if (!process.env.DB_PASSWORD) {
      const isRemote = process.env.DB_HOST &&
        process.env.DB_HOST !== 'localhost' &&
        process.env.DB_HOST !== '127.0.0.1';
      if (isRemote) {
        issues.push('DB_PASSWORD: requerido en producción con host remoto.');
      }
    }

    // APP_URL must be present and use HTTPS
    if (!process.env.APP_URL) {
      issues.push('APP_URL: requerido en producción (ej. https://misitio.com).');
    } else {
      try {
        const url = new URL(process.env.APP_URL);
        if (url.protocol !== 'https:') {
          issues.push('APP_URL: debe usar HTTPS en producción.');
        }
      } catch (_err) {
        issues.push('APP_URL: no es una URL válida.');
      }
    }

    // Tilopay: optional integration
    if (process.env.TILOPAY_ENABLED === 'true') {
      if (!process.env.TILOPAY_API_KEY) issues.push('TILOPAY_API_KEY: requerido cuando Tilopay está habilitado.');
      if (!process.env.TILOPAY_API_USER) issues.push('TILOPAY_API_USER: requerido cuando Tilopay está habilitado.');
      if (!process.env.TILOPAY_API_PASSWORD) issues.push('TILOPAY_API_PASSWORD: requerido cuando Tilopay está habilitado.');
      if (!process.env.TILOPAY_PUBLIC_BASE_URL) issues.push('TILOPAY_PUBLIC_BASE_URL: requerido cuando Tilopay está habilitado.');
    }

    // Mail: optional integration — validate based on provider
    if (process.env.MAIL_ENABLED === 'true') {
      const mailProvider = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();
      if (mailProvider === 'resend') {
        if (!process.env.RESEND_API_KEY) issues.push('RESEND_API_KEY: requerido cuando MAIL_PROVIDER=resend.');
        if (process.env.RESEND_FROM_EMAIL) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.RESEND_FROM_EMAIL)) {
            issues.push('RESEND_FROM_EMAIL: formato de email inválido.');
          }
        }
      } else {
        if (!process.env.SMTP_HOST) issues.push('SMTP_HOST: requerido cuando el correo está habilitado.');
        if (!process.env.SMTP_USER) issues.push('SMTP_USER: requerido cuando el correo está habilitado.');
        if (!process.env.SMTP_PASSWORD) issues.push('SMTP_PASSWORD: requerido cuando el correo está habilitado.');
      }
    }

    // Analytics: validate format if present
    if (process.env.GA_MEASUREMENT_ID) {
      const gaId = String(process.env.GA_MEASUREMENT_ID);
      if (gaId && !/^G-[A-Z0-9]{6,}$/.test(gaId)) {
        issues.push('GA_MEASUREMENT_ID: el formato debe ser G-XXXXXXXXXX.');
      }
    }

    // Railway: warn about missing persistent volume
    const hasUploadDir = process.env.UPLOAD_PUBLIC_DIR || process.env.UPLOAD_PROOFS_DIR;
    if (!hasUploadDir) {
      issues.push('UPLOAD_PUBLIC_DIR / UPLOAD_PROOFS_DIR: sin volumen persistente, los archivos se pierden al reiniciar.');
    }
  }

  // Port validation (all environments)
  const port = parseInt(process.env.PORT, 10);
  if (process.env.PORT && (Number.isNaN(port) || port < 1 || port > 65535)) {
    issues.push('PORT: debe ser un número de puerto válido (1-65535).');
  }

  // URL format validation (development only)
  if (process.env.APP_URL && !isProduction) {
    try { new URL(process.env.APP_URL); } catch (_err) {
      issues.push('APP_URL: no es una URL válida.');
    }
  }

  // Upload path isolation (all environments)
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
