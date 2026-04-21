import React, { startTransition } from 'react'
import { Menu } from 'antd'
import {
  ShoppingCartOutlined,
  LineChartOutlined,
  UserOutlined,
  AppstoreOutlined,
  DollarOutlined,
  SettingOutlined,
  CloudOutlined,
  DatabaseOutlined,
  AuditOutlined,
  CarOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation } from 'react-router-dom'

const AppSider = ({ collapsed }) => {
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    {
      key: '/data-management',
      icon: <LineChartOutlined />,
      label: '数据管理'
    },
    {
      key: '/customers',
      icon: <UserOutlined />,
      label: '客户管理'
    },
    {
      key: '/products',
      icon: <AppstoreOutlined />,
      label: '产品管理'
    },
    {
      key: '/orders',
      icon: <ShoppingCartOutlined />,
      label: '订单管理'
    },
    {
      key: '/purchase',
      icon: <AuditOutlined />,
      label: '采购管理'
    },
    {
      key: '/production',
      icon: <LineChartOutlined />,
      label: '生产管理'
    },
    {
      key: '/inventory',
      icon: <DatabaseOutlined />,
      label: '库存管理'
    },
    {
      key: '/shipping',
      icon: <CarOutlined />,
      label: '发货管理'
    },
    {
      key: '/employees',
      icon: <UserOutlined />,
      label: '员工管理'
    },
    {
      key: '/financial',
      icon: <DollarOutlined />,
      label: '财务管理'
    },
    {
      key: '/cloud-sync',
      icon: <CloudOutlined />,
      label: '用户管理'
    },
    {
      key: '/settings',
      icon: <SettingOutlined />,
      label: '系统设置'
    }
  ]

  const handleMenuClick = ({ key }) => {
    startTransition(() => {
      navigate(key)
    })
  }

  const selectedKey = (() => {
    const pathname = String(location?.pathname || '')
    const match = menuItems.find((it) => pathname === it.key || pathname.startsWith(`${it.key}/`))
    return match ? match.key : pathname
  })()

  return (
    <div style={{
      height: '100%',
      padding: '16px 0',
      backgroundColor: '#fafafa'
    }}>
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={handleMenuClick}
        style={{
          height: '100%',
          borderRight: 0,
          backgroundColor: 'transparent'
        }}
        inlineCollapsed={collapsed}
        theme="light"
      />
    </div>
  )
}

export default AppSider
