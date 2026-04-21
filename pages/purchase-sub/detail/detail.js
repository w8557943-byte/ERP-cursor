const app = getApp();

Page({
  data: {
    id: '',
    order: null,
    loading: true,
    showEditModal: false,
    editForm: {}
  },

  onLoad: function(options) {
    if (options.id) {
      this.setData({ id: options.id });
      this.loadData(options.id);
    } else {
      wx.showToast({
        title: '参数错误',
        icon: 'error'
      });
      setTimeout(() => wx.navigateBack(), 1500);
    }
  },

  loadData: function(id) {
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getPurchaseOrderDetail',
        data: { id }
      }
    }).then(res => {
      wx.hideLoading();
      if (res.result && res.result.success) {
        this.processData(res.result.data);
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    });
  },

  processData: function(data) {
    // 状态映射
    const statusMap = {
      'ordered': '已下单',
      'processing': '采购中',
      'stocked': '已入库',
      'completed': '已完成',
      'cancelled': '已取消'
    };

    // 判断是否为辅材采购
    const isRawMaterial = String(data.purchaseCategory || '').toLowerCase() === 'raw_materials';

    // 时间格式化
    const formatTime = (ts) => {
      if (!ts) return '';
      const date = new Date(typeof ts === 'string' ? Date.parse(ts) : ts);
      return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    };

    // 字段映射 fallback
    const goodsName = data.goodsName || data.productTitle || '未知商品';

    // 计算财务
    const qty = Number(data.quantity || 0);
    
    let purchasePrice = 0;
    let sellingPrice = 0;

    // 智能识别字段映射 (兼容PC端不同的字段定义)
    // PC端商品采购: salePrice=进价, unitPrice=售价
    // PC端辅材采购: salePrice=进价, unitPrice=进价
    // 小程序端/通用: unitPrice=进价, sellingPrice=售价

    if (data.salePrice !== undefined && data.salePrice !== null) {
      // 存在 salePrice，说明是PC端创建的结构
      purchasePrice = Number(data.salePrice);
      
      // 如果是辅材，unitPrice也是进价；如果是商品，unitPrice是售价
      if (isRawMaterial) {
        sellingPrice = 0; // 辅材默认无售价
      } else {
        sellingPrice = Number(data.unitPrice || 0);
      }
    } else {
      // 标准/旧版结构
      purchasePrice = Number(data.unitPrice || 0);
      sellingPrice = Number(data.sellingPrice || data.productSellingPrice || 0);
    }
    
    // 采购总额 (cost)
    const totalCost = Number(data.amount || (qty * purchasePrice) || 0);
    
    // 预估收入
    const totalRevenue = qty * sellingPrice;
    
    // 利润
    const profit = (totalRevenue - totalCost).toFixed(2);
    
    // 只要有售价且大于0，就视为有财务信息需要显示
    const hasFinancialInfo = sellingPrice > 0;

    // 处理附件
    const attachments = (data.attachments || []).map(att => {
      const raw = typeof att === 'string' ? { name: att, url: att } : att || {};
      const url = raw.url || '';
      const name = raw.name || '附件';
      const ext = (name.split('.').pop() || '').toLowerCase();
      // 简单判断图片
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || (!['pdf','doc','docx','xls','xlsx'].includes(ext) && url.match(/\.(jpg|jpeg|png|gif)$/i));
      return { ...raw, url, name, ext, isImage };
    });

    // 处理压线信息
    const creasingArr = [data.creasingSize1, data.creasingSize2, data.creasingSize3].filter(v => v);
    let creasingInfo = creasingArr.length > 0 ? creasingArr.join('-') : '';
    if (data.creasingType) {
      creasingInfo += (creasingInfo ? ` (${data.creasingType})` : data.creasingType);
    }

    const processed = {
      ...data,
      isRawMaterial, // 标记类型
      hasFinancialInfo, // 标记是否有财务信息
      goodsName,     // 确保有值
      statusText: statusMap[data.status] || data.status,
      createdAtText: formatTime(data.createdAt),
      stockedAtText: formatTime(data.stockedAt),
      
      purchasePrice: purchasePrice.toFixed(2),
      purchaseAmount: totalCost.toFixed(2),
      
      sellingPrice: sellingPrice.toFixed(2),
      // 销售金额
      sellingAmount: totalRevenue.toFixed(2),
      profit: profit,
      
      // 保留原始 amount 显示
      amount: totalCost.toFixed(2),
      
      attachments,
      creasingInfo
    };

    this.setData({ order: processed });
  },

  onEdit: function() {
    const o = this.data.order;
    this.setData({
      showEditModal: true,
      editForm: {
        supplierName: o.supplierName || '',
        customerName: o.customerName || '',
        goodsName: o.goodsName || '',
        spec: o.spec || o.materialNo || '',
        quantity: o.quantity || '',
        unitPrice: o.purchasePrice || '',
        productSellingPrice: o.sellingPrice || ''
      }
    });
  },

  closeEditModal: function() {
    this.setData({ showEditModal: false });
  },

  onEditInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`editForm.${field}`]: value
    });
  },

  confirmEdit: function() {
    const form = this.data.editForm;
    
    wx.showLoading({ title: '保存中...' });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'updatePurchaseOrder',
        data: {
          id: this.data.id,
          ...form
        }
      }
    }).then(res => {
      wx.hideLoading();
      if (res.result && res.result.success) {
        wx.showToast({ title: '保存成功' });
        this.setData({ showEditModal: false });
        this.loadData(this.data.id);
      } else {
        wx.showToast({ title: res.result?.message || '保存失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '调用失败', icon: 'none' });
    });
  },

  previewImage: function(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.previewImage({
      urls: [url],
      current: url
    });
  },

  openDocument: function(e) {
    const url = e.currentTarget.dataset.url;
    let type = e.currentTarget.dataset.type;
    
    // wx.openDocument fileType only supports specific types
    const validTypes = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
    if (type && !validTypes.includes(type)) {
       type = undefined; // Let system detect or fail gracefully
    }

    if (!url) return;

    wx.showLoading({ title: '打开中...' });
    wx.downloadFile({
      url: url,
      success: function (res) {
        const filePath = res.tempFilePath;
        wx.openDocument({
          filePath: filePath,
          fileType: type,
          success: function (res) {
            console.log('打开文档成功');
            wx.hideLoading();
          },
          fail: function(e) {
            console.error('打开文档失败', e);
            wx.hideLoading();
            wx.showToast({ title: '无法打开此文件', icon: 'none' });
          }
        });
      },
      fail: function(e) {
        console.error('下载文件失败', e);
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      }
    });
  },


});
