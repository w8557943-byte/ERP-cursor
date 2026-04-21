import { computeInhouseRawMaterialCost, resolveSupplierMaterialPricePerSqm } from './materialCost'

describe('materialCost', () => {
  test('computeInhouseRawMaterialCost computes sqm cost with rounding', () => {
    const cost = computeInhouseRawMaterialCost({ boardWidth: 1000, boardHeight: 2000, pricePerSqm: 2.34567 })
    expect(cost).toBeCloseTo(4.7852, 4)
  })

  test('resolveSupplierMaterialPricePerSqm resolves by supplier+materialCode', () => {
    const price = resolveSupplierMaterialPricePerSqm({
      supplierId: 's1',
      materialCode: 'K-A',
      flute: '',
      supplierMaterialsBySupplier: {
        s1: [{ materialCode: 'K-A', pricePerSqm: 1.23 }]
      }
    })
    expect(price).toBe(1.23)
  })

  test('resolveSupplierMaterialPricePerSqm prefers flute match when present', () => {
    const price = resolveSupplierMaterialPricePerSqm({
      supplierId: 's1',
      materialCode: 'K-A',
      flute: 'AB楞',
      supplierMaterialsBySupplier: {
        s1: [
          { materialCode: 'K-A', pricePerSqm: 1.11, flutes: ['B楞'] },
          { materialCode: 'K-A', pricePerSqm: 2.22, flutes: ['AB楞'] }
        ]
      }
    })
    expect(price).toBe(2.22)
  })
})

