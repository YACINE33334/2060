const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const { getSupabase } = require('./lib/supabase');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(session({
  secret: 'store-premium-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.get('/ping', (req, res) => res.send('ok-v2'));

// تحميل الإعدادات
let config = {
  facebookPixelId: '',
  tiktokPixelId: '',
  storeName: 'متجري',
  whatsappNumber: '',
  storeEmail: '',
  currency: 'BGN',
  supabaseUrl: 'https://zhfpblwnotwcfgrauyvm.supabase.co',
  supabaseAnonKey: 'sb_publishable_2YJR1HkzpU9P_MijSlt1ng_ZCzTMRbs'
};
try {
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  }
} catch (e) { }

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + (file.originalname || 'img').replace(/[^a-zA-Z0-9.-]/g, ''))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// دمج إعدادات قاعدة البيانات مع config
const settingsKeys = [
  'facebook_pixel', 'tiktok_pixel', 'whatsapp_number', 'store_email', 'currency', 'store_name', 'form_config', 'supabase_url', 'supabase_anon_key',
  'facebook_pixel_name', 'tiktok_pixel_name', 'facebook_token',
  'facebook_pixel_enabled', 'facebook_track_abandoned', 'facebook_conversion_event', 'facebook_test_mode', 'facebook_test_code',
  'tiktok_pixel_enabled', 'tiktok_track_abandoned', 'tiktok_conversion_event',
  'internal_store_name', 'internal_store_image',
  'admin_email', 'admin_password',
  'thanks_title', 'thanks_message'
];
app.use((req, res, next) => {
  try {
    settingsKeys.forEach(k => {
      const v = db.settings.get(k);
      if (v !== undefined && v !== null) {
        let key = k;
        if (k === 'facebook_pixel') key = 'facebookPixelId';
        else if (k === 'tiktok_pixel') key = 'tiktokPixelId';
        else if (k === 'whatsapp_number') key = 'whatsappNumber';
        else if (k === 'store_email') key = 'storeEmail';
        else if (k === 'store_name') key = 'storeName';
        else if (k === 'form_config') key = 'formConfig';
        else if (k === 'supabase_url') key = 'supabaseUrl';
        else if (k === 'supabase_anon_key') key = 'supabaseAnonKey';
        else if (k === 'facebook_pixel_name') key = 'facebookPixelName';
        else if (k === 'tiktok_pixel_name') key = 'tiktokPixelName';
        else if (k === 'facebook_token') key = 'facebookToken';
        else if (k === 'facebook_pixel_enabled') key = 'facebookPixelEnabled';
        else if (k === 'facebook_track_abandoned') key = 'facebookTrackAbandoned';
        else if (k === 'facebook_conversion_event') key = 'facebookConversionEvent';
        else if (k === 'facebook_test_mode') key = 'facebookTestMode';
        else if (k === 'facebook_test_code') key = 'facebookTestCode';
        else if (k === 'tiktok_pixel_enabled') key = 'tiktokPixelEnabled';
        else if (k === 'tiktok_track_abandoned') key = 'tiktokTrackAbandoned';
        else if (k === 'tiktok_conversion_event') key = 'tiktokConversionEvent';
        else if (k === 'internal_store_name') key = 'internalStoreName';
        else if (k === 'internal_store_image') key = 'internalStoreImage';
        else if (k === 'admin_email') key = 'adminEmail';
        else if (k === 'admin_password') key = 'adminPassword';
        else if (k === 'thanks_title') key = 'thanksTitle';
        else if (k === 'thanks_message') key = 'thanksMessage';

        config[key] = v;
      }
    });
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  next();
});

// Middleware لحماية المسارات المشفرة
function requireAuth(req, res, next) {
  if (req.session.isLoggedIn) {
    return next();
  }
  res.redirect('/login');
}

function slugify(text) {
  return (text || 'product').toString().toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0400-\u04FF\-]+/g, '') || 'product-' + Date.now();
}

// --- الصفحات العامة ---
app.get('/', async (req, res) => {
  const products = await db.products.all();
  res.render('index', { products, config });
});

app.get('/product/:slug', async (req, res) => {
  const product = await db.products.getBySlug(req.params.slug);
  if (!product) return res.status(404).render('404', { config });
  res.render('product', { product, config });
});

