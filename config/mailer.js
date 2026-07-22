/**
 * Nodemailer transporter — minimal single-responsibility mailer.
 *
 * Reads SMTP_* and APP_URL from environment variables.
 * Exports sendMail(options) for sending verification/reset emails.
 * Never logs credentials.
 */
const nodemailer = require('nodemailer');

const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'APP_URL'];
const missing = required.filter((k) => !process.env[k]);

let transporter = null;
let mailConfigured = false;

if (missing.length === 0) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
    mailConfigured = true;
  } catch (err) {
    console.error('Error configurando transporte de correo:', err.message);
  }
} else {
  console.warn(`⚠️  Correo no configurado. Faltan variables: ${missing.join(', ')}`);
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FROM_NAME = process.env.SMTP_FROM_NAME || 'nlSite';
const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '';

/**
 * Send a verification email.
 * @param {string} to - recipient email
 * @param {string} name - recipient name
 * @param {string} token - raw verification token
 * @param {number} expiresMinutes
 */
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

  return sendMail({
    to,
    subject: 'Verifica tu cuenta de nlSite',
    html,
    text,
  });
}

/**
 * Send a password reset email.
 * @param {string} to - recipient email
 * @param {string} name - recipient name
 * @param {string} token - raw reset token
 * @param {number} expiresMinutes
 */
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

  return sendMail({
    to,
    subject: 'Restablece tu contraseña de nlSite',
    html,
    text,
  });
}

/**
 * Low-level send. Never logs credentials.
 */
async function sendMail({ to, subject, html, text }) {
  if (!mailConfigured) throw new Error('Correo no configurado.');
  return transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
  });
}

/**
 * Verify SMTP connection during development. Does not log auth.
 */
async function verifyConnection() {
  if (!mailConfigured) return false;
  try {
    await transporter.verify();
    console.log('✅ Conexión SMTP verificada.');
    return true;
  } catch (err) {
    console.error('❌ Error de conexión SMTP:', err.message);
    return false;
  }
}

/**
 * Escape HTML for safe rendering in email bodies.
 */
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
