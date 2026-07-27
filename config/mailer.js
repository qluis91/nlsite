/**
 * Mail service — dual-provider (Resend API + SMTP fallback).
 * Phase 16D: Resend integration, bounded timeouts, MAIL_ENABLED gate.
 *
 * Environment:
 *   MAIL_PROVIDER=resend|smtp   (default: smtp)
 *   MAIL_ENABLED=true|false
 *
 * Resend:
 *   RESEND_API_KEY
 *   RESEND_FROM_NAME   (optional, default: 'nlSite')
 *   RESEND_FROM_EMAIL  (optional, default: 'noreply@resend.dev')
 *
 * SMTP:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD
 *   SMTP_FROM_NAME, SMTP_FROM_EMAIL
 *
 * Exports sendVerificationEmail / sendPasswordResetEmail / sendMail / verifyConnection / isConfigured.
 * Controllers never depend on Resend or Nodemailer directly.
 * Never logs credentials, tokens, recipient addresses, or email bodies.
 */
const isProduction = process.env.NODE_ENV === 'production';
const mailProvider = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();
const mailExplicitlyEnabled = process.env.MAIL_ENABLED === 'true';
const mailExplicitlyDisabled = process.env.MAIL_ENABLED === 'false';

const SMTP_CONNECTION_TIMEOUT = 10000;
const SMTP_GREETING_TIMEOUT = 10000;
const SMTP_SOCKET_TIMEOUT = 15000;

let mailConfigured = false;

// ── Provider-specific clients ──
let smtpTransporter = null;
let resendClient = null;

// ── Resend initialisation ──
const resendApiKey = process.env.RESEND_API_KEY || '';
const resendFromName = process.env.RESEND_FROM_NAME || 'nlSite';
const resendFromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev';

if (mailProvider === 'resend') {
  if (resendApiKey && shouldConfigureResend()) {
    try {
      const { Resend } = require('resend');
      resendClient = new Resend(resendApiKey);
      mailConfigured = true;
    } catch (err) {
      console.error('Error inicializando Resend:', err.message);
    }
  }
} else {
  // SMTP provider (default)
  if (shouldConfigureSmtp()) {
    try {
      const nodemailer = require('nodemailer');
      smtpTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
        connectionTimeout: SMTP_CONNECTION_TIMEOUT,
        greetingTimeout: SMTP_GREETING_TIMEOUT,
        socketTimeout: SMTP_SOCKET_TIMEOUT,
      });
      mailConfigured = true;
    } catch (err) {
      console.error('Error configurando transporte SMTP:', err.message);
    }
  }
}

// ── Startup status (no test email, no blocking) ──
logStartupMailStatus();

function shouldConfigureResend() {
  return mailExplicitlyEnabled || (!isProduction && !mailExplicitlyDisabled);
}

function shouldConfigureSmtp() {
  const hasVars = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  if (!hasVars) return false;
  return mailExplicitlyEnabled || (!isProduction && !mailExplicitlyDisabled);
}

function logStartupMailStatus() {
  if (mailProvider === 'resend') {
    const hasKey = !!resendApiKey;
    if (!hasKey) {
      if (isProduction && mailExplicitlyEnabled) {
        console.warn('⚠️  MAIL_ENABLED=true pero RESEND_API_KEY no configurado.');
      }
      return;
    }
    if (mailExplicitlyDisabled) {
      console.log('📧 Resend configurado pero MAIL_ENABLED=false — correo deshabilitado.');
      return;
    }
    if (!isProduction || mailExplicitlyEnabled) {
      console.log('📧 Proveedor: Resend — correo habilitado.');
    }
  } else {
    const hasVars = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
    if (!hasVars) {
      if (isProduction && mailExplicitlyEnabled) {
        console.warn('⚠️  MAIL_ENABLED=true pero faltan variables SMTP.');
      }
      return;
    }
    if (mailExplicitlyDisabled) {
      console.log('📧 SMTP configurado pero MAIL_ENABLED=false — correo deshabilitado.');
      return;
    }
    if (!isProduction || mailExplicitlyEnabled) {
      console.log('📧 Proveedor: SMTP — correo habilitado.');
    }
  }
}

// ── Sender identity ──
const FROM_NAME = mailProvider === 'resend'
  ? resendFromName
  : (process.env.SMTP_FROM_NAME || 'nlSite');

const FROM_EMAIL = mailProvider === 'resend'
  ? resendFromEmail
  : (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '');

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// ── Public API ──

