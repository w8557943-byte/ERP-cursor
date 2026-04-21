Page({
  data: {
    keyword: '',
    users: [],
    loading: false,
    page: 1,
    limit: 20,
    total: 0,
    hasMore: true,
    activeCount: 0,
    disabledCount: 0,
    superAdminPhone: '13817508995',
    roleOptions: [
      { value: 'admin', label: '管理员' },
      { value: 'operator', label: '操作员' }
    ],
    formRoleLabel: '操作员',
    formVisible: false,
    formMode: 'create',
    formSaving: false,
    editingId: '',
    form: {
      name: '',
      username: '',
      phone: '',
      password: '',
      role: 'operator',
      status: 'active'
    }
  },

  onLoad() {
    const app = getApp();
    const allowed = app && app.globalData && typeof app.globalData.checkPermission === 'function'
      ? app.globalData.checkPermission('admin')
      : false;

    if (!allowed) {
      wx.showToast({ title: '无权限访问', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        });
      }, 800);
      return;
    }
    this.loadUsers(true);
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadUsers(true)).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return;
    this.loadUsers(false);
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  onSearch() {
    this.loadUsers(true);
  },

  formatRole(role) {
    const v = String(role || '').toLowerCase();
    if (v === 'admin' || v === 'administrator') return '管理员';
    if (v === 'operator') return '操作员';
    return '普通用户';
  },

  openCreate() {
    this.setData({
      formVisible: true,
      formMode: 'create',
      formSaving: false,
      editingId: '',
      formRoleLabel: this.formatRole('operator'),
      form: {
        name: '',
        username: '',
        phone: '',
        password: '',
        role: 'operator',
        status: 'active'
      }
    });
  },

  openEdit(e) {
    const index = Number(e.currentTarget.dataset.index);
    const user = (this.data.users || [])[index];
    if (!user) return;
    const phoneOrUsername = String(user.phone || user.username || '');
    if (phoneOrUsername === this.data.superAdminPhone) {
      wx.showToast({ title: '超管账号不可编辑', icon: 'none' });
      return;
    }
    const role = String(user.role || '').toLowerCase() === 'admin' || String(user.role || '').toLowerCase() === 'administrator' ? 'admin' : 'operator';
    const status = String(user.status || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active';
    this.setData({
      formVisible: true,
      formMode: 'edit',
      formSaving: false,
      editingId: String(user._id || ''),
      formRoleLabel: this.formatRole(role),
      form: {
        name: String(user.name || user.realName || '').trim(),
        username: String(user.username || '').trim(),
        phone: String(user.phone || '').trim(),
        password: '',
        role,
        status
      }
    });
  },

  closeForm() {
    if (this.data.formSaving) return;
    this.setData({ formVisible: false });
  },

  stop() {},

  onFormInput(e) {
    const field = String(e.currentTarget.dataset.field || '');
    const value = e.detail && typeof e.detail.value !== 'undefined' ? e.detail.value : '';
    if (!field) return;
    this.setData({
      form: {
        ...this.data.form,
        [field]: String(value)
      }
    });
  },

  onPickRole(e) {
    const idx = Number(e.detail && e.detail.value);
    const opt = (this.data.roleOptions || [])[idx];
    if (!opt) return;
    this.setData({
      formRoleLabel: String(opt.label || this.formatRole(opt.value)),
      form: {
        ...this.data.form,
        role: opt.value
      }
    });
  },

  onStatusSwitch(e) {
    const checked = !!(e && e.detail && e.detail.value);
    this.setData({
      form: {
        ...this.data.form,
        status: checked ? 'active' : 'disabled'
      }
    });
  },

  submitForm() {
    if (this.data.formSaving) return;
    const form = this.data.form || {};
    const name = String(form.name || '').trim();
    const username = String(form.username || '').trim();
    const phoneInput = String(form.phone || '').trim();
    const password = String(form.password || '').trim();
    const role = String(form.role || '').trim() || 'operator';
    const status = String(form.status || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active';
    const usernameLooksPhone = /^1[3-9]\d{9}$/.test(username);
    const phone = phoneInput || (usernameLooksPhone ? username : '');
    const isStrongPassword = (pwd) => {
      const s = String(pwd || '');
      if (s.length < 8) return false;
      const hasLetter = /[a-z]/i.test(s);
      const hasDigit = /\d/.test(s);
      return hasLetter && hasDigit;
    };

    if (!name) {
      wx.showToast({ title: '请输入用户名称', icon: 'none' });
      return;
    }
    if (!username) {
      wx.showToast({ title: '请输入登入账号', icon: 'none' });
      return;
    }
    if (phone) {
      if (!/^1[3-9]\d{9}$/.test(phone)) {
        wx.showToast({ title: '手机号格式错误', icon: 'none' });
        return;
      }
    } else if (this.data.formMode === 'create') {
      wx.showToast({ title: '请输入手机号', icon: 'none' });
      return;
    }
    if (this.data.formMode === 'create') {
      if (!password || password.length < 6) {
        wx.showToast({ title: '登入密码至少6位', icon: 'none' });
        return;
      }
      if (role === 'admin' && !isStrongPassword(password)) {
        wx.showToast({ title: '管理员密码至少8位且包含字母与数字', icon: 'none' });
        return;
      }
    } else {
      if (password && password.length < 6) {
        wx.showToast({ title: '登入密码至少6位', icon: 'none' });
        return;
      }
      if (password && role === 'admin' && !isStrongPassword(password)) {
        wx.showToast({ title: '管理员密码至少8位且包含字母与数字', icon: 'none' });
        return;
      }
    }

    this.setData({ formSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    const isCreate = this.data.formMode === 'create';
    const payload = {
      name,
      username,
      phone,
      role,
      status
    };
    if (isCreate || password) payload.password = password;

    const action = isCreate ? 'createUser' : 'updateUser';
    const data = isCreate ? payload : { id: this.data.editingId, ...payload };

    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action, data }
    }).then((res) => {
      const result = res && res.result ? res.result : null;
      if (!result || result.success !== true) {
        throw new Error(result && result.message ? result.message : '保存失败');
      }
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ formVisible: false });
      return this.loadUsers(true);
    }).catch((err) => {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ formSaving: false });
    });
  },

  loadUsers(reset) {
    if (this.data.loading) return;
    const nextPage = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });

    return wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getUsers',
        params: {
          page: nextPage,
          limit: this.data.limit,
          keyword: this.data.keyword ? String(this.data.keyword).trim() : ''
        }
      }
    }).then((res) => {
      const payload = res && res.result ? res.result : null;
      if (!payload || payload.success !== true) {
        throw new Error(payload && payload.message ? payload.message : '获取用户失败');
      }
      const normalizeText = (value) => String(value || '').trim();
      const sliceText = (text, maxLen) => {
        const arr = Array.from(String(text || ''));
        if (arr.length <= maxLen) return arr.join('');
        return arr.slice(0, maxLen).join('');
      };
      const getAvatarText = (user) => {
        const raw = normalizeText(user && (user.name || user.realName || user.username || user.phone));
        if (!raw) return '用户';
        const chars = Array.from(raw);
        return chars.length >= 2 ? chars.slice(-2).join('') : chars[0];
      };
      const getRoleText = (role) => {
        const v = String(role || '').toLowerCase();
        if (v === 'admin' || v === 'administrator') return '管理员';
        if (v === 'operator') return '操作员';
        return '普通用户';
      };
      const list = (Array.isArray(payload.data) ? payload.data : []).map((u) => {
        const username = normalizeText(u.username);
        const phone = normalizeText(u.phone);
        const phoneOrUsername = phone || username;
        const isSuperAdmin = phoneOrUsername === this.data.superAdminPhone;
        return {
          ...u,
          _displayName: sliceText(u.name || u.realName || phoneOrUsername || '用户', 20),
          _avatarText: getAvatarText(u),
          _accountText: phoneOrUsername || '-',
          _roleText: getRoleText(u.role),
          _showPhone: !!(phone && phone !== username),
          _isSuperAdmin: isSuperAdmin
        };
      });
      const pagination = payload.pagination || {};
      const total = Number(pagination.total || 0);
      const merged = reset ? list : (this.data.users || []).concat(list);
      const hasMore = merged.length < total;
      const activeCount = merged.filter(u => (u && u.status ? String(u.status) : 'active') === 'active').length;
      const disabledCount = merged.length - activeCount;
      this.setData({
        users: merged,
        page: nextPage,
        total,
        hasMore,
        activeCount,
        disabledCount
      });
    }).catch((err) => {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  onCopyAccount(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = String(e.currentTarget.dataset.field || '');
    const user = (this.data.users || [])[index];
    if (!user) return;
    const value = field === 'phone' ? (user.phone || '') : (user.username || user._accountText || '');
    const text = String(value || '').trim();
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  onDeleteUser(e) {
    const index = Number(e.currentTarget.dataset.index);
    const user = (this.data.users || [])[index];
    if (!user) return;
    const phoneOrUsername = String(user.phone || user.username || '');
    if (phoneOrUsername === this.data.superAdminPhone) {
      wx.showToast({ title: '超管账号不可删除', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认删除',
      content: `确定删除用户“${user._displayName || user.username || ''}”吗？`,
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (modalRes) => {
        if (!modalRes.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        wx.cloud.callFunction({
          name: 'erp-api',
          data: {
            action: 'deleteUser',
            data: { id: user._id }
          }
        }).then((res) => {
          const payload = res && res.result ? res.result : null;
          if (!payload || payload.success !== true) {
            throw new Error(payload && payload.message ? payload.message : '删除失败');
          }
          wx.showToast({ title: '已删除', icon: 'success' });
          return this.loadUsers(true);
        }).catch((err) => {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }).finally(() => {
          wx.hideLoading();
        });
      }
    });
  }
});
