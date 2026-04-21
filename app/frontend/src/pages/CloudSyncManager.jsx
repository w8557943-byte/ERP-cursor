import React, { useEffect, useMemo, useState } from 'react'
import { Card, Button, Space, Table, Tag, App, Modal, Form, Input, Select, Row, Col, Statistic } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, CopyOutlined, UserOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/stores/authStore'
import { userAPI } from '@/services/api'

const { Option } = Select

const SUPER_ADMIN_PHONE = '13817508995'

const CloudSyncManager = () => {
  const { message } = App.useApp()
  const { user, isAuthenticated } = useAuthStore()

  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState([])
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [form] = Form.useForm()

  const isAdmin = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return role === 'admin' || role === 'administrator'
  }, [user?.role])

  const activeCount = useMemo(
    () => (users || []).filter((u) => String(u?.status || 'active').toLowerCase() === 'active').length,
    [users]
  )
  const disabledCount = useMemo(() => Math.max(0, (users || []).length - activeCount), [users, activeCount])

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeRole = (role) => {
    const v = String(role || '').toLowerCase()
    if (v === 'admin' || v === 'administrator') return 'admin'
    return 'operator'
  }
  const roleText = (role) => (normalizeRole(role) === 'admin' ? '管理员' : '操作员')
  const statusText = (status) => (String(status || 'active').toLowerCase() === 'disabled' ? '禁用' : '启用')
  const statusColor = (status) => (String(status || 'active').toLowerCase() === 'disabled' ? 'red' : 'green')

  const readListFromResponse = (res) => {
    if (Array.isArray(res)) return { list: res, pagination: null }
    const payload = res && typeof res === 'object' ? res : {}
    const list =
      (Array.isArray(payload.data) && payload.data) ||
      (Array.isArray(payload.users) && payload.users) ||
      (Array.isArray(payload.data?.users) && payload.data.users) ||
      (Array.isArray(payload.data?.data) && payload.data.data) ||
      []
    const pagination =
      (payload.pagination && typeof payload.pagination === 'object' ? payload.pagination : null) ||
      (payload.data?.pagination && typeof payload.data.pagination === 'object' ? payload.data.pagination : null) ||
      null
    return { list, pagination }
  }

  const loadUsers = async (opts = {}) => {
    const nextPage = opts.page != null ? Number(opts.page) : page
    const nextLimit = opts.limit != null ? Number(opts.limit) : limit
    const nextKeyword = opts.keyword != null ? String(opts.keyword || '').trim() : String(keyword || '').trim()
    setLoading(true)
    try {
      const res = await userAPI.getUsers({ page: nextPage, limit: nextLimit, keyword: nextKeyword })
      const { list, pagination } = readListFromResponse(res)
      setUsers(Array.isArray(list) ? list : [])
      const p = pagination || {}
      setPage(Number(p.page || nextPage))
      setLimit(Number(p.limit || nextLimit))
      setTotal(Number(p.total || (Array.isArray(list) ? list.length : 0)))
    } catch (e) {
      message.error(e?.message ? String(e.message) : '加载用户失败')
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) return
    if (!isAdmin) return
    loadUsers({ page: 1 })
  }, [isAuthenticated, isAdmin])

  const openCreate = () => {
    setEditingUser(null)
    setModalOpen(true)
    form.resetFields()
    form.setFieldsValue({ phone: '', password: '', role: 'operator', status: 'active' })
  }

  const openEdit = (record) => {
    const phoneOrUsername = normalizeText(record?.phone || record?.username)
    if (phoneOrUsername === SUPER_ADMIN_PHONE) {
      message.error('超管账号不可编辑')
      return
    }
    setEditingUser(record)
    setModalOpen(true)
    form.setFieldsValue({
      name: normalizeText(record?.name || record?.realName),
      username: normalizeText(record?.username),
      phone: normalizeText(record?.phone),
      password: '',
      role: normalizeRole(record?.role),
      status: String(record?.status || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active'
    })
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setEditingUser(null)
    form.resetFields()
  }

  const copyText = async (text) => {
    const value = String(text || '').trim()
    if (!value) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        message.success('已复制')
        return
      }
    } catch (_) { void 0 }
    try {
      const input = document.createElement('textarea')
      input.value = value
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '-9999px'
      document.body.appendChild(input)
      input.focus()
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      message.success('已复制')
    } catch (_) {
      message.error('复制失败')
    }
  }

  const validateForm = (values) => {
    const name = normalizeText(values.name)
    const username = normalizeText(values.username)
    const phoneInput = normalizeText(values.phone)
    const password = normalizeText(values.password)
    const role = normalizeRole(values.role)
    const status = String(values.status || 'active').toLowerCase() === 'disabled' ? 'disabled' : 'active'
    const usernameLooksPhone = /^1[3-9]\d{9}$/.test(username)
    const phone = phoneInput || (usernameLooksPhone ? username : '')

    if (!name) throw new Error('请输入用户名称')
    if (!username) throw new Error('请输入登入账号')
    if (phone) {
      if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('手机号格式错误')
    } else if (!editingUser) {
      throw new Error('请输入手机号')
    }
    if (!editingUser) {
      if (!password || password.length < 6) throw new Error('登入密码至少6位')
    } else {
      if (password && password.length < 6) throw new Error('登入密码至少6位')
    }

    const payload = { name, username, phone, role, status }
    if (!editingUser || password) payload.password = password
    return payload
  }

  const saveUser = async () => {
    try {
      const values = await form.validateFields()
      const payload = validateForm(values)
      setSaving(true)
      if (!editingUser) {
        await userAPI.createUser(payload)
        message.success('已保存')
      } else {
        const id = editingUser?._id || editingUser?.id
        await userAPI.updateUser(id, { id, ...payload })
        message.success('已保存')
      }
      closeModal()
      loadUsers({ page: 1 })
    } catch (e) {
      if (e && typeof e === 'object' && Array.isArray(e.errorFields)) return
      message.error(e?.message ? String(e.message) : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteUser = (record) => {
    const phoneOrUsername = normalizeText(record?.phone || record?.username)
    if (phoneOrUsername === SUPER_ADMIN_PHONE) {
      message.error('超管账号不可删除')
      return
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定删除用户“${normalizeText(record?.name || record?.realName || record?.username || '')}”吗？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await userAPI.deleteUser(record?._id || record?.id)
          message.success('已删除')
          loadUsers({ page: 1 })
        } catch (e) {
          message.error(e?.message ? String(e.message) : '删除失败')
        }
      }
    })
  }

  const columns = useMemo(() => ([
    {
      title: '用户名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      ellipsis: true,
      render: (_, r) => normalizeText(r?.name || r?.realName || r?.username || r?.phone || '用户')
    },
    {
      title: '登入账号',
      dataIndex: 'username',
      key: 'username',
      width: 160,
      ellipsis: true,
      render: (v) => normalizeText(v) || '-'
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 140,
      ellipsis: true,
      render: (v, r) => {
        const phone = normalizeText(v)
        const username = normalizeText(r?.username)
        if (!phone) return '-'
        return phone === username ? phone : phone
      }
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (v) => <Tag color={normalizeRole(v) === 'admin' ? 'blue' : 'default'}>{roleText(v)}</Tag>
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v) => <Tag color={statusColor(v)}>{statusText(v)}</Tag>
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      fixed: 'right',
      render: (_, r) => {
        const account = normalizeText(r?.phone || r?.username)
        const isSuperAdmin = account === SUPER_ADMIN_PHONE
        return (
          <Space size="small">
            <Button size="small" icon={<CopyOutlined />} onClick={() => copyText(account)} disabled={!account}>
              复制账号
            </Button>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} disabled={isSuperAdmin}>
              编辑
            </Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteUser(r)} disabled={isSuperAdmin}>
              删除
            </Button>
          </Space>
        )
      }
    }
  ]), [activeCount, disabledCount, users])

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserOutlined />
            <span>用户管理</span>
          </div>
          <div style={{ marginTop: 12, color: '#666' }}>请先登录</div>
        </Card>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserOutlined />
            <span>用户管理</span>
          </div>
          <div style={{ marginTop: 12, color: '#666' }}>无权限访问</div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600 }}>
              <UserOutlined />
              用户管理
            </div>
            <div style={{ marginTop: 6, color: '#666' }}>创建、编辑、删除系统用户账号</div>
          </div>
          <Space wrap>
            <Space.Compact>
              <Input
                placeholder="搜索名称/账号/手机号"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                allowClear
                style={{ width: 240 }}
                onPressEnter={() => loadUsers({ page: 1, keyword })}
              />
              <Button icon={<SearchOutlined />} loading={loading} onClick={() => loadUsers({ page: 1, keyword })}>
                搜索
              </Button>
            </Space.Compact>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增用户
            </Button>
          </Space>
        </div>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="当前页用户数" value={users.length} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="启用" value={activeCount} valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="禁用" value={disabledCount} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
      </Row>

      <Card>
        <Table
          columns={columns}
          dataSource={users}
          loading={loading}
          rowKey={(r) => String(r?._id || r?.id || r?.username || r?.phone || '')}
          pagination={{
            current: page,
            pageSize: limit,
            total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (t) => `共 ${t} 条记录`,
            onChange: (p, ps) => loadUsers({ page: p, limit: ps, keyword })
          }}
          scroll={{ x: 980 }}
        />
      </Card>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onOk={saveUser}
        onCancel={closeModal}
        confirmLoading={saving}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical" preserve={false} autoComplete="off">
          <Form.Item name="name" label="用户名称" rules={[{ required: true, message: '请输入用户名称' }]}>
            <Input placeholder="请输入用户名称" autoComplete="off" />
          </Form.Item>
          <Form.Item name="username" label="登入账号" rules={[{ required: true, message: '请输入登入账号' }]}>
            <Input placeholder="请输入登入账号（可用手机号）" autoComplete="off" />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="请输入手机号（新增时必填）" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="登入密码">
            <Input.Password
              placeholder={editingUser ? '不修改请留空（至少6位）' : '请输入密码（至少6位）'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select>
              <Option value="admin">管理员</Option>
              <Option value="operator">操作员</Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select>
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default CloudSyncManager
