import React from 'react'
import { Card, Table, Tag, Space } from 'antd'
import { EyeOutlined, EditOutlined } from '@ant-design/icons'

const RecentOrders = ({ data, loading = false, onView, onEdit }) => {
  const columns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 120,
    },
    {
      title: '客户',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 100,
    },
    {
      title: '产品',
      dataIndex: 'productName',
      key: 'productName',
      width: 100,
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (amount) => `¥${amount.toLocaleString()}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const statusConfig = {
          pending: { color: 'orange', text: '待处理' },
          processing: { color: 'blue', text: '处理中' },
          completed: { color: 'green', text: '已完成' },
          cancelled: { color: 'red', text: '已取消' },
        }
        const config = statusConfig[status] || { color: 'default', text: status }
        return <Tag color={config.color}>{config.text}</Tag>
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      key: 'createTime',
      width: 120,
      render: (time) => new Date(time).toLocaleDateString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Space size="middle">
          <EyeOutlined 
            onClick={() => onView && onView(record)} 
            style={{ color: '#1890ff', cursor: 'pointer' }}
          />
          <EditOutlined 
            onClick={() => onEdit && onEdit(record)} 
            style={{ color: '#52c41a', cursor: 'pointer' }}
          />
        </Space>
      ),
    },
  ]

  return (
    <Card title="最近订单" loading={loading}>
      <Table
        columns={columns}
        dataSource={data}
        pagination={false}
        size="small"
        scroll={{ y: 300 }}
      />
    </Card>
  )
}

export default RecentOrders