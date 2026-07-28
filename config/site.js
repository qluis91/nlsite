// config/site.js
require('dotenv').config();

module.exports = {
  name: process.env.SITE_NAME || 'NinjaLab CR',
  description: process.env.SITE_DESCRIPTION || 'Plantilla modular',
  colors: {
    primary: process.env.BRAND_PRIMARY || '#2563eb',
    primaryHover: process.env.BRAND_PRIMARY_HOVER || '#1d4ed8',
    secondary: process.env.BRAND_SECONDARY || '#64748b',
    accent: process.env.BRAND_ACCENT || '#f59e0b',
    bg: process.env.BRAND_BG || '#f8fafc',
    sidebarBg: process.env.BRAND_SIDEBAR_BG || '#1e293b',
    sidebarText: process.env.BRAND_SIDEBAR_TEXT || '#cbd5e1',
    sidebarHover: process.env.BRAND_SIDEBAR_HOVER || '#334155',
    success: process.env.BRAND_SUCCESS || '#22c55e',
    danger: process.env.BRAND_DANGER || '#ef4444',
    warning: process.env.BRAND_WARNING || '#f59e0b'
  }
};