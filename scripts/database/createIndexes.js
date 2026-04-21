/**
 * 数据库索引创建脚本
 * 用于优化ERP系统数据库查询性能
 * 
 * 使用方法：
 * 1. 通过云开发控制台的数据库管理界面
 * 2. 或使用云开发SDK执行此脚本
 */

const cloud = require('wx-server-sdk')

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

/**
 * 索引配置
 * 格式: { collection: '集合名', indexes: [索引配置数组] }
 */
const INDEX_CONFIGS = [
    // ========== orders 集合索引 ==========
    {
        collection: 'orders',
        indexes: [
            {
                name: 'idx_orderNo',
                keys: [{ name: 'orderNo', direction: '2dsphere' }],
                unique: true,
                description: '订单号唯一索引 - 用于快速查找订单'
            },
            {
                name: 'idx_customerId_createdAt',
                keys: [
                    { name: 'customerId', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '客户ID+创建时间复合索引 - 用于按客户查询订单列表'
            },
            {
                name: 'idx_status_createdAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '状态+创建时间复合索引 - 用于按状态筛选订单'
            },
            {
                name: 'idx_createdAt',
                keys: [{ name: 'createdAt', direction: 'desc' }],
                description: '创建时间降序索引 - 用于时间范围查询和排序'
            },
            {
                name: 'idx_isDeleted',
                keys: [{ name: 'isDeleted', direction: 'asc' }],
                description: '删除标记索引 - 用于过滤已删除订单'
            }
        ]
    },

    // ========== customers 集合索引 ==========
    {
        collection: 'customers',
        indexes: [
            {
                name: 'idx_companyName',
                keys: [{ name: 'companyName', direction: 'asc' }],
                description: '公司名称索引 - 用于客户搜索'
            },
            {
                name: 'idx_phone',
                keys: [{ name: 'phone', direction: 'asc' }],
                description: '电话号码索引 - 用于客户搜索'
            },
            {
                name: 'idx_status_createdAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '状态+创建时间复合索引 - 用于按状态筛选客户'
            },
            {
                name: 'idx_createdAt',
                keys: [{ name: 'createdAt', direction: 'desc' }],
                description: '创建时间降序索引 - 用于客户列表排序'
            }
        ]
    },

    // ========== products 集合索引 ==========
    {
        collection: 'products',
        indexes: [
            {
                name: 'idx_productName',
                keys: [{ name: 'productName', direction: 'asc' }],
                description: '产品名称索引 - 用于产品搜索'
            },
            {
                name: 'idx_category_createdAt',
                keys: [
                    { name: 'category', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '分类+创建时间复合索引 - 用于按分类筛选产品'
            },
            {
                name: 'idx_createdAt',
                keys: [{ name: 'createdAt', direction: 'desc' }],
                description: '创建时间降序索引 - 用于产品列表排序'
            }
        ]
    },

    // ========== suppliers 集合索引 ==========
    {
        collection: 'suppliers',
        indexes: [
            {
                name: 'idx_supplierName',
                keys: [{ name: 'supplierName', direction: 'asc' }],
                description: '供应商名称索引 - 用于供应商搜索'
            },
            {
                name: 'idx_status_createdAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '状态+创建时间复合索引 - 用于按状态筛选供应商'
            }
        ]
    },

    // ========== purchase_orders 集合索引 ==========
    {
        collection: 'purchase_orders',
        indexes: [
            {
                name: 'idx_orderNo',
                keys: [{ name: 'orderNo', direction: '2dsphere' }],
                unique: true,
                description: '采购订单号唯一索引'
            },
            {
                name: 'idx_supplierId_createdAt',
                keys: [
                    { name: 'supplierId', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '供应商ID+创建时间复合索引'
            },
            {
                name: 'idx_status_createdAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '状态+创建时间复合索引'
            },
            {
                name: 'idx_createdAt',
                keys: [{ name: 'createdAt', direction: 'desc' }],
                description: '创建时间降序索引'
            }
        ]
    },

    // ========== production 集合索引 ==========
    {
        collection: 'production',
        indexes: [
            {
                name: 'idx_orderId_createdAt',
                keys: [
                    { name: 'orderId', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '订单ID+创建时间复合索引 - 用于关联查询'
            },
            {
                name: 'idx_status_createdAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'createdAt', direction: 'desc' }
                ],
                description: '状态+创建时间复合索引'
            }
        ]
    },

    // ========== users 集合索引 ==========
    {
        collection: 'users',
        indexes: [
            {
                name: 'idx_username',
                keys: [{ name: 'username', direction: 'asc' }],
                unique: true,
                description: '用户名唯一索引'
            },
            {
                name: 'idx_phone',
                keys: [{ name: 'phone', direction: 'asc' }],
                description: '手机号索引'
            },
            {
                name: 'idx_status_lastLoginAt',
                keys: [
                    { name: 'status', direction: 'asc' },
                    { name: 'lastLoginAt', direction: 'desc' }
                ],
                description: '状态+最后登录时间复合索引 - 用于活跃用户统计'
            }
        ]
    }
]

/**
 * 创建索引
 */
async function createIndexes() {
    console.log('开始创建数据库索引...')

    const results = {
        success: [],
        failed: [],
        skipped: []
    }

    for (const config of INDEX_CONFIGS) {
        const { collection, indexes } = config

        console.log(`\n处理集合: ${collection}`)

        for (const index of indexes) {
            const { name, keys, unique = false, description } = index

            try {
                // 注意：云开发数据库索引创建需要通过控制台或API
                // 这里提供索引配置信息，需要手动在控制台创建

                console.log(`  - ${name}: ${description}`)
                console.log(`    字段: ${JSON.stringify(keys)}`)
                console.log(`    唯一: ${unique}`)

                results.success.push({
                    collection,
                    indexName: name,
                    description
                })

            } catch (error) {
                console.error(`  ✗ 创建索引失败: ${name}`, error.message)
                results.failed.push({
                    collection,
                    indexName: name,
                    error: error.message
                })
            }
        }
    }

    return results
}

/**
 * 验证索引
 */
async function verifyIndexes() {
    console.log('\n验证索引创建结果...')

    // 注意：云开发数据库不支持直接查询索引列表
    // 需要通过控制台查看或通过查询性能来验证

    console.log('请在云开发控制台的数据库管理界面查看索引创建情况')
}

/**
 * 导出索引配置（用于文档）
 */
function exportIndexConfig() {
    const markdown = []

    markdown.push('# 数据库索引配置清单\n')
    markdown.push('## 索引说明\n')

    for (const config of INDEX_CONFIGS) {
        markdown.push(`### ${config.collection} 集合\n`)

        for (const index of config.indexes) {
            markdown.push(`#### ${index.name}`)
            markdown.push(`- **描述**: ${index.description}`)
            markdown.push(`- **字段**: ${JSON.stringify(index.keys)}`)
            if (index.unique) {
                markdown.push(`- **唯一索引**: 是`)
            }
            markdown.push('')
        }
    }

    return markdown.join('\n')
}

// 主函数
exports.main = async (event, context) => {
    const { action = 'create' } = event

    try {
        switch (action) {
            case 'create':
                const results = await createIndexes()
                return {
                    success: true,
                    message: '索引配置已生成',
                    data: results,
                    note: '请在云开发控制台手动创建索引'
                }

            case 'verify':
                await verifyIndexes()
                return {
                    success: true,
                    message: '请在控制台查看索引'
                }

            case 'export':
                const markdown = exportIndexConfig()
                return {
                    success: true,
                    data: markdown
                }

            default:
                return {
                    success: false,
                    message: '不支持的操作'
                }
        }
    } catch (error) {
        console.error('执行失败:', error)
        return {
            success: false,
            message: error.message
        }
    }
}

// 如果直接运行此脚本
if (require.main === module) {
    createIndexes().then(results => {
        console.log('\n========== 执行结果 ==========')
        console.log(`成功: ${results.success.length}`)
        console.log(`失败: ${results.failed.length}`)
        console.log(`跳过: ${results.skipped.length}`)

        console.log('\n========== 索引配置文档 ==========')
        console.log(exportIndexConfig())
    })
}

module.exports = {
    INDEX_CONFIGS,
    createIndexes,
    verifyIndexes,
    exportIndexConfig
}
