// ============================================================
// app.js — SouqSaaS Production Application
// Vanilla JS | Multi-tenant | Supabase | PWA
// ============================================================

'use strict';

// ── CONFIG — Replace with your Supabase project values ──────
const SUPABASE_URL     = 'https://oawtdxkylwujcvdzfasn.supabase.co/rest/v1/';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hd3RkeGt5bHd1amN2ZHpmYXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MjMxMjcsImV4cCI6MjA5MjA5OTEyN30.1BvWh200IjumJ5v2JLh0bSZNhIgzQLrTrDSr_EJfFAQ';
const EDGE_BASE        = `${SUPABASE_URL}/functions/v1`;

// ── Supabase Client ──────────────────────────────────────────
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ── IndexedDB — Offline Cache ────────────────────────────────
const DB_NAME    = 'SouqOfflineDB';
const DB_VERSION = 2;

let _idb = null;

function openIDB() {
  return new Promise((res, rej) => {
    if (_idb) return res(_idb);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      ['parties','invoices','payments','ledger_entries'].forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      });
      if (!db.objectStoreNames.contains('sync_queue')) {
        const sq = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
        sq.createIndex('created_at', 'created_at');
      }
    };
    req.onsuccess = (e) => { _idb = e.target.result; res(_idb); };
    req.onerror   = () => rej(req.error);
  });
}

function idbPut(store, record) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const r  = tx.objectStore(store).put(record);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }));
}

function idbGetAll(store) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r  = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }));
}

function idbAddToQueue(item) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const r  = tx.objectStore('sync_queue').add({ ...item, created_at: Date.now(), retries: 0 });
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }));
}

function idbDeleteQueue(id) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    tx.objectStore('sync_queue').delete(id).onsuccess = res;
  }));
}

function idbGetQueue() {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('sync_queue', 'readonly');
    const r  = tx.objectStore('sync_queue').getAll();
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  }));
}

// ── State ────────────────────────────────────────────────────
const State = {
  user:       null,
  session:    null,
  shop:       null,
  shops:      [],
  parties:    [],
  invoices:   [],
  payments:   [],
  isOnline:   navigator.onLine,
  currentPartyType: 'customer',
  currentInvoiceFilter: 'all',
};

// ── Utility ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split('T')[0];
const uuid  = () => crypto.randomUUID();

function showEl(id) { $(id)?.classList.remove('hidden'); }
function hideEl(id) { $(id)?.classList.add('hidden'); }