async function sendVerificationEmail(to, name, token, expiresMinutes) {
  if (!mailConfigured) throw new Error('Correo no configurado.');

  const link = `${APP_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;

  const html = `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p>Gracias por registrarte en nlSite. Para activar tu cuenta, haz clic en el siguiente botón:</p>
    <p style="margin: 1.5rem 0;">
      <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Verificar cuenta</a>
    </p>
    <p>O copia este enlace en tu navegador:</p>
    <p style="color:#64748b;word-break:break-all;">${link}</p>
    <p>Este enlace expira en ${expiresMinutes} minutos.</p>
    <p style="color:#94a3b8;font-size:0.85rem;">Si no creaste esta cuenta, puedes ignorar este mensaje.</p>
  `.trim();

  const text = [
    `Hola ${name},`,
    '',
    'Gracias por registrarte en nlSite. Para activar tu cuenta, abre este enlace:',
    link,
    '',
    `Este enlace expira en ${expiresMinutes} minutos.`,
    'Si no creaste esta cuenta, ignora este mensaje.',
  ].join('\n');

  return sendMail({ to, subject: 'Verifica tu cuenta de nlSite', html, text });
}

async function sendPasswordResetEmail(to, name, token, expiresMinutes) {
  if (!mailConfigured) throw new Error('Correo no configurado.');

  const link = `${APP_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;

  const html = `
    <p>Hola <strong>${escapeHtml(name)}</strong>,</p>
    <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar:</p>
    <p style="margin: 1.5rem 0;">
      <a href="${link}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Restablecer contraseña</a>
    </p>
    <p>O copia este enlace en tu navegador:</p>
    <p style="color:#64748b;word-break:break-all;">${link}</p>
    <p>Este enlace expira en ${expiresMinutes} minutos.</p>
    <p style="color:#94a3b8;font-size:0.85rem;">Si no solicitaste este cambio, puedes ignorar este mensaje.</p>
  `.trim();

  const text = [
    `Hola ${name},`,
    '',
    'Recibimos una solicitud para restablecer tu contraseña. Abre este enlace:',
    link,
    '',
    `Este enlace expira en ${expiresMinutes} minutos.`,
    'Si no solicitaste este cambio, ignora este mensaje.',
  ].join('\n');

  return sendMail({ to, subject: 'Restablece tu contraseña de nlSite', html, text });
}

/**
 * Shared sendMail — delegates to active provider.
 * Controllers only call the public wrappers above, never this directly.
 * Never logs credentials, tokens, recipients, or email bodies.
 */
async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured) throw new Error('Correo no configurado.');

  try {
    if (mailProvider === 'resend') {
      return await sendViaResend({ to, subject, html, text });
    }
    return await sendViaSmtp({ to, subject, html, text });
  } catch (err) {
    const provider = mailProvider === 'resend' ? 'Resend' : 'SMTP';
    const code = err?.code || err?.statusCode || 'UNKNOWN';
    console.error(`Error ${provider} (${code}): ${err.message}`);
    throw err;
  }
}

async function sendViaResend({ to, subject, html, text }) {
  const from = `${FROM_NAME} <${FROM_EMAIL}>`;
  const { data, error } = await resendClient.emails.send({ from, to, subject, html, text });

  if (error) {
    const err = new Error(error.message || 'Error enviando email vía Resend.');
    err.code = error.statusCode || error.name || 'RESEND_ERROR';
    throw err;
  }
  return data;
}

async function sendViaSmtp({ to, subject, html, text }) {
  return smtpTransporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
  });
}

async function verifyConnection() {
  if (!mailConfigured) return false;
  try {
    if (mailProvider === 'resend') {
      // Resend: simple connectivity check (no-op send to verify auth)
      await resendClient.emails.send({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: FROM_EMAIL,
        subject: 'nlSite — prueba de conexión',
        text: 'Este correo verifica la conexión Resend. Ignóralo.',
      });
      console.log('✅ Conexión Resend verificada.');
      return true;
    }
    await smtpTransporter.verify();
    console.log('✅ Conexión SMTP verificada.');
    return true;
  } catch (err) {
    const provider = mailProvider === 'resend' ? 'Resend' : 'SMTP';
    console.error(`❌ Error de conexión ${provider}:`, err.code || err.message);
    return false;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendMail,
  verifyConnection,
  isConfigured: () => mailConfigured,
};