app.post('/order', async (req, res) => {
  console.log('[Order Received] Data:', req.body);
  const body = req.body;

  // التعرف على الاسم والهاتف بشكل مرن
  let customer_name = body.customer_name || '';
  let customer_phone = body.customer_phone || '';

  // إذا لم نجد الهاتف بالاسم المعتاد، نبحث عن أول حقل يبدأ بـ field_
  if (!customer_phone) {
    const phoneKey = Object.keys(body).find(k => k.startsWith('field_'));
    if (phoneKey) customer_phone = body[phoneKey];
  }

  if (customer_name && customer_phone) {
    console.log('[Order Processing] Validating product...');
    const product_id = body.product_id;
    const p = await db.products.getById(product_id);
    const price = parseFloat(body.product_price) || (p ? p.price : 0);

    const extra = { ...body };
    // تنظيف البيانات الإضافية
    ['customer_name', 'customer_phone', 'product_id', 'product_name', 'product_price', 'return_url'].forEach(k => delete extra[k]);
    // مسح أي حقل field_ تم استخدامه كـ phone
    Object.keys(extra).forEach(k => { if (extra[k] === customer_phone) delete extra[k]; });

    await db.orders.add({
      customer_name,
      customer_phone,
      product_id: parseInt(product_id),
      product_name: body.product_name || '',
      product_price: price,
      form_data: extra
    });
  } else {
    console.warn('[Order Rejected] Missing name or phone. Name:', customer_name, 'Phone:', customer_phone);
  }
  res.redirect('/thanks');
});

app.get('/thanks', (req, res) => {
  res.render('thanks', { config });
});

app.get('/admin', requireAuth, async (req, res) => {
  const products = await db.products.all();
  const orders = await db.orders.all();
  const revenue = orders.filter(o => ['shipped', 'delivered'].includes(o.status) && (o.product_price || 0)).reduce((s, o) => s + (o.product_price || 0), 0);
  res.render('admin-dashboard', { products, orders, revenue, config });
});

app.get('/admin/products', requireAuth, async (req, res) => {
  const products = await db.products.all();
  res.render('admin-products', { products, config });
});

app.get('/admin/orders', requireAuth, async (req, res) => {
  const orders = await db.orders.all();
  res.render('admin-orders', { orders, config });
});

app.get('/admin/settings', requireAuth, (req, res) => {
  res.render('admin-settings', { config });
});

// --- مسارات تسجيل الدخول ---
app.get('/login', (req, res) => {
  if (req.session.isLoggedIn) return res.redirect('/admin');
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const dbEmail = db.settings.get('admin_email') || 'admin@store.com';
  const dbPassword = db.settings.get('admin_password') || 'admin123';

  if (email === dbEmail && password === dbPassword) {
    req.session.isLoggedIn = true;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'بيانات الدخول غير صحيحة' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// رفع صورة للوصف (من محرر وصف المنتج) — يحفظ الملف في مجلد uploads فقط
function sendJson(res, status, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(obj);
}
app.get('/admin/upload-description-image', requireAuth, (req, res) => {
  sendJson(res, 405, { error: 'استخدم طريقة POST لرفع الصورة' });
});
app.post('/admin/upload-description-image', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (res.headersSent) return;
    try {
      if (err) return sendJson(res, 400, { error: err.message || 'خطأ في رفع الملف' });
      if (!req.file) return sendJson(res, 400, { error: 'لم تُرفع أي صورة. اختر ملف صورة.' });
      sendJson(res, 200, { url: '/uploads/' + req.file.filename });
    } catch (e) {
      if (!res.headersSent) sendJson(res, 500, { error: 'خطأ داخلي في الخادم' });
    }
  });
});

// حفظ إعدادات منشئ النماذج (form_config)
app.post('/admin/form-config', requireAuth, async (req, res) => {
  try {
    const { store_name, currency, form_config_json } = req.body;

    if (store_name) {
      await db.settings.set('store_name', store_name);
      config.storeName = store_name;
    }

    if (currency) {
      await db.settings.set('currency', currency);
      config.currency = currency;
    }

    if (form_config_json) {
      const parsed = JSON.parse(form_config_json);
      await db.settings.set('form_config', parsed);
      config.formConfig = parsed;
      console.log('[Form Config] Fields updated:', parsed.fields.length);
    }
  } catch (e) {
    console.error('invalid form_config update', e);
  }
  res.redirect('/admin/settings');
});

