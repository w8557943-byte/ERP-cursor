const cloud = require('wx-server-sdk');

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const axios = require('axios');
const crypto = require('crypto');
const BACKEND_URL = process.env.ERP_BACKEND_URL || 'http://localhost:3003';

function redactSensitive(value, depth = 0) {
  if (depth > 6) return '[redacted]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > 500) return `${value.slice(0, 200)}...[truncated]`;
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactSensitive(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    for (const key of keys) {
      const lower = String(key).toLowerCase();
      const v = value[key];
      if (lower === 'body' && typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            out[key] = redactSensitive(JSON.parse(trimmed), depth + 1);
            continue;
          } catch (_) {
            // fallthrough
          }
        }
      }
      const shouldRedact =
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('key') ||
        lower.includes('password') ||
        lower.includes('authorization') ||
        lower.includes('ticket') ||
        lower.includes('session') ||
        lower.includes('environ') ||
        lower.includes('wx_api_token');
      out[key] = shouldRedact ? '[redacted]' : redactSensitive(v, depth + 1);
    }
    return out;
  }

  return value;
}

function safeLogJson(prefix, payload) {
  try {
    console.log(prefix, JSON.stringify(redactSensitive(payload), null, 2));
  } catch (e) {
    console.log(prefix, '[unserializable]');
  }
}

function normalizeOrderItemsForCreate(params) {
  const isMeaningfulText = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return false
    return !['-', '—', '--', '---', '暂无', '无'].includes(s)
  }
  const rawItems = Array.isArray(params?.items) ? params.items : []
  return rawItems
    .map((it) => {
      const derivedName =
        (isMeaningfulText(it?.name) && String(it.name).trim()) ||
        (isMeaningfulText(it?.goodsName) && String(it.goodsName).trim()) ||
        (isMeaningfulText(it?.productTitle) && String(it.productTitle).trim()) ||
        (isMeaningfulText(it?.title) && String(it.title).trim()) ||
        (isMeaningfulText(it?.productName) && String(it.productName).trim()) ||
        ''
      const qty = Number(it?.quantity)
      const hasExtendedFields = Boolean(
        String(it?.materialCode || '').trim() ||
        String(it?.flute || '').trim() ||
        String(it?.specWidth || '').trim() ||
        String(it?.specLength || '').trim() ||
        String(it?.materialNo || '').trim() ||
        String(it?.spec || '').trim() ||
        String(it?.relatedOrderNo || '').trim() ||
        String(it?.relatedOrderId || '').trim()
      )
      return {
        ...it,
        name: derivedName || it?.name,
        quantity: qty,
        unitPrice: Number(it?.unitPrice ?? it?.price ?? params?.unitPrice ?? params?.price ?? 0),
        price: Number(it?.price ?? it?.unitPrice ?? params?.unitPrice ?? params?.price ?? 0),
        __hasExtendedFields: hasExtendedFields
      }
    })
    .filter((it) => (isMeaningfulText(it?.name) || Boolean(it?.__hasExtendedFields)) && Number.isFinite(Number(it?.quantity)) && Number(it.quantity) > 0)
    .map((it) => {
      const { __hasExtendedFields, ...rest } = it || {}
      return rest
    })
}

exports.__test = exports.__test || {}
exports.__test.normalizeOrderItemsForCreate = normalizeOrderItemsForCreate

function normalizeStatusListForQuery(rawStatus) {
  if (rawStatus == null) return []
  if (Array.isArray(rawStatus)) {
    return rawStatus
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
  }
  const s = String(rawStatus ?? '').trim()
  if (!s) return []
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const parsed = JSON.parse(s)
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
      }
    } catch (_) { void 0 }
  }
  if (s.includes(',')) {
    return s
      .split(',')
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
  }
  return [s]
}

exports.__test.normalizeStatusListForQuery = normalizeStatusListForQuery

// 全局错误处理器
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason, '在Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 云数据库适配器（内联实现）
class CloudDatabaseAdapter {
  constructor() {
    this.collections = {
      orders: 'orders',
      workorders: 'workorders',
      customers: 'customers',
      employees: 'employees',
      inventory: 'inventory',
      products: 'products',
      product_categories: 'product_categories',
      shipping: 'shipping',
      users: 'users',
      departments: 'departments',
      tasks: 'tasks',
      settings: 'settings'
    };
    // 集合别名映射，确保PC端与小程序端数据一致读取
    this.aliases = {
      orders: ['orders_tmp', 'erp_orders', 'order_list', 'purchase_orders'],
      workorders: ['production', 'work_orders', 'production_orders'],  // 添加production到workorders别名
      production: ['workorders', 'work_orders', 'production_orders'],
      inventory: ['inventory_items', 'stock', 'stock_items'],
      customers: ['customers_tmp', 'customer_list', 'erp_customers', 'clients'],
      employees: [],
      suppliers: ['suppliers_tmp', 'supplier_list', 'vendors'],
      products: ['product_list', 'goods', 'items'],
      users: ['user_list']
    };
  }

  async executeQuery(collection, params = {}) {
    const normalizedParams = params && typeof params === 'object' ? params : {};
    if (normalizedParams.keyword && !normalizedParams.search && !normalizedParams.q) {
      normalizedParams.search = normalizedParams.keyword;
    }
    if (normalizedParams.orderNo && !normalizedParams.search && !normalizedParams.q) {
      normalizedParams.search = normalizedParams.orderNo;
    }
    if (normalizedParams.orderNumber && !normalizedParams.search && !normalizedParams.q) {
      normalizedParams.search = normalizedParams.orderNumber;
    }
    const includeDeleted =
      normalizedParams.includeDeleted === true ||
      normalizedParams.withDeleted === true ||
      String(normalizedParams.includeDeleted || '').toLowerCase() === 'true' ||
      String(normalizedParams.withDeleted || '').toLowerCase() === 'true' ||
      String(normalizedParams.includeDeleted || '') === '1' ||
      String(normalizedParams.withDeleted || '') === '1';
    const onlyDeleted =
      normalizedParams.onlyDeleted === true ||
      normalizedParams.deletedOnly === true ||
      String(normalizedParams.onlyDeleted || '').toLowerCase() === 'true' ||
      String(normalizedParams.deletedOnly || '').toLowerCase() === 'true' ||
      String(normalizedParams.onlyDeleted || '') === '1' ||
      String(normalizedParams.deletedOnly || '') === '1';

    const perfStartAt = Date.now()
    const perfSlowMsRaw = Number(process.env.ERP_SLOW_QUERY_MS)
    const perfSlowMs = Number.isFinite(perfSlowMsRaw) && perfSlowMsRaw > 0 ? perfSlowMsRaw : 500
    const perfSampleRaw = Number(process.env.ERP_PERF_SAMPLE_RATE)
    const perfSampleRate = Number.isFinite(perfSampleRaw) && perfSampleRaw > 0 ? Math.min(perfSampleRaw, 1) : 0
    const perfSampled = perfSampleRate > 0 ? (Math.random() < perfSampleRate) : false
    const finalizeWithPerf = (payload, meta = {}) => {
      const durationMs = Date.now() - perfStartAt
      const wantDebug = normalizedParams && (normalizedParams.debug === '1' || normalizedParams.debug === 'true')
      if ((perfSampled && durationMs >= perfSlowMs) || (wantDebug && durationMs >= perfSlowMs)) {
        try {
          console.log('[api-bridge][perf]', JSON.stringify({ collection, durationMs, ...meta }))
        } catch (_) { void 0 }
      }
      return payload
    }
    const queryMaxLimitRaw = Number(process.env.ERP_QUERY_MAX_LIMIT)
    const queryMaxLimit = Number.isFinite(queryMaxLimitRaw) && queryMaxLimitRaw > 0 ? Math.floor(queryMaxLimitRaw) : 1000

    const isDeletedRow = (row) => {
      if (!row || typeof row !== 'object') return false;
      if (row.isDeleted === true) return true;
      if (row.deleted === true) return true;
      if (row.deletedAt) return true;
      if (row.removedAt) return true;
      return false;
    };

    const applyNotDeleted = (q) =>
      q.where(
        _.and([
          _.or([
            { isDeleted: _.neq(true) },
            { isDeleted: _.exists(false) }
          ]),
          _.or([
            { deleted: _.neq(true) },
            { deleted: _.exists(false) }
          ]),
          _.or([
            { deletedAt: _.exists(false) },
            { deletedAt: _.eq(null) },
            { deletedAt: 0 }
          ]),
          _.or([
            { removedAt: _.exists(false) },
            { removedAt: _.eq(null) },
            { removedAt: 0 }
          ])
        ])
      );
    const applyOnlyDeleted = (q) =>
      q.where(
        _.or([
          { isDeleted: true },
          { deleted: true },
          { deletedAt: _.exists(true) },
          { removedAt: _.exists(true) }
        ])
      );
    const applyDeletedScope = (q) => {
      if (includeDeleted) return q;
      if (onlyDeleted) return applyOnlyDeleted(q);
      return applyNotDeleted(q);
    };

    try {
      const toMs = (v) => {
        if (v == null || v === '') return null
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) return n
        const t = Date.parse(String(v))
        return Number.isFinite(t) ? t : null
      }

      const normalizeStatusList = (rawStatus) => {
        if (rawStatus == null) return []
        if (Array.isArray(rawStatus)) {
          return rawStatus
            .map((v) => String(v ?? '').trim())
            .filter(Boolean)
        }
        const s = String(rawStatus ?? '').trim()
        if (!s) return []
        if (s.startsWith('[') && s.endsWith(']')) {
          try {
            const parsed = JSON.parse(s)
            if (Array.isArray(parsed)) {
              return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
            }
          } catch (_) { void 0 }
        }
        if (s.includes(',')) {
          return s
            .split(',')
            .map((v) => String(v ?? '').trim())
            .filter(Boolean)
        }
        return [s]
      }

      const applyStatusWhere = (q, rawStatus) => {
        const list = normalizeStatusList(rawStatus)
        if (!list.length) return q
        const uniq = list.filter((v, idx) => list.indexOf(v) === idx)
        if (uniq.length <= 1) return q.where({ status: uniq[0] })
        return q.where({ status: _.in(uniq) })
      }

      const rangeStartMs =
        toMs(params.startDate) ??
        toMs(params.start) ??
        toMs(params.startTime) ??
        toMs(params.startTs)
      const rangeEndMs =
        toMs(params.endDate) ??
        toMs(params.end) ??
        toMs(params.endTime) ??
        toMs(params.endTs)

      const hasRange = rangeStartMs != null || rangeEndMs != null
      const applyTimeRange = (q) => {
        if (!hasRange) return q
        const start = rangeStartMs != null ? rangeStartMs : 0
        const end = rangeEndMs != null ? rangeEndMs : Date.now()
        const startDate = new Date(start)
        const endDate = new Date(end)
        return q.where(
          _.or([
            { _createTime: _.gte(start).and(_.lte(end)) },
            { _createTime: _.gte(startDate).and(_.lte(endDate)) },
            { createdAt: _.gte(start).and(_.lte(end)) },
            { createdAt: _.gte(startDate).and(_.lte(endDate)) }
          ])
        )
      }

      const wantIdRaw = normalizedParams.id || normalizedParams._id || normalizedParams.docId;
      const wantId = String(wantIdRaw || '').trim();
      if (wantId) {
        let row = null;
        try {
          const got = await db.collection(collection).doc(wantId).get();
          row = got && got.data ? got.data : null;
        } catch (_) {
          try {
            const got2 = await db.collection(collection).where({ _id: wantId }).limit(1).get();
            row = Array.isArray(got2 && got2.data) && got2.data.length ? got2.data[0] : null;
          } catch (_) { }
        }

        if (!row) {
          return {
            success: true,
            data: [],
            pagination: { page: 1, limit: 1, total: 0, pages: 0 }
          };
        }

        const deleted = isDeletedRow(row);
        if (!includeDeleted && !onlyDeleted && deleted) {
          return {
            success: true,
            data: [],
            pagination: { page: 1, limit: 1, total: 0, pages: 0 }
          };
        }
        if (onlyDeleted && !deleted) {
          return {
            success: true,
            data: [],
            pagination: { page: 1, limit: 1, total: 0, pages: 0 }
          };
        }

        return {
          success: true,
          data: [row],
          pagination: { page: 1, limit: 1, total: 1, pages: 1 }
        };
      }

      let query = db.collection(collection);
      query = applyDeletedScope(query);
      query = applyTimeRange(query);

      query = applyStatusWhere(query, params.status)

      if (params.customerId) {
        query = query.where({ customerId: params.customerId });
      }
      if (params.supplierId) {
        query = query.where({ supplierId: params.supplierId });
      }

      if (collection === 'employees') {
        if (params.month) {
          query = query.where({ month: params.month });
        }
        if (params.department) {
          query = query.where({ department: params.department });
        }
      }

      // 采购通道筛选
      if (params.orderType) {
        query = query.where({ orderType: params.orderType });
      }
      if (params.excludeOrderType) {
        query = query.where({ orderType: _.neq(params.excludeOrderType) });
      }
      if (params.source) {
        query = query.where({ source: params.source });
      }
      if (params.purchaseCategory) {
        query = query.where({ purchaseCategory: params.purchaseCategory });
      }

      // 处理搜索
      if (normalizedParams.q && !normalizedParams.search) {
        normalizedParams.search = normalizedParams.q;
      }
      if (normalizedParams.search) {
        const pattern = db.RegExp({
          regexp: normalizedParams.search,
          options: 'i'
        });

        if (collection === 'employees') {
          query = query.where(
            _.or([
              { name: pattern },
              { department: pattern },
              { position: pattern }
            ])
          );
        } else if (collection === 'customers') {
          query = query.where(
            _.or([
              { companyName: pattern },
              { contactName: pattern },
              { name: pattern },
              { shortName: pattern }
            ])
          );
        } else if (collection === 'suppliers') {
          query = query.where(
            _.or([
              { name: pattern },
              { contactName: pattern },
              { shortName: pattern }
            ])
          );
        } else if (collection === 'orders' || collection === 'workorders' || collection === 'production') {
          query = query.where(
            _.or([
              { orderNo: pattern },
              { orderNumber: pattern },
              { order_number: pattern },
              { no: pattern },
              { customerName: pattern },
              { productName: pattern },
              { goodsName: pattern },
              { materialNo: pattern },
              { materialCode: pattern },
              { 'items.materialNo': pattern },
              { 'items.goodsName': pattern }
            ])
          );
        } else if (collection === 'products') {
          query = query.where(
            _.or([
              { name: pattern },
              { code: pattern },
              { sku: pattern }
            ])
          );
        } else {
          query = query.where({
            name: pattern
          });
        }
      }

      // 处理排序和分页
      const page = Math.max(1, parseInt(normalizedParams.page) || 1);
      const requestedLimit = parseInt(normalizedParams.pageSize || normalizedParams.limit) || 10;
      const limit = Math.min(Math.max(1, requestedLimit), queryMaxLimit);
      const skip = (page - 1) * limit;

      // 排序字段解析，支持 orderBy=field_dir，例如 _updateTime_desc
      // 默认使用云开发系统字段，避免因未建立索引或缺失业务字段导致查询失败
      let orderField = 'createdAt';  // 修改为通用字段，所有集合都应该有
      let orderDir = 'desc';
      if (typeof normalizedParams.orderBy === 'string') {
        const [field, dir] = normalizedParams.orderBy.split('_');
        if (field) orderField = field;
        if (dir && (dir === 'asc' || dir === 'desc')) orderDir = dir;
      }
      if (hasRange && orderField === 'createdAt') {
        orderField = '_createTime'
      }

      // 字段兼容性处理，确保集合中有该字段
      const fieldCompatibilityMap = {
        'orders': ['createdAt', '_createTime', 'orderTime'],
        'production': ['createdAt', '_createTime', 'scheduledDate'],
        'inventory': ['createdAt', '_createTime', 'updatedAt'],
        'customers': ['createdAt', '_createTime'],
        'products': ['createdAt', '_createTime'],
        'purchase_orders': ['createdAt', '_createTime']
      };

      // 如果指定字段可能不存在，尝试使用兼容字段
      if (fieldCompatibilityMap[collection] && !fieldCompatibilityMap[collection].includes(orderField)) {
        console.log(`[查询兼容性] 集合 ${collection} 可能不支持排序字段 ${orderField}，使用默认字段`);
        orderField = 'createdAt'; // 回退到通用字段
      }

      const take = Math.min(skip + limit + 600, 1000)
      const isOrdersCollection = collection === 'orders'
      const usedSkip = isOrdersCollection ? 0 : skip
      const usedLimit = isOrdersCollection ? take : limit

      // 尝试构建查询，如果排序字段导致失败，则降级
      let result;
      try {
        query = query.orderBy(orderField, orderDir)
          .skip(usedSkip)
          .limit(usedLimit);
        result = await query.get();
      } catch (err) {
        console.warn(`[查询降级] ${collection} 排序查询失败，尝试不排序查询:`, err);
        // 重置 query 对象 (需要重新构建)
        query = db.collection(collection);
        query = applyDeletedScope(query);
        query = applyTimeRange(query);
        // 重新应用筛选 (这里简化处理，仅重试无排序的基础查询)
        query = applyStatusWhere(query, normalizedParams.status)
        if (normalizedParams.customerId) query = query.where({ customerId: normalizedParams.customerId });
        if (normalizedParams.orderType) query = query.where({ orderType: normalizedParams.orderType });
        if (normalizedParams.source) query = query.where({ source: normalizedParams.source });

        // 分页（订单合并分页需要获取到 skip+limit 窗口）
        query = query.skip(usedSkip).limit(usedLimit);
        result = await query.get();
      }

      // 针对订单集合，合并临时集合 orders_tmp 的数据
      if (collection === 'orders') {
        const canonicalizeOrderNo = (row) => {
          const o = row && typeof row === 'object' ? row : {}
          const candidate = [
            o?.data?.orderNo,
            o?.data?.orderNumber,
            o?.orderNo,
            o?.orderNumber,
            o?.order_number,
            o?.no
          ].map(v => String(v || '').trim()).find(Boolean) || ''
          if (!candidate) return o
          return { ...o, orderNo: candidate, orderNumber: candidate }
        }

        const getOrderTs = (o, orderField) => {
          const v = o?.[orderField] ?? o?.updatedAt ?? o?.updateTime ?? o?._updateTime ?? o?.createdAt ?? o?._createTime ?? o?.createTime
          if (typeof v === 'number') return v
          const t = Date.parse(String(v || ''))
          return Number.isFinite(t) ? t : 0
        }

        const buildPreferScore = (src) => {
          const s = String(src || '')
          if (s === 'orders') return 4
          if (s === 'orders_tmp') return 3
          if (s === 'erp_orders') return 2
          if (s === 'order_list') return 1
          return 0
        }

        const pickBetterOrder = (a, b, orderField) => {
          if (!a) return b
          if (!b) return a
          const sa = buildPreferScore(a.__src)
          const sb = buildPreferScore(b.__src)
          if (sa !== sb) return sa > sb ? a : b
          const ta = getOrderTs(a, orderField)
          const tb = getOrderTs(b, orderField)
          if (ta !== tb) return ta > tb ? a : b
          const ida = String(a._id || a.id || '')
          const idb = String(b._id || b.id || '')
          if (ida && !idb) return a
          if (idb && !ida) return b
          return a
        }

        const buildOrderAliasQuery = (collectionName) => {
          let q = db.collection(collectionName);
          q = applyDeletedScope(q);
          q = applyTimeRange(q);
          q = applyStatusWhere(q, normalizedParams.status)
          if (normalizedParams.customerId) q = q.where({ customerId: normalizedParams.customerId });
          if (normalizedParams.orderType) q = q.where({ orderType: normalizedParams.orderType });
          if (normalizedParams.excludeOrderType) q = q.where({ orderType: _.neq(normalizedParams.excludeOrderType) });
          if (normalizedParams.source) q = q.where({ source: normalizedParams.source });
          if (normalizedParams.purchaseCategory) q = q.where({ purchaseCategory: normalizedParams.purchaseCategory });
          if (normalizedParams.search) {
            q = q.where(db.RegExp({ regexp: normalizedParams.search, options: 'i' }));
          }
          return q;
        };

        const fetchOrderAliasPage = async (collectionName) => {
          try {
            return await buildOrderAliasQuery(collectionName).orderBy(orderField, orderDir).skip(0).limit(take).get();
          } catch (_) {
            try {
              return await buildOrderAliasQuery(collectionName).orderBy('_createTime', orderDir).skip(0).limit(take).get();
            } catch (_) {
              try {
                return await buildOrderAliasQuery(collectionName).skip(0).limit(take).get();
              } catch (_) {
                return { data: [] };
              }
            }
          }
        };

        let tmpAll = { data: [] };
        try {
          tmpAll = await fetchOrderAliasPage('orders_tmp');
        } catch (e) { console.warn('orders_tmp query failed', e); }

        const aliases = ['erp_orders', 'order_list'];
        const aliasData = [];
        const aliasMeta = [];
        const aliasErrors = [];

        for (const name of aliases) {
          try {
            const got = await fetchOrderAliasPage(name);
            const len = Array.isArray(got.data) ? got.data.length : 0
            aliasMeta.push({ name, len })
            if (len) aliasData.push(...got.data);
          } catch (err) {
            console.warn(`Alias ${name} query failed:`, err);
            aliasErrors.push({ name, error: err.message });
            aliasMeta.push({ name, len: 0, error: String(err && (err.message || err) || '') })
          }
        }

        const baseLen = Array.isArray(result.data) ? result.data.length : 0
        const tmpLen = Array.isArray(tmpAll.data) ? tmpAll.data.length : 0
        const baseRows = (result.data || []).map((o) => (o ? canonicalizeOrderNo({ ...o, __src: 'orders' }) : o))
        const tmpRows = (tmpAll.data || []).map((o) => (o ? canonicalizeOrderNo({ ...o, __src: 'orders_tmp' }) : o))
        const aliasRows = aliasData.map((o) => {
          const inferred =
            (o && typeof o === 'object' && (o.__src || o.__source)) ? String(o.__src || o.__source) : ''
          const src = inferred && aliases.includes(inferred) ? inferred : undefined
          return o ? canonicalizeOrderNo({ ...o, __src: src || 'alias' }) : o
        })
        const merged = [...baseRows, ...tmpRows, ...aliasRows];

        const byId = new Map()
        const byNo = new Map()
        for (const raw of merged) {
          if (!raw) continue
          const o = raw && typeof raw === 'object' ? raw : {}
          const no = String(o.orderNo || o.orderNumber || '').trim()
          const id = String(o._id || o.id || '').trim()
          if (id) {
            const prev = byId.get(id)
            byId.set(id, pickBetterOrder(prev, o, orderField))
          }
          if (no) {
            const arr = byNo.get(no) || []
            arr.push(o)
            byNo.set(no, arr)
          }
        }

        const mergedUnique = []
        const usedIds = new Set()
        const pushRow = (row) => {
          if (!row || typeof row !== 'object') return
          const id = String(row._id || row.id || '').trim()
          if (id) {
            if (usedIds.has(id)) return
            usedIds.add(id)
            mergedUnique.push(byId.get(id) || row)
            return
          }
          mergedUnique.push(row)
        }

        for (const [, arr] of byNo.entries()) {
          const list = Array.isArray(arr) ? arr : []
          if (!list.length) continue
          const hasOrders = list.some((x) => x && String(x.__src || '') === 'orders')
          if (hasOrders) {
            const ordersRows = list.filter((x) => x && String(x.__src || '') === 'orders')
            ordersRows.forEach(pushRow)
          } else {
            let best = null
            for (const row of list) {
              best = pickBetterOrder(best, row, orderField)
            }
            if (best) pushRow(best)
          }
        }

        for (const [id, row] of byId.entries()) {
          if (!id) continue
          const no = String(row?.orderNo || row?.orderNumber || '').trim()
          if (no) continue
          if (usedIds.has(id)) continue
          usedIds.add(id)
          mergedUnique.push(row)
        }

        const sorted = mergedUnique.sort((a, b) => {
          const avTs = getOrderTs(a, orderField)
          const bvTs = getOrderTs(b, orderField)
          return orderDir === 'desc' ? (bvTs - avTs) : (avTs - bvTs)
        })
        const paged = sorted.slice(skip, skip + limit).map((o) => {
          if (!o || typeof o !== 'object') return o
          const { __src, __source, ...rest } = o
          return rest
        })

        const countKeyObj = {
          dateRange: normalizedParams?.dateRange || null,
          status: normalizedParams?.status || null,
          customerId: normalizedParams?.customerId || null,
          orderType: normalizedParams?.orderType || null,
          excludeOrderType: normalizedParams?.excludeOrderType || null,
          source: normalizedParams?.source || null,
          purchaseCategory: normalizedParams?.purchaseCategory || null,
          search: normalizedParams?.search || null
        }
        const countKey = `ordersCount:${JSON.stringify(countKeyObj)}`
        const countCache = (global.__ordersCountCache && global.__ordersCountCache instanceof Map) ? global.__ordersCountCache : (global.__ordersCountCache = new Map())
        const cached = countCache.get(countKey)
        const nowTs = Date.now()

        let countOrders = { total: 0 }
        let countTmp = { total: 0 }
        let aliasTotal = 0

        if (cached && cached.expireAt > nowTs) {
          countOrders.total = Number(cached.orders || 0)
          countTmp.total = Number(cached.orders_tmp || 0)
          aliasTotal = Number(cached.aliasTotal || 0)
        } else {
          try { countOrders = await buildOrderAliasQuery('orders').count(); } catch (e) { console.warn('Count orders failed', e); }
          try { countTmp = await buildOrderAliasQuery('orders_tmp').count(); } catch (e) { console.warn('Count orders_tmp failed', e); }
          for (const name of aliases) {
            try {
              const c = await buildOrderAliasQuery(name).count()
              aliasTotal += Number(c.total || 0)
            } catch (_) { void 0 }
          }

          countCache.set(countKey, {
            expireAt: nowTs + 30000,
            orders: Number(countOrders.total || 0),
            orders_tmp: Number(countTmp.total || 0),
            aliasTotal: Number(aliasTotal || 0)
          })
          if (countCache.size > 60) {
            const keys = Array.from(countCache.keys()).slice(0, countCache.size - 60)
            for (const k of keys) countCache.delete(k)
          }
        }

        const computedTotal = Math.max(
          Number(countOrders.total || 0) + Number(countTmp.total || 0) + Number(aliasTotal || 0),
          mergedUnique.length
        )
        const exhausted =
          baseLen < take &&
          tmpLen < take &&
          (aliasMeta.length ? aliasMeta.every((m) => Number(m?.len || 0) < take) : true)
        const totalOut = exhausted ? sorted.length : computedTotal
        const anySourceFull =
          baseLen >= take ||
          tmpLen >= take ||
          (aliasMeta.length ? aliasMeta.some((m) => Number(m?.len || 0) >= take) : false)
        const hasMoreOut = exhausted
          ? (skip + paged.length < totalOut)
          : (sorted.length > (skip + limit) || (paged.length === limit && anySourceFull))

        return finalizeWithPerf({
          success: true,
          data: paged,
          pagination: {
            page: page,
            limit: limit,
            total: totalOut,
            pages: Math.ceil((totalOut || 1) / limit),
            hasMore: hasMoreOut
          },
          debug: (normalizedParams && (normalizedParams.debug === '1' || normalizedParams.debug === 'true')) ? {
            collections: ['orders', 'orders_tmp', ...aliases],
            orderBy: orderField + '_' + orderDir,
            aliasErrors: aliasErrors,
            counts: { orders: countOrders.total, orders_tmp: countTmp.total, aliasTotal, mergedUnique: mergedUnique.length, baseLen, tmpLen, aliasMeta, take, exhausted }
          } : undefined
        }, { page, limit, skip, returned: Array.isArray(paged) ? paged.length : 0, total: totalOut, merged: true, take, orderBy: orderField + '_' + orderDir });
      }

      if (collection !== 'orders') {
        const aliasNames = this.aliases[collection] || [];
        if (aliasNames.length) {
          const aliasData = [];
          const aliasErrors = [];
          for (const name of aliasNames) {
            try {
              let q = db.collection(name);
              q = applyDeletedScope(q);
              q = applyTimeRange(q);
              q = applyStatusWhere(q, normalizedParams.status)
              if (normalizedParams.customerId) q = q.where({ customerId: normalizedParams.customerId });
              if (normalizedParams.orderType) q = q.where({ orderType: normalizedParams.orderType });
              if (normalizedParams.excludeOrderType) q = q.where({ orderType: _.neq(normalizedParams.excludeOrderType) });
              if (normalizedParams.source) q = q.where({ source: normalizedParams.source });
              if (normalizedParams.purchaseCategory) q = q.where({ purchaseCategory: normalizedParams.purchaseCategory });
              if (normalizedParams.search) {
                const pattern = db.RegExp({ regexp: normalizedParams.search, options: 'i' })
                if (collection === 'employees') {
                  q = q.where(
                    _.or([
                      { name: pattern },
                      { department: pattern },
                      { position: pattern }
                    ])
                  )
                } else if (collection === 'customers') {
                  q = q.where(
                    _.or([
                      { companyName: pattern },
                      { contactName: pattern },
                      { name: pattern },
                      { shortName: pattern }
                    ])
                  )
                } else if (collection === 'suppliers') {
                  q = q.where(
                    _.or([
                      { name: pattern },
                      { contactName: pattern },
                      { shortName: pattern },
                      { companyName: pattern },
                      { vendorName: pattern }
                    ])
                  )
                } else if (collection === 'orders' || collection === 'workorders' || collection === 'production') {
                  q = q.where(
                    _.or([
                      { orderNumber: pattern },
                      { customerName: pattern }
                    ])
                  )
                } else if (collection === 'products') {
                  q = q.where(
                    _.or([
                      { name: pattern },
                      { code: pattern },
                      { sku: pattern }
                    ])
                  )
                } else {
                  q = q.where({ name: pattern })
                }
              }
              q = q.orderBy(orderField, orderDir).skip(skip).limit(limit);
              const got = await q.get();
              if (Array.isArray(got.data) && got.data.length) {
                aliasData.push(...got.data);
              }
            } catch (err) {
              console.warn(`Alias ${name} query failed:`, err);
              aliasErrors.push({ name, error: err.message });
            }
          }
          const merged = [...(result.data || []), ...aliasData];
          const toTs = (v) => (typeof v === 'number' ? v : (Date.parse(v) || 0));
          const sorted = merged.sort((a, b) => {
            const avTs = toTs(a?.[orderField]);
            const bvTs = toTs(b?.[orderField]);
            return orderDir === 'desc' ? (bvTs - avTs) : (avTs - bvTs);
          });
          const paged = sorted.slice(skip, skip + limit);

          let baseCount = { total: 0 };
          try { baseCount = await applyTimeRange(applyDeletedScope(db.collection(collection))).count(); } catch (e) { console.warn('Base count failed', e); }

          let aliasTotal = 0;
          for (const name of aliasNames) {
            try {
              const c = await applyTimeRange(applyDeletedScope(db.collection(name))).count();
              aliasTotal += Number(c.total || 0);
            } catch (_) { }
          }

          return {
            success: true,
            data: paged,
            pagination: {
              page,
              limit,
              total: (baseCount.total || 0) + aliasTotal,
              pages: Math.ceil((((baseCount.total || 0) + aliasTotal) || 1) / limit)
            },
            debug: (normalizedParams && (normalizedParams.debug === '1' || normalizedParams.debug === 'true')) ? {
              collections: [collection, ...aliasNames],
              orderBy: orderField + '_' + orderDir,
              aliasErrors,
              counts: { base: baseCount.total, aliasTotal }
            } : undefined
          };
        }
      }

      const countResult = await applyTimeRange(applyDeletedScope(db.collection(collection))).count();
      return finalizeWithPerf({
        success: true,
        data: result.data,
        pagination: {
          page: page,
          limit: limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        },
        debug: (normalizedParams && (normalizedParams.debug === '1' || normalizedParams.debug === 'true')) ? { collection, page, limit, orderBy: normalizedParams.orderBy } : undefined
      }, { page, limit, skip, returned: Array.isArray(result?.data) ? result.data.length : 0, total: Number(countResult?.total || 0), orderBy: normalizedParams?.orderBy || null });
    } catch (error) {
      const wantDebug = normalizedParams && (normalizedParams.debug === '1' || normalizedParams.debug === 'true');
      const msg = String(error && (error.errMsg || error.message || error)).toLowerCase();
      const code = typeof error?.errCode === 'number' ? error.errCode : undefined;
      const isMissing = msg.includes('collection.get:fail') || msg.includes('not exist') || code === -502005;
      if (isMissing && collection === 'orders') {
        try {
          let query2 = db.collection('orders_tmp');
          query2 = applyDeletedScope(query2);
          query2 = applyTimeRange(query2);
          if (normalizedParams.status) query2 = query2.where({ status: normalizedParams.status });
          if (normalizedParams.customerId) query2 = query2.where({ customerId: normalizedParams.customerId });
          if (normalizedParams.search) {
            query2 = query2.where(db.RegExp({ regexp: normalizedParams.search, options: 'i' }));
          }
          const page = Math.max(1, parseInt(normalizedParams.page) || 1);
          const requestedLimit = parseInt(normalizedParams.pageSize || normalizedParams.limit) || 10;
          const limit = Math.min(Math.max(1, requestedLimit), queryMaxLimit);
          const skip = (page - 1) * limit;
          // 排序字段解析
          let orderField = 'createdAt';
          let orderDir = 'desc';
          if (typeof normalizedParams.orderBy === 'string') {
            const [field, dir] = normalizedParams.orderBy.split('_');
            if (field) orderField = field;
            if (dir && (dir === 'asc' || dir === 'desc')) orderDir = dir;
          }
          query2 = query2.orderBy(orderField, orderDir).skip(skip).limit(limit);
          const result2 = await query2.get();
          const count2 = await applyNotDeleted(db.collection('orders_tmp')).count();
          return finalizeWithPerf({
            success: true,
            data: result2.data,
            pagination: { page, limit, total: count2.total, pages: Math.ceil(count2.total / limit) },
            debug: wantDebug ? { fallback: 'orders_tmp', error: String(error && (error.errMsg || error.message || error)), code } : undefined
          }, { page, limit, skip, returned: Array.isArray(result2?.data) ? result2.data.length : 0, total: Number(count2?.total || 0), fallback: 'orders_tmp' });
        } catch (_) {
          const page = Math.max(1, parseInt(params.page) || 1);
          const requestedLimit = parseInt(params.pageSize || params.limit) || 10;
          const limit = Math.min(Math.max(1, requestedLimit), queryMaxLimit);
          return finalizeWithPerf({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 }, debug: wantDebug ? { fallback: 'empty', error: String(error && (error.errMsg || error.message || error)), code } : undefined }, { page, limit, returned: 0, total: 0, fallback: 'empty' });
        }
      } else if (isMissing) {
        const page = Math.max(1, parseInt(params.page) || 1);
        const requestedLimit = parseInt(params.pageSize || params.limit) || 10;
        const limit = Math.min(Math.max(1, requestedLimit), queryMaxLimit);
        const aliasNames = this.aliases[collection] || [];
        if (aliasNames.length) {
          try {
            const aliasData = [];
            for (const name of aliasNames) {
              try {
                let q = db.collection(name);
                if (params.status) q = q.where({ status: params.status });
                if (params.customerId) q = q.where({ customerId: params.customerId });
                if (params.search) q = q.where(db.RegExp({ regexp: params.search, options: 'i' }));
                const got = await q.get();
                if (Array.isArray(got.data) && got.data.length) aliasData.push(...got.data);
              } catch (_) { }
            }
            const paged = aliasData.slice((page - 1) * limit, (page - 1) * limit + limit);
            let aliasTotal = 0;
            for (const name of aliasNames) {
              try {
                const c = await db.collection(name).count();
                aliasTotal += Number(c.total || 0);
              } catch (_) { }
            }
            return finalizeWithPerf({ success: true, data: paged, pagination: { page, limit, total: aliasTotal, pages: Math.ceil((aliasTotal || 1) / limit) }, debug: wantDebug ? { fallback: 'aliases', collections: aliasNames } : undefined }, { page, limit, returned: Array.isArray(paged) ? paged.length : 0, total: aliasTotal, fallback: 'aliases' });
          } catch (_) { }
        }
        return finalizeWithPerf({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 }, debug: wantDebug ? { fallback: 'empty', error: String(error && (error.errMsg || error.message || error)), code } : undefined }, { page, limit, returned: 0, total: 0, fallback: 'empty' });
      }
      console.error(`查询失败 [${collection}]:`, error);
      // 为了保证前端页面不因单个集合异常而崩溃，这里兜底返回空列表
      const page = Math.max(1, parseInt(params.page) || 1);
      const requestedLimit = parseInt(params.pageSize || params.limit) || 10;
      const limit = Math.min(Math.max(1, requestedLimit), queryMaxLimit);
      return finalizeWithPerf({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 }, debug: wantDebug ? { error: String(error && (error.errMsg || error.message || error)), code } : undefined }, { page, limit, returned: 0, total: 0, error: true });
    }
  }

  async create(collection, data) {
    try {
      const recordData = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection(collection).add({
        data: recordData
      });

      return {
        success: true,
        data: {
          _id: result._id,
          ...recordData
        }
      };
    } catch (error) {
      const msg = String(error && (error.errMsg || error.message || error)).toLowerCase();
      const code = typeof error?.errCode === 'number' ? error.errCode : undefined;
      const isMissing = msg.includes('collection.add:fail') || msg.includes('collection not exist') || code === -502005;
      if (isMissing) {
        try {
          await db.createCollection(collection);
          const result = await db.collection(collection).add({
            data: {
              ...data,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          });
          return {
            success: true,
            data: {
              _id: result._id,
              ...data,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          };
        } catch (e2) {
          console.error(`创建集合或记录失败 [${collection}]:`, e2);
          throw new Error(`创建记录失败: ${e2.message || e2}`);
        }
      }
      console.error(`创建记录失败 [${collection}]:`, error);
      throw new Error(`创建记录失败: ${error.message || error}`);
    }
  }

  async update(collection, id, data) {
    try {
      const updateData = {
        ...data,
        updatedAt: new Date()
      };

      const result = await db.collection(collection).doc(id).update({
        data: updateData
      });

      return {
        success: true,
        data: {
          _id: id,
          ...updateData
        }
      };
    } catch (error) {
      console.error(`更新记录失败 [${collection}]:`, error);
      throw new Error(`更新记录失败: ${error.message}`);
    }
  }

  async delete(collection, id) {
    try {
      await db.collection(collection).doc(id).remove();
      return {
        success: true,
        data: { _id: id, deleted: true }
      };
    } catch (error) {
      console.error(`删除记录失败 [${collection}]:`, error);
      throw new Error(`删除记录失败: ${error.message}`);
    }
  }

  async getStats(collection, params = {}) {
    try {
      // 统计数据：orders 合并临时集合
      if (collection === 'orders') {
        const toMs = (v) => {
          if (v == null || v === '') return null
          if (v instanceof Date) {
            const t = v.getTime()
            return Number.isFinite(t) ? t : null
          }
          const n = Number(v)
          if (Number.isFinite(n) && n > 0) return n
          const t = Date.parse(String(v))
          return Number.isFinite(t) ? t : null
        }

        const rangeStartMs =
          toMs(params.startDate) ??
          toMs(params.start) ??
          toMs(params.startTime) ??
          toMs(params.startTs)
        const rangeEndMs =
          toMs(params.endDate) ??
          toMs(params.end) ??
          toMs(params.endTime) ??
          toMs(params.endTs)
        const hasRange = rangeStartMs != null || rangeEndMs != null

        const countOrdersInRange = async (collectionName) => {
          if (!hasRange) return 0
          const start = rangeStartMs != null ? rangeStartMs : 0
          const end = rangeEndMs != null ? rangeEndMs : Date.now()
          const startDate = new Date(start)
          const endDate = new Date(end)
          try {
            const res = await db.collection(collectionName).where(
              _.or([
                { _createTime: _.gte(start).and(_.lte(end)) },
                { _createTime: _.gte(startDate).and(_.lte(endDate)) },
                { createdAt: _.gte(start).and(_.lte(end)) },
                { createdAt: _.gte(startDate).and(_.lte(endDate)) }
              ])
            ).count()
            return Number(res && res.total ? res.total : 0)
          } catch (_) {
            return 0
          }
        }

        const totalOrders = await db.collection('orders').count();
        const totalTmp = await db.collection('orders_tmp').count();
        const statusOrders = await db.collection('orders').aggregate().group({ _id: '$status', count: _.sum(1) }).end();
        const statusTmp = await db.collection('orders_tmp').aggregate().group({ _id: '$status', count: _.sum(1) }).end();
        const merged = new Map();
        for (const it of (statusOrders.list || [])) {
          merged.set(it._id, (merged.get(it._id) || 0) + (it.count || 0));
        }
        for (const it of (statusTmp.list || [])) {
          merged.set(it._id, (merged.get(it._id) || 0) + (it.count || 0));
        }
        const byStatus = Array.from(merged.entries()).map(([s, c]) => ({ _id: s, count: c }));
        const rangeCount = hasRange
          ? (await countOrdersInRange('orders')) + (await countOrdersInRange('orders_tmp'))
          : undefined

        return {
          success: true,
          data: {
            total: (totalOrders.total || 0) + (totalTmp.total || 0),
            byStatus,
            ...(hasRange ? { rangeCount } : {})
          }
        };
      }

      const aliasNames = this.aliases[collection] || [];
      let baseTotal = 0;
      let byStatusMap = new Map();
      try {
        const totalResult = await db.collection(collection).count();
        baseTotal = Number(totalResult.total || 0);
        try {
          const statusResult = await db.collection(collection).aggregate().group({ _id: '$status', count: _.sum(1) }).end();
          for (const it of (statusResult.list || [])) {
            byStatusMap.set(it._id, (byStatusMap.get(it._id) || 0) + (it.count || 0));
          }
        } catch (_) { }
      } catch (_) { }

      let aliasTotal = 0;
      for (const name of aliasNames) {
        try {
          const totalResult = await db.collection(name).count();
          aliasTotal += Number(totalResult.total || 0);
          try {
            const statusResult = await db.collection(name).aggregate().group({ _id: '$status', count: _.sum(1) }).end();
            for (const it of (statusResult.list || [])) {
              byStatusMap.set(it._id, (byStatusMap.get(it._id) || 0) + (it.count || 0));
            }
          } catch (_) { }
        } catch (_) { }
      }

      const total = baseTotal + aliasTotal;
      const byStatus = Array.from(byStatusMap.entries()).map(([s, c]) => ({ _id: s, count: c }));
      return { success: true, data: { total, byStatus } };
    } catch (error) {
      const msg = String(error && (error.errMsg || error.message || error)).toLowerCase();
      const code = typeof error?.errCode === 'number' ? error.errCode : undefined;
      const isMissing = msg.includes('collection.count:fail') || msg.includes('not exist') || code === -502005;
      if (isMissing && collection === 'orders') {
        try {
          const totalResult = await db.collection('orders_tmp').count();
          const statusResult = await db.collection('orders_tmp').aggregate()
            .group({ _id: '$status', count: _.sum(1) }).end();
          return { success: true, data: { total: totalResult.total, byStatus: statusResult.list || [] } };
        } catch (_) {
          return { success: true, data: { total: 0, byStatus: [] } };
        }
      } else if (isMissing) {
        const aliasNames = this.aliases[collection] || [];
        if (aliasNames.length) {
          let aliasTotal = 0;
          let byStatusMap = new Map();
          for (const name of aliasNames) {
            try {
              const totalResult = await db.collection(name).count();
              aliasTotal += Number(totalResult.total || 0);
              try {
                const statusResult = await db.collection(name).aggregate().group({ _id: '$status', count: _.sum(1) }).end();
                for (const it of (statusResult.list || [])) {
                  byStatusMap.set(it._id, (byStatusMap.get(it._id) || 0) + (it.count || 0));
                }
              } catch (_) { }
            } catch (_) { }
          }
          const byStatus = Array.from(byStatusMap.entries()).map(([s, c]) => ({ _id: s, count: c }));
          return { success: true, data: { total: aliasTotal, byStatus } };
        }
        return { success: true, data: { total: 0, byStatus: [] } };
      }
      console.error(`获取统计失败 [${collection}]:`, error);
      throw new Error(`获取统计失败: ${error.message}`);
    }
  }
}

// 创建全局适配器实例
const cloudAdapter = new CloudDatabaseAdapter();

/**
 * 荣禾ERP - API桥接云函数
 * 接收传统HTTP API请求，转换为云开发操作
 * 支持电脑端API与云开发的无缝对接
 */

// CORS处理 - 使用白名单验证
function handleCors(event) {
  // 从环境变量读取允许的域名列表
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsEnv
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);

  // 如果未配置,使用默认安全列表(仅本地开发)
  const defaultAllowedOrigins = [
    'null',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'https://localhost:3001',
    'https://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'https://localhost:3002',
    'https://127.0.0.1:3002'
  ];

  const finalAllowedOrigins = allowedOrigins.length > 0
    ? allowedOrigins
    : defaultAllowedOrigins;

  // 获取请求的Origin
  const requestOrigin = event.headers?.origin || event.headers?.Origin || '';

  // 验证Origin是否在白名单中
  const isPrivateOrigin = (() => {
    if (!requestOrigin) return false
    if (requestOrigin === 'null') return true
    const m = String(requestOrigin).match(/^https?:\/\/([^/:]+)(?::\d+)?$/i)
    const host = m && m[1] ? String(m[1]).toLowerCase() : ''
    if (!host) return false
    if (host === 'localhost' || host === '127.0.0.1') return true
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
    const s = host.split('.').map((v) => Number(v))
    if (s.length === 4 && s.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      if (s[0] === 172 && s[1] >= 16 && s[1] <= 31) return true
    }
    return false
  })()
  const isAllowed = finalAllowedOrigins.includes(requestOrigin) || isPrivateOrigin

  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Authorization, X-Access-Token, x-authorization, x-access-token, x-client-platform, X-Client-Platform, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
  };
  if (isAllowed && requestOrigin) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers.Vary = 'Origin';
  }

  const response = {
    statusCode: 200,
    headers
  };

  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return response;
  }

  // 如果Origin不在白名单中,拒绝请求
  if (requestOrigin && !isAllowed) {
    console.warn(`[CORS] 拒绝来自未授权域名的请求: ${requestOrigin}`);
    return {
      statusCode: 403,
      headers: response.headers,
      body: JSON.stringify({
        success: false,
        message: 'CORS policy: Origin not allowed'
      })
    };
  }

  return response;
}

