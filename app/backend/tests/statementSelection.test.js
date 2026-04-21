import { buildStatementParentChildKeyMap, expandStatementKeys, looksLikeOrderNo } from '../../frontend/src/utils/index.js'

describe('对账单母订单勾选展开', () => {
  it('订单号识别应支持子订单后缀 -n', () => {
    expect(looksLikeOrderNo('QXDD20260128002')).toBe(true)
    expect(looksLikeOrderNo('QXDD20260128002-1')).toBe(true)
    expect(looksLikeOrderNo('QXBZ20260128002-12')).toBe(true)
    expect(looksLikeOrderNo('65f8c2a8fe7ef464489dc709')).toBe(false)
  })

  it('勾选母订单 key 时应展开到子订单 key', () => {
    const rows = [
      { key: 'k_m', orderNo: 'QXDD20260101001' },
      { key: 'k_1', orderNo: 'QXDD20260101001-1' },
      { key: 'k_2', orderNo: 'QXDD20260101001-2' }
    ]
    const { parentChildKeyMap, orderKeyByNo } = buildStatementParentChildKeyMap(rows)

    const keys = expandStatementKeys(['k_m'], parentChildKeyMap, orderKeyByNo)
    expect(new Set(keys)).toEqual(new Set(['k_m', 'k_1', 'k_2']))
  })

  it('勾选 group:母单号 时应展开到子订单 key', () => {
    const rows = [
      { key: 'k_1', orderNo: 'QXDD20260101002-1' },
      { key: 'k_2', orderNo: 'QXDD20260101002-2' }
    ]
    const { parentChildKeyMap, orderKeyByNo } = buildStatementParentChildKeyMap(rows)

    const keys = expandStatementKeys(['group:QXDD20260101002'], parentChildKeyMap, orderKeyByNo)
    expect(new Set(keys)).toEqual(new Set(['k_1', 'k_2']))
  })

  it('勾选母订单号字符串时应映射到母订单 key 并展开子订单', () => {
    const rows = [
      { key: 'k_m', orderNo: 'QXDD20260101003' },
      { key: 'k_1', orderNo: 'QXDD20260101003-1' }
    ]
    const { parentChildKeyMap, orderKeyByNo } = buildStatementParentChildKeyMap(rows)

    const keys = expandStatementKeys(['QXDD20260101003'], parentChildKeyMap, orderKeyByNo)
    expect(new Set(keys)).toEqual(new Set(['k_m', 'k_1']))
  })
})
