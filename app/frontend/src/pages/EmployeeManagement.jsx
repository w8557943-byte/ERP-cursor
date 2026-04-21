import React, { useEffect, useMemo, useState } from 'react'
import { Card, Table, Input, Button, Space, Tag, App, Modal, Form, Select, DatePicker, InputNumber, ConfigProvider } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { employeeAPI } from '../services/api'
import zhCN from 'antd/locale/zh_CN'

const { Option } = Select

function EmployeeManagement() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [employees, setEmployees] = useState([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState(null)
  const [adjustRecord, setAdjustRecord] = useState(null)
  const [form] = Form.useForm()
  const [adjustForm] = Form.useForm()
  const [selectedYear, setSelectedYear] = useState(() => dayjs().year())

  const toNumber = (v) => {
    if (v === null || v === undefined || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  const computeRowSalary = (row) => {
    if (!row) return 0
    const rowDailySalary = toNumber(row.dailySalary)
    const rowHourlySalary = toNumber(row.hourlySalary)
    const rowAttendanceDays = toNumber(row.attendanceDays)
    const rowSubsidyPerDay = toNumber(row.subsidyPerDay)
    const rowOvertimeHours = toNumber(row.overtimeHours)
    const rowBonus = toNumber(row.bonus)
    const hasNormal = rowAttendanceDays !== undefined && rowDailySalary !== undefined
    const hasOvertime = rowOvertimeHours !== undefined && rowHourlySalary !== undefined
    const hasSubsidy = rowAttendanceDays !== undefined && rowSubsidyPerDay !== undefined
    const normalSalary = hasNormal ? rowAttendanceDays * rowDailySalary : undefined
    const overtimeSalary = hasOvertime ? rowOvertimeHours * rowHourlySalary : undefined
    const subsidyTotal = hasSubsidy ? rowAttendanceDays * rowSubsidyPerDay : undefined
    const parts = [normalSalary, overtimeSalary, subsidyTotal, rowBonus].filter(
      (v) => v !== undefined && !Number.isNaN(Number(v))
    )
    const totalRow = parts.length > 0
      ? parts.reduce((sum, v) => sum + Number(v), 0)
      : undefined
    if (!Number.isFinite(totalRow) || totalRow <= 0) {
      return 0
    }
    return totalRow
  }

  const stats = useMemo(() => {
    const employeeCount = employees.length
    let paidTotal = 0
    let pendingTotal = 0
    let bonusTotal = 0
    employees.forEach(e => {
      const paid = Number(e.yearPaidAmount || 0)
      const pending = Number(e.yearPendingAmount || 0)
      const bonus = Number(e.yearBonusAmount || 0)
      if (Number.isFinite(paid)) {
        paidTotal += paid
      }
      if (Number.isFinite(pending)) {
        pendingTotal += pending
      }
      if (Number.isFinite(bonus)) {
        bonusTotal += bonus
      }
    })
    return {
      employeeCount,
      paidTotal,
      pendingTotal,
      bonusTotal
    }
  }, [employees])

  const lastMonthStats = useMemo(() => {
    const baseDay = dayjs()
    const lastMonthMoment = baseDay.subtract(1, 'month')
    const lastYear = lastMonthMoment.year()
    const lastMonth = lastMonthMoment.month() + 1
    let lastMonthSalaryTotal = 0
    employees.forEach((e) => {
      const status = String(e.status || '').toLowerCase()
      if (status === 'left') {
        return
      }
      const details = Array.isArray(e.salaryDetails) ? e.salaryDetails : []
      details.forEach((detail) => {
        if (!detail) return
        const month = Number(detail.month)
        if (!Number.isFinite(month) || month < 1 || month > 12) {
          return
        }
        const yValue = detail.year
        let year = lastYear
        if (yValue !== null && yValue !== undefined && yValue !== '') {
          const n = Number(yValue)
          if (!Number.isFinite(n)) {
            return
          }
          year = n
        }
        if (year !== lastYear || month !== lastMonth) {
          return
        }
        const totalRow = computeRowSalary(detail)
        if (totalRow > 0) {
          lastMonthSalaryTotal += totalRow
        }
      })
    })
    return {
      lastMonthSalaryTotal
    }
  }, [employees])

  const salaryYears = useMemo(() => {
    const yearSet = new Set()
    employees.forEach((e) => {
      const details = Array.isArray(e.salaryDetails) ? e.salaryDetails : []
      details.forEach((detail) => {
        if (!detail) return
        const value = detail.year
        const year = Number(value)
        if (Number.isFinite(year)) {
          yearSet.add(year)
        }
      })
    })
    const result = Array.from(yearSet)
    if (result.length === 0) {
      const currentYear = dayjs().year()
      return [currentYear]
    }
    result.sort((a, b) => a - b)
    return result
  }, [employees])

  useEffect(() => {
    if (!salaryYears || salaryYears.length === 0) {
      return
    }
    if (!salaryYears.includes(selectedYear)) {
      setSelectedYear(salaryYears[salaryYears.length - 1])
    }
  }, [salaryYears, selectedYear])

  const monthlySalaryColumns = useMemo(() => {
    const cols = [
      {
        title: '年份',
        dataIndex: 'year',
        key: 'year'
      }
    ]
    for (let m = 1; m <= 12; m += 1) {
      cols.push({
        title: `${m}月`,
        dataIndex: `m${m}`,
        key: `m${m}`,
        align: 'right',
        render: (value) => `¥${Number(value || 0).toFixed(2)}`
      })
    }
    cols.push({
      title: '合计',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    })
    return cols
  }, [])

  const monthlySalaryData = useMemo(() => {
    const totals = Array(12).fill(0)
    employees.forEach((e) => {
      const status = String(e.status || '').toLowerCase()
      if (status === 'left') {
        return
      }
      const details = Array.isArray(e.salaryDetails) ? e.salaryDetails : []
      details.forEach((detail) => {
        if (!detail) return
        const month = Number(detail.month)
        if (!Number.isFinite(month) || month < 1 || month > 12) {
          return
        }
        let year = selectedYear
        const yValue = detail.year
        if (yValue !== null && yValue !== undefined && yValue !== '') {
          const n = Number(yValue)
          if (!Number.isFinite(n)) {
            return
          }
          year = n
        }
        if (year !== selectedYear) {
          return
        }
        const totalRow = computeRowSalary(detail)
        if (totalRow > 0) {
          const index = month - 1
          totals[index] += totalRow
        }
      })
    })
    const rowTotal = totals.reduce((sum, v) => sum + v, 0)
    const row = {
      key: `year_${selectedYear}`,
      year: `${selectedYear}年`,
      total: rowTotal
    }
    totals.forEach((value, index) => {
      const monthKey = `m${index + 1}`
      row[monthKey] = value
    })
    return [row]
  }, [employees, selectedYear])

  const departmentOptions = useMemo(() => {
    const set = new Set()
    employees.forEach(e => {
      if (e.department) {
        set.add(e.department)
      }
    })
    return Array.from(set).map(d => ({ value: d, label: d }))
  }, [employees])

  const loadEmployees = async (override = {}) => {
    setLoading(true)
    try {
      const keyword = Object.prototype.hasOwnProperty.call(override, 'keyword') ? override.keyword : searchKeyword
      const department = Object.prototype.hasOwnProperty.call(override, 'department') ? override.department : departmentFilter
      const params = {}
      if (keyword && String(keyword).trim()) {
        params.search = String(keyword).trim()
      }
      if (department) {
        params.department = department
      }
      const res = await employeeAPI.getEmployees(params)
      let list = []
      const payload = res && typeof res === 'object' && 'data' in res ? res.data : res
      if (Array.isArray(payload)) {
        list = payload
      } else if (Array.isArray(payload?.data)) {
        list = payload.data
      } else if (Array.isArray(payload?.employees)) {
        list = payload.employees
      } else if (Array.isArray(payload?.data?.employees)) {
        list = payload.data.employees
      }
      const mapped = list.map((item, index) => {
        const backendId = item._id ?? item.id ?? item.employeeId ?? null
        const rowKey = backendId ?? `emp_${index}`
        const monthlySalary = Number(item.monthlySalary ?? item.baseSalary ?? item.salaryBase ?? 0)
        const allowance = Number(item.allowance ?? 0)
        const yearBonusAmount = Number(item.yearBonusAmount ?? item.bonus ?? 0)
        let yearPaidAmount = 0
        let yearPendingAmount = 0
        const salaryDetails = Array.isArray(item.salaryDetails) ? item.salaryDetails : []
        salaryDetails.forEach((row) => {
          if (!row) return
          const totalRow = computeRowSalary(row)
          if (totalRow <= 0) {
            return
          }
          if (row.paid) {
            yearPaidAmount += totalRow
          } else {
            yearPendingAmount += totalRow
          }
        })
        const totalSalaryYear = yearPaidAmount + yearPendingAmount
        const hireDate = item.hireDate ?? item.entryDate ?? null
        return {
          ...item,
          _id: backendId,
          id: backendId,
          key: rowKey,
          name: item.name,
          department: item.department,
          position: item.position,
          hireDate,
          monthlySalary,
          allowance,
          yearPaidAmount,
          yearBonusAmount,
          yearPendingAmount,
          totalSalaryYear
        }
      })
      setEmployees(mapped)
    } catch (error) {
      console.error('加载员工数据失败:', error)
      message.error('加载员工数据失败')
      setEmployees([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEmployees()
  }, [])

  useEffect(() => {
    if (!modalOpen) {
      return
    }
    if (editingRecord) {
      const hireDateValue = editingRecord.hireDate ? dayjs(editingRecord.hireDate) : dayjs()
      form.setFieldsValue({
        name: editingRecord.name,
        department: editingRecord.department,
        position: editingRecord.position,
        hireDate: hireDateValue,
        monthlySalary: editingRecord.monthlySalary,
        allowance: editingRecord.allowance,
        timeSystem: editingRecord.timeSystem || '26_9'
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        hireDate: dayjs(),
        timeSystem: '26_9'
      })
    }
  }, [modalOpen, editingRecord, form])

  useEffect(() => {
    if (!adjustModalOpen || !adjustRecord) {
      return
    }
    adjustForm.resetFields()
    adjustForm.setFieldsValue({
      monthlySalary: adjustRecord.monthlySalary,
      allowance: adjustRecord.allowance,
      effectiveFrom: dayjs()
    })
  }, [adjustModalOpen, adjustRecord, adjustForm])

  const handleSearch = () => {
    loadEmployees()
  }

  const handleDepartmentChange = (value) => {
    const next = value || ''
    setDepartmentFilter(next)
    loadEmployees({ department: next })
  }

  const openCreateModal = () => {
    setEditingRecord(null)
    setModalOpen(true)
  }

  const openEditModal = (record) => {
    setEditingRecord(record)
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const hireDateValue = values.hireDate
      const monthlySalary = Number(values.monthlySalary || 0)
      const allowance = Number(values.allowance || 0)
      const timeSystem = values.timeSystem || '26_9'
      const payload = {
        name: String(values.name || '').trim(),
        department: values.department || '',
        position: values.position || '',
        hireDate: hireDateValue ? dayjs(hireDateValue).toDate() : undefined,
        monthlySalary,
        allowance,
        timeSystem
      }
      if (editingRecord && (editingRecord._id || editingRecord.id || editingRecord.key)) {
        const id = editingRecord._id || editingRecord.id || editingRecord.key
        await employeeAPI.updateEmployee(id, payload)
        message.success('员工记录已更新')
      } else {
        await employeeAPI.createEmployee(payload)
        message.success('员工记录已创建')
      }
      setModalOpen(false)
      setEditingRecord(null)
      form.resetFields()
      loadEmployees()
    } catch (error) {
      if (error && error.errorFields) {
        return
      }
      console.error('提交员工信息失败:', error)
      const msg = error && error.message ? error.message : '提交失败'
      message.error(msg)
    }
  }

  const handleCancel = () => {
    setModalOpen(false)
    setEditingRecord(null)
  }

  const handleAdjustSalary = (record) => {
    setAdjustRecord(record)
    setAdjustModalOpen(true)
  }

  const handleAdjustSubmit = async () => {
    try {
      if (!adjustRecord) {
        message.error('未选择员工')
        return
      }
      const id = adjustRecord._id || adjustRecord.id || adjustRecord.key
      const values = await adjustForm.validateFields()
      const monthlySalary = Number(values.monthlySalary || 0)
      const allowance = Number(values.allowance || 0)
      const effectiveFrom = values.effectiveFrom ? dayjs(values.effectiveFrom).toDate() : new Date()
      if (!id) {
        message.error('缺少员工ID')
        return
      }
      const newAdjustment = {
        monthlySalary,
        allowance,
        effectiveFrom,
        adjustedAt: new Date()
      }
      const history = Array.isArray(adjustRecord.salaryAdjustments)
        ? adjustRecord.salaryAdjustments
        : Array.isArray(adjustRecord.salaryAdjustmentHistory)
          ? adjustRecord.salaryAdjustmentHistory
          : []
      const payload = {
        monthlySalary,
        allowance,
        latestAdjustment: newAdjustment,
        salaryAdjustments: [...history, newAdjustment]
      }
      await employeeAPI.updateEmployee(id, payload)
      message.success('薪资已调整')
      setAdjustModalOpen(false)
      setAdjustRecord(null)
      loadEmployees()
    } catch (error) {
      if (error && error.errorFields) {
        return
      }
      console.error('调整薪资失败:', error)
      const msg = error && error.message ? error.message : '调整失败'
      message.error(msg)
    }
  }

  const columns = [
    {
      title: '员工姓名',
      dataIndex: 'name',
      key: 'name',
      width: 140,
      render: (_, record) => {
        const id = record._id
        return (
          <Button
            type="link"
            onClick={() => {
              if (id) {
                navigate(`/employees/${id}`, { state: { employee: record } })
              }
            }}
          >
            {record.name}
          </Button>
        )
      }
    },
    {
      title: '部门',
      dataIndex: 'department',
      key: 'department',
      width: 120
    },
    {
      title: '岗位',
      dataIndex: 'position',
      key: 'position',
      width: 120
    },
    {
      title: '入职时间',
      dataIndex: 'hireDate',
      key: 'hireDate',
      width: 140,
      render: (value) => {
        if (!value) return '-'
        const d = typeof value === 'number' || value instanceof Date ? dayjs(value) : dayjs(String(value))
        if (!d.isValid()) return '-'
        return d.format('YYYY-MM-DD')
      }
    },
    {
      title: '月薪工资',
      dataIndex: 'monthlySalary',
      key: 'monthlySalary',
      width: 130,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '补贴',
      dataIndex: 'allowance',
      key: 'allowance',
      width: 110,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '已发工资(今年)',
      dataIndex: 'yearPaidAmount',
      key: 'yearPaidAmount',
      width: 150,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '待发工资',
      dataIndex: 'yearPendingAmount',
      key: 'yearPendingAmount',
      width: 130,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '奖金',
      dataIndex: 'yearBonusAmount',
      key: 'yearBonusAmount',
      width: 110,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '工资总数',
      dataIndex: 'totalSalaryYear',
      key: 'totalSalaryYear',
      width: 140,
      render: (value) => `¥${Number(value || 0).toFixed(2)}`
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => handleAdjustSalary(record)}
          >
            调整薪资
          </Button>
          <Button
            type="link"
            danger
            size="small"
            onClick={async () => {
              const id = record._id
              if (!id) {
                message.error('缺少员工ID')
                return
              }
              try {
                await employeeAPI.updateEmployee(id, { status: 'left', leaveDate: new Date() })
                message.success('已标记离职')
                loadEmployees()
              } catch (error) {
                message.error('操作失败')
              }
            }}
          >
            离职
          </Button>
        </Space>
      )
    }
  ]

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">员工管理</h2>

        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#42a5f5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value">{stats.employeeCount}</div>
            <div className="stats-label">员工人数</div>
          </Card>
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#2196f3', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 20 }}>¥</span>
              <span style={{ fontSize: 22 }}>{lastMonthStats.lastMonthSalaryTotal.toFixed(2)}</span>
            </div>
            <div className="stats-label">上月员工工资额</div>
          </Card>
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#7e57c2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 20 }}>¥</span>
              <span style={{ fontSize: 22 }}>{stats.paidTotal.toFixed(2)}</span>
            </div>
            <div className="stats-label">年度已发工资</div>
          </Card>
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#4caf50', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 20 }}>¥</span>
              <span style={{ fontSize: 22 }}>{stats.pendingTotal.toFixed(2)}</span>
            </div>
            <div className="stats-label">年度待发工资</div>
          </Card>
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#ff8a65', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 20 }}>¥</span>
              <span style={{ fontSize: 22 }}>{stats.bonusTotal.toFixed(2)}</span>
            </div>
            <div className="stats-label">年度奖金总额</div>
          </Card>
        </div>

        <Card style={{ marginBottom: 24 }}>
          <Space size={20} wrap style={{ marginBottom: 16 }}>
            <Input
              placeholder="搜索员工姓名、部门"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{ width: 220 }}
            />
            <Select
              placeholder="部门"
              value={departmentFilter || undefined}
              onChange={handleDepartmentChange}
              allowClear
              style={{ width: 160 }}
            >
              {departmentOptions.map(opt => (
                <Option key={opt.value} value={opt.value}>{opt.label}</Option>
              ))}
            </Select>
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={handleSearch}
              loading={loading}
            >
              搜索
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
            >
              新增员工信息
            </Button>
          </Space>
        </Card>

        <Card>
          <Table
            columns={columns}
            dataSource={employees}
            loading={loading}
            pagination={{
              total: employees.length,
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`
            }}
            scroll={{ x: 1000 }}
            rowKey="key"
          />
        </Card>

        <Card style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>年度月份工资汇总</span>
            <Space>
              <span>年份</span>
              <Select
                value={selectedYear}
                style={{ width: 120 }}
                onChange={setSelectedYear}
              >
                {salaryYears.map((year) => (
                  <Option key={year} value={year}>
                    {year}年
                  </Option>
                ))}
              </Select>
            </Space>
          </div>
          <Table
            columns={monthlySalaryColumns}
            dataSource={monthlySalaryData}
            pagination={false}
            bordered
            size="small"
            rowKey="key"
          />
        </Card>

        <Modal
          title={editingRecord ? '编辑员工信息' : '新增员工信息'}
          open={modalOpen}
          onOk={handleSubmit}
          onCancel={handleCancel}
          destroyOnHidden
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="员工姓名" rules={[{ required: true, message: '请输入员工姓名' }]}>
              <Input placeholder="请输入员工姓名" />
            </Form.Item>
            <Form.Item name="department" label="部门">
              <Input placeholder="请输入部门" />
            </Form.Item>
            <Form.Item name="position" label="岗位">
              <Input placeholder="请输入岗位" />
            </Form.Item>
            <Form.Item name="hireDate" label="入职时间" rules={[{ required: true, message: '请选择入职时间' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="timeSystem" label="时间制" rules={[{ required: true, message: '请选择时间制' }]}>
              <Select placeholder="请选择时间制">
                <Option value="26_9">26天9小时制</Option>
                <Option value="30_9">30天9小时制</Option>
              </Select>
            </Form.Item>
            <Form.Item name="monthlySalary" label="月薪工资">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="allowance" label="补贴">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="调整薪资"
          open={adjustModalOpen}
          onOk={handleAdjustSubmit}
          onCancel={() => {
            setAdjustModalOpen(false)
            setAdjustRecord(null)
          }}
          destroyOnHidden
        >
          <Form form={adjustForm} layout="vertical">
            <Form.Item name="monthlySalary" label="新的月薪工资" rules={[{ required: true, message: '请输入月薪工资' }]}>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="allowance" label="新的补贴">
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="effectiveFrom" label="生效时间" rules={[{ required: true, message: '请选择生效时间' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export default EmployeeManagement