// 错误处理
function handleError(error, message = '操作失败') {
  console.error('API错误:', error);

  return {
    success: false,
    message: message,
    error: error.message || error.toString()
  };
}

// 成功响应
function handleSuccess(data, message = '操作成功') {
  return {
    success: true,
    message: message,
    data: data
  };
}

// 解析请求参数
function parseRequestBody(event) {
  try {
    if (!event || event.body == null) return {};
    if (typeof event.body === 'object') {
      return event.body;
    }
    const rawBody = String(event.body || '').trim();
    if (!rawBody) return {};
    if (event.isBase64Encoded === true) {
      const decoded = Buffer.from(rawBody, 'base64').toString('utf8').trim();
      if (!decoded) return {};
      return JSON.parse(decoded);
    }
    return JSON.parse(rawBody);
  } catch (error) {
    console.error('解析请求体失败:', error);
  }
  return {};
}

function parseQueryParams(event) {
  const params = {};

  if (event.queryStringParameters) {
    Object.keys(event.queryStringParameters).forEach(key => {
      params[key] = event.queryStringParameters[key];
    });
  }

  return params;
}

function resolveRoutePathFromEvent(event, bodyPath, queryPath) {
  const normalize = (v) => {
    const s = String(v == null ? '' : v).trim()
    return s
  }

  const fromBody = normalize(bodyPath)
  const fromQuery = normalize(queryPath)
  const direct =
    normalize(event && event.path) ||
    normalize(event && event.rawPath) ||
    normalize(event && event.requestContext && event.requestContext.path) ||
    normalize(event && event.requestContext && event.requestContext.http && event.requestContext.http.path)

  const baseCandidate = fromBody || fromQuery || direct

  const pathParameters = (event && event.pathParameters) ? event.pathParameters : {}
  const proxy = normalize(pathParameters && (pathParameters.proxy || pathParameters['0'] || pathParameters.path))

  if (proxy) {
    const proxyPath = `/${String(proxy).replace(/^\/+/, '')}`
    if (!baseCandidate || baseCandidate === '/api-bridge' || baseCandidate === '/api-bridge/' || /\/api-bridge\/?$/.test(baseCandidate)) {
      return proxyPath
    }
    if (baseCandidate.includes('/api-bridge') && !baseCandidate.includes(proxyPath)) {
      if (/\/api-bridge\/?$/.test(baseCandidate)) return `${baseCandidate.replace(/\/$/, '')}${proxyPath}`
    }
  }

  // Fallback: when using HTTP trigger with base path '/api-bridge', strip the prefix
  // This covers providers that do not populate pathParameters.proxy properly
  if (baseCandidate && (baseCandidate === '/api-bridge' || baseCandidate.startsWith('/api-bridge/'))) {
    const stripped = baseCandidate.replace(/^\/api-bridge/, '')
    return stripped || '/'
  }

  return baseCandidate
}

function buildAuthHeaderFromEvent(event) {
  const headers = event && event.headers ? event.headers : {};
  const authorization =
    headers.Authorization ||
    headers.authorization ||
    headers['X-Authorization'] ||
    headers['x-authorization'] ||
    headers['X_AUTHORIZATION'] ||
    headers['x_authorization'] ||
    '';
  const token =
    headers['X-Access-Token'] ||
    headers['x-access-token'] ||
    headers['X_ACCESS_TOKEN'] ||
    headers['x_access_token'] ||
    '';
  const authValue = String(authorization || '').trim() || (token ? `Bearer ${String(token).trim()}` : '')
  return authValue ? { Authorization: authValue } : {};
}

function resolveTokenSecret() {
  const direct =
    process.env.ERP_TOKEN_SECRET ||
    process.env.WX_API_TOKEN ||
    process.env.WX_TRIGGER_API_TOKEN_V0 ||
    ''
  if (direct && String(direct).trim()) return String(direct).trim()

  const envId =
    process.env.TCB_ENV ||
    process.env.ENV_ID ||
    process.env.TENCENTCLOUD_TCBENV ||
    ''
  const appId = process.env.TENCENTCLOUD_APPID || ''
  const base = `${String(envId || '').trim()}|${String(appId || '').trim()}|erp-system`
  const derived = crypto.createHash('sha256').update(base).digest('hex')
  if (!global.__warnedDerivedTokenSecret) {
    global.__warnedDerivedTokenSecret = true
    console.warn('[api-bridge] 未配置ERP_TOKEN_SECRET，已使用派生密钥；建议配置稳定的ERP_TOKEN_SECRET')
  }
  return derived
}

// 身份验证（简化版本）
async function authenticateRequest(event) {
  const headers = event.headers || {};
  const authorization =
    headers.Authorization ||
    headers.authorization ||
    headers['X-Authorization'] ||
    headers['x-authorization'] ||
    headers['X_AUTHORIZATION'] ||
    headers['x_authorization'] ||
    headers['X-Access-Token'] ||
    headers['x-access-token'] ||
    headers['X_ACCESS_TOKEN'] ||
    headers['x_access_token'] ||
    '';
  const clientPlatformRaw =
    headers['x-client-platform'] ||
    headers['X-Client-Platform'] ||
    headers['x_client_platform'] ||
    headers['X_CLIENT_PLATFORM'] ||
    '';
  const method = (event.httpMethod || '').toUpperCase();
  const path = event.path || '';

  // 允许 OPTIONS 请求通过（CORS 预检）
  if (method === 'OPTIONS') {
    return { userId: 'anonymous', valid: true };
  }

  // 兼容根路径+内部路由参数的情况
  let bodyPath = '';
  try {
    if (event.body) {
      const parsed = JSON.parse(event.body);
      bodyPath = parsed && parsed.path ? String(parsed.path) : '';
    }
  } catch (e) { }
  const queryPath = (event.queryStringParameters && event.queryStringParameters.path) || '';
  const resolvedPath = resolveRoutePathFromEvent(event, bodyPath, queryPath)
  const candidatePaths = [resolvedPath, path, bodyPath, queryPath].filter(Boolean);
  const allowExpiredTokenForRefresh = candidatePaths.some((p) => String(p).includes('/auth/refresh'))

  const readOnlyEndpoints = ['/orders', '/orders/list', '/purchases', '/purchases/list', '/customers', '/customers/list', '/employees', '/employees/list', '/suppliers', '/suppliers/list', '/supplier-materials', '/material-codes', '/inventory', '/inventory/list', '/workorders', '/workorders/list', '/products', '/products/list', '/production', '/production/list', '/users', '/users/list', '/payables', '/payables/list', '/dashboard/stats', '/health'];
  if (method === 'GET') {
    if (readOnlyEndpoints.some(endpoint => candidatePaths.some(p => String(p).includes(endpoint)))) {
      return { userId: 'anonymous', valid: true };
    }
  }

  // 公开接口（任何方法）
  const publicEndpoints = ['/public', '/auth/login', '/order-numbers'];
  if (publicEndpoints.some(endpoint => candidatePaths.some(p => String(p).includes(endpoint)))) {
    return { userId: 'anonymous', valid: true };
  }

  if (authorization) {
    const payload = parseTokenFromHeader(
      event,
      allowExpiredTokenForRefresh ? { allowExpired: true, maxExpiredMs: 7 * 24 * 60 * 60 * 1000 } : undefined
    );
    if (payload && payload.userId) {
      const role = normalizeRoleValue(payload.role)
      const isAdmin = role === 'admin' || role === 'administrator'
      const isFinance = role === 'finance' || role === 'accounting'
      const canNonAdminWrite = method !== 'GET' && candidatePaths.some(p => (
        String(p).includes('/material-codes') ||
        String(p).includes('/supplier-materials')
      ))
      const canFinanceWrite = isFinance && method !== 'GET' && candidatePaths.some(p => (
        String(p).includes('/statements') ||
        String(p).includes('/customer-aliases')
      ))
      if (!isAdmin && !canFinanceWrite && !canNonAdminWrite && method !== 'GET') {
        const err = new Error('无权限访问')
        err.statusCode = 403
        throw err
      }
      return {
        userId: String(payload.userId),
        username: payload.username || '',
        role: payload.role || 'user',
        valid: true,
        isAdmin
      }
    }
  }

  if (method !== 'GET') {
    const err = new Error('未授权访问')
    err.statusCode = 401
    throw err
  }
  return { userId: 'anonymous', valid: true }
}

