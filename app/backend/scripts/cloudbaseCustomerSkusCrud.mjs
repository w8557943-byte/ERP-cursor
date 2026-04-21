import dotenv from 'dotenv'
import cloudbaseService from '../src/services/cloudbaseService.js'

dotenv.config()

const mask = (v) => {
  const s = String(v || '')
  if (!s) return ''
  if (s.length <= 6) return '*'.repeat(s.length)
  return `${s.slice(0, 2)}***${s.slice(-2)}`
}

const logSection = (title) => {
  process.stdout.write(`\n=== ${title} ===\n`)
}

const run = async () => {
  logSection('Environment')
  const envId = process.env.WECHAT_CLOUD_ENV_ID || process.env.WX_CLOUD_ENV || ''
  const secretId = process.env.TCB_SECRET_ID || ''
  const secretKey = process.env.TCB_SECRET_KEY || ''
  const privateKeyId = process.env.WECHAT_API_KEY_ID || process.env.WECHAT_CLI_SECRET || ''
  const privateKey = process.env.WECHAT_API_KEY || ''
  const collectionName = String(process.env.CLOUDBASE_CUSTOMER_SKU_COLLECTION || 'customer_skus').trim() || 'customer_skus'
  const targetId = String(process.env.TARGET_SKU_ID || '').trim()
  const mutateTarget = String(process.env.MUTATE_TARGET || '').trim() === '1'

  console.log('NODE_ENV:', process.env.NODE_ENV || '')
  console.log('envId:', envId || '(missing)')
  console.log('TCB_SECRET_ID:', secretId ? `set(len=${secretId.length},mask=${mask(secretId)})` : '(missing)')
  console.log('TCB_SECRET_KEY:', secretKey ? `set(len=${secretKey.length},mask=${mask(secretKey)})` : '(missing)')
  console.log('WECHAT_API_KEY_ID/WECHAT_CLI_SECRET:', privateKeyId ? `set(mask=${mask(privateKeyId)})` : '(missing)')
  console.log('WECHAT_API_KEY:', privateKey ? `set(len=${privateKey.length})` : '(missing)')
  console.log('customer_skus collection:', collectionName)
  if (targetId) console.log('TARGET_SKU_ID:', targetId)
  if (targetId) console.log('MUTATE_TARGET:', mutateTarget ? '1' : '0')

  logSection('Init')
  const originalLog = console.log
  const originalError = console.error
  console.log = () => void 0
  console.error = () => void 0
  const ok = await cloudbaseService.initialize()
  console.log = originalLog
  console.error = originalError
  console.log(JSON.stringify({
    ok,
    envId: cloudbaseService.envId || '',
    credentialMode: cloudbaseService.credentialMode || '',
    lastInitError: cloudbaseService.lastInitError || ''
  }))
  if (!ok) {
    process.exitCode = 2
    return
  }

  const collection = cloudbaseService.getCollection(collectionName)

  if (targetId) {
    logSection('Check existing doc.get')
    try {
      const res = await collection.doc(targetId).get()
      const doc = Array.isArray(res?.data) && res.data.length ? res.data[0] : null
      const keys = doc && typeof doc === 'object' ? Object.keys(doc) : []
      console.log(JSON.stringify({
        exists: !!doc,
        keys: keys.slice(0, 50),
        keyCount: keys.length,
        customerId: doc?.customerId ?? doc?.customer_id ?? doc?.customer?.id ?? doc?.customer?._id ?? doc?.customerName ?? doc?.customer?.name ?? null,
        name: doc?.name ?? doc?.goodsName ?? doc?.productName ?? null
      }))

      if (mutateTarget && doc) {
        logSection('Update existing doc (temporary)')
        const beforeRemark = doc?.remark ?? null
        const tempRemark = `diagnostic_${Date.now()}`
        const u1 = await collection.doc(targetId).update({ data: { remark: tempRemark, updatedAt: new Date().toISOString() } })
        const after1 = await collection.doc(targetId).get()
        const docAfter1 = Array.isArray(after1?.data) && after1.data.length ? after1.data[0] : null
        console.log(JSON.stringify({ updateRes: u1, remarkAfter: docAfter1?.remark ?? null }))

        logSection('Rollback existing doc (restore remark)')
        const u2 = await collection.doc(targetId).update({ data: { remark: beforeRemark, updatedAt: new Date().toISOString() } })
        const after2 = await collection.doc(targetId).get()
        const docAfter2 = Array.isArray(after2?.data) && after2.data.length ? after2.data[0] : null
        console.log(JSON.stringify({ rollbackRes: u2, remarkRestored: docAfter2?.remark ?? null }))
      }
    } catch (e) {
      console.error(JSON.stringify({
        message: e?.message || String(e),
        code: e?.code ?? e?.errCode ?? e?.errorCode ?? null,
        name: e?.name || null
      }))
    }
  }
  const runId = `crud_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const payload = {
    customerId: 'diagnostic',
    name: `__crud_test__${runId}`,
    name: `__crud_test__${runId}`,
    remark: 'cloudbase crud test',
    diagnosticRunId: runId,
    updatedAt: new Date().toISOString()
  }

  let createdId = ''
  try {
    logSection('Insert (add)')
    const addRes = await collection.add({ data: payload })
    createdId = String(addRes?._id || addRes?.id || addRes?.insertedId || '')
    console.log(JSON.stringify({ createdId, addRes }, null, 0))
    if (!createdId) {
      process.exitCode = 3
      return
    }

    logSection('FindOne (doc.get)')
    const getRes = await collection.doc(createdId).get()
    const found = Array.isArray(getRes?.data) && getRes.data.length ? getRes.data[0] : null
    console.log(JSON.stringify({
      found: found ? { _id: found._id, customerId: found.customerId, name: found.name, diagnosticRunId: found.diagnosticRunId } : null
    }))

    logSection('UpdateOne (doc.update)')
    const updateRes = await collection.doc(createdId).update({ data: { remark: 'cloudbase crud test updated', updatedAt: new Date().toISOString() } })
    console.log(JSON.stringify({ updateRes }))

    logSection('Verify update (doc.get)')
    const getRes2 = await collection.doc(createdId).get()
    const found2 = Array.isArray(getRes2?.data) && getRes2.data.length ? getRes2.data[0] : null
    console.log(JSON.stringify({ remark: found2?.remark ?? null }))
  } catch (e) {
    logSection('Error')
    console.error(JSON.stringify({
      message: e?.message || String(e),
      code: e?.code ?? e?.errCode ?? e?.errorCode ?? null,
      name: e?.name || null
    }))
    process.exitCode = 1
  } finally {
    if (createdId) {
      try {
        logSection('DeleteOne (doc.remove)')
        const delRes = await collection.doc(createdId).remove()
        console.log(JSON.stringify({ delRes }))
      } catch (e) {
        logSection('Delete error')
        console.error(JSON.stringify({
          message: e?.message || String(e),
          code: e?.code ?? e?.errCode ?? e?.errorCode ?? null,
          name: e?.name || null
        }))
      }
    }
  }
}

await run()
