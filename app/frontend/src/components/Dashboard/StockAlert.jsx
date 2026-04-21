import React from 'react'
import { Card, List, Tag, Button } from 'antd'
import { WarningOutlined } from '@ant-design/icons'

const StockAlert = ({ data, loading = false, onReplenish }) => {
  const getStockLevel = (stock, minStock) => {
    if (stock === 0) return { color: 'red', text: '缺货', level: 'high' }
    if (stock <= minStock) return { color: 'orange', text: '低库存', level: 'medium' }
    return { color: 'green', text: '正常', level: 'low' }
  }

  return (
    <Card 
      title={
        <span>
          <WarningOutlined style={{ color: '#faad14', marginRight: 8 }} />
          库存预警
        </span>
      }
      loading={loading}
      extra={
        <Button type="link" size="small" onClick={() => onReplenish && onReplenish()}>
          查看全部
        </Button>
      }
    >
      <List
        dataSource={data}
        renderItem={(item) => {
          const stockLevel = getStockLevel(item.stock, item.minStock)
          
          return (
            <List.Item
              actions={[
                <Button 
                  type="link" 
                  size="small" 
                  onClick={() => onReplenish && onReplenish(item)}
                >
                  补货
                </Button>
              ]}
            >
              <List.Item.Meta
                title={
                  <span>
                    {item.productName}
                    <Tag 
                      color={stockLevel.color} 
                      style={{ marginLeft: 8 }}
                    >
                      {stockLevel.text}
                    </Tag>
                  </span>
                }
                description={`库存: ${item.stock} / 安全库存: ${item.minStock}`}
              />
            </List.Item>
          )
        }}
      />
    </Card>
  )
}

export default StockAlert