// 路由分发
async function routeRequest(path, method, params, user) {
  const usedPath = String(path || '');
  global.__lastPath = usedPath;
  if (usedPath === '/customers/sku-stats' || usedPath.startsWith('/customers/sku-stats?')) {
    return await handleCustomerSkuStats(method, params, user);
  }
  if (/^\/customers\/[^/?#]+\/skus(\/|$|\?)/.test(usedPath)) {
    return await handleCustomerSkus(method, params, user);
  }
  const routes = {
    // 认证相关
    '/auth/login': () => handleAuthLogin(method, params),
    '/auth/logout': () => handleAuthLogout(method, params),
    '/auth/me': () => handleAuthMe(method, params, user),
    '/auth/refresh': () => handleAuthRefresh(method, params, user),
    // 订单相关
    '/orders': () => handleOrders(method, params, user),
    '/orders/list': () => handleOrdersList(method, params),
    '/orders/stats': () => handleOrdersStats(method, params),
    '/orders/next-no': () => handleOrdersNextNo(method, params),
    '/order-numbers': () => handleOrderNumbers(method, params),

    // 采购相关（与订单/生产独立）
    '/purchases': () => handlePurchases(method, params, user),
    '/purchases/list': () => handlePurchasesList(method, params),
    '/purchases/stats': () => handlePurchasesStats(method, params),

    // 工单相关 - 兼容PC端调用，实际操作production集合
    '/workorders': () => handleProduction(method, params, user),
    '/workorders/list': () => handleProductionList(method, params),
    '/workorders/stats': () => handleProductionStats(method, params),

    '/production': () => handleProduction(method, params, user),
    '/production/list': () => handleProductionList(method, params),
    '/production/stats': () => handleProductionStats(method, params),

    '/skus/batch/material': () => handleCustomerSkus(method, params, user),
    '/skus/import': () => handleCustomerSkus(method, params, user),
    '/skus': () => handleCustomerSkus(method, params, user),

    // 客户相关
    '/customers': () => handleCustomers(method, params),
    '/customers/sku-stats': () => handleCustomerSkuStats(method, params, user),
    '/customers/list': () => handleCustomersList(method, params),
    '/customers/stats': () => handleCustomersStats(method, params),
    '/employees': () => handleEmployees(method, params),
    '/employees/list': () => handleEmployeesList(method, params),
    // 供应商相关
    '/suppliers': () => handleSuppliers(method, params, user),
    '/suppliers/list': () => handleSuppliersList(method, params),
    '/supplier-materials/stats': () => handleSupplierMaterialsStats(method, params, user),
    '/supplier-materials/outsourced/upsert': () => handleSupplierOutsourcedMaterials(method, params, user),
    '/supplier-materials/outsourced': () => handleSupplierOutsourcedMaterials(method, params, user),
    '/supplier-materials': () => handleSupplierMaterials(method, params, user),
    '/material-codes': () => handleMaterialCodes(method, params, user),
    // 产品品类相关
    '/product-categories': () => handleProductCategories(method, params),

    '/products': () => handleProducts(method, params),
    '/products/list': () => handleProductsList(method, params),
    '/products/stats': () => handleProductsStats(method, params),

    // 固定成本相关
    '/fixed-costs': () => handleFixedCosts(method, params),

    // 应付账款相关
    '/payables/invoice-upload/init': () => handlePayablesInvoiceUpload(method, params),
    '/payables/invoice-upload/chunk': () => handlePayablesInvoiceUpload(method, params),
    '/payables/invoice-upload/complete': () => handlePayablesInvoiceUpload(method, params),
    '/payables': () => handlePayables(method, params),
    '/payables/list': () => handlePayablesList(method, params),

    // 发货单号相关
    '/shipping-numbers': () => handleShippingNumbers(method, params),

    '/user-config': () => handleUserConfig(method, params, user),

    // 库存相关
    '/inventory': () => handleInventory(method, params),
    '/inventory/list': () => handleInventoryList(method, params),

    '/users': () => handleUsers(method, params),
    '/users/list': () => handleUsersList(method, params),

    // 仪表板相关
    '/dashboard/stats': () => handleDashboardStats(method, params),
    '/dashboard/recent': () => handleDashboardRecent(method, params),
    '/data-management/stats': () => handleDataManagementStats(method, params, user),
    '/data-integrity/scan': () => handleDataIntegrityScan(method, params, user),

    // 系统相关
    '/health': () => handleHealthCheck(),
    '/system/status': () => handleSystemStatus(),
    '/system/overview': () => handleSystemOverview(method, params, user),
    '/system/settings': () => handleSystemSettings(method, params, user),
    '/system/storage-path': () => handleSystemStoragePath(method, params, user),
    '/system/backup/config': () => handleSystemBackupConfig(method, params, user),
    '/system/backup/run': () => handleSystemBackupRun(method, params, user),
    '/system/backup/import': () => handleSystemBackupImport(method, params, user),
    '/system/cloud-sync/config': () => handleSystemCloudSyncConfig(method, params, user),
    '/system/cloud-sync/run': () => handleSystemCloudSyncRun(method, params, user),
    '/system/local-db/install-from-cloud': () => handleSystemLocalDbInstallFromCloud(method, params, user),
    '/system/logs/operations': () => handleOperationLogs(method, params, user),
    '/system/logs/system': () => handleSystemLogs(method, params, user),
    '/system/logs/errors': () => handleErrorLogs(method, params, user),
    // 同步相关（云端模式占位）
    '/sync/status': () => handleSyncStatus(method, params, user),
    '/sync/sync/incremental': () => handleSyncTrigger(method, params, user, 'incremental'),
    '/sync/sync/force': () => handleSyncTrigger(method, params, user, 'force'),
    '/statements': () => handleStatements(method, params, user),
    '/statements/list': () => handleStatements(method, params, user),
    '/statements/rollback': () => handleStatementRollback(method, params, user),
    '/customer-aliases': () => handleCustomerAliases(method, params, user),
    '/customer-aliases/list': () => handleCustomerAliases(method, params, user),
    '/customer-aliases/upsert': () => handleCustomerAliases(method, params, user),
    '/customer-aliases/delete': () => handleCustomerAliases(method, params, user),
  };

  // 匹配路由
  for (const route in routes) {
    if (usedPath === route || usedPath.startsWith(route + '/') || usedPath.startsWith(route + '?')) {
      return await routes[route]();
    }
  }

  throw new Error(`未找到匹配的路由: ${usedPath}`);
}

async function handleStatements(method, params, user) {
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {})
  const userId = String(tokenPayload?.userId || user?.userId || '').trim()
  if (!userId) {
    const err = new Error('未登录')
    err.statusCode = 401
    throw err
  }
  const normalize = (v) => String(v || '').trim()
  const safeId = (s) => normalize(s).replace(/[^a-zA-Z0-9_\-:.]/g, '_')
  const unwrapGetResult = (got) => {
    const raw = got && got.data != null ? got.data : null
    const first = Array.isArray(raw) ? (raw[0] || null) : raw
    if (!first) return null
    const data = first && typeof first === 'object' && first.data && typeof first.data === 'object' ? first.data : null
    return data || first
  }
  const unwrapListResult = (listRes) => {
    const raw = listRes && listRes.data != null ? listRes.data : null
    const list = Array.isArray(raw) ? raw : []
    return list
      .map((it) => {
        if (!it || typeof it !== 'object') return null
        if (it.data && typeof it.data === 'object') return it.data
        return it
      })
      .filter(Boolean)
  }
  const now = Date.now()
  await ensureCollectionExists('statements')
  if (method === 'GET') {
    const customer = normalize(params?.customer || '')
    const period = normalize(params?.period || '')
    const key = normalize(params?.key || '')
    const docId = key ? safeId(key) : (customer && period ? safeId(`${customer}|${period}`) : '')
    try {
      if (docId) {
        const got = await db.collection('statements').doc(docId).get()
        const data = unwrapGetResult(got)
        return handleSuccess({ statement: data }, '获取对账单成功')
      }
      const cond = {}
      if (customer) cond.customer = customer
      if (period) cond.period = period
      const q = Object.keys(cond).length ? db.collection('statements').where(cond) : db.collection('statements')
      let list = null
      let primary = []
      try {
        list = await q.orderBy('updatedAt', 'desc').limit(500).get()
        primary = unwrapListResult(list)
      } catch (_) {
        try {
          list = await q.orderBy('data.updatedAt', 'desc').limit(500).get()
          primary = unwrapListResult(list)
        } catch (_) {
          const looseLimit = Object.keys(cond).length ? 500 : 2000
          list = await q.limit(looseLimit).get()
          primary = unwrapListResult(list)
          primary.sort((a, b) => Number(b?.updatedAt ?? b?.meta?.updatedAt ?? 0) - Number(a?.updatedAt ?? a?.meta?.updatedAt ?? 0))
          if (primary.length > 500) primary = primary.slice(0, 500)
        }
      }
      if (Object.keys(cond).length && primary.length === 0) {
        try {
          const raw = await db.collection('statements').limit(2000).get()
          const all = unwrapListResult(raw)
          const filtered = all.filter((it) => {
            if (!it || typeof it !== 'object') return false
            if (customer && normalize(it.customer) !== customer) return false
            if (period && normalize(it.period) !== period) return false
            return true
          })
          return handleSuccess({ statements: filtered }, '获取对账单列表成功')
        } catch (_) { void 0 }
      }
      return handleSuccess({ statements: primary }, '获取对账单列表成功')
    } catch (e) {
      return handleError(e, '获取对账单失败')
    }
  }
  if (method === 'POST') {
    const rawCustomer = normalize(params?.customer || params?.data?.customer || '')
    const period = normalize(params?.period || params?.data?.period || '')
    const statementNo = normalize(params?.statementNo || params?.data?.statementNo || '')
    const rows = Array.isArray(params?.rows) ? params.rows : Array.isArray(params?.data?.rows) ? params.data.rows : []
    const meta = (params?.meta && typeof params.meta === 'object') ? params.meta : ((params?.data && typeof params.data === 'object') ? params.data.meta : {})
    const toBool = (v) => {
      if (v === true) return true
      const s = String(v == null ? '' : v).trim().toLowerCase()
      return s === '1' || s === 'true' || s === 'yes'
    }
    const requestedFinal = toBool(params?.final ?? params?.data?.final ?? meta?.final)
    if (!rawCustomer || !period) {
      const err = new Error('缺少客户或期间')
      err.statusCode = 400
      throw err
    }
    let customer = rawCustomer
    try {
      const aliasDocId = safeId(rawCustomer)
      const aliasRes = await db.collection('customer_aliases').doc(aliasDocId).get()
      const aliasRow = aliasRes && aliasRes.data ? aliasRes.data : null
      if (aliasRow && aliasRow.active !== false && aliasRow.canonical) {
        customer = normalize(aliasRow.canonical)
      }
    } catch (_) { void 0 }

    const source = String(meta?.source || '').trim()
    const overwriteExistingStatementNo = toBool(meta?.overwriteExistingStatementNo ?? meta?.overwriteExisting ?? meta?.overwrite)
    const docId = (() => {
      if (source === 'import') {
        if (overwriteExistingStatementNo && statementNo) return safeId(statementNo)
        return safeId(`${customer}|${period}`)
      }
      if (statementNo) return safeId(statementNo)
      return safeId(`${customer}|${period}`)
    })()
    let existingDoc = null
    try {
      const existingRes = await db.collection('statements').doc(docId).get()
      existingDoc = unwrapGetResult(existingRes)
    } catch (_) { void 0 }
    const prevFinal = Boolean(existingDoc && existingDoc.final === true)
    const role = normalizeRoleValue(tokenPayload?.role)
    const isAdmin = role === 'admin' || role === 'administrator'
    const forceUnlock = toBool(meta?.forceUnlock ?? params?.forceUnlock ?? params?.data?.forceUnlock)
    const allowForceUnlock = prevFinal && forceUnlock && isAdmin
    const allowImportOverwriteFinal = prevFinal && source === 'import' && overwriteExistingStatementNo && Boolean(statementNo)
    if (prevFinal && !allowForceUnlock && !allowImportOverwriteFinal) {
      try {
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'security_statement_modify_blocked',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: userId,
          actorUsername: String(tokenPayload?.username || ''),
          detail: {
            docId,
            customer,
            rawCustomer,
            period,
            statementNo,
            source,
            existingFinal: true,
            requestedFinal,
            overwriteExistingStatementNo
          }
        })
      } catch (_) { void 0 }
      const err = new Error('ERR_BILL_LOCKED: 对账单已锁定，禁止修改')
      err.statusCode = 409
      throw err
    }
    if (allowForceUnlock) {
      try {
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'security_statement_modify_override',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: userId,
          actorUsername: String(tokenPayload?.username || ''),
          detail: {
            docId,
            customer,
            rawCustomer,
            period,
            statementNo,
            source,
            existingFinal: true,
            requestedFinal,
            forceUnlock: true
          }
        })
      } catch (_) { void 0 }
    }
    const nextFinal = prevFinal ? true : Boolean(requestedFinal)
    const cleanedMeta = (() => {
      const base = meta && typeof meta === 'object' ? { ...meta } : {}
      if (base && typeof base === 'object') {
        if ('rawSheet' in base) delete base.rawSheet
        if ('raw' in base) delete base.raw
        if (base.layout && typeof base.layout === 'object') {
          const layout = base.layout
          const isEmptyCell = (v) => v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')
          const srcAoa = Array.isArray(layout.aoa) ? layout.aoa : []
          let lastRow = -1
          let lastCol = -1
          for (let r = 0; r < srcAoa.length; r += 1) {
            const row = Array.isArray(srcAoa[r]) ? srcAoa[r] : []
            let has = false
            for (let c = 0; c < row.length; c += 1) {
              if (!isEmptyCell(row[c])) {
                has = true
                if (c > lastCol) lastCol = c
              }
            }
            if (has) lastRow = r
          }
          const trimmedAoa = (lastRow >= 0 && lastCol >= 0)
            ? srcAoa.slice(0, lastRow + 1).map((r) => (Array.isArray(r) ? r.slice(0, lastCol + 1) : []))
            : []

          const rows = trimmedAoa.length
          const cols = rows ? Math.max(...trimmedAoa.map((r) => (Array.isArray(r) ? r.length : 0))) : 0
          const cellCount = rows * cols
          const maxCells = 60000
          const aoaFinal = cellCount > maxCells && cols > 0
            ? trimmedAoa.slice(0, Math.max(1, Math.floor(maxCells / cols)))
            : trimmedAoa

          const maxMerges = 2000
          const merges = Array.isArray(layout.merges) ? layout.merges : []
          const mergesFinal = merges
            .filter((m) => {
              const s = m && m.s ? m.s : null
              const e = m && m.e ? m.e : null
              const r0 = Number(s && s.r)
              const c0 = Number(s && s.c)
              const r1 = Number(e && e.r)
              const c1 = Number(e && e.c)
              if (![r0, c0, r1, c1].every(Number.isFinite)) return false
              if (r0 < 0 || c0 < 0 || r1 < r0 || c1 < c0) return false
              if (aoaFinal.length && r0 >= aoaFinal.length) return false
              return true
            })
            .slice(0, maxMerges)

          base.layout = {
            sheetName: layout.sheetName ? String(layout.sheetName) : '',
            aoa: aoaFinal,
            merges: mergesFinal
          }

          if (cellCount > maxCells) base.layoutTruncated = true
        }
        const errs = Array.isArray(base.importErrors) ? base.importErrors : null
        if (errs && errs.length > 500) {
          base.importErrors = errs.slice(0, 500)
          base.importErrorsTruncated = true
        }
      }
      return base
    })()
    const record = {
      _id: docId,
      customer,
      period,
      statementNo,
      rows: Array.isArray(rows) ? rows : [],
      meta: cleanedMeta,
      final: nextFinal,
      finalizedAt: nextFinal ? (existingDoc && existingDoc.finalizedAt != null ? Number(existingDoc.finalizedAt || 0) : now) : 0,
      finalizedBy: nextFinal ? (existingDoc && existingDoc.finalizedBy ? String(existingDoc.finalizedBy) : userId) : '',
      createdAt: existingDoc && existingDoc.createdAt != null ? existingDoc.createdAt : now,
      createdBy: existingDoc && existingDoc.createdBy ? existingDoc.createdBy : userId,
      updatedAt: now,
      updatedBy: userId
    }
    const retentionMax = Math.min(200, Math.max(5, Number(process.env.STATEMENTS_BACKUP_RETENTION || 30) || 30))
    const retentionDays = Math.min(365, Math.max(1, Number(process.env.STATEMENTS_BACKUP_RETENTION_DAYS || 14) || 14))

    const getNextBackupVersion = async (statementDocId) => {
      const sid = normalize(statementDocId)
      if (!sid) return 1
      try {
        const res = await db.collection('statements_backups').where({ statementDocId: sid }).orderBy('createdAt', 'desc').limit(1).get()
        const list = Array.isArray(res?.data) ? res.data : []
        const last = list[0]
        const v = Number(last?.version || 0)
        return Number.isFinite(v) && v >= 1 ? v + 1 : 1
      } catch (_) {
        return 1
      }
    }

    const pruneStatementBackups = async (statementDocId) => {
      const sid = normalize(statementDocId)
      if (!sid) return
      try {
        const res = await db.collection('statements_backups').where({ statementDocId: sid }).orderBy('createdAt', 'desc').limit(200).get()
        const list = Array.isArray(res?.data) ? res.data : []
        if (list.length <= retentionMax) return
        const cutoffTs = Date.now() - retentionDays * 24 * 60 * 60 * 1000
        for (let i = retentionMax; i < list.length; i += 1) {
          const b = list[i]
          const bid = normalize(b?._id || b?.id || '')
          if (!bid) continue
          const used = Boolean(b?.used)
          const createdAt = Number(b?.createdAt || 0)
          const keepDueToGrace = !used && Number.isFinite(createdAt) && createdAt >= cutoffTs
          if (keepDueToGrace) continue
          try {
            await db.collection('statements_backups').doc(bid).remove()
          } catch (_) { void 0 }
        }
      } catch (_) { void 0 }
    }

    const createStatementBackup = async (payload) => {
      const statementDocId = normalize(payload?.statementDocId || '')
      if (!statementDocId) return ''
      const backupCustomer = normalize(payload?.customer || '')
      const backupPeriod = normalize(payload?.period || '')
      const prev = payload?.prev != null ? payload.prev : null
      const extraPrev = Array.isArray(payload?.extraPrev) ? payload.extraPrev : []
      const backupMeta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {}
      try {
        await ensureCollectionExists('statements_backups')
      } catch (_) { void 0 }
      try {
        const version = await getNextBackupVersion(statementDocId)
        const rand = crypto.randomBytes(4).toString('hex')
        const bid = safeId(`${statementDocId}__${now}__${rand}`)
        await db.collection('statements_backups').doc(bid).set({
          data: {
            statementDocId,
            customer: backupCustomer,
            period: backupPeriod,
            createdAt: now,
            createdBy: userId,
            used: false,
            usedAt: 0,
            usedBy: '',
            version,
            prev,
            extraPrev,
            meta: backupMeta
          }
        })
        await pruneStatementBackups(statementDocId)
        return bid
      } catch (_) {
        return ''
      }
    }
    try {
      let backupId = ''
      const source = String(record?.meta?.source || '').trim()
      if (allowForceUnlock && source !== 'import') {
        try {
          backupId = await createStatementBackup({
            statementDocId: docId,
            customer,
            period,
            prev: existingDoc || null,
            extraPrev: [],
            meta: {
              source: 'forceUnlock',
              rawCustomer,
              statementNoTo: statementNo,
              prevStatementNo: normalize(existingDoc?.statementNo || ''),
              reason: 'override_final'
            }
          })
        } catch (_) { void 0 }
      }
      if (source === 'import') {
        const overwriteExisting = Boolean(record?.meta?.overwriteExistingStatementNo)
        const overwriteStatementNo = normalize(record?.meta?.existingStatementNo || '')
        let extraPrev = []
        if (overwriteExisting && overwriteStatementNo) {
          try {
            const candidates = []
            try {
              const directRes = await db.collection('statements').doc(safeId(overwriteStatementNo)).get()
              const directDoc = unwrapGetResult(directRes)
              if (directDoc) candidates.push(directDoc)
            } catch (_) { void 0 }
            try {
              const q1 = await db.collection('statements').where({ statementNo: overwriteStatementNo }).limit(20).get()
              candidates.push(...unwrapListResult(q1))
            } catch (_) { void 0 }
            try {
              const q2 = await db.collection('statements').where({ 'data.statementNo': overwriteStatementNo }).limit(20).get()
              candidates.push(...unwrapListResult(q2))
            } catch (_) { void 0 }
            const seen = new Set()
            extraPrev = candidates
              .map((s) => {
                const sid = normalize(s?._id || s?.id || '')
                if (!sid || sid === docId) return null
                if (seen.has(sid)) return null
                seen.add(sid)
                return { statementDocId: sid, prev: s || null }
              })
              .filter(Boolean)
          } catch (_) { void 0 }
        }
        try {
          const prev = await db.collection('statements').doc(docId).get()
          const prevData = unwrapGetResult(prev)
          if (!backupId) backupId = await createStatementBackup({
            statementDocId: docId,
            customer,
            period,
            prev: prevData || null,
            extraPrev: Array.isArray(extraPrev) ? extraPrev : [],
            meta: {
              source: 'import',
              rawCustomer,
              statementNoTo: statementNo,
              overwriteExistingStatementNo: Boolean(record?.meta?.overwriteExistingStatementNo),
              overwriteStatementNo: normalize(record?.meta?.existingStatementNo || ''),
              prevStatementNo: normalize(prevData?.statementNo || '')
            }
          })
          if (Array.isArray(extraPrev) && extraPrev.length) {
            for (const e of extraPrev) {
              try {
                const sid = normalize(e?.statementDocId || '')
                if (!sid || sid === docId) continue
                await db.collection('statements').doc(sid).remove()
              } catch (_) { void 0 }
            }
          }
        } catch (_) { void 0 }
      }

      if (source === 'import' && rawCustomer && rawCustomer !== customer) {
        try {
          const oldDocId = safeId(`${rawCustomer}|${period}`)
          if (oldDocId && oldDocId !== docId) {
            const oldRes = await db.collection('statements').doc(oldDocId).get()
            const oldData = unwrapGetResult(oldRes)
            if (oldData) {
              await createStatementBackup({
                statementDocId: oldDocId,
                customer: rawCustomer,
                period,
                prev: oldData,
                extraPrev: [],
                meta: {
                  source: 'import',
                  rawCustomer,
                  reason: 'canonical_customer_migration',
                  statementNoTo: statementNo,
                  prevStatementNo: normalize(oldData?.statementNo || '')
                }
              })
              try {
                await db.collection('statements').doc(oldDocId).remove()
              } catch (_) { void 0 }
            }
          }
        } catch (_) { void 0 }
      }
      const recordForWrite = { ...record }
      delete recordForWrite._id
      await db.collection('statements').doc(docId).set({
        data: recordForWrite,
        customer,
        period,
        statementNo,
        updatedAt: now,
        createdAt: Number(recordForWrite?.createdAt || now) || now,
        final: Boolean(nextFinal)
      })
      await safeWriteLog('operation_logs', {
        ts: now,
        action: 'upsert_statement',
        method,
        path: String(global.__lastPath || ''),
        actorUserId: userId,
        actorUsername: String(tokenPayload?.username || ''),
        detail: {
          docId,
          customer,
          rawCustomer,
          period,
          statementNo,
          rowsCount: record.rows.length,
          source: String(record?.meta?.source || ''),
          final: Boolean(record?.final),
          backupId: backupId || '',
          overwriteExistingStatementNo: Boolean(record?.meta?.overwriteExistingStatementNo),
          overwriteStatementNo: normalize(record?.meta?.existingStatementNo || '')
        }
      })
      if (nextFinal) {
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'finalize_statement',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: userId,
          actorUsername: String(tokenPayload?.username || ''),
          detail: {
            docId,
            customer,
            rawCustomer,
            period,
            statementNo,
            source: String(record?.meta?.source || ''),
            finalizedAt: record.finalizedAt,
            finalizedBy: record.finalizedBy
          }
        })
      }
      if (String(record?.meta?.source || '').trim() === 'import') {
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'import_statement',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: userId,
          actorUsername: String(tokenPayload?.username || ''),
          detail: {
            docId,
            customer,
            period,
            statementNo,
            backupId: backupId || '',
            overwriteExistingStatementNo: Boolean(record?.meta?.overwriteExistingStatementNo),
            overwriteStatementNo: normalize(record?.meta?.existingStatementNo || '')
          }
        })
      }
      return handleSuccess({ ok: true, id: docId, backupId: backupId || '', statement: record }, '保存对账单成功')
    } catch (e) {
      const msg = String(e?.message || '')
      if (msg.includes('ERR_BILL_LOCKED')) {
        return handleError(e, msg)
      }
      return handleError(e, '保存对账单失败')
    }
  }
  throw new Error('不支持的HTTP方法')
}

async function handleCustomerSkuStats(method, params, user) {
  const skuCollectionName = String(process.env.ERP_CUSTOMER_SKU_COLLECTION || 'customer_skus').trim() || 'customer_skus';
  const customerCollectionName = String(process.env.ERP_CUSTOMER_COLLECTION || 'customers').trim() || 'customers';
  if (method !== 'GET') throw new Error('不支持的HTTP方法');
  await ensureCollectionExists(skuCollectionName);
  await ensureCollectionExists(customerCollectionName);

  const normalizeText = (v) => String(v == null ? '' : v).trim();
  const uniq = (arr) => Array.from(new Set((arr || []).map((x) => normalizeText(x)).filter(Boolean)));

  const countByAnyCustomerKey = new Map();
  const pageSize = 500;
  let lastId = '';
  let prevLastId = '';
  let scannedTotal = 0;

  try {
    for (;;) {
      const where = lastId ? { _id: _.lt(lastId) } : {};
      const raw = await db.collection(skuCollectionName).where(where).orderBy('_id', 'desc').limit(pageSize).get();
      const rows = Array.isArray(raw && raw.data) ? raw.data : [];
      if (!rows.length) break;

      for (const doc of rows) {
        const rawCustomerId = doc?.customerId ?? doc?.customer_id ?? doc?.customer?.id;
        const key = normalizeText(rawCustomerId);
        if (!key) continue;
        countByAnyCustomerKey.set(key, (countByAnyCustomerKey.get(key) || 0) + 1);
      }

      scannedTotal += rows.length;
      prevLastId = lastId;
      lastId = rows[rows.length - 1]?._id != null ? String(rows[rows.length - 1]._id) : '';
      if (!lastId || lastId === prevLastId) break;
      if (rows.length < pageSize) break;
    }
  } catch (_) {
    return handleSuccess(
      { stats: [], totalSkus: 0, _meta: { source: 'cloud_db', skuCollection: skuCollectionName, customerCollection: customerCollectionName, scannedTotal } },
      '获取SKU统计成功'
    );
  }

  const customers = [];
  let skip = 0;
  const customerTake = 500;
  for (;;) {
    const res = await db.collection(customerCollectionName).orderBy('_id', 'desc').skip(skip).limit(customerTake).get();
    const batch = Array.isArray(res && res.data) ? res.data : [];
    if (!batch.length) break;
    customers.push(...batch);
    if (batch.length < customerTake) break;
    skip += customerTake;
    if (skip > 500 * 200) break;
  }

  const stats = customers
    .map((c) => {
      const customerId = normalizeText(c?._id);
      if (!customerId) return null;
      const candidates = uniq([
        customerId,
        c?.customerCode,
        c?.code,
        c?.shortName,
        c?.companyName,
        c?.name,
        c?.wechatCustomerId,
        c?.wechatOpenId
      ]);
      let skuCount = 0;
      for (const k of candidates) {
        const n = countByAnyCustomerKey.get(k);
        if (Number.isFinite(Number(n)) && Number(n) > 0) {
          skuCount = Number(n);
          break;
        }
      }
      if (!skuCount) return null;
      return { customerId, skuCount };
    })
    .filter(Boolean);

  const totalSkus = stats.reduce((sum, r) => sum + Number(r?.skuCount || 0), 0);
  return handleSuccess(
    { stats, totalSkus, _meta: { source: 'cloud_db', skuCollection: skuCollectionName, customerCollection: customerCollectionName, scannedTotal } },
    '获取SKU统计成功'
  );
}

async function handleStatementRollback(method, params, user) {
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {})
  const userId = String(tokenPayload?.userId || user?.userId || '').trim()
  if (!userId) {
    const err = new Error('未登录')
    err.statusCode = 401
    throw err
  }
  if (method !== 'POST') throw new Error('不支持的HTTP方法')
  const normalize = (v) => String(v || '').trim()
  const backupId = normalize(params?.backupId || params?.data?.backupId || '')
  if (!backupId) {
    const err = new Error('缺少backupId')
    err.statusCode = 400
    throw err
  }
  const now = Date.now()
  try {
    const sanitizeSetData = (v) => {
      if (!v || typeof v !== 'object') return v
      const out = Array.isArray(v) ? v.slice() : { ...v }
      if (!Array.isArray(out) && '_id' in out) delete out._id
      return out
    }
    const got = await db.collection('statements_backups').doc(backupId).get()
    const raw = got && got.data != null ? got.data : null
    const first = Array.isArray(raw) ? (raw[0] || null) : raw
    const backup = first && typeof first === 'object' && first.data && typeof first.data === 'object' ? first.data : first
    if (!backup) {
      const err = new Error('回滚记录不存在')
      err.statusCode = 404
      throw err
    }
    if (backup.used) {
      const err = new Error('该回滚记录已使用')
      err.statusCode = 409
      throw err
    }
    const statementDocId = normalize(backup.statementDocId || '')
    if (!statementDocId) throw new Error('回滚记录损坏')
    const prev = backup.prev || null
    if (prev) {
      await db.collection('statements').doc(statementDocId).set({ data: sanitizeSetData(prev) })
    } else {
      try {
        await db.collection('statements').doc(statementDocId).remove()
      } catch (_) { void 0 }
    }
    const extraPrev = Array.isArray(backup.extraPrev) ? backup.extraPrev : []
    if (extraPrev.length) {
      for (const e of extraPrev) {
        try {
          const sid = normalize(e?.statementDocId || '')
          if (!sid || sid === statementDocId) continue
          const ep = e?.prev || null
          if (ep) {
            await db.collection('statements').doc(sid).set({ data: sanitizeSetData(ep) })
          } else {
            try {
              await db.collection('statements').doc(sid).remove()
            } catch (_) { void 0 }
          }
        } catch (_) { void 0 }
      }
    }
    await db.collection('statements_backups').doc(backupId).set({
      data: {
        ...sanitizeSetData(backup),
        used: true,
        usedAt: now,
        usedBy: userId
      }
    })
    await safeWriteLog('operation_logs', {
      ts: now,
      action: 'rollback_statement_import',
      method,
      path: String(global.__lastPath || ''),
      actorUserId: userId,
      actorUsername: String(tokenPayload?.username || ''),
      detail: {
        backupId,
        statementDocId,
        version: Number(backup?.version || 0) || 0,
        customer: normalize(backup?.customer || ''),
        period: normalize(backup?.period || ''),
        extraPrevCount: Array.isArray(backup?.extraPrev) ? backup.extraPrev.length : 0
      }
    })
    return handleSuccess({ ok: true }, '回滚成功')
  } catch (e) {
    return handleError(e, '回滚失败')
  }
}
async function handleUserConfig(method, params, user) {
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {});
  const userIdRaw = tokenPayload?.userId || user?.userId || '';
  const userId = String(userIdRaw || '').trim();
  if (!userId || userId === 'anonymous') {
    return handleError(new Error('未登录'), '未登录');
  }

  const normalizeKey = (k) => String(k || '').trim();
  const toDocId = (k) => {
    const safeKey = normalizeKey(k).replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return `${userId}__${safeKey}`;
  };

  if (method === 'GET') {
    const rawKeys = params.keys != null
      ? params.keys
      : (params.key != null ? params.key : '');
    const keys = Array.isArray(rawKeys)
      ? rawKeys.map(normalizeKey).filter(Boolean)
      : String(rawKeys || '')
        .split(',')
        .map((k) => normalizeKey(k))
        .filter(Boolean);

    if (!keys.length) {
      return handleSuccess({ configs: {} }, '获取用户配置成功');
    }

    const configs = {};
    for (const key of keys) {
      const docId = toDocId(key);
      try {
        const res = await db.collection('user_configs').doc(docId).get();
        const row = res && res.data ? res.data : null;
        if (row && row.key) {
          configs[String(row.key)] = row.value;
        }
      } catch (e) {
        const msg = String(e && (e.errMsg || e.message || e)).toLowerCase();
        if (msg.includes('collection') && msg.includes('not exist')) {
          return handleSuccess({ configs: {} }, '获取用户配置成功');
        }
      }
    }

    return handleSuccess({ configs }, '获取用户配置成功');
  }

  if (method === 'POST' || method === 'PUT') {
    const key = normalizeKey(params.key);
    if (!key) {
      return handleError(new Error('缺少key'), '缺少key');
    }
    const docId = toDocId(key);
    const value = params.value;
    const record = {
      _id: docId,
      userId,
      key,
      value,
      updatedAt: new Date()
    };
    const recordForWrite = { ...record }
    delete recordForWrite._id

    try {
      await db.collection('user_configs').doc(docId).set({ data: recordForWrite });
    } catch (err) {
      const msg = String(err && (err.errMsg || err.message || err)).toLowerCase();
      if (msg.includes('collection') && msg.includes('not exist')) {
        await db.createCollection('user_configs');
        await db.collection('user_configs').doc(docId).set({ data: recordForWrite });
      } else {
        return handleError(err, '保存用户配置失败');
      }
    }

    return handleSuccess({ item: record }, '保存用户配置成功');
  }

  return handleError(new Error('不支持的HTTP方法'), '不支持的HTTP方法');
}

