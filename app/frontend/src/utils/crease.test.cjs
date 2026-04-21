describe('crease', () => {
  let resolveBoardPurchaseCrease
  let calcCreaseFromSku

  beforeAll(async () => {
    const mod = await import('./crease.js')
    resolveBoardPurchaseCrease = mod.resolveBoardPurchaseCrease
    calcCreaseFromSku = mod.calcCreaseFromSku
  })

  test('resolveBoardPurchaseCrease prefers indexed item crease sizes', () => {
    const row = {
      __itemIndex: 1,
      items: [
        { creasingSize1: 10, creasingSize2: 20, creasingSize3: 30, creasingType: 'A' },
        { creasingSize1: 127, creasingSize2: 255, creasingSize3: 127, creasingType: 'B' }
      ],
      __skuResolved: { creasingSize1: 1, creasingSize2: 2, creasingSize3: 3, creasingType: 'SKU' }
    }
    expect(resolveBoardPurchaseCrease(row)).toEqual({ spec: '127-255-127', type: 'B' })
  })

  test('resolveBoardPurchaseCrease does not guess first item when multiple items and no index', () => {
    const row = {
      items: [
        { creasingSize1: 127, creasingSize2: 255, creasingSize3: 127, creasingType: 'A' },
        { creasingSize1: 11, creasingSize2: 22, creasingSize3: 33, creasingType: 'B' }
      ]
    }
    expect(resolveBoardPurchaseCrease(row)).toEqual({ spec: '', type: '' })
  })

  test('resolveBoardPurchaseCrease allows single-item fallback without index', () => {
    const row = { items: [{ creasingSize1: 11, creasingSize2: 22, creasingSize3: 33 }] }
    expect(resolveBoardPurchaseCrease(row)).toEqual({ spec: '11-22-33', type: '凹凸压线' })
  })

  test('resolveBoardPurchaseCrease adjusts spec when sum mismatches specWidth', () => {
    const row = {
      specWidth: 549,
      items: [{ creasingSize1: 127, creasingSize2: 255, creasingSize3: 127 }]
    }
    expect(resolveBoardPurchaseCrease(row)).toEqual({ spec: '127-295-127', type: '凹凸压线' })
  })

  test('calcCreaseFromSku falls back to numeric sizes and default type', () => {
    expect(calcCreaseFromSku({ creasingSize1: 11, creasingSize2: 22, creasingSize3: 33 })).toEqual({
      spec: '11-22-33',
      type: '凹凸压线'
    })
  })
})
