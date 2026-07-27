/**
 * Phase 16D — Mail/SMTP timeout, Resend integration, and hanging-registration tests.
 * Run: node --test tests/mail-smtp-timeout.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ──── SMTP timeouts ────

describe('Mail — SMTP timeouts', () => {
  it('transporter has connectionTimeout', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('connectionTimeout'), 'Should set connectionTimeout');
    assert.ok(code.includes('greetingTimeout'), 'Should set greetingTimeout');
    assert.ok(code.includes('socketTimeout'), 'Should set socketTimeout');
  });

  it('timeout values match requirements', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('SMTP_CONNECTION_TIMEOUT = 10000'), 'connectionTimeout should be 10000');
    assert.ok(code.includes('SMTP_GREETING_TIMEOUT = 10000'), 'greetingTimeout should be 10000');
    assert.ok(code.includes('SMTP_SOCKET_TIMEOUT = 15000'), 'socketTimeout should be 15000');
  });
});

// ──── MAIL_ENABLED gate ────

describe('Mail — MAIL_ENABLED gate', () => {
  it('mailer respects MAIL_ENABLED=false', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('MAIL_ENABLED'), 'Should check MAIL_ENABLED env var');
    assert.ok(code.includes("process.env.MAIL_ENABLED === 'true'"), 'Should gate on explicit true');
    assert.ok(code.includes("process.env.MAIL_ENABLED === 'false'"), 'Should detect explicit false');
  });

  it('transporter is NOT created when MAIL_ENABLED is false in production', () => {
    const originalEnabled = process.env.MAIL_ENABLED;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.MAIL_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../config/mailer')];
    const mailer = require('../config/mailer');
    assert.strictEqual(mailer.isConfigured(), false);
    process.env.MAIL_ENABLED = originalEnabled;
    process.env.NODE_ENV = originalNodeEnv;
    delete require.cache[require.resolve('../config/mailer')];
  });
});

// ──── Safe error logging ────

describe('Mail — safe error logging', () => {
  it('mailer never logs SMTP_PASSWORD', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(!code.includes('console.log(process.env.SMTP_PASSWORD'));
    assert.ok(!code.includes('console.error(process.env.SMTP_PASSWORD'));
    assert.ok(!code.includes('console.warn(process.env.SMTP_PASSWORD'));
    assert.ok(!code.includes('console.log(auth'));
    assert.ok(!code.includes('console.error(auth'));
  });

  it('mailer never logs SMTP_USER value', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(!code.includes('console.log(process.env.SMTP_USER'));
    assert.ok(!code.includes('console.error(process.env.SMTP_USER'));
  });

  it('sendMail catch block logs only error code and message', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const sendMailSection = code.substring(code.indexOf('async function sendMail'));
    assert.ok(sendMailSection.includes('err?.code'), 'Should log error code');
    assert.ok(sendMailSection.includes('err.message'), 'Should log error message');
    assert.ok(!sendMailSection.includes('console.error(to'), 'Should NOT log recipient');
    assert.ok(!sendMailSection.includes('console.error(transporter'), 'Should NOT log transporter');
  });

  it('authController registration catch logs only mailErr.message', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8');
    const registerSection = code.substring(code.indexOf('sendVerificationEmail(email, name'));
    assert.ok(registerSection.includes('mailErr.message'), 'Should log only mailErr.message');
    assert.ok(!registerSection.includes('mailErr.stack'), 'Should not log stack trace');
    assert.ok(!registerSection.includes('console.log(email)'), 'Should not log recipient email');
  });
});

// ──── Registration failure behavior ────

describe('Mail — registration fails fast on mail error', () => {
  it('authController catches mail errors and redirects', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8');
    const registerSection = code.substring(code.indexOf('sendVerificationEmail(email, name'));
    assert.ok(registerSection.includes('catch (mailErr)'), 'Should catch mail errors');
    assert.ok(registerSection.includes("redirect('/auth/register'"), 'Should redirect on mail failure');
    assert.ok(registerSection.includes('DELETE FROM pending_registrations'), 'Should clean up pending');
  });

  it('mail error catch is before outer catch', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8');
    const registerSection = code.substring(code.indexOf('sendVerificationEmail(email, name'));
    const mailCatchIdx = registerSection.indexOf('catch (mailErr)');
    const outerCatchIdx = registerSection.indexOf('catch (error)');
    if (outerCatchIdx === -1) {
      assert.ok(mailCatchIdx > 0, 'Mail catch should exist when no outer catch');
    } else {
      assert.ok(mailCatchIdx < outerCatchIdx, 'Mail catch should be before outer catch');
    }
  });
});

// ──── Startup verification ────

describe('Mail — startup verification disabled by default', () => {
  it('logStartupMailStatus does NOT call transporter.verify()', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const fnStart = code.indexOf('function logStartupMailStatus()');
    const fnBody = code.substring(fnStart, code.indexOf('\n}', fnStart));
    assert.ok(!fnBody.includes('transporter.verify()'), 'Should not call verify on startup');
    assert.ok(!fnBody.includes('await '), 'Should not await any async SMTP op');
  });

  it('logStartupMailStatus is called at module load', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('logStartupMailStatus()'), 'Should call startup status logger');
  });

  it('verifyConnection is not called at module level', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const afterStartup = code.indexOf('logStartupMailStatus()');
    const topLevelSection = code.substring(afterStartup, code.indexOf('\nasync function sendVerificationEmail'));
    assert.ok(!topLevelSection.includes('verifyConnection('), 'verifyConnection should not be auto-called');
  });
});

// ──── Environment variables ────

describe('Mail — environment variables', () => {
  it('.env.example documents all SMTP vars', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert.ok(code.includes('SMTP_HOST'));
    assert.ok(code.includes('SMTP_PORT'));
    assert.ok(code.includes('SMTP_SECURE'));
    assert.ok(code.includes('SMTP_USER'));
    assert.ok(code.includes('SMTP_PASSWORD'));
  });

  it('mailer reads all required SMTP env vars', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('process.env.SMTP_HOST'));
    assert.ok(code.includes('process.env.SMTP_PORT'));
    assert.ok(code.includes('process.env.SMTP_SECURE'));
    assert.ok(code.includes('process.env.SMTP_USER'));
    assert.ok(code.includes('process.env.SMTP_PASSWORD'));
  });
});

// ──── Unconfigured mail throws ────

describe('Mail — sendMail throws when not configured', () => {
  it('sendMail throws when mail not configured', async () => {
    const originalEnabled = process.env.MAIL_ENABLED;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.MAIL_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../config/mailer')];
    const mailer = require('../config/mailer');
    try {
      await mailer.sendMail({ to: 'test@test.com', subject: 'Test', html: '<p>test</p>' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('no configurado'));
    }
    process.env.MAIL_ENABLED = originalEnabled;
    process.env.NODE_ENV = originalNodeEnv;
    delete require.cache[require.resolve('../config/mailer')];
  });

  it('sendVerificationEmail throws when mail not configured', async () => {
    const originalEnabled = process.env.MAIL_ENABLED;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.MAIL_ENABLED = 'false';
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../config/mailer')];
    const mailer = require('../config/mailer');
    try {
      await mailer.sendVerificationEmail('test@test.com', 'Test', 'token', 60);
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('no configurado'));
    }
    process.env.MAIL_ENABLED = originalEnabled;
    process.env.NODE_ENV = originalNodeEnv;
    delete require.cache[require.resolve('../config/mailer')];
  });
});

// ──── Phase 16D: Resend provider ────

describe('Mail — Resend provider', () => {
  it('mailer reads MAIL_PROVIDER env var', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('MAIL_PROVIDER'), 'Should check MAIL_PROVIDER');
    assert.ok(code.includes('process.env.MAIL_PROVIDER'), 'Should read MAIL_PROVIDER');
    assert.ok(code.includes("mailProvider === 'resend'"), 'Should branch on resend');
  });

  it('mailer reads RESEND_API_KEY', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('RESEND_API_KEY'), 'Should read RESEND_API_KEY');
  });

  it('mailer reads RESEND_FROM_NAME and RESEND_FROM_EMAIL', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('RESEND_FROM_NAME'), 'Should read RESEND_FROM_NAME');
    assert.ok(code.includes('RESEND_FROM_EMAIL'), 'Should read RESEND_FROM_EMAIL');
  });

  it('has sendViaResend and sendViaSmtp functions', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('async function sendViaResend'), 'Should have sendViaResend');
    assert.ok(code.includes('async function sendViaSmtp'), 'Should have sendViaSmtp');
  });

  it('sendMail delegates to correct provider', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const sendMailSection = code.substring(code.indexOf('async function sendMail'));
    assert.ok(sendMailSection.includes("mailProvider === 'resend'"), 'Should branch on provider');
    assert.ok(sendMailSection.includes('sendViaResend'), 'Should call sendViaResend');
    assert.ok(sendMailSection.includes('sendViaSmtp'), 'Should call sendViaSmtp');
  });
});

// ──── Resend safe logging ────

describe('Mail — Resend safe logging', () => {
  it('mailer never logs RESEND_API_KEY', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(!code.includes('console.log(process.env.RESEND_API_KEY'));
    assert.ok(!code.includes('console.error(process.env.RESEND_API_KEY'));
    assert.ok(!code.includes('console.warn(process.env.RESEND_API_KEY'));
    assert.ok(!code.includes('console.log(resendApiKey'));
    assert.ok(!code.includes('console.error(resendApiKey'));
  });

  it('sendViaResend does not log email body or recipient', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const fnStart = code.indexOf('async function sendViaResend');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(!fnBody.includes('console.log(to'), 'Should NOT log recipient');
    assert.ok(!fnBody.includes('console.log(html'), 'Should NOT log email body');
    assert.ok(!fnBody.includes('console.log(text'), 'Should NOT log email text');
  });

  it('error logging includes provider name', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes("mailProvider === 'resend' ? 'Resend' : 'SMTP'"), 'Should differentiate providers');
  });
});

// ──── Resend configuration gate ────

describe('Mail — Resend configuration gate', () => {
  it('Resend client is NOT created when MAIL_ENABLED=false', () => {
    const originalEnabled = process.env.MAIL_ENABLED;
    const originalProvider = process.env.MAIL_PROVIDER;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalKey = process.env.RESEND_API_KEY;
    process.env.MAIL_ENABLED = 'false';
    process.env.MAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_fake';
    process.env.NODE_ENV = 'production';
    delete require.cache[require.resolve('../config/mailer')];
    const mailer = require('../config/mailer');
    assert.strictEqual(mailer.isConfigured(), false);
    process.env.MAIL_ENABLED = originalEnabled;
    process.env.MAIL_PROVIDER = originalProvider;
    process.env.NODE_ENV = originalNodeEnv;
    process.env.RESEND_API_KEY = originalKey;
    delete require.cache[require.resolve('../config/mailer')];
  });

  it('startup log mentions Resend', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('Proveedor: Resend'), 'Should log Resend in startup status');
  });

  it('startup log mentions SMTP', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    assert.ok(code.includes('Proveedor: SMTP'), 'Should log SMTP in startup status');
  });
});

// ──── Resend env validator ────

describe('Mail — Resend env validator', () => {
  it('envValidator checks RESEND_API_KEY when MAIL_PROVIDER=resend', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'envValidator.js'), 'utf8');
    assert.ok(code.includes("MAIL_PROVIDER || 'smtp'"), 'Should check MAIL_PROVIDER');
    assert.ok(code.includes("mailProvider === 'resend'"), 'Should branch on resend');
    assert.ok(code.includes('RESEND_API_KEY'), 'Should validate RESEND_API_KEY');
    assert.ok(code.includes('RESEND_FROM_EMAIL'), 'Should validate RESEND_FROM_EMAIL');
  });
});

// ──── Resend error handling ────

describe('Mail — Resend error handling', () => {
  it('sendViaResend throws on API error', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const fnStart = code.indexOf('async function sendViaResend');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes('if (error)'), 'Should check for Resend API error');
    assert.ok(fnBody.includes('new Error('), 'Should create Error');
    assert.ok(fnBody.includes('throw err'), 'Should throw');
  });

  it('verifyConnection handles Resend provider', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const fnStart = code.indexOf('async function verifyConnection');
    const fnEnd = code.indexOf('\n}', fnStart);
    const fnBody = code.substring(fnStart, fnEnd);
    assert.ok(fnBody.includes("mailProvider === 'resend'"), 'Should branch on resend');
  });

  it('verifyConnection not auto-called at startup', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const startupSection = code.substring(code.indexOf('logStartupMailStatus()'));
    const topLevelAfterStartup = startupSection.substring(0, startupSection.indexOf('\nasync function sendVerificationEmail'));
    assert.ok(!topLevelAfterStartup.includes('verifyConnection('), 'Should NOT auto-call verifyConnection');
  });
});

// ──── Shared interface ────

describe('Mail — shared interface preserved', () => {
  it('exports all expected functions', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'config', 'mailer.js'), 'utf8');
    const exportsSection = code.substring(code.indexOf('module.exports'));
    assert.ok(exportsSection.includes('sendVerificationEmail'));
    assert.ok(exportsSection.includes('sendPasswordResetEmail'));
    assert.ok(exportsSection.includes('sendMail'));
    assert.ok(exportsSection.includes('verifyConnection'));
    assert.ok(exportsSection.includes('isConfigured'));
  });

  it('authController only imports mailer, not Resend or nodemailer directly', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'authController.js'), 'utf8');
    assert.ok(code.includes("require('../config/mailer')"), 'Should import mailer');
    assert.ok(!code.includes("require('resend')"), 'Should NOT import Resend');
    assert.ok(!code.includes("require('nodemailer')"), 'Should NOT import nodemailer');
  });
});
