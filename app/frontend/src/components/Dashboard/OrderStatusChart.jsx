import React from 'react'
import { Card } from 'antd'
import { Pie } from '@ant-design/charts'

const OrderStatusChart = ({ data, loading = false }) => {
  const config = {
    data: data || [],
    angleField: 'count',
    colorField: 'status',
    radius: 0.8,
    label: {
      type: 'spider',
      content: '{name}\n{percentage}',
    },
    interactions: [
      {
        type: 'element-active',
      },
    ],
  }

  return (
    <Card title="订单状态分布" loading={loading}>
      <Pie {...config} />
    </Card>
  )
}

export default OrderStatusChart