// إضافة منتج (مع رفع صورة أو رابط)
app.post('/admin/products', requireAuth, upload.single('image'), async (req, res) => {
  const { name, description, price, image_url, stock } = req.body;
  let image = image_url || '';
  if (req.file) image = '/uploads/' + req.file.filename;
  let slug = slugify(name || 'product');
  const exists = await db.products.getBySlug(slug);
  if (exists) slug = slug + '-' + Date.now();
  await db.products.add({
    name: name || '',
    slug,
    description: description || '',
    price: parseFloat(price) || 0,
    image,
    stock: parseInt(stock) || 0
  });
  res.redirect('/admin/products');
});

app.post('/admin/products/:id/delete', requireAuth, async (req, res) => {
  await db.products.delete(req.params.id);
  res.redirect('/admin/products');
});

app.post('/admin/orders/:id/status', requireAuth, async (req, res) => {
  await db.orders.updateStatus(req.params.id, req.body.status || 'new');
  res.redirect('/admin/orders');
});

// تحديث الإعدادات
app.post('/admin/settings', requireAuth, upload.single('internal_store_image_file'), async (req, res) => {
  const {
    // Basic Settings
    store_name, currency, whatsapp_number, store_email,
    // Thank You Page
    thanks_title, thanks_message,
    // Identity & Admin Auth
    internal_store_name, internal_store_image, admin_email, admin_password,
    // Domain & Supabase
    supabase_url, supabase_anon_key,
    // Facebook Pixel
    facebook_pixel, facebook_pixel_name, facebook_token, facebook_pixel_enabled, facebook_track_abandoned, facebook_conversion_event, facebook_test_mode, facebook_test_code,
    // TikTok Pixel
    tiktok_pixel, tiktok_pixel_name, tiktok_pixel_enabled, tiktok_track_abandoned, tiktok_conversion_event
  } = req.body;

  try {
    // Handle Logo Upload
    if (req.file) {
      const internalImg = '/uploads/' + req.file.filename;
      await db.settings.set('internal_store_image', internalImg);
      config.internalStoreImage = internalImg;
    } else if (internal_store_image !== undefined) {
      await db.settings.set('internal_store_image', internal_store_image);
      config.internalStoreImage = internal_store_image;
    }

    if (admin_email) {
      await db.settings.set('admin_email', admin_email);
      config.adminEmail = admin_email;
    }
    if (admin_password) {
      await db.settings.set('admin_password', admin_password);
      config.adminPassword = admin_password;
    }
    if (thanks_title) {
      await db.settings.set('thanks_title', thanks_title);
      config.thanksTitle = thanks_title;
    }
    if (thanks_message) {
      await db.settings.set('thanks_message', thanks_message);
      config.thanksMessage = thanks_message;
    }

    await db.settings.set('internal_store_name', internal_store_name || '');
    config.internalStoreName = internal_store_name || '';

    await db.settings.set('currency', currency || 'BGN');
    config.currency = currency || 'BGN';

    await db.settings.set('facebook_pixel', facebook_pixel || '');
    config.facebookPixelId = facebook_pixel || '';

    await db.settings.set('tiktok_pixel', tiktok_pixel || '');
    config.tiktokPixelId = tiktok_pixel || '';

    await db.settings.set('whatsapp_number', whatsapp_number || '');
    config.whatsappNumber = whatsapp_number || '';

    await db.settings.set('store_email', store_email || '');
    config.storeEmail = store_email || '';

    await db.settings.set('store_name', store_name || config.storeName || '');
    config.storeName = store_name || config.storeName || '';

    await db.settings.set('supabase_url', supabase_url || '');
    config.supabaseUrl = supabase_url || '';

    await db.settings.set('supabase_anon_key', supabase_anon_key || '');
    config.supabaseAnonKey = supabase_anon_key || '';

    // Facebook Specific
    const fbEnabled = facebook_pixel_enabled === 'on';
    const fbTrackAb = facebook_track_abandoned === 'on';
    const fbTestMode = facebook_test_mode === 'on';

    await db.settings.set('facebook_pixel_name', facebook_pixel_name || '');
    await db.settings.set('facebook_token', facebook_token || '');
    await db.settings.set('facebook_pixel_enabled', fbEnabled);
    await db.settings.set('facebook_track_abandoned', fbTrackAb);
    await db.settings.set('facebook_conversion_event', facebook_conversion_event || 'Purchase');
    await db.settings.set('facebook_test_mode', fbTestMode);
    await db.settings.set('facebook_test_code', facebook_test_code || '');

    Object.assign(config, {
      facebookPixelName: facebook_pixel_name || '',
      facebookToken: facebook_token || '',
      facebookPixelEnabled: fbEnabled,
      facebookTrackAbandoned: fbTrackAb,
      facebookConversionEvent: facebook_conversion_event || 'Purchase',
      facebookTestMode: fbTestMode,
      facebookTestCode: facebook_test_code || ''
    });

    // TikTok Specific
    const tkEnabled = tiktok_pixel_enabled === 'on';
    const tkTrackAb = tiktok_track_abandoned === 'on';

    await db.settings.set('tiktok_pixel_name', tiktok_pixel_name || '');
    await db.settings.set('tiktok_pixel_enabled', tkEnabled);
    await db.settings.set('tiktok_track_abandoned', tkTrackAb);
    await db.settings.set('tiktok_conversion_event', tiktok_conversion_event || 'Purchase');

    Object.assign(config, {
      tiktokPixelName: tiktok_pixel_name || '',
      tiktokPixelEnabled: tkEnabled,
      tiktokTrackAbandoned: tkTrackAb,
      tiktokConversionEvent: tiktok_conversion_event || 'Purchase'
    });

  } catch (e) {
    console.error('[Admin Settings Update] Error:', e);
  }

  res.redirect('/admin/settings');
});

