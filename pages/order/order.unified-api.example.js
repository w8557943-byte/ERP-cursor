/**
 * 订单列表页面 - 使用统一API
 * 迁移日期：2026-01-14
 */

const { API, clearCache } = require('../../utils/unified-api');
const { logger } = require('../../utils/logger');

Page({
    data: {
        orders: [],
        loading: false,
        searchKeyword: '',
        statusFilter: 'all',
        page: 1,
        pageSize: 20,
        hasMore: true
    },

    onLoad() {
        logger.info('OrderPage', '订单页面加载');
        this.loadOrders();
    },

    onShow() {
        // 每次显示时刷新数据
        this.loadOrders();
    },

    onPullDownRefresh() {
        this.setData({ page: 1 });
        this.loadOrders().finally(() => {
            wx.stopPullDownRefresh();
        });
    },

    onReachBottom() {
        if (this.data.hasMore && !this.data.loading) {
            this.loadMore();
        }
    },

    /**
     * 加载订单列表
     */
    async loadOrders() {
        if (this.data.loading) return;

        this.setData({ loading: true });

        try {
            const params = {
                page: this.data.page,
                pageSize: this.data.pageSize,
                search: this.data.searchKeyword || undefined,
                status: this.data.statusFilter !== 'all' ? this.data.statusFilter : undefined
            };

            logger.debug('OrderPage', '加载订单列表', params);

            const response = await API.getOrders(params);

            const orders = response.data || [];
            const hasMore = orders.length >= this.data.pageSize;

            this.setData({
                orders: this.data.page === 1 ? orders : [...this.data.orders, ...orders],
                hasMore,
                loading: false
            });

            logger.info('OrderPage', `加载成功，共 ${orders.length} 条订单`);

        } catch (error) {
            logger.error('OrderPage', '加载订单失败', error);

            this.setData({ loading: false });

            wx.showToast({
                title: error.message || '加载失败',
                icon: 'none',
                duration: 2000
            });
        }
    },

    /**
     * 加载更多
     */
    async loadMore() {
        this.setData({ page: this.data.page + 1 });
        await this.loadOrders();
    },

    /**
     * 搜索
     */
    onSearch(e) {
        const keyword = e.detail.value || '';
        this.setData({
            searchKeyword: keyword,
            page: 1
        });
        this.loadOrders();
    },

    /**
     * 清空搜索
     */
    onSearchClear() {
        this.setData({
            searchKeyword: '',
            page: 1
        });
        this.loadOrders();
    },

    /**
     * 状态筛选
     */
    onStatusFilter(e) {
        const status = e.currentTarget.dataset.status;
        this.setData({
            statusFilter: status,
            page: 1
        });
        this.loadOrders();
    },

    /**
     * 查看订单详情
     */
    goToDetail(e) {
        const id = e.currentTarget.dataset.id;
        if (id) {
            wx.navigateTo({
                url: `/pages/order-sub/detail/detail?id=${id}`
            });
        }
    },

    /**
     * 创建订单
     */
    createOrder() {
        wx.navigateTo({
            url: '/pages/order-sub/create/create'
        });
    },

    /**
     * 刷新列表（手动调用）
     */
    async refreshList() {
        // 清除缓存，强制重新加载
        clearCache('getOrders');
        this.setData({ page: 1 });
        await this.loadOrders();
    }
});
