/**
 * Cache Debug Panel
 * Shows cache statistics and provides manual cache control
 */

import React, { useState, useEffect } from 'react'
import { Card, Button, Space, Statistic, Row, Col, message, Popconfirm } from 'antd'
import { ReloadOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { getCacheStats, clearAllCache, invalidateCache } from '../utils/cachedAPI'

export function CacheDebugPanel() {
    const [stats, setStats] = useState({
        memoryEntries: 0,
        storageEntries: 0,
        storageMB: '0.00'
    })
    const [visible, setVisible] = useState(false)

    const refreshStats = () => {
        const currentStats = getCacheStats()
        setStats(currentStats)
    }

    useEffect(() => {
        if (visible) {
            refreshStats()
        }
    }, [visible])

    const handleClearAll = () => {
        clearAllCache()
        message.success('缓存已清空')
        refreshStats()
    }

    const handleClearNamespace = (namespace) => {
        invalidateCache(namespace)
        message.success(`${namespace} 缓存已清空`)
        refreshStats()
    }

    if (!visible) {
        return (
            <Button
                size="small"
                icon={<InfoCircleOutlined />}
                onClick={() => setVisible(true)}
                style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1000 }}
            >
                缓存统计
            </Button>
        )
    }

    return (
        <Card
            title="缓存调试面板"
            extra={
                <Button size="small" onClick={() => setVisible(false)}>
                    关闭
                </Button>
            }
            style={{
                position: 'fixed',
                bottom: 20,
                right: 20,
                width: 400,
                zIndex: 1000,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
        >
            <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                    <Statistic
                        title="内存缓存"
                        value={stats.memoryEntries}
                        suffix="条"
                    />
                </Col>
                <Col span={8}>
                    <Statistic
                        title="持久化缓存"
                        value={stats.storageEntries}
                        suffix="条"
                    />
                </Col>
                <Col span={8}>
                    <Statistic
                        title="存储占用"
                        value={stats.storageMB}
                        suffix="MB"
                    />
                </Col>
            </Row>

            <Space direction="vertical" style={{ width: '100%' }}>
                <Button
                    block
                    icon={<ReloadOutlined />}
                    onClick={refreshStats}
                >
                    刷新统计
                </Button>

                <Space style={{ width: '100%' }}>
                    <Button
                        size="small"
                        onClick={() => handleClearNamespace('orders')}
                    >
                        清空订单缓存
                    </Button>
                    <Button
                        size="small"
                        onClick={() => handleClearNamespace('purchases')}
                    >
                        清空采购缓存
                    </Button>
                    <Button
                        size="small"
                        onClick={() => handleClearNamespace('customers')}
                    >
                        清空客户缓存
                    </Button>
                </Space>

                <Popconfirm
                    title="确定要清空所有缓存吗？"
                    onConfirm={handleClearAll}
                    okText="确定"
                    cancelText="取消"
                >
                    <Button
                        block
                        danger
                        icon={<DeleteOutlined />}
                    >
                        清空所有缓存
                    </Button>
                </Popconfirm>

                <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                    <div>• 缓存TTL: 订单/采购 5分钟, 客户 10分钟</div>
                    <div>• 页面切换时优先使用缓存</div>
                    <div>• 数据修改时自动失效相关缓存</div>
                </div>
            </Space>
        </Card>
    )
}
