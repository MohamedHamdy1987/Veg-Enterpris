// ================================================
// ENTERPRISE CORE ENGINE - محرك التطبيق الرئيسي
// ================================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

window.APP = {
  sb,
  
  // الحالة العامة
  currentUser: null,
  currentProfile: null,
  currentBranchId: null,
  currentPage: "dashboard",
  
  // تخزين مؤقت للبيانات
  DB: {
    customers: [],
    suppliers: [],
    products: [],
    collections: [],
    expenses: [],
    employees: [],
    partners: [],
    sales_log: [],
    branches: [],
    subscriptions: []
  },
  
  notifications: [],
  
  // ---------- دوال مساعدة ----------
  N(v) { return Number(v) || 0; },
  
  currency(v) {
    return this.N(v).toLocaleString("ar-EG") + " " + APP_CONFIG.CURRENCY;
  },
  
  formatDate(d) {
    return d ? new Date(d).toLocaleDateString(UI_CONFIG.DATE_FORMAT) : "-";
  },
  
  statCard(title, value) {
    return `
      <div class="card">
        <h3>${title}</h3>
        <p style="font-size:24px;font-weight:bold;">${value}</p>
      </div>
    `;
  },
  
  // إعادة محاولة العملية عند الفشل
  async retry(fn, retries = APP_CONFIG.RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
      try { return await fn(); }
      catch (e) { if (i === retries - 1) throw e; }
    }
  },
  
  // تحميل كل البيانات من قاعدة البيانات
  async dbLoad() {
    if (!this.currentUser) return;
    for (let table of Object.keys(this.DB)) {
      try {
        const res = await this.retry(() =>
          sb.from(table)
            .select("*")
            .eq("user_id", this.currentUser.id)
            .eq("branch_id", this.currentBranchId)
            .range(0, APP_CONFIG.PAGE_SIZE - 1)
        );
        if (!res.error) this.DB[table] = res.data || [];
      } catch (e) {
        this.showToast("فشل تحميل " + table, false);
      }
    }
  },
  
  // ---------- CRUD أساسي ----------
  async dbInsert(table, data) {
    return await this.retry(async () => {
      const { error } = await sb.from(table).insert({
        ...data,
        user_id: this.currentUser.id,
        branch_id: this.currentBranchId
      });
      if (error) throw error;
      return true;
    });
  },
  
  async dbUpdate(table, id, data) {
    return await this.retry(async () => {
      const { error } = await sb.from(table)
        .update(data)
        .eq("id", id)
        .eq("user_id", this.currentUser.id);
      if (error) throw error;
      return true;
    });
  },
  
  async dbDelete(table, id) {
    return await this.retry(async () => {
      const { error } = await sb.from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", this.currentUser.id);
      if (error) throw error;
      return true;
    });
  },
  
  // ---------- المصادقة وبدء التشغيل ----------
  async initApp() {
    try {
      const { data } = await sb.auth.getUser();
      this.currentUser = data.user;
      
      if (!this.currentUser) {
        document.getElementById("authScreen").style.display = "flex";
        document.getElementById("app").classList.add("hidden");
        return;
      }
      
      // تحميل الملف الشخصي
      const { data: profile } = await sb
        .from("profiles")
        .select("*")
        .eq("id", this.currentUser.id)
        .single();
      this.currentProfile = profile;
      
      // تحميل الفروع وإنشاء فرع افتراضي إذا لم يوجد
      const { data: branches } = await sb
        .from("branches")
        .select("*")
        .eq("user_id", this.currentUser.id);
      
      if (!branches || branches.length === 0) {
        await this.dbInsert("branches", {
          name: APP_CONFIG.DEFAULT_BRANCH_NAME,
          address: ""
        });
        const { data: newBranches } = await sb
          .from("branches")
          .select("*")
          .eq("user_id", this.currentUser.id);
        this.DB.branches = newBranches || [];
      } else {
        this.DB.branches = branches;
      }
      
      this.currentBranchId = this.DB.branches[0]?.id || null;
      this.renderBranchSelector();
      
      // التحقق من الاشتراك
      const { data: sub } = await sb
        .from("subscriptions")
        .select("*")
        .eq("user_id", this.currentUser.id)
        .eq("status", "active")
        .single();
      
      if (!sub || new Date(sub.end_date) < new Date()) {
        document.getElementById("app").innerHTML = `
          <div style="padding:40px;text-align:center">
            <h2>⚠️ الاشتراك غير مفعل أو منتهي</h2>
            <button onclick="navigate('subscription')" class="btn">تجديد الاشتراك</button>
          </div>
        `;
        document.getElementById("app").classList.remove("hidden");
        document.getElementById("authScreen").style.display = "none";
        return;
      }
      
      // تحميل باقي البيانات
      await this.dbLoad();
      
      if (APP_CONFIG.ENABLE_REALTIME) this.initRealtime();
      
      document.getElementById("app").classList.remove("hidden");
      document.getElementById("authScreen").style.display = "none";
      document.getElementById("userInfo").innerText = `👤 ${this.currentUser.email}`;
      
      this.navigate("dashboard");
      this.startIdleTimer();
      this.updateSidebarVisibility();
      
    } catch (e) {
      console.error(e);
      alert("خطأ في تشغيل النظام");
    }
  },
  
  // تحديث رؤية الأزرار حسب الصلاحيات
  updateSidebarVisibility() {
    const role = this.currentProfile?.role || 'viewer';
    document.querySelectorAll("[data-permission]").forEach(el => {
      const perm = el.getAttribute("data-permission");
      el.style.display = this.can(perm) ? "block" : "none";
    });
    // زر المشرف خاص
    const adminBtn = document.getElementById("adminBtn");
    if (adminBtn) adminBtn.style.display = role === "admin" ? "block" : "none";
  },
  
  // ---------- Realtime ----------
  initRealtime() {
    sb.channel("realtime")
      .on("postgres_changes", { event: "*", schema: "public" }, async (payload) => {
        await this.dbLoad();
        if (payload.table === "products" && payload.new) {
          if (payload.new.stock <= payload.new.min_stock) {
            this.addNotification(NOTIFICATION_MESSAGES.LOW_STOCK(payload.new.name, payload.new.stock));
          }
        }
      })
      .subscribe();
  },
  
  // ---------- الإشعارات ----------
  addNotification(msg) {
    this.notifications.unshift({ msg, time: new Date().toLocaleTimeString() });
    this.notifications = this.notifications.slice(0, 5);
    this.renderNotifications();
  },
  
  renderNotifications() {
    const el = document.getElementById("notifications");
    if (!el) return;
    el.innerHTML = this.notifications.map(n => 
      `<div>🔔 ${n.msg}</div>`
    ).join("");
  },
  
  // ---------- اختيار الفرع ----------
  renderBranchSelector() {
    const el = document.getElementById("branchSelector");
    if (!el) return;
    el.innerHTML = this.DB.branches.map(b => 
      `<option value="${b.id}" ${b.id == this.currentBranchId ? "selected" : ""}>${b.name}</option>`
    ).join("");
  },
  
  // ---------- التنقل بين الصفحات ----------
  async navigate(page) {
    this.currentPage = page;
    document.querySelectorAll(".page").forEach(p => p.style.display = "none");
    const target = document.getElementById(page);
    if (target) target.style.display = "block";
    await this.dbLoad();
    if (RENDER[page]) RENDER[page]();
  },
  
  // ---------- التحقق من الصلاحية ----------
  can(permission) {
    return can(this.currentProfile?.role, permission);
  },
  
  // ---------- طباعة ----------
  printElement(id) {
    const content = document.getElementById(id).innerHTML;
    const win = window.open("", "", "width=800,height=600");
    win.document.write(`<html><body>${content}</body></html>`);
    win.print();
  },
  
  // ---------- نسخ احتياطي ----------
  exportBackup() {
    const blob = new Blob([JSON.stringify(this.DB)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = BACKUP_CONFIG.FILE_NAME;
    a.click();
  },
  
  // ---------- تسجيل الخروج التلقائي ----------
  startIdleTimer() {
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => logout(), APP_CONFIG.SESSION_TIMEOUT);
    };
    ["mousemove", "keypress", "click"].forEach(ev => document.addEventListener(ev, reset));
    reset();
  },
  
  // ---------- توست (إشعار منبثق) ----------
  showToast(msg, ok = true) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.innerText = msg;
    t.style.background = ok ? "#22c55e" : "#ef4444";
    t.style.display = "block";
    setTimeout(() => t.style.display = "none", 3000);
  },
  
  // ---------- إغلاق النافذة المنبثقة ----------
  closeModal() {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
  },
  
  // ---------- فتح نافذة منبثقة بمحتوى مخصص ----------
  openModal(title, content, onSave) {
    const modal = document.getElementById("modal");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const modalSave = document.getElementById("modalSave");
    if (!modal) return;
    modalTitle.innerText = title;
    modalBody.innerHTML = content;
    modalSave.onclick = async () => {
      await onSave();
      this.closeModal();
    };
    modal.style.display = "flex";
  }
};

// دوال عامة
window.navigate = (p) => APP.navigate(p);
window.logout = async () => { await sb.auth.signOut(); location.reload(); };

// وظيفة تسجيل الدخول
window.login = async () => {
  const email = document.getElementById("loginEmail").value;
  const password = document.getElementById("loginPassword").value;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    alert("خطأ في تسجيل الدخول: " + error.message);
  } else {
    await APP.initApp();
  }
};