// Toast notifications
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// Edge Function caller with auth + offline queue
async function callEdge(path, body, queueOnFail = false) {
  const { data: { session } } = await _sb.auth.getSession();
  if (!session) throw new Error('غير مسجّل الدخول');

  if (!State.isOnline && queueOnFail) {
    await idbAddToQueue({ url: `${EDGE_BASE}/${path}`, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body });
    toast('تم الحفظ محلياً — سيُزامَن عند الاتصال', 'info');
    return { queued: true };
  }

  const res = await fetch(`${EDGE_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطأ في الخادم');
  return data;
}

// Supabase query with offline fallback
async function sbQuery(table, query, cacheKey = null) {
  if (!State.isOnline && cacheKey) {
    return idbGetAll(cacheKey);
  }
  const { data, error } = await query;
  if (error) throw error;

  if (cacheKey && data) {
    data.forEach(r => idbPut(cacheKey, r).catch(() => {}));
  }
  return data || [];
}

// ── PWA & Connectivity ────────────────────────────────────────
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then(reg => {
        navigator.serviceWorker.addEventListener('message', e => {
          if (e.data.type === 'SYNC_SUCCESS') toast('تمت مزامنة البيانات ✓', 'success');
          if (e.data.type === 'SYNC_FAILED')  toast('فشل المزامنة — سيُعاد المحاولة', 'error');
        });
      })
      .catch(e => console.warn('SW registration failed:', e));
  }

  window.addEventListener('online',  () => { State.isOnline = true;  updateConnectivity(); processSyncQueue(); });
  window.addEventListener('offline', () => { State.isOnline = false; updateConnectivity(); });
}

function updateConnectivity() {
  if (State.isOnline) {
    $('offline-badge')?.classList.remove('show');
  } else {
    $('offline-badge')?.classList.add('show');
  }
}

async function processSyncQueue() {
  const queue = await idbGetQueue();
  if (!queue.length) return;

  const { data: { session } } = await _sb.auth.getSession();
  if (!session) return;

  for (const item of queue) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { ...item.headers, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(item.body),
      });
      if (res.ok) {
        await idbDeleteQueue(item.id);
        toast('تمت مزامنة حركة مالية ✓', 'success');
      }
    } catch (e) {
      console.warn('Sync queue item failed:', e);
    }
  }
}

// ── App namespace ─────────────────────────────────────────────
const App = {};

// ── AUTH ──────────────────────────────────────────────────────
App.Auth = {
  showTab(tab) {
    ['login','register'].forEach(t => {
      $(`tab-${t}`)?.classList.toggle('hidden', t !== tab);
    });
    document.querySelectorAll('.auth-tab').forEach((btn, i) => {
      btn.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
    });
  },

  async login() {
    const email    = $('login-email')?.value.trim();
    const password = $('login-password')?.value;
    if (!email || !password) { toast('يرجى إدخال البريد وكلمة المرور', 'error'); return; }

    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) { toast(error.message, 'error'); return; }

    State.user    = data.user;
    State.session = data.session;
    await App.bootstrap();
  },

  async register() {
    const name     = $('reg-name')?.value.trim();
    const email    = $('reg-email')?.value.trim();
    const password = $('reg-password')?.value;
    const shopName = $('reg-shop')?.value.trim();

    if (!name || !email || !password || !shopName) { toast('يرجى ملء جميع الحقول', 'error'); return; }
    if (password.length < 8) { toast('كلمة المرور 8 أحرف على الأقل', 'error'); return; }

    const { data, error } = await _sb.auth.signUp({
      email, password,
      options: { data: { full_name: name } }
    });
    if (error) { toast(error.message, 'error'); return; }

    if (data.session) {
      State.user    = data.user;
      State.session = data.session;
      // Create first shop
      await App.Shops.create(shopName);
      await App.bootstrap();
    } else {
      toast('تم الإرسال — تحقق من بريدك الإلكتروني', 'success');
    }
  },

  async logout() {
    await _sb.auth.signOut();
    State.user = null; State.session = null; State.shop = null;
    hideEl('app');
    showEl('auth-screen');
  }
};

// ── SHOPS ─────────────────────────────────────────────────────
App.Shops = {
  async loadMyShops() {
    const { data, error } = await _sb
      .from('memberships')
      .select('shop_id, role, shops(*)')
      .eq('user_id', State.user.id)
      .eq('is_active', true);

    if (error) throw error;
    State.shops = (data || []).map(m => ({ ...m.shops, role: m.role }));
    return State.shops;
  },

  async create(name) {
    const slug = name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now().toString(36);
    const { data, error } = await _sb.from('shops').insert({
      name, slug, owner_id: State.user.id
    }).select().single();
    if (error) throw error;
    return data;
  },

  setCurrent(shop) {
    State.shop = shop;
    if ($('topbar-shop-name')) $('topbar-shop-name').textContent = shop.name;
    if ($('topbar-plan'))      $('topbar-plan').textContent      = { free: 'مجاني', starter: 'ستارتر', pro: 'برو', enterprise: 'إنتربرايز' }[shop.plan] || shop.plan;
  }
};

// ── BOOTSTRAP ─────────────────────────────────────────────────
App.bootstrap = async function () {
  try {
    const shops = await App.Shops.loadMyShops();
    if (!shops.length) {
      const name = prompt('لم يتم العثور على محل. أدخل اسم المحل:') || 'سوقي';
      const s = await App.Shops.create(name);
      shops.push(s);
    }

    App.Shops.setCurrent(shops[0]);

    hideEl('auth-screen');
    showEl('app');

    // Load initial data
    await Promise.all([
      App.Parties.loadAll(),
      App.Dashboard.load(),
    ]);

    // Subscribe to realtime changes
    App.Realtime.init();

  } catch (e) {
    toast(e.message, 'error');
    console.error('Bootstrap error:', e);
  }
};

// ── NAVIGATION ────────────────────────────────────────────────
App.Nav = {
  go(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    $(`page-${page}`)?.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });

    // Lazy-load page data
    switch(page) {
      case 'dashboard': App.Dashboard.load(); break;
      case 'parties':   App.Parties.render(); break;
      case 'invoices':  App.Invoices.loadAll(); break;
      case 'payments':  App.Payments.loadAll(); break;
    }
  }
};

// ── DASHBOARD ─────────────────────────────────────────────────
App.Dashboard = {
  async load() {
    if (!State.shop) return;
    try {
      await Promise.all([
        this.loadStats(),
        this.loadRecentInvoices(),
      ]);
    } catch(e) { console.error('Dashboard load error:', e); }
  },

  async loadStats() {
    const shop = State.shop;

    // Cash balance
    const { data: cashData } = await _sb.rpc('get_account_balance', {
      p_shop_id: shop.id, p_acct_type: 'cash', p_acct_id: null
    });
    if ($('stat-cash')) $('stat-cash').textContent = fmt(cashData) + ' ج';

    // Today's sales
    const { data: salesData } = await _sb
      .from('invoices')
      .select('total_amount')
      .eq('shop_id', shop.id)
      .eq('invoice_type', 'sale')
      .eq('status', 'confirmed')
      .eq('invoice_date', today());

    const totalSales = (salesData || []).reduce((s, r) => s + Number(r.total_amount), 0);
    if ($('stat-sales')) $('stat-sales').textContent = fmt(totalSales) + ' ج';

    // Customer AR
    const { data: arData } = await _sb.rpc('get_account_balance', {
      p_shop_id: shop.id, p_acct_type: 'customer', p_acct_id: null
    });
    if ($('stat-customer-ar')) $('stat-customer-ar').textContent = fmt(arData) + ' ج';

    // Supplier AP (show absolute, it's a liability)
    const { data: apData } = await _sb.rpc('get_account_balance', {
      p_shop_id: shop.id, p_acct_type: 'supplier', p_acct_id: null
    });
    if ($('stat-supplier-ap')) $('stat-supplier-ap').textContent = fmt(Math.abs(apData)) + ' ج';
  },

  async loadRecentInvoices() {
    const { data } = await _sb
      .from('invoices')
      .select('id, invoice_number, invoice_type, status, total_amount, invoice_date, parties(name)')
      .eq('shop_id', State.shop.id)
      .order('created_at', { ascending: false })
      .limit(5);

    const el = $('recent-invoices');
    if (!el) return;

    if (!data?.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>لا توجد فواتير بعد</p></div>';
      return;
    }

    el.innerHTML = data.map(inv => `
      <div class="list-item" onclick="App.Invoices.viewDetail('${inv.id}')">
        <div class="list-avatar">${inv.invoice_type === 'sale' ? '🛒' : '📦'}</div>
        <div class="list-body">
          <div class="list-name">${inv.invoice_number}</div>
          <div class="list-sub">${inv.parties?.name || 'بدون طرف'} · ${inv.invoice_date}</div>
        </div>
        <div class="list-amount">
          <div class="num ${inv.invoice_type === 'sale' ? 'text-green' : ''}">${fmt(inv.total_amount)}</div>
          <div style="text-align:left">${App.Invoices.statusBadge(inv.status)}</div>
        </div>
      </div>
    `).join('');
  }
};

// ── PARTIES ───────────────────────────────────────────────────
App.Parties = {
  filtered: [],

  async loadAll() {
    if (!State.shop) return;
    const data = await sbQuery(
      'parties',
      _sb.from('parties').select('*').eq('shop_id', State.shop.id).eq('is_active', true).order('name'),
      'parties'
    );
    State.parties = data;
    this.render();
  },

  setType(type) {
    State.currentPartyType = type;
    document.querySelectorAll('.party-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    this.render();
  },

  search(q) {
    this.render(q);
  },

  render(q = '') {
    const filtered = State.parties.filter(p => {
      const matchType = p.party_type === State.currentPartyType;
      const matchQ    = !q || p.name.includes(q) || (p.phone || '').includes(q);
      return matchType && matchQ;
    });

    const el = $('parties-list');
    if (!el) return;

    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">${State.currentPartyType === 'customer' ? '👤' : '🏭'}</div><p>لا توجد ${State.currentPartyType === 'customer' ? 'عملاء' : 'موردون'}</p></div>`;
      return;
    }

    el.innerHTML = filtered.map(p => `
      <div class="list-item" onclick="App.Parties.openEdit('${p.id}')">
        <div class="list-avatar">${p.name.charAt(0)}</div>
        <div class="list-body">
          <div class="list-name">${p.name}</div>
          <div class="list-sub">${p.phone || 'بدون هاتف'}</div>
        </div>
        <div class="list-amount">
          <div class="num" style="font-size:0.78rem;color:var(--text-muted)">الرصيد</div>
          <div class="num" id="party-bal-${p.id}">—</div>
        </div>
      </div>
    `).join('');

    // Load balances asynchronously
    filtered.forEach(p => this.loadBalance(p));
  },

  async loadBalance(party) {
    const el = $(`party-bal-${party.id}`);
    if (!el) return;
    try {
      const { data } = await _sb.rpc('get_account_balance', {
        p_shop_id: State.shop.id,
        p_acct_type: party.party_type,
        p_acct_id: party.id,
      });
      const bal = Number(data || 0);
      el.textContent = fmt(Math.abs(bal)) + ' ج';
      el.className   = 'num ' + (bal > 0 ? 'text-green' : bal < 0 ? 'text-red' : '');
    } catch { el.textContent = '—'; }
  },

  openNew() {
    $('party-id').value    = '';
    $('party-type').value  = State.currentPartyType;
    $('party-name').value  = '';
    $('party-phone').value = '';
    $('party-notes').value = '';
    $('party-commission').value = '';
    $('party-sheet-title').textContent = 'إضافة طرف جديد';
    App.openOverlay('party');
  },

  openEdit(id) {
    const p = State.parties.find(x => x.id === id);
    if (!p) return;
    $('party-id').value          = p.id;
    $('party-type').value        = p.party_type;
    $('party-name').value        = p.name;
    $('party-phone').value       = p.phone || '';
    $('party-notes').value       = p.notes || '';
    $('party-commission').value  = p.commission_rate ? (p.commission_rate * 100).toFixed(1) : '';
    $('party-sheet-title').textContent = 'تعديل: ' + p.name;
    App.openOverlay('party');
  },

  async save() {
    const id    = $('party-id')?.value;
    const name  = $('party-name')?.value.trim();
    const type  = $('party-type')?.value;
    const phone = $('party-phone')?.value.trim();
    const notes = $('party-notes')?.value.trim();
    const comm  = parseFloat($('party-commission')?.value) || null;

    if (!name) { toast('الاسم مطلوب', 'error'); return; }

    const payload = {
      shop_id:         State.shop.id,
      party_type:      type,
      name,
      phone:           phone || null,
      notes:           notes || null,
      commission_rate: comm ? comm / 100 : null,
      is_active:       true,
    };

    let error;
    if (id) {
      ({ error } = await _sb.from('parties').update(payload).eq('id', id));
    } else {
      ({ error } = await _sb.from('parties').insert(payload));
    }

    if (error) { toast(error.message, 'error'); return; }

    toast('تم الحفظ ✓', 'success');
    App.closeOverlay('party');
    await this.loadAll();
  },

  getByType(type) {
    return State.parties.filter(p => p.party_type === type && p.is_active);
  }
};