async function handleCustomerAliases(method, params, user) {
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {})
  const userId = String(tokenPayload?.userId || user?.userId || '').trim()
  if (!userId) {
    const err = new Error('未登录')
    err.statusCode = 401
    throw err
  }
  const normalize = (v) => String(v || '').trim()
  const safeId = (s) => normalize(s).replace(/[^a-zA-Z0-9_\-:.]/g, '_')
  const now = Date.now()
  const path = String(global.__lastPath || '')

  const payload = (params && typeof params === 'object') ? params : {}
  const action = String(payload.action || '').trim()
  const alias = normalize(payload.alias || payload.name || '')
  const canonical = normalize(payload.canonical || payload.fullName || payload.companyName || '')

  if (method === 'GET') {
    try {
      const activeOnly = String(payload.activeOnly || '1') !== '0'
      const q = activeOnly
        ? db.collection('customer_aliases').where({ active: true })
        : db.collection('customer_aliases')
      const list = await q.limit(2000).get()
      return handleSuccess({ aliases: Array.isArray(list?.data) ? list.data : [] }, '获取客户别名成功')
    } catch (e) {
      return handleError(e, '获取客户别名失败')
    }
  }

  const op = action || (path.includes('/upsert') ? 'upsert' : path.includes('/delete') ? 'delete' : '')
  if (!op) throw new Error('缺少操作类型')

  if (op === 'upsert') {
    if (!alias || !canonical) {
      const err = new Error('缺少简称或全称')
      err.statusCode = 400
      throw err
    }
    const docId = safeId(alias)
    const record = {
      _id: docId,
      alias,
      canonical,
      active: true,
      updatedAt: now,
      updatedBy: userId
    }
    const recordForWrite = { ...record }
    delete recordForWrite._id
    try {
      const existing = await db.collection('customer_aliases').doc(docId).get()
      const old = existing && existing.data ? existing.data : null
      if (!old || !old.createdAt) {
        record.createdAt = now
        record.createdBy = userId
      } else {
        record.createdAt = old.createdAt
        record.createdBy = old.createdBy
      }
      await db.collection('customer_aliases').doc(docId).set({ data: recordForWrite })
      await safeWriteLog('operation_logs', {
        ts: now,
        action: 'upsert_customer_alias',
        path: String(global.__lastPath || ''),
        actorUserId: userId,
        detail: { alias, canonical }
      })
      return handleSuccess({ ok: true, alias, canonical }, '保存客户别名成功')
    } catch (e) {
      return handleError(e, '保存客户别名失败')
    }
  }

  if (op === 'delete') {
    if (!alias) {
      const err = new Error('缺少简称')
      err.statusCode = 400
      throw err
    }
    const docId = safeId(alias)
    try {
      const existing = await db.collection('customer_aliases').doc(docId).get()
      const old = existing && existing.data ? existing.data : null
      if (!old) {
        return handleSuccess({ ok: true }, '客户别名不存在')
      }
      const next = {
        ...old,
        active: false,
        updatedAt: now,
        updatedBy: userId
      }
      await db.collection('customer_aliases').doc(docId).set({ data: next })
      await safeWriteLog('operation_logs', {
        ts: now,
        action: 'delete_customer_alias',
        path: String(global.__lastPath || ''),
        actorUserId: userId,
        detail: { alias }
      })
      return handleSuccess({ ok: true }, '删除客户别名成功')
    } catch (e) {
      return handleError(e, '删除客户别名失败')
    }
  }

  throw new Error('不支持的操作类型')
}
// 固定成本处理
async function handleFixedCosts(method, params) {
  const path = global.__lastPath || '';
  if (method === 'GET') {
    try {
      const result = await cloudAdapter.executeQuery('fixed_costs', {
        ...params,
        limit: params.limit || 500
      });
      const list = Array.isArray(result?.data) ? result.data : [];
      const items = list
        .map((doc) => {
          if (!doc) return null;
          const id = doc._id || doc.id;
          if (!id) return null;
          const amount = Number(doc.amount || 0);
          const rawDate = doc.date || doc.createdAt || doc._createTime || 0;
          let ts = 0;
          if (typeof rawDate === 'number') {
            ts = rawDate;
          } else if (rawDate instanceof Date) {
            ts = rawDate.getTime();
          } else if (rawDate) {
            const d = new Date(rawDate);
            if (!Number.isNaN(d.getTime())) {
              ts = d.getTime();
            }
          }
          return {
            id: String(id),
            category: doc.category || '',
            amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
            date: Number.isFinite(ts) && ts > 0 ? ts : null,
            remark: doc.remark || ''
          };
        })
        .filter((x) => x && x.id);
      return handleSuccess({ items }, '获取固定成本成功');
    } catch (error) {
      return handleError(error, '获取固定成本失败');
    }
  }

  if (method === 'POST') {
    try {
      const payload = params || {};
      const rawCategory = String(payload.category || '').trim();
      const parsedAmount = Number(payload.amount);
      const rawDate = payload.date;
      if (!rawCategory) {
        throw new Error('类别不能为空');
      }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('金额必须为大于0的数字');
      }
      let dateValue = null;
      if (rawDate != null) {
        if (typeof rawDate === 'number') {
          dateValue = new Date(rawDate);
        } else {
          dateValue = new Date(rawDate);
        }
      }
      if (!dateValue || Number.isNaN(dateValue.getTime())) {
        throw new Error('日期不合法');
      }
      const docData = {
        category: rawCategory,
        amount: parsedAmount,
        date: dateValue,
        remark: payload.remark ? String(payload.remark) : ''
      };
      const created = await cloudAdapter.create('fixed_costs', docData);
      const data = created && created.data ? created.data : {};
      const ts = data.date instanceof Date ? data.date.getTime() : (data.date ? Date.parse(data.date) : dateValue.getTime());
      const item = {
        id: String(data._id || data.id),
        category: data.category || rawCategory,
        amount: Number(data.amount || parsedAmount),
        date: Number.isNaN(ts) ? null : ts,
        remark: data.remark || docData.remark
      };
      return handleSuccess({ item }, '创建固定成本成功');
    } catch (error) {
      return handleError(error, '创建固定成本失败');
    }
  }

  if (method === 'DELETE') {
    try {
      const idMatch = path.match(/\/fixed-costs\/([^/?#]+)/);
      const id = params.id || (idMatch ? idMatch[1] : '');
      if (!id) {
        throw new Error('缺少ID');
      }
      const removed = await cloudAdapter.delete('fixed_costs', id);
      const data = removed && removed.data ? removed.data : {};
      const item = {
        id: String(data._id || id),
        deleted: true
      };
      return handleSuccess({ item }, '删除固定成本成功');
    } catch (error) {
      return handleError(error, '删除固定成本失败');
    }
  }

  throw new Error(`未找到匹配的路由: ${path}`);
}

async function handleSupplierMaterials(method, params, user) {
  const path = global.__lastPath || ''
  await ensureCollectionExists('supplier_materials')

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeNumber = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const normalizeFluteList = (v) => {
    const out = []
    const push = (x) => {
      const s = normalizeText(x)
      if (!s) return
      if (out.includes(s)) return
      out.push(s)
    }
    if (Array.isArray(v)) {
      v.forEach(push)
      return out
    }
    const s = normalizeText(v)
    if (!s) return out
    s
      .split(/[\/,，;；]+/)
      .map((x) => normalizeText(x))
      .filter(Boolean)
      .forEach(push)
    return out
  }
  const normalizeGrammageG = (v) => {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
    const s = String(v).trim()
    if (!s) return null
    const m = s.match(/([0-9]+(?:\.[0-9]+)?)/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const normalizeRow = (doc) => {
    if (!doc || typeof doc !== 'object') return null
    const id = doc._id || doc.id
    if (!id) return null
    const pricePerSqm = normalizeNumber(doc.pricePerSqm ?? doc.sqmPrice ?? doc.unitPrice)
    const flutes = normalizeFluteList(doc.flutes ?? doc.fluteOptions ?? doc.flute_options ?? doc.fluteList ?? doc.flute_list ?? doc.flute)
    const flute = flutes.length ? flutes[0] : normalizeText(doc.flute)
    return {
      id: String(id),
      _id: String(id),
      supplierId: normalizeText(doc.supplierId),
      materialCode: normalizeText(doc.materialCode),
      grammageG: normalizeGrammageG(doc.grammageG ?? doc.grammage ?? doc.weightG ?? doc.weight),
      grammageText: normalizeText(doc.grammageText ?? doc.grammageLabel ?? doc.grammageDisplay),
      flute,
      flutes,
      pricePerSqm: pricePerSqm != null && pricePerSqm >= 0 ? pricePerSqm : null,
      createdAt: doc.createdAt || doc._createTime || null,
      updatedAt: doc.updatedAt || doc._updateTime || null
    }
  }
  const toTs = (v) => {
    if (v == null) return 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const d = new Date(String(v))
    const t = d.getTime()
    return Number.isFinite(t) ? t : 0
  }
  const mergeRowsByMaterialCode = (rows) => {
    const map = new Map()
    ;(rows || []).forEach((r) => {
      const code = normalizeText(r?.materialCode)
      if (!code) return
      const prev = map.get(code)
      if (!prev) {
        map.set(code, { ...r, materialCode: code, flutes: normalizeFluteList(r?.flutes ?? r?.flute) })
        return
      }
      const prevTs = Math.max(toTs(prev?.updatedAt), toTs(prev?._updateTime))
      const nextTs = Math.max(toTs(r?.updatedAt), toTs(r?._updateTime))
      const newer = nextTs >= prevTs ? r : prev
      const older = nextTs >= prevTs ? prev : r
      const flutes = normalizeFluteList([
        ...(normalizeFluteList(prev?.flutes ?? prev?.flute) || []),
        ...(normalizeFluteList(r?.flutes ?? r?.flute) || [])
      ])
      map.set(code, {
        ...(newer || {}),
        materialCode: code,
        grammageText: normalizeText(newer?.grammageText ?? older?.grammageText),
        grammageG: newer?.grammageG != null ? newer.grammageG : (older?.grammageG ?? null),
        pricePerSqm: newer?.pricePerSqm != null ? newer.pricePerSqm : (older?.pricePerSqm ?? null),
        createdAt: newer?.createdAt ?? older?.createdAt ?? null,
        updatedAt: newer?.updatedAt ?? older?.updatedAt ?? null,
        flutes,
        flute: flutes.length ? flutes[0] : (normalizeText(newer?.flute ?? older?.flute) || '')
      })
    })
    return Array.from(map.values())
  }

  if (method === 'GET') {
    try {
      const supplierId = normalizeText(params?.supplierId)
      if (!supplierId) {
        const err = new Error('supplierId不能为空')
        err.statusCode = 400
        throw err
      }
      const result = await cloudAdapter.executeQuery('supplier_materials', { ...params, supplierId, limit: params?.limit || 2000 })
      const list = Array.isArray(result?.data) ? result.data : []
      const rows = mergeRowsByMaterialCode(list.map(normalizeRow).filter(Boolean))
      rows.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
      return handleSuccess(rows, '获取供应商材质库成功')
    } catch (error) {
      return handleError(error, '获取供应商材质库失败')
    }
  }

  if (method === 'POST') {
    if (path.includes('/supplier-materials/upsert')) {
      try {
        const supplierId = normalizeText(params?.supplierId)
        const materialCode = normalizeText(params?.materialCode || params?.code)
        if (!supplierId) throw new Error('supplierId不能为空')
        if (!materialCode) throw new Error('materialCode不能为空')
        const grammageG = normalizeGrammageG(params?.grammageG ?? params?.grammage ?? params?.weightG ?? params?.weight)
        const grammageText = normalizeText(params?.grammageText ?? params?.grammageLabel ?? params?.grammageDisplay ?? params?.grammageG ?? params?.grammage)
        const flutesFromBody = normalizeFluteList(params?.flutes ?? params?.fluteOptions ?? params?.flute_options ?? params?.fluteList ?? params?.flute_list)
        const fluteFromBody = normalizeText(params?.flute)
        const flutes = flutesFromBody.length ? flutesFromBody : normalizeFluteList(fluteFromBody)
        const flute = flutes.length ? flutes[0] : fluteFromBody
        const pricePerSqm = normalizeNumber(params?.pricePerSqm ?? params?.sqmPrice ?? params?.unitPrice)

        const findExisting = async () => {
          const queries = [
            { supplierId, materialCode },
            { supplier_id: supplierId, materialCode },
            { supplierId, material_code: materialCode },
            { supplier_id: supplierId, material_code: materialCode }
          ]
          for (const where of queries) {
            const raw = await db.collection('supplier_materials').where(where).limit(20).get().catch(() => null)
            const docs = Array.isArray(raw?.data) ? raw.data : []
            if (docs.length) return docs
          }
          return []
        }
        const existedDocs = await findExisting()
        const existingDoc = (existedDocs || []).sort((a, b) => Math.max(toTs(b?.updatedAt), toTs(b?._updateTime)) - Math.max(toTs(a?.updatedAt), toTs(a?._updateTime)))[0] || null
        const existingId = existingDoc && (existingDoc._id || existingDoc.id) ? String(existingDoc._id || existingDoc.id) : ''
        const nowTs = Date.now()
        const patch = {
          supplierId,
          materialCode,
          grammageG: grammageG != null ? grammageG : null,
          grammageText,
          flute,
          flutes,
          pricePerSqm: pricePerSqm != null && pricePerSqm >= 0 ? pricePerSqm : null,
          updatedAt: nowTs,
          _updateTime: nowTs
        }

        if (existingId) {
          const updated = await cloudAdapter.update('supplier_materials', existingId, patch)
          const data = updated && updated.data ? updated.data : { _id: existingId, ...patch }
          const item = normalizeRow({ ...(existingDoc || {}), ...data, _id: existingId })
          return handleSuccess({ item }, '更新成功')
        }

        const created = await cloudAdapter.create('supplier_materials', { ...patch, createdAt: nowTs, _createTime: nowTs, createdBy: normalizeText(user?.userId || user?.id) })
        const data = created && created.data ? created.data : { ...patch }
        const item = normalizeRow(data)
        return handleSuccess({ item }, '创建成功')
      } catch (error) {
        return handleError(error, '保存失败')
      }
    }

    throw new Error(`未找到匹配的路由: ${path}`)
  }

  if (method === 'PUT') {
    try {
      const idMatch = path.match(/\/supplier-materials\/([^/?#]+)/)
      const id = normalizeText(params?.id) || (idMatch ? normalizeText(idMatch[1]) : '')
      if (!id) throw new Error('缺少ID')
      const patch = {
        updatedAt: Date.now(),
        _updateTime: Date.now()
      }
      if (params?.supplierId !== undefined) patch.supplierId = normalizeText(params.supplierId)
      if (params?.materialCode !== undefined || params?.code !== undefined) patch.materialCode = normalizeText(params.materialCode || params.code)
      if (params?.grammageG !== undefined || params?.grammage !== undefined || params?.weightG !== undefined || params?.weight !== undefined) {
        patch.grammageG = normalizeGrammageG(params.grammageG ?? params.grammage ?? params.weightG ?? params.weight)
      }
      if (params?.grammageText !== undefined || params?.grammageLabel !== undefined || params?.grammageDisplay !== undefined) {
        patch.grammageText = normalizeText(params.grammageText ?? params.grammageLabel ?? params.grammageDisplay)
      }
      if (params?.flutes !== undefined || params?.fluteOptions !== undefined || params?.flute_options !== undefined || params?.fluteList !== undefined || params?.flute_list !== undefined) {
        const nextFlutes = normalizeFluteList(params.flutes ?? params.fluteOptions ?? params.flute_options ?? params.fluteList ?? params.flute_list)
        patch.flutes = nextFlutes
        patch.flute = nextFlutes.length ? nextFlutes[0] : ''
      } else if (params?.flute !== undefined) {
        const s = normalizeText(params.flute)
        patch.flutes = normalizeFluteList(s)
        patch.flute = s
      }
      if (params?.pricePerSqm !== undefined || params?.sqmPrice !== undefined || params?.unitPrice !== undefined) {
        const n = normalizeNumber(params.pricePerSqm ?? params.sqmPrice ?? params.unitPrice)
        patch.pricePerSqm = n != null && n >= 0 ? n : null
      }
      const updated = await cloudAdapter.update('supplier_materials', id, patch)
      const data = updated && updated.data ? updated.data : { _id: id, ...patch }
      const item = normalizeRow(data)
      return handleSuccess({ item }, '更新成功')
    } catch (error) {
      return handleError(error, '更新失败')
    }
  }

  if (method === 'DELETE') {
    try {
      const idMatch = path.match(/\/supplier-materials\/([^/?#]+)/)
      const id = normalizeText(params?.id) || (idMatch ? normalizeText(idMatch[1]) : '')
      if (!id) throw new Error('缺少ID')
      const removed = await cloudAdapter.delete('supplier_materials', id)
      const data = removed && removed.data ? removed.data : { _id: id, deleted: true }
      return handleSuccess({ item: { id: String(data._id || id), deleted: true } }, '删除成功')
    } catch (error) {
      return handleError(error, '删除失败')
    }
  }

  throw new Error(`未找到匹配的路由: ${path}`)
}

async function handleSupplierOutsourcedMaterials(method, params, user) {
  const path = global.__lastPath || ''
  const collectionNameRaw =
    process.env.CLOUDBASE_OUTSOURCED_MATERIAL_COLLECTION ||
    process.env.OUTSOURCED_MATERIAL_COLLECTION ||
    'outsourced_materials'
  const collectionName = String(collectionNameRaw || '').trim() || 'outsourced_materials'
  await ensureCollectionExists(collectionName)

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeNumber = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const normalizeRow = (doc) => {
    if (!doc || typeof doc !== 'object') return null
    const id = doc._id || doc.id
    if (!id) return null
    const unitPrice = normalizeNumber(doc.unitPrice ?? doc.price ?? doc.unit_price)
    return {
      id: String(id),
      _id: String(id),
      supplierId: normalizeText(doc.supplierId || doc.supplier_id),
      supplier_id: normalizeText(doc.supplier_id || doc.supplierId),
      name: normalizeText(doc.name ?? doc.rawMaterialName ?? doc.materialName ?? doc.title),
      specification: normalizeText(doc.specification ?? doc.spec ?? doc.size),
      unit: normalizeText(doc.unit ?? doc.uom),
      unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
      unit_price: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
      createdAt: doc.createdAt || doc._createTime || null,
      updatedAt: doc.updatedAt || doc._updateTime || null
    }
  }

  if (method === 'GET') {
    try {
      const supplierId = normalizeText(params?.supplierId)
      if (!supplierId) {
        const err = new Error('supplierId不能为空')
        err.statusCode = 400
        throw err
      }
      const result = await cloudAdapter.executeQuery(collectionName, { ...params, supplierId, limit: params?.limit || 2000 })
      const list = Array.isArray(result?.data) ? result.data : []
      const rows = list.map(normalizeRow).filter(Boolean)
      rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
      return handleSuccess(rows, '获取外购材料成功')
    } catch (error) {
      return handleError(error, '获取外购材料失败')
    }
  }

  if (method === 'POST') {
    try {
      const supplierId = normalizeText(params?.supplierId || params?.supplier_id)
      const name = normalizeText(params?.name ?? params?.rawMaterialName ?? params?.materialName ?? params?.title)
      if (!supplierId) throw new Error('supplierId不能为空')
      if (!name) throw new Error('原材料名称不能为空')
      const specification = normalizeText(params?.specification ?? params?.spec ?? params?.size)
      const unit = normalizeText(params?.unit ?? params?.uom)
      const unitPrice = normalizeNumber(params?.unitPrice ?? params?.price ?? params?.unit_price)

      const nowTs = Date.now()
      const actorId = normalizeText(user?.userId || user?.id)
      const patch = {
        supplierId,
        supplier_id: supplierId,
        name,
        specification,
        unit,
        unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
        unit_price: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
        updatedAt: nowTs,
        _updateTime: nowTs
      }

      const explicitId = normalizeText(params?.id || params?._id)
      if (explicitId) {
        await db.collection(collectionName).doc(explicitId).update({ data: patch })
        const got = await db.collection(collectionName).doc(explicitId).get().catch(() => null)
        const doc = got && got.data ? got.data : null
        const item = normalizeRow(doc || { ...patch, _id: explicitId })
        if (!item) {
          const err = new Error('记录不存在')
          err.statusCode = 404
          throw err
        }
        return handleSuccess({ item }, '更新成功')
      }

      const where = { supplierId, name }
      if (specification) where.specification = specification
      const existed = await db.collection(collectionName).where(where).limit(1).get().catch(() => null)
      const first = Array.isArray(existed?.data) && existed.data.length ? existed.data[0] : null
      const existingId = first && (first._id || first.id) ? normalizeText(first._id || first.id) : ''

      if (existingId) {
        await db.collection(collectionName).doc(existingId).update({ data: patch })
        const got = await db.collection(collectionName).doc(existingId).get().catch(() => null)
        const doc = got && got.data ? got.data : null
        const item = normalizeRow(doc || { ...patch, _id: existingId })
        return handleSuccess({ item }, '更新成功')
      }

      const createdRow = {
        ...patch,
        createdAt: nowTs,
        _createTime: nowTs,
        createdBy: actorId
      }
      const created = await db.collection(collectionName).add({ data: createdRow })
      const createdId = normalizeText(created?.id)
      const item = normalizeRow({ ...createdRow, _id: createdId })
      return handleSuccess({ item }, '创建成功')
    } catch (error) {
      return handleError(error, '保存失败')
    }
  }

  throw new Error(`未找到匹配的路由: ${path}`)
}

async function handleSupplierMaterialsStats(method, params, user) {
  await ensureCollectionExists('supplier_materials')
  if (method !== 'GET') {
    const err = new Error('不支持的HTTP方法')
    err.statusCode = 405
    throw err
  }

  const supplierId = String(params?.supplierId || '').trim()
  const pageSize = 1000
  const maxPages = 80
  const materialCodesBySupplier = new Map()

  const ensureSet = (sid) => {
    if (!materialCodesBySupplier.has(sid)) materialCodesBySupplier.set(sid, new Set())
    return materialCodesBySupplier.get(sid)
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const offset = (page - 1) * pageSize
    let query = db.collection('supplier_materials')
    if (supplierId) query = query.where({ supplierId })
    const raw = await query.skip(offset).limit(pageSize).get().catch(() => null)
    const docs = Array.isArray(raw?.data) ? raw.data : []
    if (!docs.length) break

    docs.forEach((doc) => {
      const sid = String(doc?.supplierId || '').trim()
      if (!sid) return
      if (supplierId && sid !== supplierId) return
      const code = String(doc?.materialCode || '').trim()
      if (!code) return
      ensureSet(sid).add(code)
    })

    if (docs.length < pageSize) break
  }

  const data = Array.from(materialCodesBySupplier.entries())
    .map(([sid, set]) => ({ supplierId: sid, materialCount: set ? set.size : 0 }))
    .sort((a, b) => (b.materialCount || 0) - (a.materialCount || 0))

  return handleSuccess(data, '获取供应商材质统计成功')
}

async function handleMaterialCodes(method, params, user) {
  const path = global.__lastPath || ''
  await ensureCollectionExists('material_codes')

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeGrammageG = (v) => {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
    const s = String(v).trim()
    if (!s) return null
    const m = s.match(/([0-9]+(?:\.[0-9]+)?)/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const normalizeRow = (doc) => {
    if (!doc || typeof doc !== 'object') return null
    const id = doc._id || doc.id
    if (!id) return null
    return {
      id: String(id),
      _id: String(id),
      materialCode: normalizeText(doc.materialCode ?? doc.code),
      paperName: normalizeText(doc.paperName ?? doc.paper ?? doc.name),
      grammageG: normalizeGrammageG(doc.grammageG ?? doc.grammage ?? doc.weightG ?? doc.weight),
      createdAt: doc.createdAt || doc._createTime || null,
      updatedAt: doc.updatedAt || doc._updateTime || null
    }
  }

  if (method === 'GET') {
    try {
      const keyword = normalizeText(params?.keyword || params?.q || params?.search)
      const raw = await db.collection('material_codes').limit(2000).get().catch(() => null)
      let list = Array.isArray(raw?.data) ? raw.data : []
      let rows = list.map(normalizeRow).filter(Boolean)
      if (keyword) {
        rows = rows.filter((r) => (
          String(r.materialCode || '').includes(keyword) ||
          String(r.paperName || '').includes(keyword)
        ))
      }
      rows.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
      return handleSuccess(rows, '获取材质代码库成功')
    } catch (error) {
      return handleError(error, '获取材质代码库失败')
    }
  }

  if (method === 'POST') {
    if (path.includes('/material-codes/upsert')) {
      try {
        const paperName = normalizeText(params?.paperName ?? params?.paper ?? params?.name)
        const materialCode = normalizeText(params?.materialCode ?? params?.code)
        const grammageG = normalizeGrammageG(params?.grammageG ?? params?.grammage ?? params?.weightG ?? params?.weight)
        if (!paperName) throw new Error('paperName不能为空')
        if (!materialCode) throw new Error('materialCode不能为空')
        if (grammageG == null) throw new Error('grammageG不能为空')

        const existed = await db.collection('material_codes').where({ materialCode }).limit(1).get().catch(() => null)
        const first = Array.isArray(existed?.data) && existed.data.length ? existed.data[0] : null
        const existingId = first && (first._id || first.id) ? String(first._id || first.id) : ''
        const nowTs = Date.now()
        const patch = {
          paperName,
          materialCode,
          grammageG,
          updatedAt: nowTs,
          _updateTime: nowTs
        }

        if (existingId) {
          await db.collection('material_codes').doc(existingId).update({ data: patch })
          const got = await db.collection('material_codes').doc(existingId).get().catch(() => null)
          const doc = got && got.data ? got.data : null
          const item = normalizeRow(doc || { ...first, ...patch, _id: existingId })
          return handleSuccess({ item }, '更新成功')
        }

        const createdBy = normalizeText(user?.userId || user?.id)
        const created = await db.collection('material_codes').add({
          data: {
            ...patch,
            createdBy,
            createdAt: nowTs,
            _createTime: nowTs
          }
        })
        const id = created?.id != null ? String(created.id) : ''
        const item = normalizeRow({ ...patch, _id: id, createdAt: nowTs, _createTime: nowTs })
        return handleSuccess({ item }, '创建成功')
      } catch (error) {
        return handleError(error, '保存失败')
      }
    }

    throw new Error(`未找到匹配的路由: ${path}`)
  }

  if (method === 'DELETE') {
    try {
      const idMatch = path.match(/\/material-codes\/([^/?#]+)/)
      const id = normalizeText(params?.id) || (idMatch ? normalizeText(idMatch[1]) : '')
      if (!id) throw new Error('缺少ID')
      await db.collection('material_codes').doc(id).remove()
      return handleSuccess({ item: { id, deleted: true } }, '删除成功')
    } catch (error) {
      return handleError(error, '删除失败')
    }
  }

  throw new Error(`未找到匹配的路由: ${path}`)
}

async function handlePayablesInvoiceUpload(method, params) {
  const path = global.__lastPath || ''
  if (method !== 'POST') {
    throw new Error('不支持的HTTP方法')
  }

  const parseDataUrl = (s) => {
    const m = String(s).match(/^data:(.*?);base64,(.*)$/)
    return m ? { mime: m[1], b64: m[2] } : null
  }
  const extFromMime = (mime) => {
    const s = String(mime || '').toLowerCase()
    if (s.includes('png')) return 'png'
    if (s.includes('jpeg') || s.includes('jpg')) return 'jpg'
    if (s.includes('gif')) return 'gif'
    if (s.includes('webp')) return 'webp'
    return 'jpg'
  }

  if (path.includes('/payables/invoice-upload/init')) {
    const fileName = params?.fileName != null ? String(params.fileName) : ''
    const mime = params?.mime != null ? String(params.mime) : ''
    const totalChunks = Number(params?.totalChunks || 0)
    if (!Number.isFinite(totalChunks) || totalChunks <= 0) {
      throw new Error('totalChunks不合法')
    }
    const uploadId = `payable_inv_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const meta = {
      uploadId,
      fileName,
      mime,
      totalChunks,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    try {
      await db.collection('payables_invoice_uploads').doc(uploadId).set({ data: meta })
    } catch (err) {
      try {
        await db.createCollection('payables_invoice_uploads')
        await db.collection('payables_invoice_uploads').doc(uploadId).set({ data: meta })
      } catch (_) {
        throw err
      }
    }
    return handleSuccess({ uploadId }, '初始化上传成功')
  }

  if (path.includes('/payables/invoice-upload/chunk')) {
    const uploadId = String(params?.uploadId || '').trim()
    const index = Number(params?.index)
    const chunk = params?.chunk != null ? String(params.chunk) : ''
    if (!uploadId) throw new Error('缺少uploadId')
    if (!Number.isFinite(index) || index < 0) throw new Error('index不合法')
    if (!chunk) throw new Error('chunk不能为空')

    const docId = `${uploadId}_${index}`
    const row = {
      uploadId,
      index,
      chunk,
      createdAt: Date.now()
    }
    try {
      await db.collection('payables_invoice_upload_chunks').doc(docId).set({ data: row })
    } catch (err) {
      try {
        await db.createCollection('payables_invoice_upload_chunks')
        await db.collection('payables_invoice_upload_chunks').doc(docId).set({ data: row })
      } catch (_) {
        throw err
      }
    }
    return handleSuccess({ uploadId, index }, '上传分片成功')
  }

  if (path.includes('/payables/invoice-upload/complete')) {
    const uploadId = String(params?.uploadId || '').trim()
    if (!uploadId) throw new Error('缺少uploadId')

    const metaRes = await db.collection('payables_invoice_uploads').doc(uploadId).get()
    const meta = metaRes?.data ? metaRes.data : null
    if (!meta) throw new Error('上传会话不存在或已过期')
    const totalChunks = Number(meta.totalChunks || 0)
    if (!Number.isFinite(totalChunks) || totalChunks <= 0) throw new Error('上传会话数据异常')

    const chunks = []
    for (let offset = 0; offset < totalChunks; offset += 100) {
      const res = await db.collection('payables_invoice_upload_chunks')
        .where({ uploadId })
        .orderBy('index', 'asc')
        .skip(offset)
        .limit(100)
        .get()
      const part = Array.isArray(res?.data) ? res.data : []
      chunks.push(...part)
      if (part.length < 100) break
    }

    if (chunks.length < totalChunks) {
      throw new Error(`分片不完整：已收到${chunks.length}/${totalChunks}`)
    }
    chunks.sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0))
    const b64 = chunks.map((c) => String(c?.chunk || '')).join('')
    if (!b64) throw new Error('合并后内容为空')

    let buffer = null
    try {
      buffer = Buffer.from(b64, 'base64')
    } catch (_) {
      buffer = null
    }
    if (!buffer || !buffer.length) throw new Error('图片解码失败')

    let fileID = ''
    try {
      const ext = extFromMime(meta.mime)
      const cloudPath = `attachments/payables/${uploadId}_${Date.now()}.${ext}`
      const uploaded = await cloud.uploadFile({ cloudPath, fileContent: buffer })
      fileID = uploaded?.fileID ? String(uploaded.fileID) : ''
    } catch (e) {
      throw e
    }
    if (!fileID) throw new Error('上传云存储失败')

    let url = ''
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [fileID] })
      url = tmp?.fileList?.[0]?.tempFileURL ? String(tmp.fileList[0].tempFileURL) : ''
    } catch (_) {
      url = ''
    }

    try {
      await db.collection('payables_invoice_upload_chunks').where({ uploadId }).remove()
    } catch (_) { }
    try {
      await db.collection('payables_invoice_uploads').doc(uploadId).remove()
    } catch (_) { }

    return handleSuccess({ fileID, url }, '上传完成')
  }

  throw new Error('不支持的上传操作')
}

async function handlePayables(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/payables\/([^/?#]+)/);
  const id = params.id || params.key || (idMatch ? idMatch[1] : '');

  if (method === 'GET') {
    if (id) {
      try {
        const doc = await db.collection('payables').doc(String(id)).get();
        const row = (doc && doc.data) ? doc.data : null;
        if (!row) return handleSuccess({ item: null }, '获取应付账款成功');
        const invoiceImageFileIdRaw = row.invoiceImageFileId || (row.invoiceImageUrl && /^cloud:\/\//.test(String(row.invoiceImageUrl)) ? row.invoiceImageUrl : '')
        const invoiceImageFileId = invoiceImageFileIdRaw ? String(invoiceImageFileIdRaw) : ''
        let invoiceImageUrl = row.invoiceImageUrl || ''
        if (invoiceImageFileId) {
          try {
            const tmp = await cloud.getTempFileURL({ fileList: [invoiceImageFileId] })
            invoiceImageUrl = tmp?.fileList?.[0]?.tempFileURL ? String(tmp.fileList[0].tempFileURL) : ''
          } catch (_) {
            invoiceImageUrl = ''
          }
        }
        const item = {
          key: String(row._id || id),
          supplierName: row.supplierName || '',
          invoiceDate: row.invoiceDate || '',
          dueDate: row.dueDate || '',
          amountPayable: Number(row.amountPayable || 0),
          amountPaid: Number(row.amountPaid || 0),
          status: row.status || 'pending',
          paymentDate: row.paymentDate || '',
          paymentTerm: row.paymentTerm || '现付',
          paymentRemark: row.paymentRemark || '',
          paymentHistory: Array.isArray(row.paymentHistory) ? row.paymentHistory : [],
          invoiceImageUrl,
          invoiceImageFileId,
          invoiceImageName: row.invoiceImageName || ''
        };
        return handleSuccess({ item }, '获取应付账款成功');
      } catch (error) {
        return handleError(error, '获取应付账款失败');
      }
    }
    return await handlePayablesList(method, params);
  }

  if (method === 'POST') {
    try {
      const payload = params || {};
      const supplierName = String(payload.supplierName || '').trim();
      const paymentTerm = String(payload.paymentTerm || '现付').trim() || '现付';
      const invoiceDate = payload.invoiceDate ? String(payload.invoiceDate) : '';
      const dueDate = payload.dueDate ? String(payload.dueDate) : '';
      const amountPayable = Number(payload.amountPayable || 0);
      const amountPaid = Number(payload.amountPaid || 0);
      const status = String(payload.status || (amountPaid >= amountPayable && amountPayable > 0 ? 'paid' : (amountPaid > 0 ? 'partial' : 'pending')));
      const paymentDate = payload.paymentDate ? String(payload.paymentDate) : '';
      const paymentRemark = payload.paymentRemark ? String(payload.paymentRemark) : '';
      const paymentHistory = Array.isArray(payload.paymentHistory) ? payload.paymentHistory : [];
      let invoiceImageUrl = payload.invoiceImageUrl ? String(payload.invoiceImageUrl) : '';
      let invoiceImageFileId = payload.invoiceImageFileId ? String(payload.invoiceImageFileId) : '';
      const invoiceImageName = payload.invoiceImageName ? String(payload.invoiceImageName) : '';

      if (!supplierName) throw new Error('供应商名称不能为空');
      if (!Number.isFinite(amountPayable) || amountPayable <= 0) throw new Error('应付金额不合法');
      if (!Number.isFinite(amountPaid) || amountPaid < 0) throw new Error('已付金额不合法');
      if (amountPaid > amountPayable) throw new Error('已付金额不能超过应付金额');

      const docId = String(payload.key || payload.id || '').trim();
      const normalizeCloudFileId = (s) => {
        const v = String(s || '').trim()
        return v && /^cloud:\/\//.test(v) ? v : ''
      }
      const parseDataUrl = (s) => {
        const m = String(s).match(/^data:(.*?);base64,(.*)$/)
        return m ? { mime: m[1], b64: m[2] } : null
      }
      const extFromMime = (mime) => {
        const s = String(mime || '').toLowerCase()
        if (s.includes('png')) return 'png'
        if (s.includes('jpeg') || s.includes('jpg')) return 'jpg'
        if (s.includes('gif')) return 'gif'
        if (s.includes('webp')) return 'webp'
        return 'jpg'
      }

      invoiceImageFileId = normalizeCloudFileId(invoiceImageFileId) || normalizeCloudFileId(invoiceImageUrl)
      if (invoiceImageFileId) {
        invoiceImageUrl = ''
      } else if (invoiceImageUrl && invoiceImageUrl.startsWith('data:')) {
        const p = parseDataUrl(invoiceImageUrl)
        if (p && p.b64) {
          const ext = extFromMime(p.mime)
          const cloudPath = `attachments/payables/${docId || `payable_${Date.now()}`}_${Date.now()}.${ext}`
          const buffer = Buffer.from(p.b64, 'base64')
          const up = await cloud.uploadFile({ cloudPath, fileContent: buffer })
          invoiceImageFileId = up?.fileID ? String(up.fileID) : ''
          invoiceImageUrl = ''
        }
      } else if (invoiceImageUrl && !/^https?:\/\//.test(invoiceImageUrl)) {
        invoiceImageUrl = ''
      }
      const recordData = {
        supplierName,
        invoiceDate,
        dueDate,
        amountPayable,
        amountPaid,
        status,
        paymentDate,
        paymentTerm,
        paymentRemark,
        paymentHistory,
        invoiceImageUrl,
        invoiceImageFileId,
        invoiceImageName,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      if (docId) {
        try {
          await db.collection('payables').doc(docId).set({ data: { ...recordData } });
        } catch (err) {
          try {
            await db.createCollection('payables');
            await db.collection('payables').doc(docId).set({ data: { ...recordData } });
          } catch (_) {
            throw err;
          }
        }
        let invoiceImageUrlOut = invoiceImageUrl
        if (invoiceImageFileId) {
          try {
            const tmp = await cloud.getTempFileURL({ fileList: [invoiceImageFileId] })
            invoiceImageUrlOut = tmp?.fileList?.[0]?.tempFileURL ? String(tmp.fileList[0].tempFileURL) : ''
          } catch (_) {
            invoiceImageUrlOut = ''
          }
        }
        const item = { ...recordData, invoiceImageUrl: invoiceImageUrlOut, key: docId };
        return handleSuccess({ item }, '创建应付账款成功');
      }

      let created = null;
      try {
        created = await cloudAdapter.create('payables', recordData);
      } catch (err) {
        try {
          await db.createCollection('payables');
          created = await cloudAdapter.create('payables', recordData);
        } catch (_) {
          throw err;
        }
      }
      const data = created && created.data ? created.data : {};
      const item = {
        key: String(data._id || ''),
        supplierName: data.supplierName || supplierName,
        invoiceDate: data.invoiceDate || invoiceDate,
        dueDate: data.dueDate || dueDate,
        amountPayable: Number(data.amountPayable || amountPayable),
        amountPaid: Number(data.amountPaid || amountPaid),
        status: data.status || status,
        paymentDate: data.paymentDate || paymentDate,
        paymentTerm: data.paymentTerm || paymentTerm,
        paymentRemark: data.paymentRemark || paymentRemark,
        paymentHistory: Array.isArray(data.paymentHistory) ? data.paymentHistory : paymentHistory,
        invoiceImageUrl: data.invoiceImageUrl || invoiceImageUrl,
        invoiceImageFileId: data.invoiceImageFileId || invoiceImageFileId,
        invoiceImageName: data.invoiceImageName || invoiceImageName
      };
      if (item.invoiceImageFileId) {
        try {
          const tmp = await cloud.getTempFileURL({ fileList: [item.invoiceImageFileId] })
          item.invoiceImageUrl = tmp?.fileList?.[0]?.tempFileURL ? String(tmp.fileList[0].tempFileURL) : ''
        } catch (_) {
          item.invoiceImageUrl = ''
        }
      }
      return handleSuccess({ item }, '创建应付账款成功');
    } catch (error) {
      return handleError(error, '创建应付账款失败');
    }
  }

  if (method === 'PUT') {
    try {
      const id2 = String(id || '').trim();
      if (!id2) throw new Error('缺少ID');
      const payload = params || {};
      const updateData = { ...payload };
      delete updateData.id;
      delete updateData.key;
      const normalizeCloudFileId = (s) => {
        const v = String(s || '').trim()
        return v && /^cloud:\/\//.test(v) ? v : ''
      }
      const fileIdFromPayload = normalizeCloudFileId(updateData.invoiceImageFileId) || normalizeCloudFileId(updateData.invoiceImageUrl)
      if (fileIdFromPayload) {
        updateData.invoiceImageFileId = fileIdFromPayload
        updateData.invoiceImageUrl = ''
      } else if (updateData.invoiceImageUrl && !/^https?:\/\//.test(String(updateData.invoiceImageUrl))) {
        delete updateData.invoiceImageUrl
      }
      updateData.updatedAt = new Date();
      const updated = await cloudAdapter.update('payables', id2, updateData);
      const data = updated && updated.data ? updated.data : {};
      const invoiceImageFileIdRaw = data.invoiceImageFileId || (data.invoiceImageUrl && /^cloud:\/\//.test(String(data.invoiceImageUrl)) ? data.invoiceImageUrl : '')
      const invoiceImageFileId = invoiceImageFileIdRaw ? String(invoiceImageFileIdRaw) : ''
      let invoiceImageUrl = data.invoiceImageUrl || ''
      if (invoiceImageFileId) {
        try {
          const tmp = await cloud.getTempFileURL({ fileList: [invoiceImageFileId] })
          invoiceImageUrl = tmp?.fileList?.[0]?.tempFileURL ? String(tmp.fileList[0].tempFileURL) : ''
        } catch (_) {
          invoiceImageUrl = ''
        }
      }
      const item = {
        key: String(data._id || id2),
        supplierName: data.supplierName || '',
        invoiceDate: data.invoiceDate || '',
        dueDate: data.dueDate || '',
        amountPayable: Number(data.amountPayable || 0),
        amountPaid: Number(data.amountPaid || 0),
        status: data.status || 'pending',
        paymentDate: data.paymentDate || '',
        paymentTerm: data.paymentTerm || '现付',
        paymentRemark: data.paymentRemark || '',
        paymentHistory: Array.isArray(data.paymentHistory) ? data.paymentHistory : [],
        invoiceImageUrl,
        invoiceImageFileId,
        invoiceImageName: data.invoiceImageName || ''
      };
      return handleSuccess({ item }, '更新应付账款成功');
    } catch (error) {
      return handleError(error, '更新应付账款失败');
    }
  }

  if (method === 'DELETE') {
    try {
      const id2 = String(id || '').trim();
      if (!id2) throw new Error('缺少ID');
      const removed = await cloudAdapter.delete('payables', id2);
      const data = removed && removed.data ? removed.data : {};
      const item = {
        key: String(data._id || id2),
        deleted: true
      };
      return handleSuccess({ item }, '删除应付账款成功');
    } catch (error) {
      return handleError(error, '删除应付账款失败');
    }
  }

  throw new Error('不支持的HTTP方法');
}

async function handlePayablesList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('payables', {
      ...params,
      limit: params.limit || 500
    });
    const list = Array.isArray(result?.data) ? result.data : [];
    const fileIds = []
    list.forEach((row) => {
      if (!row) return
      const fid = row.invoiceImageFileId || (row.invoiceImageUrl && /^cloud:\/\//.test(String(row.invoiceImageUrl)) ? row.invoiceImageUrl : '')
      if (fid) fileIds.push(String(fid))
    })
    let map = new Map()
    if (fileIds.length) {
      try {
        const uniq = Array.from(new Set(fileIds))
        const batches = []
        for (let i = 0; i < uniq.length; i += 50) {
          batches.push(uniq.slice(i, i + 50))
        }
        const pairs = []
        for (const b of batches) {
          const tmp = await cloud.getTempFileURL({ fileList: b })
          const fl = Array.isArray(tmp?.fileList) ? tmp.fileList : []
          fl.forEach((x) => {
            if (x?.fileID && x?.tempFileURL) {
              pairs.push([String(x.fileID), String(x.tempFileURL)])
            }
          })
        }
        map = new Map(pairs)
      } catch (_) {
        map = new Map()
      }
    }
    const items = list
      .map((row) => {
        if (!row) return null;
        const id = row._id || row.id;
        if (!id) return null;
        const invoiceImageFileIdRaw = row.invoiceImageFileId || (row.invoiceImageUrl && /^cloud:\/\//.test(String(row.invoiceImageUrl)) ? row.invoiceImageUrl : '')
        const invoiceImageFileId = invoiceImageFileIdRaw ? String(invoiceImageFileIdRaw) : ''
        let invoiceImageUrl = row.invoiceImageUrl || ''
        if (invoiceImageFileId) {
          invoiceImageUrl = map.get(invoiceImageFileId) || ''
        }
        return {
          key: String(id),
          supplierName: row.supplierName || '',
          invoiceDate: row.invoiceDate || '',
          dueDate: row.dueDate || '',
          amountPayable: Number(row.amountPayable || 0),
          amountPaid: Number(row.amountPaid || 0),
          status: row.status || 'pending',
          paymentDate: row.paymentDate || '',
          paymentTerm: row.paymentTerm || '现付',
          paymentRemark: row.paymentRemark || '',
          paymentHistory: Array.isArray(row.paymentHistory) ? row.paymentHistory : [],
          invoiceImageUrl,
          invoiceImageFileId,
          invoiceImageName: row.invoiceImageName || ''
        };
      })
      .filter(Boolean);
    return handleSuccess({ items }, '获取应付账款成功');
  } catch (error) {
    return handleError(error, '获取应付账款失败');
  }
}

// 订单号相关（统一桥接）
async function handleOrderNumbers(method, params) {
  const path = global.__lastPath || ''
  if (method === 'POST') {
    if (path.includes('/order-numbers/generate')) {
      try {
        const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'reserveOrderNumber' } })
        const data = result && result.result && result.result.data ? result.result.data : {}
        return handleSuccess(data, '生成订单号成功')
      } catch (error) {
        return handleError(error, '生成订单号失败')
      }
    }
    if (path.includes('/order-numbers/release')) {
      const { reservationId, orderNo, orderNumber } = params || {}
      const payload = { reservationId, orderNumber: orderNo || orderNumber }
      try {
        const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'releaseOrderNumber', data: payload } })
        const data = result && result.result && result.result.data ? result.result.data : {}
        return handleSuccess(data, '释放订单号成功')
      } catch (error) {
        return handleError(error, '释放订单号失败')
      }
    }
    if (path.includes('/order-numbers/confirm')) {
      // 兼容：云端创建订单时会自行确认，占位该接口返回成功
      const { orderNo } = params || {}
      return handleSuccess({ orderNo }, '确认订单号成功')
    }
  } else if (method === 'GET') {
    if (path.includes('/order-numbers/stats')) {
      // 简化：从云端统计集合返回今日数据（可按需扩展）
      const today = new Date()
      const year = String(today.getFullYear())
      try {
        const resv = await db.collection('order_number_reservations').where({ year }).count()
        return handleSuccess({ date: `${year}`, totalReservations: resv.total }, '获取订单号统计成功')
      } catch (error) {
        return handleSuccess({ date: `${year}`, totalReservations: 0 }, '获取订单号统计成功')
      }
    }
  }
  throw new Error('不支持的订单号操作')
}

// 登录处理
async function handleAuthLogin(method, params) {
  if (method !== 'POST') {
    throw new Error('不支持的HTTP方法');
  }

  const { username, password } = params;
  if (!username || !password) {
    throw new Error('用户名和密码不能为空');
  }

  try {
    const result = await cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'login',
        data: { username, password, client: 'pc', terminal: 'pc' }
      }
    });

    if (result && result.result && result.result.success) {
      const payload = result.result.data || {}
      const user = payload.user || (payload.data && payload.data.user) || {}
      const role = String(user.role || user.userRole || '').toLowerCase()
      const isAdmin = role === 'admin' || role === 'administrator'
      if (!isAdmin) {
        return handleError(new Error('仅管理员账号可登录PC端'), '仅管理员账号可登录PC端')
      }
      const pcPayload = { ...payload }
      delete pcPayload.sessionId
      return handleSuccess(pcPayload, '登录成功');
    }

    const msg = (result && result.result && result.result.message) || '登录失败';
    throw new Error(msg);
  } catch (error) {
    return handleError(error, '登录失败');
  }
}

// 登出处理
async function handleAuthLogout(method, params) {
  if (method !== 'POST') {
    throw new Error('不支持的HTTP方法');
  }
  try {
    await cloud.callFunction({
      name: 'erp-api',
      data: { action: 'logout' }
    });
    return handleSuccess({ logout: true }, '登出成功');
  } catch (error) {
    return handleError(error, '登出失败');
  }
}

// 解析登录令牌
function parseTokenFromHeader(event, options = {}) {
  const headers = event.headers || {};
  const authorization = String(
    headers.Authorization ||
    headers.authorization ||
    headers['X-Authorization'] ||
    headers['x-authorization'] ||
    headers['X_AUTHORIZATION'] ||
    headers['x_authorization'] ||
    headers['X-Access-Token'] ||
    headers['x-access-token'] ||
    headers['X_ACCESS_TOKEN'] ||
    headers['x_access_token'] ||
    ''
  ).trim();
  if (!authorization) return null
  const raw = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : authorization
  try {
    const tokenRaw = raw.startsWith('token_') ? raw.slice('token_'.length) : raw;
    if (!tokenRaw || tokenRaw.length > 4096) return null;

    const dotIndex = tokenRaw.lastIndexOf('.');
    if (dotIndex <= 0) return null;
    const tokenData = tokenRaw.slice(0, dotIndex);
    const signature = tokenRaw.slice(dotIndex + 1);
    if (!/^[a-f0-9]{64}$/i.test(signature)) return null;

    const decoded = Buffer.from(tokenData, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload !== 'object') return null;
    const now = Date.now()
    const exp = payload.exp != null ? Number(payload.exp) : 0
    if (exp && exp < now) {
      const allowExpired = options && options.allowExpired === true
      if (!allowExpired) return null
      const maxExpiredMsRaw = options && options.maxExpiredMs != null ? Number(options.maxExpiredMs) : 0
      const maxExpiredMs = Number.isFinite(maxExpiredMsRaw) && maxExpiredMsRaw > 0 ? maxExpiredMsRaw : 0
      if (maxExpiredMs) {
        const expiredBy = now - exp
        if (!Number.isFinite(expiredBy) || expiredBy > maxExpiredMs) return null
      }
    }

    const secret = resolveTokenSecret();
    if (secret) {
      const expected = crypto.createHmac('sha256', secret).update(tokenData).digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length) return null;
      if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// 当前用户信息
async function handleAuthMe(method, params, user) {
  if (method !== 'GET') {
    throw new Error('不支持的HTTP方法');
  }
  try {
    // 从请求头解析令牌
    const tokenPayload = parseTokenFromHeader(global.__lastEvent || {});
    if (tokenPayload) {
      return handleSuccess({
        user: {
          id: tokenPayload.userId || 'unknown',
          username: tokenPayload.username || 'user',
          role: tokenPayload.role || 'user'
        }
      }, '获取用户信息成功');
    }
    // 兼容匿名
    return handleSuccess({ user: { id: user.userId, username: 'anonymous', role: 'guest' } }, '获取用户信息成功');
  } catch (error) {
    return handleError(error, '获取用户信息失败');
  }
}

async function handleAuthRefresh(method, params, user) {
  if (method !== 'POST') {
    throw new Error('不支持的HTTP方法');
  }
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}, { allowExpired: true, maxExpiredMs: 7 * 24 * 60 * 60 * 1000 });
  if (!tokenPayload || !tokenPayload.userId) {
    const err = new Error('未授权访问')
    err.statusCode = 401
    throw err
  }
  try {
    const result = await cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'refreshToken',
        data: {
          userId: tokenPayload.userId,
          platform: tokenPayload.platform || 'pc'
        }
      }
    })
    const payload = result && result.result ? result.result : result
    if (payload && payload.success === true) {
      return handleSuccess(payload.data || payload, payload.message || '刷新成功')
    }
    const msg = (payload && payload.message) ? payload.message : '刷新失败'
    const err = new Error(msg)
    err.statusCode = 401
    throw err
  } catch (error) {
    return handleError(error, '刷新失败')
  }
}

function normalizeOrderDetailForBrief(raw) {
  const str = (v) => {
    const s = String(v ?? '').trim()
    return s ? s : ''
  }
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (!raw || typeof raw !== 'object') return raw

  const order = { ...raw }
  const nested = order.data && typeof order.data === 'object' ? order.data : null
  if (nested) {
    for (const [k, v] of Object.entries(nested)) {
      if (order[k] === undefined || order[k] === null || order[k] === '') {
        order[k] = v
      }
    }
    if ((!Array.isArray(order.items) || order.items.length === 0) && Array.isArray(nested.items)) {
      order.items = nested.items
    }
  }
  const items = Array.isArray(order.items) ? order.items : []
  const first = items.find(Boolean) || {}
  const meta = order.meta && typeof order.meta === 'object' ? order.meta : {}
  const brief = meta.brief && typeof meta.brief === 'object' ? meta.brief : {}

  const orderNo =
    str(order.orderNo) ||
    str(order.orderNumber) ||
    str(order.order_no) ||
    str(order.order_number) ||
    str(order.no) ||
    str(order.code)
  const customerName =
    str(order.customerName) ||
    str(order.customer_name) ||
    str(order.customer && (order.customer.companyName || order.customer.shortName)) ||
    str(order.customer && (order.customer.company_name || order.customer.short_name)) ||
    str(order.customer && order.customer.name) ||
    str(order.customer && order.customer.company) ||
    str(order.shortName) ||
    str(order.customerShort) ||
    str(order.customer_short) ||
    str(order.customerShortName) ||
    str(order.customer_short_name) ||
    str(order.clientName) ||
    str(order.client_name) ||
    str(order.customerShortName) ||
    str(order.supplierName) ||
    str(order.supplierShortName) ||
    str(meta.customerName) ||
    str(meta.customer_name) ||
    str(brief.customerName)
  const goodsName =
    str(order.goodsName) ||
    str(order.goods_name) ||
    str(order.productTitle) ||
    str(order.product_title) ||
    str(order.productName) ||
    str(order.product_name) ||
    str(order.product && (order.product.title || order.product.name)) ||
    str(order.product && (order.product.productTitle || order.product.productName)) ||
    str(order.product && (order.product.product_title || order.product.product_name)) ||
    str(order.name) ||
    str(order.itemName) ||
    str(order.item_name) ||
    str(first.goodsName) ||
    str(first.goods_name) ||
    str(first.productTitle) ||
    str(first.product_title) ||
    str(first.productName) ||
    str(first.product_name) ||
    str(first.name) ||
    str(meta.goodsName) ||
    str(brief.goodsName)

  const materialNo =
    str(order.materialNo) ||
    str(order.material_no) ||
    str(order.materialCode) ||
    str(order.material_code) ||
    str(order.product && (order.product.materialNo || order.product.materialCode)) ||
    str(order.product && (order.product.material_no || order.product.material_code)) ||
    str(order.material) ||
    str(order.materialNumber) ||
    str(order.material_number) ||
    str(first.materialNo) ||
    str(first.material_no) ||
    str(first.materialCode) ||
    str(first.material_code) ||
    str(meta.materialNo) ||
    str(brief.materialNo)
  const flute =
    str(order.flute) ||
    str(order.fluteType) ||
    str(order.flute_type) ||
    str(order.product && (order.product.flute || order.product.fluteType || order.product.flute_type)) ||
    str(first.flute) ||
    str(first.fluteType) ||
    str(first.flute_type) ||
    str(meta.flute) ||
    str(brief.flute)

  const boardWidth =
    num(order.boardWidth) ??
    num(order.board_width) ??
    num(order.specWidth) ??
    num(order.spec_width) ??
    num(order.product && (order.product.boardWidth ?? order.product.specWidth)) ??
    num(order.product && (order.product.board_width ?? order.product.spec_width)) ??
    num(first.boardWidth) ??
    num(first.specWidth) ??
    num(first.board_width) ??
    num(first.spec_width) ??
    num(order.width) ??
    num(order.w) ??
    num(first.width) ??
    num(first.w) ??
    num(meta.boardWidth) ??
    num(brief.boardWidth)
  const boardHeight =
    num(order.boardHeight) ??
    num(order.board_height) ??
    num(order.specLength) ??
    num(order.spec_length) ??
    num(order.product && (order.product.boardHeight ?? order.product.specLength)) ??
    num(order.product && (order.product.board_height ?? order.product.spec_length)) ??
    num(first.boardHeight) ??
    num(first.specLength) ??
    num(first.board_height) ??
    num(first.spec_length) ??
    num(order.height) ??
    num(order.h) ??
    num(first.height) ??
    num(first.h) ??
    num(meta.boardHeight) ??
    num(brief.boardHeight)
  const spec =
    str(order.spec) ||
    str(order.paperSize) ||
    str(order.paper_size) ||
    str(order.product && (order.product.spec || order.product.paperSize)) ||
    str(order.product && (order.product.paper_size)) ||
    str(order.size) ||
    str(order.specification) ||
    (boardWidth != null && boardHeight != null ? `${boardWidth}×${boardHeight}` : '') ||
    str(first.spec) ||
    str(first.paperSize) ||
    str(first.paper_size) ||
    str(meta.spec) ||
    str(brief.spec)

  const sheetCount =
    num(order.sheetCount) ??
    num(order.sheet_count) ??
    num(order.totalQty) ??
    num(order.total_qty) ??
    num(order.quantity) ??
    num(order.qty) ??
    num(order.count) ??
    num(order.orderQty) ??
    num(order.order_qty) ??
    num(order.product && (order.product.sheetCount ?? order.product.totalQty ?? order.product.quantity)) ??
    num(first.sheetCount) ??
    num(first.totalQty) ??
    num(first.quantity)
  const unitPrice =
    num(order.unitPrice) ??
    num(order.unit_price) ??
    num(order.salePrice) ??
    num(order.sale_price) ??
    num(order.price) ??
    num(order.product && (order.product.unitPrice ?? order.product.salePrice ?? order.product.price)) ??
    num(first.unitPrice) ??
    num(first.unit_price) ??
    num(first.salePrice) ??
    num(first.sale_price) ??
    num(first.price)
  const salePrice = num(order.salePrice) ?? num(first.salePrice) ?? num(brief.salePrice)

  const out = {
    ...order,
    orderNo: str(order.orderNo) || orderNo || undefined,
    orderNumber: str(order.orderNumber) || orderNo || undefined,
    customerName: str(order.customerName) || customerName || undefined,
    goodsName: str(order.goodsName) || goodsName || undefined,
    productTitle:
      str(order.productTitle) ||
      str(order.goodsName) ||
      str(first.productTitle) ||
      str(first.goodsName) ||
      undefined,
    productName:
      str(order.productName) ||
      str(first.productName) ||
      str(first.name) ||
      undefined,
    materialNo: str(order.materialNo) || materialNo || undefined,
    materialCode: str(order.materialCode) || materialNo || undefined,
    flute: str(order.flute) || flute || undefined,
    boardWidth: order.boardWidth != null ? order.boardWidth : (boardWidth != null ? boardWidth : undefined),
    boardHeight: order.boardHeight != null ? order.boardHeight : (boardHeight != null ? boardHeight : undefined),
    spec: str(order.spec) || spec || undefined,
    paperSize: str(order.paperSize) || spec || undefined,
    sheetCount: order.sheetCount != null ? order.sheetCount : (sheetCount != null ? sheetCount : undefined),
    totalQty: order.totalQty != null ? order.totalQty : (sheetCount != null ? sheetCount : undefined),
    quantity: order.quantity != null ? order.quantity : (sheetCount != null ? sheetCount : undefined),
    unitPrice: order.unitPrice != null ? Number(order.unitPrice) : (unitPrice != null ? unitPrice : undefined),
    salePrice: order.salePrice != null ? Number(order.salePrice) : (salePrice != null ? salePrice : undefined),
    price: order.price != null ? Number(order.price) : (unitPrice != null ? unitPrice : undefined)
  }

  return out
}

// 订单处理
async function handleOrders(method, params, user) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/orders\/([^/?#]+)/);
  const id = params.id || (idMatch ? idMatch[1] : '');
  if (method === 'GET') {
    if (id === 'write-check' || path.includes('/orders/write-check')) {
      const tokenPayload = requireAdminFromEvent(global.__lastEvent || {});
      try {
        const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'diagnoseOrdersWrite', data: { env: 'cloud', actorUserId: tokenPayload.userId || '' } } });
        const payload = result && result.result ? result.result : result;
        if (payload && payload.success === true) return handleSuccess(payload.data || payload, 'orders写入自检完成');
        throw new Error((payload && payload.message) || 'orders写入自检失败');
      } catch (e) {
        return handleError(e, 'orders写入自检失败');
      }
    }
    if (id) {
      let data = null;
      try {
        const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'getOrderDetail', data: { id } } });
        const payload = result && result.result ? result.result : result;
        if (payload && payload.success === true && payload.data) data = payload.data;
      } catch (_) { }

      if (!data) {
        const tryFindInCollection = async (collectionName) => {
          try {
            const doc = await db.collection(collectionName).doc(id).get();
            if (doc && doc.data) return doc.data;
          } catch (_) { }
          try {
            const q = await db.collection(collectionName).where(
              _.or([
                { orderNo: id },
                { orderNumber: id },
                { order_no: id },
                { order_number: id },
                { no: id }
              ])
            ).limit(1).get();
            if (q && Array.isArray(q.data) && q.data.length) return q.data[0];
          } catch (_) { }
          return null;
        };

        const candidates = ['orders', 'orders_tmp', 'erp_orders', 'order_list', 'purchase_orders'];
        for (const c of candidates) {
          data = await tryFindInCollection(c);
          if (data) break;
        }
      }

      if (!data) {
        return handleError(new Error('订单不存在'), '订单不存在');
      }

      try {
        if (data && Array.isArray(data.attachments) && data.attachments.length) {
          const rawList = data.attachments;
          const fileIDs = rawList
            .map(a => {
              if (typeof a === 'string') return a; // 可能是 fileID 或 http 链接
              if (a && a.fileID) return a.fileID;
              if (a && a.url && /^cloud:\/\//.test(a.url)) return a.url;
              return null;
            })
            .filter(Boolean);
          let map = new Map();
          if (fileIDs.length) {
            const tmp = await cloud.getTempFileURL({ fileList: fileIDs });
            map = new Map((tmp && tmp.fileList) ? tmp.fileList.map(x => [x.fileID, x.tempFileURL]) : []);
          }
          data.attachments = rawList.map(a => {
            if (typeof a === 'string') {
              const isHttp = /^https?:\/\//.test(a);
              const url = isHttp ? a : (map.get(a) || null);
              return { name: a, url, fileID: isHttp ? undefined : a };
            }
            const fid = a.fileID || (a.url && /^cloud:\/\//.test(a.url) ? a.url : null);
            const isHttp = a.url && /^https?:\/\//.test(a.url);
            const url = isHttp ? a.url : (map.get(fid) || a.url || null);
            return { ...a, url };
          });
        }
      } catch (e) {
        console.error('附件临时URL生成失败:', e);
      }
      return handleSuccess(normalizeOrderDetailForBrief(data), '获取订单详情成功');
    }
    return await handleOrdersList(method, params);
  } else if (method === 'POST') {
    if (path.includes('/orders/tmp/migrate') || path.includes('/orders/migrate-tmp')) {
      const tokenPayload = requireAdminFromEvent(global.__lastEvent || {})
      if (!tokenPayload || !tokenPayload.userId) {
        const err = new Error('未授权访问')
        err.statusCode = 401
        throw err
      }
      try {
        const result = await cloud.callFunction({
          name: 'erp-api',
          data: { action: 'migrateOrdersTmpToOrders', data: { ...(params || {}), actorUserId: tokenPayload.userId || '' } }
        })
        const payload = result && result.result ? result.result : result
        if (payload && payload.success === true) {
          return handleSuccess(payload.data || payload, payload.message || '迁移完成')
        }
        throw new Error((payload && payload.message) || '迁移失败')
      } catch (e) {
        return handleError(e, '迁移失败')
      }
    }
    if (path.includes('/orders/purge-deleted') || path.includes('/orders/purge-soft-deleted')) {
      const tokenPayload = requireAdminFromEvent(global.__lastEvent || {})
      if (!tokenPayload || !tokenPayload.userId) {
        const err = new Error('未授权访问')
        err.statusCode = 401
        throw err
      }
      try {
        const result = await cloud.callFunction({
          name: 'erp-api',
          data: { action: 'purgeDeletedOrders', data: { ...(params || {}), actorUserId: tokenPayload.userId || '' } }
        })
        const payload = result && result.result ? result.result : result
        if (payload && payload.success === true) {
          return handleSuccess(payload.data || payload, payload.message || '清理完成')
        }
        throw new Error((payload && payload.message) || '清理失败')
      } catch (e) {
        return handleError(e, '清理失败')
      }
    }
    if (path.includes('/orders/fix-duplicate-order-nos')) {
      try {
        const result = await cloud.callFunction({
          name: 'erp-api',
          data: { action: 'fixDuplicateOrders', params: params || {} }
        })
        const payload = result && result.result ? result.result : result
        if (payload && payload.success === true) {
          return handleSuccess(payload.data || payload, payload.message || '修复完成')
        }
        throw new Error((payload && payload.message) || '修复失败')
      } catch (error) {
        return handleError(error, '修复失败')
      }
    }
    if (path.includes('/orders/boards/relink')) {
      try {
        const result = await cloud.callFunction({
          name: 'erp-api',
          data: { action: 'relinkBoardPurchaseAssociation', data: params || {} }
        });
        const payload = result && result.result ? result.result : result;
        if (payload && payload.success === true) {
          return handleSuccess(payload.data, payload.message || '关联更新成功');
        }
        throw new Error((payload && payload.message) || '关联更新失败');
      } catch (error) {
        return handleError(error, '关联更新失败');
      }
    }
    try {
      const isMeaningfulText = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return false
        return !['-', '—', '--', '---', '暂无', '无'].includes(s)
      }
      const orderType = String(params?.orderType || '').toLowerCase()
      const source = String(params?.source || '').toLowerCase()
      const purchaseCategory = String(params?.purchaseCategory || '').trim()
      const supplierName = String(params?.supplierName || '').trim()
      const customerName = String(params?.customerName || '').trim()
      const productText =
        (isMeaningfulText(params?.productName) && String(params.productName).trim()) ||
        (isMeaningfulText(params?.productTitle) && String(params.productTitle).trim()) ||
        (isMeaningfulText(params?.goodsName) && String(params.goodsName).trim()) ||
        ''
      const isPurchaseFlag =
        params?.isPurchase === true ||
        String(params?.isPurchase || '').toLowerCase() === 'true' ||
        String(params?.channel || '').toLowerCase() === 'purchase'
      const isPurchase =
        orderType === 'purchase' ||
        source === 'purchased' ||
        Boolean(purchaseCategory) ||
        isPurchaseFlag

      if (isPurchase) {
        if (!isMeaningfulText(supplierName)) throw new Error('供应商不能为空')
        if (!productText) throw new Error('商品名称不能为空')
      } else {
        if (!isMeaningfulText(customerName)) throw new Error('客户不能为空')
        if (!productText) throw new Error('产品不能为空')
      }

      const normalizedItems = normalizeOrderItemsForCreate(params)

      const qtyFromItems = normalizedItems.reduce((s, it) => s + Number(it.quantity || 0), 0)
      const qtyFromParam = Number(params?.quantity)
      const qty = normalizedItems.length ? qtyFromItems : qtyFromParam
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须大于0')

      const unitPrice = Number(params?.unitPrice ?? params?.price ?? 0)
      const amount =
        params?.totalAmount != null
          ? Number(params.totalAmount)
          : params?.amount != null
            ? Number(params.amount)
            : Math.max(0, unitPrice * qty)
      const totalAmount = Number.isFinite(amount) ? amount : 0

      const items = normalizedItems.length
        ? normalizedItems.map((it) => ({
          ...it,
          amount: it.amount != null ? Number(it.amount) : undefined,
          totalPrice: it.totalPrice != null ? Number(it.totalPrice) : undefined
        }))
        : [{
          name: productText,
          quantity: qty,
          unitPrice,
          price: unitPrice,
          amount: totalAmount,
          totalPrice: totalAmount
        }]

      const payload = { ...params, totalAmount, items, quantity: qty, productName: params?.productName || productText }
      const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'createOrder', data: payload } });
      if (result.result && result.result.success) {
        const data = result.result.data
        if (data && typeof data === 'object') {
          const on = String(data.orderNumber || '').trim()
          const no = String(data.orderNo || '').trim()
          if (on && no && on !== no) {
            data.orderNo = on
          }
        }
        return handleSuccess(data, '订单创建成功');
      }
      throw new Error((result.result && result.result.message) || '订单创建失败');
    } catch (error) {
      const rawMessage = (error && (error.message || error.errMsg || error.err_msg)) || error || ''
      const msgLower = String(rawMessage).toLowerCase()
      const codeText = error && error.errCode != null ? String(error.errCode) : ''
      const isMissing =
        msgLower.includes('database_collection_not_exist') ||
        msgLower.includes('collection not exist') ||
        msgLower.includes('collection.get:fail') ||
        codeText === '-502005'
      if (!isMissing) {
        return handleError(error, '订单创建失败')
      }
      // 集合缺失时才尝试写入临时集合
      try {
        const isMeaningfulText = (v) => {
          const s = String(v ?? '').trim()
          if (!s) return false
          return !['-', '—', '--', '---', '暂无', '无'].includes(s)
        }
        const orderType = String(params?.orderType || '').toLowerCase()
        const source = String(params?.source || '').toLowerCase()
        const purchaseCategory = String(params?.purchaseCategory || '').trim()
        const supplierName = String(params?.supplierName || '').trim()
        const customerName = String(params?.customerName || '').trim()
        const productText =
          (isMeaningfulText(params?.productName) && String(params.productName).trim()) ||
          (isMeaningfulText(params?.productTitle) && String(params.productTitle).trim()) ||
          (isMeaningfulText(params?.goodsName) && String(params.goodsName).trim()) ||
          ''
        const isPurchaseFlag =
          params?.isPurchase === true ||
          String(params?.isPurchase || '').toLowerCase() === 'true' ||
          String(params?.channel || '').toLowerCase() === 'purchase'
        const isPurchase =
          orderType === 'purchase' ||
          source === 'purchased' ||
          Boolean(purchaseCategory) ||
          isPurchaseFlag
        const normalizedItems = normalizeOrderItemsForCreate(params)
        const qtyFromItems = normalizedItems.reduce((s, it) => s + Number(it.quantity || 0), 0)
        const qtyFromParam = Number(params?.quantity)
        const qty = normalizedItems.length ? qtyFromItems : qtyFromParam
        if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须大于0')

        const unitPrice = Number(params?.unitPrice ?? params?.price ?? 0)
        const totalAmount2 =
          params?.totalAmount != null
            ? Number(params.totalAmount)
            : params?.amount != null
              ? Number(params.amount)
              : Math.max(0, unitPrice * qty)
        const items2 = normalizedItems.length ? normalizedItems : [{
          name: productText,
          quantity: qty,
          unitPrice,
          price: unitPrice,
          amount: totalAmount2,
          totalPrice: totalAmount2
        }]
        const statusRaw = String(params?.status || '').trim()
        const statusNormalized = (() => {
          const raw = String(statusRaw || '').trim()
          const lower = raw.toLowerCase()
          if (!raw) return 'ordered'
          if (raw === '已下单' || lower === 'ordered' || lower === 'created') return 'ordered'
          if (raw === '待生产' || lower === 'pending' || lower === 'waiting' || lower === 'planned' || lower === 'to_produce' || lower === 'prepare') return 'pending'
          if (raw === '生产中' || lower === 'processing' || lower === 'in_progress' || lower === 'producing') return 'processing'
          if (raw === '已入库' || lower === 'stocked' || lower === 'warehoused' || lower === 'warehouse') return 'stocked'
          if (raw === '已发货' || lower === 'shipping' || lower === 'shipped' || lower === 'delivered') return 'shipping'
          if (raw === '已完成' || lower === 'completed' || lower === 'done') return 'completed'
          return raw
        })()
        const payload2 = {
          _id: `tmp_${Date.now()}`,
          orderNumber: params.orderNo || params.orderNumber || '',
          orderNo: params.orderNo || params.orderNumber || '',
          customerId: params.customerId,
          customerName: customerName || params.customerName,
          orderType: params.orderType || (isPurchase ? 'purchase' : 'production'),
          source: params.source || (isPurchase ? 'purchased' : 'pc'),
          purchaseCategory: params.purchaseCategory || (isPurchase ? 'goods' : ''),
          supplierName: supplierName || params.supplierName || '',
          productTitle: params.productTitle || params.goodsName || undefined,
          goodsName: params.goodsName || params.productTitle || undefined,
          materialNo: params.materialNo,
          productName: params.productName || params.productTitle || params.goodsName || undefined,
          quantity: qty,
          totalAmount: totalAmount2,
          items: items2,
          status: statusNormalized,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        if (!productText) throw new Error('产品不能为空')
        if (!isMeaningfulText(customerName) && !isMeaningfulText(supplierName)) throw new Error('客户/供应商不能为空')
        const created = await cloudAdapter.create('orders_tmp', payload2);
        return handleSuccess({ ...created.data, tmp: true }, '订单创建成功(临时集合)');
      } catch (_) {
        return handleError(_, '订单创建失败');
      }
    }
  } else if (method === 'PUT') {
    if (id && String(id).startsWith('tmp_')) {
      try {
        const updated = await cloudAdapter.update('orders_tmp', id, { ...params, id })
        return handleSuccess(updated.data, '订单更新成功(临时集合)')
      } catch (e) {
        return handleError(e, '订单更新失败')
      }
    }
    const orderType = String(params?.orderType || '').toLowerCase();
    const source = String(params?.source || '').toLowerCase();
    const isPurchase = orderType === 'purchase' || source === 'purchased' || (params && params.purchaseCategory != null && String(params.purchaseCategory) !== '');
    const action = isPurchase ? 'updatePurchaseOrder' : 'updateOrder';
    const result = await cloud.callFunction({ name: 'erp-api', data: { action, data: { id, ...params } } });
    if (result.result && result.result.success) {
      return handleSuccess(result.result.data, '订单更新成功');
    }
    throw new Error((result.result && result.result.message) || '订单更新失败');
  } else if (method === 'DELETE') {
    const id2 = id || params.id;
    if (!id2) {
      return handleError(new Error('缺少订单ID'), '订单删除失败');
    }
    const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {};
    const actorUserId = String(tokenPayload.userId || '').trim();
    if (!actorUserId) {
      const err = new Error('未授权访问');
      err.statusCode = 401;
      throw err;
    }
    if (String(id2).startsWith('tmp_')) {
      try {
        const now = Date.now()
        await db.collection('orders_tmp').doc(String(id2)).remove()
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'delete_order',
          method,
          path: String(global.__lastPath || ''),
          actorUserId,
          actorUsername: tokenPayload.username || '',
          detail: { orderId: id2, tmp: true }
        });
        return handleSuccess({ _id: id2, deleted: true, hardDeleted: true, tmp: true }, '订单删除成功');
      } catch (e) {
        return handleError(e, '订单删除失败')
      }
    }
    try {
      const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'deleteOrder', data: { id: id2 } } });
      if (result.result && result.result.success) {
        const now = Date.now();
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'delete_order',
          method,
          path: String(global.__lastPath || ''),
          actorUserId,
          actorUsername: tokenPayload.username || '',
          detail: { orderId: id2 }
        });
        return handleSuccess(result.result.data || { deleted: true }, '订单删除成功');
      }
      throw new Error((result.result && result.result.message) || '订单删除失败');
    } catch (_) {
      try {
        const result2 = await cloud.callFunction({ name: 'erp-api', data: { action: 'deletePurchaseOrder', data: { id: id2 } } });
        if (result2.result && result2.result.success) {
          const now = Date.now();
          await safeWriteLog('operation_logs', {
            ts: now,
            action: 'delete_order',
            method,
            path: String(global.__lastPath || ''),
            actorUserId,
            actorUsername: tokenPayload.username || '',
            detail: { orderId: id2, purchaseFallback: true }
          });
          return handleSuccess(result2.result.data || { deleted: true, hardDeleted: true }, '订单删除成功');
        }
        throw new Error((result2.result && result2.result.message) || '订单删除失败');
      } catch (error2) {
        try {
          const now = Date.now();
          await db.collection('purchase_orders').doc(id2).remove()
          await safeWriteLog('operation_logs', {
            ts: now,
            action: 'delete_order',
            method,
            path: String(global.__lastPath || ''),
            actorUserId: tokenPayload.userId || '',
            actorUsername: tokenPayload.username || '',
            detail: { orderId: id2, purchaseOrdersCollectionFallback: true }
          });
          return handleSuccess({ deleted: true, hardDeleted: true }, '订单删除成功');
        } catch (error3) {
          return handleError(error3, '订单删除失败');
        }
      }
    }
  }

  throw new Error('不支持的HTTP方法');
}

// 订单列表
async function handleOrdersList(method, params) {
  const t0 = Date.now()
  const orderType = String(params?.orderType || '').toLowerCase();
  const source = String(params?.source || '').toLowerCase();
  const isPurchase = orderType === 'purchase' || source === 'purchased' || (params && params.purchaseCategory != null && String(params.purchaseCategory) !== '');
  const wantDebug = String(params?.debug || '').toLowerCase() === '1' || String(params?.debug || '').toLowerCase() === 'true';

  if (isPurchase) {
    const buildPurchaseListFallback = async () => {
      const page = Number(params?.page || 1) || 1;
      const limit = Number(params?.pageSize || params?.limit || 10) || 10;
      const skip = (page - 1) * limit;
      const take = skip + limit;

      const toMs = (v) => {
        if (v == null || v === '') return null;
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
        const t = Date.parse(String(v));
        return Number.isFinite(t) ? t : null;
      };

      let dateRange = (params && typeof params.dateRange === 'object' && params.dateRange) ? params.dateRange : undefined;
      if (!dateRange) {
        const start = toMs(params?.startDate);
        const end = toMs(params?.endDate);
        if (start != null || end != null) {
          dateRange = { start: start != null ? start : 0, end: end != null ? end : Date.now() };
        }
      }
      const category = params?.purchaseCategory || params?.category;

      const buildQuery = (collectionName) => {
        let query = db.collection(collectionName);
        query = query.where(
          _.or([
            { isDeleted: _.neq(true) },
            { isDeleted: _.exists(false) }
          ])
        );
        if (collectionName === 'orders') {
          query = query.where(
            _.or([
              { orderType: 'purchase' },
              { source: 'purchased' }
            ])
          );
        }
        if (category) {
          if (category === 'goods') {
            query = query.where(
              _.or([
                { purchaseCategory: 'goods' },
                { category: 'goods' },
                { purchaseCategory: _.exists(false) },
                { category: _.exists(false) },
                { purchaseCategory: null },
                { category: null },
                { purchaseCategory: '' }
              ])
            );
          } else {
            query = query.where(
              _.or([
                { purchaseCategory: category },
                { category: category }
              ])
            );
          }
        }
        if (params?.status) query = query.where({ status: params.status });
        if (params?.supplierId) query = query.where({ supplierId: params.supplierId });
        if (dateRange && dateRange.start && dateRange.end) {
          query = query.where({ createdAt: _.gte(dateRange.start).and(_.lte(dateRange.end)) });
        }
        return query;
      };

      const [ordersRes, legacyRes, ordersCount, legacyCount] = await Promise.all([
        buildQuery('orders').orderBy('createdAt', 'desc').limit(take).get().catch(() => ({ data: [] })),
        buildQuery('purchase_orders').orderBy('createdAt', 'desc').limit(take).get().catch(() => ({ data: [] })),
        buildQuery('orders').count().catch(() => ({ total: 0 })),
        buildQuery('purchase_orders').count().catch(() => ({ total: 0 }))
      ]);

      const ordersRows = (ordersRes.data || []).map(o => (o ? { ...o, __src: 'orders' } : o));
      const legacyRows = (legacyRes.data || []).map(o => (o ? { ...o, __src: 'purchase_orders' } : o));
      const mergedAll = [...ordersRows, ...legacyRows];

      const toTs = (v) => (typeof v === 'number' ? v : (Date.parse(v) || 0));
      const uniq = new Map();
      for (const o of mergedAll) {
        if (!o) continue;
        const docId = o._id || o.id || '';
        const primaryNo = o.orderNo || o.orderNumber || '';
        const k = docId
          ? `${String(o.__src || 'unknown')}:${String(docId)}`
          : (primaryNo ? `no:${String(primaryNo)}` : '');
        if (!k) continue;
        if (!uniq.has(k)) uniq.set(k, o);
      }
      const mergedSorted = Array.from(uniq.values()).sort((a, b) => {
        const av = toTs(a.createdAt || a._createTime || a.createTime || a.updatedAt || a.updateTime);
        const bv = toTs(b.createdAt || b._createTime || b.createTime || b.updatedAt || b.updateTime);
        return bv - av;
      });

      const pageRows = mergedSorted.slice(skip, skip + limit).map((o) => {
        if (!o) return o;
        const { __src, ...rest } = o;
        return rest;
      });

      const total = Math.max(Number((ordersCount && ordersCount.total) || 0) + Number((legacyCount && legacyCount.total) || 0), mergedSorted.length);
      return {
        orders: pageRows,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil((total || 1) / limit),
          hasMore: skip + pageRows.length < total
        },
        ...(wantDebug ? { debug: { fallback: true, counts: { orders: Number((ordersCount && ordersCount.total) || 0), purchase_orders: Number((legacyCount && legacyCount.total) || 0) } } } : {})
      };
    };

    try {
      const page = Number(params?.page || 1) || 1;
      const limit = Number(params?.pageSize || params?.limit || 10) || 10;
      const toMs = (v) => {
        if (v == null || v === '') return null
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) return n
        const t = Date.parse(String(v))
        return Number.isFinite(t) ? t : null
      }
      let dateRange = (params && typeof params.dateRange === 'object' && params.dateRange) ? params.dateRange : undefined;
      if (!dateRange) {
        const start = toMs(params?.startDate)
        const end = toMs(params?.endDate)
        if (start != null || end != null) {
          dateRange = { start: start != null ? start : 0, end: end != null ? end : Date.now() }
        }
      }
      const category = params?.purchaseCategory || params?.category;
      const cf = await cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getPurchaseOrders',
          params: {
            page,
            limit,
            status: params?.status || undefined,
            supplierId: params?.supplierId || undefined,
            dateRange,
            category: category || undefined
          }
        }
      });
      const payload = cf && cf.result ? cf.result : cf;
      if (payload && payload.success === true) {
        const list = Array.isArray(payload.data) ? payload.data : [];
        const pagination = payload.pagination || payload?.data?.pagination || {
          page,
          limit,
          total: list.length,
          pages: Math.ceil(((list.length || 1)) / limit),
          hasMore: list.length >= limit
        };
        const dt = Date.now() - t0
        if (dt > 800) console.warn('[handleOrdersList] slow purchase list', { ms: dt, page, limit })
        return handleSuccess({ orders: list, pagination, ...(wantDebug ? { debug: payload.debug || { cf: true } } : {}) }, '获取采购订单列表成功');
      }
    } catch (_) {
      const out = await buildPurchaseListFallback();
      const dt = Date.now() - t0
      if (dt > 800) console.warn('[handleOrdersList] slow purchase fallback', { ms: dt })
      return handleSuccess(out, '获取采购订单列表成功');
    }
  }

  try {
    const result = await cloudAdapter.executeQuery('orders', params);
    const list = Array.isArray(result.data) ? result.data : [];
    const pagination = result?.pagination || result?.data?.pagination || {};
    const mapped = list.map((x) => normalizeOrderDetailForBrief(x));
    const dt = Date.now() - t0
    if (dt > 800) console.warn('[handleOrdersList] slow orders list', { ms: dt, page: pagination?.page, limit: pagination?.limit, total: pagination?.total })
    return handleSuccess({ orders: mapped, pagination, ...(wantDebug ? { debug: result.debug || { adapter: true } } : {}) }, '获取订单列表成功');
  } catch (e) {
    console.error('[handleOrdersList] orders query failed', e && (e.errMsg || e.message || e));
  }
  const dt = Date.now() - t0
  if (dt > 800) console.warn('[handleOrdersList] slow orders empty', { ms: dt })
  return handleSuccess({ orders: [], pagination: {} }, '获取订单列表成功');
}

// 采购处理 - 独立数据体系
async function handlePurchases(method, params, user) {
  const path = global.__lastPath || ''
  const idMatch = path.match(/\/purchases\/([^\/?#]+)/)
  const id = params.id || (idMatch ? idMatch[1] : '')
  if (method === 'GET') {
    if (id) {
      const result = await cloudAdapter.executeQuery('purchase_orders', { id })
      const list = Array.isArray(result.data) ? result.data : []
      const one = list.find(x => String(x._id || x.id) === String(id)) || null
      return handleSuccess(one, '获取采购订单详情成功')
    }
    return await handlePurchasesList(method, params)
  } else if (method === 'POST') {
    try {
      const isMeaningfulText = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return false
        return !['-', '—', '--', '---', '暂无', '无'].includes(s)
      }
      const supplierName = String(params?.supplierName || '').trim()
      if (!isMeaningfulText(supplierName)) throw new Error('供应商不能为空')
      const goodsText =
        (isMeaningfulText(params?.goodsName) && String(params.goodsName).trim()) ||
        (isMeaningfulText(params?.productTitle) && String(params.productTitle).trim()) ||
        (isMeaningfulText(params?.productName) && String(params.productName).trim()) ||
        ''
      if (!goodsText) throw new Error('商品名称不能为空')

      const rawItems = Array.isArray(params?.items) ? params.items : []
      const normalizedItems = rawItems
        .map((it) => ({ ...it, name: it?.name, quantity: Number(it?.quantity) }))
        .filter((it) => isMeaningfulText(it?.name) && Number.isFinite(Number(it?.quantity)) && Number(it.quantity) > 0)
      const qtyFromItems = normalizedItems.reduce((s, it) => s + Number(it.quantity || 0), 0)
      const qtyFromParam = Number(params?.quantity)
      const qty = normalizedItems.length ? qtyFromItems : qtyFromParam
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须大于0')

      const unitPrice = Number(params?.unitPrice ?? params?.price ?? 0)
      const amount =
        params?.totalAmount != null
          ? Number(params.totalAmount)
          : params?.amount != null
            ? Number(params.amount)
            : Math.max(0, unitPrice * qty)
      const totalAmount = Number.isFinite(amount) ? amount : 0

      const items = normalizedItems.length ? normalizedItems : [{
        name: goodsText,
        quantity: qty,
        unitPrice,
        price: unitPrice,
        amount: totalAmount,
        totalPrice: totalAmount
      }]
      const payload = {
        ...params,
        totalAmount,
        items,
        orderType: 'purchase',
        source: params.source || 'purchased',
        // 确保如果有 purchaseCategory 参数则使用，否则默认为 raw_materials
        purchaseCategory: params.purchaseCategory || 'raw_materials',
        quantity: qty,
        goodsName: params.goodsName || goodsText
      }
      const created = await cloudAdapter.create('purchase_orders', payload)
      return handleSuccess(created.data, '采购订单创建成功')
    } catch (error) {
      return handleError(error, '采购订单创建失败')
    }
  } else if (method === 'PUT') {
    const id2 = id || params.id
    const updated = await cloudAdapter.update('purchase_orders', id2, params)
    return handleSuccess(updated.data, '采购订单更新成功')
  } else if (method === 'DELETE') {
    const id2 = id || params.id
    const now = Date.now()
    await db.collection('purchase_orders').doc(id2).update({
      data: {
        isDeleted: true,
        deletedAt: now,
        deletedBy: (user && user.userId) ? String(user.userId) : 'anonymous',
        updatedAt: now,
        updatedBy: (user && user.userId) ? String(user.userId) : 'anonymous'
      }
    })
    return handleSuccess({ _id: id2, deleted: true, softDeleted: true }, '采购订单删除成功')
  }
  throw new Error('不支持的HTTP方法')
}

async function handlePurchasesList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('purchase_orders', params)
    const list = Array.isArray(result.data) ? result.data : []
    if (list.length) return handleSuccess(list, '获取采购订单列表成功')
  } catch (_) { /* ignore */ }
  // 采购独立体系，不进行本地后端回退
  return handleSuccess([], '获取采购订单列表成功')
}

async function handlePurchasesStats(method, params) {
  const result = await cloudAdapter.getStats('purchase_orders', params)
  return handleSuccess(result.data, '获取采购订单统计成功')
}

// 订单统计
async function handleOrdersStats(method, params) {
  const result = await cloudAdapter.getStats('orders', params);
  return handleSuccess(result.data, '获取订单统计成功');
}

// 工单处理 - 重定向到production集合以兼容PC端
async function handleWorkOrders(method, params) {
  if (method === 'GET') {
    return await handleProductionList(method, params);
  } else if (method === 'POST') {
    const result = await cloudAdapter.create('production', params);
    return handleSuccess(result.data, '工单创建成功');
  }

  throw new Error('不支持的HTTP方法');
}

// 工单列表 - 重定向到production集合以兼容PC端
async function handleWorkOrdersList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('production', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取工单列表成功');
  } catch (_) { /* ignore */ }
  return handleSuccess([], '获取工单列表成功');
}

// 工单统计 - 重定向到production集合以兼容PC端
async function handleWorkOrdersStats(method, params) {
  const result = await cloudAdapter.getStats('production', params);
  return handleSuccess(result.data, '获取工单统计成功');
}

async function handleProduction(method, params, user) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/production\/([^/?#]+)/);
  const id = params.id || params._id || params.planId || (idMatch ? idMatch[1] : '');
  const operator = user && user.username ? user.username : (user && user.userId ? user.userId : 'unknown');

  if (method === 'GET') {
    return await handleProductionList(method, params);
  } else if (method === 'POST') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'createProductionPlan', data: { ...params, operator } }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '生产计划创建成功');
      }
      throw new Error((result.result && result.result.message) || '生产计划创建失败');
    } catch (error) {
      return handleError(error, '生产计划创建失败');
    }
  } else if (method === 'PUT') {
    if (!id) throw new Error('缺少生产计划ID');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateProductionStatus', data: { ...params, id, operator } }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '生产状态更新成功');
      }
      throw new Error((result.result && result.result.message) || '生产状态更新失败');
    } catch (error) {
      return handleError(error, '生产状态更新失败');
    }
  }
  throw new Error('不支持的HTTP方法');
}

async function handleProductionList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('production', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取生产列表成功');
  } catch (_) { }
  return handleSuccess([], '获取生产列表成功');
}

async function handleProductionStats(method, params) {
  const result = await cloudAdapter.getStats('production', params);
  return handleSuccess(result.data, '获取生产统计成功');
}

// 客户处理
async function handleCustomers(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/customers\/([^/?#]+)/);
  const id = params.customerId || params.id || params._id || params.docId || (idMatch ? idMatch[1] : '');
  if (method === 'GET') {
    if (id) {
      const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'getCustomerById', data: { customerId: id } } });
      return handleSuccess(result.result.data, '获取客户详情成功');
    }
    return await handleCustomersList(method, params);
  } else if (method === 'POST') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'createCustomer', data: params }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '客户创建成功');
      }
      throw new Error((result.result && result.result.message) || '客户创建失败');
    } catch (error) {
      return handleError(error, '客户创建失败');
    }
  } else if (method === 'PUT') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateCustomer', data: { customerId: id, customer: params } }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '客户更新成功');
      }
      throw new Error((result.result && result.result.message) || '客户更新失败');
    } catch (error) {
      return handleError(error, '客户更新失败');
    }
  } else if (method === 'DELETE') {
    const tokenPayload = requireAdminFromEvent(global.__lastEvent || {});
    try {
      const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'deleteCustomer', data: { id } } });
      if (result.result && result.result.success) {
        const now = Date.now();
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'delete_customer',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: tokenPayload.userId || '',
          actorUsername: tokenPayload.username || '',
          detail: { customerId: id }
        });
        return handleSuccess({ _id: id, deleted: true }, '客户删除成功');
      }
      throw new Error((result.result && result.result.message) || '客户删除失败');
    } catch (error) {
      return handleError(error, '客户删除失败');
    }
  }
  throw new Error('不支持的HTTP方法');
}

async function handleCustomerSkus(method, params, user) {
  const collectionName = String(process.env.ERP_CUSTOMER_SKU_COLLECTION || 'customer_skus').trim() || 'customer_skus';
  const customerCollectionName = String(process.env.ERP_CUSTOMER_COLLECTION || 'customers').trim() || 'customers';
  const path = String(global.__lastPath || '');
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {};
  const normalizeText = (v) => String(v == null ? '' : v).trim();
  const uniq = (arr) => Array.from(new Set((arr || []).map((x) => normalizeText(x)).filter(Boolean)));
  const normalizeJoinMethod = (raw) => {
    const s = normalizeText(raw)
    if (!s) return ''
    const key = s.toLowerCase()
    if (key.includes('不用')) return ''
    if (key.includes('钉') || key.includes('订')) return '打钉'
    if (key.includes('粘') || key.includes('胶')) return '粘胶'
    if (s === '打钉' || s === '粘胶') return s
    return s
  }
  const normalizeNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const pruneUndefined = (obj) => {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v !== undefined) out[k] = v;
    });
    return out;
  };
  const normalizeSku = (doc) => {
    if (!doc || typeof doc !== 'object') return null;
    const rawId = doc._id != null ? String(doc._id) : (doc.id != null ? String(doc.id) : '');
    const id = rawId.trim();
    return { ...doc, _id: id || doc._id, id: id || doc._id };
  };
  const resolveCustomerId = () => {
    const match = path.match(/\/customers\/([^/?#]+)\/skus/);
    const raw = params?.customerId || params?.id || (match ? match[1] : '');
    return normalizeText(raw);
  };
  const resolveSkuId = () => {
    const match = path.match(/\/customers\/[^/?#]+\/skus\/([^/?#]+)/);
    const raw = params?.skuId || params?.docId || params?._id || params?.id || (match ? match[1] : '');
    return normalizeText(raw);
  };
  const customerId = resolveCustomerId();
  if (!customerId) throw new Error('缺少客户ID');
  await ensureCollectionExists(collectionName);
  await ensureCollectionExists(customerCollectionName);
  const collection = db.collection(collectionName);
  let customerDoc = null;
  try {
    const gotCustomer = await db.collection(customerCollectionName).doc(customerId).get();
    customerDoc = gotCustomer && gotCustomer.data
      ? (Array.isArray(gotCustomer.data) ? (gotCustomer.data[0] || null) : gotCustomer.data)
      : null;
  } catch (_) {
    customerDoc = null;
  }
  const customerIdCandidates = uniq([
    customerId,
    customerDoc?._id,
    customerDoc?.customerCode,
    customerDoc?.code,
    customerDoc?.shortName,
    customerDoc?.companyName,
    customerDoc?.name,
    customerDoc?.wechatCustomerId,
    customerDoc?.wechatOpenId
  ]);

  const keyword = normalizeText(params?.keyword || params?.search || params?.q || '');
  const page = Math.max(1, Number(params?.page || 1) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(params?.pageSize || params?.limit || 10) || 10));

  const createHttpError = (statusCode, message) => {
    const err = new Error(String(message || '请求错误'));
    err.statusCode = statusCode;
    return err;
  };

  const round4 = (n) => Math.round(Number(n) * 10000) / 10000;
  const computeSkuRawMaterialCost = (sku) => {
    const mode = normalizeText(sku?.productionMode || '');
    if (mode === 'outsourced') return undefined;
    const bw = Number(sku?.boardWidth);
    const bh = Number(sku?.boardHeight);
    const price = Number(sku?.materialPricePerSqm ?? sku?.pricePerSqm);
    if (!Number.isFinite(bw) || !Number.isFinite(bh) || !Number.isFinite(price)) return undefined;
    const sqm = ((bw + 20) * bh) / 1000000;
    return Number.isFinite(sqm) ? round4(sqm * price) : undefined;
  };
  const computeSkuProfit = (unitPriceArg, rawMaterialCostArg) => {
    const unitPrice = Number(unitPriceArg);
    const rawMaterialCost = Number(rawMaterialCostArg);
    if (!Number.isFinite(unitPrice) || !Number.isFinite(rawMaterialCost)) return undefined;
    return round4(unitPrice - rawMaterialCost);
  };

  const skuIds = Array.isArray(params?.skuIds) ? params.skuIds.map((x) => normalizeText(x)).filter(Boolean) : [];
  const supplierId = normalizeText(params?.supplierId);
  const materialCode = normalizeText(params?.materialCode);
  const flute = normalizeText(params?.flute);
  const outsourcedMaterialId = normalizeText(
    params?.outsourcedMaterialId ||
    params?.outsourced_material_id ||
    params?.rawMaterialId ||
    params?.raw_material_id
  )
  const materialPricePerSqm =
    params?.materialPricePerSqm != null && params.materialPricePerSqm !== ''
      ? normalizeNumber(params.materialPricePerSqm)
      : (params?.pricePerSqm != null && params.pricePerSqm !== '' ? normalizeNumber(params.pricePerSqm) : undefined);
  const isOutsourcedMode = Boolean(outsourcedMaterialId)
  const looksLikeBatchSetMaterial =
    skuIds.length > 0 &&
    Boolean(supplierId) &&
    (
      (Boolean(materialCode) && Boolean(flute) && Number.isFinite(Number(materialPricePerSqm)) && Number(materialPricePerSqm) > 0) ||
      isOutsourcedMode
    );

  if (method === 'POST' && (path.includes('/skus/batch/material') || looksLikeBatchSetMaterial)) {
    if (!skuIds.length) throw createHttpError(400, 'skuIds不能为空');
    if (!supplierId) throw createHttpError(400, 'supplierId不能为空');
    if (!isOutsourcedMode) {
      if (!materialCode) throw createHttpError(400, 'materialCode不能为空');
      if (!flute) throw createHttpError(400, 'flute不能为空');
      if (!Number.isFinite(Number(materialPricePerSqm)) || Number(materialPricePerSqm) <= 0) {
        throw createHttpError(400, 'materialPricePerSqm无效');
      }
    } else {
      if (!outsourcedMaterialId) throw createHttpError(400, 'outsourcedMaterialId不能为空');
    }

    await ensureCollectionExists('suppliers');
    let supplierName = '';
    try {
      const gotSupplier = await db.collection('suppliers').doc(supplierId).get();
      const supplierRow = gotSupplier && gotSupplier.data
        ? (Array.isArray(gotSupplier.data) ? (gotSupplier.data[0] || null) : gotSupplier.data)
        : null;
      supplierName = normalizeText(supplierRow?.name || supplierRow?.companyName || supplierRow?.title || '');
    } catch (_) {
      supplierName = '';
    }
    if (!supplierName) throw createHttpError(400, '供应商不存在或无名称');

    const failed = [];
    let updatedCount = 0;
    const nowIso = new Date().toISOString();
    const nowTs = Date.now();
    let outsourcedMaterial = null
    if (isOutsourcedMode) {
      const outsourcedCollectionNameRaw =
        process.env.CLOUDBASE_OUTSOURCED_MATERIAL_COLLECTION ||
        process.env.OUTSOURCED_MATERIAL_COLLECTION ||
        'outsourced_materials'
      const outsourcedCollectionName = String(outsourcedCollectionNameRaw || '').trim() || 'outsourced_materials'
      await ensureCollectionExists(outsourcedCollectionName)
      let raw = null
      try {
        const gotMaterial = await db.collection(outsourcedCollectionName).doc(outsourcedMaterialId).get()
        raw = gotMaterial && gotMaterial.data
          ? (Array.isArray(gotMaterial.data) ? (gotMaterial.data[0] || null) : gotMaterial.data)
          : null
      } catch (_) {
        raw = null
      }
      const foundSupplierId = normalizeText(raw?.supplierId || raw?.supplier_id)
      const name = normalizeText(raw?.name ?? raw?.rawMaterialName ?? raw?.materialName ?? raw?.title)
      if (!raw || !name || !foundSupplierId || foundSupplierId !== supplierId) {
        throw createHttpError(400, '外购材料不存在或不属于该供应商')
      }
      const unitPrice = raw?.unitPrice != null && raw?.unitPrice !== '' ? normalizeNumber(raw.unitPrice) : (raw?.price != null && raw?.price !== '' ? normalizeNumber(raw.price) : undefined)
      outsourcedMaterial = {
        id: outsourcedMaterialId,
        name,
        specification: normalizeText(raw?.specification ?? raw?.spec ?? raw?.size),
        unit: normalizeText(raw?.unit ?? raw?.uom),
        unitPrice: unitPrice != null && Number.isFinite(Number(unitPrice)) && Number(unitPrice) >= 0 ? Number(unitPrice) : 0
      }
    }

    for (const skuId of skuIds) {
      let got = null;
      try {
        got = await collection.doc(skuId).get();
      } catch (e) {
        failed.push({ skuId, message: String(e?.message || e?.errMsg || e || '读取失败') });
        continue;
      }
      const existing = got && got.data ? (Array.isArray(got.data) ? (got.data[0] || null) : got.data) : null;
      if (!existing) {
        failed.push({ skuId, message: 'SKU不存在' });
        continue;
      }
      const existingCustomerKey = normalizeText(existing.customerId ?? existing.customer_id ?? existing.customer?.id);
      if (existingCustomerKey && !customerIdCandidates.includes(existingCustomerKey)) {
        failed.push({ skuId, message: 'SKU不属于该客户' });
        continue;
      }
      const skuName = normalizeText(existing?.name || existing?.goodsName || existing?.productName);
      if (!skuName) {
        failed.push({ skuId, message: '商品名称不能为空，请先补全SKU名称' });
        continue;
      }

      const basePatch = {
        customerId: normalizeText(existing.customerId) ? undefined : customerId,
        supplierId,
        supplierName,
        supplier_id: supplierId,
        supplier_name: supplierName,
        supplier: { id: supplierId, name: supplierName },
        updatedAt: nowIso,
        _updateTime: nowTs
      }

      const patch = pruneUndefined(basePatch)
      if (isOutsourcedMode) {
        const mode = normalizeText(existing?.productionMode || existing?.production_mode)
        if (mode !== 'outsourced') {
          failed.push({ skuId, message: '该SKU非外购模式，无法批量设置外购材料' })
          continue
        }
        patch.productionMode = 'outsourced'
        patch.materialNo = outsourcedMaterial?.name || ''
        patch.specification = outsourcedMaterial?.specification
        patch.unit = outsourcedMaterial?.unit || ''
        patch.rawMaterialCost = outsourcedMaterial?.unitPrice
        patch.raw_material_cost = patch.rawMaterialCost
        patch.materialCode = ''
        patch.flute = ''
        patch.materialPricePerSqm = null
        patch.pricePerSqm = null
        const nextProfit = computeSkuProfit(existing?.unitPrice, patch.rawMaterialCost)
        if (nextProfit !== undefined) patch.profit = nextProfit
      } else {
        patch.materialCode = materialCode
        patch.flute = flute
        patch.materialPricePerSqm = Number(materialPricePerSqm)
        patch.pricePerSqm = Number(materialPricePerSqm)
        const merged = { ...(existing || {}), ...(patch || {}) };
        const nextCost = computeSkuRawMaterialCost(merged);
        if (nextCost !== undefined) patch.rawMaterialCost = nextCost;
        const nextProfit = computeSkuProfit(merged.unitPrice, patch.rawMaterialCost !== undefined ? patch.rawMaterialCost : merged.rawMaterialCost);
        if (nextProfit !== undefined) patch.profit = nextProfit;
      }

      try {
        await collection.doc(skuId).update({ data: patch });
        updatedCount += 1;
      } catch (e) {
        failed.push({ skuId, message: String(e?.message || e?.errMsg || e || '写入失败') });
      }
    }

    return handleSuccess({ updatedCount, failed }, '批量设置材质完成');
  }

  if (method === 'GET') {
    const skuId = resolveSkuId();
    if (skuId && /\/skus\/[^/?#]+/.test(path)) {
      const got = await collection.doc(skuId).get();
      const row = got && got.data ? (Array.isArray(got.data) ? (got.data[0] || null) : got.data) : null;
      if (!row) throw new Error('SKU不存在');
      const rowCustomerKey = normalizeText(row.customerId ?? row.customer_id ?? row.customer?.id);
      if (rowCustomerKey && !customerIdCandidates.includes(rowCustomerKey)) throw new Error('SKU不属于该客户');
      return handleSuccess({ sku: normalizeSku(row) }, '获取SKU成功');
    }

    let whereField = 'customerId';
    const buildWhere = (field) => ({ [field]: _.in(customerIdCandidates) });
    const offset = (page - 1) * pageSize;
    let where = buildWhere(whereField);

    if (keyword) {
      const kw = keyword;
      const scanMax = 2000;
      const batchSize = 500;
      const all = [];
      let skip = 0;
      while (all.length < scanMax) {
        const take = Math.min(batchSize, scanMax - all.length);
        let res = null;
        try {
          res = await collection.where(where).orderBy('_updateTime', 'desc').skip(skip).limit(take).get();
        } catch (_) {
          try {
            res = await collection.where(where).orderBy('updatedAt', 'desc').skip(skip).limit(take).get();
          } catch (_) {
            res = await collection.where(where).skip(skip).limit(take).get();
          }
        }
        let batch = Array.isArray(res && res.data) ? res.data : [];
        if (!batch.length && skip === 0 && whereField === 'customerId') {
          whereField = 'customer_id';
          where = buildWhere(whereField);
          try {
            res = await collection.where(where).orderBy('_updateTime', 'desc').skip(skip).limit(take).get();
          } catch (_) {
            try {
              res = await collection.where(where).orderBy('updatedAt', 'desc').skip(skip).limit(take).get();
            } catch (_) {
              res = await collection.where(where).skip(skip).limit(take).get();
            }
          }
          batch = Array.isArray(res && res.data) ? res.data : [];
        }
        if (!batch.length) break;
        all.push(...batch);
        if (batch.length < take) break;
        skip += take;
      }

      const filtered = all
        .map(normalizeSku)
        .filter(Boolean)
        .filter((it) => {
          const text = JSON.stringify({
            category: it.category,
            materialNo: it.materialNo,
            name: it.name,
            specification: it.specification,
            materialCode: it.materialCode,
            flute: it.flute,
            supplierName: it.supplierName,
            unit: it.unit,
            productionMode: it.productionMode,
            joinMethod: it.joinMethod || it.join_method
          });
          return text.includes(kw);
        });
      const total = filtered.length;
      const pageList = filtered.slice(offset, offset + pageSize);
      return handleSuccess(
        {
          skus: pageList,
          pagination: { page, pageSize, total, totalPages: total > 0 ? Math.ceil(total / pageSize) : 0 }
        },
        '获取客户SKU列表成功'
      );
    }

    let total = 0;
    try {
      const counted = await collection.where(where).count();
      total = Number(counted && counted.total != null ? counted.total : 0) || 0;
    } catch (_) {
      total = 0;
    }
    if (!total && whereField === 'customerId') {
      whereField = 'customer_id';
      where = buildWhere(whereField);
      try {
        const counted = await collection.where(where).count();
        total = Number(counted && counted.total != null ? counted.total : 0) || 0;
      } catch (_) {
        total = 0;
      }
    }

    let listRes = null;
    try {
      listRes = await collection.where(where).orderBy('_updateTime', 'desc').skip(offset).limit(pageSize).get();
    } catch (_) {
      try {
        listRes = await collection.where(where).orderBy('updatedAt', 'desc').skip(offset).limit(pageSize).get();
      } catch (_) {
        listRes = await collection.where(where).skip(offset).limit(pageSize).get();
      }
    }
    if ((!listRes || !Array.isArray(listRes.data) || !listRes.data.length) && whereField === 'customerId') {
      whereField = 'customer_id';
      where = buildWhere(whereField);
      try {
        listRes = await collection.where(where).orderBy('_updateTime', 'desc').skip(offset).limit(pageSize).get();
      } catch (_) {
        try {
          listRes = await collection.where(where).orderBy('updatedAt', 'desc').skip(offset).limit(pageSize).get();
        } catch (_) {
          listRes = await collection.where(where).skip(offset).limit(pageSize).get();
        }
      }
    }
    const list = Array.isArray(listRes && listRes.data) ? listRes.data : [];
    return handleSuccess(
      {
        skus: list.map(normalizeSku).filter(Boolean),
        pagination: { page, pageSize, total, totalPages: total > 0 ? Math.ceil(total / pageSize) : 0 }
      },
      '获取客户SKU列表成功'
    );
  }

  if (method === 'POST' && path.includes('/skus/import')) {
    const rows = Array.isArray(params?.rows) ? params.rows : [];
    if (!rows.length) throw new Error('导入数据不能为空');

    const nowIso = new Date().toISOString();
    const actor = normalizeText(tokenPayload.userId || user?.userId || '');
    const matchMode = normalizeText(params?.matchMode);
    const replaceExisting = matchMode === 'full';

    const toKeyNumber = (v) => {
      if (v === undefined || v === null || v === '') return '';
      const n = Number(v);
      if (!Number.isFinite(n)) return '';
      return String(Math.round(n * 10000) / 10000);
    };
    const buildSkuFullMatchKey = (input) => {
      const name = normalizeText(input?.name);
      const materialNo = normalizeText(input?.materialNo);
      const specification = normalizeText(input?.specification);
      const boardWidth = toKeyNumber(input?.boardWidth);
      const boardHeight = toKeyNumber(input?.boardHeight);
      const c1 = toKeyNumber(input?.creasingSize1);
      const c2 = toKeyNumber(input?.creasingSize2);
      const c3 = toKeyNumber(input?.creasingSize3);
      if (!name || !materialNo) return '';
      if (!specification || !boardWidth || !boardHeight || !c1 || !c2 || !c3) return '';
      return `name:${name}|materialNo:${materialNo}|spec:${specification}|bw:${boardWidth}|bh:${boardHeight}|c1:${c1}|c2:${c2}|c3:${c3}`;
    };

    const existingByKey = new Map();
    if (replaceExisting) {
      const all = [];
      let skip = 0;
      const take = 500;
      while (true) {
        let res = null;
        try {
          res = await collection.where({ customerId }).orderBy('_updateTime', 'desc').skip(skip).limit(take).get();
        } catch (_) {
          try {
            res = await collection.where({ customerId }).orderBy('updatedAt', 'desc').skip(skip).limit(take).get();
          } catch (_) {
            res = await collection.where({ customerId }).skip(skip).limit(take).get();
          }
        }
        const batch = Array.isArray(res && res.data) ? res.data : [];
        if (!batch.length) break;
        all.push(...batch);
        if (batch.length < take) break;
        skip += take;
        if (skip > 500 * 500) break;
      }
      all.forEach((doc) => {
        const normalized = normalizeSku(doc);
        if (!normalized) return;
        const key = buildSkuFullMatchKey(normalized);
        if (!key) return;
        const sid = normalizeText(normalized?.id || normalized?._id || '');
        if (!sid) return;
        if (!existingByKey.has(key)) existingByKey.set(key, sid);
      });
    }

    let successCount = 0;
    let createdCount = 0;
    let replacedCount = 0;
    let failedCount = 0;
    const failedRows = [];

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i] || {};
      const name = normalizeText(r.name || r.goodsName || r.productName);
      if (!name) {
        failedCount += 1;
        failedRows.push({ index: i + 1, reason: '商品名称不能为空' });
        continue;
      }
      const rawMode = normalizeText(r.productionMode);
      const productionMode = rawMode === 'outsourced' ? 'outsourced' : 'inhouse';
      const unit = normalizeText(r.unit);
      if (productionMode === 'outsourced' && !unit) {
        failedCount += 1;
        failedRows.push({ index: i + 1, reason: '单位不能为空' });
        continue;
      }
      const base = pruneUndefined({
        customerId,
        productionMode,
        unit,
        category: normalizeText(r.category),
        materialNo: normalizeText(r.materialNo),
        name,
        specification: normalizeText(r.specification || r.spec),
        materialCode: normalizeText(r.materialCode),
        flute: normalizeText(r.flute),
        joinMethod: normalizeJoinMethod(r.joinMethod ?? r.join_method),
        join_method: normalizeJoinMethod(r.joinMethod ?? r.join_method),
        boardWidth: r.boardWidth != null && r.boardWidth !== '' ? normalizeNumber(r.boardWidth) : undefined,
        boardHeight: r.boardHeight != null && r.boardHeight !== '' ? normalizeNumber(r.boardHeight) : undefined,
        creasingType: normalizeText(r.creasingType),
        creasingSize1: r.creasingSize1 != null && r.creasingSize1 !== '' ? normalizeNumber(r.creasingSize1) : undefined,
        creasingSize2: r.creasingSize2 != null && r.creasingSize2 !== '' ? normalizeNumber(r.creasingSize2) : undefined,
        creasingSize3: r.creasingSize3 != null && r.creasingSize3 !== '' ? normalizeNumber(r.creasingSize3) : undefined,
        sheetCount: r.sheetCount != null && r.sheetCount !== '' ? normalizeNumber(r.sheetCount) : undefined,
        unitPrice: r.unitPrice != null && r.unitPrice !== '' ? normalizeNumber(r.unitPrice) : undefined,
        supplierName: normalizeText(r.supplierName),
        source: 'pc'
      });
      try {
        if (replaceExisting) {
          const key = buildSkuFullMatchKey(base);
          const existingId = key ? existingByKey.get(key) : '';
          if (existingId) {
            const patch = pruneUndefined({
              ...base,
              updatedAt: nowIso,
              _updateTime: Date.now(),
              source: 'pc'
            });
            await collection.doc(existingId).update({ data: patch });
            successCount += 1;
            replacedCount += 1;
            continue;
          }
        }

        const doc = pruneUndefined({
          ...base,
          createdBy: actor,
          createdAt: nowIso,
          updatedAt: nowIso,
          _createTime: Date.now(),
          _updateTime: Date.now(),
          source: 'pc'
        });
        const created = await collection.add({ data: doc });
        const createdId = normalizeText(created && created.id != null ? created.id : '');
        if (replaceExisting) {
          const key = buildSkuFullMatchKey(base);
          if (key && createdId && !existingByKey.has(key)) existingByKey.set(key, createdId);
        }
        successCount += 1;
        createdCount += 1;
      } catch (e) {
        failedCount += 1;
        failedRows.push({ index: i + 1, reason: String(e && (e.message || e.errMsg || e) || '写入失败') });
      }
    }

    return handleSuccess({ successCount, createdCount, replacedCount, failedCount, failedRows }, '导入SKU完成');
  }

  if (method === 'POST') {
    const name = normalizeText(params?.name || params?.goodsName || params?.productName);
    if (!name) throw new Error('商品名称不能为空');
    const rawMode = normalizeText(params?.productionMode);
    const productionMode = rawMode === 'outsourced' ? 'outsourced' : 'inhouse';
    const unit = normalizeText(params?.unit);
    if (productionMode === 'outsourced' && !unit) throw new Error('单位不能为空');

    const now = Date.now();
    const nowIso = new Date().toISOString();
    const actor = normalizeText(tokenPayload.userId || user?.userId || '');
    const remarkValue = normalizeText(params?.remark || params?.remark_text || params?.note || params?.memo);
    const doc = pruneUndefined({
      customerId,
      productionMode,
      unit,
      category: normalizeText(params?.category),
      materialNo: normalizeText(params?.materialNo),
      name,
      specification: normalizeText(params?.specification || params?.spec),
      materialCode: normalizeText(params?.materialCode),
      flute: normalizeText(params?.flute),
      joinMethod: normalizeJoinMethod(params?.joinMethod ?? params?.join_method),
      join_method: normalizeJoinMethod(params?.joinMethod ?? params?.join_method),
      boardWidth: params?.boardWidth != null && params.boardWidth !== '' ? normalizeNumber(params.boardWidth) : undefined,
      boardHeight: params?.boardHeight != null && params.boardHeight !== '' ? normalizeNumber(params.boardHeight) : undefined,
      creasingType: normalizeText(params?.creasingType),
      creasingSize1: params?.creasingSize1 != null && params.creasingSize1 !== '' ? normalizeNumber(params.creasingSize1) : undefined,
      creasingSize2: params?.creasingSize2 != null && params.creasingSize2 !== '' ? normalizeNumber(params.creasingSize2) : undefined,
      creasingSize3: params?.creasingSize3 != null && params.creasingSize3 !== '' ? normalizeNumber(params.creasingSize3) : undefined,
      sheetCount: params?.sheetCount != null && params.sheetCount !== '' ? normalizeNumber(params.sheetCount) : undefined,
      unitPrice: params?.unitPrice != null && params.unitPrice !== '' ? normalizeNumber(params.unitPrice) : undefined,
      supplierName: normalizeText(params?.supplierName),
      remark: remarkValue,
      remark_text: remarkValue,
      note: remarkValue,
      memo: remarkValue,
      createdBy: actor,
      createdAt: nowIso,
      updatedAt: nowIso,
      _createTime: now,
      _updateTime: now,
      source: 'pc'
    });

    const created = await collection.add({ data: doc });
    const newId = normalizeText(created && (created._id || created.id || created.insertedId));
    return handleSuccess({ sku: normalizeSku({ ...doc, _id: newId || undefined, id: newId || undefined }) }, 'SKU创建成功');
  }

  if (method === 'PUT' || method === 'PATCH') {
    const skuId = resolveSkuId();
    if (!skuId) throw new Error('缺少SKU ID');

    const got = await collection.doc(skuId).get();
    const existing = got && got.data ? (Array.isArray(got.data) ? (got.data[0] || null) : got.data) : null;
    if (!existing) throw new Error('SKU不存在');
    const existingCustomerKey = normalizeText(existing.customerId ?? existing.customer_id ?? existing.customer?.id);
    if (existingCustomerKey && !customerIdCandidates.includes(existingCustomerKey)) throw new Error('SKU不属于该客户');

    const remarkUpdateRequested =
      params?.remark !== undefined ||
      params?.remark_text !== undefined ||
      params?.note !== undefined ||
      params?.memo !== undefined;
    const expectedRemark = remarkUpdateRequested
      ? normalizeText(params?.remark || params?.remark_text || params?.note || params?.memo)
      : '';

    const patch = pruneUndefined({
      productionMode: params?.productionMode !== undefined ? (normalizeText(params.productionMode) === 'outsourced' ? 'outsourced' : 'inhouse') : undefined,
      unit: params?.unit !== undefined ? normalizeText(params.unit) : undefined,
      category: params?.category !== undefined ? normalizeText(params.category) : undefined,
      materialNo: params?.materialNo !== undefined ? normalizeText(params.materialNo) : undefined,
      name: (params?.name !== undefined || params?.goodsName !== undefined || params?.productName !== undefined)
        ? normalizeText(params.name || params.goodsName || params.productName)
        : undefined,
      specification: (params?.specification !== undefined || params?.spec !== undefined) ? normalizeText(params.specification || params.spec) : undefined,
      materialCode: params?.materialCode !== undefined ? normalizeText(params.materialCode) : undefined,
      flute: params?.flute !== undefined ? normalizeText(params.flute) : undefined,
      joinMethod: (params?.joinMethod !== undefined || params?.join_method !== undefined)
        ? normalizeJoinMethod(params?.joinMethod ?? params?.join_method)
        : undefined,
      join_method: (params?.joinMethod !== undefined || params?.join_method !== undefined)
        ? normalizeJoinMethod(params?.joinMethod ?? params?.join_method)
        : undefined,
      remark: remarkUpdateRequested ? expectedRemark : undefined,
      remark_text: remarkUpdateRequested ? expectedRemark : undefined,
      note: remarkUpdateRequested ? expectedRemark : undefined,
      memo: remarkUpdateRequested ? expectedRemark : undefined,
      boardWidth: params?.boardWidth !== undefined ? (params.boardWidth != null && params.boardWidth !== '' ? normalizeNumber(params.boardWidth) : undefined) : undefined,
      boardHeight: params?.boardHeight !== undefined ? (params.boardHeight != null && params.boardHeight !== '' ? normalizeNumber(params.boardHeight) : undefined) : undefined,
      creasingType: params?.creasingType !== undefined ? normalizeText(params.creasingType) : undefined,
      creasingSize1: params?.creasingSize1 !== undefined ? (params.creasingSize1 != null && params.creasingSize1 !== '' ? normalizeNumber(params.creasingSize1) : undefined) : undefined,
      creasingSize2: params?.creasingSize2 !== undefined ? (params.creasingSize2 != null && params.creasingSize2 !== '' ? normalizeNumber(params.creasingSize2) : undefined) : undefined,
      creasingSize3: params?.creasingSize3 !== undefined ? (params.creasingSize3 != null && params.creasingSize3 !== '' ? normalizeNumber(params.creasingSize3) : undefined) : undefined,
      sheetCount: params?.sheetCount !== undefined ? (params.sheetCount != null && params.sheetCount !== '' ? normalizeNumber(params.sheetCount) : undefined) : undefined,
      unitPrice: params?.unitPrice !== undefined ? (params.unitPrice != null && params.unitPrice !== '' ? normalizeNumber(params.unitPrice) : undefined) : undefined,
      supplierName: params?.supplierName !== undefined ? normalizeText(params.supplierName) : undefined,
      updatedAt: new Date().toISOString(),
      _updateTime: Date.now()
    });

    if (patch.name !== undefined && !normalizeText(patch.name)) throw new Error('商品名称不能为空');
    const nextMode = patch.productionMode !== undefined ? patch.productionMode : normalizeText(existing.productionMode);
    const nextUnit = patch.unit !== undefined ? patch.unit : normalizeText(existing.unit);
    if (nextMode === 'outsourced' && !normalizeText(nextUnit)) throw new Error('单位不能为空');

    await collection.doc(skuId).update({ data: patch });
    const pickRemark = (raw) => normalizeText(raw?.remark ?? raw?.remark_text ?? raw?.note ?? raw?.memo ?? '');
    const readSku = async () => {
      const r = await collection.doc(skuId).get();
      return r && r.data ? (Array.isArray(r.data) ? (r.data[0] || null) : r.data) : null;
    };

    let updated = await readSku();
    if (!remarkUpdateRequested) {
      return handleSuccess({ sku: normalizeSku(updated || { ...existing, ...patch, _id: skuId }) }, 'SKU更新成功');
    }

    const afterUpdateRemark = pickRemark(updated);
    if (afterUpdateRemark === expectedRemark) {
      return handleSuccess({ sku: normalizeSku(updated || { ...existing, ...patch, _id: skuId }) }, 'SKU更新成功');
    }

    try {
      const nowIso = new Date().toISOString();
      const fixPatch = {
        remark: expectedRemark,
        remark_text: expectedRemark,
        note: expectedRemark,
        memo: expectedRemark,
        updatedAt: nowIso,
        _updateTime: Date.now()
      };
      await collection.doc(skuId).update({ data: fixPatch });
      updated = await readSku();
      const afterFixRemark = pickRemark(updated);
      if (afterFixRemark === expectedRemark) {
        return handleSuccess({ sku: normalizeSku(updated || { ...existing, ...patch, ...fixPatch, _id: skuId }) }, 'SKU更新成功');
      }
    } catch (_) { }

    try {
      const setData = { ...existing, ...patch, remark: expectedRemark, remark_text: expectedRemark, note: expectedRemark, memo: expectedRemark };
      if (Object.prototype.hasOwnProperty.call(setData, '_id')) delete setData._id;
      await collection.doc(skuId).set({ data: setData });
      updated = await readSku();
      const afterSetRemark = pickRemark(updated);
      if (afterSetRemark === expectedRemark) {
        return handleSuccess({ sku: normalizeSku(updated || { ...setData, _id: skuId }) }, 'SKU更新成功');
      }
    } catch (_) { }

    const lastRemark = pickRemark(updated);
    const err = new Error(`SKU更新校验失败：备注未持久化（可能是云端触发器回写或集合权限规则限制）。期望 remark=${expectedRemark || '-'}，实际 remark=${lastRemark || '-'}。`);
    err.statusCode = 409;
    throw err;
  }

  if (method === 'DELETE') {
    const skuId = resolveSkuId();
    if (!skuId) throw new Error('缺少SKU ID');
    const got = await collection.doc(skuId).get();
    const existing = got && got.data ? (Array.isArray(got.data) ? (got.data[0] || null) : got.data) : null;
    if (!existing) throw new Error('SKU不存在');
    const existingCustomerKey = normalizeText(existing.customerId ?? existing.customer_id ?? existing.customer?.id);
    if (existingCustomerKey && !customerIdCandidates.includes(existingCustomerKey)) throw new Error('SKU不属于该客户');
    await collection.doc(skuId).remove();
    return handleSuccess({ sku: normalizeSku(existing) }, 'SKU删除成功');
  }

  throw new Error('不支持的HTTP方法');
}

// 供应商处理
async function handleSuppliers(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/suppliers\/([^/?#]+)/);
  const id = params.id || params._id || params.supplierId || (idMatch ? idMatch[1] : '');

  if (method === 'GET') {
    const result = await cloudAdapter.executeQuery('suppliers', params);
    return handleSuccess(result.data, '获取供应商列表成功');
  } else if (method === 'POST') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'createSupplier', data: params }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '供应商创建成功');
      }
      throw new Error((result.result && result.result.message) || '供应商创建失败');
    } catch (error) {
      return handleError(error, '供应商创建失败');
    }
  } else if (method === 'PUT') {
    if (!id) throw new Error('缺少供应商ID');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateSupplier', data: { ...params, id } }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '供应商更新成功');
      }
      throw new Error((result.result && result.result.message) || '供应商更新失败');
    } catch (error) {
      return handleError(error, '供应商更新失败');
    }
  } else if (method === 'DELETE') {
    if (!id) throw new Error('缺少供应商ID');
    const tokenPayload = requireAdminFromEvent(global.__lastEvent || {});
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'deleteSupplier', data: { id } }
      });
      if (result.result && result.result.success) {
        const now = Date.now();
        await safeWriteLog('operation_logs', {
          ts: now,
          action: 'delete_supplier',
          method,
          path: String(global.__lastPath || ''),
          actorUserId: tokenPayload.userId || '',
          actorUsername: tokenPayload.username || '',
          detail: { supplierId: id }
        });
        return handleSuccess({ _id: id, deleted: true }, '供应商删除成功');
      }
      throw new Error((result.result && result.result.message) || '供应商删除失败');
    } catch (error) {
      return handleError(error, '供应商删除失败');
    }
  }
  throw new Error('不支持的HTTP方法');
}

async function handleSuppliersList(method, params) {
  return await handleSuppliers(method, params);
}


async function handleEmployees(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/employees\/([^/?#]+)/);
  const id = params.id || params._id || params.docId || (idMatch ? idMatch[1] : '');
  if (method === 'GET') {
    if (id) {
      const result = await cloudAdapter.executeQuery('employees', { _id: id, limit: 1 });
      const list = Array.isArray(result.data) ? result.data : [];
      return handleSuccess(list[0] || null, '获取员工详情成功');
    }
    return await handleEmployeesList(method, params);
  } else if (method === 'POST') {
    const created = await cloudAdapter.create('employees', params);
    return handleSuccess(created.data, '员工创建成功');
  } else if (method === 'PUT') {
    if (!id) throw new Error('缺少员工ID');
    const updated = await cloudAdapter.update('employees', id, params);
    return handleSuccess(updated.data, '员工更新成功');
  } else if (method === 'DELETE') {
    if (!id) throw new Error('缺少员工ID');
    const removed = await cloudAdapter.delete('employees', id);
    return handleSuccess(removed.data, '员工删除成功');
  }
  throw new Error('不支持的HTTP方法');
}

async function handleEmployeesList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('employees', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取员工列表成功');
  } catch (_) { }
  return handleSuccess([], '获取员工列表成功');
}

// 产品品类处理
async function handleProductCategories(method, params) {
  if (method === 'GET') {
    const result = await cloudAdapter.executeQuery('product_categories', params);
    return handleSuccess(result.data, '获取产品品类成功');
  } else if (method === 'POST') {
    const result = await cloudAdapter.create('product_categories', params);
    return handleSuccess(result.data, '产品品类创建成功');
  }
  throw new Error('不支持的HTTP方法');
}

async function handleCustomersStats(method, params) {
  const result = await cloudAdapter.getStats('customers', params);
  return handleSuccess(result.data, '获取客户统计成功');
}

// 客户列表
async function handleCustomersList(method, params) {
  try {
    const p = params && typeof params === 'object' ? params : {};
    const keyword = p.keyword != null ? String(p.keyword || '').trim() : '';
    const search = p.search != null ? String(p.search || '').trim() : '';
    const q = p.q != null ? String(p.q || '').trim() : '';
    const statusRaw = p.status != null ? String(p.status || '').trim() : '';
    const page = Number(p.page || 1) || 1
    const limit = Number(p.pageSize || p.limit || 50) || 50
    const mergedKeyword = String(keyword || search || q || '').trim()
    const status = statusRaw === 'all' ? '' : statusRaw

    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getCustomers',
          params: {
            page,
            limit,
            ...(mergedKeyword ? { keyword: mergedKeyword } : {}),
            ...(status ? { status } : {})
          }
        }
      })
      const payload = result && result.result ? result.result : null
      if (payload && payload.success === true) {
        return {
          success: true,
          message: '获取客户列表成功',
          data: Array.isArray(payload.data) ? payload.data : [],
          pagination: payload.pagination && typeof payload.pagination === 'object' ? payload.pagination : undefined
        }
      }
    } catch (_) { /* ignore */ }

    const nextParams = { ...p, status }
    if (!nextParams.search && mergedKeyword) nextParams.search = mergedKeyword
    const fallback = await cloudAdapter.executeQuery('customers', nextParams)
    const list = Array.isArray(fallback.data) ? fallback.data : []
    const pagination = fallback && fallback.pagination && typeof fallback.pagination === 'object' ? fallback.pagination : undefined
    if (list.length) return { success: true, message: '获取客户列表成功', data: list, pagination }
  } catch (_) { /* ignore */ }
  return { success: true, message: '获取客户列表成功', data: [], pagination: undefined };
}


// 库存处理
async function handleInventory(method, params) {
  if (method === 'GET') {
    return await handleInventoryList(method, params);
  } else if (method === 'PUT') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateInventory', data: params }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '库存更新成功');
      }
      throw new Error((result.result && result.result.message) || '库存更新失败');
    } catch (error) {
      return handleError(error, '库存更新失败');
    }
  }

  throw new Error('不支持的HTTP方法');
}

// 库存列表
async function handleInventoryList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('inventory', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取库存列表成功');
  } catch (_) { /* ignore */ }
  return handleSuccess([], '获取库存列表成功');
}

async function handleProducts(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/products\/([^/?#]+)/);
  const id = params.id || params._id || params.productId || (idMatch ? idMatch[1] : '');

  if (method === 'GET') {
    return await handleProductsList(method, params);
  } else if (method === 'POST') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'createProduct', data: params }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '产品创建成功');
      }
      throw new Error((result.result && result.result.message) || '产品创建失败');
    } catch (error) {
      return handleError(error, '产品创建失败');
    }
  } else if (method === 'PUT') {
    if (!id) throw new Error('缺少产品ID');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateProduct', data: { ...params, id } }
      });
      if (result.result && result.result.success) {
        return handleSuccess(result.result.data, '产品更新成功');
      }
      throw new Error((result.result && result.result.message) || '产品更新失败');
    } catch (error) {
      return handleError(error, '产品更新失败');
    }
  } else if (method === 'DELETE') {
    if (!id) throw new Error('缺少产品ID');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'deleteProduct', data: { id } }
      });
      if (result.result && result.result.success) {
        return handleSuccess({ _id: id, deleted: true }, '产品删除成功');
      }
      throw new Error((result.result && result.result.message) || '产品删除失败');
    } catch (error) {
      return handleError(error, '产品删除失败');
    }
  }
  throw new Error('不支持的HTTP方法');
}

async function handleProductsList(method, params) {
  try {
    const result = await cloudAdapter.executeQuery('products', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取产品列表成功');
  } catch (_) { }
  return handleSuccess([], '获取产品列表成功');
}

async function handleProductsStats(method, params) {
  const result = await cloudAdapter.getStats('products', params);
  return handleSuccess(result.data, '获取产品统计成功');
}

// 仪表板统计
async function handleDashboardStats(method, params) {
  try {
    // 并行获取多个集合的统计
    const [orders, workOrders, customers] = await Promise.all([
      cloudAdapter.getStats('orders', { dateRange: params.dateRange }),
      cloudAdapter.getStats('workorders', { dateRange: params.dateRange }),
      cloudAdapter.getStats('customers', {})
    ]);

    const stats = {
      orders: orders.data.total,
      workOrders: workOrders.data.total,
      customers: customers.data.total,
      // 可以添加更多统计字段
      updatedAt: new Date()
    };

    return handleSuccess(stats, '获取仪表板统计成功');
  } catch (error) {
    // 兜底返回空统计，避免页面报错
    return handleSuccess({ orders: 0, workOrders: 0, customers: 0, updatedAt: new Date() }, '获取仪表板统计成功');
  }
}

// 最近活动
async function handleDashboardRecent(method, params) {
  try {
    // 获取最近的订单和工单
    const [recentOrders, recentWorkOrders] = await Promise.all([
      cloudAdapter.executeQuery('orders', { limit: 5 }),
      cloudAdapter.executeQuery('workorders', { limit: 5 })
    ]);

    const recent = {
      orders: recentOrders.data,
      workOrders: recentWorkOrders.data,
      timestamp: new Date()
    };

    return handleSuccess(recent, '获取最近活动成功');
  } catch (error) {
    // 兜底返回空数据，避免页面报错
    return handleSuccess({ orders: [], workOrders: [], timestamp: new Date() }, '获取最近活动成功');
  }
}

async function handleDataManagementStats(method, params, user) {
  if (method !== 'GET') {
    throw new Error('不支持的HTTP方法');
  }

  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {};
  const userId = String(tokenPayload.userId || user?.userId || '').trim();

  const salesTrendRangeRaw = params && params.salesTrendRange != null ? params.salesTrendRange : 'month';
  const salesTrendRange = String(salesTrendRangeRaw || '').trim() || 'month';
  const allowedRanges = new Set(['month', '3m', '6m', 'year']);
  const normalizedRange = allowedRanges.has(salesTrendRange) ? salesTrendRange : 'month';

  const debugTrendKey =
    params && params.debugTrendKey != null ? String(params.debugTrendKey).trim() : '';
  const debugMonthKey =
    params && params.debugMonthKey != null ? String(params.debugMonthKey).trim() : '';

  try {
    const cfParams = {
      salesTrendRange: normalizedRange,
      ...(userId ? { userId } : {}),
      ...(debugTrendKey ? { debugTrendKey } : {}),
      ...(debugMonthKey ? { debugMonthKey } : {})
    };
    const result = await cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getDataManagementStats', params: cfParams }
    });
    if (result && result.result && result.result.success) {
      return handleSuccess(result.result.data || {}, '获取数据管理统计成功');
    }
    throw new Error((result && result.result && result.result.message) || '获取数据管理统计失败');
  } catch (error) {
    return handleError(error, '获取数据管理统计失败');
  }
}

async function handleDataIntegrityScan(method, params, user) {
  if (method !== 'GET') {
    throw new Error('不支持的HTTP方法');
  }

  requireAdminFromEvent(global.__lastEvent || {});

  const toMs = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(String(v));
    return Number.isFinite(t) ? t : null;
  };

  const startMs =
    toMs(params?.startDate) ??
    toMs(params?.start) ??
    toMs(params?.startTime) ??
    toMs(params?.startTs);
  const endMs =
    toMs(params?.endDate) ??
    toMs(params?.end) ??
    toMs(params?.endTime) ??
    toMs(params?.endTs);

  const hasRange = startMs != null || endMs != null;
  const rangeStart = startMs != null ? startMs : 0;
  const rangeEnd = endMs != null ? endMs : Date.now();

  const pageSize = Math.max(20, Math.min(500, Number(params?.pageSize || 200)));
  const maxDocs = Math.max(100, Math.min(20000, Number(params?.maxDocs || 5000)));
  const maxAnomalies = Math.max(50, Math.min(2000, Number(params?.maxAnomalies || 300)));

  const applyNotDeleted = (q) =>
    q.where(
      _.or([
        { isDeleted: _.neq(true) },
        { isDeleted: _.exists(false) }
      ])
    );

  const applyRange = (q) => {
    if (!hasRange) return q;
    const startDate = new Date(rangeStart);
    const endDate = new Date(rangeEnd);
    return q.where(
      _.or([
        { _createTime: _.gte(rangeStart).and(_.lte(rangeEnd)) },
        { _createTime: _.gte(startDate).and(_.lte(endDate)) },
        { createdAt: _.gte(rangeStart).and(_.lte(rangeEnd)) },
        { createdAt: _.gte(startDate).and(_.lte(endDate)) }
      ])
    );
  };

  const fetchSome = async (collection, maxTake) => {
    const out = [];
    let skip = 0;
    const takeMax = Math.max(0, Number(maxTake || 0));
    if (!takeMax) return out;
    while (out.length < takeMax) {
      const take = Math.min(pageSize, takeMax - out.length);
      let q = db.collection(collection);
      q = applyNotDeleted(q);
      q = applyRange(q);
      let res;
      try {
        res = await q.orderBy('createdAt', 'desc').skip(skip).limit(take).get();
      } catch (_) {
        res = await q.orderBy('_createTime', 'desc').skip(skip).limit(take).get().catch(() => ({ data: [] }));
      }
      const rows = Array.isArray(res?.data) ? res.data : [];
      if (!rows.length) break;
      out.push(...rows);
      skip += rows.length;
      if (rows.length < take) break;
    }
    return out;
  };

  const normalizeNameKey = (s) => String(s || '').trim().toLowerCase();
  const buildCustomerMap = (rows) => {
    const byId = new Map();
    const byName = new Map();
    for (const r of rows || []) {
      const id = r?._id || r?.id;
      if (id != null) byId.set(String(id), r);
      const name = r?.companyName || r?.name || r?.company || r?.customerName;
      const shortName = r?.shortName;
      if (name) byName.set(normalizeNameKey(name), r);
      if (shortName) byName.set(normalizeNameKey(shortName), r);
    }
    return { byId, byName };
  };
  const buildSupplierMap = (rows) => {
    const byId = new Map();
    const byName = new Map();
    for (const r of rows || []) {
      const id = r?._id || r?.id;
      if (id != null) byId.set(String(id), r);
      const name = r?.name || r?.companyName || r?.shortName || r?.supplierName;
      const shortName = r?.shortName;
      if (name) byName.set(normalizeNameKey(name), r);
      if (shortName) byName.set(normalizeNameKey(shortName), r);
    }
    return { byId, byName };
  };

  const collectionsRaw =
    params?.collections != null
      ? String(params.collections)
      : 'orders,orders_tmp,erp_orders,order_list,purchase_orders';
  const collections = Array.from(
    new Set(
      collectionsRaw
        .split(',')
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    )
  );

  const customers = await fetchSome('customers', Math.min(maxDocs, 5000));
  const suppliers = await fetchSome('suppliers', Math.min(maxDocs, 5000));
  const customerMap = buildCustomerMap(customers);
  const supplierMap = buildSupplierMap(suppliers);

  const perCollection = {};
  const missingCustomerRef = [];
  const missingSupplierRef = [];
  const missingNames = [];
  const suspiciousPurchaseFlags = [];
  const duplicateOrderNo = [];
  const orderNoIndex = new Map();

  const pushLimited = (arr, item) => {
    if (arr.length >= maxAnomalies) return;
    arr.push(item);
  };

  const scanOrderRow = (row, collectionName) => {
    if (!row || typeof row !== 'object') return;
    const id = row._id || row.id;
    const orderNo = row.orderNo || row.orderNumber || row.no || '';
    const customerId = row.customerId || row.customer?._id || row.customer?.id;
    const supplierId = row.supplierId || row.supplier?._id || row.supplier?.id;
    const customerName = row.customerName || row.customer?.name || row.customer?.companyName || '';
    const supplierName = row.supplierName || row.supplier?.name || row.supplier?.companyName || '';

    const orderType = String(row.orderType || '').toLowerCase();
    const source = String(row.source || '').toLowerCase();
    const purchaseCategory = row.purchaseCategory ?? row.category ?? row.purchase_category;
    const isPurchase = orderType === 'purchase' || source === 'purchased' || (purchaseCategory != null && String(purchaseCategory) !== '');

    if (isPurchase && collectionName !== 'purchase_orders') {
      pushLimited(suspiciousPurchaseFlags, {
        id,
        orderNo,
        orderType: row.orderType,
        source: row.source,
        purchaseCategory,
        collection: collectionName
      });
    }

    if (customerId) {
      const hit = customerMap.byId.get(String(customerId));
      if (!hit) {
        pushLimited(missingCustomerRef, { id, orderNo, customerId, customerName, collection: collectionName });
      }
    }
    if (supplierId) {
      const hit = supplierMap.byId.get(String(supplierId));
      if (!hit) {
        pushLimited(missingSupplierRef, { id, orderNo, supplierId, supplierName, collection: collectionName });
      }
    }

    if (!String(customerName || '').trim() && customerId) {
      pushLimited(missingNames, { id, orderNo, field: 'customerName', customerId, collection: collectionName });
    }
    if (!String(supplierName || '').trim() && supplierId) {
      pushLimited(missingNames, { id, orderNo, field: 'supplierName', supplierId, collection: collectionName });
    }

    const canonicalNo = String(orderNo || '').trim();
    if (canonicalNo) {
      const prev = orderNoIndex.get(canonicalNo) || [];
      prev.push({ id, collection: collectionName });
      orderNoIndex.set(canonicalNo, prev);
    }
  };

  for (const col of collections) {
    const rows = await fetchSome(col, maxDocs);
    perCollection[col] = { scanned: rows.length };
    for (const row of rows) scanOrderRow(row, col);
  }

  for (const [no, refs] of orderNoIndex.entries()) {
    if (refs.length <= 1) continue;
    pushLimited(duplicateOrderNo, { orderNo: no, refs });
  }

  return handleSuccess(
    {
      scannedAt: new Date(),
      range: hasRange ? { start: rangeStart, end: rangeEnd } : null,
      collections,
      summary: {
        perCollection,
        customersScanned: customers.length,
        suppliersScanned: suppliers.length,
        missingCustomerRef: missingCustomerRef.length,
        missingSupplierRef: missingSupplierRef.length,
        missingNames: missingNames.length,
        suspiciousPurchaseFlags: suspiciousPurchaseFlags.length,
        duplicateOrderNo: duplicateOrderNo.length
      },
      anomalies: {
        missingCustomerRef,
        missingSupplierRef,
        missingNames,
        suspiciousPurchaseFlags,
        duplicateOrderNo
      }
    },
    '扫描完成'
  );
}

// 健康检查
async function handleHealthCheck() {
  return handleSuccess({
    status: 'healthy',
    timestamp: new Date(),
    service: 'ERP Cloud API Bridge'
  }, '系统运行正常');
}

// 系统状态
async function handleSystemStatus() {
  try {
    // 简单检查数据库连接
    const testResult = await cloudAdapter.getStats('users', { limit: 1 });

    return handleSuccess({
      status: 'operational',
      database: 'connected',
      timestamp: new Date(),
      version: '1.0.0'
    }, '系统状态正常');
  } catch (error) {
    return {
      success: false,
      status: 'degraded',
      database: 'disconnected',
      timestamp: new Date(),
      error: error.message
    };
  }
}

function normalizeRoleValue(role) {
  return String(role || '').trim().toLowerCase()
}

function requireAdminFromEvent(event) {
  const tokenPayload = parseTokenFromHeader(event || {})
  const role = normalizeRoleValue(tokenPayload?.role)
  if (role === 'admin' || role === 'administrator') return tokenPayload
  const err = new Error('无权限访问')
  err.statusCode = 403
  throw err
}

function createLogId(prefix) {
  const p = String(prefix || 'log').replace(/[^a-z0-9_\-]/gi, '').slice(0, 24) || 'log'
  const rand = crypto.randomBytes(8).toString('hex')
  return `${p}_${Date.now()}_${rand}`
}

async function ensureCollectionExists(name) {
  try {
    await db.createCollection(String(name))
  } catch (_) { }
}

async function safeWriteLog(collectionName, doc) {
  const collection = String(collectionName || '').trim()
  if (!collection) return
  const used = doc && typeof doc === 'object' ? doc : {}
  const id = String(used._id || used.id || '').trim() || createLogId(collection)
  const row = { ...used }
  delete row._id
  delete row.id
  try {
    await db.collection(collection).doc(id).set({ data: row })
  } catch (e) {
    const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
    if (msg.includes('collection') && msg.includes('not exist')) {
      await ensureCollectionExists(collection)
      await db.collection(collection).doc(id).set({ data: row })
    }
  }
}

function escapeRegExpText(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function queryLogs(collectionName, params = {}) {
  const collection = String(collectionName || '').trim()
  const page = Math.max(1, Number(params.page || 1) || 1)
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20) || 20))
  const keyword = String(params.keyword || '').trim()
  const level = String(params.level || '').trim()
  const startTs = params.startTs != null ? Number(params.startTs) : undefined
  const endTs = params.endTs != null ? Number(params.endTs) : undefined

  const hasStart = Number.isFinite(startTs)
  const hasEnd = Number.isFinite(endTs)
  const hasRange = hasStart || hasEnd
  const rangeStart = hasStart ? startTs : 0
  const rangeEnd = hasEnd ? endTs : Date.now()

  if (collection === 'operation_logs' && keyword) {
    const kwLower = String(keyword).toLowerCase()
    const scanMax = 2000
    const pageSize = 500
    const all = []
    let skip = 0

    while (all.length < scanMax) {
      const take = Math.min(pageSize, scanMax - all.length)
      let res = null
      try {
        res = await db.collection(collection).orderBy('ts', 'desc').skip(skip).limit(take).get()
      } catch (_) {
        try {
          res = await db.collection(collection).orderBy('timestamp', 'desc').skip(skip).limit(take).get()
        } catch (_) {
          res = await db.collection(collection).skip(skip).limit(take).get()
        }
      }
      const batch = Array.isArray(res && res.data) ? res.data : []
      if (!batch.length) break
      all.push(...batch)
      if (batch.length < take) break
      skip += take
    }

    const filtered = all.filter((row) => {
      if (!row || typeof row !== 'object') return false
      if (level && String(row.level || '').trim() !== level) return false
      const t = Number(row.ts || row.timestamp || 0)
      if (hasRange && (!Number.isFinite(t) || t < rangeStart || t > rangeEnd)) return false
      try {
        const text = JSON.stringify(row).toLowerCase()
        return text.includes(kwLower)
      } catch (_) {
        return false
      }
    })

    const total = filtered.length
    const start = (page - 1) * limit
    const list = filtered.slice(start, start + limit)
    return { list, pagination: { page, limit, total } }
  }

  const conditions = []
  if (level) conditions.push({ level })
  if (hasRange) {
    conditions.push(
      _.or([
        { ts: _.gte(rangeStart).and(_.lte(rangeEnd)) },
        { timestamp: _.gte(rangeStart).and(_.lte(rangeEnd)) }
      ])
    )
  }
  if (keyword) {
    const regexp = db.RegExp({ regexp: escapeRegExpText(keyword), options: 'i' })
    conditions.push(
      _.or([
        { message: regexp },
        { path: regexp },
        { action: regexp },
        { actorUsername: regexp },
        { actorUserId: regexp },
        { operation: regexp },
        { collection: regexp },
        { recordId: regexp },
        { userId: regexp }
      ])
    )
  }

  const where = conditions.length === 0 ? {} : (conditions.length === 1 ? conditions[0] : _.and(conditions))

  let total = 0
  try {
    const c = await db.collection(collection).where(where).count()
    total = Number(c && c.total) || 0
  } catch (_) { }

  let list = []
  try {
    let res = null
    try {
      res = await db.collection(collection)
        .where(where)
        .orderBy('ts', 'desc')
        .skip((page - 1) * limit)
        .limit(limit)
        .get()
    } catch (_) {
      res = await db.collection(collection)
        .where(where)
        .orderBy('timestamp', 'desc')
        .skip((page - 1) * limit)
        .limit(limit)
        .get()
    }
    list = Array.isArray(res && res.data) ? res.data : []
  } catch (e) {
    const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
    if (msg.includes('collection') && msg.includes('not exist')) {
      return { list: [], pagination: { page, limit, total: 0 } }
    }
    throw e
  }

  return { list, pagination: { page, limit, total } }
}

async function handleSystemSettings(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method === 'GET') {
    try {
      const res = await db.collection('settings').doc('system').get()
      const data = res && res.data ? res.data : null
      return handleSuccess({ settings: data || {} }, '获取系统设置成功')
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
      if (msg.includes('collection') && msg.includes('not exist')) {
        return handleSuccess({ settings: {} }, '获取系统设置成功')
      }
      return handleError(e, '获取系统设置失败')
    }
  }
  if (method === 'POST' || method === 'PUT') {
    const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
    const patch = params && typeof params === 'object' ? params : {}
    const now = Date.now()
    const record = {
      _id: 'system',
      ...patch,
      updatedAt: now,
      updatedBy: tokenPayload.userId || tokenPayload.username || user?.userId || 'unknown'
    }
    const recordForWrite = { ...record }
    delete recordForWrite._id
    try {
      await db.collection('settings').doc('system').set({ data: recordForWrite })
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
      if (msg.includes('collection') && msg.includes('not exist')) {
        await ensureCollectionExists('settings')
        await db.collection('settings').doc('system').set({ data: recordForWrite })
      } else {
        return handleError(e, '保存系统设置失败')
      }
    }
    await safeWriteLog('operation_logs', {
      ts: now,
      action: 'update_system_settings',
      method,
      path: String(global.__lastPath || ''),
      actorUserId: tokenPayload.userId || '',
      actorUsername: tokenPayload.username || '',
      detail: redactSensitive(patch)
    })
    return handleSuccess({ settings: record }, '保存系统设置成功')
  }
  throw new Error('不支持的HTTP方法')
}

async function readSystemSettingsDoc() {
  try {
    const res = await db.collection('settings').doc('system').get()
    return res && res.data ? res.data : {}
  } catch (e) {
    const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
    if (msg.includes('collection') && msg.includes('not exist')) return {}
    return {}
  }
}

async function writeSystemSettingsDoc(nextDoc) {
  const sanitized = (() => {
    const doc = nextDoc && typeof nextDoc === 'object' ? { ...nextDoc } : {}
    if ('_id' in doc) delete doc._id
    if ('id' in doc) delete doc.id
    return doc
  })()
  try {
    await db.collection('settings').doc('system').set({ data: sanitized })
    return true
  } catch (e) {
    const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
    if (msg.includes('collection') && msg.includes('not exist')) {
      await ensureCollectionExists('settings')
      await db.collection('settings').doc('system').set({ data: sanitized })
      return true
    }
    throw e
  }
}

async function handleSystemBackupConfig(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method === 'GET') {
    const settings = await readSystemSettingsDoc()
    const backup = settings && typeof settings.backup === 'object' ? settings.backup : {}
    return handleSuccess({ backup: backup || {} }, '获取备份设置成功')
  }
  if (method === 'POST' || method === 'PUT') {
    const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
    const settings = await readSystemSettingsDoc()
    const nextBackup = params && typeof params === 'object' ? params : {}
    const now = Date.now()
    const nextDoc = {
      ...(settings && typeof settings === 'object' ? settings : {}),
      backup: {
        ...((settings && typeof settings.backup === 'object') ? settings.backup : {}),
        ...nextBackup
      },
      updatedAt: now,
      updatedBy: tokenPayload.userId || tokenPayload.username || user?.userId || 'unknown'
    }
    await writeSystemSettingsDoc(nextDoc)
    await safeWriteLog('operation_logs', {
      ts: now,
      action: 'update_backup_config',
      method,
      path: String(global.__lastPath || ''),
      actorUserId: tokenPayload.userId || '',
      actorUsername: tokenPayload.username || '',
      detail: redactSensitive(nextBackup)
    })
    return handleSuccess({ backup: nextDoc.backup }, '保存备份设置成功')
  }
  throw new Error('不支持的HTTP方法')
}

async function handleSystemCloudSyncConfig(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method === 'GET') {
    const settings = await readSystemSettingsDoc()
    const cloudSync = settings && typeof settings.cloudSync === 'object'
      ? settings.cloudSync
      : (settings && typeof settings.backup === 'object' ? settings.backup : {})
    return handleSuccess({ cloudSync: cloudSync || {} }, '获取云同步设置成功')
  }
  if (method === 'POST' || method === 'PUT') {
    const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
    const settings = await readSystemSettingsDoc()
    const nextCloudSync = params && typeof params === 'object' ? params : {}
    const now = Date.now()
    const nextDoc = {
      ...(settings && typeof settings === 'object' ? settings : {}),
      cloudSync: {
        ...((settings && typeof settings.cloudSync === 'object') ? settings.cloudSync : {}),
        ...nextCloudSync
      },
      updatedAt: now,
      updatedBy: tokenPayload.userId || tokenPayload.username || user?.userId || 'unknown'
    }
    await writeSystemSettingsDoc(nextDoc)
    await safeWriteLog('operation_logs', {
      ts: now,
      action: 'update_cloud_sync_config',
      method,
      path: String(global.__lastPath || ''),
      actorUserId: tokenPayload.userId || '',
      actorUsername: tokenPayload.username || '',
      detail: redactSensitive(nextCloudSync)
    })
    return handleSuccess({ cloudSync: nextDoc.cloudSync }, '保存云同步设置成功')
  }
  throw new Error('不支持的HTTP方法')
}

async function handleSystemCloudSyncRun(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'POST') throw new Error('不支持的HTTP方法')
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
  const now = Date.now()
  const body = params && typeof params === 'object' ? params : {}
  const detail = {
    mode: String(body.mode || 'incremental'),
    collections: Array.isArray(body.collections) ? body.collections.map((x) => String(x || '').trim()).filter(Boolean) : []
  }
  await safeWriteLog('operation_logs', {
    ts: now,
    action: 'cloud_sync_run',
    method,
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail: redactSensitive(detail)
  })
  return handleSuccess({ skipped: true, mode: detail.mode }, '云端模式数据即为最新，无需触发本地云同步')
}

async function handleSystemLocalDbInstallFromCloud(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'POST') throw new Error('不支持的HTTP方法')
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
  const now = Date.now()
  await safeWriteLog('operation_logs', {
    ts: now,
    action: 'local_db_install_from_cloud',
    method,
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail: redactSensitive(params && typeof params === 'object' ? params : {})
  })
  const err = new Error('云端模式不支持“安装到本地数据库”，请使用桌面端客户端')
  err.statusCode = 400
  throw err
}

async function fetchAllFromCollection(collectionName, maxRecords) {
  const name = String(collectionName || '').trim()
  const parsed = Number(maxRecords)
  const used = Number.isFinite(parsed) ? parsed : 20000
  const max = Math.min(20000, Math.max(0, used))
  const limitMax = max > 0 ? max : 20000
  if (!name) return []
  const out = []
  const pageSize = 500
  let skip = 0
  while (out.length < limitMax) {
    const limit = Math.min(pageSize, limitMax - out.length)
    try {
      const res = await db.collection(name).orderBy('_id', 'asc').skip(skip).limit(limit).get()
      const rows = Array.isArray(res && res.data) ? res.data : []
      out.push(...rows)
      if (rows.length < limit) break
      skip += rows.length
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
      if (msg.includes('collection') && msg.includes('not exist')) return out
      throw e
    }
  }
  return out
}

function formatBackupFileName(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `erp-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`
}

async function handleSystemBackupRun(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'POST') throw new Error('不支持的HTTP方法')
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
  const now = Date.now()
  const maxRecords = params && params.maxRecords != null ? Number(params.maxRecords) : 20000
  const maxRecordsPerCollection =
    (() => {
      const n = Number(maxRecords)
      if (!Number.isFinite(n) || n <= 0) return 20000
      return Math.min(20000, Math.max(1, n))
    })()
  const inline = Boolean(params?.inline || params?.returnSnapshot || params?.includeSnapshot)
  const collections = Array.isArray(params?.collections)
    ? params.collections.map((x) => String(x || '').trim()).filter(Boolean)
    : [
      'orders',
      'purchase_orders',
      'workorders',
      'production',
      'customers',
      'suppliers',
      'products',
      'inventory',
      'employees',
      'users',
      'fixed_costs',
      'payables',
      'statements',
      'receivables',
      'user_configs',
      'settings'
    ]

  const data = {}
  for (const name of collections) {
    try {
      data[name] = await fetchAllFromCollection(name, maxRecordsPerCollection)
    } catch (e) {
      data[name] = []
      await safeWriteLog('system_logs', {
        ts: Date.now(),
        level: 'warn',
        message: `备份读取集合失败: ${name}`,
        path: String(global.__lastPath || ''),
        actorUserId: tokenPayload.userId || '',
        actorUsername: tokenPayload.username || ''
      })
    }
  }

  const snapshot = {
    meta: {
      generatedAt: now,
      envId: cloud.getWXContext().ENV || cloud.DYNAMIC_CURRENT_ENV || '',
      collections,
      maxRecordsPerCollection
    },
    data
  }

  const json = JSON.stringify(snapshot)
  const jsonBytes = Buffer.byteLength(json, 'utf8')
  const cloudPath = `backups/${formatBackupFileName(now)}`
  const upload = await cloud.uploadFile({
    cloudPath,
    fileContent: Buffer.from(json, 'utf8')
  })
  const fileID = upload && upload.fileID ? upload.fileID : ''
  const tmp = await cloud.getTempFileURL({ fileList: [fileID] })
  const url = Array.isArray(tmp && tmp.fileList) && tmp.fileList.length ? tmp.fileList[0].tempFileURL : ''

  const settings = await readSystemSettingsDoc()
  const nextDoc = {
    ...(settings && typeof settings === 'object' ? settings : {}),
    _id: 'system',
    backup: {
      ...((settings && typeof settings.backup === 'object') ? settings.backup : {}),
      lastBackupAt: now,
      lastBackupFileID: fileID,
      lastBackupCloudPath: cloudPath
    },
    updatedAt: now,
    updatedBy: tokenPayload.userId || tokenPayload.username || user?.userId || 'unknown'
  }
  await writeSystemSettingsDoc(nextDoc)

  await safeWriteLog('operation_logs', {
    ts: now,
    action: 'run_backup',
    method,
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail: { cloudPath, collections, maxRecords: snapshot.meta.maxRecordsPerCollection }
  })
  await safeWriteLog('system_logs', {
    ts: now,
    level: 'info',
    message: '已生成备份文件',
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail: { cloudPath, fileID }
  })

  const includeSnapshot = inline && jsonBytes > 0 && jsonBytes <= 4_500_000
  return handleSuccess(
    { fileID, url, cloudPath, generatedAt: now, ...(includeSnapshot ? { snapshot } : {}) },
    '备份成功'
  )
}

async function deleteAllDocsInCollection(collectionName, maxToDelete) {
  const name = String(collectionName || '').trim()
  if (!name) return 0
  const max = Math.min(20000, Math.max(0, Number(maxToDelete || 20000) || 20000))
  if (max === 0) return 0
  let deleted = 0
  while (deleted < max) {
    let res
    try {
      res = await db.collection(name).limit(100).get()
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
      if (msg.includes('collection') && msg.includes('not exist')) return deleted
      throw e
    }
    const rows = Array.isArray(res && res.data) ? res.data : []
    if (!rows.length) break
    const ids = rows
      .map((r) => String((r && (r._id || r.id)) || '').trim())
      .filter(Boolean)
    if (!ids.length) break
    await Promise.all(ids.map((id) => db.collection(name).doc(id).remove().catch(() => null)))
    deleted += ids.length
  }
  return deleted
}

async function upsertDocsToCollection(collectionName, rows) {
  const name = String(collectionName || '').trim()
  if (!name) return { written: 0, added: 0, skipped: 0 }
  await ensureCollectionExists(name)

  const list = Array.isArray(rows) ? rows : []
  let written = 0
  let added = 0
  let skipped = 0
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20)
    const tasks = chunk.map(async (raw) => {
      const record = raw && typeof raw === 'object' ? raw : null
      if (!record) {
        skipped += 1
        return
      }
      const docId = String(record._id || record.id || '').trim()
      const sanitized = (() => {
        const obj = { ...record }
        if ('_id' in obj) delete obj._id
        if ('id' in obj) delete obj.id
        return obj
      })()
      if (docId) {
        try {
          await db.collection(name).doc(docId).update({ data: sanitized })
          written += 1
          return
        } catch (e) {
          const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
          if (msg.includes('not exist')) {
            await db.collection(name).doc(docId).set({ data: sanitized })
            written += 1
            return
          }
          throw e
        }
      }
      await db.collection(name).add({ data: sanitized })
      added += 1
    })
    await Promise.all(tasks)
  }
  return { written, added, skipped }
}

async function handleSystemBackupImport(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'POST') throw new Error('不支持的HTTP方法')

  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
  const now = Date.now()
  const collection = String(params?.collection || '').trim()
  if (!collection) throw new Error('缺少集合名称')

  const allowed = new Set([
    'orders',
    'purchase_orders',
    'workorders',
    'production',
    'customers',
    'suppliers',
    'products',
    'inventory',
    'employees',
    'users',
    'fixed_costs',
    'payables',
    'statements',
    'receivables',
    'user_configs',
    'settings'
  ])
  if (!allowed.has(collection)) {
    throw new Error('不支持导入该集合')
  }

  const wipe = Boolean(params?.wipe)
  const rows = Array.isArray(params?.rows) ? params.rows : []
  const maxDelete = params?.maxDelete != null ? Number(params.maxDelete) : 20000

  let deleted = 0
  if (wipe) {
    const confirmText = String(params?.confirmText || '').trim().toUpperCase()
    if (confirmText !== 'WIPE') {
      throw new Error('覆盖导入需要确认口令')
    }
    deleted = await deleteAllDocsInCollection(collection, maxDelete)
  }

  const result = await upsertDocsToCollection(collection, rows)

  await safeWriteLog('operation_logs', {
    ts: now,
    action: 'import_backup',
    method,
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail: {
      collection,
      wipe,
      deleted,
      written: result.written,
      added: result.added,
      skipped: result.skipped,
      totalRows: rows.length
    }
  })

  return handleSuccess({ collection, wipe, deleted, ...result, totalRows: rows.length }, '导入成功')
}

async function handleSystemStoragePath(method, _params, _user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')
  return handleSuccess(
    {
      path: null,
      source: 'cloud',
      settingsFile: null
    },
    '云端模式无本地数据库路径'
  )
}

async function handleSyncStatus(method, _params, _user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')

  await ensureCollectionExists('sync_changes')
  await ensureCollectionExists('sync_errors')
  await ensureCollectionExists('sync_conflicts')

  const safeCount = async (collection, where) => {
    try {
      const q = where ? db.collection(collection).where(where) : db.collection(collection)
      const res = await q.count()
      return Number(res?.total || 0)
    } catch (_) {
      return 0
    }
  }

  const pendingCount = await safeCount('sync_changes', { processed: false })
  const conflictCount = await safeCount('sync_conflicts')
  const recentErrors = await safeCount('sync_errors')

  return handleSuccess(
    {
      status: { state: 'cloud', note: '云端模式无需与本地同步' },
      stats: {
        syncedCount: 0,
        pendingCount,
        conflictCount,
        errorCount: recentErrors
      }
    },
    '获取同步状态成功'
  )
}

async function handleSyncTrigger(method, params, _user, mode) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'POST') throw new Error('不支持的HTTP方法')

  const now = Date.now()
  const tokenPayload = parseTokenFromHeader(global.__lastEvent || {}) || {}
  const detail = {
    mode: String(mode || ''),
    options: params && typeof params === 'object' ? redactSensitive(params.options || params) : {}
  }

  await safeWriteLog('operation_logs', {
    ts: now,
    action: mode === 'force' ? 'sync_force' : 'sync_incremental',
    method,
    path: String(global.__lastPath || ''),
    actorUserId: tokenPayload.userId || '',
    actorUsername: tokenPayload.username || '',
    detail
  })

  return handleSuccess(
    { skipped: true, mode: String(mode || '') },
    '云端模式数据即为最新，无需触发本地同步'
  )
}

async function handleOperationLogs(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')
  const { list, pagination } = await queryLogs('operation_logs', params)
  return handleSuccess({ list, pagination }, '获取操作日志成功')
}

async function handleSystemLogs(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')
  const { list, pagination } = await queryLogs('system_logs', params)
  return handleSuccess({ list, pagination }, '获取系统日志成功')
}

async function handleErrorLogs(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')
  const { list, pagination } = await queryLogs('error_logs', params)
  return handleSuccess({ list, pagination }, '获取错误日志成功')
}

async function countRecentErrors(hours) {
  const h = Math.max(1, Number(hours || 24) || 24)
  const startTs = Date.now() - h * 3600 * 1000
  try {
    const c = await db.collection('error_logs').where({ ts: _.gte(startTs) }).count()
    return Number(c && c.total) || 0
  } catch (e) {
    const msg = String(e && (e.errMsg || e.message || e)).toLowerCase()
    if (msg.includes('collection') && msg.includes('not exist')) return 0
    return 0
  }
}

async function handleSystemOverview(method, params, user) {
  requireAdminFromEvent(global.__lastEvent || {})
  if (method !== 'GET') throw new Error('不支持的HTTP方法')
  const [health, status, errorCount] = await Promise.all([
    handleHealthCheck(),
    handleSystemStatus(),
    countRecentErrors(24)
  ])

  let cloudEnvStatus = null
  let cloudResourceUsage = null
  try {
    const envRes = await cloud.callFunction({ name: 'erp-api', data: { action: 'getCloudEnvStatus', params: {} } })
    cloudEnvStatus = envRes && envRes.result ? envRes.result : envRes
  } catch (_) { }
  try {
    const usageRes = await cloud.callFunction({ name: 'erp-api', data: { action: 'getCloudResourceUsage', params: {} } })
    cloudResourceUsage = usageRes && usageRes.result ? usageRes.result : usageRes
  } catch (_) { }

  const settings = await readSystemSettingsDoc()
  const backup = settings && typeof settings.backup === 'object' ? settings.backup : {}

  return handleSuccess({
    health,
    status,
    errorCountLast24h: errorCount,
    backup,
    cloudEnvStatus,
    cloudResourceUsage
  }, '获取系统概览成功')
}

async function handleUsers(method, params) {
  const path = global.__lastPath || '';
  const idMatch = path.match(/\/users\/([^/?#]+)/);
  const id = params.id || params._id || params.userId || params.uid || (idMatch ? idMatch[1] : '');

  if (method === 'GET') {
    return await handleUsersList(method, params);
  } else if (method === 'POST') {
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'createUser', data: params }
      });
      if (result && result.result && result.result.success) {
        return handleSuccess(result.result.data, '用户创建成功');
      }
      const msg = (result && result.result && result.result.message) || '用户创建失败';
      throw new Error(msg);
    } catch (error) {
      return handleError(error, '用户创建失败');
    }
  } else if (method === 'PUT') {
    if (!id) return handleError(new Error('缺少用户ID'), '用户更新失败');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'updateUser', data: { id, ...params } }
      });
      if (result && result.result && result.result.success) {
        return handleSuccess(result.result.data || { id }, '用户更新成功');
      }
      const msg = (result && result.result && result.result.message) || '用户更新失败';
      throw new Error(msg);
    } catch (error) {
      return handleError(error, '用户更新失败');
    }
  } else if (method === 'DELETE') {
    if (!id) return handleError(new Error('缺少用户ID'), '用户删除失败');
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action: 'deleteUser', data: { id } }
      });
      if (result && result.result && result.result.success) {
        return handleSuccess(result.result.data || { id, deleted: true }, '用户删除成功');
      }
      const msg = (result && result.result && result.result.message) || '用户删除失败';
      throw new Error(msg);
    } catch (error) {
      return handleError(error, '用户删除失败');
    }
  }
  throw new Error('不支持的HTTP方法');
}

async function handleUsersList(method, params) {
  try {
    const { page = 1, limit = 20, keyword } = params || {};
    const nextParams = {
      page: Number(page || 1),
      limit: Number(limit || 20),
      keyword: typeof keyword === 'string' ? keyword.trim() : (keyword == null ? '' : String(keyword).trim())
    };
    const result = await cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getUsers', params: nextParams }
    });
    const payload = result && result.result ? result.result : null;
    if (payload && payload.success) {
      return {
        success: true,
        message: '获取用户列表成功',
        data: Array.isArray(payload.data) ? payload.data : [],
        pagination: payload.pagination && typeof payload.pagination === 'object'
          ? payload.pagination
          : { page: nextParams.page, limit: nextParams.limit, total: Array.isArray(payload.data) ? payload.data.length : 0 }
      };
    }
  } catch (_) { }
  try {
    const result = await cloudAdapter.executeQuery('users', params);
    const list = Array.isArray(result.data) ? result.data : [];
    if (list.length) return handleSuccess(list, '获取用户列表成功');
  } catch (_) { }
  try {
    const resp = await axios.get(`${BACKEND_URL}/api/users`, { params, headers: buildAuthHeaderFromEvent(global.__lastEvent || {}) });
    const payload = Array.isArray(resp?.data?.data) ? resp.data.data : (Array.isArray(resp?.data) ? resp.data : []);
    return handleSuccess(payload, '获取用户列表成功(后端回退)');
  } catch (fallbackError) {
    return handleSuccess([], '获取用户列表成功');
  }
}

// 主入口函数
exports.main = async (event, context) => {
  safeLogJson('API桥接请求:', event);
  // 缓存最近一次事件用于解析请求头中的令牌
  global.__lastEvent = event;

  try {
    // 处理CORS
    const corsResponse = handleCors(event);
    if (event.httpMethod === 'OPTIONS') {
      return corsResponse;
    }

    // 身份验证
    const user = await authenticateRequest(event);

    // 解析请求参数
    const body = parseRequestBody(event);
    const queryParams = parseQueryParams(event);
    const params = { ...queryParams, ...body };

    // 路由分发
    const routePath = resolveRoutePathFromEvent(event, body && body.path, queryParams && queryParams.path) || event.path;
    global.__lastPath = routePath;
    const result = await routeRequest(routePath, event.httpMethod, params, user);

    try {
      const tokenPayload = parseTokenFromHeader(event || {}) || {}
      const isAuthRoute = String(routePath || '').includes('/auth/')
      const isMutation = String(event.httpMethod || '').toUpperCase() !== 'GET'
      const actorUserId = String(tokenPayload.userId || '').trim()
      const actorUsername = String(tokenPayload.username || '').trim()
      if (!isAuthRoute && isMutation && actorUserId && actorUserId !== 'anonymous') {
        await safeWriteLog('operation_logs', {
          ts: Date.now(),
          action: 'api_mutation',
          method: String(event.httpMethod || ''),
          path: String(routePath || ''),
          actorUserId,
          actorUsername,
          success: Boolean(result && result.success !== false),
          message: result && typeof result === 'object' ? (result.message || '') : '',
          detail: redactSensitive(params)
        })
      }
    } catch (_) { }

    return {
      statusCode: corsResponse.statusCode,
      headers: { ...corsResponse.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('API桥接处理错误:', error);

    try {
      const routePath = (event && event.path) ? String(event.path) : ''
      const tokenPayload = parseTokenFromHeader(event || {}) || {}
      await safeWriteLog('error_logs', {
        ts: Date.now(),
        level: 'error',
        message: String((error && error.message) || error || ''),
        path: routePath,
        method: String(event && event.httpMethod ? event.httpMethod : ''),
        actorUserId: String(tokenPayload.userId || '').trim(),
        actorUsername: String(tokenPayload.username || '').trim(),
        detail: {
          errCode: error && error.errCode != null ? error.errCode : undefined,
          statusCode: error && error.statusCode != null ? error.statusCode : undefined
        },
        stack: String(error && error.stack ? error.stack : '').slice(0, 2000)
      })
    } catch (_) { }

    const rawMessage =
      (error && (error.message || error.errMsg || error.err_msg)) ||
      error ||
      '';
    const msg = String(rawMessage).toLowerCase();
    const codeText = error && error.errCode != null ? String(error.errCode) : '';
    const isMissing = msg.includes('database_collection_not_exist') || msg.includes('collection not exist') || msg.includes('collection.get:fail') || codeText === '-502005';
    const isUnauthorized =
      msg.includes('未授权') ||
      msg.includes('unauthorized') ||
      msg.includes('会话已失效') ||
      msg.includes('session') ||
      msg.includes('permission denied') ||
      msg.includes('invalid token') ||
      msg.includes('access denied');
    const isForbidden = msg.includes('无权限') || msg.includes('forbidden');
    const statusCodeFromError =
      Number.isFinite(Number(error?.statusCode))
        ? Number(error.statusCode)
        : (Number.isFinite(Number(error?.errCode)) ? Number(error.errCode) : NaN);
    const statusCode = Number.isFinite(statusCodeFromError)
      ? statusCodeFromError
      : (isForbidden ? 403 : (isUnauthorized ? 401 : (isMissing ? 200 : 500)));

    const errorResponse = handleError(
      error,
      (error && (error.message || error.errMsg || error.err_msg))
        ? String(error.message || error.errMsg || error.err_msg)
        : '操作失败'
    );
    return {
      statusCode,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(errorResponse)
    };
  }
};

// 发货单号生成
async function handleShippingNumbers(method, params) {
  if (method !== 'POST') {
    throw new Error('不支持的HTTP方法');
  }

  try {
    const hasOrder =
      (params && typeof params === 'object')
        ? Boolean(params.orderId || params.orderNo || params.id || params._id)
        : false;
    const action = hasOrder ? 'createShippingOrder' : 'generateShippingNumber';

    // 调用 erp-api 云函数生成发货单号
    const result = await cloud.callFunction({
      name: 'erp-api',
      data: {
        action,
        data: params
      }
    });

    const response = result && result.result ? result.result : {};
    if (!response.success) {
      throw new Error(response.message || response.error || '生成发货单号失败');
    }

    const data = response.data || {};
    return handleSuccess({
      shippingNoteNo:
        data.shippingNoteNo ||
        data.shippingNo ||
        data.orderNo,
      dateKey: data.dateKey,
      seq: data.seq
    }, '生成发货单号成功');
  } catch (error) {
    console.error('生成发货单号失败:', error);
    return handleError(error, '生成发货单号失败');
  }
}

// 兼容旧路径：获取下一个订单号
async function handleOrdersNextNo(method, params) {
  if (method !== 'GET') {
    throw new Error('不支持的HTTP方法')
  }
  const result = await cloud.callFunction({ name: 'erp-api', data: { action: 'reserveOrderNumber' } })
  const data = result && result.result && result.result.data ? result.result.data : {}
  return handleSuccess({ orderNumber: data.orderNumber, reservationId: data.reservationId }, '获取订单号成功')
}
