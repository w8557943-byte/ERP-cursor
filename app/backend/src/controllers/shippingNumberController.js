import shippingNumberService from '../services/shippingNumberService.js'

const normalizeDateKey = (input) => {
  const raw = String(input || '').trim()
  if (/^\d{8}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replaceAll('-', '')
  const parsed = raw ? new Date(raw) : new Date()
  if (Number.isNaN(parsed.getTime())) {
    const now = new Date()
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  }
  return `${parsed.getFullYear()}${String(parsed.getMonth() + 1).padStart(2, '0')}${String(parsed.getDate()).padStart(2, '0')}`
}

class ShippingNumberController {
  async generate(req, res) {
    try {
      const dateKey = normalizeDateKey(req.body?.dateKey || req.body?.shipDate)
      const result = await shippingNumberService.generateShippingNoteNumber({ dateKey })
      return res.json({ code: 200, message: 'Shipping note number generated successfully', data: result })
    } catch (error) {
      console.error('Failed to generate shipping note number:', error)
      return res.status(500).json({
        code: 500,
        message: 'Failed to generate shipping note number',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      })
    }
  }
}

export default new ShippingNumberController()

