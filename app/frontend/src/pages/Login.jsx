import React from 'react'
import { Form, Input, Button, Card, App } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

function Login() {
  const navigate = useNavigate()
  const [loading, setLoading] = React.useState(false)
  const { login, token, isAuthenticated } = useAuthStore()
  const { message } = App.useApp()

  React.useEffect(() => {
    if (token || isAuthenticated) {
      navigate('/data-management', { replace: true })
    }
  }, [token, isAuthenticated, navigate])

  const onFinish = async (values) => {
    setLoading(true)
    try {
      const result = await login(values)
      
      if (result.success) {
        message.success('登录成功')
        const authed = Boolean(useAuthStore.getState().token) || Boolean(useAuthStore.getState().isAuthenticated)
        if (authed) {
          navigate('/data-management', { replace: true })
        } else {
          setTimeout(() => navigate('/data-management', { replace: true }), 0)
        }
      } else {
        message.error(result.message || '用户名或密码错误')
      }
    } catch (error) {
      message.error('登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Card
        title="ERP 管理系统"
        style={{ width: 400 }}
        styles={{ header: { textAlign: 'center', fontSize: '24px', fontWeight: 'bold' } }}
      >
        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          layout="vertical"
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名!' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名" 
              size="large"
            />
          </Form.Item>

          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              size="large"
            />
          </Form.Item>

          <Form.Item>
            <Button 
              type="primary" 
              htmlType="submit" 
              loading={loading}
              size="large"
              style={{ width: '100%' }}
            >
              登录
            </Button>
          </Form.Item>
        </Form>
        
        <div style={{ textAlign: 'center', color: '#999', marginTop: '16px' }}>
          <p>请输入管理员账号与密码登录</p>
        </div>
      </Card>
    </div>
  )
}

export default Login
