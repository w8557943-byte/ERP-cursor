/**
 * 缓存配置 - 差异化TTL策略
 * 根据数据特性设置不同的缓存时间
 */

// 缓存TTL配置（毫秒）
export const CACHE_TTL = {
    // 静态数据 - 长缓存（变更频率低）
    customers: 30 * 60 * 1000,      // 30分钟 - 客户信息变更不频繁
    products: 30 * 60 * 1000,       // 30分钟 - 产品信息变更不频繁
    suppliers: 30 * 60 * 1000,      // 30分钟 - 供应商信息变更不频繁
    productCategories: 60 * 60 * 1000, // 60分钟 - 产品分类很少变更

    // 动态数据 - 中等缓存（中等变更频率）
    orders: 10 * 60 * 1000,         // 10分钟 - 订单数据中等频率变更
    purchaseOrders: 10 * 60 * 1000, // 10分钟 - 采购订单中等频率变更
    inventory: 5 * 60 * 1000,       // 5分钟 - 库存数据较频繁变更
    production: 5 * 60 * 1000,      // 5分钟 - 生产数据较频繁变更

    // 实时数据 - 短缓存（实时性要求高）
    stats: 2 * 60 * 1000,           // 2分钟 - 统计数据需要较新
    dashboard: 1 * 60 * 1000,       // 1分钟 - 工作台数据实时性要求高
    workbench: 1 * 60 * 1000,       // 1分钟 - 工作台概览数据

    // 详情数据 - 中等缓存
    orderDetail: 5 * 60 * 1000,     // 5分钟 - 订单详情
    customerDetail: 10 * 60 * 1000, // 10分钟 - 客户详情
    productDetail: 10 * 60 * 1000,  // 10分钟 - 产品详情

    // 用户数据 - 长缓存
    users: 30 * 60 * 1000,          // 30分钟 - 用户列表
    userProfile: 60 * 60 * 1000,    // 60分钟 - 用户个人信息
}

// 数据温度分类（用于冷热数据分离）
export const DATA_TEMPERATURE = {
    // 热数据 - 高频访问
    HOT: {
        namespaces: ['customers', 'products', 'suppliers', 'productCategories'],
        ttl: 30 * 60 * 1000,
        preload: true,           // 应用启动时预加载
        memoryCache: true,       // 使用内存缓存
        persist: true,           // 持久化到localStorage
    },

    // 温数据 - 中频访问
    WARM: {
        namespaces: ['orders', 'purchaseOrders', 'inventory', 'production'],
        ttl: 10 * 60 * 1000,
        preload: false,
        memoryCache: true,
        persist: true,
    },

    // 冷数据 - 低频访问
    COLD: {
        namespaces: ['orderDetail', 'stats', 'dashboard', 'workbench'],
        ttl: 2 * 60 * 1000,
        preload: false,
        memoryCache: true,
        persist: false,          // 不持久化，仅内存缓存
    }
}

// 获取命名空间的TTL
export function getTTL(namespace) {
    return CACHE_TTL[namespace] || CACHE_TTL.orders // 默认10分钟
}

// 获取命名空间的数据温度配置
export function getTemperatureConfig(namespace) {
    for (const [temp, config] of Object.entries(DATA_TEMPERATURE)) {
        if (config.namespaces.includes(namespace)) {
            return { temperature: temp, ...config }
        }
    }
    // 默认为温数据
    return { temperature: 'WARM', ...DATA_TEMPERATURE.WARM }
}

// 需要预加载的数据命名空间
export function getPreloadNamespaces() {
    return DATA_TEMPERATURE.HOT.namespaces
}

// 缓存失效规则配置
export const CACHE_INVALIDATION_RULES = {
    // 创建订单时失效的缓存
    createOrder: ['orders', 'stats', 'dashboard', 'workbench'],

    // 更新订单时失效的缓存
    updateOrder: ['orders', 'stats', 'dashboard', 'workbench'],

    // 删除订单时失效的缓存
    deleteOrder: ['orders', 'stats', 'dashboard', 'workbench'],

    // 创建客户时失效的缓存
    createCustomer: ['customers'],

    // 更新客户时失效的缓存
    updateCustomer: ['customers'],

    // 删除客户时失效的缓存
    deleteCustomer: ['customers'],

    // 创建产品时失效的缓存
    createProduct: ['products'],

    // 更新产品时失效的缓存
    updateProduct: ['products'],

    // 删除产品时失效的缓存
    deleteProduct: ['products'],

    // 库存变动时失效的缓存
    updateInventory: ['inventory', 'stats', 'dashboard'],

    // 生产状态变更时失效的缓存
    updateProduction: ['production', 'stats', 'dashboard'],
}

// 获取操作对应的失效规则
export function getInvalidationRule(action) {
    return CACHE_INVALIDATION_RULES[action] || []
}
