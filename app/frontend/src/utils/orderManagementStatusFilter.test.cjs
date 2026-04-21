describe('orderManagementStatusFilter', () => {
  const {
    normalizeStatusFilter,
    toggleSingleStatus,
    getEmptyText,
    expandStatusFilter,
    buildOrdersQuery
  } = require('./orderManagementStatusFilter.cjs')

  test('normalizeStatusFilter trims, removes empties, de-dupes', () => {
    expect(normalizeStatusFilter([' ordered ', '', null, 'pending', 'ordered'])).toEqual(['ordered', 'pending'])
    expect(normalizeStatusFilter(' ordered ')).toEqual(['ordered'])
    expect(normalizeStatusFilter(undefined)).toEqual([])
  })

  test('toggleSingleStatus behaves like single-select toggle', () => {
    expect(toggleSingleStatus([], 'ordered')).toEqual(['ordered'])
    expect(toggleSingleStatus(['ordered'], 'ordered')).toEqual([])
    expect(toggleSingleStatus(['pending'], 'ordered')).toEqual(['ordered'])
    expect(toggleSingleStatus(['pending', 'processing'], 'processing')).toEqual([])
  })

  test('getEmptyText matches UX requirements', () => {
    expect(getEmptyText([])).toBe('暂无订单')
    expect(getEmptyText(['ordered'])).toBe('当前状态暂无订单')
    expect(getEmptyText(['ordered', 'pending'])).toBe('当前状态暂无订单')
  })

  test('expandStatusFilter expands to backend-compatible status list', () => {
    expect(expandStatusFilter(['ordered'])).toEqual(expect.arrayContaining(['ordered', '已下单']))
    expect(expandStatusFilter(['pending'])).toEqual(expect.arrayContaining(['pending', '待生产']))
    expect(expandStatusFilter(['processing'])).toEqual(expect.arrayContaining(['processing', '生产中']))
    expect(expandStatusFilter(['stocked'])).toEqual(expect.arrayContaining(['stocked', '已入库']))
    expect(expandStatusFilter(['ordered', 'pending'])).toEqual(expect.arrayContaining(['已下单', '待生产']))
  })

  test('buildOrdersQuery adds status and pagination fields', () => {
    expect(buildOrdersQuery({ page: 2, limit: 50, statusFilter: ['ordered'] })).toMatchObject({
      page: 2,
      limit: 50,
      status: expect.stringContaining('ordered')
    })
    expect(buildOrdersQuery({ page: 1, pageSize: 30, statusFilter: [] })).not.toHaveProperty('status')
  })
})
