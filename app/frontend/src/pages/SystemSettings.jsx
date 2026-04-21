import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Form, Input, Button, Switch, Select, Row, Col, App, Tabs, Space, Tag, Checkbox, Modal } from 'antd'
import { ReloadOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/stores/authStore'
import { api, systemAPI, supplierAPI } from '@/services/api'

const { Option } = Select

function SystemSettings() {
  const { message } = App.useApp()
  const { user, isAuthenticated } = useAuthStore()

  const isAdmin = useMemo(() => {
    const role = String(user?.role || '').toLowerCase()
    return role === 'admin' || role === 'administrator'
  }, [user?.role])

  const [overview, setOverview] = useState(null)

  const [backupForm] = Form.useForm()
  const [storageForm] = Form.useForm()
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)
  const [cloudSyncResult, setCloudSyncResult] = useState(null)
  const [installRunning, setInstallRunning] = useState(false)
  const [installWipe, setInstallWipe] = useState(false)
  const [installCollections, setInstallCollections] = useState(['customers', 'orders', 'products'])
  const [installResult, setInstallResult] = useState(null)

  const [deletedSupplierLoading, setDeletedSupplierLoading] = useState(false)
  const [deletedSuppliers, setDeletedSuppliers] = useState([])
  const [deletedSupplierPagination, setDeletedSupplierPagination] = useState({ page: 1, limit: 20, total: 0 })
  const [deletedSupplierKeyword, setDeletedSupplierKeyword] = useState('')

  const [storageInfo, setStorageInfo] = useState(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageSaving, setStorageSaving] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [manualSyncLoading, setManualSyncLoading] = useState(false)
  const [pullFromCloudLoading, setPullFromCloudLoading] = useState(false)
  const [manualSyncResult, setManualSyncResult] = useState(null)

  const hasElectron = useMemo(() => typeof window !== 'undefined' && Boolean(window.electronAPI), [])
  const webSimDesktop = useMemo(() => {
    try {
      return !hasElectron && String(import.meta.env.VITE_WEB_SIMULATE_DESKTOP || '').trim().toLowerCase() === 'true'
    } catch (_) {
      return false
    }
  }, [hasElectron])
  const canPickDir = useMemo(() => Boolean(window?.electronAPI?.selectDirectory), [])
  const canRelaunch = useMemo(() => Boolean(window?.electronAPI?.relaunchApp), [])

  const getErrorText = useCallback((e, fallback) => {
    const resp = e?.response?.data
    const serverMessage = resp && typeof resp === 'object' ? (resp.message || resp.error) : ''
    return serverMessage ? String(serverMessage) : (e?.message ? String(e.message) : fallback)
  }, [])

  const isRouteNotFoundError = useCallback((e) => {
    const status = Number(e?.response?.status)
    if (status === 404) return true
    const msg = String(e?.response?.data?.message || e?.response?.data?.error || e?.message || '')
    if (!msg) return false
    return msg.includes('未找到匹配的路由') || /not\s*found/i.test(msg)
  }, [])

  const formatTs = useCallback((v) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return '-'
    const d = new Date(n)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }, [])

  const loadOverview = async () => {
    try {
      const data = await systemAPI.getOverview()
      setOverview(data || null)
    } catch (e) {
      message.error(getErrorText(e, '获取系统概览失败'))
      setOverview(null)
    }
  }

  const loadBackupConfig = async () => {
    setBackupLoading(true)
    try {
      const cfg = await systemAPI.getCloudSyncConfig()
      const normalized = {
        enabled: Boolean(cfg?.enabled),
        intervalMinutes: Number(cfg?.intervalMinutes || 1440),
        collections: Array.isArray(cfg?.collections) ? cfg.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
        exitSync: Boolean(cfg?.exitSync)
      }
      backupForm.setFieldsValue(normalized)
    } catch (e) {
      message.error(getErrorText(e, '获取云同步设置失败'))
      backupForm.setFieldsValue({ enabled: false, intervalMinutes: 1440, collections: [], exitSync: false })
    } finally {
      setBackupLoading(false)
    }
  }

  const normalizeDirFromDbPath = useCallback((p) => {
    const raw = String(p || '').trim()
    if (!raw) return ''
    const normalized = raw.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    if (idx <= 0) return raw
    return normalized.slice(0, idx)
  }, [])

  const loadStorageInfo = useCallback(async () => {
    setStorageLoading(true)
    try {
      const data = await systemAPI.getStoragePath()
      const info = data && typeof data === 'object' ? data : {}
      setStorageInfo(info)
      const dir = normalizeDirFromDbPath(info?.path)
      storageForm.setFieldsValue({
        localDbDir: dir,
        localDbPath: String(info?.path || '').trim()
      })
    } catch (e) {
      message.error(getErrorText(e, '获取数据库路径失败'))
      setStorageInfo(null)
      storageForm.setFieldsValue({ localDbDir: '', localDbPath: '' })
    } finally {
      setStorageLoading(false)
    }
  }, [getErrorText, message, normalizeDirFromDbPath, storageForm])

  const pickDbDirectory = useCallback(async () => {
    if (!canPickDir) return
    try {
      const picked = await window.electronAPI.selectDirectory()
      if (picked) storageForm.setFieldsValue({ localDbDir: String(picked) })
    } catch (e) {
      message.error(e?.message ? String(e.message) : '选择目录失败')
    }
  }, [canPickDir, message, storageForm])

  const saveStoragePath = useCallback(async () => {
    try {
      const values = await storageForm.validateFields()
      const dir = String(values?.localDbDir || '').trim()
      if (!dir) {
        message.error('请选择数据库安装目录')
        return
      }
      setStorageSaving(true)
      const res = await systemAPI.saveStoragePath(dir)
      const payload = res && typeof res === 'object' ? res : {}
      message.success(payload?.message ? String(payload.message) : '已保存，重启后生效')
      await loadStorageInfo()
    } catch (e) {
      if (e && typeof e === 'object' && Array.isArray(e.errorFields)) return
      message.error(getErrorText(e, '保存失败'))
    } finally {
      setStorageSaving(false)
    }
  }, [getErrorText, loadStorageInfo, message, storageForm])

  const saveStoragePathAndRelaunch = useCallback(async () => {
    try {
      const values = await storageForm.validateFields()
      const dir = String(values?.localDbDir || '').trim()
      if (!dir) {
        message.error('请选择数据库安装目录')
        return
      }
      setStorageSaving(true)
      const res = await systemAPI.saveStoragePath(dir)
      const payload = res && typeof res === 'object' ? res : {}
      message.success(payload?.message ? String(payload.message) : '已保存，正在重启')
      if (canRelaunch) {
        await window.electronAPI.relaunchApp()
        return
      }
      await loadStorageInfo()
    } catch (e) {
      if (e && typeof e === 'object' && Array.isArray(e.errorFields)) return
      message.error(getErrorText(e, '保存失败'))
    } finally {
      setStorageSaving(false)
    }
  }, [canRelaunch, getErrorText, loadStorageInfo, message, storageForm])

  const saveBackupConfig = async () => {
    try {
      const values = await backupForm.validateFields()
      setBackupLoading(true)
      await systemAPI.saveCloudSyncConfig({
        enabled: Boolean(values.enabled),
        intervalMinutes: Number(values.intervalMinutes || 1440),
        collections: Array.isArray(values.collections) ? values.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
        exitSync: Boolean(values.exitSync)
      })
      message.success('已保存')
      loadOverview()
    } catch (e) {
      if (e && typeof e === 'object' && Array.isArray(e.errorFields)) return
      message.error(getErrorText(e, '保存失败'))
    } finally {
      setBackupLoading(false)
    }
  }

  const runBackup = async (opts = {}) => {
    const silent = Boolean(opts?.silent)
    setBackupRunning(true)
    try {
      const values = backupForm.getFieldsValue()
      const collections = Array.isArray(values?.collections) ? values.collections.map((x) => String(x || '').trim()).filter(Boolean) : []
      const res = await systemAPI.runCloudSync({ mode: 'incremental', ...(collections.length ? { collections } : {}) })
      setInstallResult(null)
      setCloudSyncResult(res || null)
      if (!silent) message.success('已触发云同步')

      loadBackupConfig()
      loadOverview()
    } catch (e) {
      message.error(getErrorText(e, '云同步失败'))
    } finally {
      setBackupRunning(false)
    }
  }

  const cloudSyncCollectionOptions = useMemo(() => ([
    { value: 'customers', label: '客户' },
    { value: 'orders', label: '订单' },
    { value: 'products', label: '产品' }
  ]), [])

  const runInstallFromCloud = async () => {
    if (installRunning) return
    setInstallRunning(true)
    try {
      const selected = Array.isArray(installCollections) ? installCollections.map((x) => String(x || '').trim()).filter(Boolean) : []
      const res = await systemAPI.installLocalDbFromCloud({
        wipe: Boolean(installWipe),
        ...(selected.length ? { collections: selected } : {})
      })
      setInstallResult(res || null)
      message.success('已安装到本地数据库')
      loadStorageInfo()
      loadOverview()
    } catch (e) {
      message.error(getErrorText(e, '安装本地数据库失败'))
    } finally {
      setInstallRunning(false)
    }
  }

  const loadDeletedSuppliers = useCallback(async (opts = {}) => {
    setDeletedSupplierLoading(true)
    try {
      const page = opts.page != null ? Number(opts.page) : Number(deletedSupplierPagination.page || 1)
      const limit = opts.limit != null ? Number(opts.limit) : Number(deletedSupplierPagination.limit || 20)
      const keyword = opts.keyword != null ? String(opts.keyword || '').trim() : String(deletedSupplierKeyword || '').trim()

      const res = await supplierAPI.getDeletedSuppliers({ page, limit, keyword })
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) throw new Error(payload.message || '获取供应商回收站失败')
      const list = Array.isArray(payload.data?.list) ? payload.data.list : (Array.isArray(payload.list) ? payload.list : [])
      const paginationRaw = payload.data?.pagination || payload.pagination || {}
      setDeletedSuppliers(list)
      setDeletedSupplierPagination({
        page: Number(paginationRaw.page || page),
        limit: Number(paginationRaw.limit || limit),
        total: Number(paginationRaw.total || list.length)
      })
    } catch (e) {
      message.error(getErrorText(e, '获取供应商回收站失败'))
      setDeletedSuppliers([])
      setDeletedSupplierPagination({ page: 1, limit: 20, total: 0 })
    } finally {
      setDeletedSupplierLoading(false)
    }
  }, [deletedSupplierKeyword, deletedSupplierPagination.limit, deletedSupplierPagination.page, getErrorText, message])

  const restoreDeletedSupplier = useCallback((row) => {
    const id = String(row?._id || row?.id || '').trim()
    if (!id) return
    Modal.confirm({
      title: '恢复供应商',
      content: `确定要恢复供应商「${String(row?.name || '-')}」吗？`,
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          await supplierAPI.restoreSupplier(id)
          message.success('已恢复')
          loadDeletedSuppliers({ page: Number(deletedSupplierPagination.page || 1), limit: Number(deletedSupplierPagination.limit || 20), keyword: deletedSupplierKeyword })
        } catch (e) {
          message.error(getErrorText(e, '恢复失败'))
        }
      }
    })
  }, [deletedSupplierPagination.page, deletedSupplierPagination.limit, deletedSupplierKeyword, getErrorText, loadDeletedSuppliers, message])

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return
    loadOverview()
    loadBackupConfig()
    loadStorageInfo()
    loadManualSyncStatus()
  }, [isAuthenticated, isAdmin])

  const loadSyncStatus = async () => {
    setSyncLoading(true)
    try {
      const candidates = ['/manual-sync/status', '/sync/status', '/cloud/sync/status']
      let data = null
      for (const path of candidates) {
        try {
          const res = await api.get(path)
          const payload = res && typeof res === 'object' ? res : {}
          data = payload.data?.data || payload.data || payload
          if (data) break
        } catch (e) {
          if (!isRouteNotFoundError(e)) throw e
        }
      }
      if (!data) {
        setSyncStatus(null)
        message.error('当前后端版本不支持同步状态接口')
        return
      }
      setSyncStatus(data || null)
    } catch (e) {
      setSyncStatus(null)
      message.error(getErrorText(e, '获取同步状态失败'))
    } finally {
      setSyncLoading(false)
    }
  }

  const loadManualSyncStatus = async () => {
    setSyncLoading(true)
    try {
      const candidates = ['/manual-sync/status', '/sync/status', '/cloud/sync/status']
      let data = null
      for (const path of candidates) {
        try {
          const res = await api.get(path)
          const payload = res && typeof res === 'object' ? res : {}
          data = payload.data?.data || payload.data || payload
          if (data) break
        } catch (e) {
          if (!isRouteNotFoundError(e)) throw e
        }
      }
      if (!data) {
        setSyncStatus(null)
        return
      }
      setSyncStatus(data || null)
    } catch (e) {
      setSyncStatus(null)
      message.error(getErrorText(e, '获取同步状态失败'))
    } finally {
      setSyncLoading(false)
    }
  }

  const runManualSync = async (mode = 'incremental') => {
    setManualSyncLoading(true)
    try {
      const data = await systemAPI.runCloudSync({ mode })
      setManualSyncResult(data || null)
      message.success('同步任务已启动')
    } catch (e) {
      message.error(getErrorText(e, '触发同步失败'))
      setManualSyncResult(null)
    } finally {
      setManualSyncLoading(false)
    }
  }

  const runSyncFromCloudToLocal = async () => {
    if (pullFromCloudLoading) return
    setPullFromCloudLoading(true)
    try {
      const selected = Array.isArray(installCollections) ? installCollections.map((x) => String(x || '').trim()).filter(Boolean) : []
      const res = await systemAPI.installLocalDbFromCloud({
        wipe: Boolean(installWipe),
        ...(selected.length ? { collections: selected } : {})
      })
      setInstallResult(res || null)
      message.success('云端数据已下载到本地')
      loadStorageInfo()
      loadOverview()
      loadManualSyncStatus()
    } catch (e) {
      message.error(getErrorText(e, '从云端下载失败'))
    } finally {
      setPullFromCloudLoading(false)
    }
  }

  const deletedSupplierColumns = useMemo(() => ([
    { title: '名称', dataIndex: 'name', key: 'name', width: 220, render: (v) => String(v || '-') },
    { title: '简称', dataIndex: 'shortName', key: 'shortName', width: 160, render: (v) => String(v || '-') },
    { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 140, render: (v) => String(v || '-') },
    { title: '电话', dataIndex: 'phone', key: 'phone', width: 140, render: (v) => String(v || '-') },
    { title: '删除时间', dataIndex: 'deletedAt', key: 'deletedAt', width: 170, render: (v) => formatTs(v) },
    { title: '删除人', dataIndex: 'deletedBy', key: 'deletedBy', width: 220, render: (v) => String(v || '-') },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" onClick={() => restoreDeletedSupplier(row)}>
          恢复
        </Button>
      )
    }
  ]), [formatTs, restoreDeletedSupplier])

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ color: '#666' }}>请先登录</div>
        </Card>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <Card>
          <div style={{ color: '#666' }}>无权限访问</div>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 className="page-title" style={{ margin: 0 }}>系统设置</h2>
        <Space wrap>
          <span style={{ color: '#666' }}>{user?.name || user?.username || ''}</span>
        </Space>
      </div>

      <Tabs
        items={[
          {
            key: 'backup',
            label: '自动同步配置',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Form
                  form={backupForm}
                  layout="vertical"
                  initialValues={{ enabled: false, intervalMinutes: 1440, collections: [], exitSync: false }}
                >
                  <Card title="按时云同步" loading={backupLoading}>
                    <Row gutter={16}>
                      <Col xs={24} sm={8}>
                        <Form.Item name="enabled" label="启用按时云同步" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Form.Item name="intervalMinutes" label="同步周期">
                          <Select>
                            <Option value={360}>每6小时</Option>
                            <Option value={720}>每12小时</Option>
                            <Option value={1440}>每天</Option>
                            <Option value={10080}>每周</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Form.Item name="collections" label="同步内容选择" extra="不勾选则默认同步全部支持的数据">
                      <Checkbox.Group options={cloudSyncCollectionOptions} />
                    </Form.Item>
                  </Card>

                  <Card title="退出系统进行云同步" loading={backupLoading}>
                    <Form.Item name="exitSync" label="退出系统时自动云同步" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Card>

                  <Card title="手动同步" loading={backupLoading}>
                    <Space wrap>
                      <Button type="primary" loading={backupLoading} onClick={saveBackupConfig}>
                        保存设置
                      </Button>
                      <Button type="primary" loading={backupRunning} onClick={runBackup}>
                        立即云同步
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={() => { loadBackupConfig(); loadOverview() }}>
                        刷新状态
                      </Button>
                    </Space>

                    <div style={{ marginTop: 16, color: '#666' }}>
                      <div>上次同步时间：{formatTs(cloudSyncResult?.finishedAt)}</div>
                      <div>
                        同步结果：
                        {cloudSyncResult?.summary && typeof cloudSyncResult.summary === 'object'
                          ? Object.entries(cloudSyncResult.summary).map(([k, v]) => (
                            <Tag key={k}>{String(k)} {Number(v?.success || 0)}/{Number(v?.total || 0)}</Tag>
                          ))
                          : '-'}
                      </div>
                    </div>
                  </Card>
                </Form>
              </Space>
            )
          },
          {
            key: 'manual-sync',
            label: '数据同步',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card title="云服务状态" extra={
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={loadManualSyncStatus}
                    disabled={manualSyncLoading}
                  >
                    刷新
                  </Button>
                }>
                  <Space direction="vertical" size={12}>
                    <div>
                      <div>服务状态：</div>
                      <Tag color={syncStatus?.cloud?.healthy ? 'green' : 'red'}>
                        {syncStatus?.cloud?.message || '检查中...'}
                      </Tag>
                    </div>
                    {syncStatus?.cloudConfig?.ready === false ? (
                      <div style={{ color: '#cf1322' }}>
                        云开发配置缺失：{Array.isArray(syncStatus?.cloudConfig?.missing) ? syncStatus.cloudConfig.missing.join('；') : '请检查环境变量'}
                      </div>
                    ) : null}
                    <div>同步中：{syncStatus?.sync?.inProgress ? '是' : '否'}</div>
                    <div>上次同步：{syncStatus?.sync?.lastSyncTime ? formatTs(syncStatus.sync.lastSyncTime) : '未同步'}</div>
                  </Space>
                </Card>

                <Card title="手动同步" extra={
                  <Space>
                    <Button
                      type="primary"
                      loading={manualSyncLoading}
                      onClick={() => runManualSync('incremental')}
                      disabled={syncStatus?.sync?.inProgress}
                    >
                      同步到云端
                    </Button>
                    <Button
                      loading={pullFromCloudLoading}
                      onClick={runSyncFromCloudToLocal}
                    >
                      全量下载到本地
                    </Button>
                  </Space>
                }>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space style={{ width: '100%', flexWrap: 'wrap' }}>
                      <Button
                        onClick={() => runManualSync('incremental')}
                        loading={manualSyncLoading}
                        disabled={syncStatus?.sync?.inProgress}
                        style={{ flex: 1 }}
                      >
                        增量同步
                      </Button>
                      <Button
                        onClick={() => runManualSync('full')}
                        loading={manualSyncLoading}
                        disabled={syncStatus?.sync?.inProgress}
                        style={{ flex: 1 }}
                      >
                        全量同步
                      </Button>
                      <Button
                        onClick={() => runManualSync('force')}
                        loading={manualSyncLoading}
                        disabled={syncStatus?.sync?.inProgress}
                        style={{ flex: 1 }}
                      >
                        强制覆盖
                      </Button>
                    </Space>

                    <div style={{ marginTop: 16, fontSize: 14, color: '#666' }}>
                      <p><strong>同步说明：</strong></p>
                      <ul style={{ marginLeft: 20 }}>
                        <li>增量同步：仅同步上次同步后修改的数据</li>
                        <li>全量同步：同步所有本地数据到云端</li>
                        <li>强制覆盖：强制覆盖云端数据（谨慎使用）</li>
                      </ul>
                    </div>

                    {manualSyncResult && (
                      <div style={{ marginTop: 16, padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
                        <div style={{ marginBottom: 8 }}>
                          <strong>同步完成</strong>
                        </div>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          <div>类型：{manualSyncResult.type === 'full' ? '全量' : '增量'}</div>
                          <div>耗时：{(manualSyncResult.duration / 1000).toFixed(2)}秒</div>
                        </div>
                        {manualSyncResult.summary && (
                          <div style={{ marginTop: 8 }}>
                            <strong>同步结果：</strong>
                            {Object.entries(manualSyncResult.summary).map(([k, v]) => (
                              <Tag key={k} style={{ margin: 4 }}>
                                {String(k)}: {Number(v?.success || 0)}/{Number(v?.total || 0)}
                              </Tag>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </Space>
                  </Card>
              </Space>
            )
          },
          ...[
            {
              key: 'sync',
              label: '同步管理',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Card title="同步状态" loading={syncLoading}>
                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                      <div style={{ color: '#666' }}>
                        <div>运行状态：{String(syncStatus?.status?.state || syncStatus?.status || '-')}</div>
                        <div>已同步数量：{Number(syncStatus?.stats?.syncedCount || 0)}</div>
                        <div>待同步数量：{Number(syncStatus?.stats?.pendingCount || 0)}</div>
                        <div>冲突数量：{Number(syncStatus?.stats?.conflictCount || 0)}</div>
                      </div>
                      <Space>
                        <Button onClick={loadSyncStatus} icon={<ReloadOutlined />}>刷新</Button>
                        <Button type="primary" onClick={async () => {
                          try {
                            await systemAPI.runCloudSync({ mode: 'incremental' })
                            message.success('已触发增量同步')
                            loadSyncStatus()
                          } catch (e) {
                            message.error(getErrorText(e, '触发同步失败'))
                          }
                        }}>增量同步</Button>
                        <Button onClick={async () => {
                          try {
                            await systemAPI.runCloudSync({ mode: 'force' })
                            message.success('已触发强制同步')
                            loadSyncStatus()
                          } catch (e) {
                            message.error(getErrorText(e, '触发强制同步失败'))
                          }
                        }}>强制同步</Button>
                      </Space>
                    </Space>
                  </Card>
                </Space>
              )
            },
            {
              key: 'database',
              label: '本地数据库',
              children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card title="数据库安装目录" loading={storageLoading}>
                  <Form
                    form={storageForm}
                    layout="vertical"
                    initialValues={{ localDbDir: '', localDbPath: '' }}
                  >
                    <Row gutter={16}>
                      <Col xs={24} sm={20}>
                        <Form.Item
                          name="localDbDir"
                          label="数据库安装目录"
                          rules={[{ required: true, message: '请选择数据库安装目录' }]}
                        >
                          <Input placeholder={hasElectron ? '建议选择目录' : '浏览器模式下可输入目录'} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={4} style={{ display: 'flex', alignItems: 'end' }}>
                        <Button block icon={<FolderOpenOutlined />} disabled={!canPickDir} onClick={pickDbDirectory}>
                          选择
                        </Button>
                      </Col>
                    </Row>

                    <Form.Item name="localDbPath" label="当前数据库文件">
                      <Input readOnly />
                    </Form.Item>

                    <Space wrap>
                      <Button type="primary" loading={storageSaving} onClick={saveStoragePath}>
                        保存
                      </Button>
                      {canRelaunch ? (
                        <Button loading={storageSaving} onClick={saveStoragePathAndRelaunch}>
                          保存并重启
                        </Button>
                      ) : null}
                      <Button icon={<ReloadOutlined />} onClick={loadStorageInfo} disabled={storageSaving}>
                        刷新
                      </Button>
                    </Space>

                    <div style={{ marginTop: 16, color: '#666' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>来源：</span>
                        <Tag color={storageInfo?.source === 'env' ? 'blue' : (storageInfo?.source === 'settings' ? 'green' : 'default')}>
                          {storageInfo?.source === 'env' ? '环境变量' : (storageInfo?.source === 'settings' ? '设置文件' : '默认')}
                        </Tag>
                      </div>
                      <div>设置文件：{String(storageInfo?.settingsFile || '-')}</div>
                      <div>保存后需重启应用/后端服务生效</div>
                    </div>
                  </Form>
                </Card>

                <Card title="从云端安装到本地" extra={(
                  <Button type="primary" loading={installRunning} onClick={runInstallFromCloud}>
                    开始安装
                  </Button>
                )}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Space align="center">
                      <span>覆盖现有数据</span>
                      <Switch checked={installWipe} onChange={(v) => setInstallWipe(v)} disabled={installRunning} />
                    </Space>
                    <div>
                      <div style={{ marginBottom: 6 }}>安装内容选择</div>
                      <Checkbox.Group
                        options={cloudSyncCollectionOptions}
                        value={installCollections}
                        onChange={(v) => setInstallCollections(v)}
                        disabled={installRunning}
                        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                      />
                    </div>
                    <div style={{ color: '#666' }}>
                      <div>结果：{installResult ? '已完成' : '-'}</div>
                      <div>
                        详情：
                        {installResult?.result && typeof installResult.result === 'object'
                          ? Object.entries(installResult.result).map(([k, v]) => (
                            <Tag key={k}>{String(k)} +{Number(v?.created || 0)}/{Number(v?.total || 0)}</Tag>
                          ))
                          : '-'}
                      </div>
                    </div>
                  </Space>
                </Card>
              </Space>
              )
            }
          ]
        ]}
      />
    </div>
  )
}

export default SystemSettings
