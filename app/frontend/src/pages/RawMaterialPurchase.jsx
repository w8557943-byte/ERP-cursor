import React, { useEffect, useMemo, useState } from 'react'
import { Card, Form, Input, Select, Space, Button, App, AutoComplete, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { purchaseAPI, supplierAPI } from '../services/api'
import { useNavigate } from 'react-router-dom'

function RawMaterialPurchase() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [suppliers, setSuppliers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  const unitOptions = useMemo(() => (
    ['公斤','片','只','个','套','米','卷','根','桶'].map(u => ({ label: u, value: u }))
  ), [])

  const supplierOptions = useMemo(() => (suppliers||[]).map(s => {
    const value = s.name || s.companyName || s.title || s.id || s._id
    const label = s.name || s.companyName || s.title || String(value || '')
    return { value: label, label }
  }), [suppliers])

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const res = await supplierAPI.getSuppliers({ page: 1, limit: 1000 })
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
        setSuppliers(list)
      } catch (_) {
        setSuppliers([])
      }
    }
    loadMeta()
  }, [])

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const values = await form.validateFields()
      const payload = {
        supplierName: values.supplierName,
        productTitle: values.goodsName,
        materialNo: values.materialNo,
        quantity: values.quantity,
        unit: values.unit,
        salePrice: values.salePrice,
        unitPrice: values.salePrice, // 进货单价
        amount: Number(values.quantity || 0) * Number(values.salePrice || 0),
        source: 'purchased',
        purchaseCategory: 'raw_materials', // 明确标记为原材料
        orderType: 'purchase',
        status: 'ordered', // 明确初始状态
        createdAt: new Date().toISOString(),
        notes: values.notes
      }
      const res = await purchaseAPI.createPurchaseOrder(payload)
      const serverNo = res?.data?.order?.orderNo || res?.data?.orderNumber || res?.orderNo
      message.success(serverNo ? `采购单已新增（编号：${serverNo}）` : '采购单已新增')
      navigate('/purchase')
    } catch (_) {
      message.error('提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  useEffect(() => {
  }, [form])

  const handleCancel = () => {
    navigate('/purchase')
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">辅材采购 - 新建订单</h2>
        <Card>
          <Form form={form} layout="vertical">
            <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}> 
              <Select
                style={{ width: 280 }}
                placeholder="请选择供应商"
                options={supplierOptions}
                showSearch
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>
            <Space size={16} wrap>
              <Form.Item name="goodsName" label="辅材名称" rules={[{ required: true, message: '请输入辅材名称' }]}> 
                <Input placeholder="请输入辅材名称" style={{ width: 240 }} />
              </Form.Item>
              <Form.Item name="materialNo" label="型号规格">
                <Input placeholder="请输入型号规格" style={{ width: 240 }} />
              </Form.Item>
            </Space>
            <Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}> 
              <Space.Compact>
                <Input type="number" placeholder="数量" style={{ width: 120 }} />
                <Form.Item name="unit" noStyle initialValue="片">
                  <Select style={{ width: 120 }} options={unitOptions} />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
            <Form.Item name="salePrice" label="进货价" rules={[{ required: true, message: '请输入进货价' }]}> 
              <Space size={8} align="center">
                <Input type="number" placeholder="进货价" style={{ width: 120 }} />
                <span>元</span>
              </Space>
            </Form.Item>
            <Form.Item name="notes" label="备注"> 
              <Input.TextArea placeholder="备注" rows={3} />
            </Form.Item>
            <Space size={12}>
              <Button type="primary" onClick={handleSubmit} loading={submitting}>保存</Button>
              <Button onClick={handleCancel}>取消</Button>
            </Space>
          </Form>
        </Card>
      </div>
    </ConfigProvider>
  )
}

export default RawMaterialPurchase
