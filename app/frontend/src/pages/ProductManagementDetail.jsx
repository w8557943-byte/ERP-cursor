import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Space, Tag } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { cachedProductAPI } from '../services/cachedAPI'

function ProductManagementDetail() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { id } = useParams()

  const [loading, setLoading] = useState(false)
  const [product, setProduct] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [stockType, setStockType] = useState('in')
  const [editForm] = Form.useForm()
  const [stockForm] = Form.useForm()

  const extractProduct = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    return data?.product ?? payload?.product ?? payload?.data?.product ?? null
  }

  const loadProduct = async () => {
    const usedId = String(id || '').trim()
    if (!usedId) {
      message.error('缺少产品ID')
      navigate('/products')
      return
    }
    setLoading(true)
    try {
      const res = await cachedProductAPI.getProduct(usedId)
      const p = extractProduct(res)
      if (!p) {
        message.error('产品不存在')
        navigate('/products')
        return
      }
      setProduct({ ...p, id: String(p?.id ?? p?._id ?? usedId) })
    } catch (e) {
      message.error('加载产品详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadProduct() }, [id])

  const openEdit = () => {
    if (!product) return
    editForm.setFieldsValue({
      productCode: product.productCode || '',
      name: product.name || '',
      category: product.category || '',
      specification: product.specification || '',
      material: product.material || '',
      unit: product.unit || '',
      price: product.price ?? 0,
      cost: product.cost ?? 0,
      minStock: product.minStock ?? 0,
      maxStock: product.maxStock ?? 0,
      description: product.description || '',
      status: product.status || 'active'
    })
    setEditOpen(true)
  }

  const handleSave = async () => {
    const usedId = String(id || '').trim()
    if (!usedId) return
    try {
      const values = await editForm.validateFields()
      const payload = {
        name: String(values.name || '').trim(),
        category: String(values.category || '').trim(),
        specification: String(values.specification || '').trim(),
        material: String(values.material || '').trim(),
        unit: String(values.unit || '').trim(),
        price: values.price != null ? Number(values.price) : 0,
        cost: values.cost != null ? Number(values.cost) : 0,
        minStock: values.minStock != null ? Number(values.minStock) : 0,
        maxStock: values.maxStock != null ? Number(values.maxStock) : 0,
        description: String(values.description || '').trim(),
        status: String(values.status || '').trim() || 'active'
      }
      await cachedProductAPI.updateProduct(usedId, payload)
      message.success('产品已更新')
      setEditOpen(false)
      editForm.resetFields()
      loadProduct()
    } catch (e) {
      message.error('保存失败')
    }
  }

  const openStock = (type) => {
    setStockType(type === 'out' ? 'out' : 'in')
    stockForm.resetFields()
    setStockOpen(true)
  }

  const handleStock = async () => {
    const usedId = String(id || '').trim()
    if (!usedId) return
    try {
      const values = await stockForm.validateFields()
      await cachedProductAPI.updateProductStock(usedId, {
        quantity: Number(values.quantity),
        type: stockType,
        remark: values.remark ? String(values.remark) : ''
      })
      message.success('库存已更新')
      setStockOpen(false)
      stockForm.resetFields()
      loadProduct()
    } catch (e) {
      message.error('更新失败')
    }
  }

  const handleDelete = async () => {
    const usedId = String(id || '').trim()
    if (!usedId) return
    Modal.confirm({
      title: '确认删除该产品？',
      content: product?.name ? `产品：${product.name}` : '',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await cachedProductAPI.deleteProduct(usedId)
          message.success('产品已删除')
          navigate('/products')
        } catch (e) {
          message.error('删除失败')
        }
      }
    })
  }

  const statusTag = useMemo(() => {
    const s = String(product?.status || '').trim() || 'active'
    if (s === 'active') return <Tag color="green">启用</Tag>
    if (s === 'inactive') return <Tag color="red">停用</Tag>
    return <Tag>{s}</Tag>
  }, [product?.status])

  return (
    <div>
      <Space align="center" style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')}>返回</Button>
        <h2 className="page-title" style={{ margin: 0 }}>{product?.name || '产品详情'}</h2>
        <Button icon={<ReloadOutlined />} onClick={loadProduct} loading={loading}>刷新</Button>
      </Space>

      <Card
        style={{ marginBottom: 12 }}
        title="基本信息"
        extra={(
          <Space>
            <Button icon={<EditOutlined />} onClick={openEdit} disabled={!product}>编辑</Button>
            <Button icon={<PlusOutlined />} onClick={() => openStock('in')} disabled={!product}>入库</Button>
            <Button danger onClick={() => openStock('out')} disabled={!product}>出库</Button>
            <Button danger icon={<DeleteOutlined />} onClick={handleDelete} disabled={!product}>删除</Button>
          </Space>
        )}
      >
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="产品编码">{product?.productCode || '-'}</Descriptions.Item>
          <Descriptions.Item label="分类">{product?.category || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag}</Descriptions.Item>
          <Descriptions.Item label="规格">{product?.specification || '-'}</Descriptions.Item>
          <Descriptions.Item label="材质">{product?.material || '-'}</Descriptions.Item>
          <Descriptions.Item label="单位">{product?.unit || '-'}</Descriptions.Item>
          <Descriptions.Item label="售价">{product?.price != null ? Number(product.price || 0).toFixed(2) : '-'}</Descriptions.Item>
          <Descriptions.Item label="成本">{product?.cost != null ? Number(product.cost || 0).toFixed(2) : '-'}</Descriptions.Item>
          <Descriptions.Item label="库存">{product?.stock != null ? Number(product.stock || 0) : '-'}</Descriptions.Item>
          <Descriptions.Item label="最低库存">{product?.minStock != null ? Number(product.minStock || 0) : '-'}</Descriptions.Item>
          <Descriptions.Item label="最高库存">{product?.maxStock != null ? Number(product.maxStock || 0) : '-'}</Descriptions.Item>
          <Descriptions.Item label="备注" span={3}>{product?.description || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Modal
        title="编辑产品"
        open={editOpen}
        onOk={handleSave}
        onCancel={() => { setEditOpen(false); editForm.resetFields() }}
        forceRender
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="productCode" label="产品编码">
            <Input disabled />
          </Form.Item>
          <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
            <Input placeholder="产品名称" />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请输入分类' }]}>
            <Input placeholder="分类" />
          </Form.Item>
          <Form.Item name="specification" label="规格">
            <Input placeholder="规格" />
          </Form.Item>
          <Form.Item name="material" label="材质">
            <Input placeholder="材质" />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
            <Input placeholder="单位" />
          </Form.Item>
          <Space size={12} style={{ width: '100%' }}>
            <Form.Item name="price" label="售价" style={{ flex: 1 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="cost" label="成本" style={{ flex: 1 }}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ width: '100%' }}>
            <Form.Item name="minStock" label="最低库存" style={{ flex: 1 }}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="maxStock" label="最高库存" style={{ flex: 1 }}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'inactive', label: '停用' }
              ]}
            />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={3} placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={stockType === 'out' ? '出库' : '入库'}
        open={stockOpen}
        onOk={handleStock}
        onCancel={() => { setStockOpen(false); stockForm.resetFields() }}
        forceRender
      >
        <Form form={stockForm} layout="vertical">
          <Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}>
            <InputNumber min={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ProductManagementDetail
