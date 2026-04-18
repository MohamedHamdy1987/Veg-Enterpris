// ================================================
// ENTERPRISE ACTIONS - عمليات النظام الأساسية
// ================================================

window.ACTIONS = {
  
  // ---------- العملاء ----------
  openAddCustomerModal() {
    if (!APP.can("customers")) return APP.showToast("غير مسموح", false);
    const html = `
      <input id="c_name" placeholder="اسم العميل" class="full-width"><br><br>
      <input id="c_phone" placeholder="الهاتف"><br><br>
      <textarea id="c_address" placeholder="العنوان"></textarea>
    `;
    APP.openModal("➕ إضافة عميل", html, this.saveCustomer);
  },
  
  async saveCustomer() {
    const name = document.getElementById("c_name").value.trim();
    const phone = document.getElementById("c_phone").value.trim();
    const address = document.getElementById("c_address")?.value.trim() || "";
    if (!name) return APP.showToast("الاسم مطلوب", false);
    await APP.dbInsert("customers", { name, phone, address, balance: 0 });
    APP.showToast("✅ تم إضافة العميل");
    await APP.dbLoad();
    if (RENDER.customers) RENDER.customers();
  },
  
  shareCustomer(id) {
    const c = APP.DB.customers.find(x => x.id == id);
    if (!c?.phone) return APP.showToast("لا يوجد رقم هاتف", false);
    const text = `كشف حساب - ${c.name}\nالرصيد: ${APP.currency(c.balance)}`;
    window.open(getWhatsAppLink(c.phone, text), "_blank");
  },
  
  // ---------- الموردين ----------
  openAddSupplierModal() {
    if (!APP.can("suppliers")) return APP.showToast("غير مسموح", false);
    const html = `
      <input id="s_name" placeholder="اسم المورد" class="full-width"><br><br>
      <input id="s_phone" placeholder="الهاتف"><br><br>
      <textarea id="s_address" placeholder="العنوان"></textarea>
    `;
    APP.openModal("🚚 إضافة مورد", html, this.saveSupplier);
  },
  
  async saveSupplier() {
    const name = document.getElementById("s_name").value.trim();
    const phone = document.getElementById("s_phone").value.trim();
    const address = document.getElementById("s_address")?.value.trim() || "";
    if (!name) return APP.showToast("الاسم مطلوب", false);
    await APP.dbInsert("suppliers", { name, phone, address, balance: 0 });
    APP.showToast("✅ تم إضافة المورد");
    await APP.dbLoad();
    if (RENDER.suppliers) RENDER.suppliers();
  },
  
  // ---------- المنتجات ----------
  openAddProductModal() {
    if (!APP.can("sales")) return APP.showToast("غير مسموح", false);
    const html = `
      <input id="p_name" placeholder="اسم المنتج" class="full-width"><br><br>
      <input id="p_price" type="number" step="0.01" placeholder="سعر البيع"><br><br>
      <input id="p_cost" type="number" step="0.01" placeholder="سعر الشراء"><br><br>
      <input id="p_stock" type="number" step="0.01" placeholder="الكمية الأولية"><br><br>
      <input id="p_min" type="number" step="0.01" placeholder="حد إعادة الطلب">
    `;
    APP.openModal("📦 إضافة منتج", html, this.saveProduct);
  },
  
  async saveProduct() {
    const name = document.getElementById("p_name").value.trim();
    const price = APP.N(document.getElementById("p_price").value);
    const cost = APP.N(document.getElementById("p_cost").value);
    const stock = APP.N(document.getElementById("p_stock").value);
    const min = APP.N(document.getElementById("p_min").value) || 5;
    if (!name || price <= 0) return APP.showToast("الاسم وسعر البيع مطلوبان", false);
    await APP.dbInsert("products", { name, price, cost, stock, min_stock: min });
    APP.showToast("✅ تم إضافة المنتج");
    await APP.dbLoad();
    if (RENDER.sales) RENDER.sales();
  },
  
  // ---------- البيع (العملية الأساسية) ----------
  openSellModal(productId) {
    if (!APP.can("sales")) return APP.showToast("غير مسموح", false);
    const product = APP.DB.products.find(p => p.id == productId);
    if (!product) return;
    const customersOptions = APP.DB.customers.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join("");
    const html = `
      <h3>${product.name}</h3>
      <p>المتاح: ${product.stock} | السعر: ${APP.currency(product.price)}</p>
      <input id="sale_qty" type="number" step="0.01" placeholder="الكمية" class="full-width"><br><br>
      <input id="sale_price" type="number" step="0.01" value="${product.price}" placeholder="السعر"><br><br>
      <select id="sale_type">
        <option value="cash">نقدي</option>
        <option value="credit">آجل</option>
        <option value="card">بطاقة</option>
      </select><br><br>
      <select id="sale_customer">
        <option value="">-- بدون عميل --</option>
        ${customersOptions}
      </select>
    `;
    APP.openModal("🛒 بيع منتج", html, () => this.confirmSale(productId));
  },
  
  async confirmSale(productId) {
    const qty = APP.N(document.getElementById("sale_qty").value);
    const price = APP.N(document.getElementById("sale_price").value);
    const type = document.getElementById("sale_type").value;
    const customerId = document.getElementById("sale_customer").value || null;
    
    if (qty <= 0 || price <= 0) return APP.showToast("الكمية والسعر مطلوبان", false);
    if (type === "credit" && !customerId) return APP.showToast("اختر عميلاً للبيع الآجل", false);
    
    const product = APP.DB.products.find(p => p.id == productId);
    if (product.stock < qty) return APP.showToast("الكمية غير متوفرة", false);
    
    const total = qty * price;
    
    try {
      // تحديث المخزون
      const { error: stockError } = await APP.sb
        .from("products")
        .update({ stock: product.stock - qty })
        .eq("id", productId)
        .eq("user_id", APP.currentUser.id)
        .gte("stock", qty);
      
      if (stockError) throw stockError;
      
      // تسجيل البيع
      await APP.dbInsert("sales_log", {
        product_id: productId,
        customer_id: customerId,
        qty,
        price,
        total,
        type,
        date: new Date().toISOString()
      });
      
      // تحديث رصيد العميل للآجل
      if (type === "credit" && customerId) {
        const customer = APP.DB.customers.find(c => c.id == customerId);
        await APP.dbUpdate("customers", customerId, { balance: APP.N(customer.balance) + total });
      }
      
      // تحصيل مباشر للنقدي والبطاقة (يمكن اعتبارها مدفوعة)
      if (type === "cash" || type === "card") {
        await APP.dbInsert("collections", {
          customer_id: customerId,
          amount: total,
          payment_method: type,
          notes: `بيع ${product.name}`,
          created_at: new Date().toISOString()
        });
      }
      
      APP.showToast(`✅ تم البيع: ${APP.currency(total)}`);
      await APP.dbLoad();
      if (RENDER.sales) RENDER.sales();
      if (RENDER.dashboard) RENDER.dashboard();
      
    } catch (e) {
      APP.showToast("❌ فشلت عملية البيع", false);
      console.error(e);
    }
  },
  
  // ---------- التحصيلات ----------
  openAddCollectionModal() {
    if (!APP.can("collections")) return APP.showToast("غير مسموح", false);
    const customersOptions = APP.DB.customers.map(c => 
      `<option value="${c.id}">${c.name}</option>`
    ).join("");
    const html = `
      <input id="col_amount" type="number" step="0.01" placeholder="المبلغ" class="full-width"><br><br>
      <select id="col_customer">
        <option value="">-- اختر عميل (اختياري) --</option>
        ${customersOptions}
      </select><br><br>
      <select id="col_method">
        <option value="cash">نقدي</option>
        <option value="bank">بنك</option>
        <option value="mobile">محفظة</option>
      </select><br><br>
      <textarea id="col_notes" placeholder="ملاحظات"></textarea>
    `;
    APP.openModal("💰 تحصيل مبلغ", html, this.saveCollection);
  },
  
  async saveCollection() {
    const amount = APP.N(document.getElementById("col_amount").value);
    const customerId = document.getElementById("col_customer").value || null;
    const method = document.getElementById("col_method").value;
    const notes = document.getElementById("col_notes").value.trim();
    if (amount <= 0) return APP.showToast("المبلغ مطلوب", false);
    
    await APP.dbInsert("collections", {
      customer_id: customerId,
      amount,
      payment_method: method,
      notes,
      created_at: new Date().toISOString()
    });
    
    if (customerId) {
      const customer = APP.DB.customers.find(c => c.id == customerId);
      await APP.dbUpdate("customers", customerId, { balance: APP.N(customer.balance) - amount });
    }
    
    APP.showToast("✅ تم التحصيل");
    await APP.dbLoad();
    if (RENDER.khazna) RENDER.khazna();
  },
  
  // ---------- المصروفات ----------
  openAddExpenseModal() {
    const html = `
      <input id="exp_amount" type="number" step="0.01" placeholder="المبلغ" class="full-width"><br><br>
      <input id="exp_category" placeholder="الفئة (إيجار، رواتب...)"><br><br>
      <textarea id="exp_desc" placeholder="الوصف"></textarea>
    `;
    APP.openModal("💸 إضافة مصروف", html, this.saveExpense);
  },
  
  async saveExpense() {
    const amount = APP.N(document.getElementById("exp_amount").value);
    const category = document.getElementById("exp_category").value.trim();
    const desc = document.getElementById("exp_desc").value.trim();
    if (amount <= 0 || !category) return APP.showToast("المبلغ والفئة مطلوبان", false);
    await APP.dbInsert("expenses", { amount, category, description: desc });
    APP.showToast("✅ تم إضافة المصروف");
    await APP.dbLoad();
    if (RENDER.khazna) RENDER.khazna();
  },
  
  // ---------- إدارة المدفوعات (للمشرف) ----------
  async approvePayment(id) {
    if (APP.currentProfile.role !== "admin") return;
    const payment = APP.DB.payments?.find(p => p.id == id);
    if (!payment) return;
    await APP.sb.from("payments").update({ status: "approved" }).eq("id", id);
    const endDate = new Date(Date.now() + PLANS[payment.plan].days * 86400000);
    await APP.sb.from("subscriptions").insert({
      user_id: payment.user_id,
      plan: payment.plan,
      start_date: new Date(),
      end_date: endDate,
      status: "active"
    });
    APP.showToast("✅ تم تفعيل الاشتراك");
    await APP.dbLoad();
    if (RENDER.admin) RENDER.admin();
  },
  
  async rejectPayment(id) {
    if (APP.currentProfile.role !== "admin") return;
    await APP.sb.from("payments").update({ status: "rejected" }).eq("id", id);
    APP.showToast("تم رفض الدفع");
    await APP.dbLoad();
    if (RENDER.admin) RENDER.admin();
  }
};