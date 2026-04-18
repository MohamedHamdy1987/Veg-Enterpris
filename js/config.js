// ================================================
// ENTERPRISE CONFIG - إعدادات النظام المركزية
// ================================================

// ---------- Supabase ----------
const SUPABASE_URL = "https://oawtdxkylwujcvdzfasn.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hd3RkeGt5bHd1amN2ZHpmYXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MjMxMjcsImV4cCI6MjA5MjA5OTEyN30.1BvWh200IjumJ5v2JLh0bSZNhIgzQLrTrDSr_EJfFAQ";

// ---------- إعدادات التطبيق ----------
const APP_CONFIG = {
  PAGE_SIZE: 50,                          // عناصر لكل صفحة
  RETRY_COUNT: 3,                         // محاولات إعادة الاتصال
  SESSION_TIMEOUT: 8 * 60 * 60 * 1000,    // 8 ساعات
  ENABLE_REALTIME: true,                  // تفعيل التحديث المباشر
  CURRENCY: "جنيه",                       // رمز العملة
  COMMISSION_RATE: 0.07,                  // نسبة عمولة (إن وجدت)
  ENABLE_NOTIFICATIONS: true,
  DEFAULT_BRANCH_NAME: "الفرع الرئيسي"
};

// ---------- خطط الاشتراك ----------
const PLANS = {
  monthly: { name: "شهري", price: 750, days: 30 },
  yearly:  { name: "سنوي", price: 6000, days: 365 }
};

// ---------- الصلاحيات (RBAC) ----------
const ROLES = {
  admin: ["*"],
  manager: ["sales", "customers", "suppliers", "reports", "collections"],
  cashier: ["sales", "customers", "collections"],
  viewer: []
};

// ---------- إعدادات واجهة المستخدم ----------
const UI_CONFIG = {
  DATE_FORMAT: "ar-EG",
  DEFAULT_PAGE: "dashboard"
};

// ---------- رسائل الإشعارات ----------
const NOTIFICATION_MESSAGES = {
  PRODUCT_FINISHED: (name) => `📦 نفد المنتج: ${name}`,
  NEW_SALE: (amount) => `💰 بيع جديد: ${amount}`,
  LOW_STOCK: (name, stock) => `⚠️ المخزون منخفض: ${name} (${stock})`
};

// ---------- إعدادات النسخ الاحتياطي ----------
const BACKUP_CONFIG = {
  FILE_NAME: "backup.json"
};

// ---------- واتساب ----------
const WHATSAPP_NUMBER = "201XXXXXXXXX";
function getWhatsAppLink(phone, text) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// ---------- دوال مساعدة ----------
function can(role, permission) {
  const perms = ROLES[role] || [];
  return perms.includes("*") || perms.includes(permission);
}

// ---------- وضع التصحيح ----------
const DEBUG = false;
function log(...args) { if (DEBUG) console.log(...args); }