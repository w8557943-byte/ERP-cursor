import React from 'react'
import { Layout as AntLayout } from 'antd'
import { Outlet } from 'react-router-dom'
import AppHeader from './AppHeader'
import AppSider from './AppSider'

const { Sider, Content } = AntLayout

const Layout = () => {
  const [collapsed, setCollapsed] = React.useState(false)

  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <AppHeader collapsed={collapsed} setCollapsed={setCollapsed} />
      <AntLayout>
        <Sider 
          collapsible 
          trigger={null}
          collapsed={collapsed} 
          onCollapse={setCollapsed}
          width={200}
          style={{
            background: '#fff',
            boxShadow: '2px 0 6px rgba(0,21,41,0.1)'
          }}
        >
          <AppSider collapsed={collapsed} />
        </Sider>
        <Content
          style={{
            margin: 0,
            padding: 24,
            background: '#f0f2f5',
            minHeight: 280
          }}
        >
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}

export default Layout
