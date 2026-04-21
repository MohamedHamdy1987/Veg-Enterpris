'use strict';

/* ================= CONFIG ================= */
const SUPABASE_URL = 'https://oawtdxkylwujcvdzfasn.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsaXh3ZG9tc2h2b2NlcnhwYW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0Mzc3MTMsImV4cCI6MjA5MjAxMzcxM30.PFSAQ4J6WBLPHiTpgED7l4JiK4jmhL82MQFuJogwZhs';

if (!window.supabase) {
  alert("❌ Supabase library not loaded");
}

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/* ================= STATE ================= */
const State = {
  user: null,
  session: null,
  shop: null,
  shops: [],
  parties: [],
  invoices: [],
  payments: [],
  currentPartyType: 'customer',
  currentInvoiceFilter: 'all'
};

/* ================= HELPERS ================= */
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().split('T')[0];
const fmt = n => Number(n || 0).toLocaleString('ar-EG');

function show(id){ $(id)?.classList.remove('hidden'); }
function hide(id){ $(id)?.classList.add('hidden'); }

function toast(msg){
  console.log(msg);
}

/* ================= AUTH ================= */
const App = {};

App.Auth = {

  showTab(tab){
    if(tab === 'login'){
      show('tab-login'); hide('tab-register');
    } else {
      show('tab-register'); hide('tab-login');
    }
  },

  async login(){
    const email = $('login-email').value;
    const password = $('login-password').value;

    const { data, error } = await _sb.auth.signInWithPassword({ email, password });

    if(error) return alert(error.message);

    State.user = data.user;
    State.session = data.session;

    await App.bootstrap();
  },

  async register(){
    const name = $('reg-name').value;
    const email = $('reg-email').value;
    const password = $('reg-password').value;

    const { data, error } = await _sb.auth.signUp({
      email,
      password,
      options:{ data:{ full_name: name } }
    });

    if(error) return alert(error.message);

    alert("تم إنشاء الحساب ✔");
  },

  async logout(){
    await _sb.auth.signOut();
    location.reload();
  }
};

/* ================= SHOPS ================= */
App.Shops = {

  async load(){
    const { data } = await _sb.from('shops').select('*').limit(1);
    State.shops = data || [];

    if(State.shops.length){
      State.shop = State.shops[0];
      if($('topbar-shop-name')) $('topbar-shop-name').innerText = State.shop.name;
    }
  }
};

/* ================= BOOTSTRAP ================= */
App.bootstrap = async function(){

  hide('auth-screen');
  show('app');

  await App.Shops.load();

  await Promise.all([
    App.Parties.load(),
    App.Invoices.load(),
    App.Payments.load(),
    App.Dashboard.load()
  ]);
};

/* ================= NAV ================= */
App.Nav = {
  go(page){
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.getElementById('page-'+page)?.classList.add('active');
  }
};

/* ================= DASHBOARD ================= */
App.Dashboard = {

  async load(){
    const { data } = await _sb.from('invoices').select('total_amount');

    const total = (data||[]).reduce((s,i)=>s+Number(i.total_amount||0),0);

    if($('stat-sales')) $('stat-sales').innerText = fmt(total);
  }
};

/* ================= PARTIES ================= */
App.Parties = {

  async load(){
    const { data } = await _sb.from('parties').select('*');
    State.parties = data || [];
    this.render();
  },

  render(){
    const el = $('parties-list');
    if(!el) return;

    el.innerHTML = State.parties.map(p=>`
      <div class="list-item">
        ${p.name}
      </div>
    `).join('');
  },

  setType(type){
    State.currentPartyType = type;
    this.render();
  },

  search(q){
    this.render();
  },

  openNew(){
    App.openOverlay('party');
  },

  async save(){
    const name = $('party-name').value;

    await _sb.from('parties').insert({
      name,
      party_type: $('party-type').value,
      shop_id: State.shop?.id
    });

    App.closeOverlay('party');
    await this.load();
  }
};

/* ================= INVOICES ================= */
App.Invoices = {

  async load(){
    const { data } = await _sb.from('invoices').select('*');
    State.invoices = data || [];
    this.render();
  },

  render(){
    const el = $('invoices-list');
    if(!el) return;

    el.innerHTML = State.invoices.map(i=>`
      <div class="list-item">
        ${i.invoice_number || 'فاتورة'} - ${fmt(i.total_amount)}
      </div>
    `).join('');
  },

  openNew(){
    App.openOverlay('invoice');
  },

  addItem(){
    const tpl = document.getElementById('inv-item-tpl');
    $('inv-items-list').appendChild(tpl.content.cloneNode(true));
  },

  getItems(){
    return [...document.querySelectorAll('.inv-item-row')].map(r=>({
      product_name: r.querySelector('.item-product').value,
      quantity: Number(r.querySelector('.item-qty').value),
      unit_price: Number(r.querySelector('.item-price').value)
    }));
  },

  calcTotals(){
    const items = this.getItems();
    const total = items.reduce((s,i)=>s+i.quantity*i.unit_price,0);
    if($('inv-subtotal')) $('inv-subtotal').innerText = fmt(total);
  },

  async save(){
    const items = this.getItems();

    const total = items.reduce((s,i)=>s+i.quantity*i.unit_price,0);

    const { data } = await _sb.from('invoices').insert({
      shop_id: State.shop.id,
      invoice_type: $('inv-type').value,
      party_id: $('inv-party').value,
      invoice_date: $('inv-date').value,
      total_amount: total
    }).select().single();

    if(data){
      await _sb.from('invoice_items').insert(
        items.map(i=>({...i, invoice_id: data.id}))
      );
    }

    App.closeOverlay('invoice');
    await this.load();
  },

  async confirm(){
    alert("تأكد من ربط Edge Function");
  }
};

/* ================= PAYMENTS ================= */
App.Payments = {

  async load(){
    const { data } = await _sb.from('payments').select('*');
    State.payments = data || [];
    this.render();
  },

  render(){
    const el = $('payments-list');
    if(!el) return;

    el.innerHTML = State.payments.map(p=>`
      <div class="list-item">
        ${fmt(p.amount)}
      </div>
    `).join('');
  },

  openNew(){
    App.openOverlay('payment');
  },

  async save(){
    await _sb.from('payments').insert({
      amount: Number($('pay-amount').value),
      payment_type: $('pay-type').value,
      shop_id: State.shop.id
    });

    App.closeOverlay('payment');
    await this.load();
  }
};

/* ================= REPORTS ================= */
App.Reports = {
  async load(){
    alert("التقارير لاحقاً");
  }
};

/* ================= OVERLAY ================= */
App.openOverlay = id=>{
  document.getElementById('overlay-'+id)?.classList.add('open');
};

App.closeOverlay = id=>{
  document.getElementById('overlay-'+id)?.classList.remove('open');
};

/* ================= INIT ================= */
async function init(){

  const { data:{ session } } = await _sb.auth.getSession();

  if(session){
    State.user = session.user;
    State.session = session;
    await App.bootstrap();
  } else {
    show('auth-screen');
  }
}

document.addEventListener('DOMContentLoaded', init);
