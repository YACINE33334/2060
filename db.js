const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
const { getSupabase } = require('./lib/supabase');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const defaultData = {
  products: [],
  orders: [],
  settings: [
    { key: 'facebook_pixel', value: '' },
    { key: 'tiktok_pixel', value: '' },
    { key: 'store_name', value: 'متجري' },
    { key: 'admin_email', value: 'admin@store.com' },
    { key: 'admin_password', value: 'admin123' },
    { key: 'whatsapp_number', value: '' },
    { key: 'store_email', value: '' },
    { key: 'currency', value: 'BGN' },
    {
      key: 'form_config',
      value: {
        fields: [
          {
            id: 'customer_name',
            name: 'الاسم الكامل',
            placeholder: 'مثلاً: محمد أحمد',
            type: 'text',
            maxLength: 50,
            required: true
          },
          {
            id: 'customer_phone',
            name: 'رقم الهاتف',
            placeholder: '05XXXXXXXX',
            type: 'number',
            maxLength: 10,
            required: true
          }
        ],
        priceStyle: {
          color: '#FF5722',
          size: 'lg',
          showOldPrice: false,
          showCurrency: true
        }
      }
    }
  ]
};

let db;
let activeFileName = 'store.json';

async function init(activeFile = 'store.json') {
  activeFileName = activeFile;
  console.log(`[DB] Initializing with file: ${activeFile}`);
  const file = path.join(dataDir, activeFile);
  const adapter = new JSONFile(file);
  db = new Low(adapter, defaultData);

  await db.read();
  if (!db.data.products) db.data.products = [];
  if (!db.data.orders) db.data.orders = [];
  if (!db.data.settings) db.data.settings = defaultData.settings;

  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const settings = db.data.settings || [];
      if (config.supabaseUrl) {
        let s = settings.find(x => x.key === 'supabase_url');
        if (s) s.value = config.supabaseUrl; else settings.push({ key: 'supabase_url', value: config.supabaseUrl });
      }
      if (config.supabaseAnonKey) {
        let s = settings.find(x => x.key === 'supabase_anon_key');
        if (s) s.value = config.supabaseAnonKey; else settings.push({ key: 'supabase_anon_key', value: config.supabaseAnonKey });
      }
    } catch (e) { }
  }

  // محاولة جلب الإعدادات من Supabase فقط للمتجر الأساسي لتجنب التداخل
  const isPrimaryStore = activeFileName === 'store.json';
  const sb = getSupabaseClient();
  if (sb && isPrimaryStore) {
    try {
      console.log('[Supabase] Fetching latest settings for Primary Store...');
      const { data, error } = await sb.from('settings').select('*');
      if (!error && data) {
        data.forEach(item => {
          const i = db.data.settings.findIndex(s => s.key === item.key);
          if (i >= 0) db.data.settings[i].value = item.value;
          else db.data.settings.push({ key: item.key, value: item.value });
        });
      }
    } catch (e) { }
  }

  await db.write();
}

function getSupabaseClient() {
  const settings = db.data.settings || [];
  const url = (settings.find(s => s.key === 'supabase_url') || {}).value || '';
  const key = (settings.find(s => s.key === 'supabase_anon_key') || {}).value || '';
  if (!url || !key) return null;
  return getSupabase({ supabaseUrl: url, supabaseAnonKey: key });
}

const dbApi = {
  products: {
    all: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb.from('products').select('*').order('created_at', { ascending: false });
        if (!error && data && data.length > 0) return data;
      }
      return [...(db.data.products || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    },
    getBySlug: async (slug) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb.from('products').select('*').eq('slug', slug).maybeSingle();
        if (!error && data) return data;
      }
      return (db.data.products || []).find(p => p.slug === slug);
    },
    getById: async (id) => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb.from('products').select('*').eq('id', parseInt(id)).maybeSingle();
        if (!error && data) return data;
      }
      return (db.data.products || []).find(p => p.id === parseInt(id));
    },
    add: async (product) => {
      const id = (db.data.products.length ? Math.max(...db.data.products.map(p => p.id)) : 0) + 1;
      const newProduct = { ...product, id, created_at: new Date().toISOString() };
      db.data.products.push(newProduct);
      await db.write();
      const sb = getSupabaseClient();
      if (sb) {
        const { id: _, ...sbData } = newProduct;
        await sb.from('products').insert([sbData]);
      }
    },
    delete: async (id) => {
      db.data.products = (db.data.products || []).filter(p => p.id !== parseInt(id));
      await db.write();
      const sb = getSupabaseClient();
      if (sb) await sb.from('products').delete().eq('id', parseInt(id));
    }
  },
  orders: {
    all: async () => {
      const sb = getSupabaseClient();
      if (sb) {
        const { data, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
        if (!error && data) return data;
      }
      return [...(db.data.orders || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    },
    add: async (order) => {
      console.log('[Order Sync] Saving to Local...');
      const id = (db.data.orders.length ? Math.max(...db.data.orders.map(o => o.id)) : 0) + 1;
      const newOrder = { ...order, id, status: 'new', created_at: new Date().toISOString() };
      db.data.orders.push(newOrder);
      await db.write();

      const sb = getSupabaseClient();
      if (sb) {
        console.log('[Order Sync] Syncing to Supabase...');
        const { id: _, ...sbData } = newOrder;
        const { error } = await sb.from('orders').insert([sbData]);
        if (error) console.error('[Supabase Error]:', error.message);
        else console.log('[Order Sync] Success');
      }
    },
    updateStatus: async (id, status) => {
      const o = (db.data.orders || []).find(or => or.id === parseInt(id));
      if (o) o.status = status;
      await db.write();
      const sb = getSupabaseClient();
      if (sb) await sb.from('orders').update({ status }).eq('id', parseInt(id));
    }
  },
  settings: {
    get: (key) => ((db.data.settings || []).find(s => s.key === key) || {}).value,
    set: async (key, value) => {
      console.log(`[Settings] Updating ${key}...`);
      const arr = db.data.settings || [];
      const i = arr.findIndex(s => s.key === key);
      if (i >= 0) arr[i].value = value; else arr.push({ key, value });
      await db.write();

      // مزامنة الإعداد مع Supabase فقط للمتجر الأساسي
      const isPrimaryStore = activeFileName === 'store.json';
      const sb = getSupabaseClient();
      if (sb && isPrimaryStore) {
        try {
          const { error } = await sb.from('settings').upsert([{ key, value }], { onConflict: 'key' });
          if (error) console.error('[Supabase Settings Error]:', error.message);
          else console.log(`[Supabase] Setting ${key} synced`);
        } catch (e) { }
      }
    }
  },
  init
};

module.exports = dbApi;
