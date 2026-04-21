import React, { useEffect, useMemo, useState } from 'react'
import { Card, Descriptions, Tag, Space, Spin, App, Button, Timeline, Table, Modal, Form, Input, DatePicker, InputNumber, Checkbox, Select, Tooltip } from 'antd'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import { employeeAPI } from '../services/api'

function EmployeeDetail() {
  const baseYear = dayjs().year()
  const baseMonth = dayjs().month() + 1
  const { message } = App.useApp()
  const { id } = useParams()
  const location = useLocation()
  const locationEmployee = location && location.state && location.state.employee ? location.state.employee : null
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [employee, setEmployee] = useState(locationEmployee || null)
  const [infoModalOpen, setInfoModalOpen] = useState(false)
  const [salaryEditMode, setSalaryEditMode] = useState(false)
  const [salaryTable, setSalaryTable] = useState([])
  const [paidModalOpen, setPaidModalOpen] = useState(false)
  const [paidMonths, setPaidMonths] = useState([])
  const [currentYear, setCurrentYear] = useState(baseYear)
  const [eventModalOpen, setEventModalOpen] = useState(false)
  const [eventRow, setEventRow] = useState(null)
  const [eventForm] = Form.useForm()
  const [infoForm] = Form.useForm()

  const loadEmployee = async () => {
    if (!id) {
      message.error('缺少员工ID')
      return
    }
    setLoading(true)
    try {
      const resp = await employeeAPI.getEmployee(id)
      const raw = resp?.data || resp || {}
      if (!raw || Object.keys(raw).length === 0) {
        message.error('未找到员工信息')
        setEmployee(null)
        return
      }
      const expected = locationEmployee
      let merged = raw
      if (expected) {
        const expectedId = expected._id || expected.id || expected.employeeId
        const rawId = raw._id || raw.id || raw.employeeId
        const expectedName = String(expected.name || '').trim()
        const rawName = String(raw.name || '').trim()
        if (expectedId && rawId && String(expectedId) === String(rawId)) {
          if (expectedName && rawName && expectedName !== rawName) {
            merged = {
              ...raw,
              name: expected.name
            }
          }
        }
      }
      const monthlySalary = Number(merged.monthlySalary ?? merged.baseSalary ?? merged.salaryBase ?? 0)
      const allowance = Number(merged.allowance ?? 0)
      const yearBonusAmount = Number(merged.yearBonusAmount ?? merged.bonus ?? 0)
      const toNumber = (v) => {
        if (v === null || v === undefined || v === '') return undefined
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      }
      let yearPaidAmount = 0
      let yearPendingAmount = 0
      const salaryDetails = Array.isArray(merged.salaryDetails) ? merged.salaryDetails : []
      salaryDetails.forEach((row) => {
        if (!row) return
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
          return
        }
        if (row.paid) {
          yearPaidAmount += totalRow
        } else {
          yearPendingAmount += totalRow
        }
      })
      const totalSalaryYear = yearPaidAmount + yearPendingAmount
      const hireDate = merged.hireDate ?? merged.entryDate ?? null
      const status = merged.status === 'left' || merged.status === 'resigned' ? 'left' : 'active'
      const salaryAdjustments = Array.isArray(merged.salaryAdjustments)
        ? merged.salaryAdjustments
        : Array.isArray(merged.salaryAdjustmentHistory)
          ? merged.salaryAdjustmentHistory
          : merged.latestAdjustment
            ? [merged.latestAdjustment]
            : []
      const timeSystem = merged.timeSystem || '26_9'
      setEmployee({
        ...merged,
        monthlySalary,
        allowance,
        yearPaidAmount,
        yearBonusAmount,
        yearPendingAmount,
        totalSalaryYear,
        hireDate,
        status,
        salaryAdjustments,
        salaryDetails,
        timeSystem
      })
    } catch (e) {
      message.error('加载员工详情失败')
      setEmployee(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!id) {
      return
    }
    if (locationEmployee) {
      return
    }
    loadEmployee()
  }, [id, locationEmployee])

  useEffect(() => {
    if (!employee) {
      setSalaryTable([])
      return
    }
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const targetYear = currentYear || baseYear
    const allDetails = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
    const details = allDetails.filter((item) => {
      if (!item) return false
      const yValue = item.year
      if (yValue === null || yValue === undefined || yValue === '') {
        return targetYear === baseYear
      }
      const n = Number(yValue)
      if (!Number.isFinite(n)) {
        return false
      }
      return n === targetYear
    })
    const normalizeField = (v) => {
      if (v === null || v === undefined) return undefined
      const n = Number(v)
      if (!Number.isFinite(n) || n === 0) return undefined
      return n
    }
    const round2 = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n)) {
        return undefined
      }
      return Math.round(n * 100) / 100
    }
    const getBaseByMonth = (year, month) => {
      const monthEnd = dayjs(`${year}-${month}-01`).endOf('month')
      let baseMonthly = Number(employee.monthlySalary || 0)
      let baseAllowance = Number(employee.allowance || 0)
      const adjustments = Array.isArray(employee.salaryAdjustments) ? [...employee.salaryAdjustments] : []
      adjustments.forEach((adj) => {
        if (!adj || !adj.effectiveFrom) return
        const eff = dayjs(adj.effectiveFrom)
        if (!eff.isValid()) return
        if (eff.isAfter(monthEnd, 'day')) {
          return
        }
        if (adj.monthlySalary !== null && adj.monthlySalary !== undefined) {
          const m = Number(adj.monthlySalary)
          if (Number.isFinite(m)) {
            baseMonthly = m
          }
        }
        if (adj.allowance !== null && adj.allowance !== undefined) {
          const a = Number(adj.allowance)
          if (Number.isFinite(a)) {
            baseAllowance = a
          }
        }
      })
      return {
        monthlySalary: baseMonthly,
        allowance: baseAllowance
      }
    }
    const getRates = (year, month) => {
      const base = getBaseByMonth(year, month)
      const type = employee.timeSystem || '26_9'
      const dayCount = type === '30_9' ? 30 : 26
      const hoursPerDay = 9
      const monthly = Number(base.monthlySalary || 0)
      const allowance = Number(base.allowance || 0)
      if (!Number.isFinite(monthly) || monthly <= 0) {
        return {
          daily: undefined,
          hourly: undefined,
          subsidyPerDay: undefined
        }
      }
      const daily = round2(monthly / dayCount)
      const hourly = daily !== undefined ? round2(daily / hoursPerDay) : undefined
      const subsidyPerDay = Number.isFinite(allowance) && allowance > 0 ? round2(allowance / dayCount) : undefined
      return {
        daily,
        hourly,
        subsidyPerDay
      }
    }
    const table = months.map((m, index) => {
      const found = details.find((item) => Number(item.month) === m) || {}
      const rates = getRates(targetYear, m)
      const ms = found.monthlySalary
      let monthlySalary
      if (ms === null || ms === undefined || Number(ms) === 0) {
        const base = getBaseByMonth(targetYear, m)
        monthlySalary = base.monthlySalary && Number(base.monthlySalary) !== 0
          ? Number(base.monthlySalary)
          : undefined
      } else {
        monthlySalary = Number(ms)
      }
      return {
        key: `${targetYear}-${m}`,
        index,
        year: targetYear,
        month: m,
        name: employee.name || '',
        monthlySalary,
        dailySalary: normalizeField(rates.daily),
        hourlySalary: normalizeField(rates.hourly),
        attendanceDays: normalizeField(found.attendanceDays),
        subsidyPerDay: normalizeField(rates.subsidyPerDay),
        overtimeHours: normalizeField(found.overtimeHours),
        bonus: normalizeField(found.bonus),
        paid: Boolean(found.paid),
        eventNote: found.eventNote || ''
      }
    })
    setSalaryTable(table)
  }, [employee, currentYear])

  useEffect(() => {
    if (!employee) {
      setPaidMonths([])
      return
    }
    const details = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
    const selected = details
      .filter((item) => item && item.paid)
      .map((item) => Number(item.month))
      .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
    setPaidMonths(selected)
  }, [employee])

  const statusTag = useMemo(() => {
    if (!employee) return null
    if (employee.status === 'left') {
      return <Tag color="red">已离职</Tag>
    }
    return <Tag color="green">在职</Tag>
  }, [employee])

  const adjustmentItems = useMemo(() => {
    if (!employee || !Array.isArray(employee.salaryAdjustments) || !employee.salaryAdjustments.length) {
      return []
    }
    const list = [...employee.salaryAdjustments]
    list.sort((a, b) => {
      const da = a.effectiveFrom ? new Date(a.effectiveFrom).getTime() : 0
      const db = b.effectiveFrom ? new Date(b.effectiveFrom).getTime() : 0
      return da - db
    })
    return list
  }, [employee])

  const formatMoney = (v) => `¥${Number(v || 0).toFixed(2)}`
  const formatMoneyCell = (v) => {
    if (v === null || v === undefined) {
      return ''
    }
    const n = Number(v)
    if (!Number.isFinite(n) || n === 0) {
      return ''
    }
    return `¥${n.toFixed(2)}`
  }

  const formatDate = (v, withTime) => {
    if (!v) return '-'
    const d = typeof v === 'number' || v instanceof Date ? dayjs(v) : dayjs(String(v))
    if (!d.isValid()) return '-'
    return d.format(withTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD')
  }

  const salaryRows = useMemo(() => {
    const type = employee && employee.timeSystem ? employee.timeSystem : '26_9'
    const dayCount = type === '30_9' ? 30 : 26
    return salaryTable.map((row) => {
      const monthlySalary = row.monthlySalary !== undefined && row.monthlySalary !== null ? Number(row.monthlySalary) : undefined
      const dailySalary = row.dailySalary !== undefined && row.dailySalary !== null ? Number(row.dailySalary) : undefined
      const hourlySalary = row.hourlySalary !== undefined && row.hourlySalary !== null ? Number(row.hourlySalary) : undefined
      const attendanceDays = row.attendanceDays !== undefined && row.attendanceDays !== null ? Number(row.attendanceDays) : undefined
      const subsidyPerDay = row.subsidyPerDay !== undefined && row.subsidyPerDay !== null ? Number(row.subsidyPerDay) : undefined
      const overtimeHours = row.overtimeHours !== undefined && row.overtimeHours !== null ? Number(row.overtimeHours) : undefined
      const bonus = row.bonus !== undefined && row.bonus !== null ? Number(row.bonus) : undefined

      const hasNormal = attendanceDays !== undefined && dailySalary !== undefined
      const hasOvertime = overtimeHours !== undefined && hourlySalary !== undefined
      const hasSubsidy = attendanceDays !== undefined && subsidyPerDay !== undefined

      let normalSalary
      const isFullAttendance = attendanceDays !== undefined && attendanceDays === dayCount
      const noOvertime = overtimeHours === undefined
      if (monthlySalary !== undefined && isFullAttendance && noOvertime) {
        normalSalary = monthlySalary
      } else {
        normalSalary = hasNormal ? attendanceDays * dailySalary : undefined
      }
      const overtimeSalary = hasOvertime ? overtimeHours * hourlySalary : undefined
      const subsidyTotal = hasSubsidy ? attendanceDays * subsidyPerDay : undefined
      const parts = [normalSalary, overtimeSalary, subsidyTotal, bonus].filter(
        (v) => v !== undefined && !Number.isNaN(Number(v))
      )
      const total = parts.length > 0
        ? parts.reduce((sum, v) => sum + Number(v), 0)
        : undefined

      return {
        ...row,
        monthLabel: `${row.month}月`,
        monthlySalary,
        dailySalary,
        hourlySalary,
        attendanceDays,
        subsidyPerDay,
        overtimeHours,
        bonus,
        normalSalary,
        overtimeSalary,
        subsidyTotal,
        total
      }
    })
  }, [salaryTable, employee])

  const salarySummary = useMemo(() => {
    let yearPaidAmount = 0
    let yearPendingAmount = 0
    salaryRows.forEach((row) => {
      const total = Number(row.total || 0)
      if (!Number.isFinite(total) || total <= 0) {
        return
      }
      if (row.paid) {
        yearPaidAmount += total
      } else {
        yearPendingAmount += total
      }
    })
    const totalSalaryYear = yearPaidAmount + yearPendingAmount
    return {
      yearPaidAmount,
      yearPendingAmount,
      totalSalaryYear
    }
  }, [salaryRows])

  const yearOptions = useMemo(() => {
    const yearsSet = new Set()
    yearsSet.add(baseYear)
    if (employee && Array.isArray(employee.salaryDetails)) {
      employee.salaryDetails.forEach((row) => {
        if (!row) return
        const yValue = row.year
        if (yValue === null || yValue === undefined || yValue === '') {
          yearsSet.add(baseYear)
          return
        }
        const n = Number(yValue)
        if (Number.isFinite(n)) {
          yearsSet.add(n)
        }
      })
    }
    const sorted = Array.from(yearsSet).sort((a, b) => a - b)
    const maxYear = sorted.length > 0 ? sorted[sorted.length - 1] : baseYear
    if (baseMonth === 12 && !yearsSet.has(maxYear + 1)) {
      sorted.push(maxYear + 1)
    }
    return sorted
  }, [employee, baseYear, baseMonth])

  const handleSalaryFieldChange = (index, field, value) => {
    setSalaryTable((prev) => {
      const next = prev.map((row) => ({ ...row }))
      const target = next[index]
      if (!target) return prev
      target[field] = value
      return next
    })
  }

  const handleSaveSalary = async () => {
    if (!employee || !id) {
      return
    }
    try {
      const prevEmployee = employee
      const normalizeNumber = (v) => {
        if (v === null || v === undefined || v === '') {
          return undefined
        }
        const n = Number(v)
        if (!Number.isFinite(n)) {
          return undefined
        }
        return n
      }
      const targetYear = currentYear || baseYear
      const existingDetails = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
      const otherDetails = existingDetails.filter((item) => {
        if (!item) return false
        const yValue = item.year
        const y = yValue === null || yValue === undefined || yValue === ''
          ? baseYear
          : Number(yValue)
        if (!Number.isFinite(y)) {
          return true
        }
        return y !== targetYear
      })
      const yearDetails = salaryTable.map((row) => ({
        month: row.month,
        year: row.year || targetYear,
        monthlySalary: normalizeNumber(row.monthlySalary),
        dailySalary: normalizeNumber(row.dailySalary),
        hourlySalary: normalizeNumber(row.hourlySalary),
        attendanceDays: normalizeNumber(row.attendanceDays),
        subsidyPerDay: normalizeNumber(row.subsidyPerDay),
        overtimeHours: normalizeNumber(row.overtimeHours),
        bonus: normalizeNumber(row.bonus),
        paid: Boolean(row.paid),
        eventNote: row.eventNote || ''
      }))
      const details = [...otherDetails, ...yearDetails]
      const { yearPaidAmount, yearPendingAmount } = salarySummary
      await employeeAPI.updateEmployee(id, { salaryDetails: details, yearPaidAmount, yearPendingAmount })
      message.success('工资表已更新')
      setSalaryEditMode(false)
      setEmployee({
        ...prevEmployee,
        salaryDetails: details,
        yearPaidAmount,
        yearPendingAmount,
        totalSalaryYear: yearPaidAmount + yearPendingAmount
      })
    } catch (error) {
      message.error(error && error.message ? error.message : '更新工资表失败')
    }
  }

  const handleCancelSalaryEdit = () => {
    if (!employee) {
      return
    }
    setSalaryEditMode(false)
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const targetYear = currentYear || baseYear
    const allDetails = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
    const details = allDetails.filter((item) => {
      if (!item) return false
      const yValue = item.year
      if (yValue === null || yValue === undefined || yValue === '') {
        return targetYear === baseYear
      }
      const n = Number(yValue)
      if (!Number.isFinite(n)) {
        return false
      }
      return n === targetYear
    })
    const normalizeField = (v) => {
      if (v === null || v === undefined) return undefined
      const n = Number(v)
      if (!Number.isFinite(n) || n === 0) return undefined
      return n
    }
    const round2 = (v) => {
      const n = Number(v)
      if (!Number.isFinite(n)) {
        return undefined
      }
      return Math.round(n * 100) / 100
    }
    const getBaseByMonth = (year, month) => {
      const monthEnd = dayjs(`${year}-${month}-01`).endOf('month')
      let baseMonthly = Number(employee.monthlySalary || 0)
      let baseAllowance = Number(employee.allowance || 0)
      const adjustments = Array.isArray(employee.salaryAdjustments) ? [...employee.salaryAdjustments] : []
      adjustments.forEach((adj) => {
        if (!adj || !adj.effectiveFrom) return
        const eff = dayjs(adj.effectiveFrom)
        if (!eff.isValid()) return
        if (eff.isAfter(monthEnd, 'day')) {
          return
        }
        if (adj.monthlySalary !== null && adj.monthlySalary !== undefined) {
          const m = Number(adj.monthlySalary)
          if (Number.isFinite(m)) {
            baseMonthly = m
          }
        }
        if (adj.allowance !== null && adj.allowance !== undefined) {
          const a = Number(adj.allowance)
          if (Number.isFinite(a)) {
            baseAllowance = a
          }
        }
      })
      return {
        monthlySalary: baseMonthly,
        allowance: baseAllowance
      }
    }
    const getRates = (year, month) => {
      const base = getBaseByMonth(year, month)
      const type = employee.timeSystem || '26_9'
      const dayCount = type === '30_9' ? 30 : 26
      const hoursPerDay = 9
      const monthly = Number(base.monthlySalary || 0)
      const allowance = Number(base.allowance || 0)
      if (!Number.isFinite(monthly) || monthly <= 0) {
        return {
          daily: undefined,
          hourly: undefined,
          subsidyPerDay: undefined
        }
      }
      const daily = round2(monthly / dayCount)
      const hourly = daily !== undefined ? round2(daily / hoursPerDay) : undefined
      const subsidyPerDay = Number.isFinite(allowance) && allowance > 0 ? round2(allowance / dayCount) : undefined
      return {
        daily,
        hourly,
        subsidyPerDay
      }
    }
    const table = months.map((m, index) => {
      const found = details.find((item) => Number(item.month) === m) || {}
      const rates = getRates(targetYear, m)
      const ms = found.monthlySalary
      let monthlySalary
      if (ms === null || ms === undefined || Number(ms) === 0) {
        const base = getBaseByMonth(targetYear, m)
        monthlySalary = base.monthlySalary && Number(base.monthlySalary) !== 0
          ? Number(base.monthlySalary)
          : undefined
      } else {
        monthlySalary = Number(ms)
      }
      return {
        key: `${targetYear}-${m}`,
        index,
        year: targetYear,
        month: m,
        name: employee.name || '',
        monthlySalary,
        dailySalary: normalizeField(rates.daily),
        hourlySalary: normalizeField(rates.hourly),
        attendanceDays: normalizeField(found.attendanceDays),
        subsidyPerDay: normalizeField(rates.subsidyPerDay),
        overtimeHours: normalizeField(found.overtimeHours),
        bonus: normalizeField(found.bonus),
        paid: Boolean(found.paid),
        eventNote: found.eventNote || ''
      }
    })
    setSalaryTable(table)
  }

  const salaryColumns = [
    {
      title: '时间',
      dataIndex: 'monthLabel',
      key: 'month',
      width: 70
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 100
    },
    {
      title: '月薪',
      dataIndex: 'monthlySalary',
      key: 'monthlySalary',
      width: 100,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'monthlySalary', v)}
          />
        ) : (
          formatMoneyCell(value)
        )
    },
    {
      title: '日薪',
      dataIndex: 'dailySalary',
      key: 'dailySalary',
      width: 100,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'dailySalary', v)}
          />
        ) : (
          formatMoneyCell(value)
        )
    },
    {
      title: '时薪',
      dataIndex: 'hourlySalary',
      key: 'hourlySalary',
      width: 100,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'hourlySalary', v)}
          />
        ) : (
          formatMoneyCell(value)
        )
    },
    {
      title: '出勤天数',
      dataIndex: 'attendanceDays',
      key: 'attendanceDays',
      width: 90,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'attendanceDays', v)}
          />
        ) : (() => {
          if (value === null || value === undefined) return ''
          const n = Number(value)
          if (!Number.isFinite(n) || n === 0) return ''
          return n.toFixed(2)
        })()
    },
    {
      title: '补贴(元/天)',
      dataIndex: 'subsidyPerDay',
      key: 'subsidyPerDay',
      width: 110,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'subsidyPerDay', v)}
          />
        ) : (
          formatMoneyCell(value)
        )
    },
    {
      title: '加班小时',
      dataIndex: 'overtimeHours',
      key: 'overtimeHours',
      width: 90,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'overtimeHours', v)}
          />
        ) : (() => {
          if (value === null || value === undefined) return ''
          const n = Number(value)
          if (!Number.isFinite(n) || n === 0) return ''
          return n.toFixed(2)
        })()
    },
    {
      title: '正常工资',
      dataIndex: 'normalSalary',
      key: 'normalSalary',
      width: 110,
      render: (value) => formatMoneyCell(value)
    },
    {
      title: '加班工资',
      dataIndex: 'overtimeSalary',
      key: 'overtimeSalary',
      width: 110,
      render: (value) => formatMoneyCell(value)
    },
    {
      title: '补贴合计',
      dataIndex: 'subsidyTotal',
      key: 'subsidyTotal',
      width: 110,
      render: (value) => formatMoneyCell(value)
    },
    {
      title: '奖金',
      dataIndex: 'bonus',
      key: 'bonus',
      width: 90,
      render: (value, record) =>
        salaryEditMode ? (
          <InputNumber
            min={0}
            precision={2}
            controls={false}
            style={{ width: '100%' }}
            value={value}
            onChange={(v) => handleSalaryFieldChange(record.index, 'bonus', v)}
          />
        ) : (
          formatMoneyCell(value)
        )
    },
    {
      title: '工资合计',
      dataIndex: 'total',
      key: 'total',
      width: 120,
      render: (value, record) => {
        const hasNormal = record.normalSalary !== undefined && record.normalSalary !== null
        const hasOvertime = record.overtimeSalary !== undefined && record.overtimeSalary !== null
        if (!hasNormal && !hasOvertime) {
          return ''
        }
        return formatMoneyCell(value)
      }
    },
    {
      title: '事件',
      dataIndex: 'eventNote',
      key: 'eventNote',
      width: 80,
      render: (_, record) => {
        const hasEvent = record.eventNote && String(record.eventNote).trim() !== ''
        const color = hasEvent ? 'red' : '#ccc'
        const flag = (
          <Button
            type="text"
            size="small"
            style={{ padding: 0, color, filter: hasEvent ? 'none' : 'grayscale(1)' }}
            onClick={() => openEventModal(record)}
          >
            🚩
          </Button>
        )
        if (!hasEvent) {
          return flag
        }
        return (
          <Tooltip title={record.eventNote}>
            {flag}
          </Tooltip>
        )
      }
    }
  ]

  const openEventModal = (row) => {
    if (!row) {
      return
    }
    setEventRow(row)
    eventForm.setFieldsValue({
      eventNote: row.eventNote || ''
    })
    setEventModalOpen(true)
  }

  const openPaidModal = () => {
    if (!employee) {
      return
    }
    setPaidMonths([])
    setPaidModalOpen(true)
  }

  const handlePaidConfirm = async () => {
    if (!employee || !id) {
      return
    }
    try {
      const prevEmployee = employee
      const targetYear = currentYear || baseYear
      const existingDetails = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
      const existingPaid = new Set(
        existingDetails
          .filter((item) => item && item.paid)
          .map((item) => {
            const yValue = item.year
            const y = yValue === null || yValue === undefined || yValue === ''
              ? baseYear
              : Number(yValue)
            if (!Number.isFinite(y)) {
              return null
            }
            const m = Number(item.month)
            if (!Number.isFinite(m) || m < 1 || m > 12) {
              return null
            }
            return `${y}-${m}`
          })
          .filter((v) => v !== null)
      )
      const setPaid = new Set([
        ...existingPaid,
        ...paidMonths
          .map((m) => Number(m))
          .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12)
          .map((m) => `${targetYear}-${m}`)
      ])
      const normalizeNumber = (v) => {
        if (v === null || v === undefined || v === '') {
          return undefined
        }
        const n = Number(v)
        if (!Number.isFinite(n)) {
          return undefined
        }
        return n
      }
      const otherDetails = existingDetails.filter((item) => {
        if (!item) return false
        const yValue = item.year
        const y = yValue === null || yValue === undefined || yValue === ''
          ? baseYear
          : Number(yValue)
        if (!Number.isFinite(y)) {
          return true
        }
        return y !== targetYear
      })
      const yearDetails = salaryTable.map((row) => {
        const paidKey = `${targetYear}-${row.month}`
        return {
          month: row.month,
          year: row.year || targetYear,
          monthlySalary: normalizeNumber(row.monthlySalary),
          dailySalary: normalizeNumber(row.dailySalary),
          hourlySalary: normalizeNumber(row.hourlySalary),
          attendanceDays: normalizeNumber(row.attendanceDays),
          subsidyPerDay: normalizeNumber(row.subsidyPerDay),
          overtimeHours: normalizeNumber(row.overtimeHours),
          bonus: normalizeNumber(row.bonus),
          paid: setPaid.has(paidKey),
          eventNote: row.eventNote || ''
        }
      })
      const details = [...otherDetails, ...yearDetails]
      let yearPaidAmount = 0
      let yearPendingAmount = 0
      salaryRows.forEach((row) => {
        const total = Number(row.total || 0)
        if (!Number.isFinite(total)) {
          return
        }
        const key = `${targetYear}-${row.month}`
        if (setPaid.has(key)) {
          yearPaidAmount += total
        } else {
          yearPendingAmount += total
        }
      })
      await employeeAPI.updateEmployee(id, {
        salaryDetails: details,
        yearPaidAmount,
        yearPendingAmount
      })
      message.success('已更新发放状态')
      setPaidModalOpen(false)
      setEmployee({
        ...prevEmployee,
        salaryDetails: details,
        yearPaidAmount,
        yearPendingAmount,
        totalSalaryYear: yearPaidAmount + yearPendingAmount
      })
    } catch (error) {
      message.error(error && error.message ? error.message : '更新失败')
    }
  }

  const handlePaidCancel = () => {
    setPaidModalOpen(false)
  }

  const handleEventSubmit = async () => {
    if (!employee || !id || !eventRow) {
      setEventModalOpen(false)
      return
    }
    try {
      const prevEmployee = employee
      const values = await eventForm.validateFields()
      const note = String(values.eventNote || '').trim()
      const normalizeNumber = (v) => {
        if (v === null || v === undefined || v === '') {
          return undefined
        }
        const n = Number(v)
        if (!Number.isFinite(n)) {
          return undefined
        }
        return n
      }
      const targetYear = currentYear || baseYear
      const updatedSalaryTable = salaryTable.map((row) => {
        if (row.month === eventRow.month && (row.year || targetYear) === (eventRow.year || targetYear)) {
          return {
            ...row,
            eventNote: note
          }
        }
        return row
      })
      const existingDetails = Array.isArray(employee.salaryDetails) ? employee.salaryDetails : []
      const otherDetails = existingDetails.filter((item) => {
        if (!item) return false
        const yValue = item.year
        const y = yValue === null || yValue === undefined || yValue === ''
          ? baseYear
          : Number(yValue)
        if (!Number.isFinite(y)) {
          return true
        }
        return y !== targetYear
      })
      const yearDetails = updatedSalaryTable.map((row) => ({
        month: row.month,
        year: row.year || targetYear,
        monthlySalary: normalizeNumber(row.monthlySalary),
        dailySalary: normalizeNumber(row.dailySalary),
        hourlySalary: normalizeNumber(row.hourlySalary),
        attendanceDays: normalizeNumber(row.attendanceDays),
        subsidyPerDay: normalizeNumber(row.subsidyPerDay),
        overtimeHours: normalizeNumber(row.overtimeHours),
        bonus: normalizeNumber(row.bonus),
        paid: Boolean(row.paid),
        eventNote: row.eventNote || ''
      }))
      const details = [...otherDetails, ...yearDetails]
      await employeeAPI.updateEmployee(id, { salaryDetails: details })
      message.success('事件备注已更新')
      setSalaryTable(updatedSalaryTable)
      setEventModalOpen(false)
      setEventRow(null)
      setEmployee({
        ...prevEmployee,
        salaryDetails: details
      })
    } catch (error) {
      if (error && error.errorFields) {
        return
      }
      message.error(error && error.message ? error.message : '更新失败')
    }
  }

  const handleEventCancel = () => {
    setEventModalOpen(false)
    setEventRow(null)
  }

  const openInfoModal = () => {
    if (!employee) {
      return
    }
    infoForm.setFieldsValue({
      name: employee.name || '',
      department: employee.department || '',
      position: employee.position || '',
      hireDate: employee.hireDate ? dayjs(employee.hireDate) : null,
      monthlySalary: employee.monthlySalary,
      allowance: employee.allowance,
      timeSystem: employee.timeSystem || '26_9',
      rehire: false
    })
    setInfoModalOpen(true)
  }

  const handleInfoSubmit = async () => {
    if (!id) {
      return
    }
    try {
      const values = await infoForm.validateFields()
      const hireDateValue = values.hireDate
      const monthlySalary = Number(values.monthlySalary || 0)
      const allowance = Number(values.allowance || 0)
      const timeSystem = values.timeSystem || '26_9'
      const rehire = !!values.rehire
      const payload = {
        name: String(values.name || '').trim(),
        department: values.department || '',
        position: values.position || '',
        hireDate: hireDateValue ? dayjs(hireDateValue).toDate() : undefined,
        monthlySalary,
        allowance,
        timeSystem
      }
      if (rehire && employee && employee.status === 'left') {
        payload.status = 'active'
        payload.leaveDate = undefined
      }
      await employeeAPI.updateEmployee(id, payload)
      message.success('员工信息已更新')
      setInfoModalOpen(false)
      setEmployee((prev) => {
        if (!prev) {
          return {
            ...payload
          }
        }
        return {
          ...prev,
          ...payload
        }
      })
    } catch (error) {
      if (error && error.errorFields) {
        return
      }
      message.error(error && error.message ? error.message : '更新失败')
    }
  }

  const handleInfoCancel = () => {
    setInfoModalOpen(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 className="page-title">员工工资详情</h2>
        <Space>
          <Button type="primary" onClick={openInfoModal}>
            编辑信息
          </Button>
          <Button onClick={() => navigate('/employees')}>返回列表</Button>
        </Space>
      </div>
      <Spin spinning={loading}>
        {employee && (
          <div>
            <Card title="基本信息" style={{ marginBottom: 16 }}>
              <Descriptions column={3} bordered size="small">
                <Descriptions.Item label="姓名">{employee.name || '-'}</Descriptions.Item>
                <Descriptions.Item label="部门">{employee.department || '-'}</Descriptions.Item>
                <Descriptions.Item label="岗位">{employee.position || '-'}</Descriptions.Item>
                <Descriptions.Item label="入职时间">{formatDate(employee.hireDate)}</Descriptions.Item>
                <Descriptions.Item label="状态">{statusTag}</Descriptions.Item>
                <Descriptions.Item label="离职时间">
                  {employee.leaveDate ? formatDate(employee.leaveDate) : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="工资汇总" style={{ marginBottom: 16 }}>
              <Descriptions column={3} bordered size="small">
                <Descriptions.Item label="月薪工资">{formatMoney(employee.monthlySalary)}</Descriptions.Item>
                <Descriptions.Item label="补贴">{formatMoney(employee.allowance)}</Descriptions.Item>
                <Descriptions.Item label="奖金(今年)">{formatMoney(employee.yearBonusAmount)}</Descriptions.Item>
                <Descriptions.Item label="已发工资(今年)">{formatMoney(salarySummary.yearPaidAmount)}</Descriptions.Item>
                <Descriptions.Item label="待发工资(今年)">{formatMoney(salarySummary.yearPendingAmount)}</Descriptions.Item>
                <Descriptions.Item label="工资总数(今年)">{formatMoney(salarySummary.totalSalaryYear)}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card
              title="工资详情"
              style={{ marginBottom: 16 }}
              extra={
                <Space>
                  <Select
                    size="small"
                    style={{ width: 110 }}
                    value={currentYear}
                    onChange={(value) => setCurrentYear(value)}
                  >
                    {yearOptions.map((year) => (
                      <Select.Option key={year} value={year}>
                        {year}年
                      </Select.Option>
                    ))}
                  </Select>
                  {salaryEditMode ? (
                    <>
                      <Button type="primary" size="small" onClick={handleSaveSalary}>
                        保存
                      </Button>
                      <Button size="small" onClick={handleCancelSalaryEdit}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button size="small" onClick={() => setSalaryEditMode(true)}>
                      编辑
                    </Button>
                  )}
                  <Button size="small" onClick={openPaidModal}>
                    工资发放
                  </Button>
                </Space>
              }
            >
              <Table
                columns={salaryColumns}
                dataSource={salaryRows}
                pagination={false}
                size="small"
                rowKey="key"
                scroll={{ x: 'max-content', y: 400 }}
                sticky
              />
            </Card>

            <Card title="薪资调整记录">
              {adjustmentItems.length === 0 ? (
                <div>暂无薪资调整记录</div>
              ) : (
                <Timeline
                  items={adjustmentItems.map((item, index) => ({
                    key: index,
                    children: (
                      <div>
                        <div>
                          生效时间：{formatDate(item.effectiveFrom, true)}
                        </div>
                        <div>
                          调整后月薪：{formatMoney(item.monthlySalary)}，补贴：{formatMoney(item.allowance)}
                        </div>
                        <div>
                          调整时间：{item.adjustedAt ? formatDate(item.adjustedAt, true) : '-'}
                        </div>
                      </div>
                    )
                  }))}
                />
              )}
            </Card>
            <Modal
              title="编辑员工信息"
              open={infoModalOpen}
              onOk={handleInfoSubmit}
              onCancel={handleInfoCancel}
              destroyOnHidden
            >
              <Form form={infoForm} layout="vertical">
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
                    <Select.Option value="26_9">26天9小时制</Select.Option>
                    <Select.Option value="30_9">30天9小时制</Select.Option>
                  </Select>
                </Form.Item>
                <Form.Item name="monthlySalary" label="月薪工资">
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
                <Form.Item name="allowance" label="补贴">
                  <InputNumber style={{ width: '100%' }} min={0} precision={2} />
                </Form.Item>
                {employee && employee.status === 'left' && (
                  <Form.Item name="rehire" valuePropName="checked">
                    <Checkbox>标记为在职（复职）</Checkbox>
                  </Form.Item>
                )}
              </Form>
            </Modal>
            <Modal
              title="设置工资发放月份"
              open={paidModalOpen}
              onOk={handlePaidConfirm}
              onCancel={handlePaidCancel}
              destroyOnHidden
            >
              <Checkbox.Group
                style={{ width: '100%' }}
                value={paidMonths}
                onChange={(list) => setPaidMonths(list.map((v) => Number(v)))}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {salaryRows
                    .filter((row) => !row.paid && row.total !== undefined)
                    .map((row) => (
                      <Checkbox key={row.key} value={row.month} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                          <span>{row.name}</span>
                          <span>{row.monthLabel}</span>
                          <span>正常工资：{formatMoneyCell(row.normalSalary) || '-'}</span>
                          <span>加班工资：{formatMoneyCell(row.overtimeSalary) || '-'}</span>
                          <span>补贴合计：{formatMoneyCell(row.subsidyTotal) || '-'}</span>
                          <span>奖金：{formatMoneyCell(row.bonus) || '-'}</span>
                          <span>工资合计：{formatMoneyCell(row.total) || '-'}</span>
                        </div>
                      </Checkbox>
                    ))}
                </Space>
              </Checkbox.Group>
            </Modal>
            <Modal
              title={eventRow ? `设置${eventRow.month}月事件备注` : '设置事件备注'}
              open={eventModalOpen}
              onOk={handleEventSubmit}
              onCancel={handleEventCancel}
              destroyOnHidden
            >
              <Form form={eventForm} layout="vertical">
                <Form.Item name="eventNote" label="备注">
                  <Input.TextArea rows={4} placeholder="请输入本月事件备注" />
                </Form.Item>
              </Form>
            </Modal>
          </div>
        )}
      </Spin>
    </div>
  )
}

export default EmployeeDetail
