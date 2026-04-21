import React from 'react'
import { Layout, Dropdown, Avatar, Space, Typography, Badge, Button } from 'antd'
import { 
  UserOutlined, 
  BellOutlined, 
  LogoutOutlined, 
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from 'react-router-dom'

const { Header } = Layout
const { Text } = Typography

const AppHeader = ({ collapsed, setCollapsed }) => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const handleUserMenuClick = ({ key }) => {
    if (key === 'profile') {
      navigate('/cloud-sync')
      return
    }
    if (key === 'settings') {
      navigate('/settings')
      return
    }
    if (key === 'logout') {
      handleLogout()
    }
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人资料'
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置'
    },
    {
      type: 'divider'
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录'
    }
  ]

  return (
    <Header className="app-header" style={{ 
      background: '#fff', 
      padding: '0 24px',
      borderBottom: '1px solid #f0f0f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'fixed',
      width: '100%',
      top: 0,
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    }}>
      {/* 左侧：菜单折叠按钮和系统标题 */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setCollapsed(!collapsed)}
          style={{
            fontSize: '16px',
            width: 64,
            height: 64,
            marginRight: '16px',
            color: '#1890ff'
          }}
        />
        <div>
          <Text strong style={{ fontSize: '18px', color: '#1890ff' }}>
            荣禾ERP管理系统
          </Text>
          <Text type="secondary" style={{ marginLeft: '16px' }}>
            PC端管理后台
          </Text>
        </div>
      </div>

      {/* 右侧：用户操作 */}
      <Space size="middle">
        {/* 通知提醒 */}
        <Badge count={5} size="small">
          <BellOutlined 
            style={{ fontSize: '16px', cursor: 'pointer' }}
            onClick={() => navigate('/notifications')}
          />
        </Badge>

        {/* 用户信息 */}
        <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
          <Space style={{ cursor: 'pointer' }}>
            <Avatar 
              size="small" 
              icon={<UserOutlined />} 
              src={user?.avatar}
            />
            <Text>{user?.name || '管理员'}</Text>
          </Space>
        </Dropdown>
      </Space>
    </Header>
  )
}

export default AppHeader
