// ================================================
// ENTERPRISE RENDERERS - عرض الصفحات والتقارير
// ================================================

window.RENDER = {

  // ---------- لوحة التحكم ----------
  dashboard() {
    const today = new Date().toISOString().split('T')[0];
    const todaySales = APP.DB.sales_log
      .filter(s => s.date?.startsWith(today))
      .reduce((sum, s) => sum + APP.N(s.total), 0);
    const todayExpenses = APP.DB.expenses
      .filter(e => e.created_at?.startsWith(today))
      .reduce((sum, e) => sum + APP.N(e.amount), 0);
    const todayCollections = APP.DB.collections
      .filter(c => c.created_at?.startsWith(today))
      .reduce((sum, c) => sum + APP.N(c.amount), 0);
    
    const lowStockProducts = APP.DB.products.filter(p => p.stock <= p.min_stock);
    const bestProduct = [...APP.DB.products].sort((a, b) => {
      const salesA = APP.DB.sales_log.filter(s => s.product_id == a.id).reduce((sum, s) => sum + APP.N(s.total), 0);
      const salesB = APP.DB.sales_log.filter(s => s.product_id == b.id).reduce((sum, s) => sum + APP.N(s.total), 0);
      return salesB - salesA;
    })[0];

    const html = `
      <h2>📊 ملخص اليوم</h2>
      <div class="grid">
        ${APP.statCard("💰 المبيعات", APP.currency(todaySales))}
        ${APP.statCard("💵 التحصيلات", APP.currency(todayCollections))}
        ${APP.statCard("📉 المصروفات", APP.currency(todayExpenses))}
        ${APP.statCard("📦 منتجات منخفضة", lowStockProducts.length)}
        ${APP.statCard("🏆 أفضل منتج", bestProduct?.name || "-")}
      </div>
      ${lowStockProducts.length > 0 ? `
        <h3>⚠️ تنبيهات المخزون</h3>
        <table class="table">
          <tr><th>المنتج</th><th>المخزون</th><th>الحد الأدنى</th></tr>
          ${lowStockProducts.map(p => `<tr><td>${p.name}</td><td>${p.stock}</td><td>${p.min_stock}</td></tr>`).join('')}
        </table>
      ` : ''}
    `;
    document.getElementById("dashboard").innerHTML = html;
  },

  // ---------- المبيعات (المنتجات) ----------
  sales() {
    const searchInput = `<input id="productSearch" placeholder="بحث عن منتج..." oninput="RENDER.filterProducts()" class="full-width">`;
    const addButton = APP.can("sales") ? `<button onclick="ACTIONS.openAddProductModal()" class="btn">➕ إضافة منتج</button>` : '';
    
    const rows = APP.DB.products.map(p => {
      const productSales = APP.DB.sales_log.filter(s => s.product_id == p.id).reduce((sum, s) => sum + APP.N(s.qty), 0);
      return `
        <tr>
          <td>${p.name}</td>
          <td>${APP.currency(p.price)}</td>
          <td>${p.stock}</td>
          <td>${productSales}</td>
          <td>
            ${p.stock > 0 ? `<button onclick="ACTIONS.openSellModal(${p.id})" class="btn-sm">بيع</button>` : '<span style="color:red">نفد</span>'}
            <button onclick="RENDER.showProductSales(${p.id})" class="btn-sm">📊</button>
          </td>
        </tr>
      `;
    }).join('');

    const html = `
      <h2>🛒 المنتجات والمبيعات</h2>
      ${addButton}
      ${searchInput}
      <table class="table" id="productsTable">
        <thead>
          <tr><th>المنتج</th><th>السعر</th><th>المخزون</th><th>الكمية المباعة</th><th>إجراءات</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    document.getElementById("sales").innerHTML = html;
    window.allProductsRows = rows; // للبحث
  },

  filterProducts() {
    const term = document.getElementById("productSearch").value.toLowerCase();
    const filtered = APP.DB.products.filter(p => p.name.toLowerCase().includes(term));
    const rows = filtered.map(p => {
      const productSales = APP.DB.sales_log.filter(s => s.product_id == p.id).reduce((sum, s) => sum + APP.N(s.qty), 0);
      return `
        <tr>
          <td>${p.name}</td>
          <td>${APP.currency(p.price)}</td>
          <td>${p.stock}</td>
          <td>${productSales}</td>
          <td>
            ${p.stock > 0 ? `<button onclick="ACTIONS.openSellModal(${p.id})" class="btn-sm">بيع</button>` : '<span style="color:red">نفد</span>'}
            <button onclick="RENDER.showProductSales(${p.id})" class="btn-sm">📊</button>
          </td>
        </tr>
      `;
    }).join('');
    document.querySelector("#productsTable tbody").innerHTML = rows;
  },

  showProductSales(productId) {
    const product = APP.DB.products.find(p => p.id == productId);
    const sales = APP.DB.sales_log.filter(s => s.product_id == productId);
    const totalQty = sales.reduce((s, x) => s + APP.N(x.qty), 0);
    const totalAmount = sales.reduce((s, x) => s + APP.N(x.total), 0);
    const html = `
      <h3>${product.name}</h3>
      <p>الكمية المباعة: ${totalQty}</p>
      <p>إجمالي المبيعات: ${APP.currency(totalAmount)}</p>
      <table class="table">
        <tr><th>التاريخ</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
        ${sales.map(s => `<tr><td>${APP.formatDate(s.date)}</td><td>${s.qty}</td><td>${APP.currency(s.price)}</td><td>${APP.currency(s.total)}</td></tr>`).join('')}
      </table>
    `;
    APP.openModal(`📊 مبيعات ${product.name}`, html, () => {});
    document.getElementById("modalSave").style.display = "none";
  },

  // ---------- العملاء ----------
  customers() {
    const addButton = APP.can("customers") ? `<button onclick="ACTIONS.openAddCustomerModal()" class="btn">➕ إضافة عميل</button>` : '';
    const searchInput = `<input id="customerSearch" placeholder="بحث..." oninput="RENDER.filterCustomers()" class="full-width">`;
    
    const rows = APP.DB.customers.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.phone || '-'}</td>
        <td style="color:${c.balance > 0 ? 'red' : 'green'}">${APP.currency(c.balance)}</td>
        <td>
          <button onclick="ACTIONS.shareCustomer(${c.id})">📤</button>
          <button onclick="RENDER.showCustomerStatement(${c.id})">📋</button>
        </td>
      </tr>
    `).join('');

    const html = `
      <h2>👥 العملاء</h2>
      ${addButton}
      ${searchInput}
      <table class="table" id="customersTable">
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    document.getElementById("customers").innerHTML = html;
  },

  filterCustomers() {
    const term = document.getElementById("customerSearch").value.toLowerCase();
    const filtered = APP.DB.customers.filter(c => c.name.toLowerCase().includes(term) || (c.phone && c.phone.includes(term)));
    const rows = filtered.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.phone || '-'}</td>
        <td style="color:${c.balance > 0 ? 'red' : 'green'}">${APP.currency(c.balance)}</td>
        <td>
          <button onclick="ACTIONS.shareCustomer(${c.id})">📤</button>
          <button onclick="RENDER.showCustomerStatement(${c.id})">📋</button>
        </td>
      </tr>
    `).join('');
    document.querySelector("#customersTable tbody").innerHTML = rows;
  },

  showCustomerStatement(customerId) {
    const customer = APP.DB.customers.find(c => c.id == customerId);
    const sales = APP.DB.sales_log.filter(s => s.customer_id == customerId);
    const collections = APP.DB.collections.filter(c => c.customer_id == customerId);
    const html = `
      <h3>${customer.name}</h3>
      <p>الرصيد الحالي: ${APP.currency(customer.balance)}</p>
      <h4>المبيعات الآجلة</h4>
      <table class="table">
        <tr><th>التاريخ</th><th>المبلغ</th></tr>
        ${sales.map(s => `<tr><td>${APP.formatDate(s.date)}</td><td>${APP.currency(s.total)}</td></tr>`).join('')}
      </table>
      <h4>التحصيلات</h4>
      <table class="table">
        <tr><th>التاريخ</th><th>المبلغ</th></tr>
        ${collections.map(c => `<tr><td>${APP.formatDate(c.created_at)}</td><td>${APP.currency(c.amount)}</td></tr>`).join('')}
      </table>
    `;
    APP.openModal(`📋 كشف حساب ${customer.name}`, html, () => {});
    document.getElementById("modalSave").style.display = "none";
  },

  // ---------- الموردين ----------
  suppliers() {
    const addButton = APP.can("suppliers") ? `<button onclick="ACTIONS.openAddSupplierModal()" class="btn">➕ إضافة مورد</button>` : '';
    const rows = APP.DB.suppliers.map(s => `
      <tr>
        <td>${s.name}</td>
        <td>${s.phone || '-'}</td>
        <td>${APP.currency(s.balance)}</td>
      </tr>
    `).join('');
    const html = `
      <h2>🚚 الموردين</h2>
      ${addButton}
      <table class="table">
        <thead><tr><th>الاسم</th><th>الهاتف</th><th>المستحق</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    document.getElementById("suppliers").innerHTML = html;
  },

  // ---------- الخزنة ----------
  khazna() {
    const addColButton = `<button onclick="ACTIONS.openAddCollectionModal()" class="btn">➕ تحصيل</button>`;
    const addExpButton = `<button onclick="ACTIONS.openAddExpenseModal()" class="btn">➕ مصروف</button>`;
    
    const totalCollections = APP.DB.collections.reduce((s, c) => s + APP.N(c.amount), 0);
    const totalExpenses = APP.DB.expenses.reduce((s, e) => s + APP.N(e.amount), 0);
    const net = totalCollections - totalExpenses;

    const recentCollections = APP.DB.collections.slice(0, 5);
    const recentExpenses = APP.DB.expenses.slice(0, 5);

    const html = `
      <h2>💰 الخزنة</h2>
      <div class="grid">
        ${APP.statCard("إجمالي التحصيلات", APP.currency(totalCollections))}
        ${APP.statCard("إجمالي المصروفات", APP.currency(totalExpenses))}
        ${APP.statCard("الصافي", APP.currency(net))}
      </div>
      <div style="display:flex; gap:10px;">${addColButton} ${addExpButton}</div>
      <h3>آخر التحصيلات</h3>
      <table class="table">
        ${recentCollections.map(c => `<tr><td>${APP.formatDate(c.created_at)}</td><td>${APP.currency(c.amount)}</td><td>${c.notes || ''}</td></tr>`).join('')}
      </table>
      <h3>آخر المصروفات</h3>
      <table class="table">
        ${recentExpenses.map(e => `<tr><td>${APP.formatDate(e.created_at)}</td><td>${APP.currency(e.amount)}</td><td>${e.category} - ${e.description || ''}</td></tr>`).join('')}
      </table>
    `;
    document.getElementById("khazna").innerHTML = html;
  },

  // ---------- التقارير ----------
  reports() {
    const totalSales = APP.DB.sales_log.reduce((s, x) => s + APP.N(x.total), 0);
    const totalExpenses = APP.DB.expenses.reduce((s, x) => s + APP.N(x.amount), 0);
    const totalProfit = totalSales - totalExpenses;

    const html = `
      <h2>📊 التقارير</h2>
      <div class="grid">
        ${APP.statCard("إجمالي المبيعات", APP.currency(totalSales))}
        ${APP.statCard("إجمالي المصروفات", APP.currency(totalExpenses))}
        ${APP.statCard("صافي الربح", APP.currency(totalProfit))}
      </div>
      <canvas id="salesChart" width="400" height="200"></canvas>
      <button onclick="APP.exportBackup()" class="btn">💾 نسخ احتياطي</button>
    `;
    document.getElementById("reports").innerHTML = html;

    // رسم بياني بسيط
    const ctx = document.getElementById('salesChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['المبيعات', 'المصروفات', 'الربح'],
        datasets: [{
          label: 'المبالغ',
          data: [totalSales, totalExpenses, totalProfit],
          backgroundColor: ['#22c55e', '#ef4444', '#3b82f6']
        }]
      }
    });
  },

  // ---------- المشرف (إدارة المدفوعات) ----------
  admin() {
    if (APP.currentProfile?.role !== 'admin') {
      document.getElementById("admin").innerHTML = "<h2>غير مصرح</h2>";
      return;
    }
    const pendingPayments = (APP.DB.payments || []).filter(p => p.status === 'pending');
    const html = `
      <h2>🛠 لوحة المشرف</h2>
      <h3>طلبات الاشتراك المعلقة</h3>
      <table class="table">
        <tr><th>المستخدم</th><th>الخطة</th><th>المبلغ</th><th>إجراء</th></tr>
        ${pendingPayments.map(p => `
          <tr>
            <td>${p.user_id}</td>
            <td>${PLANS[p.plan]?.name || p.plan}</td>
            <td>${APP.currency(p.amount)}</td>
            <td>
              <button onclick="ACTIONS.approvePayment(${p.id})">✅ قبول</button>
              <button onclick="ACTIONS.rejectPayment(${p.id})">❌ رفض</button>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
    document.getElementById("admin").innerHTML = html;
  },

  // ---------- صفحة الاشتراك (للمستخدم) ----------
  subscription() {
    const plansHtml = Object.entries(PLANS).map(([key, plan]) => `
      <div class="card">
        <h3>${plan.name}</h3>
        <p>${APP.currency(plan.price)} / ${plan.days} يوم</p>
        <button onclick="ACTIONS.requestSubscription('${key}')">اختر</button>
      </div>
    `).join('');
    const html = `
      <h2>💰 خطط الاشتراك</h2>
      <div class="grid">${plansHtml}</div>
      <p>بعد الدفع، سيتم مراجعة طلبك وتفعيله.</p>
    `;
    document.getElementById("subscription")?.innerHTML = html;
  }
};

// دالة طلب اشتراك (ستضاف لاحقًا)
ACTIONS.requestSubscription = async (planKey) => {
  const plan = PLANS[planKey];
  if (!plan) return;
  // في الواقع العملي يمكن رفع إيصال، هنا نضيف طلب دفع مباشر
  await APP.dbInsert("payments", {
    plan: planKey,
    amount: plan.price,
    status: "pending"
  });
  APP.showToast("تم إرسال طلب الاشتراك، بانتظار الموافقة");
};