// --- إدارة المتاجر المتعددة (Global Config based) ---

function saveGlobalConfig() {
  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// 1. إنشاء نسخة (Clone)
app.post('/admin/stores/create', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'اسم المتجر مطلوب' });

  try {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-') || Date.now().toString();
    const newDataFile = `store_${slug}.json`;
    const activeFile = config.activeStoreFile || 'store.json';
    const sourcePath = path.join(__dirname, 'data', activeFile);
    const destPath = path.join(__dirname, 'data', newDataFile);

    if (!fs.existsSync(sourcePath)) throw new Error('ملف المصدر غير موجود');

    // نسخ وتصفير الطلبات
    fs.copyFileSync(sourcePath, destPath);
    const newData = JSON.parse(fs.readFileSync(destPath, 'utf8'));
    newData.orders = []; // المتجر الجديد يبدأ بصفر طلبات
    fs.writeFileSync(destPath, JSON.stringify(newData, null, 2));

    // تحديث القائمة العالمية في config.json
    let stores = [];
    try {
      stores = typeof config.storesList === 'string' ? JSON.parse(config.storesList) : (config.storesList || []);
    } catch (e) { stores = []; }

    stores.push({ id: slug, name, file: newDataFile, created_at: new Date().toISOString() });
    config.storesList = JSON.stringify(stores);
    saveGlobalConfig();

    res.json({ success: true, message: 'تم إنشاء المتجر بنجاح وبسجل طلبات نظيف' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. التبديل
app.post('/admin/stores/switch', requireAuth, async (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ success: false, message: 'الملف مطلوب' });

  try {
    const filePath = path.join(__dirname, 'data', file);
    if (!fs.existsSync(filePath)) throw new Error('الملف غير موجود');

    config.activeStoreFile = file;
    saveGlobalConfig();
    await db.init(file);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. الحذف
app.post('/admin/stores/delete', requireAuth, async (req, res) => {
  const { id } = req.body;
  try {
    let stores = [];
    try {
      stores = typeof config.storesList === 'string' ? JSON.parse(config.storesList) : (config.storesList || []);
    } catch (e) { stores = []; }

    const store = stores.find(s => s.id === id);
    if (!store) throw new Error('المتجر غير موجود');
    if (config.activeStoreFile === store.file) throw new Error('لا يمكنك حذف المتجر النشط حالياً');

    // حذف الملف الفعلي
    const filePath = path.join(__dirname, 'data', store.file);
    if (fs.existsSync(filePath) && store.file !== 'store.json') fs.unlinkSync(filePath);

    // تحديث القائمة
    config.storesList = JSON.stringify(stores.filter(s => s.id !== id));
    saveGlobalConfig();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.use((req, res) => res.status(404).render('404', { config }));

db.init(config.activeStoreFile || 'store.json').catch(err => {
  console.error('!!! خطأ حرج في قاعدة البيانات !!!', err);
}).finally(() => {
  app.listen(PORT, () => {
    console.log(`متجرك يعمل على: http://localhost:${PORT}`);
  });
});
