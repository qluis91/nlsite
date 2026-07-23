/**
 * Public contact configuration — centralized WhatsApp number.
 *
 * Approved NinjaLab WhatsApp: +506 7024 0270  →  wa.me/50670240270
 * Set WHATSAPP_NUMBER env var to override (digits only).
 */
const DEFAULT_WHATSAPP_NUMBER = '50670240270';

function getWhatsAppPhone() {
  const raw = process.env.WHATSAPP_NUMBER || DEFAULT_WHATSAPP_NUMBER;
  return String(raw).replace(/\D/g, '');
}

/**
 * Build a wa.me URL with a product inquiry message.
 */
function buildWhatsAppUrl(productTitle, siteName) {
  const phone = getWhatsAppPhone();
  const message = `Hola, me interesa el producto "${productTitle}" de ${siteName}. Quisiera obtener más información.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

module.exports = { getWhatsAppPhone, buildWhatsAppUrl, DEFAULT_WHATSAPP_NUMBER };