// ── INVOICES ──────────────────────────────────────────────────
App.Invoices = {
  currentItems: [],

  statusBadge(status) {
    const map = {
      draft:     '<span class="badge badge-yellow">مسودة</span>',
      confirmed: '<span class="badge badge-green">مؤكدة</span>',
      settled:   '<span class="badge badge-blue">مسواة</span>',
      cancelled: '<span class="badge badge-red">ملغاة</span>',
      void:      '<span class="badge badge-gray">باطلة</span>',
    };
    return map[status] || status;
  },

  typeName(t) {
    return { sale:'بيع', purchase:'شراء', return_in:'مرتجع وارد', return_out:'مرتجع صادر' }[t] || t;
  },

  setFilter(f) {
    State.currentInvoiceFilter = f;
    document.querySelectorAll('.inv-type-btn').forEach(b => b.classList.toggle('active', b.dataset.t === f));
    this.loadAll();
  },

  async loadAll() {
    if (!State.shop) return;
    let q = _sb.from('invoices')
      .select('*, parties(name)')
      .eq('shop_id', State.shop.id)
      .order('invoice_date', { ascending: false })
      .limit(50);

    if (State.currentInvoiceFilter !== 'all') {
      q = q.eq('invoice_type', State.currentInvoiceFilter);
    }

    const { data } = await q;
    State.invoices = data || [];
    this.render();
  },

  render() {
    const el = $('invoices-list');
    if (!el) return;

    if (!State.invoices.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>لا توجد فواتير</p></div>';
      return;
    }

    el.innerHTML = State.invoices.map(inv => `
      <div class="list-item" onclick="App.Invoices.viewDetail('${inv.id}')">
        <div class="list-avatar">${inv.invoice_type === 'sale' ? '🛒' : '📦'}</div>
        <div class="list-body">
          <div class="list-name">${inv.invoice_number} <span class="badge badge-gray text-xs">${this.typeName(inv.invoice_type)}</span></div>
          <div class="list-sub">${inv.parties?.name || '—'} · ${inv.invoice_date}</div>
        </div>
        <div class="list-amount">
          <div class="num font-bold">${fmt(inv.total_amount)} ج</div>
          <div style="text-align:left;margin-top:2px">${this.statusBadge(inv.status)}</div>
        </div>
      </div>
    `).join('');
  },

  openNew(type = 'sale') {
    this.currentItems = [];
    $('inv-id').value = '';
    $('inv-type').value = type;
    $('inv-date').value = today();
    $('inv-notes').value = '';
    $('inv-confirm-btn').style.display = 'none';
    this.onTypeChange();
    this.renderItems();
    this.addItem();
    App.openOverlay('invoice');
  },

  onTypeChange() {
    const type = $('inv-type')?.value;
    const partyLabel = $('inv-party-label');
    const partySelect = $('inv-party');

    const isSupplier = type === 'purchase' || type === 'return_out';
    if (partyLabel) partyLabel.textContent = isSupplier ? 'المورد' : 'العميل';

    const parties = App.Parties.getByType(isSupplier ? 'supplier' : 'customer');
    if (partySelect) {
      partySelect.innerHTML = '<option value="">— اختر —</option>' +
        parties.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    this.calcTotals();
  },

  addItem() {
    const tpl = document.getElementById('inv-item-tpl');
    if (!tpl) return;
    const clone = tpl.content.cloneNode(true);
    const idx   = this.currentItems.length;
    this.currentItems.push({});
    const div = clone.querySelector('.inv-item-row');
    div.dataset.index = idx;
    $('inv-items-list')?.appendChild(clone);
  },

  removeItem(btn) {
    btn.closest('.inv-item-row')?.remove();
    this.calcTotals();
  },

  getItemsFromDOM() {
    const rows = document.querySelectorAll('.inv-item-row');
    return Array.from(rows).map(row => ({
      product_name:   row.querySelector('.item-product')?.value.trim() || '',
      quantity:       parseFloat(row.querySelector('.item-qty')?.value) || 0,
      unit_price:     parseFloat(row.querySelector('.item-price')?.value) || 0,
      cost_transport: parseFloat(row.querySelector('.item-transport')?.value) || 0,
      cost_loading:   parseFloat(row.querySelector('.item-loading')?.value) || 0,
      cost_stacking:  parseFloat(row.querySelector('.item-stacking')?.value) || 0,
      cost_gate:      parseFloat(row.querySelector('.item-gate')?.value) || 0,
      cost_other:     0,
      unit:           'صندوق',
      shop_id:        State.shop.id,
    })).filter(i => i.product_name && i.quantity > 0);
  },

  calcTotals() {
    const items = this.getItemsFromDOM();
    const shop  = State.shop;

    // Get selected party commission rate
    const partyId = $('inv-party')?.value;
    const party   = State.parties.find(p => p.id === partyId);
    const invType = $('inv-type')?.value;

    let commRate = shop?.commission_rate ?? 0.07;
    if (party?.commission_rate != null) commRate = Number(party.commission_rate);
    if (party?.account_type === 'own_account') commRate = 0;
    if (invType === 'sale') commRate = 0; // commission not applied on sales

    const subtotal   = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const expenses   = items.reduce((s, i) => s + (i.cost_transport + i.cost_loading + i.cost_stacking + i.cost_gate + i.cost_other) * i.quantity, 0);
    const commission = subtotal * commRate;
    const net        = subtotal - commission - expenses;

    if ($('inv-subtotal'))  $('inv-subtotal').textContent  = fmt(subtotal);
    if ($('inv-commission'))$('inv-commission').textContent = fmt(commission);
    if ($('inv-expenses'))  $('inv-expenses').textContent  = fmt(expenses);
    if ($('inv-net'))       $('inv-net').textContent       = fmt(net);

    // Update individual row totals
    document.querySelectorAll('.inv-item-row').forEach(row => {
      const qty   = parseFloat(row.querySelector('.item-qty')?.value) || 0;
      const price = parseFloat(row.querySelector('.item-price')?.value) || 0;
      const el    = row.querySelector('.inv-item-line-total');
      if (el) el.textContent = 'الإجمالي: ' + fmt(qty * price) + ' ج';
    });
  },

  renderItems() {
    const el = $('inv-items-list');
    if (el) el.innerHTML = '';
  },

  async save() {
    const items = this.getItemsFromDOM();
    if (!items.length) { toast('أضف صنفاً واحداً على الأقل', 'error'); return; }

    const invType = $('inv-type')?.value;
    const partyId = $('inv-party')?.value || null;
    const date    = $('inv-date')?.value || today();
    const method  = $('inv-payment-method')?.value || 'credit';
    const notes   = $('inv-notes')?.value.trim();
    const existId = $('inv-id')?.value;

    // Generate invoice number
    const { data: numData } = await _sb.rpc('next_invoice_number', { p_shop_id: State.shop.id });
    const invNumber = numData || ('INV-' + Date.now());

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const expenses = items.reduce((s, i) => s + (i.cost_transport + i.cost_loading + i.cost_stacking + i.cost_gate) * i.quantity, 0);

    let invId = existId;

    if (!existId) {
      // Create invoice
      const { data: inv, error: invErr } = await _sb.from('invoices').insert({
        shop_id:        State.shop.id,
        invoice_number: invNumber,
        invoice_type:   invType,
        party_id:       partyId,
        invoice_date:   date,
        payment_method: method,
        notes:          notes || null,
        subtotal,
        expenses_total: expenses,
        status:         'draft',
        created_by:     State.user.id,
      }).select().single();

      if (invErr) { toast(invErr.message, 'error'); return; }
      invId = inv.id;

      // Insert items
      const { error: itemsErr } = await _sb.from('invoice_items').insert(
        items.map(i => ({ ...i, invoice_id: invId }))
      );
      if (itemsErr) { toast(itemsErr.message, 'error'); return; }
    }

    toast('تم الحفظ ✓', 'success');
    $('inv-id').value = invId;
    $('inv-confirm-btn').style.display = 'block';
    await this.loadAll();
  },

  async confirm() {
    const invId = $('inv-id')?.value;
    if (!invId) { toast('احفظ الفاتورة أولاً', 'error'); return; }

    try {
      const result = await callEdge('confirm_invoice', { invoice_id: invId, shop_id: State.shop.id });
      if (result.queued) return;

      toast('تم ترحيل الفاتورة محاسبياً ✓', 'success');
      App.closeOverlay('invoice');
      await Promise.all([this.loadAll(), App.Dashboard.load()]);
    } catch(e) {
      toast(e.message, 'error');
    }
  },

  async viewDetail(id) {
    // For now open edit — in production expand to full detail sheet
    const inv = State.invoices.find(i => i.id === id);
    if (!inv) return;
    toast(`فاتورة: ${inv.invoice_number} — ${inv.status}`, 'info');
  }
};

// ── PAYMENTS ──────────────────────────────────────────────────
App.Payments = {
  async loadAll() {
    if (!State.shop) return;
    const { data } = await _sb
      .from('payments')
      .select('*, parties(name)')
      .eq('shop_id', State.shop.id)
      .order('payment_date', { ascending: false })
      .limit(50);

    State.payments = data || [];
    this.render();
    this.loadTodayTotals();
  },

  async loadTodayTotals() {
    const t = today();
    const payments = State.payments.filter(p => p.payment_date === t);
    const receipts = payments.filter(p => p.payment_type === 'customer_receipt').reduce((s, p) => s + Number(p.amount), 0);
    const expenses = payments.filter(p => ['supplier_payment','expense_payment','cash_out'].includes(p.payment_type)).reduce((s, p) => s + Number(p.amount), 0);

    if ($('pay-receipts-today')) $('pay-receipts-today').textContent = fmt(receipts) + ' ج';
    if ($('pay-expenses-today')) $('pay-expenses-today').textContent = fmt(expenses) + ' ج';
  },

  render() {
    const el = $('payments-list');
    if (!el) return;

    if (!State.payments.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><p>لا توجد حركات مالية</p></div>';
      return;
    }

    const typeIcon = { customer_receipt:'💵', supplier_payment:'📤', expense_payment:'🧾', cash_in:'💰', cash_out:'🏧' };
    const typeLabel = { customer_receipt:'قبض من عميل', supplier_payment:'صرف لمورد', expense_payment:'مصروف', cash_in:'إيداع', cash_out:'سحب' };

    el.innerHTML = State.payments.map(p => `
      <div class="list-item">
        <div class="list-avatar">${typeIcon[p.payment_type] || '💳'}</div>
        <div class="list-body">
          <div class="list-name">${typeLabel[p.payment_type] || p.payment_type}</div>
          <div class="list-sub">${p.parties?.name || p.notes || '—'} · ${p.payment_date}</div>
        </div>
        <div class="list-amount">
          <div class="num font-bold ${['customer_receipt','cash_in'].includes(p.payment_type) ? 'text-green' : 'text-red'}">${fmt(p.amount)} ج</div>
        </div>
      </div>
    `).join('');
  },

  openNew(type = 'customer_receipt') {
    $('pay-type').value   = type;
    $('pay-amount').value = '';
    $('pay-date').value   = today();
    $('pay-notes').value  = '';
    $('pay-method').value = 'cash';
    this.onTypeChange();
    App.openOverlay('payment');
  },

  onTypeChange() {
    const type     = $('pay-type')?.value;
    const partyGrp = $('pay-party-group');
    const partyLbl = $('pay-party-label');
    const partySel = $('pay-party');

    const needsParty = ['customer_receipt','supplier_payment'].includes(type);
    if (partyGrp) partyGrp.style.display = needsParty ? '' : 'none';

    if (needsParty && partySel) {
      const pType = type === 'customer_receipt' ? 'customer' : 'supplier';
      if (partyLbl) partyLbl.textContent = pType === 'customer' ? 'العميل' : 'المورد';
      const parties = App.Parties.getByType(pType);
      partySel.innerHTML = '<option value="">— اختر —</option>' +
        parties.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }
  },

  async save() {
    const type    = $('pay-type')?.value;
    const partyId = $('pay-party')?.value || null;
    const amount  = parseFloat($('pay-amount')?.value);
    const date    = $('pay-date')?.value || today();
    const method  = $('pay-method')?.value || 'cash';
    const notes   = $('pay-notes')?.value.trim();

    if (!amount || amount <= 0) { toast('أدخل مبلغاً صحيحاً', 'error'); return; }
    if (['customer_receipt','supplier_payment'].includes(type) && !partyId) {
      toast('اختر الطرف', 'error'); return;
    }

    try {
      const result = await callEdge('create_payment', {
        shop_id: State.shop.id,
        payment_type: type,
        party_id: partyId,
        amount,
        payment_method: method,
        payment_date: date,
        notes: notes || null,
      }, true);

      if (result.queued) {
        App.closeOverlay('payment');
        return;
      }

      toast('تم التسجيل ✓', 'success');
      App.closeOverlay('payment');
      await Promise.all([this.loadAll(), App.Dashboard.load()]);
    } catch(e) {
      toast(e.message, 'error');
    }
  }
};

// ── REPORTS ───────────────────────────────────────────────────
App.Reports = {
  show() {
    App.Nav.go('reports');
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    $('rep-from').value = firstDay;
    $('rep-to').value   = today();
  },

  async load() {
    const from = $('rep-from')?.value;
    const to   = $('rep-to')?.value;
    const el   = $('report-output');
    if (!from || !to || !el) return;

    el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';

    try {
      // Sales in range
      const { data: sales } = await _sb
        .from('invoices')
        .select('total_amount, commission_amt, expenses_total, invoice_type')
        .eq('shop_id', State.shop.id)
        .eq('status', 'confirmed')
        .gte('invoice_date', from)
        .lte('invoice_date', to);

      const totalSales     = (sales || []).filter(i => i.invoice_type === 'sale').reduce((s, i) => s + Number(i.total_amount), 0);
      const totalPurchases = (sales || []).filter(i => i.invoice_type === 'purchase').reduce((s, i) => s + Number(i.total_amount), 0);
      const totalComm      = (sales || []).filter(i => i.invoice_type === 'purchase').reduce((s, i) => s + Number(i.commission_amt), 0);
      const totalExp       = (sales || []).filter(i => i.invoice_type === 'purchase').reduce((s, i) => s + Number(i.expenses_total), 0);

      // Payments in range
      const { data: pays } = await _sb
        .from('payments')
        .select('amount, payment_type')
        .eq('shop_id', State.shop.id)
        .gte('payment_date', from)
        .lte('payment_date', to);

      const totalReceipts = (pays || []).filter(p => p.payment_type === 'customer_receipt').reduce((s, p) => s + Number(p.amount), 0);
      const totalPayments = (pays || []).filter(p => p.payment_type === 'supplier_payment').reduce((s, p) => s + Number(p.amount), 0);

      // Cash balance
      const { data: cashBal } = await _sb.rpc('get_account_balance', {
        p_shop_id: State.shop.id, p_acct_type: 'cash', p_acct_id: null
      });

      el.innerHTML = `
        <div class="card mb-3">
          <h3 class="mb-3">📊 تقرير الفترة: ${from} إلى ${to}</h3>
          <div class="totals-row"><span>إجمالي المبيعات</span><span class="num text-green">${fmt(totalSales)} ج</span></div>
          <div class="totals-row"><span>إجمالي المشتريات</span><span class="num">${fmt(totalPurchases)} ج</span></div>
          <div class="totals-row"><span>إجمالي العمولات</span><span class="num text-green">${fmt(totalComm)} ج</span></div>
          <div class="totals-row"><span>إجمالي مصاريف الصناديق</span><span class="num text-red">${fmt(totalExp)} ج</span></div>
          <div class="totals-row"><span>إجمالي المقبوضات</span><span class="num text-green">${fmt(totalReceipts)} ج</span></div>
          <div class="totals-row"><span>إجمالي المدفوعات للموردين</span><span class="num text-red">${fmt(totalPayments)} ج</span></div>
          <div class="totals-row total-final"><span>رصيد الصندوق الحالي</span><span class="num">${fmt(cashBal)} ج</span></div>
        </div>

        <button class="btn btn-ghost btn-full" onclick="App.Reports.loadPartyBalances()">
          📋 عرض أرصدة الأطراف
        </button>
        <div id="party-balances-report"></div>
      `;
    } catch(e) {
      el.innerHTML = `<div class="empty-state"><p>خطأ في تحميل التقرير: ${e.message}</p></div>`;
    }
  },

  async loadPartyBalances() {
    const el = $('party-balances-report');
    if (!el) return;
    el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';

    try {
      const { data: cust } = await _sb.rpc('get_party_balances', { p_shop_id: State.shop.id, p_party_type: 'customer' });
      const { data: supp } = await _sb.rpc('get_party_balances', { p_shop_id: State.shop.id, p_party_type: 'supplier' });

      const renderList = (list, label) => {
        if (!list?.length) return '';
        const positive = list.filter(p => Math.abs(Number(p.balance)) > 0.01);
        if (!positive.length) return '';
        return `
          <div class="section-title">${label}</div>
          ${positive.map(p => `
            <div class="list-item">
              <div class="list-avatar">${p.party_name?.charAt(0) || '?'}</div>
              <div class="list-body"><div class="list-name">${p.party_name}</div></div>
              <div class="list-amount num font-bold ${Number(p.balance) > 0 ? 'text-green' : 'text-red'}">${fmt(Math.abs(p.balance))} ج</div>
            </div>
          `).join('')}
        `;
      };

      el.innerHTML = renderList(cust, 'ذمم العملاء') + renderList(supp, 'ذمم الموردين');
    } catch(e) {
      el.innerHTML = `<p class="text-sm text-muted">خطأ: ${e.message}</p>`;
    }
  }
};

// ── REALTIME ──────────────────────────────────────────────────
App.Realtime = {
  channel: null,

  init() {
    if (!State.shop) return;

    this.channel = _sb
      .channel(`shop:${State.shop.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'invoices',
        filter: `shop_id=eq.${State.shop.id}`
      }, () => { App.Invoices.loadAll(); App.Dashboard.load(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'payments',
        filter: `shop_id=eq.${State.shop.id}`
      }, () => { App.Payments.loadAll(); App.Dashboard.load(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'parties',
        filter: `shop_id=eq.${State.shop.id}`
      }, () => App.Parties.loadAll())
      .subscribe();
  },

  destroy() {
    if (this.channel) _sb.removeChannel(this.channel);
  }
};

// ── OVERLAY HELPERS ───────────────────────────────────────────
App.openOverlay  = id => { $(`overlay-${id}`)?.classList.add('open');  document.body.style.overflow = 'hidden'; };
App.closeOverlay = id => { $(`overlay-${id}`)?.classList.remove('open'); document.body.style.overflow = ''; };

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  initPWA();
  updateConnectivity();

  // Restore session
  const { data: { session } } = await _sb.auth.getSession();
  if (session) {
    State.user    = session.user;
    State.session = session;
    await App.bootstrap();
  }

  // Set default dates
  if ($('rep-from')) $('rep-from').value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  if ($('rep-to'))   $('rep-to').value   = today();

  // Auth state changes
  _sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      State.user = null; State.shop = null;
      hideEl('app'); showEl('auth-screen');
      App.Realtime.destroy();
    }
  });

  // Party type change in sheet — toggle commission group
  $('party-type')?.addEventListener('change', function() {
    const grp = $('party-commission-group');
    if (grp) grp.style.display = this.value === 'supplier' ? '' : 'none';
  });
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
