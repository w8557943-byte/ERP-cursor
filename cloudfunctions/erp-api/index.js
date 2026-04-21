const cloud = require('wx-server-sdk');
const { v4: uuidv4 } = require('uuid');
const iconv = require('iconv-lite');
const { login, logout, generateToken } = require('./login-functions');

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const axios = require('axios');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const BACKEND_URL = process.env.ERP_BACKEND_URL || 'http://localhost:3005';
const SUPER_ADMIN_USERNAME = '13817508995';

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
            void 0;
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

// 全局错误处理器
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason, '在Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

/**
 * ERP核心业务API云函数
 * 提供订单、客户、产品、生产等核心业务数据操作
 */
exports.main = async (event, context) => {
  const debugLog = String(process.env.ERP_API_DEBUG_LOG || '').toLowerCase() === 'true';
  if (debugLog) {
    safeLogJson('[ERP-API] 接收到的事件:', event);
    safeLogJson('[ERP-API] 接收到的上下文:', context);
  }

  const { action, data = {}, params = {} } = event;
  const wxContext = cloud.getWXContext();

  console.log(`[ERP-API] 操作: ${action}, 用户: ${wxContext.OPENID}`);

  if (action === 'restoreCustomer') {
    console.log('[ERP-API] restoreCustomer called with:', JSON.stringify(data));
  }

  const perfStartAt = Date.now();
  const perfSlowMsRaw = Number(process.env.ERP_API_SLOW_MS);
  const perfSlowMs = Number.isFinite(perfSlowMsRaw) && perfSlowMsRaw > 0 ? perfSlowMsRaw : 800;
  const perfSampleRaw = Number(process.env.ERP_API_SAMPLE_RATE);
  const perfSampleRate = Number.isFinite(perfSampleRaw) && perfSampleRaw > 0 ? Math.min(perfSampleRaw, 1) : 0.1;
  const perfSampled = perfSampleRate > 0 ? (Math.random() < perfSampleRate) : false;

  try {
    if (debugLog) {
      safeLogJson(`[erp-api] 开始处理请求，action: ${action}, data:`, data);
    }

    switch (action) {
      // 认证相关API
      case 'login':
        console.log(`[erp-api] 调用登录函数`);
        return await login(data, wxContext);
      case 'logout':
        console.log(`[erp-api] 调用登出函数`);
        return await logout(wxContext);
      case 'refreshToken':
        return await refreshToken(data, wxContext);

      // 验证码相关API
      case 'requestVerifyCode':
        return await requestVerifyCode(data);
      case 'loginWithCode':
        return await loginWithCode(data, wxContext);
      case 'getPhoneNumber':
        return await getPhoneNumber(data);
      case 'loginWithPhoneNumber':
        return await loginWithPhoneNumber(data, wxContext);
      case 'getUserSession':
        return await getUserSession(data);
      case 'verifySession':
        return await verifySession(data);

      // 订单相关API
      case 'getOrders':
        return await getOrders({ ...params, ...data });
      case 'getPurchaseOrders':
        return await getPurchaseOrders({ ...params, ...data });
      case 'createOrder':
      case 'createPurchaseOrder': // 兼容采购单创建
        if (action === 'createPurchaseOrder') {
          data.orderType = 'purchase';
          data.source = 'purchased';
        }
        return await createOrder(data, wxContext);
      case 'diagnoseOrdersWrite':
        return await diagnoseOrdersWrite({ ...(typeof params === 'object' ? params : {}), ...(typeof data === 'object' ? data : {}) }, wxContext);
      case 'migrateOrdersTmpToOrders':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await migrateOrdersTmpToOrders(mergedPayload, wxContext);
        }
      case 'updatePurchaseOrder':
        return await updatePurchaseOrder(data, wxContext);
      case 'relinkBoardPurchaseAssociation':
        return await relinkBoardPurchaseAssociation(data, wxContext);
      case 'syncBoardUsageOnStart':
        return await syncBoardUsageOnStart(data, wxContext);
      case 'updateOrder':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateOrder(mergedUpdate, wxContext);
        }
      case 'stockInPurchaseOrder':
        return await stockInPurchaseOrder(data, wxContext);
      case 'deleteOrder':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await deleteOrder(mergedPayload, wxContext);
        }
      case 'deletePurchaseOrder':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await deletePurchaseOrder(mergedPayload, wxContext);
        }
      case 'purgeDeletedOrders':
      case 'purgeSoftDeletedOrders':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await purgeDeletedOrders(mergedPayload, wxContext);
        }
      case 'getOrderDetail':
        return await getOrderDetail(data.id);
      case 'fixMissingOrderQRCodes':
        return await fixMissingOrderQRCodes(params);
      case 'fixDuplicateOrders':
        return await fixDuplicateOrders(params);
      case 'rollbackOrderNumberFix':
        return await rollbackOrderNumberFix(params);
      case 'verifyOrderNumberUniqueness':
        return await verifyOrderNumberUniqueness(params);
      case 'createShippingOrder':
        return await createShippingOrder(data, wxContext);
      case 'generateShippingNumber':
        return await generateShippingNumberAction(data);
      case 'getPurchaseOrderDetail':
        return await getPurchaseOrderDetail(data.id);
      case 'generateOrderNumber':
        return { success: true, data: { orderNumber: await generateOrderNumberDaily() } };
      case 'reserveOrderNumber':
        return await reserveOrderNumber(wxContext);
      case 'releaseOrderNumber':
        return await releaseOrderNumber(data, wxContext);
      case 'getOrderNumberMaxSeq':
        return await getOrderNumberMaxSeqAction(params);

      // 客户相关API
      case 'getCustomers':
        return await getCustomers(params, wxContext);
      case 'getCustomerById':
        {
          const merged = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await getCustomerById(merged.customerId || merged.id || merged._id || merged.docId, wxContext);
        }
      case 'diagnoseCustomerVisibility':
        {
          const merged = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await diagnoseCustomerVisibility(merged, wxContext);
        }
      case 'createCustomer':
        return await createCustomer(data, wxContext);
      case 'updateCustomer':
        // 兼容顶层传参：有些页面直接把更新字段放在 event 顶层
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateCustomer(mergedUpdate, wxContext);
        }
      case 'deleteCustomer':
        const mergedPayload = {
          ...(typeof event === 'object' ? event : {}),
          ...(typeof data === 'object' ? data : {}),
          ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
          ...(typeof params === 'object' ? params : {})
        };
        const deleteResult = await deleteCustomer(mergedPayload, wxContext);
        return deleteResult;
      case 'restoreCustomer':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await restoreCustomer(mergedPayload, wxContext);
        }

      // 产品相关API
      case 'getProducts':
        return await getProducts(params);
      case 'createProduct':
        return await createProduct(data, wxContext);
      case 'getSuppliers':
        return await getSuppliers(params);
      case 'createSupplier':
        return await createSupplier(data, wxContext);
      case 'updateSupplier':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateSupplier(mergedUpdate, wxContext);
        }
      case 'deleteSupplier':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await deleteSupplier(mergedPayload, wxContext);
        }
      case 'restoreSupplier':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await restoreSupplier(mergedPayload, wxContext);
        }
      case 'getProductCategories':
        return await getProductCategories(params);
      case 'createProductCategory':
        return await createProductCategory(data, wxContext);
      case 'updateProduct':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateProduct(mergedUpdate, wxContext);
        }
      case 'deleteProduct':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await deleteProduct(mergedPayload, wxContext);
        }

      // 库存相关API
      case 'getInventory':
        return await getInventory(params);
      case 'updateInventory':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateInventory(mergedUpdate, wxContext);
        }

      // 生产相关API
      case 'getProductionPlans':
        return await getProductionPlans({ ...params, ...data });
      case 'getProductionPlanDetail':
        return await getProductionPlanDetail((data && (data.id || data.planId || data._id)) || (params && (params.id || params.planId || params._id)));
      case 'createProductionPlan':
        return await createProductionPlan(data, wxContext);
      case 'updateProductionPlan':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateProductionPlan(mergedUpdate, wxContext);
        }
      case 'updateProductionStatus':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateProductionStatus(mergedUpdate, wxContext);
        }

      // 用户相关API
      case 'getUsers':
        return await getUsers(params);
      case 'createUser':
        return await createUser(data, wxContext);
      case 'updateUser':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateUser(mergedUpdate, wxContext);
        }
      case 'deleteUser':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await deleteUser(mergedPayload, wxContext);
        }
      case 'updateUserProfile':
        {
          const mergedUpdate = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await updateUserProfile(mergedUpdate, wxContext);
        }
      case 'changePassword':
        {
          const mergedPayload = {
            ...(typeof event === 'object' ? event : {}),
            ...(typeof data === 'object' ? data : {}),
            ...(typeof params === 'object' ? params : {})
          };
          return await changePassword(mergedPayload, wxContext);
        }
      case 'getMonthOrderCount':
        return await getMonthOrderCount(params);
      case 'getProductionEfficiencyStats':
        return await getProductionEfficiencyStats(params);

      // 统计数据API
      case 'getDashboardStats':
        return await getDashboardStats(params);
      case 'getWorkbenchOverviewStats':
        return await getWorkbenchOverviewStats({
          ...(typeof params === 'object' ? params : {}),
          ...(typeof data === 'object' ? data : {})
        });
      case 'getOrderOverview':
        return await getOrderOverview(params);
      case 'getOrderStats':
        return await getOrderStats(params);
      case 'getProductionStats':
        return await getProductionStats(params);
      case 'getDataManagementStats':
        return await getDataManagementStats({
          ...(typeof params === 'object' ? params : {}),
          ...(typeof data === 'object' ? data : {})
        });
      case 'getCloudResourceUsage':
        return await getCloudResourceUsage(params);
      case 'getCloudEnvStatus':
        return await getCloudEnvStatus(params);

      case 'encodeGb18030':
        return await encodeGb18030(data);

      default:
        throw new Error(`不支持的操作: ${action}`);
    }
  } catch (error) {
    console.error(`[ERP-API] ${action} 失败:`, error);
    console.error(`[ERP-API] 错误堆栈:`, error.stack);

    return {
      success: false,
      message: error.message, // 统一使用 message 字段
      error: error.message,   // 保留 error 字段以兼容旧代码
      action,
      timestamp: Date.now()
    };
  } finally {
    const durationMs = Date.now() - perfStartAt;
    if (durationMs >= perfSlowMs || (perfSampled && durationMs >= Math.floor(perfSlowMs / 2))) {
      try {
        const meta = {
          action,
          durationMs,
          openid: wxContext && wxContext.OPENID ? wxContext.OPENID : undefined
        };
        console.log('[erp-api][perf]', JSON.stringify(meta));
      } catch (_) {
        console.log('[erp-api][perf]', `action=${action} durationMs=${durationMs}`);
      }
    }
  }
};

async function getCloudEnvStatus(params = {}) {
  const envId = params.envId || process.env.WX_CLOUD_ENV || 'erp-system-prod-1glmda1zf4f9c7a7';
  const secretId = process.env.TCB_SECRET_ID;
  const secretKey = process.env.TCB_SECRET_KEY;
  const token = process.env.TCB_TOKEN;
  const effectiveSecretId = sanitizeEnvSecret(secretId);
  const effectiveSecretKey = sanitizeEnvSecret(secretKey);
  const effectiveToken = sanitizeEnvSecret(token);

  return {
    success: true,
    data: {
      envId,
      hasSecretId: Boolean(secretId),
      hasSecretKey: Boolean(secretKey),
      hasToken: Boolean(token),
      secretIdLength: secretId ? String(secretId).length : 0,
      secretKeyLength: secretKey ? String(secretKey).length : 0,
      tokenLength: token ? String(token).length : 0,
      effectiveHasSecretId: Boolean(effectiveSecretId),
      effectiveHasSecretKey: Boolean(effectiveSecretKey),
      effectiveHasToken: Boolean(effectiveToken),
      effectiveSecretIdLength: effectiveSecretId ? String(effectiveSecretId).length : 0,
      effectiveSecretKeyLength: effectiveSecretKey ? String(effectiveSecretKey).length : 0,
      effectiveTokenLength: effectiveToken ? String(effectiveToken).length : 0
    }
  };
}

function sanitizeEnvSecret(value) {
  if (value === null || typeof value === 'undefined') return value;
  const str = String(value).trim();
  return str.replace(/^<+/, '').replace(/>+$/, '');
}

function buildOrderQrPayload({ orderId, orderNo }) {
  return JSON.stringify({ v: 1, orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() });
}

function buildQrServerUrl(payload, size = 220) {
  const s = Number(size) || 220;
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(String(payload || ''))}`;
}

function parseQrServerPayload(url) {
  try {
    const u = new URL(String(url || ''));
    const data = u.searchParams.get('data');
    if (!data) return null;
    const decoded = decodeURIComponent(data);
    try {
      return JSON.parse(decoded);
    } catch (_) {
      return { raw: decoded };
    }
  } catch (_) {
    return null;
  }
}

function isQrCodeUrlForOrder(url, orderId) {
  const parsed = parseQrServerPayload(url);
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.orderId) return false;
  return String(parsed.orderId) === String(orderId);
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmacSha256(key, msg, encoding) {
  const hmac = crypto.createHmac('sha256', key).update(msg, 'utf8');
  return encoding ? hmac.digest(encoding) : hmac.digest();
}

async function tencentCloudRequest({ action, version, payload, secretId, secretKey, token }) {
  const host = 'tcb.tencentcloudapi.com';
  const service = 'tcb';
  const contentType = 'application/json; charset=utf-8';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payloadStr = JSON.stringify(payload || {});

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payloadStr)}`;

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp)
  };

  if (token) {
    headers['X-TC-Token'] = token;
  }

  const res = await axios.post(`https://${host}/`, payloadStr, { headers });
  return res.data;
}

async function describeQuotaData({ envId, metricName, secretId, secretKey, token }) {
  const payload = {
    EnvId: envId,
    MetricName: metricName
  };
  const data = await tencentCloudRequest({
    action: 'DescribeQuotaData',
    version: '2018-06-08',
    payload,
    secretId,
    secretKey,
    token
  });
  return data;
}

function normalizeDescribeQuotaDataResult(raw) {
  const resp = raw && raw.Response ? raw.Response : raw;
  if (!resp || typeof resp !== 'object') return null;

  const directValue = typeof resp.Value !== 'undefined' ? resp.Value : undefined;
  const directQuota = typeof resp.SubValue !== 'undefined' ? resp.SubValue : undefined;
  if (typeof directValue !== 'undefined' || typeof directQuota !== 'undefined') {
    return {
      value: typeof directValue === 'undefined' ? null : directValue,
      quota: typeof directQuota === 'undefined' ? null : directQuota
    };
  }

  const dataList = Array.isArray(resp.QuotaData) ? resp.QuotaData : Array.isArray(resp.Data) ? resp.Data : null;
  if (dataList && dataList.length) {
    const item = dataList[0] || {};
    const value =
      typeof item.Value !== 'undefined'
        ? item.Value
        : typeof item.Used !== 'undefined'
          ? item.Used
          : typeof item.UsedValue !== 'undefined'
            ? item.UsedValue
            : null;
    const quota =
      typeof item.SubValue !== 'undefined'
        ? item.SubValue
        : typeof item.Total !== 'undefined'
          ? item.Total
          : typeof item.TotalValue !== 'undefined'
            ? item.TotalValue
            : null;
    if (value !== null || quota !== null) return { value, quota };
  }

  return null;
}

async function describeEnvFreeQuota({ envId, secretId, secretKey, token }) {
  const payload = {
    EnvId: envId
  };
  const data = await tencentCloudRequest({
    action: 'DescribeEnvFreeQuota',
    version: '2018-06-08',
    payload,
    secretId,
    secretKey,
    token
  });
  return data;
}

async function describePostpayPackageFreeQuotas({ envId, secretId, secretKey, token }) {
  const payload = {
    EnvId: envId
  };
  const data = await tencentCloudRequest({
    action: 'DescribePostpayPackageFreeQuotas',
    version: '2018-06-08',
    payload,
    secretId,
    secretKey,
    token
  });
  return data;
}

function pickFirstFiniteNumber(obj, keys) {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function extractQuotaItems(resp) {
  if (!resp) return [];
  const candidates = ['QuotaItems', 'PackageFreeQuotas', 'PackageQuotas', 'FreeQuotas', 'Quotas', 'Items', 'Data'];
  for (const key of candidates) {
    if (Array.isArray(resp[key])) return resp[key];
  }
  return [];
}

function normalizeQuotaItems(raw) {
  const resp = raw && raw.Response ? raw.Response : raw;
  const items = extractQuotaItems(resp);
  return items
    .map((item) => {
      const name =
        item.MetricName ||
        item.QuotaName ||
        item.QuotaType ||
        item.ResourceName ||
        item.Resource ||
        item.PackageType ||
        item.Name ||
        item.Type ||
        item.Key ||
        '';

      const used = pickFirstFiniteNumber(item, [
        'UsedQuota',
        'Used',
        'UsedValue',
        'Value',
        'UsedSize',
        'Usage',
        'UsedAmount',
        'TodayUsedQuota',
        'MonthUsedQuota'
      ]);

      const total = pickFirstFiniteNumber(item, [
        'TotalQuota',
        'Total',
        'TotalValue',
        'SubValue',
        'Quota',
        'Limit',
        'TotalAmount',
        'MonthQuota',
        'TodayQuota'
      ]);

      return { name: String(name), used, total };
    })
    .filter((x) => x.name);
}

async function describeQuotaDataWithCandidates({ envId, metricCandidates, secretId, secretKey, token }) {
  const candidates = Array.isArray(metricCandidates) ? metricCandidates : [];
  let lastError = null;

  for (const metricName of candidates) {
    try {
      const raw = await describeQuotaData({ envId, metricName, secretId, secretKey, token });
      const normalized = normalizeDescribeQuotaDataResult(raw);
      if (normalized) {
        return { ok: true, metricName, response: raw && raw.Response ? raw.Response : null, normalized };
      }
      lastError = new Error('接口返回为空');
    } catch (e) {
      lastError = e;
    }
  }

  return { ok: false, error: lastError ? (lastError.message || String(lastError)) : '获取失败' };
}

async function getCloudResourceUsage(params = {}) {
  const envId = params.envId || process.env.WX_CLOUD_ENV || 'erp-system-prod-1glmda1zf4f9c7a7';
  const secretId = sanitizeEnvSecret(process.env.TCB_SECRET_ID);
  const secretKey = sanitizeEnvSecret(process.env.TCB_SECRET_KEY);
  const token = sanitizeEnvSecret(process.env.TCB_TOKEN);

  const metrics = [];

  const quotaMetricCatalog = [
    {
      key: 'MonthlyCapacity',
      label: '本月容量',
      candidates: ['Storagepkg', 'StorageCapacitypkg', 'StorageCapacity', 'Storage']
    },
    {
      key: 'MonthlyCalls',
      label: '本月调用次数',
      candidates: ['FunctionInvocationpkg', 'FunctionInvocation', 'Invocationpkg']
    },
    {
      key: 'MonthlyCDNTraffic',
      label: '本月 CDN 流量',
      candidates: ['CdnTrafficpkg', 'CDNTrafficpkg', 'CdnOutTrafficpkg', 'CdnTraffic', 'CDNTraffic', 'CdnOutTraffic']
    }
  ];

  if (!secretId || !secretKey) {
    const errMsg = '未配置云开发密钥（TCB_SECRET_ID / TCB_SECRET_KEY）';
    quotaMetricCatalog.forEach((m) => {
      metrics.push({
        metricName: m.key,
        label: m.label,
        value: null,
        quota: null,
        error: errMsg
      });
    });
  } else {
    let fallbackItems = [];
    await Promise.all([
      (async () => {
        try {
          const raw = await describeEnvFreeQuota({ envId, secretId, secretKey, token });
          fallbackItems = fallbackItems.concat(normalizeQuotaItems(raw));
        } catch (e) { }
      })(),
      (async () => {
        try {
          const raw = await describePostpayPackageFreeQuotas({ envId, secretId, secretKey, token });
          fallbackItems = fallbackItems.concat(normalizeQuotaItems(raw));
        } catch (e) { }
      })()
    ]);

    const pickByPatterns = (patterns) => {
      const lowerPatterns = patterns.map((p) => (p instanceof RegExp ? p : new RegExp(String(p), 'i')));
      const hit = fallbackItems.find((x) => lowerPatterns.some((re) => re.test(x.name)));
      return hit && (Number.isFinite(Number(hit.used)) || Number.isFinite(Number(hit.total))) ? hit : null;
    };

    const fallbackByKey = {
      MonthlyCapacity: pickByPatterns([/storage/i, /容量/i]),
      MonthlyCalls: pickByPatterns([/function/i, /invocation/i, /调用/i]),
      MonthlyCDNTraffic: pickByPatterns([/cdn/i, /traffic/i, /流量/i])
    };

    const results = await Promise.all(
      quotaMetricCatalog.map(async (m) => {
        const got = await describeQuotaDataWithCandidates({
          envId,
          metricCandidates: m.candidates,
          secretId,
          secretKey,
          token
        });

        if (!got.ok) {
          const fallback = fallbackByKey[m.key];
          if (fallback) {
            return {
              metricName: m.key,
              label: m.label,
              value: fallback.used,
              quota: fallback.total,
              sourceMetricName: fallback.name
            };
          }
          return {
            metricName: m.key,
            label: m.label,
            value: null,
            quota: null,
            error: got.error || '接口暂不支持该指标'
          };
        }

        const resp = got.response;
        const fallback = fallbackByKey[m.key];
        const normalized = got.normalized || normalizeDescribeQuotaDataResult({ Response: resp });
        const value = normalized ? normalized.value : null;
        const quota = normalized ? normalized.quota : null;
        const mergedValue = value === null && fallback ? fallback.used : value;
        const mergedQuota = quota === null && fallback ? fallback.total : quota;
        return {
          metricName: m.key,
          label: m.label,
          value: mergedValue,
          quota: mergedQuota,
          sourceMetricName: got.metricName
        };
      })
    );

    results.forEach((x) => metrics.push(x));
  }

  try {
    const CST_OFFSET_MS = 8 * 60 * 60 * 1000;
    const getCSTDate = (ts) => new Date(ts + CST_OFFSET_MS);
    const startOfDayCST = (ts) => {
      const d = getCSTDate(ts);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth();
      const day = d.getUTCDate();
      return Date.UTC(year, month, day, 0, 0, 0, 0) - CST_OFFSET_MS;
    };

    const todayStart = startOfDayCST(Date.now());
    const activeTodayCountRes = await db
      .collection('users')
      .where({
        status: 'active',
        lastLoginAt: _.gte(todayStart)
      })
      .count();

    const totalActiveUsersRes = await db
      .collection('users')
      .where({ status: 'active' })
      .count();

    metrics.push({
      metricName: 'DailyActiveUsers',
      label: '今日活跃用户',
      value: activeTodayCountRes && typeof activeTodayCountRes.total === 'number' ? activeTodayCountRes.total : 0,
      quota: totalActiveUsersRes && typeof totalActiveUsersRes.total === 'number' ? totalActiveUsersRes.total : null
    });
  } catch (e) {
    metrics.push({
      metricName: 'DailyActiveUsers',
      label: '今日活跃用户',
      value: null,
      quota: null,
      error: e && e.message ? e.message : String(e)
    });
  }

  return {
    success: true,
    data: {
      envId,
      metrics
    }
  };
}

const SUPER_ADMIN_PHONE = '13817508995';
const VERIFY_CODE_DEBUG_RETURN = String(process.env.VERIFY_CODE_DEBUG_RETURN || '').toLowerCase() === 'true';
const VERIFY_CODE_DEBUG_ACCEPT = String(process.env.VERIFY_CODE_DEBUG_ACCEPT || '').toLowerCase() === 'true';

function isCollectionNotExistError(error) {
  const errCode = error && (error.errCode || error.code);
  if (errCode === -502005) return true;
  const msg = String((error && (error.errMsg || error.message)) || '').toLowerCase();
  return msg.includes('collection not exist') || msg.includes('database_collection_not_exist') || msg.includes('collection_not_exist');
}

async function ensureCollectionExists(collectionName) {
  if (!collectionName) return;
  try {
    await db.createCollection(collectionName);
  } catch (_) { }
}

async function sendTencentSms({ phone, code }) {
  const secretId = process.env.TENCENT_SMS_SECRET_ID;
  const secretKey = process.env.TENCENT_SMS_SECRET_KEY;
  const smsSdkAppId = process.env.TENCENT_SMS_SDK_APP_ID;
  const signName = process.env.TENCENT_SMS_SIGN_NAME;
  const templateId = process.env.TENCENT_SMS_TEMPLATE_ID;
  const region = process.env.TENCENT_SMS_REGION || 'ap-guangzhou';

  if (!secretId || !secretKey || !smsSdkAppId || !signName || !templateId) {
    const missing = [];
    if (!secretId) missing.push('TENCENT_SMS_SECRET_ID');
    if (!secretKey) missing.push('TENCENT_SMS_SECRET_KEY');
    if (!smsSdkAppId) missing.push('TENCENT_SMS_SDK_APP_ID');
    if (!signName) missing.push('TENCENT_SMS_SIGN_NAME');
    if (!templateId) missing.push('TENCENT_SMS_TEMPLATE_ID');
    const suffix = missing.length ? `（缺少：${missing.join(', ')}）` : '';
    return {
      ok: false,
      message: `短信服务未配置${suffix}。请在云函数 erp-api 的环境变量中配置后重新部署`
    };
  }

  const endpoint = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const action = 'SendSms';
  const version = '2021-01-11';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payloadObj = {
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: smsSdkAppId,
    SignName: signName,
    TemplateId: templateId,
    TemplateParamSet: [String(code)]
  };
  const payload = JSON.stringify(payloadObj);
  const hashedPayload = sha256Hex(payload);

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${endpoint}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, service);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign, 'hex');

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers = {
    Authorization: authorization,
    'Content-Type': 'application/json; charset=utf-8',
    Host: endpoint,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region
  };

  const resp = await axios.post(`https://${endpoint}`, payload, { headers, timeout: 10000 });
  const data = resp && resp.data ? resp.data : null;
  const statusSet = data && data.Response && Array.isArray(data.Response.SendStatusSet) ? data.Response.SendStatusSet : [];
  const first = statusSet[0] || {};
  const ok = String(first.Code || '').toLowerCase() === 'ok';
  const message = first.Message || (data && data.Response && data.Response.Error && data.Response.Error.Message) || '';
  return { ok, message, raw: data };
}

function classifyPhoneNumberOpenapiError(error) {
  const errCode = error && (error.errCode || error.code);
  const errMsg = String((error && (error.errMsg || error.message)) || error || '');
  const lower = errMsg.toLowerCase();

  if ((lower.includes('need') && lower.includes('verify')) || lower.includes('needrealnameverify')) {
    return {
      errorCode: 'WECHAT_NEED_VERIFY',
      message: '获取手机号失败：该微信号手机号需要先完成验证，请在真机完成手机号验证后重试',
      errCode,
      errMsg
    };
  }

  if (
    (lower.includes('invalid') && lower.includes('code')) ||
    (lower.includes('code') && lower.includes('illegal')) ||
    (lower.includes('code') && lower.includes('used'))
  ) {
    return {
      errorCode: 'INVALID_CODE',
      message: '获取手机号失败：code无效，请重新点击“一键获取”',
      errCode,
      errMsg
    };
  }

  return {
    errorCode: 'OPENAPI_ERROR',
    message: '获取手机号失败：微信接口调用失败，请稍后重试或使用密码登录',
    errCode,
    errMsg
  };
}

async function getPhoneNumber(data) {
  const { code } = data || {};
  if (!code) {
    return { success: false, message: '缺少code', errorCode: 'MISSING_CODE' };
  }

  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const info = res && (res.phone_info || res.phoneInfo) ? (res.phone_info || res.phoneInfo) : null;
    const phone = info && (info.purePhoneNumber || info.phoneNumber) ? String(info.purePhoneNumber || info.phoneNumber) : '';
    if (!phone) {
      console.error('[getPhoneNumber] openapi返回但未获取到phone_info:', JSON.stringify(res || {}));
      return { success: false, message: '获取手机号失败：微信未返回手机号信息', errorCode: 'NO_PHONE_INFO' };
    }
    return {
      success: true,
      message: '获取手机号成功',
      data: {
        phone,
        maskedPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
      }
    };
  } catch (error) {
    const classified = classifyPhoneNumberOpenapiError(error);
    console.error('[getPhoneNumber] openapi调用失败:', JSON.stringify({
      errCode: classified.errCode,
      errMsg: classified.errMsg
    }));
    return { success: false, message: classified.message, errorCode: classified.errorCode };
  }
}

async function loginWithPhoneNumber(data, wxContext) {
  const { code } = data || {};
  if (!code) {
    return { success: false, message: '缺少code', errorCode: 'MISSING_CODE' };
  }

  const requestId = uuidv4();
  console.log('[loginWithPhoneNumber] start:', JSON.stringify({
    requestId,
    appid: wxContext && wxContext.APPID ? wxContext.APPID : '',
    openid: wxContext && wxContext.OPENID ? wxContext.OPENID : '',
    clientIP: wxContext && wxContext.CLIENTIP ? wxContext.CLIENTIP : ''
  }));

  let phone = '';
  let openapiRes = null;
  try {
    openapiRes = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const rawPhoneInfo = openapiRes ? (openapiRes.phone_info || openapiRes.phoneInfo) : null;
    console.log('[loginWithPhoneNumber] openapi返回:', JSON.stringify({
      requestId,
      hasPhoneInfo: Boolean(rawPhoneInfo),
      responseKeys: openapiRes ? Object.keys(openapiRes) : [],
      phoneInfoKeys: rawPhoneInfo ? Object.keys(rawPhoneInfo) : []
    }));
    const info = rawPhoneInfo || null;
    phone = info && (info.purePhoneNumber || info.phoneNumber) ? String(info.purePhoneNumber || info.phoneNumber) : '';
  } catch (error) {
    const classified = classifyPhoneNumberOpenapiError(error);
    console.error('[loginWithPhoneNumber] openapi调用失败:', JSON.stringify({
      requestId,
      errCode: classified.errCode,
      errMsg: classified.errMsg
    }));
    return { success: false, message: classified.message, errorCode: classified.errorCode };
  }

  if (!phone) {
    const rawPhoneInfo = openapiRes ? (openapiRes.phone_info || openapiRes.phoneInfo) : null;
    const debug = {
      requestId,
      appid: wxContext && wxContext.APPID ? wxContext.APPID : '',
      hasPhoneInfo: Boolean(rawPhoneInfo),
      responseKeys: openapiRes ? Object.keys(openapiRes) : [],
      phoneInfoKeys: rawPhoneInfo ? Object.keys(rawPhoneInfo) : []
    };
    try {
      console.error('[loginWithPhoneNumber] phone为空:', JSON.stringify({
        requestId,
        hasPhoneInfo: Boolean(rawPhoneInfo),
        responseKeys: openapiRes ? Object.keys(openapiRes) : [],
        phoneInfoKeys: rawPhoneInfo ? Object.keys(rawPhoneInfo) : []
      }));
    } catch (_) { }
    return {
      success: false,
      message: '获取手机号失败：微信未返回手机号信息，请在真机完成手机号验证后重试',
      errorCode: 'NO_PHONE_INFO',
      debug
    };
  }

  const userRes = await db
    .collection('users')
    .where(
      _.or([
        { phone },
        { username: phone }
      ])
    )
    .limit(20)
    .get();

  const candidates = userRes && Array.isArray(userRes.data) ? userRes.data : [];
  let user = candidates
    .slice()
    .sort((a, b) => {
      const aScore = Number(a.updatedAt || a.createdAt || 0) || 0;
      const bScore = Number(b.updatedAt || b.createdAt || 0) || 0;
      return bScore - aScore;
    })[0] || null;
  if (!user) {
    if (phone === SUPER_ADMIN_PHONE) {
      const now = Date.now();
      const baseUser = {
        _id: uuidv4(),
        username: phone,
        phone,
        name: '超级管理员',
        role: 'admin',
        status: 'active',
        avatar: '/images/profile.png',
        createdAt: now,
        updatedAt: now,
        createdBy: wxContext.OPENID,
        updatedBy: wxContext.OPENID
      };
      const addRes = await db.collection('users').add({ data: baseUser });
      user = { ...baseUser, _id: addRes && addRes._id ? addRes._id : baseUser._id };
    } else {
      return { success: false, message: '该手机号未开通，请联系管理员添加', errorCode: 'USER_NOT_FOUND' };
    }
  }
  const deletedFlag =
    user && (user.isDeleted === true || user.deleted === true || user.deletedAt || user.removedAt);
  if (deletedFlag) {
    return { success: false, message: '该手机号未开通，请联系管理员添加', errorCode: 'USER_NOT_FOUND' };
  }
  if (user.status && String(user.status) !== 'active') {
    return { success: false, message: '账号已停用', errorCode: 'USER_INACTIVE' };
  }

  if (phone === SUPER_ADMIN_PHONE && !(user.role === 'admin' || user.role === 'administrator')) {
    const now = Date.now();
    try {
      await db.collection('users').doc(user._id).update({
        data: { role: 'admin', updatedAt: now, updatedBy: wxContext.OPENID }
      });
      user = { ...user, role: 'admin' };
    } catch (_) { }
  }

  const sessionId = uuidv4();
  const token = generateToken(user, { platform: 'mp', sessionId });
  const now = Date.now();
  try {
    await db.collection('users').doc(user._id).update({
      data: {
        lastLoginAt: now,
        lastLoginIP: wxContext.CLIENTIP,
        lastLoginOpenid: wxContext.OPENID,
        currentSessionId: sessionId,
        currentSessionIdMp: sessionId,
        updatedAt: now,
        updatedBy: wxContext.OPENID
      }
    });
  } catch (_) { }

  return {
    success: true,
    data: {
      token,
      sessionId,
      user: {
        id: user._id,
        username: user.username,
        name: user.name || user.realName || user.username,
        role: user.role,
        phone: user.phone || '',
        avatar: user.avatar,
        department: user.department,
        companyName: user.companyName || '',
        introduction: user.introduction || ''
      }
    },
    message: '登录成功'
  };
}

async function getUserSession(data) {
  const { id, _id, userId, platform, terminal, client } = data || {};
  const actualId = id || _id || userId;
  if (!actualId) throw new Error('用户ID不能为空');

  const doc = await db.collection('users').doc(String(actualId)).get();
  const user = doc && doc.data ? doc.data : null;
  if (!user) {
    return { success: false, message: '用户不存在', errorCode: 'USER_NOT_FOUND' };
  }

  return {
    success: true,
    data: {
      currentSessionId: (() => {
        const p = String(platform || terminal || client || '').toLowerCase();
        if (p === 'pc') return user.currentSessionIdPc || '';
        return user.currentSessionIdMp || user.currentSessionId || '';
      })(),
      status: user.status || 'active'
    },
    message: 'ok'
  };
}

async function verifySession(data) {
  const { id, _id, userId, sessionId, platform, terminal, client } = data || {};
  const actualId = id || _id || userId;
  const actualSessionId = sessionId ? String(sessionId) : '';
  if (!actualId) throw new Error('用户ID不能为空');
  if (!actualSessionId) throw new Error('会话标识不能为空');

  const doc = await db.collection('users').doc(String(actualId)).get();
  const user = doc && doc.data ? doc.data : null;
  if (!user) {
    return { success: false, message: '用户不存在', errorCode: 'USER_NOT_FOUND' };
  }

  const deletedFlag =
    user && (user.isDeleted === true || user.deleted === true || user.deletedAt || user.removedAt);
  if (deletedFlag) {
    return { success: false, message: '用户不存在', errorCode: 'USER_NOT_FOUND' };
  }

  if (user.status && String(user.status) !== 'active') {
    return { success: false, message: '账号已停用', errorCode: 'USER_INACTIVE' };
  }

  const p = String(platform || terminal || client || '').toLowerCase();
  const remoteSessionId =
    p === 'pc'
      ? (user.currentSessionIdPc ? String(user.currentSessionIdPc) : '')
      : (user.currentSessionIdMp ? String(user.currentSessionIdMp) : user.currentSessionId ? String(user.currentSessionId) : '');
  if (!remoteSessionId || remoteSessionId !== actualSessionId) {
    return { success: false, message: '会话已失效', errorCode: 'SESSION_INVALID' };
  }

  return {
    success: true,
    data: { ok: true },
    message: 'ok'
  };
}

/**
 * 申请短信验证码
 */
async function requestVerifyCode(data) {
  const { phone } = data || {};
  const db = cloud.database();

  // 参数与格式校验
  if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
    return { success: false, message: '手机号格式不正确' };
  }

  // 频率限制：60秒内不可重复申请
  try {
    const lastRes = await db.collection('verify_codes')
      .where({ phone })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    if (lastRes.data && lastRes.data.length > 0) {
      const last = lastRes.data[0];
      if (Date.now() - (last.createdAt || 0) < 60 * 1000) {
        return { success: false, message: '请求过于频繁，请稍后再试' };
      }
    }
  } catch (error) {
    if (!isCollectionNotExistError(error)) {
      throw error;
    }
  }

  // 生成6位验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const doc = {
    _id: `vc_${uuidv4()}`,
    phone,
    code,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + 5 * 60 * 1000
  };

  try {
    await db.collection('verify_codes').add({ data: doc });
  } catch (error) {
    if (!isCollectionNotExistError(error)) throw error;
    await ensureCollectionExists('verify_codes');
    await db.collection('verify_codes').add({ data: doc });
  }

  const smsRes = await sendTencentSms({ phone, code });
  if (!smsRes.ok) {
    if (VERIFY_CODE_DEBUG_RETURN) {
      return {
        success: true,
        message: '验证码已发送',
        data: {
          maskedPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'),
          code
        }
      };
    }
    return { success: false, message: smsRes.message || '短信发送失败' };
  }

  // 发送短信的实际逻辑应接入短信服务商SDK（此处演示返回）
  return {
    success: true,
    message: '验证码已发送',
    data: {
      maskedPhone: phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    }
  };
}

/**
 * 验证码登录
 */
async function loginWithCode(data, wxContext) {
  const { phone, code } = data || {};
  const db = cloud.database();
  const platform = String(data?.platform || data?.terminal || data?.client || '').toLowerCase() === 'pc' ? 'pc' : 'mp'

  if (!phone || !code) {
    return { success: false, message: '手机号与验证码不能为空' };
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return { success: false, message: '手机号格式不正确' };
  }

  // 获取最新验证码记录
  let codeRes = null;
  try {
    codeRes = await db.collection('verify_codes')
      .where({ phone, status: 'pending' })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
  } catch (error) {
    if (isCollectionNotExistError(error)) {
      return { success: false, message: '验证码服务未初始化，请先获取验证码' };
    }
    throw error;
  }

  if (!codeRes.data || codeRes.data.length === 0) {
    return { success: false, message: '验证码不存在或已使用' };
  }

  const record = codeRes.data[0];
  if (Date.now() > (record.expiresAt || 0)) {
    // 过期处理
    await db.collection('verify_codes').doc(record._id).update({
      data: { status: 'expired' }
    });
    return { success: false, message: '验证码已过期' };
  }

  if (record.code !== code) {
    await db.collection('verify_codes').doc(record._id).update({
      data: {
        attempts: (record.attempts || 0) + 1
      }
    });
    if (VERIFY_CODE_DEBUG_ACCEPT) {
      await db.collection('verify_codes').doc(record._id).update({
        data: { status: 'used' }
      });
      const bypassUserRes = await db
        .collection('users')
        .where(
          _.or([
            { phone },
            { username: phone }
          ])
        )
        .limit(1)
        .get();
      const bypassUser = bypassUserRes && Array.isArray(bypassUserRes.data) && bypassUserRes.data.length ? bypassUserRes.data[0] : null;
      if (bypassUser && String(bypassUser.status || 'active') === 'active') {
        const role = String(bypassUser.role || '').toLowerCase()
        if (platform === 'pc' && !(role === 'admin' || role === 'administrator')) {
          return { success: false, message: '仅管理员账号可登录PC端', errorCode: 'PC_ONLY_ADMIN' }
        }
        const sessionId = uuidv4();
        const token = generateToken(bypassUser, { platform, sessionId });
        try {
          await db.collection('users').doc(bypassUser._id).update({
            data: {
              lastLoginAt: Date.now(),
              lastLoginIP: wxContext.CLIENTIP,
              ...(platform === 'pc'
                ? { currentSessionIdPc: sessionId }
                : { currentSessionId: sessionId, currentSessionIdMp: sessionId }),
              updatedAt: Date.now(),
              updatedBy: wxContext.OPENID
            }
          });
        } catch (_) { }
        return {
          success: true,
          data: {
            token,
            sessionId,
            user: {
              id: bypassUser._id,
              username: bypassUser.username,
              name: bypassUser.name || bypassUser.realName || bypassUser.username,
              role: bypassUser.role,
              phone: bypassUser.phone || '',
              avatar: bypassUser.avatar,
              department: bypassUser.department,
              companyName: bypassUser.companyName || '',
              introduction: bypassUser.introduction || ''
            }
          },
          message: '登录成功'
        };
      }
    }
    return { success: false, message: '验证码不正确' };
  }

  await db.collection('verify_codes').doc(record._id).update({
    data: { status: 'used' }
  });

  const userRes = await db
    .collection('users')
    .where(
      _.or([
        { phone },
        { username: phone }
      ])
    )
    .limit(1)
    .get();

  let user = userRes && Array.isArray(userRes.data) && userRes.data.length ? userRes.data[0] : null;
  const now = Date.now();

  if (!user) {
    const baseUser = {
      _id: uuidv4(),
      username: phone,
      phone,
      name: phone === SUPER_ADMIN_PHONE ? '超级管理员' : `用户${phone.slice(-4)}`,
      role: phone === SUPER_ADMIN_PHONE ? 'admin' : 'user',
      status: 'active',
      avatar: '/images/profile.png',
      createdAt: now,
      updatedAt: now,
      createdBy: wxContext.OPENID,
      updatedBy: wxContext.OPENID
    };
    const addRes = await db.collection('users').add({ data: baseUser });
    user = { ...baseUser, _id: addRes && addRes._id ? addRes._id : baseUser._id };
  } else {
    if (user.status && String(user.status) !== 'active') {
      return { success: false, message: '账号已停用' };
    }
    const shouldBeAdmin = phone === SUPER_ADMIN_PHONE;
    if (shouldBeAdmin && !(user.role === 'admin' || user.role === 'administrator')) {
      await db.collection('users').doc(user._id).update({
        data: { role: 'admin', updatedAt: now, updatedBy: wxContext.OPENID }
      });
      user = { ...user, role: 'admin' };
    }
  }

  const role = String(user.role || '').toLowerCase()
  if (platform === 'pc' && !(role === 'admin' || role === 'administrator')) {
    return { success: false, message: '仅管理员账号可登录PC端', errorCode: 'PC_ONLY_ADMIN' }
  }
  const sessionId = uuidv4();
  const token = generateToken(user, { platform, sessionId });

  await db.collection('users').doc(user._id).update({
    data: {
      lastLoginAt: now,
      lastLoginIP: wxContext.CLIENTIP,
      ...(platform === 'pc'
        ? { currentSessionIdPc: sessionId }
        : { currentSessionId: sessionId, currentSessionIdMp: sessionId }),
      updatedAt: now,
      updatedBy: wxContext.OPENID
    }
  });

  return {
    success: true,
    data: {
      token,
      sessionId,
      user: {
        id: user._id,
        username: user.username,
        name: user.name || user.realName || user.username,
        role: user.role,
        phone: user.phone || '',
        avatar: user.avatar,
        department: user.department,
        companyName: user.companyName || '',
        introduction: user.introduction || ''
      }
    },
    message: '登录成功'
  };
}

async function refreshToken(data, wxContext) {
  const userId = String(data?.userId || '').trim()
  const platform = String(data?.platform || 'pc').toLowerCase() === 'pc' ? 'pc' : 'mp'
  if (!userId) return { success: false, message: '缺少userId' }

  let user = null
  try {
    const got = await db.collection('users').doc(userId).get()
    user = got && got.data ? got.data : null
  } catch (_) { void 0 }
  if (!user) return { success: false, message: '用户不存在' }

  const deletedFlag = user && (user.isDeleted === true || user.deleted === true || user.deletedAt || user.removedAt)
  if (deletedFlag) return { success: false, message: '用户不存在' }
  if (user.status && String(user.status) !== 'active') return { success: false, message: '账号已停用' }

  const role = String(user.role || '').toLowerCase()
  if (platform === 'pc' && !(role === 'admin' || role === 'administrator')) {
    return { success: false, message: '仅管理员账号可登录PC端', errorCode: 'PC_ONLY_ADMIN' }
  }

  const sessionId = uuidv4()
  const token = generateToken({ _id: user._id, username: user.username, role: user.role }, { platform, sessionId })
  const now = Date.now()
  try {
    await db.collection('users').doc(user._id).update({
      data: {
        ...(platform === 'pc'
          ? { currentSessionIdPc: sessionId }
          : { currentSessionId: sessionId, currentSessionIdMp: sessionId }),
        updatedAt: now,
        updatedBy: wxContext?.OPENID
      }
    })
  } catch (_) { void 0 }

  return {
    success: true,
    data: {
      token,
      sessionId,
      user: {
        id: user._id,
        username: user.username,
        name: user.name || user.realName || user.username,
        role: user.role,
        phone: user.phone || '',
        avatar: user.avatar,
        department: user.department,
        companyName: user.companyName || '',
        introduction: user.introduction || ''
      }
    },
    message: '刷新成功'
  }
}

async function encodeGb18030(data) {
  const text = data && typeof data.text === 'string' ? data.text : '';
  try {
    const buf = iconv.encode(text, 'gb18030');
    const base64 = buf.toString('base64');
    return {
      success: true,
      data: {
        base64,
        length: buf.length
      }
    };
  } catch (e) {
    return {
      success: false,
      message: 'GB18030编码失败',
      error: e.message
    };
  }
}

async function getCustomers(params = {}) {
  const parseBool = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    return fallback;
  };

  const { page = 1, limit = 500, keyword, status, includeDeleted } = params || {};
  const maxLimitRaw = Number(process.env.ERP_QUERY_MAX_LIMIT)
  const maxLimit = Number.isFinite(maxLimitRaw) && maxLimitRaw > 0 ? Math.floor(maxLimitRaw) : 1000
  const safePage = Math.max(1, Number(page || 1) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit || 50) || 50), maxLimit);
  const skip = (safePage - 1) * safeLimit;
  const shouldIncludeDeleted = parseBool(includeDeleted, false);

  const buildWhere = () => {
    const where = {};
    if (!shouldIncludeDeleted) where.isDeleted = _.neq(true);
    if (status && status !== 'all') {
      where.status = status;
    }
    const kw = keyword != null ? String(keyword || '').trim() : '';
    if (kw) {
      const reg = db.RegExp({ regexp: kw, options: 'i' });
      where.$or = [
        { name: reg },
        { companyName: reg },
        { shortName: reg },
        { contact: reg },
        { contactName: reg },
        { phone: reg }
      ];
    }
    return where;
  };

  const normalizeCustomer = (raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const next = { ...raw };
    const companyName = next.companyName ?? next.name ?? next.company ?? next.customerName;
    const contactName = next.contactName ?? next.contact ?? next.contactPerson ?? next.linkman;
    if (companyName != null && next.companyName == null) next.companyName = companyName;
    if (companyName != null && next.name == null) next.name = companyName;
    if (contactName != null && next.contactName == null) next.contactName = contactName;
    if (contactName != null && next.contact == null) next.contact = contactName;
    if (next.status == null) next.status = 'active';
    return next;
  };

  const where = buildWhere();

  const queryCustomers = async () => {
    let query = db.collection('customers');
    if (Object.keys(where).length) query = query.where(where);
    const result = await query.orderBy('createdAt', 'desc').skip(skip).limit(safeLimit).get();
    let countQuery = db.collection('customers');
    if (Object.keys(where).length) countQuery = countQuery.where(where);
    const countResult = await countQuery.count();
    return { list: Array.isArray(result.data) ? result.data : [], total: Number(countResult.total || 0) };
  };

  let base;
  try {
    base = await queryCustomers();
  } catch (e) {
    base = { list: [], total: 0 };
  }

  const aliasCollections = ['customers_tmp', 'customer_list', 'erp_customers', 'clients'];
  const aliasData = [];
  let aliasTotal = 0;

  const kw = keyword != null ? String(keyword || '').trim() : '';
  const reg = kw ? db.RegExp({ regexp: kw, options: 'i' }) : null;

  for (const name of aliasCollections) {
    try {
      let q = db.collection(name);
      if (!shouldIncludeDeleted) q = q.where({ isDeleted: _.neq(true) });
      if (status && status !== 'all') {
        q = q.where({ status });
      }
      if (reg) {
        q = q.where(_.or([
          { name: reg },
          { companyName: reg },
          { shortName: reg },
          { contact: reg },
          { contactName: reg },
          { phone: reg }
        ]));
      }
      try {
        const fetchLimit = Math.min(Math.max(skip + safeLimit, safeLimit), maxLimit);
        const got = await q.orderBy('createdAt', 'desc').limit(fetchLimit).get();
        if (Array.isArray(got.data) && got.data.length) aliasData.push(...got.data);
      } catch (_) {
        const fetchLimit = Math.min(Math.max(skip + safeLimit, safeLimit), maxLimit);
        const got = await q.limit(fetchLimit).get();
        if (Array.isArray(got.data) && got.data.length) aliasData.push(...got.data);
      }
      try {
        const c = await q.count();
        aliasTotal += Number(c.total || 0);
      } catch (_) {}
    } catch (_) {}
  }

  const getKey = (raw) => {
    const id = raw && (raw._id || raw.id);
    if (id != null && String(id).trim()) return `id:${String(id).trim()}`;
    const name = raw && (raw.companyName || raw.name || raw.company || raw.customerName);
    const phone = raw && raw.phone;
    const contact = raw && (raw.contactName || raw.contact);
    const parts = [name, phone, contact].filter(v => v != null && String(v).trim()).map(v => String(v).trim().toLowerCase());
    if (parts.length) return `fp:${parts.join('|')}`;
    return null;
  };

  const mergedMap = new Map();
  for (const item of (base.list || [])) {
    const key = getKey(item);
    if (!key) continue;
    mergedMap.set(key, item);
  }
  for (const item of aliasData) {
    const key = getKey(item);
    if (!key) continue;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    }
  }

  const mergedData = Array.from(mergedMap.values());

  const toTs = (v) => (typeof v === 'number' ? v : (Date.parse(v) || 0));
  const sorted = mergedData.sort((a, b) => {
    const av = toTs(a?.createdAt ?? a?._createTime ?? a?.createTime ?? a?.updatedAt);
    const bv = toTs(b?.createdAt ?? b?._createTime ?? b?.createTime ?? b?.updatedAt);
    return bv - av;
  });
  const paged = sorted.slice(skip, skip + safeLimit);
  const list = paged.map(normalizeCustomer);

  const total = Math.max(
    Number(base.total || 0) + Number(aliasTotal || 0),
    sorted.length
  );

  return {
    success: true,
    data: list,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      hasMore: skip + list.length < total
    }
  };
}

/**
 * 获取订单列表
 */
async function getOrders(params = {}) {
  const parseBool = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    return fallback;
  };

  const { page = 1, limit = 20, status, customerId, dateRange, orderType, purchaseCategory, excludeOrderType, keyword, withTotal, compact, includeAliases, debug } = params;
  const shouldCountTotal = parseBool(withTotal, true);
  const compactExplicit = Object.prototype.hasOwnProperty.call(params || {}, 'compact');
  const shouldCompact = parseBool(compact, false);
  const shouldIncludeAliases = parseBool(includeAliases, false);
  const shouldDebug = parseBool(debug, false);

  // 增加limit上限,支持大批量查询(微信云开发单次最多1000条)
  const effectiveLimit = Math.min(Math.max(1, Number(limit) || 20), 1000);
  const skip = (page - 1) * effectiveLimit;
  const take = Math.min(skip + effectiveLimit, 1000);

  const finalCompact = shouldCompact || (!compactExplicit && effectiveLimit >= 200);

  if (shouldDebug) {
    console.log(`[getOrders] page=${page}, requestedLimit=${limit}, effectiveLimit=${effectiveLimit}, skip=${skip}, excludeOrderType=${excludeOrderType}, compact=${finalCompact}, includeAliases=${shouldIncludeAliases}`);
  }

  const applyOrderTypeFilter = (q) => {
    if (orderType) return q.where({ orderType });
    if (excludeOrderType) {
      const ex = String(excludeOrderType || '').toLowerCase();
      if (ex === 'purchase') {
        const notPur = db.RegExp({ regexp: '^(?!PUR)', options: 'i' });
        return q.where(_.and([
          _.or([
            { orderType: _.exists(false) },
            { orderType: null },
            { orderType: '' },
            { orderType: _.neq('purchase') }
          ]),
          _.or([
            { 'data.orderType': _.exists(false) },
            { 'data.orderType': null },
            { 'data.orderType': '' },
            { 'data.orderType': _.neq('purchase') }
          ]),
          _.or([
            { source: _.neq('purchased') },
            { source: _.exists(false) },
            { source: null },
            { source: '' }
          ]),
          _.or([
            { 'data.source': _.neq('purchased') },
            { 'data.source': _.exists(false) },
            { 'data.source': null },
            { 'data.source': '' }
          ]),
          _.or([
            { purchaseCategory: _.exists(false) },
            { purchaseCategory: null },
            { purchaseCategory: '' }
          ]),
          _.or([
            { category: _.exists(false) },
            { category: null },
            { category: '' }
          ]),
          _.or([
            { 'data.purchaseCategory': _.exists(false) },
            { 'data.purchaseCategory': null },
            { 'data.purchaseCategory': '' }
          ]),
          _.or([
            { 'data.category': _.exists(false) },
            { 'data.category': null },
            { 'data.category': '' }
          ]),
          _.or([
            { orderNo: _.exists(false) },
            { orderNo: null },
            { orderNo: '' },
            { orderNo: notPur }
          ]),
          _.or([
            { orderNumber: _.exists(false) },
            { orderNumber: null },
            { orderNumber: '' },
            { orderNumber: notPur }
          ]),
          _.or([
            { 'data.orderNo': _.exists(false) },
            { 'data.orderNo': null },
            { 'data.orderNo': '' },
            { 'data.orderNo': notPur }
          ]),
          _.or([
            { 'data.orderNumber': _.exists(false) },
            { 'data.orderNumber': null },
            { 'data.orderNumber': '' },
            { 'data.orderNumber': notPur }
          ])
        ]));
      }
      return q.where(_.or([
        { orderType: _.exists(false) },
        { orderType: null },
        { orderType: '' },
        { orderType: _.neq(ex) }
      ]));
    }
    return q;
  };

  const applyFilters = (q) => {
    if (status) {
      if (Array.isArray(status)) {
        q = q.where({ status: _.in(status) });
      } else if (typeof status === 'string' && status.includes(',')) {
        const list = status.split(',').map(s => s.trim()).filter(Boolean);
        q = q.where({ status: _.in(list) });
      } else {
        q = q.where({ status });
      }
    }
    if (customerId) {
      q = q.where({ customerId });
    }
    if (purchaseCategory) {
      q = q.where({ purchaseCategory });
    }
    if (dateRange && dateRange.start && dateRange.end) {
      q = q.where({
        createdAt: _.gte(dateRange.start).and(_.lte(dateRange.end))
      });
    }
    if (keyword) {
      const kw = String(keyword || '').trim();
      if (kw) {
        const rx = db.RegExp({ regexp: kw, options: 'i' });
        q = q.where(_.or([
          { orderNumber: rx },
          { orderNo: rx },
          { customerName: rx },
          { productName: rx },
          { goodsName: rx },
          { productTitle: rx },
          { materialNo: rx },
          { spec: rx }
        ]));
      }
    }
    return q;
  };

  const buildQuery = (collectionName) => {
    let q = db.collection(collectionName);
    q = q.where({ isDeleted: _.neq(true) });
    q = applyOrderTypeFilter(q);
    q = applyFilters(q);
    return q;
  };

  const fetchCollectionPage = async (collectionName, opts = {}) => {
    const useSkip = Number.isFinite(opts.skip) && opts.skip > 0;
    const lim = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.min(opts.limit, effectiveLimit) : take;
    try {
      const q = buildQuery(collectionName).orderBy('createdAt', 'desc');
      return await (useSkip ? q.skip(opts.skip).limit(lim).get() : q.skip(0).limit(lim).get());
    } catch (_) {
      try {
        const q = buildQuery(collectionName).orderBy('_createTime', 'desc');
        return await (useSkip ? q.skip(opts.skip).limit(lim).get() : q.skip(0).limit(lim).get());
      } catch (_) {
        try {
          const q = buildQuery(collectionName);
          return await (useSkip ? q.skip(opts.skip).limit(lim).get() : q.skip(0).limit(lim).get());
        } catch (_) {
          return { data: [] };
        }
      }
    }
  };

  // 快速路径：仅查询主集合，直接使用 skip/limit 分页
  const basePaged = await fetchCollectionPage('orders', { skip, limit: effectiveLimit });
  const basePagedSize = Array.isArray(basePaged?.data) ? basePaged.data.length : 0;
  if (basePagedSize >= effectiveLimit || page > 1) {
    const pageRows = (basePaged.data || []).map((o) => {
      const nested = (o && o.data && typeof o.data === 'object') ? o.data : null;
      const canonicalOrderNo = nested?.orderNo || nested?.orderNumber || o.orderNo || o.orderNumber || '';
      const merged = nested ? { ...(nested || {}), ...(o || {}) } : { ...(o || {}) };
      if (canonicalOrderNo) {
        merged.orderNo = canonicalOrderNo;
        merged.orderNumber = canonicalOrderNo;
      }
      const derived = canonicalOrderNo ? buildQrServerUrl(buildOrderQrPayload({ orderId: merged._id, orderNo: canonicalOrderNo }), 220) : undefined;
      const nextQr = (merged && merged.qrCodeUrl && isQrCodeUrlForOrder(merged.qrCodeUrl, merged._id)) ? merged.qrCodeUrl : derived;
      const normalized = { ...merged, ...(nextQr ? { qrCodeUrl: nextQr } : {}) };
      if (!finalCompact) return normalized;
      const items = Array.isArray(normalized.items) ? normalized.items : [];
      const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
      const goodsName = normalized.goodsName || normalized.productTitle || normalized.goods_name || normalized.product_title || first?.goodsName || first?.title || first?.productName || first?.name;
      const materialNo = normalized.materialNo || normalized.material_no || first?.materialNo || first?.material_no;
      const spec = normalized.spec || first?.spec;
      const flute = normalized.flute || normalized.fluteType || first?.flute;
      const quantity = normalized.quantity ?? normalized.totalQty ?? normalized.sheetCount ?? first?.quantity;
      const unit = normalized.unit || first?.unit;
      const unitPrice = normalized.unitPrice ?? normalized.salePrice ?? normalized.price ?? first?.unitPrice ?? first?.salePrice ?? first?.price;
      const rawUnitPrice =
        normalized.rawUnitPrice ??
        normalized.raw_unit_price ??
        normalized.rawMaterialUnitPrice ??
        normalized.raw_material_unit_price ??
        first?.rawUnitPrice ??
        first?.raw_unit_price ??
        first?.rawMaterialUnitPrice ??
        first?.raw_material_unit_price ??
        first?.costPrice ??
        first?.cost_price ??
        first?.purchasePrice ??
        first?.purchase_price;
      const deliveryDate = normalized.deliveryDate ?? normalized.delivery_time ?? normalized.expectedDeliveryDate;
      return {
        _id: normalized._id,
        id: normalized.id,
        orderNo: normalized.orderNo,
        orderNumber: normalized.orderNumber,
        customerId: normalized.customerId,
        customerName: normalized.customerName,
        productName: normalized.productName,
        goodsName,
        materialNo,
        spec,
        flute,
        quantity,
        unit,
        unitPrice,
        salePrice: normalized.salePrice,
        rawUnitPrice,
        amount: normalized.amount ?? normalized.totalAmount ?? normalized.finalAmount,
        status: normalized.status,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        deliveryDate,
        stockedQty: normalized.stockedQty,
        shippedQty: normalized.shippedQty,
        stockedAt: normalized.stockedAt ?? normalized.stockTime,
        shippedAt: normalized.shippedAt,
        orderType: normalized.orderType,
        source: normalized.source,
        purchaseCategory: normalized.purchaseCategory,
        supplierName: normalized.supplierName,
        sheetCount: normalized.sheetCount,
        items: first ? [first] : [],
        qrCodeUrl: normalized.qrCodeUrl
      };
    });
    return {
      success: true,
      data: pageRows,
      pagination: {
        page,
        limit,
        total: shouldCountTotal ? undefined : undefined,
        hasMore: pageRows.length >= effectiveLimit
      }
    };
  }

  // 慢路径：主集合不足时再合并别名集合
  const baseResult = await fetchCollectionPage('orders', { skip: 0, limit: take });
  const aliasCollections = ['orders_tmp', 'erp_orders', 'order_list'];
  const baseSize = Array.isArray(baseResult?.data) ? baseResult.data.length : 0;
  const shouldQueryAliases = shouldIncludeAliases;
  const aliasResults = shouldQueryAliases
    ? await Promise.all(aliasCollections.map((name) => fetchCollectionPage(name, { skip: 0, limit: take })))
    : [];

  const getOrderTs = (o) => {
    const v = o?.createdAt ?? o?._createTime ?? o?.createTime ?? o?.updatedAt ?? o?.updateTime ?? o?._updateTime;
    if (typeof v === 'number') return v;
    const t = Date.parse(String(v || ''));
    return Number.isFinite(t) ? t : 0;
  };

  const canonicalizeOrderNo = (row) => {
    const o = row && typeof row === 'object' ? row : {};
    const nested = o && o.data && typeof o.data === 'object' ? o.data : null;
    const candidate = [
      nested?.orderNo,
      nested?.orderNumber,
      o.orderNo,
      o.orderNumber,
      o.order_number,
      o.no
    ].map(v => String(v || '').trim()).find(Boolean) || '';
    if (!candidate) return o;
    return { ...o, orderNo: candidate, orderNumber: candidate };
  };

  const srcScore = (src) => {
    const s = String(src || '');
    if (s === 'orders') return 4;
    if (s === 'orders_tmp') return 3;
    if (s === 'erp_orders') return 2;
    if (s === 'order_list') return 1;
    return 0;
  };

  const pickBetter = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const sa = srcScore(a.__src);
    const sb = srcScore(b.__src);
    if (sa !== sb) return sa > sb ? a : b;
    const ta = getOrderTs(a);
    const tb = getOrderTs(b);
    if (ta !== tb) return ta > tb ? a : b;
    const ida = String(a._id || a.id || '');
    const idb = String(b._id || b.id || '');
    if (ida && !idb) return a;
    if (idb && !ida) return b;
    return a;
  };

  const baseRows = (baseResult.data || []).map((o) => (o ? canonicalizeOrderNo({ ...o, __src: 'orders' }) : o));
  const aliasRows = aliasResults.flatMap((res, idx) => {
    const name = aliasCollections[idx];
    return (res && Array.isArray(res.data) ? res.data : []).map((o) => (o ? canonicalizeOrderNo({ ...o, __src: name }) : o));
  });

  const merged = [...baseRows, ...aliasRows];
  const byId = new Map();
  const byNo = new Map();
  for (const raw of merged) {
    if (!raw) continue;
    const o = raw && typeof raw === 'object' ? raw : {};
    const no = String(o.orderNo || o.orderNumber || '').trim();
    const id = String(o._id || o.id || '').trim();
    if (id) {
      const prev = byId.get(id);
      byId.set(id, pickBetter(prev, o));
    }
    if (no) {
      const arr = byNo.get(no) || [];
      arr.push(o);
      byNo.set(no, arr);
    }
  }

  const mergedUnique = [];
  const usedIds = new Set();
  const pushRow = (row) => {
    if (!row || typeof row !== 'object') return;
    const id = String(row._id || row.id || '').trim();
    if (id) {
      if (usedIds.has(id)) return;
      usedIds.add(id);
      mergedUnique.push(byId.get(id) || row);
      return;
    }
    mergedUnique.push(row);
  };

  for (const [, arr] of byNo.entries()) {
    const list = Array.isArray(arr) ? arr : [];
    if (!list.length) continue;
    const hasOrders = list.some((x) => x && String(x.__src || '') === 'orders');
    if (hasOrders) {
      const ordersRows = list.filter((x) => x && String(x.__src || '') === 'orders');
      ordersRows.forEach(pushRow);
    } else {
      let best = null;
      for (const row of list) {
        best = pickBetter(best, row);
      }
      if (best) pushRow(best);
    }
  }

  for (const [id, row] of byId.entries()) {
    if (!id) continue;
    const no = String(row?.orderNo || row?.orderNumber || '').trim();
    if (no) continue;
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    mergedUnique.push(row);
  }
  const sorted = mergedUnique.sort((a, b) => getOrderTs(b) - getOrderTs(a));
  const pageRows = sorted.slice(skip, skip + effectiveLimit).map((o) => {
    if (!o || typeof o !== 'object') return o;
    const { __src, __source, ...rest } = o;
    return rest;
  });

  if (shouldDebug) {
    console.log(`[getOrders] Query returned ${pageRows?.length || 0} orders`);
  }

  let computedTotal = mergedUnique.length;
  if (shouldCountTotal) {
    let baseCount = 0;
    try {
      const countResult = await buildQuery('orders').count();
      baseCount = Number(countResult.total || 0);
    } catch (_) { }

    let aliasCount = 0;
    if (shouldQueryAliases) {
      for (const name of aliasCollections) {
        try {
          const res = await buildQuery(name).count();
          aliasCount += Number(res.total || 0);
        } catch (_) { }
      }
    }

    computedTotal = Math.max(baseCount + aliasCount, mergedUnique.length);
  }

  const computedHasMore = (() => {
    if (shouldCountTotal) {
      return skip + pageRows.length < computedTotal;
    }
    const baseFetchedEnough = baseSize >= take;
    const aliasFetchedEnough = Array.isArray(aliasResults) && aliasResults.some((r) => Array.isArray(r?.data) && r.data.length >= take);
    const fetchedEnough = baseFetchedEnough || aliasFetchedEnough;
    if (!fetchedEnough) return false;
    return (skip + pageRows.length) < 1000;
  })();

  return {
    success: true,
    data: (pageRows || []).map((o) => {
      const nested = (o && o.data && typeof o.data === 'object') ? o.data : null;
      const canonicalOrderNo = o && (nested?.orderNo || nested?.orderNumber || o.orderNo || o.orderNumber)
        ? (nested?.orderNo || nested?.orderNumber || o.orderNo || o.orderNumber)
        : '';
      const merged = nested ? { ...(nested || {}), ...(o || {}) } : { ...(o || {}) };
      if (canonicalOrderNo) {
        merged.orderNo = canonicalOrderNo;
        merged.orderNumber = canonicalOrderNo;
      }
      const derived = canonicalOrderNo ? buildQrServerUrl(buildOrderQrPayload({ orderId: merged._id, orderNo: canonicalOrderNo }), 220) : undefined;
      const nextQr = (merged && merged.qrCodeUrl && isQrCodeUrlForOrder(merged.qrCodeUrl, merged._id)) ? merged.qrCodeUrl : derived;
      const normalized = { ...merged, ...(nextQr ? { qrCodeUrl: nextQr } : {}) };
      if (!finalCompact) return normalized;
      const items = Array.isArray(normalized.items) ? normalized.items : [];
      const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
      const goodsName = normalized.goodsName || normalized.productTitle || normalized.goods_name || normalized.product_title || first?.goodsName || first?.title || first?.productName || first?.name;
      const materialNo = normalized.materialNo || normalized.material_no || first?.materialNo || first?.material_no;
      const spec = normalized.spec || first?.spec;
      const flute = normalized.flute || normalized.fluteType || first?.flute;
      const quantity = normalized.quantity ?? normalized.totalQty ?? normalized.sheetCount ?? first?.quantity;
      const unit = normalized.unit || first?.unit;
      const unitPrice = normalized.unitPrice ?? normalized.salePrice ?? normalized.price ?? first?.unitPrice ?? first?.salePrice ?? first?.price;
      const amount = normalized.amount ?? normalized.totalAmount ?? normalized.finalAmount;
      const rawUnitPrice =
        normalized.rawUnitPrice ??
        normalized.raw_unit_price ??
        normalized.rawMaterialUnitPrice ??
        normalized.raw_material_unit_price ??
        first?.rawUnitPrice ??
        first?.raw_unit_price ??
        first?.rawMaterialUnitPrice ??
        first?.raw_material_unit_price ??
        first?.costPrice ??
        first?.cost_price ??
        first?.purchasePrice ??
        first?.purchase_price;
      const deliveryDate = normalized.deliveryDate ?? normalized.delivery_time ?? normalized.expectedDeliveryDate;
      return {
        _id: normalized._id,
        id: normalized.id,
        orderNo: normalized.orderNo,
        orderNumber: normalized.orderNumber,
        customerId: normalized.customerId,
        customerName: normalized.customerName,
        productName: normalized.productName,
        goodsName,
        materialNo,
        spec,
        flute,
        quantity,
        unit,
        unitPrice,
        salePrice: normalized.salePrice,
        rawUnitPrice,
        amount,
        status: normalized.status,
        createdAt: normalized.createdAt,
        updatedAt: normalized.updatedAt,
        deliveryDate,
        stockedQty: normalized.stockedQty,
        shippedQty: normalized.shippedQty,
        stockedAt: normalized.stockedAt ?? normalized.stockTime,
        shippedAt: normalized.shippedAt,
        orderType: normalized.orderType,
        source: normalized.source,
        purchaseCategory: normalized.purchaseCategory,
        supplierName: normalized.supplierName,
        sheetCount: normalized.sheetCount,
        items: first ? [first] : [],
        qrCodeUrl: normalized.qrCodeUrl
      };
    }),
    pagination: {
      page,
      limit,
      total: computedTotal,
      hasMore: computedHasMore
    }
  };
}

/**
 * 创建订单
 */
async function createOrder(orderData, wxContext) {
  const now = Date.now();
  const cleanOrderData = orderData && typeof orderData === 'object' ? { ...orderData } : {}
  delete cleanOrderData._id
  delete cleanOrderData._createTime
  delete cleanOrderData._updateTime
  delete cleanOrderData.orderNo
  delete cleanOrderData.orderNumber
  delete cleanOrderData.order_number
  delete cleanOrderData.order_no
  delete cleanOrderData.no
  const year = String(new Date().getFullYear());
  const seqLength = 3;
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const day = String(new Date().getDate()).padStart(2, '0');
  const dateKey = `${year}${month}${day}`;
  const validPattern = /^(QXDD|QXBZ)\d{7,12}$/;

  await ensureCloudCollectionsExist(['orders', 'order_no_registry', 'order_no_generate_logs'])

  const reservationId = String(orderData.reservationId || '').trim()
  const openid = wxContext.OPENID || (orderData && orderData.createdBy) || 'anonymous'
  const lockKey = `order_no_gen_${dateKey}`
  const lockOwner = `${String(openid || 'anon').slice(0, 24)}_${now}_${randomFixedDigits(4)}`

  const claimRegistry = async (no, orderId, meta = {}) => {
    const key = String(no || '').trim()
    if (!key) return false
    const out = await db.runTransaction(async (t) => {
      const ref = t.collection('order_no_registry').doc(key)
      let existing = null
      try {
        const got = await ref.get()
        existing = got && got.data ? got.data : null
      } catch (_) { void 0 }
      if (existing && existing.orderId && String(existing.orderId) !== String(orderId)) {
        throw new Error('ORDER_NO_TAKEN')
      }
      await ref.set({
        data: {
          orderNo: key,
          orderNumber: key,
          orderId: String(orderId || '').trim(),
          reservationId: reservationId || undefined,
          source: String(meta.source || '').trim() || 'unknown',
          createdAt: Date.now(),
          createdBy: openid
        }
      })
      return true
    })
    return Boolean(out)
  }

  const pickCandidate = async (requested) => {
    const input = String(requested || '').trim()
    if (validPattern.test(input)) {
      const taken = await isOrderNumberTaken(input, { collections: ['orders', 'orders_tmp', 'purchase_orders', 'production'] })
      if (!taken) return { orderNumber: input, source: reservationId ? 'reserved' : 'client' }
    }
    const generated = await generateOrderNumberByDate(dateKey, { collections: ['orders', 'orders_tmp', 'purchase_orders', 'production'] })
    return { orderNumber: generated, source: 'atomic' }
  }

  let selected = { orderNumber: '', source: '' }
  let orderId = ''
  await withDistributedLock(lockKey, 4000, lockOwner, async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!orderId) orderId = uuidv4()
      selected = await pickCandidate(orderData.orderNumber || orderData.orderNo)
      try {
        await claimRegistry(selected.orderNumber, orderId, { source: selected.source })
        break
      } catch (e) {
        const msg = String(e?.message || e || '')
        if (msg.includes('ORDER_NO_TAKEN')) {
          selected = { orderNumber: '', source: '' }
          await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 30)))
          continue
        }
        throw e
      }
    }
    if (!selected.orderNumber) throw new Error('生成订单号失败')
  })

  const orderNumber = selected.orderNumber
  if (reservationId && selected.source !== 'reserved') {
    try {
      await releaseOrderNumber({ reservationId, orderNumber: orderData.orderNumber || orderData.orderNo }, wxContext)
    } catch (_) { void 0 }
  }
  const logWriteResult = async (success, extra = {}) => {
    try {
      await ensureCloudCollectionsExist(['order_no_generate_logs'])
      await db.collection('order_no_generate_logs').add({
        data: {
          orderNo: orderNumber,
          orderNumber,
          reservationId: reservationId || undefined,
          source: selected.source,
          createdAt: Date.now(),
          createdBy: openid,
          success: Boolean(success),
          ...extra
        }
      })
    } catch (_) { void 0 }
  }
  const parseDataUrl = (s) => {
    const m = String(s).match(/^data:(.*?);base64,(.*)$/);
    return m ? { mime: m[1], b64: m[2] } : null;
  };
  const extFromMime = (mime) => {
    const s = String(mime || '').toLowerCase();
    if (s.includes('png')) return 'png';
    if (s.includes('jpeg') || s.includes('jpg')) return 'jpg';
    if (s.includes('gif')) return 'gif';
    if (s.includes('webp')) return 'webp';
    return 'jpg';
  };
  const uploadFromDataUrl = async (name, dataUrl, idx) => {
    const p = parseDataUrl(dataUrl);
    if (!p) return { name, url: dataUrl };
    const ext = extFromMime(p.mime);
    const cloudPath = `attachments/orders/${orderNumber}_${Date.now()}_${idx}.${ext}`;
    const buffer = Buffer.from(p.b64, 'base64');
    const res = await cloud.uploadFile({ cloudPath, fileContent: buffer });
    return { name, fileID: res.fileID };
  };
  const rawAtt = Array.isArray(cleanOrderData.attachments) ? cleanOrderData.attachments : [];
  const normalizedAtt = [];
  for (let i = 0; i < rawAtt.length; i++) {
    const a = rawAtt[i];
    if (typeof a === 'string') {
      if (/^data:/.test(a)) {
        normalizedAtt.push(await uploadFromDataUrl('附件', a, i));
      } else if (/^cloud:\/\//.test(a)) {
        normalizedAtt.push({ name: a, fileID: a });
      } else {
        normalizedAtt.push({ name: a, url: a });
      }
    } else if (a && a.url && /^data:/.test(a.url)) {
      normalizedAtt.push(await uploadFromDataUrl(a.name || '附件', a.url, i));
    } else if (a && a.fileID) {
      normalizedAtt.push({ name: a.name || '附件', fileID: a.fileID });
    } else if (a && a.url) {
      normalizedAtt.push({ name: a.name || '附件', url: a.url });
    } else if (a) {
      normalizedAtt.push({ name: a.name || '附件' });
    }
  }

  const qrCodeUrl = buildQrServerUrl(buildOrderQrPayload({ orderId, orderNo: orderNumber }), 220);
  const normalizeStatusText = (raw) => {
    const s = String(raw || '').trim()
    if (!s) return ''
    const lower = s.toLowerCase()
    if (s === '已下单' || lower === 'ordered' || lower === 'created') return 'ordered'
    if (s === '待生产' || lower === 'pending' || lower === 'waiting' || lower === 'planned' || lower === 'to_produce' || lower === 'prepare') return 'pending'
    if (s === '生产中' || lower === 'processing' || lower === 'in_progress' || lower === 'producing') return 'processing'
    if (s === '已入库' || lower === 'stocked' || lower === 'warehoused' || lower === 'warehouse') return 'stocked'
    if (s === '已发货' || lower === 'shipping' || lower === 'shipped' || lower === 'delivered') return 'shipping'
    if (s === '已完成' || lower === 'completed' || lower === 'done') return 'completed'
    return lower
  }
  const orderTypeForStatus = String(cleanOrderData?.orderType || '').toLowerCase()
  const sourceForStatus = String(cleanOrderData?.source || '').toLowerCase()
  const purchaseCategoryForStatus = String(cleanOrderData?.purchaseCategory || cleanOrderData?.category || '').toLowerCase()
  const isPurchaseForStatus =
    orderTypeForStatus === 'purchase' ||
    sourceForStatus === 'purchased' ||
    Boolean(purchaseCategoryForStatus)
  const inputStatusRaw = cleanOrderData && cleanOrderData.status ? cleanOrderData.status : ''
  const inputStatus = normalizeStatusText(inputStatusRaw)
  const defaultStatus = 'ordered'
  const finalStatus = inputStatus || defaultStatus
  const order = {
    ...cleanOrderData,
    attachments: normalizedAtt,
    orderNumber,
    orderNo: orderNumber,
    qrCodeUrl,
    status: finalStatus,
    orderId,
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID || (orderData && orderData.createdBy) || null,
    updatedBy: wxContext.OPENID || (orderData && orderData.createdBy) || null,
    _version: 1
  };

  // 验证订单数据
  try {
    validateOrderData(order);
    await ensureProductCategoryValid(order.productName, wxContext)
    await retryAsync(
      async () => await db.collection('orders').doc(orderId).set({ data: order }),
      { retries: 2, baseMs: 120, maxMs: 1500 }
    )
    await logWriteResult(true, { orderId })
  } catch (e) {
    try {
      const ref = db.collection('order_no_registry').doc(orderNumber)
      const got = await ref.get().catch(() => null)
      const existing = got && got.data ? got.data : null
      if (existing && String(existing.orderId || '') === String(orderId)) {
        await ref.remove().catch(() => { })
      }
    } catch (_) { void 0 }
    const errObj = normalizeErrorForLog(e)
    await logWriteResult(false, { orderId, error: errObj })
    try {
      await ensureCloudCollectionsExist(['operation_logs'])
      await logOperation(
        'create_order_failed',
        'orders',
        orderId,
        {
          orderNo: orderNumber,
          orderNumber,
          error: errObj,
          orderType: String(orderData?.orderType || ''),
          source: String(orderData?.source || ''),
          purchaseCategory: String(orderData?.purchaseCategory || orderData?.category || ''),
          customerName: String(orderData?.customerName || ''),
          supplierName: String(orderData?.supplierName || '')
        },
        wxContext.OPENID
      )
    } catch (_) { void 0 }
    const msg = (e && (e.errMsg || e.message)) ? String(e.errMsg || e.message) : '写入订单失败'
    throw new Error(msg)
  }

  // 调用统一后端服务确认订单号占用
  try {
    await axios.post(`${BACKEND_URL}/api/order-numbers/confirm`, { orderNo: orderNumber });
  } catch (_) { }

  // 记录操作日志
  await logOperation('create_order', 'orders', orderId, orderData, wxContext.OPENID);

  console.log(`[ERP-API] 创建订单成功: ${orderNumber}`);

  return {
    success: true,
    data: {
      ...order,
      _id: orderId
    },
    message: '订单创建成功'
  };
}

async function diagnoseOrdersWrite(params = {}, wxContext) {
  const now = Date.now()
  const actor = wxContext && wxContext.OPENID ? wxContext.OPENID : 'anonymous'
  const ensure = { ok: true }
  try {
    await db.collection('orders').limit(1).get()
  } catch (e) {
    const msg = String(e?.errMsg || e?.message || e || '').toLowerCase()
    ensure.ok = false
    ensure.error = normalizeErrorForLog(e)
    if (msg.includes('collection') && (msg.includes('not exist') || msg.includes('not exists'))) {
      try {
        await db.createCollection('orders')
        ensure.ok = true
        ensure.created = true
      } catch (e2) {
        ensure.ok = false
        ensure.created = false
        ensure.createError = normalizeErrorForLog(e2)
      }
    }
  }
  const testId = `write_check_${now}_${randomFixedDigits(4)}`
  const testNo = `WRITECHK${now}${randomFixedDigits(4)}`
  const order = {
    orderNo: testNo,
    orderNumber: testNo,
    orderId: testId,
    customerName: 'WRITE_CHECK',
    productName: 'WRITE_CHECK',
    quantity: 1,
    unit: '个',
    unitPrice: 0,
    amount: 0,
    totalAmount: 0,
    status: 'diagnostic',
    isDeleted: true,
    deletedAt: now,
    deletedBy: actor,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    meta: { type: 'write_check', env: params && params.env ? String(params.env) : undefined }
  }

  try {
    validateOrderData(order)
  } catch (e) {
    return { success: false, message: '自检订单结构校验失败', error: normalizeErrorForLog(e) }
  }

  let wrote = false
  let removed = false
  let writeErr = null
  let removeErr = null
  try {
    await retryAsync(
      async () => await db.collection('orders').doc(testId).set({ data: order }),
      { retries: 2, baseMs: 120, maxMs: 1500 }
    )
    wrote = true
  } catch (e) {
    writeErr = normalizeErrorForLog(e)
  }

  if (wrote) {
    try {
      await retryAsync(async () => await db.collection('orders').doc(testId).remove(), { retries: 1, baseMs: 80, maxMs: 500 })
      removed = true
    } catch (e) {
      removeErr = normalizeErrorForLog(e)
    }
  }

  return {
    success: wrote,
    message: wrote ? 'orders写入自检完成' : 'orders写入自检失败',
    data: { orderId: testId, orderNo: testNo, wrote, removed, ensure },
    error: wrote ? (removeErr ? { remove: removeErr } : undefined) : writeErr
  }
}

async function migrateOrdersTmpToOrders(input = {}, wxContext) {
  const p = input && typeof input === 'object' ? input : {}
  const dryRun = p.dryRun === true || String(p.dryRun || '').toLowerCase() === 'true'
  const mode = String(p.mode || 'auto').trim().toLowerCase() || 'auto'
  const limit = Math.max(1, Math.min(500, Number(p.limit || 200) || 200))
  const includeDeleted = p.includeDeleted === true || String(p.includeDeleted || '').toLowerCase() === 'true'
  const markTmpDeleted = p.markTmpDeleted !== false && String(p.markTmpDeleted || '').toLowerCase() !== 'false'
  const actor = String(p.actorUserId || wxContext?.OPENID || 'anonymous').trim() || 'anonymous'
  const orderNos = Array.isArray(p.orderNos) ? p.orderNos : (Array.isArray(p.orderNumbers) ? p.orderNumbers : [])
  const ids = Array.isArray(p.ids) ? p.ids : []

  const normalizeStatusText = (raw) => {
    const s = String(raw || '').trim()
    if (!s) return ''
    const lower = s.toLowerCase()
    if (s === '已下单' || lower === 'ordered' || lower === 'created') return 'ordered'
    if (s === '待生产' || lower === 'pending' || lower === 'waiting' || lower === 'planned' || lower === 'to_produce' || lower === 'prepare') return 'pending'
    if (s === '生产中' || lower === 'processing' || lower === 'in_progress' || lower === 'producing') return 'processing'
    if (s === '已入库' || lower === 'stocked' || lower === 'warehoused' || lower === 'warehouse') return 'stocked'
    if (s === '已发货' || lower === 'shipping' || lower === 'shipped' || lower === 'delivered') return 'shipping'
    if (s === '已完成' || lower === 'completed' || lower === 'done') return 'completed'
    return lower
  }

  await ensureCloudCollectionsExist(['orders', 'orders_tmp', 'purchase_orders', 'order_no_registry', 'operation_logs'])

  const loadTmpDocByOrderNo = async (no) => {
    const key = String(no || '').trim()
    if (!key) return null
    try {
      const got = await db.collection('orders_tmp').where({ orderNo: key }).limit(1).get()
      if (got?.data?.length) return got.data[0]
    } catch (_) { void 0 }
    try {
      const got = await db.collection('orders_tmp').where({ orderNumber: key }).limit(1).get()
      if (got?.data?.length) return got.data[0]
    } catch (_) { void 0 }
    return null
  }

  const loadTmpDocById = async (id) => {
    const key = String(id || '').trim()
    if (!key) return null
    try {
      const got = await db.collection('orders_tmp').doc(key).get()
      return got?.data || null
    } catch (_) { void 0 }
    try {
      const got = await db.collection('orders_tmp').where({ _id: key }).limit(1).get()
      if (got?.data?.length) return got.data[0]
    } catch (_) { void 0 }
    return null
  }

  const claimRegistry = async (no, orderId) => {
    const key = String(no || '').trim()
    if (!key) throw new Error('订单号不能为空')
    await db.runTransaction(async (t) => {
      const ref = t.collection('order_no_registry').doc(key)
      let existing = null
      try {
        const got = await ref.get()
        existing = got?.data || null
      } catch (_) { void 0 }
      if (existing?.orderId && String(existing.orderId) !== String(orderId)) {
        throw new Error('ORDER_NO_TAKEN')
      }
      await ref.set({
        data: {
          orderNo: key,
          orderNumber: key,
          orderId: String(orderId || '').trim(),
          reservationId: undefined,
          source: 'migrate',
          createdAt: Date.now(),
          createdBy: actor
        }
      })
    })
  }

  const ensureAvailableOrderNo = async (baseNo, orderId) => {
    const candidate = String(baseNo || '').trim()
    if (candidate) {
      try {
        await claimRegistry(candidate, orderId)
        return candidate
      } catch (e) {
        const msg = String(e?.message || e || '')
        if (!msg.includes('ORDER_NO_TAKEN')) throw e
      }
    }
    const dateKeyMatch = candidate.match(/^(QXDD|QXBZ)(\d{8})/)
    const dateKey = dateKeyMatch ? dateKeyMatch[2] : formatDateKeyFromDate(new Date())
    const generated = await generateOrderNumberByDate(dateKey, { collections: ['orders', 'purchase_orders', 'production', 'orders_tmp'] })
    await claimRegistry(generated, orderId)
    return generated
  }

  const pickTarget = (row) => {
    if (mode === 'production') return { collection: 'orders', orderType: 'production', source: 'pc', status: 'pending' }
    if (mode === 'purchase') return { collection: 'purchase_orders', orderType: 'purchase', source: 'purchased', status: 'ordered' }
    const orderType = String(row?.orderType || '').toLowerCase()
    const source = String(row?.source || '').toLowerCase()
    const purchaseCategory = String(row?.purchaseCategory || row?.category || '').trim()
    const isPurchase = orderType === 'purchase' || source === 'purchased' || Boolean(purchaseCategory)
    if (isPurchase) return { collection: 'purchase_orders', orderType: 'purchase', source: source || 'purchased', status: 'ordered' }
    return { collection: 'orders', orderType: 'production', source: source || 'pc', status: 'pending' }
  }

  const docs = []
  if (ids.length) {
    for (const id of ids) {
      const row = await loadTmpDocById(id)
      if (row) docs.push(row)
      if (docs.length >= limit) break
    }
  } else if (orderNos.length) {
    for (const no of orderNos) {
      const row = await loadTmpDocByOrderNo(no)
      if (row) docs.push(row)
      if (docs.length >= limit) break
    }
  } else {
    let q = db.collection('orders_tmp')
    if (!includeDeleted) {
      q = q.where(
        _.and([
          _.or([{ isDeleted: _.neq(true) }, { isDeleted: _.exists(false) }]),
          _.or([{ deleted: _.neq(true) }, { deleted: _.exists(false) }])
        ])
      )
    }
    q = q.where(_.or([{ migratedToOrders: _.neq(true) }, { migratedToOrders: _.exists(false) }]))
    const got = await q.orderBy('updatedAt', 'desc').limit(limit).get().catch(() => null)
    const list = got && Array.isArray(got.data) ? got.data : []
    docs.push(...list)
  }

  const results = []
  let migrated = 0
  let skipped = 0
  let failed = 0

  for (const raw of docs) {
    const row = raw && typeof raw === 'object' ? raw : null
    if (!row) continue
    const tmpId = String(row._id || '').trim()
    if (!tmpId) continue

    if (row.migratedToOrders === true || row.migratedAt) {
      skipped += 1
      results.push({ tmpId, status: 'skipped', reason: 'already_migrated' })
      continue
    }

    const target = pickTarget(row)
    const targetCollection = target.collection
    const targetStatus = normalizeStatusText(row.status) || target.status
    const finalStatus = (targetCollection === 'orders' && targetStatus === 'ordered') ? 'pending' : targetStatus

    let orderNo = String(row.orderNo || row.orderNumber || '').trim()
    try {
      orderNo = await ensureAvailableOrderNo(orderNo, tmpId)
    } catch (e) {
      failed += 1
      results.push({ tmpId, status: 'failed', reason: 'order_no', error: normalizeErrorForLog(e) })
      continue
    }

    const qrCodeUrl = buildQrServerUrl(buildOrderQrPayload({ orderId: tmpId, orderNo }), 220)
    const { _id: _ignoredId, ...rowNoId } = row
    const orderDoc = {
      ...rowNoId,
      orderNo,
      orderNumber: orderNo,
      qrCodeUrl,
      orderId: tmpId,
      orderType: target.orderType,
      source: target.source,
      ...(targetCollection === 'orders' ? { purchaseCategory: '' } : {}),
      status: finalStatus,
      migratedFrom: 'orders_tmp',
      migratedAt: Date.now(),
      migratedBy: actor,
      updatedAt: Date.now(),
      updatedBy: actor
    }

    if (dryRun) {
      migrated += 1
      results.push({ tmpId, status: 'dry_run', targetCollection, orderNo })
      continue
    }

    try {
      await db.collection(targetCollection).doc(tmpId).set({ data: orderDoc })
      if (markTmpDeleted) {
        await db.collection('orders_tmp').doc(tmpId).update({
          data: {
            isDeleted: true,
            deletedAt: Date.now(),
            deletedBy: actor,
            migratedToOrders: true,
            migratedTo: targetCollection,
            migratedAt: Date.now(),
            migratedBy: actor,
            updatedAt: Date.now(),
            updatedBy: actor
          }
        }).catch(() => null)
      } else {
        await db.collection('orders_tmp').doc(tmpId).update({
          data: {
            migratedToOrders: true,
            migratedTo: targetCollection,
            migratedAt: Date.now(),
            migratedBy: actor,
            updatedAt: Date.now(),
            updatedBy: actor
          }
        }).catch(() => null)
      }
      migrated += 1
      results.push({ tmpId, status: 'migrated', targetCollection, orderNo })
    } catch (e) {
      failed += 1
      results.push({ tmpId, status: 'failed', reason: 'write', error: normalizeErrorForLog(e) })
    }
  }

  try {
    await logOperation(
      'migrate_orders_tmp',
      'orders_tmp',
      '',
      { migrated, skipped, failed, dryRun, mode, limit, actor },
      wxContext?.OPENID || actor
    )
  } catch (_) { void 0 }

  return {
    success: true,
    message: dryRun ? '迁移预演完成' : '迁移完成',
    data: { migrated, skipped, failed, dryRun, mode, limit, results }
  }
}

/**
 * 更新订单
 */
async function updateOrder(updateData, wxContext) {
  const { id, _id, orderId, ...fields } = updateData;
  const actualId = id || _id || orderId;

  if (!actualId) {
    throw new Error('订单ID不能为空');
  }

  // 获取当前订单
  const currentOrder = await db.collection('orders').doc(actualId).get();
  const currentVersion = currentOrder.data._version || 1;
  delete fields.createdAt;
  delete fields.createdBy;
  delete fields._createTime;
  delete fields._updateTime;
  if (fields.status !== undefined) {
    const raw = String(fields.status || '').trim();
    const lower = raw.toLowerCase();
    let normalized = raw;
    if (raw === '已下单' || lower === 'ordered' || lower === 'created') normalized = 'ordered';
    else if (raw === '待生产' || lower === 'pending' || lower === 'waiting' || lower === 'planned' || lower === 'to_produce' || lower === 'prepare') normalized = 'pending';
    else if (raw === '生产中' || lower === 'processing' || lower === 'in_progress' || lower === 'producing') normalized = 'processing';
    else if (raw === '已入库' || lower === 'stocked' || lower === 'warehoused' || lower === 'warehouse') normalized = 'stocked';
    else if (raw === '已发货' || lower === 'shipping' || lower === 'shipped' || lower === 'delivered') normalized = 'shipping';
    else if (raw === '已完成' || lower === 'completed' || lower === 'done') normalized = 'completed';

    // 如果状态变为已入库，且之前不是已入库，则触发入库逻辑（更新库存）
    if (normalized === 'stocked' && currentOrder.data.status !== 'stocked') {
      try {
        let qty = currentOrder.data.quantity;
        // 如果提供了stockedQty，计算增量
        if (fields.stockedQty !== undefined) {
          qty = Number(fields.stockedQty) - Number(currentOrder.data.stockedQty || 0);
        }

        if (qty > 0) {
          await stockInPurchaseOrder({
            orderId: actualId,
            quantity: qty,
            goodsName: currentOrder.data.productTitle || currentOrder.data.goodsName,
            spec: currentOrder.data.spec || currentOrder.data.materialNo,
            unit: currentOrder.data.unit
          }, wxContext);
        }
      } catch (e) {
        console.warn('自动入库失败:', e);
      }
    }

    fields.status = normalized;
  }

  if (fields.shippedQty !== undefined) {
    const n = Number(fields.shippedQty);
    fields.shippedQty = (Number.isFinite(n) && n >= 0) ? n : 0;
    if (fields.shippedQty > 0 && !fields.shippedAt) {
      fields.shippedAt = new Date().toISOString();
    }
  }

  const parseDataUrl = (s) => {
    const m = String(s).match(/^data:(.*?);base64,(.*)$/);
    return m ? { mime: m[1], b64: m[2] } : null;
  };
  const extFromMime = (mime) => {
    const s = String(mime || '').toLowerCase();
    if (s.includes('png')) return 'png';
    if (s.includes('jpeg') || s.includes('jpg')) return 'jpg';
    if (s.includes('gif')) return 'gif';
    if (s.includes('webp')) return 'webp';
    return 'jpg';
  };
  const uploadFromDataUrl = async (name, dataUrl, idx) => {
    const p = parseDataUrl(dataUrl);
    if (!p) return { name, url: dataUrl };
    const ext = extFromMime(p.mime);
    const cloudPath = `attachments/orders/${actualId}_${Date.now()}_${idx}.${ext}`;
    const buffer = Buffer.from(p.b64, 'base64');
    const res = await cloud.uploadFile({ cloudPath, fileContent: buffer });
    return { name, fileID: res.fileID };
  };
  let normalizedAtt = undefined;
  if (Array.isArray(fields.attachments)) {
    normalizedAtt = [];
    for (let i = 0; i < fields.attachments.length; i++) {
      const a = fields.attachments[i];
      if (typeof a === 'string') {
        if (/^data:/.test(a)) {
          normalizedAtt.push(await uploadFromDataUrl('附件', a, i));
        } else if (/^cloud:\/\//.test(a)) {
          normalizedAtt.push({ name: a, fileID: a });
        } else {
          normalizedAtt.push({ name: a, url: a });
        }
      } else if (a && a.url && /^data:/.test(a.url)) {
        normalizedAtt.push(await uploadFromDataUrl(a.name || '附件', a.url, i));
      } else if (a && a.fileID) {
        normalizedAtt.push({ name: a.name || '附件', fileID: a.fileID });
      } else if (a && a.url) {
        normalizedAtt.push({ name: a.name || '附件', url: a.url });
      } else if (a) {
        normalizedAtt.push({ name: a.name || '附件' });
      }
    }
  }

  const current = currentOrder && currentOrder.data ? currentOrder.data : {};
  const finalOrderNo = String(fields.orderNo || fields.orderNumber || current.orderNo || current.orderNumber || '').trim();
  const desiredQrCodeUrl = finalOrderNo
    ? buildQrServerUrl(buildOrderQrPayload({ orderId: actualId, orderNo: finalOrderNo }), 220)
    : undefined;
  let nextQrCodeUrl = fields.qrCodeUrl;
  if (!nextQrCodeUrl || !isQrCodeUrlForOrder(nextQrCodeUrl, actualId)) {
    if (current.qrCodeUrl && isQrCodeUrlForOrder(current.qrCodeUrl, actualId)) {
      nextQrCodeUrl = current.qrCodeUrl;
    } else {
      nextQrCodeUrl = desiredQrCodeUrl;
    }
  }

  const updatedOrder = pickDefinedFields({
    ...fields,
    ...(normalizedAtt !== undefined ? { attachments: normalizedAtt } : {}),
    ...(nextQrCodeUrl ? { qrCodeUrl: nextQrCodeUrl } : {}),
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID,
    _version: currentVersion + 1
  });

  if (typeof fields.productName === 'string' && String(fields.productName || '').trim()) {
    await ensureProductCategoryValid(fields.productName, wxContext)
  }

  // 更新订单
  const result = await db.collection('orders').doc(actualId).update({
    data: updatedOrder
  });

  // 记录操作日志
  await logOperation('update_order', 'orders', actualId, fields, wxContext.OPENID);

  console.log(`[ERP-API] 更新订单成功: ${actualId}`);

  return {
    success: true,
    data: updatedOrder,
    message: '订单更新成功'
  };
}

/**
 * 删除订单
 */
async function deleteOrder(data, wxContext) {
  const orderId = data.id || data._id || data.orderId ||
    (data.pathParameters && data.pathParameters.id) ||
    (data.params && data.params.id);

  if (!orderId) {
    throw new Error('订单ID不能为空');
  }

  await ensureCloudCollectionsExist(['order_delete_logs'])

  const target = String(orderId || '').trim()
  const now = Date.now();
  const actor = wxContext.OPENID || 'anonymous'
  const collections = ['orders', 'orders_tmp', 'erp_orders', 'order_list', 'purchase_orders', 'production']
  const affected = []

  await withDistributedLock(`order_delete_${target}`, 6000, `${actor}_${now}_${randomFixedDigits(4)}`, async () => {
    for (const name of collections) {
      try {
        const got = await db.collection(name).doc(target).get()
        const row = got && got.data ? got.data : null
        if (row) {
          await db.collection(name).doc(target).remove()
          affected.push({ collection: name, _id: target, orderNo: row.orderNo || row.orderNumber || null })
        }
      } catch (_) { void 0 }
    }

    if (!affected.length) {
      for (const name of collections) {
        try {
          const query = await db.collection(name).where(_.or([{ orderNo: target }, { orderNumber: target }])).limit(20).get()
          const rows = query && Array.isArray(query.data) ? query.data : []
          for (const row of rows) {
            const id = String(row && (row._id || row.id) || '').trim()
            if (!id) continue
            await db.collection(name).doc(id).remove()
            affected.push({ collection: name, _id: id, orderNo: row.orderNo || row.orderNumber || null })
          }
        } catch (_) { void 0 }
      }
    }
  })

  if (!affected.length) {
    throw new Error('订单不存在');
  }

  try {
    await db.collection('order_delete_logs').add({
      data: {
        target,
        affected,
        createdAt: now,
        createdBy: actor
      }
    })
  } catch (_) { void 0 }

  for (const item of affected) {
    try {
      await logOperation('hard_delete_order', item.collection, item._id, { ...(item || {}), hardDeleted: true, deletedAt: now, deletedBy: actor }, actor);
    } catch (_) { void 0 }
  }

  console.log(`[ERP-API] 删除订单成功: ${target}, affected=${affected.length}`);

  return {
    success: true,
    data: { _id: target, hardDeleted: true, affected },
    message: '订单删除成功'
  };
}

async function deletePurchaseOrder(data, wxContext) {
  const orderId = data.id || data._id || data.orderId;
  if (!orderId) {
    throw new Error('订单ID不能为空');
  }
  const now = Date.now();
  const actor = wxContext.OPENID || 'anonymous'
  let order = null;
  try {
    const got = await db.collection('purchase_orders').doc(orderId).get();
    order = got && got.data ? got.data : null;
  } catch (_) { void 0 }
  await db.collection('purchase_orders').doc(orderId).remove();
  await logOperation('hard_delete_purchase_order', 'purchase_orders', orderId, { ...(order || {}), hardDeleted: true, deletedAt: now, deletedBy: actor }, actor);
  return { success: true, data: { _id: orderId, hardDeleted: true }, message: '订单删除成功' };
}

async function purgeDeletedOrders(input = {}, wxContext) {
  const p = input && typeof input === 'object' ? input : {}
  const dryRun = p.dryRun === true || String(p.dryRun || '').toLowerCase() === 'true'
  const limit = Math.max(1, Math.min(2000, Number(p.limit || 500) || 500))
  const olderThanMs = p.olderThanMs != null ? Number(p.olderThanMs) : null
  const backupCollection = String(p.backupCollection || '').trim()
  const actor = String(wxContext?.OPENID || p.actorUserId || 'anonymous').trim() || 'anonymous'
  const collections = Array.isArray(p.collections) && p.collections.length
    ? p.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'orders_tmp', 'purchase_orders', 'production']

  await ensureCloudCollectionsExist(['operation_logs'])
  if (backupCollection) {
    await ensureCloudCollectionsExist([backupCollection])
  }

  const whereDeleted = _.or([
    { isDeleted: true },
    { deleted: true },
    { deletedAt: _.exists(true) },
    { deleted_at: _.exists(true) },
    { removedAt: _.exists(true) },
    { removed_at: _.exists(true) }
  ])

  const summary = {
    dryRun,
    limit,
    olderThanMs,
    backupCollection: backupCollection || null,
    collections,
    removed: 0,
    scanned: 0,
    byCollection: {},
    errors: []
  }

  const shouldRemove = (doc) => {
    if (olderThanMs == null) return true
    const t =
      Number(doc?.deletedAt || 0) ||
      Number(doc?.deleted_at || 0) ||
      Number(doc?.removedAt || 0) ||
      Number(doc?.removed_at || 0) ||
      Number(doc?.updatedAt || 0) ||
      Number(doc?.updated_at || 0) ||
      0
    if (!t) return false
    return t <= olderThanMs
  }

  for (const name of collections) {
    let removed = 0
    let scanned = 0
    try {
      await db.collection(name).limit(1).get()
    } catch (e) {
      summary.byCollection[name] = { removed: 0, scanned: 0, skipped: true }
      continue
    }

    const res = await db.collection(name).where(whereDeleted).limit(limit).get().catch(() => null)
    const rows = res && Array.isArray(res.data) ? res.data : []
    scanned = rows.length
    for (const row of rows) {
      if (!shouldRemove(row)) continue
      const id = String(row?._id || '').trim()
      if (!id) continue
      if (dryRun) {
        removed += 1
        continue
      }
      if (backupCollection) {
        try {
          await db.collection(backupCollection).add({
            data: {
              sourceCollection: name,
              docId: id,
              orderNo: String(row?.orderNo || row?.orderNumber || '').trim() || null,
              archivedAt: Date.now(),
              archivedBy: actor,
              doc: row
            }
          })
        } catch (_) { void 0 }
      }
      try {
        await db.collection(name).doc(id).remove()
        removed += 1
      } catch (e) {
        summary.errors.push({ collection: name, id, error: normalizeErrorForLog(e) })
      }
    }
    summary.byCollection[name] = { removed, scanned }
    summary.removed += removed
    summary.scanned += scanned
  }

  try {
    await logOperation('purge_deleted_orders', 'system', '', summary, actor)
  } catch (_) { void 0 }

  return {
    success: true,
    message: dryRun ? '清理预演完成' : '清理完成',
    data: summary
  }
}

/**
 * 获取订单详情
 */
async function getOrderDetail(orderId) {
  if (!orderId) {
    throw new Error('订单ID不能为空');
  }

  let order = null;
  try {
    const result = await db.collection('orders').doc(orderId).get();
    order = result && result.data ? result.data : null;
  } catch (_) { void 0 }

  if (!order) {
    try {
      const query = await db.collection('orders').where(
        _.or([
          { orderNo: orderId },
          { orderNumber: orderId }
        ])
      ).limit(1).get();
      if (query && query.data && query.data.length > 0) {
        order = query.data[0];
      }
    } catch (_) { void 0 }
  }

  if (!order) {
    try {
      const result2 = await db.collection('orders_tmp').doc(orderId).get();
      order = result2 && result2.data ? result2.data : null;
    } catch (_) { void 0 }
  }

  if (!order) {
    try {
      const query2 = await db.collection('orders_tmp').where(
        _.or([
          { orderNo: orderId },
          { orderNumber: orderId }
        ])
      ).limit(1).get();
      if (query2 && query2.data && query2.data.length > 0) {
        order = query2.data[0];
      }
    } catch (_) { void 0 }
  }

  if (!order) {
    return { success: false, message: '订单不存在' };
  }

  const actualId = (order && order._id) ? order._id : orderId;
  const nested = (order && order.data && typeof order.data === 'object') ? order.data : null;
  const canonicalOrderNo = order && (nested?.orderNo || nested?.orderNumber || order.orderNo || order.orderNumber)
    ? (nested?.orderNo || nested?.orderNumber || order.orderNo || order.orderNumber)
    : '';
  const derivedQrCodeUrl = buildQrServerUrl(buildOrderQrPayload({ orderId: actualId, orderNo: canonicalOrderNo }), 220);
  const nextQrCodeUrl = (order && order.qrCodeUrl && isQrCodeUrlForOrder(order.qrCodeUrl, actualId))
    ? order.qrCodeUrl
    : derivedQrCodeUrl;

  if (canonicalOrderNo) {
    order.orderNo = canonicalOrderNo;
    order.orderNumber = canonicalOrderNo;
  }

  return {
    success: true,
    data: order ? { ...order, ...(nextQrCodeUrl ? { qrCodeUrl: nextQrCodeUrl } : {}) } : order
  };
}

/**
 * 批量补齐所有缺失二维码的订单（排除采购类）
 */
async function fixMissingOrderQRCodes(params = {}) {
  const pageSize = Math.max(10, Math.min(100, Number(params.pageSize || 100)));
  const _ = db.command;
  let countQuery = db.collection('orders').where(_.and([
    { orderType: _.neq('purchase') },
    _.or([
      { source: _.neq('purchased') },
      { source: _.exists(false) },
      { source: null },
      { source: '' }
    ])
  ]));
  const countRes = await countQuery.count();
  const total = Number(countRes.total || 0);
  let skip = 0;
  let updated = 0;
  let scanned = 0;
  const failed = [];
  while (skip < total) {
    const res = await countQuery.orderBy('createdAt', 'asc').skip(skip).limit(pageSize).get().catch(() => ({ data: [] }));
    const rows = Array.isArray(res.data) ? res.data : [];
    if (!rows.length) break;
    for (const o of rows) {
      scanned += 1;
      if (!o || !o._id) continue;
      const canonicalOrderNo = (o.orderNo || o.orderNumber) ? (o.orderNo || o.orderNumber) : '';
      const derived = buildQrServerUrl(buildOrderQrPayload({ orderId: o._id, orderNo: canonicalOrderNo }), 220);
      const isValidCurrent = o.qrCodeUrl && isQrCodeUrlForOrder(o.qrCodeUrl, o._id);
      const nextQr = isValidCurrent ? o.qrCodeUrl : derived;
      if (!nextQr || nextQr === o.qrCodeUrl) continue;
      try {
        await db.collection('orders').doc(o._id).update({ data: { qrCodeUrl: nextQr, updatedAt: Date.now() } });
        updated += 1;
      } catch (e) {
        failed.push({ id: o._id, error: String(e && e.message || e || 'unknown') });
      }
    }
    skip += rows.length;
    if (rows.length < pageSize) break;
  }
  return {
    success: true,
    data: { total, scanned, updated, failedCount: failed.length, failed },
    message: `二维码补齐完成：总计${total}，扫描${scanned}，更新${updated}，失败${failed.length}`
  };
}

/**
 * 生成每日订单号（云函数版）
 */

/**
 * 创建客户
 */
async function createCustomer(customerData, wxContext) {
  const now = Date.now();

  const normalized = {
    companyName: customerData.companyName || customerData.name,
    shortName: customerData.shortName || '',
    paymentTerms: customerData.paymentTerms,
    contactName: customerData.contactName || customerData.contact,
    phone: customerData.phone,
    email: customerData.email,
    address: customerData.address,
    status: customerData.status || 'active'
  };

  const customer = {
    _id: uuidv4(),
    ...normalized,
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID,
    updatedBy: wxContext.OPENID
  };

  // 验证客户数据
  validateCustomerData(customer);

  const result = await db.collection('customers').add({
    data: customer
  });

  await logOperation('create_customer', 'customers', result._id, customer, wxContext.OPENID);

  console.log(`[ERP-API] 创建客户成功: ${customer.companyName}`);

  return {
    success: true,
    data: {
      ...customer,
      _id: result._id
    },
    message: '客户创建成功'
  };
}

function pickDefinedFields(input) {
  const obj = input && typeof input === 'object' ? input : {}
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * 更新客户
 */
async function updateCustomer(updateData, wxContext) {
  const { customerId, customer, ...fields } = updateData;

  console.log('updateCustomer 接收到的参数:', updateData);

  // 检查参数格式，支持两种格式
  let actualCustomerId = customerId || updateData.docId || updateData._id || updateData.id;
  let updateFields = customer || { ...fields };
  // 清理可能携带的标识字段
  delete updateFields.id;
  delete updateFields._id;
  delete updateFields.docId;
  delete updateFields.customerId;

  if (!actualCustomerId) {
    throw new Error('客户ID不能为空');
  }

  const patch = {}
  if ('companyName' in updateFields || 'name' in updateFields) patch.companyName = updateFields.companyName ?? updateFields.name
  if ('shortName' in updateFields) patch.shortName = updateFields.shortName
  if ('paymentTerms' in updateFields) patch.paymentTerms = updateFields.paymentTerms
  if ('contactName' in updateFields || 'contact' in updateFields) patch.contactName = updateFields.contactName ?? updateFields.contact
  if ('phone' in updateFields) patch.phone = updateFields.phone
  if ('email' in updateFields) patch.email = updateFields.email
  if ('address' in updateFields) patch.address = updateFields.address
  if ('status' in updateFields) patch.status = updateFields.status
  if ('frequency' in updateFields) patch.frequency = updateFields.frequency
  patch.updatedAt = Date.now()
  patch.updatedBy = wxContext.OPENID
  const updatedCustomer = pickDefinedFields(patch)

  console.log('准备更新客户数据，客户ID:', actualCustomerId);

  // 更新客户数据（优先使用文档ID）
  const result = await db.collection('customers').doc(actualCustomerId).update({ data: updatedCustomer });

  console.log('云数据库更新成功:', result);

  await logOperation('update_customer', 'customers', actualCustomerId, updatedCustomer, wxContext.OPENID);

  // 返回最新文档内容
  const fresh = await db.collection('customers').doc(actualCustomerId).get();
  return {
    success: true,
    data: fresh.data || updatedCustomer,
    message: '客户更新成功'
  };
}

/**
 * 获取供应商列表
 */
async function getSuppliers(params = {}) {
  const { page = 1, limit = 20, keyword, status } = params;
  const skip = (page - 1) * limit;

  try {
    let query = db.collection('suppliers');
    query = query.where({ isDeleted: _.neq(true) });
    if (status) query = query.where({ status });
    if (keyword) {
      query = query.where(_.or([
        { name: db.RegExp({ regexp: keyword, options: 'i' }) },
        { shortName: db.RegExp({ regexp: keyword, options: 'i' }) },
        { contactName: db.RegExp({ regexp: keyword, options: 'i' }) },
        { phone: db.RegExp({ regexp: keyword, options: 'i' }) }
      ]));
    }

    const result = await query.orderBy('createdAt', 'desc').skip(skip).limit(limit).get();
    let countQuery = db.collection('suppliers').where({ isDeleted: _.neq(true) });
    if (status) countQuery = countQuery.where({ status });
    const countResult = await countQuery.count();

    return {
      success: true,
      data: result.data,
      pagination: { page, limit, total: countResult.total, hasMore: skip + result.data.length < countResult.total }
    };
  } catch (e) {
    if (e && (e.errCode === -502005 || e.errCode === 'DATABASE_COLLECTION_NOT_EXIST')) {
      return {
        success: true,
        data: [],
        pagination: { page, limit, total: 0, hasMore: false }
      };
    }
    throw e;
  }
}

/**
 * 创建供应商
 */
async function createSupplier(supplierData, wxContext) {
  const now = Date.now();
  const supplier = {
    _id: uuidv4(),
    name: supplierData.name,
    shortName: supplierData.shortName || '',
    contactName: supplierData.contactName || '',
    phone: supplierData.phone || '',
    industry: supplierData.industry || '',
    address: supplierData.address || supplierData.companyAddress || supplierData.company_address || '',
    status: supplierData.status || 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID,
    updatedBy: wxContext.OPENID
  };

  if (!supplier.name) {
    throw new Error('供应商名称不能为空');
  }

  try {
    const result = await db.collection('suppliers').add({ data: supplier });
    await logOperation('create_supplier', 'suppliers', result._id, supplier, wxContext.OPENID);
    return { success: true, data: { ...supplier, _id: result._id }, message: '供应商创建成功' };
  } catch (e) {
    if (e && (e.errCode === -502005 || e.errCode === 'DATABASE_COLLECTION_NOT_EXIST')) {
      await db.createCollection('suppliers');
      const result = await db.collection('suppliers').add({ data: supplier });
      await logOperation('create_supplier', 'suppliers', result._id, supplier, wxContext.OPENID);
      return { success: true, data: { ...supplier, _id: result._id }, message: '供应商创建成功' };
    }
    return { success: false, message: e.message || '创建供应商失败' };
  }
}

/**
 * 更新供应商
 */
async function updateSupplier(updateData, wxContext) {
  const { id, _id, supplierId, ...fields } = updateData;
  const actualId = id || _id || supplierId;

  if (!actualId) {
    throw new Error('供应商ID不能为空');
  }

  // Remove ID fields from update payload if they exist in fields (though destructuring removed id, _id, supplierId)
  // destructuring { id, _id, supplierId, ...fields } already removes them from fields.

  const updatedSupplier = pickDefinedFields({
    ...fields,
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID
  });

  const result = await db.collection('suppliers').doc(actualId).update({
    data: updatedSupplier
  });

  await logOperation('update_supplier', 'suppliers', actualId, fields, wxContext.OPENID);

  return {
    success: true,
    data: updatedSupplier,
    message: '供应商更新成功'
  };
}

/**
 * 删除供应商
 */
async function deleteSupplier(data, wxContext) {
  const { id, _id, supplierId } = data || {};
  const actualId = id || _id || supplierId;

  if (!actualId) {
    throw new Error('供应商ID不能为空');
  }

  // 检查是否有关联数据（如采购订单）
  // 暂时略过检查，直接删除

  const now = Date.now();
  let supplier = null;
  try {
    const got = await db.collection('suppliers').doc(actualId).get();
    supplier = got && got.data ? got.data : null;
  } catch (_) { }
  const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
  await db.collection('suppliers').doc(actualId).update({ data: patch });
  await logOperation('delete_supplier', 'suppliers', actualId, { ...(supplier || {}), ...patch }, wxContext.OPENID);

  return {
    success: true,
    data: { _id: actualId, softDeleted: true },
    message: '供应商删除成功'
  };
}

async function restoreSupplier(data, wxContext) {
  const { id, _id, supplierId } = data || {};
  const actualId = id || _id || supplierId;

  if (!actualId) {
    throw new Error('供应商ID不能为空');
  }

  const now = Date.now();
  let existing = null;
  try {
    const got = await db.collection('suppliers').doc(actualId).get();
    existing = got && got.data ? got.data : null;
  } catch (_) { }

  if (!existing) {
    return { success: false, message: '供应商不存在' };
  }

  const patch = {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    restoredAt: now,
    restoredBy: wxContext.OPENID,
    updatedAt: now,
    updatedBy: wxContext.OPENID
  };

  await db.collection('suppliers').doc(actualId).update({ data: patch });
  await logOperation('restore_supplier', 'suppliers', actualId, { ...(existing || {}), ...patch }, wxContext.OPENID);

  const fresh = await db.collection('suppliers').doc(actualId).get().catch(() => null);
  return {
    success: true,
    data: (fresh && fresh.data) ? fresh.data : { ...existing, ...patch },
    message: '供应商恢复成功'
  };
}

/**
 * 获取产品品类
 */
async function getProductCategories(params = {}) {
  const { page = 1, limit = 50, keyword } = params;
  const skip = (page - 1) * limit;
  let query = db.collection('product_categories');
  if (keyword) {
    query = query.where({ name: db.RegExp({ regexp: keyword, options: 'i' }) });
  }
  const result = await query.orderBy('createdAt', 'desc').skip(skip).limit(limit).get();
  const countResult = await db.collection('product_categories').count();
  return { success: true, data: result.data, pagination: { page, limit, total: countResult.total } };
}

/**
 * 创建产品品类
 */
async function createProductCategory(categoryData, wxContext) {
  const now = Date.now();
  const name = categoryData.name && String(categoryData.name).trim();
  if (!name) throw new Error('品类名称不能为空');
  const exists = await db.collection('product_categories').where({ name }).limit(1).get();
  if (exists.data && exists.data.length) {
    return { success: true, data: exists.data[0], message: '品类已存在' };
  }
  const category = { _id: uuidv4(), name, createdAt: now, updatedAt: now, createdBy: wxContext.OPENID, updatedBy: wxContext.OPENID };
  const result = await db.collection('product_categories').add({ data: category });
  await logOperation('create_product_category', 'product_categories', result._id, category, wxContext.OPENID);
  return { success: true, data: { ...category, _id: result._id }, message: '品类创建成功' };
}

/**
 * 根据ID获取单个客户信息
 */
async function getCustomerById(customerId, wxContext) {
  const id = customerId != null ? String(customerId).trim() : '';
  if (!id) {
    throw new Error('客户ID不能为空');
  }

  try {
    const docRes = await db.collection('customers').doc(id).get();
    if (docRes && docRes.data) return { success: true, data: docRes.data };
  } catch (_) {}

  const byId = await db.collection('customers').where({ _id: id }).limit(1).get();
  if (byId.data && byId.data.length) return { success: true, data: byId.data[0] };

  const byBiz = await db.collection('customers').where({ id }).limit(1).get();
  if (byBiz.data && byBiz.data.length) return { success: true, data: byBiz.data[0] };

  throw new Error('客户不存在');
}

async function diagnoseCustomerVisibility(payload, wxContext) {
  const id = payload && (payload.docId || payload._id || payload.customerId || payload.id) != null
    ? String(payload.docId || payload._id || payload.customerId || payload.id).trim()
    : '';
  const keyword = payload && (payload.keyword || payload.companyName || payload.name) != null
    ? String(payload.keyword || payload.companyName || payload.name).trim()
    : '';

  let doc = null;
  let foundBy = '';
  let fetchError = '';

  if (id) {
    try {
      const docRes = await db.collection('customers').doc(id).get();
      if (docRes && docRes.data) {
        doc = docRes.data;
        foundBy = 'doc';
      }
    } catch (e) {
      fetchError = e && e.message ? String(e.message) : String(e || '');
    }
  }

  if (!doc && id) {
    try {
      const byId = await db.collection('customers').where({ _id: id }).limit(1).get();
      if (byId.data && byId.data.length) {
        doc = byId.data[0];
        foundBy = '_id';
      }
    } catch (e) {
      fetchError = fetchError || (e && e.message ? String(e.message) : String(e || ''));
    }
  }

  if (!doc && id) {
    try {
      const byBiz = await db.collection('customers').where({ id }).limit(1).get();
      if (byBiz.data && byBiz.data.length) {
        doc = byBiz.data[0];
        foundBy = 'id';
      }
    } catch (e) {
      fetchError = fetchError || (e && e.message ? String(e.message) : String(e || ''));
    }
  }

  if (!doc && keyword) {
    try {
      const reg = db.RegExp({ regexp: keyword, options: 'i' });
      const byKw = await db.collection('customers').where(_.or([
        { name: reg },
        { companyName: reg },
        { company: reg },
        { customerName: reg },
        { shortName: reg },
        { contact: reg },
        { contactName: reg },
        { phone: reg }
      ])).limit(5).get();
      if (byKw.data && byKw.data.length) {
        doc = byKw.data[0];
        foundBy = 'keyword';
      }
    } catch (e) {
      fetchError = fetchError || (e && e.message ? String(e.message) : String(e || ''));
    }
  }

  const normalizeId = (raw) => {
    if (!raw) return '';
    const v = raw._id || raw.id;
    return v != null ? String(v).trim() : '';
  };

  const customerId = id || normalizeId(doc);
  const baseName = doc && (doc.companyName || doc.name || doc.company || doc.customerName) != null ? String(doc.companyName || doc.name || doc.company || doc.customerName) : '';
  const isDeleted = doc ? doc.isDeleted === true : null;
  const status = doc && doc.status != null ? String(doc.status) : null;

  let visibleList = null;
  let allList = null;
  try {
    visibleList = await getCustomers({ page: 1, limit: 1000 });
  } catch (_) {
    visibleList = null;
  }
  try {
    allList = await getCustomers({ page: 1, limit: 1000, includeDeleted: true });
  } catch (_) {
    allList = null;
  }

  const visibleRows = visibleList && Array.isArray(visibleList.data) ? visibleList.data : [];
  const allRows = allList && Array.isArray(allList.data) ? allList.data : [];

  const inVisibleList = customerId
    ? visibleRows.some((r) => normalizeId(r) === customerId)
    : false;
  const inAllList = customerId
    ? allRows.some((r) => normalizeId(r) === customerId)
    : false;

  let reason = '';
  if (!doc) {
    reason = 'not_found_in_customers';
  } else if (isDeleted === true && !inVisibleList && inAllList) {
    reason = 'soft_deleted';
  } else if (!inVisibleList && inAllList) {
    reason = 'filtered_by_params_or_state';
  } else if (!inVisibleList && !inAllList) {
    reason = 'not_returned_by_getCustomers';
  } else {
    reason = 'visible';
  }

  return {
    success: true,
    data: {
      env: process.env.TCB_ENV || process.env.SCF_NAMESPACE || '',
      input: { id, keyword },
      found: Boolean(doc),
      foundBy,
      fetchError,
      customer: doc
        ? {
          _id: doc._id,
          id: doc.id,
          companyName: doc.companyName,
          name: doc.name,
          customerName: doc.customerName,
          shortName: doc.shortName,
          status: doc.status,
          isDeleted: doc.isDeleted,
          deletedAt: doc.deletedAt,
          deletedBy: doc.deletedBy,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt
        }
        : null,
      computed: {
        customerId,
        baseName,
        isDeleted,
        status,
        inVisibleList,
        inAllList,
        visibleCount: visibleRows.length,
        allCount: allRows.length,
        reason
      }
    }
  };
}

async function restoreCustomer(data, wxContext) {
  console.log('[ERP-API] inside restoreCustomer with:', JSON.stringify(data));
  const { customerId, id, docId, _id } = data || {};
  const actualCustomerId = docId || _id || customerId || id;
  const targetId = actualCustomerId != null ? String(actualCustomerId).trim() : '';
  if (!targetId) throw new Error('客户ID不能为空');

  const now = Date.now();
  const patch = {
    isDeleted: false,
    deletedAt: _.remove(),
    deletedBy: _.remove(),
    updatedAt: now,
    updatedBy: wxContext.OPENID
  };

  try {
    await db.collection('customers').doc(targetId).update({ data: patch });
    await logOperation('restore_customer', 'customers', targetId, patch, wxContext.OPENID);
    return { success: true, data: { _id: targetId }, message: '客户恢复成功' };
  } catch (_) {}

  const byId = await db.collection('customers').where({ _id: targetId }).limit(1).get();
  if (byId.data && byId.data.length) {
    const docId2 = byId.data[0]._id;
    await db.collection('customers').doc(docId2).update({ data: patch });
    await logOperation('restore_customer', 'customers', docId2, patch, wxContext.OPENID);
    return { success: true, data: { _id: docId2 }, message: '客户恢复成功' };
  }

  const byBiz = await db.collection('customers').where({ id: targetId }).limit(1).get();
  if (byBiz.data && byBiz.data.length) {
    const docId3 = byBiz.data[0]._id;
    await db.collection('customers').doc(docId3).update({ data: patch });
    await logOperation('restore_customer', 'customers', docId3, patch, wxContext.OPENID);
    return { success: true, data: { _id: docId3 }, message: '客户恢复成功' };
  }

  throw new Error('客户不存在');
}

/**
 * 删除客户
 */
async function deleteCustomer(data, wxContext) {
  // 支持多种参数格式
  const { customerId, id, docId, _id } = data || {};
  const actualCustomerId = docId || _id || customerId || id;

  if (!actualCustomerId) {
    throw new Error('客户ID不能为空');
  }
  console.log('删除客户，ID:', actualCustomerId, '操作人:', wxContext.OPENID);

  try {
    const customer = await db.collection('customers').doc(actualCustomerId).get();

    if (!customer.data) {

      // 尝试使用_id字段查询，添加_openid条件
      const queryResult = await db.collection('customers').where({
        _id: actualCustomerId,
        _openid: wxContext.OPENID
      }).get();

      if (queryResult.data.length > 0) {
        const docId = queryResult.data[0]._id;
        const now = Date.now();
        const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
        await db.collection('customers').doc(docId).update({ data: patch });
        await logOperation('delete_customer', 'customers', docId, { ...(queryResult.data[0] || {}), ...patch }, wxContext.OPENID);

        return {
          success: true,
          message: '客户删除成功',
          deletedId: docId,
          softDeleted: true
        };
      } else {
        const otherQuery = await db.collection('customers').where({
          id: actualCustomerId,
          _openid: wxContext.OPENID
        }).get();
        if (otherQuery.data.length > 0) {
          const docId = otherQuery.data[0]._id;
          const now = Date.now();
          const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
          await db.collection('customers').doc(docId).update({ data: patch });
          await logOperation('delete_customer', 'customers', docId, { ...(otherQuery.data[0] || {}), ...patch }, wxContext.OPENID);

          return {
            success: true,
            message: '客户删除成功',
            deletedId: docId,
            softDeleted: true
          };
        } else {
          const allCustomers = await db.collection('customers').where({
            _openid: wxContext.OPENID
          }).limit(10).get();

          throw new Error('找不到要删除的客户记录');
        }
      }
    } else {
      const now = Date.now();
      const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
      await db.collection('customers').doc(actualCustomerId).update({ data: patch });
      await logOperation('delete_customer', 'customers', actualCustomerId, { ...(customer.data || {}), ...patch }, wxContext.OPENID);

      return {
        success: true,
        message: '客户删除成功',
        deletedId: actualCustomerId,
        softDeleted: true
      };
    }
  } catch (error) {
    const fallbackById = await db.collection('customers').where({ _id: actualCustomerId }).limit(1).get();
    if (fallbackById.data && fallbackById.data.length > 0) {
      const now = Date.now();
      const docId = fallbackById.data[0]._id;
      const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
      await db.collection('customers').doc(docId).update({ data: patch });
      await logOperation('delete_customer', 'customers', docId, { ...(fallbackById.data[0] || {}), ...patch }, wxContext.OPENID);
      return { success: true, message: '客户删除成功', deletedId: docId, softDeleted: true };
    }
    const fallbackByBizId = await db.collection('customers').where({ id: actualCustomerId }).limit(1).get();
    if (fallbackByBizId.data && fallbackByBizId.data.length > 0) {
      const now = Date.now();
      const docId = fallbackByBizId.data[0]._id;
      const patch = { isDeleted: true, deletedAt: now, deletedBy: wxContext.OPENID, updatedAt: now, updatedBy: wxContext.OPENID };
      await db.collection('customers').doc(docId).update({ data: patch });
      await logOperation('delete_customer', 'customers', docId, { ...(fallbackByBizId.data[0] || {}), ...patch }, wxContext.OPENID);
      return { success: true, message: '客户删除成功', deletedId: docId, softDeleted: true };
    }
    throw new Error('删除客户失败：未找到匹配记录');
  }
}

/**
 * 获取产品列表
 */
async function getProducts(params = {}) {
  const { page = 1, limit = 20, categoryId, keyword, status } = params;
  const skip = (page - 1) * limit;

  let query = db.collection('products');

  if (status) {
    query = query.where({ status });
  }

  if (categoryId) {
    query = query.where({ categoryId });
  }

  if (keyword) {
    query = query.where(_.or([
      { name: db.RegExp({ regexp: keyword, options: 'i' }) },
      { sku: db.RegExp({ regexp: keyword, options: 'i' }) },
      { description: db.RegExp({ regexp: keyword, options: 'i' }) }
    ]));
  }

  const result = await query
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  let countQuery = db.collection('products');
  if (status) countQuery = countQuery.where({ status });
  if (categoryId) countQuery = countQuery.where({ categoryId });
  if (keyword) {
    countQuery = countQuery.where(_.or([
      { name: db.RegExp({ regexp: keyword, options: 'i' }) },
      { sku: db.RegExp({ regexp: keyword, options: 'i' }) },
      { description: db.RegExp({ regexp: keyword, options: 'i' }) }
    ]));
  }

  const countResult = await countQuery.count();

  return {
    success: true,
    data: result.data,
    pagination: {
      page,
      limit,
      total: countResult.total,
      hasMore: skip + result.data.length < countResult.total
    }
  };
}

/**
 * 创建产品
 */
async function createProduct(productData, wxContext) {
  const now = Date.now();

  const product = {
    _id: uuidv4(),
    ...productData,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID,
    updatedBy: wxContext.OPENID
  };

  validateProductData(product);

  const result = await db.collection('products').add({
    data: product
  });

  await logOperation('create_product', 'products', result._id, productData, wxContext.OPENID);

  console.log(`[ERP-API] 创建产品成功: ${product.name}`);

  return {
    success: true,
    data: {
      ...product,
      _id: result._id
    },
    message: '产品创建成功'
  };
}

/**
 * 更新产品
 */
async function updateProduct(updateData, wxContext) {
  const { id, _id, productId, ...fields } = updateData;
  const actualId = id || _id || productId;

  if (!actualId) {
    throw new Error('产品ID不能为空');
  }

  const updatedProduct = {
    ...fields,
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID
  };

  const result = await db.collection('products').doc(actualId).update({
    data: updatedProduct
  });

  await logOperation('update_product', 'products', actualId, fields, wxContext.OPENID);

  return {
    success: true,
    data: updatedProduct,
    message: '产品更新成功'
  };
}

/**
 * 删除产品
 */
async function deleteProduct(data, wxContext) {
  const productId = data.id || data._id || data.productId;

  if (!productId) {
    throw new Error('产品ID不能为空');
  }

  const product = await db.collection('products').doc(productId).get();
  const result = await db.collection('products').doc(productId).remove();

  await logOperation('delete_product', 'products', productId, product.data, wxContext.OPENID);

  return {
    success: true,
    message: '产品删除成功'
  };
}

/**
 * 获取库存信息
 */
async function getInventory(params = {}) {
  const { page = 1, limit = 20, productId, warehouseId } = params;
  const skip = (page - 1) * limit;

  let query = db.collection('inventory');

  if (productId) {
    query = query.where({ productId });
  }

  if (warehouseId) {
    query = query.where({ warehouseId });
  }

  const result = await query
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  let countQuery = db.collection('inventory');
  if (productId) countQuery = countQuery.where({ productId });
  if (warehouseId) countQuery = countQuery.where({ warehouseId });
  const countResult = await countQuery.count();

  return {
    success: true,
    data: result.data,
    pagination: {
      page,
      limit,
      total: countResult.total,
      hasMore: skip + result.data.length < countResult.total
    }
  };
}

/**
 * 更新库存
 */
async function updateInventory(inventoryData, wxContext) {
  const { productId, warehouseId, quantity, operation } = inventoryData;

  if (!productId || !warehouseId) {
    throw new Error('产品ID和仓库ID不能为空');
  }

  // 查找现有库存记录
  let inventoryRecord = await db.collection('inventory').where({
    productId,
    warehouseId
  }).get();

  let result;
  const now = Date.now();

  if (inventoryRecord.data.length > 0) {
    // 更新现有记录
    const record = inventoryRecord.data[0];
    let newQuantity = record.quantity;

    if (operation === 'add') {
      newQuantity += quantity;
    } else if (operation === 'subtract') {
      newQuantity = Math.max(0, newQuantity - quantity);
    } else {
      newQuantity = quantity;
    }

    result = await db.collection('inventory').doc(record._id).update({
      data: {
        quantity: newQuantity,
        updatedAt: now,
        updatedBy: wxContext.OPENID
      }
    });
  } else {
    // 创建新记录
    const newRecord = {
      _id: uuidv4(),
      productId,
      warehouseId,
      quantity: quantity || 0,
      createdAt: now,
      updatedAt: now,
      createdBy: wxContext.OPENID,
      updatedBy: wxContext.OPENID
    };

    result = await db.collection('inventory').add({
      data: newRecord
    });
  }

  await logOperation('update_inventory', 'inventory', productId, inventoryData, wxContext.OPENID);

  return {
    success: true,
    message: '库存更新成功'
  };
}

/**
 * 获取生产计划
 */
async function getProductionPlans(params = {}) {
  const { page = 1, limit = 20, status, orderId } = params;
  const skip = (page - 1) * limit;

  let query = db.collection('production');

  if (status) {
    query = query.where({ status });
  }

  if (orderId) {
    query = query.where({ orderId });
  }

  const result = await query
    .orderBy('scheduledDate', 'desc')
    .skip(skip)
    .limit(limit)
    .get();

  let countQuery = db.collection('production');
  if (status) countQuery = countQuery.where({ status });
  if (orderId) countQuery = countQuery.where({ orderId });
  const countResult = await countQuery.count();

  return {
    success: true,
    data: result.data,
    pagination: {
      page,
      limit,
      total: countResult.total,
      hasMore: skip + result.data.length < countResult.total
    }
  };
}

/**
 * 创建生产计划
 */
async function createProductionPlan(planData, wxContext) {
  const now = Date.now();

  const plan = {
    _id: uuidv4(),
    ...planData,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID,
    updatedBy: wxContext.OPENID
  };

  const result = await db.collection('production').add({
    data: plan
  });

  try {
    const orderId = planData.orderId || planData.docId || '';
    const orderNo = planData.orderNo || planData.orderNumber || '';
    if (orderId) {
      await db.collection('orders').doc(orderId).update({ data: { status: 'ordered', updatedAt: now, updatedBy: wxContext.OPENID } });
    } else if (orderNo) {
      const q = await db.collection('orders').where({ orderNo: orderNo }).limit(1).get();
      const doc = q && q.data && q.data[0];
      if (doc && doc._id) {
        await db.collection('orders').doc(doc._id).update({ data: { status: 'ordered', updatedAt: now, updatedBy: wxContext.OPENID } });
      }
    }
  } catch (_) { }

  await logOperation('create_production_plan', 'production', result._id, planData, wxContext.OPENID);

  return {
    success: true,
    data: {
      ...plan,
      _id: result._id
    },
    message: '生产计划创建成功'
  };
}

async function getProductionPlanDetail(id) {
  const actualId = typeof id === 'string' ? id.trim() : '';
  if (!actualId) {
    throw new Error('生产计划ID不能为空');
  }
  try {
    const res = await db.collection('production').doc(actualId).get();
    const doc = res && res.data ? res.data : null;
    return { success: true, data: doc };
  } catch (e) {
    return { success: true, data: null };
  }
}

async function updateProductionPlan(updateData, wxContext) {
  const actualId = updateData && (updateData.id || updateData._id || updateData.planId) ? (updateData.id || updateData._id || updateData.planId) : '';
  const trimmedId = String(actualId || '').trim();
  if (!trimmedId) {
    throw new Error('生产计划ID不能为空');
  }

  const payload = updateData && updateData.data && typeof updateData.data === 'object' ? updateData.data : null;
  const fields = payload || {};
  if (!payload) {
    Object.keys(updateData || {}).forEach((k) => {
      if (k === 'id' || k === '_id' || k === 'planId' || k === 'action' || k === 'params' || k === 'data') return;
      fields[k] = updateData[k];
    });
  }

  fields.updatedAt = Date.now();
  fields.updatedBy = wxContext.OPENID;

  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) {
    return { success: true, data: {}, message: '无需更新' };
  }

  const toUpdate = {};
  keys.forEach((k) => { toUpdate[k] = fields[k]; });

  await db.collection('production').doc(trimmedId).update({ data: toUpdate });
  await logOperation('update_production_plan', 'production', trimmedId, toUpdate, wxContext.OPENID);

  return { success: true, data: toUpdate, message: '生产计划更新成功' };
}

/**
 * 更新生产状态
 */
async function updateProductionStatus(statusData, wxContext) {
  const { id, _id, planId, status, notes } = statusData;
  const actualId = id || _id || planId;

  if (!actualId || !status) {
    throw new Error('生产计划ID和状态不能为空');
  }

  const updatedPlan = {
    status,
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID
  };

  if (notes) {
    updatedPlan.notes = notes;
  }

  const result = await db.collection('production').doc(actualId).update({
    data: updatedPlan
  });

  await logOperation('update_production_status', 'production', actualId, statusData, wxContext.OPENID);

  return {
    success: true,
    data: updatedPlan,
    message: '生产状态更新成功'
  };
}

/**
 * 获取用户列表
 */
async function getUsers(params = {}) {
  const { page = 1, limit = 20, keyword } = params;
  const skip = (page - 1) * limit;

  let query = db.collection('users');
  let countQuery = db.collection('users');
  if (keyword) {
    const filter = _.or([
      { username: db.RegExp({ regexp: keyword, options: 'i' }) },
      { name: db.RegExp({ regexp: keyword, options: 'i' }) },
      { phone: db.RegExp({ regexp: keyword, options: 'i' }) }
    ]);
    query = query.where(filter);
    countQuery = countQuery.where(filter);
  }

  const result = await query.orderBy('createdAt', 'desc').skip(skip).limit(limit).get();
  const countResult = await countQuery.count();

  return {
    success: true,
    data: result.data,
    pagination: { page, limit, total: countResult.total }
  };
}

/**
 * 创建用户
 */
async function createUser(userData, wxContext) {
  userData = userData && typeof userData === 'object' ? userData : {};
  const now = Date.now();
  const name = typeof userData.name === 'string' ? userData.name.trim() : '';
  const username = typeof userData.username === 'string' ? userData.username.trim() : '';
  const phoneInput = typeof userData.phone === 'string' ? userData.phone.trim() : '';
  const password = typeof userData.password === 'string' ? userData.password.trim() : '';
  const rawRole = typeof userData.role === 'string' ? userData.role.trim().toLowerCase() : '';
  const role = rawRole === 'administrator' ? 'admin' : (rawRole === 'admin' ? 'admin' : 'operator');
  const rawStatus = typeof userData.status === 'string' ? userData.status.trim().toLowerCase() : '';
  const status = rawStatus === 'disabled' ? 'disabled' : 'active';
  const phoneFromUsername = /^1[3-9]\d{9}$/.test(username) ? username : '';
  const phone = phoneInput || phoneFromUsername;
  const isStrongPassword = (pwd) => {
    const s = String(pwd || '');
    if (s.length < 8) return false;
    const hasLetter = /[a-z]/i.test(s);
    const hasDigit = /\d/.test(s);
    return hasLetter && hasDigit;
  };

  if (!name) throw new Error('用户名称不能为空');
  if (!username) throw new Error('登入账号不能为空');
  if (!password || password.length < 6) throw new Error('登入密码至少6位');
  if (role === 'admin' && !isStrongPassword(password)) throw new Error('管理员密码强度不足：至少8位且包含字母和数字');
  if (username === SUPER_ADMIN_USERNAME) throw new Error('该账号不可创建');
  if (phoneInput && !/^1[3-9]\d{9}$/.test(phoneInput)) throw new Error('手机号格式不正确');
  if (phone && phone === SUPER_ADMIN_PHONE) throw new Error('该手机号不可使用');

  const user = {
    _id: uuidv4(),
    name,
    username,
    password: bcrypt.hashSync(password, 10),
    role,
    status,
    avatar: userData.avatar || '/images/profile.png',
    department: userData.department || '',
    ...(phone ? { phone } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: wxContext.OPENID,
    updatedBy: wxContext.OPENID
  };

  const exists = await db.collection('users').where({ username }).limit(1).get();
  if (exists.data && exists.data.length) {
    throw new Error('用户名已存在');
  }
  if (phone) {
    const phoneExists = await db.collection('users').where({ phone }).limit(1).get();
    if (phoneExists.data && phoneExists.data.length) {
      throw new Error('手机号已存在');
    }
  }

  const result = await db.collection('users').add({ data: user });
  const logUser = { ...user };
  delete logUser.password;
  delete logUser.passwordHash;
  await logOperation('create_user', 'users', result._id, logUser, wxContext.OPENID);

  return { success: true, data: { ...user, _id: result._id }, message: '用户创建成功' };
}

/**
 * 更新用户
 */
async function updateUser(userData, wxContext) {
  const { id, _id, userId, ...fields } = userData;
  const actualId = id || _id || userId;

  if (!actualId) throw new Error('用户ID不能为空');

  const doc = await db.collection('users').doc(actualId).get();
  const existing = doc && doc.data ? doc.data : null;
  if (!existing) throw new Error('用户不存在');

  const existingKey = String(existing.phone || existing.username || '');
  if (existingKey === SUPER_ADMIN_USERNAME) {
    throw new Error('超管账号不可编辑');
  }

  const nextName = typeof fields.name === 'string' ? fields.name.trim() : undefined;
  const nextUsername = typeof fields.username === 'string' ? fields.username.trim() : undefined;
  const nextPhoneRaw = typeof fields.phone === 'string' ? fields.phone.trim() : undefined;
  const nextPassword = typeof fields.password === 'string' ? fields.password.trim() : undefined;
  const nextRoleRaw = typeof fields.role === 'string' ? fields.role.trim().toLowerCase() : undefined;
  const nextRole = typeof nextRoleRaw === 'string'
    ? (nextRoleRaw === 'administrator' ? 'admin' : (nextRoleRaw === 'admin' ? 'admin' : 'operator'))
    : undefined;
  const nextStatusRaw = typeof fields.status === 'string' ? fields.status.trim().toLowerCase() : undefined;
  const nextStatus = typeof nextStatusRaw === 'string' ? (nextStatusRaw === 'disabled' ? 'disabled' : 'active') : undefined;
  const isStrongPassword = (pwd) => {
    const s = String(pwd || '');
    if (s.length < 8) return false;
    const hasLetter = /[a-z]/i.test(s);
    const hasDigit = /\d/.test(s);
    return hasLetter && hasDigit;
  };

  if (typeof nextName === 'string' && !nextName) throw new Error('用户名称不能为空');
  if (typeof nextUsername === 'string' && !nextUsername) throw new Error('登入账号不能为空');
  if (typeof nextPassword === 'string' && nextPassword && nextPassword.length < 6) throw new Error('登入密码至少6位');
  if (typeof nextRole === 'string' && nextRole === 'admin' && String(existing.role || '').toLowerCase() !== 'admin' && !nextPassword) {
    throw new Error('升级为管理员时必须设置登录密码');
  }
  if (
    typeof nextPassword === 'string' &&
    nextPassword &&
    ((nextRole === 'admin') || (String(existing.role || '').toLowerCase() === 'admin')) &&
    !isStrongPassword(nextPassword)
  ) {
    throw new Error('管理员密码强度不足：至少8位且包含字母和数字');
  }

  let usernameToSet = existing.username;
  if (typeof nextUsername === 'string' && nextUsername && nextUsername !== existing.username) {
    if (nextUsername === SUPER_ADMIN_USERNAME) throw new Error('该账号不可设置');
    const exists = await db.collection('users').where({ username: nextUsername }).limit(1).get();
    if (exists.data && exists.data.length && String(exists.data[0]._id) !== String(actualId)) {
      throw new Error('用户名已存在');
    }
    usernameToSet = nextUsername;
  }

  const phoneLooksValid = /^1[3-9]\d{9}$/.test(usernameToSet);
  const shouldClearPhone = !phoneLooksValid && existing.phone && String(existing.phone) === String(existing.username);
  let phoneToSet;
  if (typeof nextPhoneRaw === 'string') {
    if (!nextPhoneRaw) {
      phoneToSet = '';
    } else {
      if (!/^1[3-9]\d{9}$/.test(nextPhoneRaw)) throw new Error('手机号格式不正确');
      if (nextPhoneRaw === SUPER_ADMIN_PHONE) throw new Error('该手机号不可使用');
      phoneToSet = nextPhoneRaw;
    }
  } else if (phoneLooksValid) {
    if (usernameToSet === SUPER_ADMIN_PHONE) throw new Error('该手机号不可使用');
    phoneToSet = usernameToSet;
  } else if (shouldClearPhone) {
    phoneToSet = '';
  }

  if (typeof phoneToSet === 'string' && phoneToSet && String(phoneToSet) !== String(existing.phone || '')) {
    const phoneExists = await db.collection('users').where({ phone: phoneToSet }).limit(1).get();
    if (phoneExists.data && phoneExists.data.length && String(phoneExists.data[0]._id) !== String(actualId)) {
      throw new Error('手机号已存在');
    }
  }

  const updatedUser = {
    ...(typeof nextName === 'string' ? { name: nextName } : {}),
    ...(usernameToSet !== existing.username ? { username: usernameToSet } : {}),
    ...(typeof nextPassword === 'string' && nextPassword ? { password: bcrypt.hashSync(nextPassword, 10) } : {}),
    ...(typeof nextRole === 'string' ? { role: nextRole } : {}),
    ...(typeof nextStatus === 'string' ? { status: nextStatus } : {}),
    ...(typeof phoneToSet === 'string' ? { phone: phoneToSet } : {}),
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID
  };

  await db.collection('users').doc(actualId).update({ data: updatedUser });
  const logUser = { ...updatedUser };
  delete logUser.password;
  delete logUser.passwordHash;
  await logOperation('update_user', 'users', actualId, logUser, wxContext.OPENID);

  return { success: true, message: '用户更新成功' };
}

async function deleteUser(userData, wxContext) {
  const { id, _id, userId } = userData || {};
  const actualId = id || _id || userId;

  if (!actualId) throw new Error('用户ID不能为空');

  const doc = await db.collection('users').doc(actualId).get();
  const existing = doc && doc.data ? doc.data : null;
  if (!existing) throw new Error('用户不存在');

  const existingKey = String(existing.phone || existing.username || '');
  if (existingKey === SUPER_ADMIN_USERNAME) {
    throw new Error('超管账号不可删除');
  }

  await db.collection('users').doc(actualId).remove();
  await logOperation('delete_user', 'users', actualId, { username: existing.username || '', deletedAt: Date.now() }, wxContext.OPENID);

  return { success: true, message: '用户已删除' };
}

async function updateUserProfile(profileData, wxContext) {
  const { id, _id, userId, name, companyName, introduction } = profileData || {};
  const actualId = id || _id || userId;

  if (!actualId) throw new Error('用户ID不能为空');

  const update = {
    updatedAt: Date.now(),
    updatedBy: wxContext.OPENID
  };

  if (typeof name === 'string') update.name = name.trim();
  if (typeof companyName === 'string') update.companyName = companyName.trim();
  if (typeof introduction === 'string') update.introduction = introduction.trim();

  if (Object.prototype.hasOwnProperty.call(update, 'name') && !update.name) {
    throw new Error('名称不能为空');
  }

  await db.collection('users').doc(actualId).update({ data: update });
  await logOperation('update_user_profile', 'users', actualId, update, wxContext.OPENID);

  let fresh = null;
  try {
    const res = await db.collection('users').doc(actualId).get();
    fresh = res && res.data ? res.data : null;
  } catch (_) { }

  return {
    success: true,
    data: fresh || { _id: actualId, ...update },
    message: '个人信息已更新'
  };
}

async function changePassword(payload, wxContext) {
  const { id, _id, userId, oldPassword, newPassword, username, newUsername } = payload || {};
  const actualId = id || _id || userId;
  const nextUsernameRaw = typeof newUsername === 'string' ? newUsername : username;
  const nextUsername = typeof nextUsernameRaw === 'string' ? nextUsernameRaw.trim() : '';

  if (!actualId) throw new Error('用户ID不能为空');
  if (!oldPassword) throw new Error('原密码不能为空');
  const newPasswordStr = typeof newPassword === 'string' ? newPassword : String(newPassword || '');
  const looksStrong = newPasswordStr.length >= 10 && /[a-zA-Z]/.test(newPasswordStr) && /\d/.test(newPasswordStr);
  if (!looksStrong) throw new Error('新密码至少10位，且包含字母与数字');

  const doc = await db.collection('users').doc(actualId).get();
  const user = doc && doc.data ? doc.data : null;
  if (!user) throw new Error('用户不存在');

  const storedPassword = user.password || user.passwordHash || '';
  const passwordLooksHashed = typeof storedPassword === 'string' && storedPassword.startsWith('$2');
  const isOldPasswordValid = passwordLooksHashed
    ? bcrypt.compareSync(String(oldPassword || ''), storedPassword)
    : String(storedPassword || '') === String(oldPassword || '');
  if (!isOldPasswordValid) {
    throw new Error('原密码不正确');
  }

  let usernameToSet = user.username;
  if (nextUsername) {
    if (nextUsername.length > 50) throw new Error('登录名过长');
    if (nextUsername !== user.username) {
      const exists = await db.collection('users').where({ username: nextUsername }).limit(1).get();
      if (exists.data && exists.data.length && String(exists.data[0]._id) !== String(actualId)) {
        throw new Error('用户名已存在');
      }
      usernameToSet = nextUsername;
    }
  }

  await db.collection('users').doc(actualId).update({
    data: {
      ...(usernameToSet !== user.username ? { username: usernameToSet } : {}),
      password: bcrypt.hashSync(newPasswordStr, 10),
      updatedAt: Date.now(),
      updatedBy: wxContext.OPENID
    }
  });

  await logOperation(
    'change_password',
    'users',
    actualId,
    { changedAt: Date.now(), changedUsername: usernameToSet !== user.username },
    wxContext.OPENID
  );

  return {
    success: true,
    data: { id: actualId, username: usernameToSet },
    message: '密码修改成功'
  };
}

async function getMonthOrderCount(params = {}) {
  const now = Date.now();

  const OFFSET = 8 * 60 * 60 * 1000;
  const getCSTDate = (ts) => new Date(ts + OFFSET);
  const startOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month, 1, 0, 0, 0, 0) - OFFSET;
  };
  const endOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET - 1;
  };
  const startOfNextMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET;
  };
  const pad2 = (v) => String(v).padStart(2, '0');
  const formatYmdCST = (ts) => {
    const d = getCSTDate(ts);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(day)}`;
  };

  const start = startOfMonthCST(now);
  const end = endOfMonthCST(now);

  const timeRangeOr = _.or([
    { createdAt: _.gte(start).and(_.lte(end)) },
    { createTime: _.gte(start).and(_.lte(end)) },
    { orderTime: _.gte(start).and(_.lte(end)) },
    { _createTime: _.gte(start).and(_.lte(end)) }
  ]);

  const mainOrdersQuery = db.collection('orders').where(
    _.and([
      _.or([{ orderType: _.exists(false) }, { orderType: null }, { orderType: '' }, { orderType: _.neq('purchase') }]),
      timeRangeOr,
      _.or([{ purchaseCategory: _.exists(false) }, { purchaseCategory: null }, { purchaseCategory: '' }, { purchaseCategory: _.neq('raw_materials') }])
    ])
  );

  const goodsPurchaseQuery = db.collection('orders').where(
    _.and([
      { orderType: 'purchase' },
      timeRangeOr,
      _.or([
        { purchaseCategory: 'goods' },
        { purchaseCategory: _.exists(false) },
        { purchaseCategory: null },
        { purchaseCategory: '' }
      ])
    ])
  );

  const [mainCount, goodsPurchaseCount] = await Promise.all([mainOrdersQuery.count(), goodsPurchaseQuery.count()]);
  const orderCount = Number(mainCount && mainCount.total) || 0;
  const purchaseCount = Number(goodsPurchaseCount && goodsPurchaseCount.total) || 0;

  return {
    success: true,
    data: {
      orderCount,
      purchaseCount,
      total: orderCount + purchaseCount,
      range: { start, end }
    }
  };
}

/**
 * 获取仪表盘统计
 */
async function getDashboardStats(params = {}) {
  // 简单统计：订单总数、产品总数、客户总数
  const ordersCount = await db.collection('orders').count();
  const productsCount = await db.collection('products').count();
  const customersCount = await db.collection('customers').count();
  const purchaseOrdersCount = await db.collection('purchase_orders').count();

  return {
    success: true,
    data: {
      ordersCount: ordersCount.total,
      productsCount: productsCount.total,
      customersCount: customersCount.total,
      purchaseOrdersCount: purchaseOrdersCount.total
    }
  };
}

async function getWorkbenchOverviewStats(params = {}) {
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const ORDER_FIELDS = {
    _id: true,
    id: true,
    orderId: true,
    orderNo: true,
    orderNumber: true,
    status: true,
    orderType: true,
    source: true,
    purchaseCategory: true,
    category: true,
    createdAt: true,
    createTime: true,
    _createTime: true,
    orderTime: true,
    updatedAt: true,
    updateTime: true,
    _updateTime: true,
    quantity: true,
    totalQty: true,
    unitPrice: true,
    salePrice: true,
    sellingPrice: true,
    price: true,
    totalAmount: true,
    amount: true,
    finalAmount: true,
    totalPrice: true,
    orderAmount: true,
    items: true,
    stockedQty: true,
    shippedQty: true,
    shippingNote: true,
    shipments: true,
    hasShipped: true,
    shipped: true,
    isShipped: true,
    delivered: true,
    deliveryCompleted: true,
    shipTs: true,
    shipTime: true,
    shippedAt: true,
    shippingAt: true,
    deliveryTime: true,
    deliveredAt: true,
    signedAt: true,
    reconciledAt: true,
    statementNo: true,
    dueDate: true,
    paymentDueDate: true,
    paymentTerm: true,
    paymentTerms: true,
    term: true,
    paidAmount: true,
    paid: true,
    amountPaid: true,
    receivedAmount: true
  };

  const PAYABLE_FIELDS = {
    _id: true,
    dueDate: true,
    amountPayable: true,
    amountPaid: true,
    createdAt: true
  };

  const normalizeUserId = (v) => String(v || '').trim();
  const normalizeKey = (k) => String(k || '').trim();
  const toUserConfigDocId = (userId, key) => {
    const safeKey = normalizeKey(key).replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return `${userId}__${safeKey}`;
  };
  const unwrapUserConfig = (value) => {
    if (!value) return undefined;
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    return value;
  };
  const fetchUserConfigValue = async (userId, key) => {
    const uid = normalizeUserId(userId);
    const k = normalizeKey(key);
    if (!uid || !k) return undefined;
    const docId = toUserConfigDocId(uid, k);
    try {
      const res = await db.collection('user_configs').doc(docId).get();
      const row = res && res.data ? res.data : null;
      if (row && row.key) return row.value;
      return undefined;
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase();
      if (msg.includes('collection') && msg.includes('not exist')) return undefined;
      return undefined;
    }
  };

  const toTs = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 1000000000000) return n * 1000;
      return n;
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  };

  const OFFSET = 8 * 60 * 60 * 1000;
  const getCSTDate = (ts) => new Date(ts + OFFSET);
  const startOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month, 1, 0, 0, 0, 0) - OFFSET;
  };
  const endOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET - 1;
  };
  const startOfNextMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET;
  };
  const pad2 = (v) => String(v).padStart(2, '0');
  const formatYmdCST = (ts) => {
    const d = getCSTDate(ts);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(day)}`;
  };

  const fetchPaged = async (queryBuilder, { limit = 200, maxPages = 5, fields } = {}) => {
    const list = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const skip = (page - 1) * limit;
      let q = queryBuilder().skip(skip).limit(limit);
      if (fields && typeof fields === 'object') {
        q = q.field(fields);
      }
      const res = await q.get();
      const rows = res && Array.isArray(res.data) ? res.data : [];
      if (rows.length === 0) break;
      list.push(...rows);
      if (rows.length < limit) break;
    }
    return list;
  };

  const chunk = (arr, size) => {
    const out = [];
    const list = Array.isArray(arr) ? arr : [];
    for (let i = 0; i < list.length; i += size) {
      out.push(list.slice(i, i + size));
    }
    return out;
  };

  const getOrderTotal = (o) => {
    if (!o) return 0;
    const base = o.finalAmount ?? o.totalAmount ?? o.amount ?? o.totalPrice ?? o.orderAmount ?? 0;
    const n = Number(base || 0);
    if (Number.isFinite(n) && n > 0) return n;
    const qty = toNumber(o.quantity || 0);
    const unit = toNumber(o.unitPrice ?? o.price ?? 0);
    if (qty > 0 && unit > 0) return qty * unit;
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => {
      if (!it) return sum;
      const v = Number(it.totalPrice ?? it.amount ?? it.price ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  };

  const getBusinessOrderAmount = (o) => {
    if (!o) return 0;
    const base = o.finalAmount ?? o.totalAmount ?? o.amount ?? 0;
    const n = Number(base || 0);
    if (Number.isFinite(n) && n > 0) return n;
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => {
      if (!it) return sum;
      const v = it.totalPrice ?? it.amount ?? it.price ?? 0;
      return sum + (Number(v) || 0);
    }, 0);
  };

  const getOrderPaid = (o) => {
    if (!o) return 0;
    const paid = o.paidAmount ?? o.paid ?? o.amountPaid ?? o.receivedAmount ?? 0;
    const n = Number(paid || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const getUnpaid = (o) => {
    const total = getOrderTotal(o);
    const paid = getOrderPaid(o);
    const unpaid = total - paid;
    return Number.isFinite(unpaid) && unpaid > 0 ? unpaid : 0;
  };

  const isPurchaseRecord = (o) => {
    if (!o) return false;
    const orderTypeVal = String(o.orderType || '').toLowerCase();
    const sourceVal = String(o.source || '').toLowerCase();
    const fromCollection = String(o._sourceCollection || '').toLowerCase();
    return orderTypeVal === 'purchase' || sourceVal === 'purchased' || fromCollection === 'purchase_orders';
  };

  const getPurchaseCategory = (o) => String(o?.purchaseCategory ?? o?.category ?? '').toLowerCase();

  const isBusinessOrder = (o) => {
    if (!o) return false;
    if (!isPurchaseRecord(o)) return true;
    const cat = getPurchaseCategory(o);
    return cat === 'goods' || !cat;
  };

  const getDueTs = (o) => {
    if (!o) return 0;
    const note = o.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
    return toTs(o.dueDate || o.paymentDueDate || (note && note.dueDate) || 0);
  };

  const getOrderQty = (o) => {
    if (!o) return 0;
    const direct = toNumber(o.quantity ?? o.totalQty ?? 0);
    if (direct > 0) return direct;
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) return 0;
    const sum = items.reduce((s, it) => s + toNumber(it?.quantity ?? 0), 0);
    return sum > 0 ? sum : 0;
  };

  const getOrderUnitPrice = (o) => {
    if (!o) return 0;
    const items = Array.isArray(o.items) ? o.items : [];
    const first = items[0] || {};

    const explicit = toNumber(
      o.unitPrice ??
      o.salePrice ??
      first.unitPrice ??
      first.price ??
      first.salePrice ??
      first.sellingPrice ??
      0
    );
    if (explicit > 0) return explicit;

    const qty = getOrderQty(o);
    const amount = toNumber(o.amount ?? o.totalAmount ?? o.finalAmount ?? 0);
    if (qty > 0 && amount > 0) return amount / qty;
    return 0;
  };

  const calcProductionInventoryAmount = async () => {
    const getPurchaseCategory = (o) => String(o?.purchaseCategory ?? o?.category ?? '').toLowerCase();
    let list = [];
    try {
      list = await fetchPaged(
        () =>
          db
            .collection('orders')
            .where({ orderType: _.neq('purchase') })
            .orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 5, fields: ORDER_FIELDS }
      );
    } catch (_) {
      list = [];
    }

    if (!Array.isArray(list) || !list.length) {
      list = await fetchPaged(() => db.collection('orders').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 5, fields: ORDER_FIELDS }).catch(() => []);
    }

    const rows = Array.isArray(list) ? list : [];
    const total = rows.reduce((sum, o) => {
      if (!o) return sum;
      if (isPurchaseRecord(o)) return sum;
      const cat = getPurchaseCategory(o);
      if (cat === 'raw_materials') return sum;
      const stocked = toNumber(o.stockedQty ?? 0);
      const shipped = toNumber(o.shippedQty ?? (o.shippingNote && o.shippingNote.shippedQty) ?? 0);
      const invQty = Math.max(stocked - shipped, 0);
      if (!(invQty > 0)) return sum;
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0] || {};
      const unitPrice = toNumber(first.unitPrice ?? o.unitPrice ?? 0) || getOrderUnitPrice(o);
      if (!(unitPrice > 0)) return sum;
      return sum + invQty * unitPrice;
    }, 0);

    return Number(total.toFixed(2));
  };

  const calcPurchasedGoodsInventoryAmount = async () => {
    const getPurchaseCategory = (o) => String(o?.purchaseCategory ?? o?.category ?? '').toLowerCase();
    let list = [];
    try {
      list = await fetchPaged(
        () =>
          db
            .collection('orders')
            .where({ orderType: 'purchase' })
            .orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 5, fields: ORDER_FIELDS }
      );
    } catch (_) {
      list = [];
    }

    if (!Array.isArray(list) || !list.length) {
      list = await fetchPaged(
        () => db.collection('orders').where({ orderType: 'purchase' }).orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 5, fields: ORDER_FIELDS }
      ).catch(() => []);
    }

    const rows = Array.isArray(list) ? list : [];
    const total = rows.reduce((sum, o) => {
      if (!o) return sum;
      if (!isPurchaseRecord(o)) return sum;
      const cat = getPurchaseCategory(o);
      if (cat === 'raw_materials') return sum;
      const invQty = toNumber(o.stockedQty ?? 0);
      if (!(invQty > 0)) return sum;
      const unitPrice = toNumber(o.unitPrice ?? o.salePrice ?? 0) || getOrderUnitPrice(o);
      if (!(unitPrice > 0)) return sum;
      return sum + invQty * unitPrice;
    }, 0);

    return Number(total.toFixed(2));
  };

  const calcInventoryAmount = async () => {
    const production = await calcProductionInventoryAmount().catch(() => 0);
    return Number(toNumber(production).toFixed(2));
  };

  const now = Date.now();
  const monthStart = startOfMonthCST(now);
  const monthEnd = endOfMonthCST(now);

  const parseUserIdFromToken = (raw) => {
    const token = String(raw || '').trim();
    if (!token) return '';
    if (!token.startsWith('token_')) return '';
    const encoded = token.slice('token_'.length);
    if (!encoded) return '';
    try {
      const json = Buffer.from(encoded, 'base64').toString('utf8');
      const payload = JSON.parse(json);
      return normalizeUserId(payload && payload.userId);
    } catch (_) {
      return '';
    }
  };

  const userId =
    normalizeUserId(
      params.userId ||
      params.id ||
      params.uid ||
      params.userID ||
      (params.user && (params.user.userId || params.user.id || params.user.uid))
    ) ||
    parseUserIdFromToken(params.token) ||
    parseUserIdFromToken(params.authToken) ||
    parseUserIdFromToken(params.authorization) ||
    parseUserIdFromToken(params.Authorization);

  const [rawReceivablePaymentMap, rawReceivableOverrideMap] = await Promise.all([
    fetchUserConfigValue(userId, 'erp_receivablePaymentMap'),
    fetchUserConfigValue(userId, 'erp_receivableStatementOverrideMap')
  ]);
  const receivablePaymentMap = (() => {
    const v = unwrapUserConfig(rawReceivablePaymentMap);
    return v && typeof v === 'object' ? v : {};
  })();
  const receivableStatementOverrideMap = (() => {
    const v = unwrapUserConfig(rawReceivableOverrideMap);
    return v && typeof v === 'object' ? v : {};
  })();

  const fetchOrders = async () => {
    const normalizeOrderTs = (o) => toTs(o?.createdAt || o?.createTime || o?._createTime || o?.orderTime || 0);

    const mergeUnique = (lists) => {
      const map = new Map();
      (Array.isArray(lists) ? lists : []).forEach((list) => {
        (Array.isArray(list) ? list : []).forEach((o) => {
          if (!o) return;
          const key = String(o._id || o.id || o.orderId || o.orderNo || o.orderNumber || '').trim();
          if (!key) return;
          if (!map.has(key)) map.set(key, o);
        });
      });
      return Array.from(map.values());
    };

    const withSource = (list, collectionName) =>
      (Array.isArray(list) ? list : []).map((o) => (o ? { ...o, _sourceCollection: collectionName } : o));

    const fetchInMonth = async (collectionName) => {
      const byCreatedAt = await fetchPaged(
        () =>
          db
            .collection(collectionName)
            .where({ createdAt: _.gte(monthStart).and(_.lte(monthEnd)) })
            .orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 5, fields: ORDER_FIELDS }
      )
        .then((rows) => withSource(rows, collectionName))
        .catch(() => []);

      if (byCreatedAt.length) return byCreatedAt;

      const byCreateTime = await fetchPaged(
        () =>
          db
            .collection(collectionName)
            .where(
              _.or([
                { _createTime: _.gte(monthStart).and(_.lte(monthEnd)) },
                { _createTime: _.gte(new Date(monthStart)).and(_.lte(new Date(monthEnd))) }
              ])
            )
            .orderBy('_createTime', 'desc'),
        { limit: 200, maxPages: 5, fields: ORDER_FIELDS }
      )
        .then((rows) => withSource(rows, collectionName))
        .catch(() => []);

      if (byCreateTime.length) return byCreateTime;

      const recent = await fetchPaged(() => db.collection(collectionName).orderBy('createdAt', 'desc'), { limit: 200, maxPages: 3, fields: ORDER_FIELDS })
        .then((rows) => withSource(rows, collectionName))
        .catch(() => []);
      return recent;
    };

    const [ordersRows, purchaseRows] = await Promise.all([fetchInMonth('orders'), fetchInMonth('purchase_orders')]);
    const merged = mergeUnique([ordersRows, purchaseRows]);
    return merged.filter((o) => {
      const ts = normalizeOrderTs(o);
      return ts >= monthStart && ts <= monthEnd;
    });
  };

  const ordersInMonth = await fetchOrders();
  const dueMetricOrders = await (async () => {
    const opts = { limit: 200, maxPages: 5, fields: ORDER_FIELDS };
    const attempt = (builder) => fetchPaged(builder, opts).catch(() => []);

    let rows = await attempt(() => db.collection('orders').orderBy('updatedAt', 'desc'));
    if (rows.length) return rows;
    rows = await attempt(() => db.collection('orders').orderBy('_updateTime', 'desc'));
    if (rows.length) return rows;
    rows = await attempt(() => db.collection('orders').orderBy('createdAt', 'desc'));
    if (rows.length) return rows;
    rows = await attempt(() => db.collection('orders').orderBy('_createTime', 'desc'));
    return rows;
  })();

  const computePurchaseGoodsAmount = (o) => {
    if (!o) return 0;
    const items = Array.isArray(o.items) ? o.items : [];
    const first = items[0] || {};
    const qty = Number(
      o.quantity ??
      o.totalQty ??
      (items.reduce((s, it) => s + (Number(it?.quantity) || 0), 0)) ??
      0
    );
    const sellUnit = toNumber(
      o.unitPrice ??
      o.sellingPrice ??
      o.sellPrice ??
      o.price ??
      first.sellingPrice ??
      first.salePrice ??
      0
    );
    if (qty > 0 && sellUnit > 0) return qty * sellUnit;

    const fallbackAmount = toNumber(o.totalAmount ?? o.finalAmount ?? o.amount ?? o.purchaseAmount ?? 0);
    if (fallbackAmount > 0) return fallbackAmount;

    return 0;
  };

  const computeOrderManagementAmount = (o) => {
    if (!o) return 0;
    const base = toNumber(o.totalAmount ?? o.amount ?? o.totalPrice ?? o.orderAmount ?? 0);
    if (base > 0) return base;
    const qty = getOrderQty(o);
    const unit = toNumber(o.unitPrice ?? o.price ?? 0) || getOrderUnitPrice(o);
    if (qty > 0 && unit > 0) return qty * unit;
    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => {
      if (!it) return sum;
      const v = toNumber(it.totalPrice ?? it.amount ?? it.price ?? 0);
      return sum + v;
    }, 0);
  };

  const monthOrdersAmount = (Array.isArray(ordersInMonth) ? ordersInMonth : []).reduce((sum, o) => {
    if (!o) return sum;
    if (isPurchaseRecord(o)) return sum;
    const status = String(o.status || '').toLowerCase();
    if (status === 'cancelled') return sum;
    return sum + computeOrderManagementAmount(o);
  }, 0);

  const monthPurchaseGoodsAmount = (Array.isArray(ordersInMonth) ? ordersInMonth : []).reduce((sum, o) => {
    if (!o) return sum;
    if (!isPurchaseRecord(o)) return sum;
    const cat = getPurchaseCategory(o);
    if (cat === 'raw_materials') return sum;
    const status = String(o.status || '').toLowerCase();
    if (status === 'cancelled') return sum;
    return sum + computePurchaseGoodsAmount(o);
  }, 0);

  const monthSales = monthOrdersAmount + monthPurchaseGoodsAmount;

  // 计算本月原材料总成本
  const monthRawMaterialCost = (Array.isArray(ordersInMonth) ? ordersInMonth : []).reduce((sum, o) => {
    if (!o) return sum;
    if (!isPurchaseRecord(o)) return sum;
    const cat = getPurchaseCategory(o);
    if (cat !== 'raw_materials') return sum; // 只计算原材料采购
    const status = String(o.status || '').toLowerCase();
    if (status === 'cancelled') return sum;
    return sum + computePurchaseGoodsAmount(o);
  }, 0);

  // 计算本月生产毛利
  const monthGrossProfit = monthSales - monthRawMaterialCost;

  // 计算毛利率
  const monthGrossProfitRate = monthSales > 0 ? (monthGrossProfit / monthSales * 100) : 0;

  const monthShippedAmount = (() => {
    const list = Array.isArray(dueMetricOrders) ? dueMetricOrders : [];
    const seen = new Set();

    const normalizeStatus = (s) => String(s || '').trim().toLowerCase();

    const isOrderCancelled = (o) => {
      const raw = String(o?.status || '').trim();
      const st = normalizeStatus(raw);
      return st === 'cancelled' || raw === '已取消' || raw === '取消' || raw === '作废';
    };

    const isOrderShipped = (o) => {
      if (!o) return false;
      if (isOrderCancelled(o)) return false;

      const raw = String(o.status || '').trim();
      const st = normalizeStatus(raw);
      const statusShipped =
        st === 'shipped' ||
        st === 'shipping' ||
        st === 'delivered' ||
        raw === '已发货' ||
        raw === '发货' ||
        raw === '已送达';

      const explicitFlag = !!(o.hasShipped || o.shipped || o.isShipped || o.delivered || o.deliveryCompleted);

      const note = o.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
      const hasShippingNote = !!(note && Object.keys(note).length);

      const shippedQty = toNumber(o.shippedQty ?? (note && note.shippedQty) ?? 0);
      const hasShipmentList = Array.isArray(o.shipments) ? o.shipments.length > 0 : false;

      return explicitFlag || statusShipped || shippedQty > 0 || hasShippingNote || hasShipmentList;
    };

    const getOrderShipTs = (o) => {
      if (!o) return 0;
      const note = o.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
      const candidates = [
        o.shipTs,
        o.shipTime,
        o.shippedAt,
        o.shippingAt,
        o.deliveryTime,
        o.deliveredAt,
        note && (note.shipTs || note.shipTime || note.shippedAt || note.shippingAt || note.deliveryTime || note.deliveredAt),
        o.signedAt,
        o.reconciledAt,
        o.updatedAt,
        o.updateTime,
        o._updateTime,
        o.createTime,
        o.createdAt,
        o._createTime
      ];

      for (let i = 0; i < candidates.length; i += 1) {
        const ts = toTs(candidates[i]);
        if (ts) return ts;
      }
      return 0;
    };

    let sum = 0;
    list.forEach((o) => {
      if (!o) return;
      if (isPurchaseRecord(o)) return;
      if (!isOrderShipped(o)) return;

      const key = String(o._id || o.id || o.orderId || o.orderNo || '').trim();
      if (key) {
        if (seen.has(key)) return;
        seen.add(key);
      }

      const shipTs = getOrderShipTs(o);
      if (!(shipTs >= monthStart && shipTs <= monthEnd)) return;

      sum += getOrderTotal(o);
    });

    return sum;
  })();

  const monthReceivable = (() => {
    const list = Array.isArray(dueMetricOrders) ? dueMetricOrders : [];
    const statementMap = new Map();

    list.forEach((o) => {
      if (!o) return;
      if (isPurchaseRecord(o)) return;

      const note = o.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
      const statementNo = String(o.statementNo || (note && note.statementNo) || '').trim();
      if (!statementNo) return;

      const reconciledRaw = (note && note.reconciledAt) || o.reconciledAt || null;
      const reconciledTs = toTs(reconciledRaw);
      if (!reconciledTs) return;

      const total = getOrderTotal(o);
      let dueTs = getDueTs(o);
      if (!dueTs) {
        const paymentTermStr = String(o.paymentTerm || o.paymentTerms || o.term || '');
        if (paymentTermStr.includes('月结')) {
          const match = paymentTermStr.match(/(\d+)天/);
          const daysToAdd = match ? parseInt(match[1], 10) : 0;
          dueTs = startOfNextMonthCST(reconciledTs) + daysToAdd * 24 * 60 * 60 * 1000;
        } else if (paymentTermStr.includes('现结') || paymentTermStr.includes('现付')) {
          dueTs = reconciledTs;
        } else {
          dueTs = reconciledTs;
        }
      }

      if (!dueTs) return;

      const override = receivableStatementOverrideMap && receivableStatementOverrideMap[statementNo];
      if (override && typeof override === 'object' && override.dueDate) {
        const overrideTs = toTs(String(override.dueDate || '').trim());
        if (overrideTs) dueTs = overrideTs;
      }

      const prev = statementMap.get(statementNo) || { dueTs, total: 0, received: 0, hasLocalPayment: false };
      prev.total += total;
      if (!prev.dueTs && dueTs) prev.dueTs = dueTs;
      const localPayment = receivablePaymentMap && receivablePaymentMap[statementNo];
      if (localPayment && typeof localPayment === 'object') {
        prev.hasLocalPayment = true;
        prev.received = toNumber(localPayment.received || 0);
      } else if (!prev.hasLocalPayment) {
        const paid = getOrderPaid(o);
        prev.received += paid;
      }
      statementMap.set(statementNo, prev);
    });

    let sum = 0;
    Array.from(statementMap.values()).forEach((s) => {
      const dueTs = toTs(s?.dueTs || 0);
      if (!(dueTs >= monthStart && dueTs <= monthEnd)) return;
      const total = toNumber(s?.total || 0);
      const received = toNumber(s?.received || 0);
      const usedReceived = Math.min(Math.max(received, 0), total);
      const remaining = total - usedReceived;
      if (!(remaining > 0)) return;
      sum += remaining;
    });

    return sum;
  })();

  const payableFromPayables = (() => {
    const monthStartStr = formatYmdCST(monthStart);
    const monthEndStr = formatYmdCST(monthEnd);

    return fetchPaged(
      () =>
        db
          .collection('payables')
          .where({
            dueDate: _.gte(monthStartStr).and(_.lte(monthEndStr))
          })
          .orderBy('dueDate', 'asc'),
      { limit: 200, maxPages: 5, fields: PAYABLE_FIELDS }
    )
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        const sumUnpaid = rows.reduce((sum, it) => {
          if (!it) return sum;
          const amountPayable = toNumber(it.amountPayable || 0);
          const amountPaid = toNumber(it.amountPaid || 0);
          const unpaid = Math.max(amountPayable - amountPaid, 0);
          return sum + unpaid;
        }, 0);
        return { sumUnpaid, hasAny: rows.length > 0 };
      })
      .catch(async () => {
        try {
          const list = await fetchPaged(() => db.collection('payables').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 5, fields: PAYABLE_FIELDS });
          const rows = Array.isArray(list) ? list : [];
          const sumUnpaid = rows.reduce((sum, it) => {
            if (!it) return sum;
            const dueTs = toTs(it.dueDate || null);
            if (!(dueTs && dueTs >= monthStart && dueTs <= monthEnd)) return sum;
            const amountPayable = toNumber(it.amountPayable || 0);
            const amountPaid = toNumber(it.amountPaid || 0);
            const unpaid = Math.max(amountPayable - amountPaid, 0);
            return sum + unpaid;
          }, 0);
          return {
            sumUnpaid, hasAny: rows.some((it) => {
              const dueTs = toTs(it?.dueDate || null);
              return !!(dueTs && dueTs >= monthStart && dueTs <= monthEnd);
            })
          };
        } catch (_) {
          return { sumUnpaid: 0, hasAny: false };
        }
      });
  })();

  const fallbackPayableFromPurchaseOrders = ordersInMonth.reduce((sum, o) => {
    if (!o) return sum;
    if (!isPurchaseRecord(o)) return sum;
    const dueTs = getDueTs(o);
    if (!(dueTs && dueTs >= monthStart && dueTs <= monthEnd)) return sum;
    return sum + getUnpaid(o);
  }, 0);

  const payableComputed = await payableFromPayables;
  const monthPayable = payableComputed && payableComputed.hasAny ? payableComputed.sumUnpaid : fallbackPayableFromPurchaseOrders;
  const inventoryAmount = await calcInventoryAmount();

  return {
    success: true,
    data: {
      monthSales: Number(monthSales.toFixed(2)),
      monthRawMaterialCost: Number(monthRawMaterialCost.toFixed(2)),
      monthGrossProfit: Number(monthGrossProfit.toFixed(2)),
      monthGrossProfitRate: Number(monthGrossProfitRate.toFixed(2)),
      inventoryAmount,
      monthShippedAmount: Number(monthShippedAmount.toFixed(2)),
      monthReceivable: Number(monthReceivable.toFixed(2)),
      monthPayable: Number(monthPayable.toFixed(2)),
      range: { monthStart, monthEnd }
    }
  };
}

async function getDataManagementStats(params = {}) {
  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const normalizeUserId = (v) => String(v || '').trim();
  const normalizeKey = (k) => String(k || '').trim();
  const toUserConfigDocId = (userId, key) => {
    const safeKey = normalizeKey(key).replace(/[^a-zA-Z0-9_\-:.]/g, '_');
    return `${userId}__${safeKey}`;
  };
  const unwrapUserConfig = (value) => {
    if (!value) return undefined;
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    return value;
  };
  const fetchUserConfigValue = async (userId, key) => {
    const uid = normalizeUserId(userId);
    const k = normalizeKey(key);
    if (!uid || !k) return undefined;
    const docId = toUserConfigDocId(uid, k);
    try {
      const res = await db.collection('user_configs').doc(docId).get();
      const row = res && res.data ? res.data : null;
      if (row && row.key) return row.value;
      return undefined;
    } catch (e) {
      const msg = String(e && (e.errMsg || e.message || e)).toLowerCase();
      if (msg.includes('collection') && msg.includes('not exist')) return undefined;
      return undefined;
    }
  };
  const toTs = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 1000000000000) return n * 1000;
      return n;
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  };

  // CST (China Standard Time) UTC+8 helpers
  const OFFSET = 8 * 60 * 60 * 1000;

  const getCSTDate = (ts) => new Date(ts + OFFSET);

  const startOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month, 1, 0, 0, 0, 0) - OFFSET;
  };

  const endOfMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    // Start of next month - 1ms
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET - 1;
  };

  const parseUserIdFromToken = (raw) => {
    const token = String(raw || '').trim();
    if (!token) return '';
    if (!token.startsWith('token_')) return '';
    const encoded = token.slice('token_'.length);
    if (!encoded) return '';
    try {
      const json = Buffer.from(encoded, 'base64').toString('utf8');
      const payload = JSON.parse(json);
      return normalizeUserId(payload && payload.userId);
    } catch (_) {
      return '';
    }
  };

  const userId =
    normalizeUserId(
      params.userId ||
      params.id ||
      params.uid ||
      params.userID ||
      (params.user && (params.user.userId || params.user.id || params.user.uid))
    ) ||
    parseUserIdFromToken(params.token) ||
    parseUserIdFromToken(params.authToken) ||
    parseUserIdFromToken(params.authorization) ||
    parseUserIdFromToken(params.Authorization);

  const [rawReceivablePaymentMap, rawReceivableOverrideMap] = await Promise.all([
    fetchUserConfigValue(userId, 'erp_receivablePaymentMap'),
    fetchUserConfigValue(userId, 'erp_receivableStatementOverrideMap')
  ]);
  const receivablePaymentMap = (() => {
    const v = unwrapUserConfig(rawReceivablePaymentMap);
    return v && typeof v === 'object' ? v : {};
  })();
  const receivableStatementOverrideMap = (() => {
    const v = unwrapUserConfig(rawReceivableOverrideMap);
    return v && typeof v === 'object' ? v : {};
  })();

  const startOfYearCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    return Date.UTC(year, 0, 1, 0, 0, 0, 0) - OFFSET;
  };

  const endOfYearCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    return Date.UTC(year + 1, 0, 1, 0, 0, 0, 0) - OFFSET - 1;
  };

  const startOfDayCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    return Date.UTC(year, month, day, 0, 0, 0, 0) - OFFSET;
  };

  const endOfDayCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    return Date.UTC(year, month, day + 1, 0, 0, 0, 0) - OFFSET - 1;
  };

  const startOfNextMonthCST = (ts) => {
    const d = getCSTDate(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return Date.UTC(year, month + 1, 1, 0, 0, 0, 0) - OFFSET;
  };

  const pad2 = (v) => String(v).padStart(2, '0');
  const formatYmdCST = (ts) => {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return '';
    const d = getCSTDate(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return `${y}-${pad2(m)}-${pad2(day)}`;
  };

  const getBusinessOrderAmount = (order) => {
    if (!order) return 0;
    const base = order.finalAmount ?? order.totalAmount ?? order.amount ?? 0;
    const n = Number(base || 0);
    if (Number.isFinite(n) && n > 0) return n;
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => {
      if (!it) return sum;
      const v = it.totalPrice ?? it.amount ?? it.price ?? 0;
      return sum + (Number(v) || 0);
    }, 0);
  };

  const getOrderAmount = (order) => {
    if (!order) return 0;
    const base = order.totalAmount ?? order.amount ?? order.totalPrice ?? order.orderAmount ?? 0;
    const n = Number(base || 0);
    if (Number.isFinite(n) && n > 0) return n;
    const qty = Number(order.quantity || 0);
    const unit = Number(order.unitPrice || order.price || 0);
    if (Number.isFinite(qty) && Number.isFinite(unit) && qty > 0 && unit > 0) {
      return qty * unit;
    }
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return 0;
    return items.reduce((sum, it) => {
      if (!it) return sum;
      const v = Number(it.totalPrice ?? it.amount ?? it.price ?? 0);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  };
  const getOrderQuantity = (order) => {
    if (!order) return 0;
    const q =
      order.quantity ??
      order.totalQty ??
      (Array.isArray(order.items)
        ? order.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
        : 0);
    return toNumber(q);
  };
  const computeAreaSquareMeter = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const first = items[0] || {};
    const width = toNumber(order?.boardWidth ?? first.boardWidth ?? 0);
    const height = toNumber(order?.boardHeight ?? first.boardHeight ?? 0);
    const effectiveWidth = width > 0 ? width + 30 : 0;
    if (!(effectiveWidth > 0 && height > 0)) return 0;
    return (effectiveWidth * height) / 1000000;
  };
  const computeRowSalary = (row) => {
    if (!row) return 0;
    const rowDailySalary = toNumber(row.dailySalary);
    const rowHourlySalary = toNumber(row.hourlySalary);
    const rowAttendanceDays = toNumber(row.attendanceDays);
    const rowSubsidyPerDay = toNumber(row.subsidyPerDay);
    const rowOvertimeHours = toNumber(row.overtimeHours);
    const rowBonus = toNumber(row.bonus);
    const hasNormal = row.attendanceDays !== undefined && row.dailySalary !== undefined;
    const hasOvertime = row.overtimeHours !== undefined && row.hourlySalary !== undefined;
    const hasSubsidy = row.attendanceDays !== undefined && row.subsidyPerDay !== undefined;
    const normalSalary = hasNormal ? rowAttendanceDays * rowDailySalary : undefined;
    const overtimeSalary = hasOvertime ? rowOvertimeHours * rowHourlySalary : undefined;
    const subsidyTotal = hasSubsidy ? rowAttendanceDays * rowSubsidyPerDay : undefined;
    const parts = [normalSalary, overtimeSalary, subsidyTotal, rowBonus].filter(
      (v) => v !== undefined && !Number.isNaN(Number(v))
    );
    const totalRow = parts.length > 0 ? parts.reduce((sum, v) => sum + Number(v), 0) : undefined;
    if (!Number.isFinite(totalRow) || totalRow <= 0) return 0;
    return totalRow;
  };

  const fetchPaged = async (queryBuilder, { limit = 200, maxPages = 50 } = {}) => {
    const list = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const skip = (page - 1) * limit;
      const q = queryBuilder().skip(skip).limit(limit);
      const res = await q.get();
      const data = Array.isArray(res?.data) ? res.data : [];
      list.push(...data);
      if (data.length < limit) break;
    }
    return list;
  };

  const now = Date.now();
  const salesTrendRangeRaw = String(params?.salesTrendRange ?? params?.trendRange ?? 'month').toLowerCase();
  const salesTrendRange = ['month', '3m', '6m', 'year'].includes(salesTrendRangeRaw)
    ? salesTrendRangeRaw
    : 'month';
  const normalizeTrendKey = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const m1 = raw.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m1) return `${pad2(m1[1])}-${pad2(m1[2])}`;
    const m2 = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m2) return `${pad2(m2[2])}-${pad2(m2[3])}`;
    const m3 = raw.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (m3) return `${pad2(m3[1])}-${pad2(m3[2])}`;
    const cleaned = raw.replace(/[^\d]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const parts = cleaned.split('-').filter(Boolean);
    if (parts.length >= 2) {
      const mm = parts.length === 3 ? parts[1] : parts[0];
      const dd = parts.length === 3 ? parts[2] : parts[1];
      if (mm && dd) return `${pad2(mm)}-${pad2(dd)}`;
    }
    return '';
  };
  const debugTrendKey = normalizeTrendKey(params?.debugTrendKey ?? params?.debugDay ?? '');
  const debugCompareLegacy = !!(params?.debugCompareLegacy ?? params?.debugLegacy ?? false);

  const currentMonthStart = startOfMonthCST(now);
  const currentMonthEnd = endOfMonthCST(now);
  const todayStart = startOfDayCST(now);
  const todayEnd = endOfDayCST(now);
  // Last month relative to CST now
  const lastMonthDate = new Date(getCSTDate(now));
  lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
  const lastMonthStart = startOfMonthCST(lastMonthDate.getTime() - OFFSET);
  const lastMonthEnd = endOfMonthCST(lastMonthDate.getTime() - OFFSET);

  const yearStart = startOfYearCST(now);
  const yearEnd = endOfYearCST(now);

  const nowCst = getCSTDate(now);
  const nowCstYear = nowCst.getUTCFullYear();
  const nowCstMonth = nowCst.getUTCMonth();
  const normalizeMonthKey = (v) => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    if (raw === 'current' || raw === 'this' || raw === '本月') {
      return `${nowCstYear}-${pad2(nowCstMonth + 1)}`;
    }
    const m1 = raw.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m1) return `${m1[1]}-${pad2(m1[2])}`;
    const m2 = raw.match(/^(\d{1,2})月$/);
    if (m2) return `${nowCstYear}-${pad2(m2[1])}`;
    return '';
  };
  const debugMonthKey = normalizeMonthKey(params?.debugMonthKey ?? params?.debugMonth ?? '');
  const trendRangeStart =
    salesTrendRange === 'year'
      ? yearStart
      : salesTrendRange === '6m'
        ? Date.UTC(nowCstYear, nowCstMonth - 5, 1, 0, 0, 0, 0) - OFFSET
        : salesTrendRange === '3m'
          ? Date.UTC(nowCstYear, nowCstMonth - 2, 1, 0, 0, 0, 0) - OFFSET
          : currentMonthStart;

  const rangeStart = Math.min(yearStart, lastMonthStart, trendRangeStart);
  const rangeStartMs = rangeStart; // Already ts
  const yearEndMs = yearEnd;

  const normalizeDocTs = (o) => toTs(o?.createdAt || o?.createTime || o?._createTime || o?.orderTime || 0);
  const inFetchRange = (o) => {
    const ts = normalizeDocTs(o);
    if (!ts) return false;
    return ts >= rangeStartMs && ts <= yearEndMs;
  };
  const filterInFetchRange = (list) => (Array.isArray(list) ? list : []).filter(inFetchRange);
  const getCollectionPriority = (collectionName) => {
    const n = String(collectionName || '').toLowerCase();
    if (n === 'orders') return 1;
    if (n === 'erp_orders') return 2;
    if (n === 'order_list') return 3;
    if (n === 'orders_tmp') return 4;
    if (n === 'purchase_orders') return 5;
    return 9;
  };
  const buildCanonicalOrderKey = (o) => {
    if (!o) return '';
    const orderNo = String(o.orderNo || o.orderNumber || o.order_number || '').trim();
    if (orderNo) return `no:${orderNo}`;
    const id = o._id || o.id;
    if (id) return `id:${String(id)}`;
    const ts = toTs(o?.createdAt || o?.createTime || o?._createTime || o?.orderTime || 0);
    const qty = getOrderQuantity(o);
    const amount = getOrderAmount(o);
    const name = String(o.goodsName || o.productTitle || o.productName || '').trim();
    const supplierOrCustomer = String(o.supplierName || o.customerName || '').trim();
    return `anon:${ts}:${qty}:${amount}:${supplierOrCustomer}:${name}`;
  };
  const mergeManyOrdersByCanonicalKey = (lists) => {
    const map = new Map();
    (Array.isArray(lists) ? lists : []).forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((o) => {
        if (!o) return;
        const key = buildCanonicalOrderKey(o) || JSON.stringify(o);
        const prev = map.get(key);
        if (!prev) {
          map.set(key, o);
          return;
        }
        const prevP = getCollectionPriority(prev._sourceCollection);
        const curP = getCollectionPriority(o._sourceCollection);
        if (curP < prevP) {
          map.set(key, o);
        }
      });
    });
    return Array.from(map.values());
  };

  const ordersCollections = ['orders', 'purchase_orders'];
  const legacyOrdersCollections = ['orders_tmp', 'erp_orders', 'order_list'];
  const fetchOrdersFromCollection = async (collectionName) => {
    const safeFetch = async (builder, opts) => {
      try {
        return await fetchPaged(builder, opts);
      } catch (_) {
        return [];
      }
    };

    let list = await safeFetch(
      () =>
        db
          .collection(collectionName)
          .where(
            _.or([
              { _createTime: _.gte(rangeStartMs).and(_.lte(yearEndMs)) },
              { _createTime: _.gte(new Date(rangeStartMs)).and(_.lte(new Date(yearEndMs))) }
            ])
          )
          .orderBy('_createTime', 'desc'),
      { limit: 200, maxPages: 50 }
    );

    if (!Array.isArray(list) || list.length === 0) {
      list = await safeFetch(
        () =>
          db
            .collection(collectionName)
            .where({ createdAt: _.gte(rangeStartMs).and(_.lte(yearEndMs)) })
            .orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 50 }
      );
    }

    if (!Array.isArray(list) || list.length === 0) {
      list = await safeFetch(
        () => db.collection(collectionName).orderBy('_createTime', 'desc'),
        { limit: 200, maxPages: 5 }
      );
      list = filterInFetchRange(list);
    }

    if (!Array.isArray(list) || list.length === 0) {
      list = await safeFetch(
        () => db.collection(collectionName).orderBy('createdAt', 'desc'),
        { limit: 200, maxPages: 5 }
      );
      list = filterInFetchRange(list);
    }

    return (Array.isArray(list) ? list : []).filter((o) => {
      if (!o) return false;
      o._sourceCollection = collectionName;
      return inFetchRange(o);
    });
  };

  const [ordersByCollection, legacyOrdersByCollection, customers, employees, fixedCostItems, payables] = await Promise.all([
    Promise.all(ordersCollections.map((name) => fetchOrdersFromCollection(name))),
    debugCompareLegacy
      ? Promise.all(legacyOrdersCollections.map((name) => fetchOrdersFromCollection(name)))
      : Promise.resolve([]),
    fetchPaged(() => db.collection('customers').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 5 }).catch(() => []),
    fetchPaged(() => db.collection('employees').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 5 }).catch(() => []),
    fetchPaged(() => db.collection('fixed_costs').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 10 }).catch(() => []),
    fetchPaged(() => db.collection('payables').orderBy('createdAt', 'desc'), { limit: 200, maxPages: 10 }).catch(() => [])
  ]);

  const allOrdersInRangeRaw = ordersByCollection.flatMap((x) => (Array.isArray(x) ? x : []));
  const allOrdersInRange = mergeManyOrdersByCanonicalKey(ordersByCollection);
  const legacyAllOrdersInRange = debugCompareLegacy
    ? mergeManyOrdersByCanonicalKey(Array.isArray(legacyOrdersByCollection) ? legacyOrdersByCollection : [])
    : [];
  const legacyOnlyOrdersInRange = (() => {
    if (!debugCompareLegacy) return [];
    const primaryKeys = new Set(
      (Array.isArray(allOrdersInRange) ? allOrdersInRange : [])
        .map((o) => buildCanonicalOrderKey(o))
        .filter(Boolean)
    );
    return (Array.isArray(legacyAllOrdersInRange) ? legacyAllOrdersInRange : []).filter((o) => {
      const k = buildCanonicalOrderKey(o);
      if (!k) return false;
      return !primaryKeys.has(k);
    });
  })();

  const isPurchaseRecord = (o) => {
    if (!o) return false;
    const sourceVal = String(o.source || '').toLowerCase();
    const orderTypeVal = String(o.orderType || '').toLowerCase();
    const fromCollection = String(o._sourceCollection || '').toLowerCase();
    return sourceVal === 'purchased' || orderTypeVal === 'purchase' || fromCollection === 'purchase_orders';
  };
  const getPurchaseCategory = (o) => String(o?.purchaseCategory ?? o?.category ?? '').toLowerCase();

  const salesOrders = allOrdersInRange.filter((o) => !isPurchaseRecord(o));
  const purchaseGoodsOrdersFromOrders = allOrdersInRange.filter((o) => {
    if (!isPurchaseRecord(o)) return false;
    const cat = getPurchaseCategory(o);
    return cat !== 'raw_materials';
  });
  const rawMatPurchaseOrdersFromOrders = allOrdersInRange.filter((o) => {
    if (!isPurchaseRecord(o)) return false;
    const cat = getPurchaseCategory(o);
    return cat === 'raw_materials';
  });

  const purchaseGoodsOrders = Array.isArray(purchaseGoodsOrdersFromOrders) ? purchaseGoodsOrdersFromOrders : [];
  const rawMatPurchaseOrders = Array.isArray(rawMatPurchaseOrdersFromOrders) ? rawMatPurchaseOrdersFromOrders : [];

  const customerMap = (() => {
    const map = new Map();
    (Array.isArray(customers) ? customers : []).forEach((c) => {
      if (!c) return;
      const id = c._id || c.id;
      if (id) map.set(String(id), c);
      if (c.name) map.set(String(c.name), c);
      if (c.companyName) map.set(String(c.companyName), c);
    });
    return map;
  })();

  const materialPriceMap = (() => {
    const map = new Map();
    (Array.isArray(purchaseGoodsOrders) ? purchaseGoodsOrders : []).forEach((o) => {
      if (!o) return;
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0] || {};
      const materialNo = String(o.materialNo ?? first.materialNo ?? '').trim();
      if (!materialNo) return;
      const qty = getOrderQuantity(o);
      const unit = toNumber(o.salePrice ?? o.purchasePrice ?? o.costPrice ?? first.unitPrice ?? 0);
      if (!(qty > 0 && unit > 0)) return;
      const prev = map.get(materialNo) || { qty: 0, amount: 0 };
      map.set(materialNo, { qty: prev.qty + qty, amount: prev.amount + qty * unit });
    });
    const obj = {};
    map.forEach((v, k) => {
      obj[k] = v;
    });
    return obj;
  })();

  // Build board purchase order map (for orders after 2026-01-11)
  // Effective date: 2026-01-11 00:00:00 CST
  const boardCostEffectiveFromTs = Date.UTC(2026, 0, 11, 0, 0, 0, 0) - OFFSET;
  const boardPurchaseOrderMap = (() => {
    const map = new Map();
    // Collect all unique purchaseOrderId from sales orders
    const boardPurchaseIds = new Set();
    (Array.isArray(salesOrders) ? salesOrders : []).forEach((o) => {
      if (!o) return;
      const purchaseOrderId = String(o.purchaseOrderId || '').trim();
      if (purchaseOrderId) boardPurchaseIds.add(purchaseOrderId);
    });

    // Find board purchase orders from all purchase orders
    (Array.isArray(allOrdersInRange) ? allOrdersInRange : []).forEach((o) => {
      if (!o) return;
      const orderId = String(o._id || o.id || '').trim();
      if (!orderId || !boardPurchaseIds.has(orderId)) return;

      // Check if this is a board purchase order
      const category = String(o.purchaseCategory || o.category || '').toLowerCase();
      if (category !== 'boards') return;

      // Get the purchase amount
      const rawAmt = toNumber(o.amount ?? o.totalAmount ?? o.finalAmount ?? 0);
      const items = Array.isArray(o.items) ? o.items : [];
      const itemsTotal = items.reduce((s, it) => s + toNumber(it?.amount || 0), 0);
      const usedAmt = rawAmt > 0 ? rawAmt : (itemsTotal > 0 ? itemsTotal : 0);

      if (usedAmt > 0) {
        map.set(orderId, usedAmt);
      }
    });

    return map;
  })();

  const mergedOrders = (() => {
    const list = Array.isArray(salesOrders) ? [...salesOrders] : [];
    (Array.isArray(purchaseGoodsOrders) ? purchaseGoodsOrders : []).forEach((o, idx) => {
      if (!o) return;
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0] || {};
      const quantity = getOrderQuantity(o);
      const sellingUnitPrice = toNumber(
        o.unitPrice ??
        o.sellingPrice ??
        o.sellPrice ??
        o.price ??
        first.sellingPrice ??
        first.salePrice ??
        0
      );
      const sellingAmount = quantity > 0 && sellingUnitPrice > 0 ? Number(quantity * sellingUnitPrice) : 0;

      const fallbackAmount = toNumber(o.totalAmount ?? o.finalAmount ?? o.amount ?? o.purchaseAmount ?? 0);
      const orderAmount = sellingAmount > 0 ? sellingAmount : fallbackAmount > 0 ? fallbackAmount : 0;
      list.push({
        ...o,
        _businessMergedFrom: 'purchase',
        key: o._id ?? o.id ?? `business_purchase_${idx}`,
        quantity,
        totalAmount: orderAmount,
        createdAt: o.createdAt || o.createTime || o.orderTime || o._createTime || null,
        orderTime: o.orderTime || o.createdAt || o.createTime || null,
        materialNo: o.materialNo ?? first.materialNo ?? '',
        purchaseCategory: o.purchaseCategory ?? o.category ?? 'goods',
        orderType: o.orderType || 'purchase'
      });
    });
    return list;
  })();

  let currentSales = 0;
  let lastSales = 0;
  let yearSalesVal = 0;
  let yearGrossProfitVal = 0;  // 添加年度毛利变量
  let currentGrossProfit = 0;
  let monthProductionGrossProfit = 0;
  let monthRawMaterialPurchaseCost = 0;
  let todaySales = 0;
  let monthSalesProduction = 0;
  let monthSalesGoodsPurchase = 0;
  let monthCountProduction = 0;
  let monthCountGoodsPurchase = 0;
  const trendKeyOrders = [];
  const monthKeyOrders = [];

  let lastMonthProductionCost = 0;
  let lastMonthPurchaseCost = 0;
  let lastMonthScrapCost = 0;
  let lastMonthRawMaterialPurchaseCost = 0;

  const trendByDay = new Map();
  const initMonthDailyBuckets = () => {
    const monthStartCst = getCSTDate(currentMonthStart);
    const daysInMonth = new Date(Date.UTC(monthStartCst.getUTCFullYear(), monthStartCst.getUTCMonth() + 1, 0)).getUTCDate();
    for (let i = 1; i <= daysInMonth; i += 1) {
      const label = `${pad2(monthStartCst.getUTCMonth() + 1)}-${pad2(i)}`;
      trendByDay.set(label, 0);
    }
  };
  const initRecentMonthBuckets = (monthsCount) => {
    for (let i = monthsCount - 1; i >= 0; i -= 1) {
      const ts = Date.UTC(nowCstYear, nowCstMonth - i, 1, 0, 0, 0, 0) - OFFSET;
      const d = getCSTDate(ts);
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const label = y === nowCstYear ? `${m}月` : `${String(y).slice(2)}年${m}月`;
      trendByDay.set(label, 0);
    }
  };
  const initYearMonthBuckets = () => {
    for (let m = 1; m <= 12; m += 1) {
      trendByDay.set(`${m}月`, 0);
    }
  };
  if (salesTrendRange === 'year') {
    initYearMonthBuckets();
  } else if (salesTrendRange === '6m') {
    initRecentMonthBuckets(6);
  } else if (salesTrendRange === '3m') {
    initRecentMonthBuckets(3);
  } else {
    initMonthDailyBuckets();
  }

  const finishedStatusSet = new Set(['completed', 'done', 'finished', 'stocked', 'warehoused', 'shipped', 'shipping', 'delivered']);
  const normalizeOrderTs = (o) => toTs(o?.createdAt || o?.createTime || o?._createTime || o?.orderTime || 0);

  mergedOrders.forEach((order) => {
    if (!order) return;
    const ts = normalizeOrderTs(order);
    if (!ts) return;
    const amount = getOrderAmount(order);
    const sourceVal = String(order.source || '').toLowerCase();
    const orderTypeVal = String(order.orderType || '').toLowerCase();
    const categoryVal = String(order.purchaseCategory || order.category || '').toLowerCase();
    const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase';
    const isGoodsPurchase = isPurchaseExact && categoryVal !== 'raw_materials';
    const isBusinessOrder = !isPurchaseExact ? true : isGoodsPurchase;
    if (!isBusinessOrder) return;

    const qty = getOrderQuantity(order);
    const statusVal = String(order.status || '').toLowerCase();
    if (statusVal === 'cancelled') return;
    const stockedQty = toNumber(order.stockedQty || 0);

    let rawMaterialCost = 0;
    if (isPurchaseExact) {
      const items = Array.isArray(order.items) ? order.items : [];
      const first = items[0] || {};
      const purchaseUnitPrice = toNumber(order.salePrice ?? order.purchasePrice ?? order.costPrice ?? first.unitPrice ?? 0);
      rawMaterialCost = qty > 0 && purchaseUnitPrice > 0 ? qty * purchaseUnitPrice : 0;
    } else {
      // For sales orders, check if we should use board purchase amount
      const orderCreatedAtTs = ts;
      const purchaseOrderId = String(order.purchaseOrderId || '').trim();
      const boardPurchaseAmount = purchaseOrderId ? (boardPurchaseOrderMap.get(purchaseOrderId) || 0) : 0;
      const useBoardPurchaseAmount =
        Number.isFinite(orderCreatedAtTs) &&
        orderCreatedAtTs >= boardCostEffectiveFromTs &&
        boardPurchaseAmount > 0;

      if (useBoardPurchaseAmount) {
        // Use actual board purchase amount for orders after 2026-01-11
        rawMaterialCost = boardPurchaseAmount;
      } else {
        // Use traditional calculation: quantity × area × material price
        const items = Array.isArray(order.items) ? order.items : [];
        const first = items[0] || {};
        const materialNo = String(order.materialNo ?? first.materialNo ?? '').trim();
        const entry = materialNo ? materialPriceMap[materialNo] : undefined;
        const mapPrice = entry && entry.qty > 0 ? toNumber(entry.amount) / toNumber(entry.qty) : 0;
        const area = computeAreaSquareMeter(order);
        rawMaterialCost = qty > 0 && area > 0 && mapPrice > 0 ? qty * area * mapPrice : 0;
      }
    }

    let scrapCost = 0;
    if (!isPurchaseExact) {
      let scrapPieces = 0;
      if (statusVal === 'scrapped') {
        scrapPieces = qty;
      } else if (finishedStatusSet.has(statusVal)) {
        scrapPieces = Math.max(0, qty - Math.max(0, stockedQty));
      }
      if (qty > 0 && rawMaterialCost > 0 && scrapPieces > 0) {
        scrapCost = (rawMaterialCost * scrapPieces) / qty;
      }
    }

    if (ts >= yearStart && ts <= yearEnd) {
      yearSalesVal += amount;
      yearGrossProfitVal += amount - rawMaterialCost;  // 添加年度毛利计算
    }

    const inCurrentMonth = ts >= currentMonthStart && ts <= currentMonthEnd;
    const inLastMonth = ts >= lastMonthStart && ts <= lastMonthEnd;
    if (debugMonthKey && monthKeyOrders.length < 500) {
      const dForMonth = getCSTDate(ts);
      const monthKey = `${dForMonth.getUTCFullYear()}-${pad2(dForMonth.getUTCMonth() + 1)}`;
      if (monthKey === debugMonthKey) {
        monthKeyOrders.push({
          orderNo: order.orderNo || order.orderNumber || '',
          amount: Number(amount.toFixed(2)),
          orderType: String(order.orderType || ''),
          source: String(order.source || ''),
          purchaseCategory: String(order.purchaseCategory || order.category || ''),
          createdAt: order.createdAt || order.createTime || order.orderTime || order._createTime || null,
          sourceCollection: String(order._sourceCollection || '')
        });
      }
    }

    if (inCurrentMonth) {
      currentSales += amount;
      currentGrossProfit += amount - rawMaterialCost;
      if (!isPurchaseExact) {
        monthSalesProduction += amount;
        monthCountProduction += 1;
      } else if (isGoodsPurchase) {
        monthSalesGoodsPurchase += amount;
        monthCountGoodsPurchase += 1;
      }
      if (salesTrendRange === 'month') {
        const d = getCSTDate(ts);
        const key = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        if (trendByDay.has(key)) {
          trendByDay.set(key, (trendByDay.get(key) || 0) + amount);
        }
        if (debugTrendKey && key === debugTrendKey && trendKeyOrders.length < 200) {
          trendKeyOrders.push({
            orderNo: order.orderNo || order.orderNumber || '',
            amount: Number(amount.toFixed(2)),
            orderType: String(order.orderType || ''),
            source: String(order.source || ''),
            purchaseCategory: String(order.purchaseCategory || order.category || ''),
            createdAt: order.createdAt || order.createTime || order.orderTime || order._createTime || null,
            sourceCollection: String(order._sourceCollection || '')
          });
        }
      }
    }

    if (ts >= todayStart && ts <= todayEnd) {
      todaySales += amount;
    }

    if (inLastMonth) {
      lastSales += amount;
      if (!isPurchaseExact) {
        lastMonthProductionCost += rawMaterialCost;
        lastMonthScrapCost += scrapCost;
      }
      if (isGoodsPurchase) {
        lastMonthPurchaseCost += rawMaterialCost;
      }
    }

    if (salesTrendRange !== 'month') {
      const tsInTrendRange =
        salesTrendRange === 'year'
          ? ts >= yearStart && ts <= yearEnd
          : ts >= trendRangeStart && ts <= currentMonthEnd;
      if (tsInTrendRange) {
        const d = getCSTDate(ts);
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth() + 1;
        const key =
          salesTrendRange === 'year'
            ? `${m}月`
            : y === nowCstYear
              ? `${m}月`
              : `${String(y).slice(2)}年${m}月`;
        if (trendByDay.has(key)) {
          trendByDay.set(key, (trendByDay.get(key) || 0) + amount);
        }
      }
    }
  });

  // Track raw material cost used in production (from sales orders)
  let monthProductionRawMaterialCost = 0;

  mergedOrders.forEach((order) => {
    if (!order) return;
    const ts = normalizeOrderTs(order);
    if (!(ts >= currentMonthStart && ts <= currentMonthEnd)) return;

    const sourceVal = String(order.source || '').toLowerCase();
    const orderTypeVal = String(order.orderType || '').toLowerCase();
    const categoryVal = String(order.purchaseCategory || order.category || '').toLowerCase();
    const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase';
    const isGoodsPurchase = isPurchaseExact && categoryVal !== 'raw_materials';
    const isBusinessOrder = !isPurchaseExact ? true : isGoodsPurchase;
    if (!isBusinessOrder) return;

    const statusVal = String(order.status || '').toLowerCase();
    if (statusVal === 'cancelled') return;

    const qty = getOrderQuantity(order);

    let rawMaterialCost = 0;
    if (isPurchaseExact) {
      const items = Array.isArray(order.items) ? order.items : [];
      const first = items[0] || {};
      const purchaseUnitPrice = toNumber(order.salePrice ?? order.purchasePrice ?? order.costPrice ?? first.unitPrice ?? 0);
      rawMaterialCost = qty > 0 && purchaseUnitPrice > 0 ? qty * purchaseUnitPrice : 0;
    } else {
      // For sales orders, check if we should use board purchase amount
      const orderCreatedAtTs = ts;
      const purchaseOrderId = String(order.purchaseOrderId || '').trim();
      const boardPurchaseAmount = purchaseOrderId ? (boardPurchaseOrderMap.get(purchaseOrderId) || 0) : 0;
      const useBoardPurchaseAmount =
        Number.isFinite(orderCreatedAtTs) &&
        orderCreatedAtTs >= boardCostEffectiveFromTs &&
        boardPurchaseAmount > 0;

      if (useBoardPurchaseAmount) {
        // Use actual board purchase amount for orders after 2026-01-11
        rawMaterialCost = boardPurchaseAmount;
      } else {
        // Use traditional calculation: quantity × area × material price
        const items = Array.isArray(order.items) ? order.items : [];
        const first = items[0] || {};
        const materialNo = String(order.materialNo ?? first.materialNo ?? '').trim();
        const entry = materialNo ? materialPriceMap[materialNo] : undefined;
        const mapPrice = entry && entry.qty > 0 ? toNumber(entry.amount) / toNumber(entry.qty) : 0;
        const area = computeAreaSquareMeter(order);
        rawMaterialCost = qty > 0 && area > 0 && mapPrice > 0 ? qty * area * mapPrice : 0;
      }
    }

    monthProductionRawMaterialCost += rawMaterialCost;
  });

  (Array.isArray(rawMatPurchaseOrders) ? rawMatPurchaseOrders : []).forEach((o) => {
    if (!o) return;
    const ts = normalizeOrderTs(o);
    if (ts >= currentMonthStart && ts <= currentMonthEnd) {
      const qty = getOrderQuantity(o);
      const items = Array.isArray(o.items) ? o.items : [];
      const first = items[0] || {};
      const unitPrice = toNumber(o.salePrice ?? o.purchasePrice ?? o.costPrice ?? first.unitPrice ?? 0);
      if (qty > 0 && unitPrice > 0) {
        monthRawMaterialPurchaseCost += qty * unitPrice;
      }
    }
    if (!(ts >= lastMonthStart && ts <= lastMonthEnd)) return;
    const qty = getOrderQuantity(o);
    const items = Array.isArray(o.items) ? o.items : [];
    const first = items[0] || {};
    const unitPrice = toNumber(o.salePrice ?? o.purchasePrice ?? o.costPrice ?? first.unitPrice ?? 0);
    if (!(qty > 0 && unitPrice > 0)) return;
    lastMonthRawMaterialPurchaseCost += qty * unitPrice;
  });

  // 本月生产毛利 = 本月订单总金额 - 本月原材料总成本（用于生产的成本，不是采购的成本）
  monthProductionGrossProfit = currentSales - monthProductionRawMaterialCost;
  const monthGrossMargin = currentSales > 0 ? (monthProductionGrossProfit / currentSales) * 100 : 0;
  const salesYoY = lastSales > 0 ? ((currentSales - lastSales) / lastSales) * 100 : 0;

  let lastMonthSalaryTotal = 0;
  const salaryLastMonthDate = getCSTDate(lastMonthStart);
  const lastYearValue = salaryLastMonthDate.getUTCFullYear();
  const lastMonthValue = salaryLastMonthDate.getUTCMonth() + 1;
  (Array.isArray(employees) ? employees : []).forEach((emp) => {
    if (!emp) return;
    const status = String(emp.status || '').toLowerCase();
    if (status === 'left') return;
    const details = Array.isArray(emp.salaryDetails) ? emp.salaryDetails : [];
    details.forEach((detail) => {
      if (!detail) return;
      const month = Number(detail.month);
      const year = Number(detail.year);
      if (!Number.isFinite(month) || month < 1 || month > 12) return;
      if (!Number.isFinite(year)) return;
      if (year !== lastYearValue || month !== lastMonthValue) return;
      const totalRow = computeRowSalary(detail);
      if (totalRow > 0) {
        lastMonthSalaryTotal += totalRow;
      }
    });
  });

  let lastMonthFixedCost = 0;
  (Array.isArray(fixedCostItems) ? fixedCostItems : []).forEach((item) => {
    if (!item) return;
    const amount = toNumber(item.amount || 0);
    if (!(amount > 0)) return;
    const ts = toTs(item.date || item.createdAt || item._createTime || 0);
    if (!(ts >= lastMonthStart && ts <= lastMonthEnd)) return;
    lastMonthFixedCost += amount;
  });

  const financeMonthStart = currentMonthStart;
  const financeMonthEnd = currentMonthEnd;

  const financeSalesOrders = (Array.isArray(salesOrders) ? salesOrders : []).filter((o) => {
    const t = String(o?.orderType || '').toLowerCase();
    if (t === 'purchase') return false;
    if (o?._businessMergedFrom === 'purchase') return false;
    return true;
  });

  const financeInvoicedAmountThisMonth = financeSalesOrders.reduce((sum, o) => {
    if (!o) return sum;
    const note = o?.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
    const invoicedRaw = (note && note.invoicedAt) || o?.invoicedAt || null;
    if (!invoicedRaw) return sum;
    const ts = toTs(invoicedRaw);
    if (!ts) return sum;
    if (ts < financeMonthStart || ts > financeMonthEnd) return sum;
    return sum + getOrderAmount(o);
  }, 0);

  const financeReceivableSummary = (() => {
    const receivableMap = new Map();
    financeSalesOrders.forEach((o) => {
      if (!o) return;
      const note = o?.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null;
      const reconciledRaw = (note && note.reconciledAt) || o?.reconciledAt || null;
      const statementNo = String(o?.statementNo || (note && note.statementNo) || '').trim();
      if (!reconciledRaw || !statementNo) return;

      const customerId = o?.customerId || o?.customer?._id || o?.customer?.id || '';
      const customerObj =
        (customerId && customerMap.get(String(customerId))) ||
        (o?.customerName && customerMap.get(String(o.customerName))) ||
        (o?.customer?.name && customerMap.get(String(o.customer.name))) ||
        {};

      const paymentTerm =
        customerObj.paymentTerms ||
        o?.paymentTerm ||
        o?.paymentTerms ||
        o?.term ||
        '';

      const amountVal = getOrderAmount(o);
      const invoicedRaw = (note && note.invoicedAt) || o?.invoicedAt || null;
      if (!invoicedRaw) return;
      const paidRaw = (note && note.paidAt) || o?.paidAt || null;
      const invoiceDate = formatYmdCST(toTs(invoicedRaw));
      const paymentDate = paidRaw ? formatYmdCST(toTs(paidRaw)) : '';
      const reconcileTs = toTs(reconciledRaw);
      const reconcileDate = formatYmdCST(reconcileTs);

      const prev = receivableMap.get(statementNo) || {
        statementNo,
        amountReceivable: 0,
        amountReceived: 0,
        invoiceDate: '',
        paymentDate: '',
        reconcileDate: '',
        dueDate: '',
        paymentTerm
      };

      prev.amountReceivable += Number(amountVal || 0);

      const localPayment = receivablePaymentMap && receivablePaymentMap[statementNo];
      if (localPayment && typeof localPayment === 'object') {
        prev.amountReceived = Number(localPayment.received || 0);
        if (localPayment.lastPaymentDate) {
          prev.paymentDate = String(localPayment.lastPaymentDate || '');
        }
      } else if (paymentDate) {
        prev.amountReceived += Number(amountVal || 0);
        if (!prev.paymentDate || paymentDate > prev.paymentDate) {
          prev.paymentDate = paymentDate;
        }
      }

      if (invoiceDate && (!prev.invoiceDate || invoiceDate > prev.invoiceDate)) {
        prev.invoiceDate = invoiceDate;
      }
      if (reconcileDate && !prev.reconcileDate) {
        prev.reconcileDate = reconcileDate;
      }
      receivableMap.set(statementNo, prev);
    });

    Array.from(receivableMap.values()).forEach((r) => {
      if (!r.dueDate && r.reconcileDate) {
        const reconcileTs = toTs(r.reconcileDate);
        if (!reconcileTs) return;
        const paymentTermStr = String(r.paymentTerm || '');
        let dueTs = reconcileTs;
        if (paymentTermStr.includes('月结')) {
          const match = paymentTermStr.match(/(\d+)天/);
          const daysToAdd = match ? parseInt(match[1], 10) : 0;
          dueTs = startOfNextMonthCST(reconcileTs) + daysToAdd * 24 * 60 * 60 * 1000;
        } else if (paymentTermStr.includes('现结') || paymentTermStr.includes('现付')) {
          dueTs = reconcileTs;
        }
        if (dueTs) {
          r.dueDate = formatYmdCST(dueTs);
        }
      }

      const override =
        receivableStatementOverrideMap && typeof receivableStatementOverrideMap === 'object'
          ? receivableStatementOverrideMap[String(r.statementNo)]
          : undefined;
      if (override && typeof override === 'object') {
        if (override.dueDate) r.dueDate = String(override.dueDate || '');
        if (override.invoiceDate) r.invoiceDate = String(override.invoiceDate || '');
      }
    });

    const dueStartTs = financeMonthStart;
    const dueEndTs = financeMonthEnd;
    const todayStartTs = startOfDayCST(now);
    let monthReceivableDue = 0;
    let overdueUnpaidByLastMonthEnd = 0;
    let monthReceivableOverdueUnpaid = 0;
    Array.from(receivableMap.values()).forEach((r) => {
      const total = Number(r.amountReceivable || 0);
      const received = Number(r.amountReceived || 0);
      const usedReceived = Math.min(Math.max(received, 0), total);
      const remaining = total - usedReceived;
      if (!Number.isFinite(remaining) || remaining <= 0) return;
      const dueTs = toTs(r.dueDate);
      if (!dueTs) return;
      if (dueTs < dueStartTs) {
        overdueUnpaidByLastMonthEnd += remaining;
        return;
      }
      if (dueTs > dueEndTs) return;
      monthReceivableDue += remaining;
      if (dueTs < todayStartTs) monthReceivableOverdueUnpaid += remaining;
    });

    return {
      monthReceivableDue: Number(monthReceivableDue.toFixed(2)),
      overdueUnpaidByLastMonthEnd: Number(overdueUnpaidByLastMonthEnd.toFixed(2)),
      monthReceivableOverdueUnpaid: Number(monthReceivableOverdueUnpaid.toFixed(2))
    };
  })();

  const financePayableSummary = (() => {
    const list = Array.isArray(payables) ? payables : [];
    let monthPayableTotal = 0;
    let overdueUnpaidByMonthEnd = 0;
    list.forEach((it) => {
      if (!it) return;
      const amountPayable = Number(it.amountPayable || 0);
      const amountPaid = Number(it.amountPaid || 0);
      if (!Number.isFinite(amountPayable) || amountPayable <= 0) return;
      const unpaid = Math.max(amountPayable - (Number.isFinite(amountPaid) ? amountPaid : 0), 0);

      const invoiceTs = toTs(it.invoiceDate || it.date || null);
      if (invoiceTs && invoiceTs >= financeMonthStart && invoiceTs <= financeMonthEnd) {
        monthPayableTotal += amountPayable;
      }

      const dueTs = toTs(it.dueDate || null);
      if (dueTs && dueTs <= financeMonthEnd) {
        overdueUnpaidByMonthEnd += unpaid;
      }
    });
    return {
      monthPayableTotal: Number(monthPayableTotal.toFixed(2)),
      overdueUnpaidByMonthEnd: Number(overdueUnpaidByMonthEnd.toFixed(2))
    };
  })();

  const financeMonthTaxAmount = (() => {
    const invoiced = Number(financeInvoicedAmountThisMonth || 0);
    const input = Number(financePayableSummary.monthPayableTotal || 0);
    const val = invoiced * 0.13 - input * 0.13;
    if (!Number.isFinite(val)) return 0;
    return Number(val.toFixed(2));
  })();

  const financeMonthGrossProfitAmount = (() => {
    const invoiced = Number(financeInvoicedAmountThisMonth || 0);
    const input = Number(financePayableSummary.monthPayableTotal || 0);
    const tax = Number(financeMonthTaxAmount || 0);
    const val = invoiced - input - tax;
    if (!Number.isFinite(val)) return 0;
    return Number(val.toFixed(2));
  })();

  const overallLastMonth = (() => {
    const revenue = Number(lastSales.toFixed(2));
    const productionCost = Number(lastMonthProductionCost.toFixed(2));
    const purchaseCost = Number(lastMonthPurchaseCost.toFixed(2));
    const scrapCost = Number(lastMonthScrapCost.toFixed(2));
    const rawMatPurchaseCost = Number(lastMonthRawMaterialPurchaseCost.toFixed(2));
    const salaryCost = Number(lastMonthSalaryTotal.toFixed(2));
    const fixedCost = Number(lastMonthFixedCost.toFixed(2));
    const totalCost = productionCost + purchaseCost + scrapCost + rawMatPurchaseCost + salaryCost + fixedCost;
    const profit = revenue - totalCost;
    return {
      revenue: Number(revenue.toFixed(2)),
      productionCost: Number(productionCost.toFixed(2)),
      purchaseCost: Number(purchaseCost.toFixed(2)),
      scrapCost: Number(scrapCost.toFixed(2)),
      rawMatPurchaseCost: Number(rawMatPurchaseCost.toFixed(2)),
      salaryCost: Number(salaryCost.toFixed(2)),
      fixedCost: Number(fixedCost.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      profit: Number(profit.toFixed(2))
    };
  })();

  const chartData = {
    trendByDay: Array.from(trendByDay.entries()).map(([k, v]) => ({ label: k, value: Number(Number(v || 0).toFixed(2)) })),
    costPie: [
      { name: '生产成本', value: Math.max(0, Number(lastMonthProductionCost.toFixed(2))) },
      { name: '采购成本', value: Math.max(0, Number(lastMonthPurchaseCost.toFixed(2))) },
      { name: '辅材成本', value: Math.max(0, Number(lastMonthRawMaterialPurchaseCost.toFixed(2))) },
      { name: '报废成本', value: Math.max(0, Number(lastMonthScrapCost.toFixed(2))) }
    ],
    incomeExpensePie: [
      { name: '毛利润', value: Math.max(0, financeMonthGrossProfitAmount) },
      { name: '税额', value: Math.max(0, financeMonthTaxAmount) },
      { name: '进项金额', value: Math.max(0, financePayableSummary.monthPayableTotal) }
    ],
    profitWaterfall: {
      revenue: overallLastMonth.revenue,
      productionCost: -Math.max(0, overallLastMonth.productionCost),
      goodsPurchaseCost: -Math.max(0, overallLastMonth.purchaseCost),
      rawMaterialPurchaseCost: -Math.max(0, overallLastMonth.rawMatPurchaseCost),
      scrapCost: -Math.max(0, overallLastMonth.scrapCost),
      salaryCost: -Math.max(0, overallLastMonth.salaryCost),
      fixedCost: -Math.max(0, overallLastMonth.fixedCost),
      profit: overallLastMonth.profit
    }
  };

  const legacyCompareDebug = (() => {
    if (!debugCompareLegacy) return null;
    let onlyLegacyBusinessCount = 0;
    let onlyLegacyBusinessAmount = 0;
    const onlyLegacyTrendKeyOrders = [];
    const onlyLegacyMonthKeyOrders = [];
    (Array.isArray(legacyOnlyOrdersInRange) ? legacyOnlyOrdersInRange : []).forEach((order) => {
      if (!order) return;
      const ts = normalizeOrderTs(order);
      if (!ts) return;
      const amount = getOrderAmount(order);
      const sourceVal = String(order.source || '').toLowerCase();
      const orderTypeVal = String(order.orderType || '').toLowerCase();
      const categoryVal = String(order.purchaseCategory || order.category || '').toLowerCase();
      const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase';
      const isGoodsPurchase = isPurchaseExact && categoryVal !== 'raw_materials';
      const isBusinessOrder = !isPurchaseExact ? true : isGoodsPurchase;
      if (!isBusinessOrder) return;
      onlyLegacyBusinessCount += 1;
      onlyLegacyBusinessAmount += amount;
      if (debugTrendKey && salesTrendRange === 'month' && onlyLegacyTrendKeyOrders.length < 200) {
        const d = getCSTDate(ts);
        const key = `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        if (key === debugTrendKey) {
          onlyLegacyTrendKeyOrders.push({
            orderNo: order.orderNo || order.orderNumber || '',
            amount: Number(amount.toFixed(2)),
            orderType: String(order.orderType || ''),
            source: String(order.source || ''),
            purchaseCategory: String(order.purchaseCategory || order.category || ''),
            createdAt: order.createdAt || order.createTime || order.orderTime || order._createTime || null,
            sourceCollection: String(order._sourceCollection || '')
          });
        }
      }
      if (debugMonthKey && onlyLegacyMonthKeyOrders.length < 500) {
        const d = getCSTDate(ts);
        const monthKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
        if (monthKey === debugMonthKey) {
          onlyLegacyMonthKeyOrders.push({
            orderNo: order.orderNo || order.orderNumber || '',
            amount: Number(amount.toFixed(2)),
            orderType: String(order.orderType || ''),
            source: String(order.source || ''),
            purchaseCategory: String(order.purchaseCategory || order.category || ''),
            createdAt: order.createdAt || order.createTime || order.orderTime || order._createTime || null,
            sourceCollection: String(order._sourceCollection || '')
          });
        }
      }
    });
    return {
      primaryCollections: ordersCollections,
      legacyCollections: legacyOrdersCollections,
      legacyFetched: Array.isArray(legacyOrdersByCollection)
        ? legacyOrdersByCollection.reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)
        : 0,
      legacyDeduped: Array.isArray(legacyAllOrdersInRange) ? legacyAllOrdersInRange.length : 0,
      legacyOnlyDeduped: Array.isArray(legacyOnlyOrdersInRange) ? legacyOnlyOrdersInRange.length : 0,
      legacyOnlyBusinessCount,
      legacyOnlyBusinessAmount: Number(onlyLegacyBusinessAmount.toFixed(2)),
      legacyOnlyTrendKeyOrders: onlyLegacyTrendKeyOrders,
      legacyOnlyMonthKeyOrders: onlyLegacyMonthKeyOrders
    };
  })();

  return {
    success: true,
    data: {
      business: {
        monthSales: Number(currentSales.toFixed(2)),
        todaySales: Number(todaySales.toFixed(2)),
        monthYoY: Number(salesYoY.toFixed(1)),
        monthGrossProfit: Number(monthProductionGrossProfit.toFixed(2)),
        monthGrossMargin: Number(monthGrossMargin.toFixed(1)),
        yearGrossProfit: Number(yearGrossProfitVal.toFixed(2)),  // 添加年度毛利
        yearGrossMargin: yearSalesVal > 0 ? Number(((yearGrossProfitVal / yearSalesVal) * 100).toFixed(1)) : 0  // 添加年度毛利率
      },
      cost: {
        lastMonthProductionCost: Number(lastMonthProductionCost.toFixed(2)),
        lastMonthPurchaseCost: Number(lastMonthPurchaseCost.toFixed(2)),
        lastMonthScrapCost: Number(lastMonthScrapCost.toFixed(2)),
        lastMonthRawMaterialPurchaseCost: Number(lastMonthRawMaterialPurchaseCost.toFixed(2)),
        lastMonthSalaryCost: Number(lastMonthSalaryTotal.toFixed(2)),
        lastMonthFixedCost: Number(lastMonthFixedCost.toFixed(2))
      },
      finance: {
        monthInvoiced: Number(financeInvoicedAmountThisMonth.toFixed(2)),
        monthInput: Number(financePayableSummary.monthPayableTotal.toFixed(2)),
        monthReceivable: Number(financeReceivableSummary.monthReceivableDue.toFixed(2)),
        monthOverdueUnpaid: Number(financeReceivableSummary.overdueUnpaidByLastMonthEnd.toFixed(2)),
        monthTax: Number(financeMonthTaxAmount.toFixed(2))
      },
      overall: {
        lastMonthSales: overallLastMonth.revenue,
        lastMonthProductionCost: overallLastMonth.productionCost,
        lastMonthSalaryCost: overallLastMonth.salaryCost,
        lastMonthFixedCost: overallLastMonth.fixedCost,
        lastMonthProfit: overallLastMonth.profit
      },
      debug: {
        rangeStartMs,
        yearEndMs,
        lastMonthStart,
        lastMonthEnd,
        collections: {
          primary: ordersCollections,
          legacyEnabled: debugCompareLegacy
        },
        fetched: {
          allOrdersInRangeRaw: Array.isArray(allOrdersInRangeRaw) ? allOrdersInRangeRaw.length : 0,
          allOrdersInRangeDeduped: Array.isArray(allOrdersInRange) ? allOrdersInRange.length : 0,
          salesOrders: Array.isArray(salesOrders) ? salesOrders.length : 0,
          purchaseGoodsOrdersFromOrders: Array.isArray(purchaseGoodsOrdersFromOrders) ? purchaseGoodsOrdersFromOrders.length : 0,
          rawMatPurchaseOrdersFromOrders: Array.isArray(rawMatPurchaseOrdersFromOrders) ? rawMatPurchaseOrdersFromOrders.length : 0,
          mergedOrders: Array.isArray(mergedOrders) ? mergedOrders.length : 0
        },
        monthSalesBreakdown: {
          production: Number(monthSalesProduction.toFixed(2)),
          goodsPurchase: Number(monthSalesGoodsPurchase.toFixed(2))
        },
        monthSalesCountBreakdown: {
          production: monthCountProduction,
          goodsPurchase: monthCountGoodsPurchase
        },
        trendKey: debugTrendKey,
        trendKeyOrders,
        ...(debugMonthKey ? { monthKey: debugMonthKey, monthKeyOrders } : {}),
        ...(legacyCompareDebug ? { compareLegacy: legacyCompareDebug } : {})
      },
      chartData
    }
  };
}

async function getOrderOverview(params = {}) {
  const safeCountTotal = async (query) => {
    try {
      const res = await query.count();
      const total = Number(res && res.total);
      return Number.isFinite(total) ? total : 0;
    } catch (_) {
      return 0;
    }
  };

  const statusList = ['ordered', 'pending', 'processing', 'stocked'];

  const baseWhere = _.and([
    { isDeleted: _.neq(true) },
    _.or([{ orderType: _.exists(false) }, { orderType: null }, { orderType: '' }, { orderType: _.neq('purchase') }]),
    _.or([{ source: _.neq('purchased') }, { source: _.exists(false) }, { source: null }, { source: '' }]),
    _.or([{ purchaseCategory: _.exists(false) }, { purchaseCategory: null }, { purchaseCategory: '' }]),
    _.or([{ category: _.exists(false) }, { category: null }, { category: '' }])
  ]);

  const baseQuery = () => db.collection('orders').where(baseWhere);

  const [total, monthResult, ...statusCounts] = await Promise.all([
    safeCountTotal(baseQuery()),
    getMonthOrderCount(params),
    ...statusList.map((s) => safeCountTotal(baseQuery().where({ status: s })))
  ]);

  const monthOrderCount = Number(monthResult?.data?.orderCount || 0);
  const normalizedMonth = Number.isFinite(monthOrderCount) ? monthOrderCount : 0;

  const statusDistribution = {};
  statusList.forEach((s, idx) => {
    const n = Number(statusCounts[idx] || 0);
    statusDistribution[s] = Number.isFinite(n) ? n : 0;
  });

  return {
    success: true,
    data: {
      total: Number.isFinite(total) ? total : 0,
      monthOrderCount: normalizedMonth,
      statusDistribution
    }
  };
}

async function getProductionEfficiencyStats(params = {}) {
  const maxLimitRaw = Number(process.env.ERP_QUERY_MAX_LIMIT);
  const maxLimit = Number.isFinite(maxLimitRaw) && maxLimitRaw > 0 ? Math.floor(maxLimitRaw) : 2000;
  const limitRaw = Number(params?.limit || params?.maxItems || 500);
  const safeLimit = Math.min(Math.max(1, limitRaw || 500), Math.min(5000, maxLimit));
  const period = String(params?.period || '90d').trim();

  const now = Date.now();
  let startTime = 0;
  if (period === '7d') startTime = now - 7 * 24 * 60 * 60 * 1000;
  else if (period === '30d') startTime = now - 30 * 24 * 60 * 60 * 1000;
  else if (period === '90d') startTime = now - 90 * 24 * 60 * 60 * 1000;
  else if (period === '180d') startTime = now - 180 * 24 * 60 * 60 * 1000;
  else startTime = 0;

  const baseWhere = _.and([
    { isDeleted: _.neq(true) },
    _.or([{ orderType: _.exists(false) }, { orderType: null }, { orderType: '' }, { orderType: _.neq('purchase') }]),
    _.or([{ source: _.neq('purchased') }, { source: _.exists(false) }, { source: null }, { source: '' }]),
    _.or([{ purchaseCategory: _.exists(false) }, { purchaseCategory: null }, { purchaseCategory: '' }]),
    _.or([{ category: _.exists(false) }, { category: null }, { category: '' }])
  ]);

  const timeRangeOr = startTime
    ? _.or([
      { createdAt: _.gte(startTime) },
      { createTime: _.gte(startTime) },
      { orderTime: _.gte(startTime) },
      { _createTime: _.gte(startTime) }
    ])
    : null;

  const where = timeRangeOr ? _.and([baseWhere, timeRangeOr]) : baseWhere;

  const toTs = (value) => {
    if (!value) return 0;
    if (typeof value === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (n < 1000000000000) return n * 1000;
      return n;
    }
    if (value instanceof Date) {
      const t = value.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  };

  const computeStatus = (o) => {
    const raw = o && typeof o === 'object' ? o : {};
    const s = String(raw.status || '').toLowerCase();
    const shippedAt = toTs(raw.shippedAt) || toTs(raw.deliveredAt);
    const stockedAt = toTs(raw.stockedAt) || toTs(raw.stockTime) || toTs(raw.warehousedAt);
    const startedAt = toTs(raw.printStartAt) || toTs(raw.startedAt) || toTs(raw.startTime);
    const printFinishAt = toTs(raw.printFinishAt) || toTs(raw.printedAt) || toTs(raw.completedAt);

    if (s === 'completed' || s === 'done' || raw.status === '已完成' || raw.status === '完成') return 'completed';
    if (shippedAt || ['shipped', 'shipping', 'delivered'].includes(s) || ['正在发货', '已发货', '已送货'].includes(String(raw.status || ''))) return 'shipping';
    if (stockedAt || ['stocked', 'warehoused', 'warehouse'].includes(s) || ['已入库'].includes(String(raw.status || ''))) return 'stocked';
    if (printFinishAt) return 'processing';
    if (startedAt || ['processing', 'in_progress', 'producing'].includes(s) || ['生产中'].includes(String(raw.status || ''))) return 'processing';
    if (['pending', 'waiting', 'planned'].includes(s) || ['待生产'].includes(String(raw.status || ''))) return 'pending';
    if (s === 'ordered' || raw.status === '已下单') return 'ordered';
    return 'ordered';
  };

  const toCreateTs = (o) => {
    const raw = o && typeof o === 'object' ? o : {};
    const direct = toTs(raw.createdAt || raw.createTime || raw.createdTime || raw.createAt || raw._createTime || raw.orderTime);
    if (direct) return direct;
    const orderNo = String(raw.orderNo || raw.orderNumber || '').trim();
    const dateMatch = orderNo.match(/(20\d{2})(\d{2})(\d{2})/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      const t = Date.parse(`${year}-${month}-${day}`);
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  };

  const toStockTs = (o) => {
    const raw = o && typeof o === 'object' ? o : {};
    return toTs(raw.stockedAt || raw.stockTime || raw.warehousedAt);
  };

  const getListPage = async (skip, limit) => {
    let q = db.collection('orders').where(where);
    try {
      q = q.orderBy('createdAt', 'desc').skip(skip).limit(limit);
      const res = await q.get();
      return Array.isArray(res?.data) ? res.data : [];
    } catch (_) {
      try {
        q = db.collection('orders').where(where).orderBy('_createTime', 'desc').skip(skip).limit(limit);
        const res = await q.get();
        return Array.isArray(res?.data) ? res.data : [];
      } catch (_) {
        const res = await db.collection('orders').where(where).skip(skip).limit(limit).get().catch(() => ({ data: [] }));
        return Array.isArray(res?.data) ? res.data : [];
      }
    }
  };

  const pageSize = 100;
  const orders = [];
  for (let page = 0; page < 2000 && orders.length < safeLimit; page++) {
    const skip = page * pageSize;
    const take = Math.min(pageSize, safeLimit - orders.length);
    const rows = await getListPage(skip, take);
    if (rows.length) orders.push(...rows);
    if (rows.length < take) break;
  }

  const productionStatuses = new Set(['ordered', 'pending', 'processing', 'stocked', 'shipping', 'completed']);
  const normalized = orders.map((o) => {
    const status = computeStatus(o);
    return { ...(o || {}), _pmStatus: status };
  }).filter((o) => productionStatuses.has(o._pmStatus));

  const total = normalized.length;
  const pending = normalized.filter((o) => o._pmStatus === 'pending').length;
  const processing = normalized.filter((o) => o._pmStatus === 'processing').length;
  const producedCompleted = normalized.filter((o) => ['completed', 'stocked', 'shipping'].includes(o._pmStatus)).length;
  const completedRate = total ? Math.round((producedCompleted / total) * 100) : 0;

  let counted = 0;
  let sumRate = 0;
  for (const o of normalized) {
    const q = Number(o.quantity || o.totalQty || 0);
    if (!Number.isFinite(q) || q <= 0) continue;
    const stocked = Number(o.stockedQty || 0);
    const stockedQty = Number.isFinite(stocked) && stocked > 0 ? stocked : 0;
    if (stockedQty > q) continue;
    const inboundQty = Math.min(stockedQty, q);
    const scrapPieces = q - inboundQty;
    sumRate += (scrapPieces / q);
    counted += 1;
  }
  const scrapRate = counted ? Math.round(((sumRate / counted) * 100) * 10) / 10 : 0;

  const unique = new Map();
  for (const it of normalized) {
    const key = String(it.orderNo || it.orderNumber || '').trim();
    if (!key) continue;
    if (!unique.has(key)) unique.set(key, it);
    else {
      const prev = unique.get(key);
      const prevStock = toStockTs(prev);
      const nextStock = toStockTs(it);
      if (nextStock && (!prevStock || nextStock > prevStock)) unique.set(key, it);
    }
  }

  const durations = [];
  unique.forEach((it) => {
    const createTs = toCreateTs(it);
    const stockTs = toStockTs(it);
    if (!createTs || !stockTs || stockTs < createTs) return;
    durations.push((stockTs - createTs) / 86400000);
  });
  const avgDeliveryDays = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : 0;
  const timelyStocks = durations.filter((d) => d <= 4).length;
  const onTimeRate = durations.length ? Math.round((timelyStocks / durations.length) * 100) : 0;

  return {
    success: true,
    data: {
      period,
      limit: safeLimit,
      summary: {
        total,
        pending,
        processing,
        producedCompleted,
        completedRate,
        scrapRate,
        avgDeliveryDays,
        onTimeRate
      }
    }
  };
}

/**
 * 获取订单统计
 */
async function getOrderStats(params = {}) {
  const { period = '30d' } = params;

  const now = Date.now();
  let startTime;
  switch (period) {
    case '7d':
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    case '90d':
      startTime = now - 90 * 24 * 60 * 60 * 1000;
      break;
    default:
      startTime = now - 30 * 24 * 60 * 60 * 1000;
  }

  const orderResult = await db.collection('orders').where({
    createdAt: _.gte(startTime)
  }).orderBy('createdAt', 'desc').get();

  // 按状态统计
  const statusStats = {};
  let totalAmount = 0;

  orderResult.data.forEach(order => {
    if (!statusStats[order.status]) {
      statusStats[order.status] = 0;
    }
    statusStats[order.status]++;
    totalAmount += (order.totalAmount || 0);
  });

  return {
    success: true,
    data: {
      period,
      summary: {
        total: orderResult.data.length,
        totalAmount,
        statusDistribution: statusStats
      },
      orders: orderResult.data.slice(0, 100) // 只返回最近100条用于图表
    }
  };
}

/**
 * 获取生产统计
 */
async function getProductionStats(params = {}) {
  const { period = '30d' } = params;

  const now = Date.now();
  let startTime;
  switch (period) {
    case '7d':
      startTime = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '30d':
      startTime = now - 30 * 24 * 60 * 60 * 1000;
      break;
    case '90d':
      startTime = now - 90 * 24 * 60 * 60 * 1000;
      break;
    default:
      startTime = now - 30 * 24 * 60 * 60 * 1000;
  }

  const productionResult = await db.collection('production').where({
    createdAt: _.gte(startTime)
  }).orderBy('createdAt', 'desc').get();

  // 按状态统计
  const statusStats = {};
  productionResult.data.forEach(plan => {
    if (!statusStats[plan.status]) {
      statusStats[plan.status] = 0;
    }
    statusStats[plan.status]++;
  });

  return {
    success: true,
    data: {
      period,
      summary: {
        total: productionResult.data.length,
        statusDistribution: statusStats
      },
      productionPlans: productionResult.data.slice(0, 100)
    }
  };
}

/**
 * 工具函数
 */

async function generateOrderNumber() {
  const now = new Date();
  const year = String(now.getFullYear());
  const key = `order_no:${year}`;
  const seqLength = year === '2025' ? 7 : 8;

  try {
    const res = await db.collection('counters').doc(key).update({
      data: { seq: _.inc(1) }
    });
    if (!res.stats.updated) throw new Error('Counter not found');
  } catch (e) {
    // 初始化计数器（仅当计数器不存在时执行）
    let lastSeq = 0;
    try {
      const re = db.RegExp({ regexp: `^QXBZ${year}\\d{${seqLength}}$`, options: 'i' });
      const latest1 = await db.collection('orders')
        .where({ orderNumber: re })
        .orderBy('orderNumber', 'desc')
        .limit(1)
        .get();
      if (latest1 && latest1.data && latest1.data.length) {
        const no = String(latest1.data[0].orderNumber || '');
        const m = no.match(new RegExp(`(\\d{${seqLength}})$`));
        lastSeq = m ? Number(m[1]) : 0;
      }

      // 同时也检查 orderNo 字段
      const latest2 = await db.collection('orders')
        .where({ orderNo: re })
        .orderBy('orderNo', 'desc')
        .limit(1)
        .get();
      if (latest2 && latest2.data && latest2.data.length) {
        const no2 = String(latest2.data[0].orderNo || '');
        const m2 = no2.match(new RegExp(`(\\d{${seqLength}})$`));
        const s2 = m2 ? Number(m2[1]) : 0;
        if (s2 > lastSeq) lastSeq = s2;
      }

      // 检查预约号
      const rmax = await db.collection('order_number_reservations')
        .where({ year })
        .orderBy('number', 'desc')
        .limit(1)
        .get();
      if (rmax && rmax.data && rmax.data.length) {
        lastSeq = Math.max(lastSeq, Number(rmax.data[0].number || 0));
      }
    } catch (_) { }

    try {
      await db.collection('counters').add({
        data: { _id: key, seq: lastSeq }
      });
    } catch (ignore) {
      // 如果并发创建导致已存在，忽略错误，直接进行 update
    }

    // 再次尝试自增
    await db.collection('counters').doc(key).update({
      data: { seq: _.inc(1) }
    });
  }

  const counter = await db.collection('counters').doc(key).get();
  const seq = String(counter.data.seq).padStart(seqLength, '0');

  return `QXBZ${year}${seq}`;
}

/**
 * 生成发货单号 (SH + YYYYMMDD + 0001)
 */
async function generateShippingNumber(payload = {}) {
  const raw =
    payload && typeof payload === 'object'
      ? (payload.shipDate ?? payload.dateKey ?? payload.dateStr ?? payload.date)
      : payload;
  const normalized = String(raw || '').trim();
  const parseToDateStr = () => {
    if (/^\d{8}$/.test(normalized)) return normalized;
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized.replace(/-/g, '');
    const d = normalized ? new Date(normalized) : new Date();
    const used = Number.isNaN(d.getTime()) ? new Date() : d;
    const year = String(used.getFullYear());
    const month = String(used.getMonth() + 1).padStart(2, '0');
    const day = String(used.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  const dateStr = parseToDateStr();
  const key = `shipping_no_daily:${dateStr}`;
  const seqLength = 4;

  try {
    const res = await db.collection('counters').doc(key).update({
      data: { seq: _.inc(1) }
    });
    if (!res.stats.updated) throw new Error('Counter missing');
  } catch (e) {
    try {
      await db.collection('counters').add({ data: { _id: key, seq: 0 } });
    } catch (ignore) { }
    await db.collection('counters').doc(key).update({
      data: { seq: _.inc(1) }
    });
  }

  const counter = await db.collection('counters').doc(key).get();
  const seqValue = Number(counter && counter.data ? counter.data.seq : 0) || 0;
  const seq = String(seqValue).padStart(seqLength, '0');
  return { shippingNoteNo: `SH${dateStr}${seq}`, dateKey: dateStr, seq: seqValue };
}

/**
 * 创建发货单
 */
async function createShippingOrder(data, wxContext) {
  const { orderId, orderNo } = data;
  if (!orderId && !orderNo) throw new Error('Order ID or No required');

  let order = null;
  if (orderId) {
    const r = await db.collection('orders').doc(orderId).get().catch(() => null);
    order = r && r.data;
  }
  if (!order && orderNo) {
    const r = await db.collection('orders').where({ orderNo }).limit(1).get();
    order = r.data && r.data[0];
  }
  if (!order) throw new Error('订单不存在');

  const generated = await generateShippingNumber(data);
  const shippingNo = generated.shippingNoteNo;
  const now = Date.now();

  await db.collection('orders').doc(order._id).update({
    data: {
      shippingStatus: 'pending',
      shippingPendingAt: now,
      shippingOrderNo: shippingNo,
      updatedAt: now,
      updatedBy: wxContext.OPENID
    }
  });

  return {
    success: true,
    data: {
      id: order._id,
      status: 'pending',
      orderNo: shippingNo,
      dateKey: generated.dateKey,
      seq: generated.seq
    },
    message: '发货单生成成功'
  };
}

async function generateShippingNumberAction(data) {
  const generated = await generateShippingNumber(data);
  return {
    success: true,
    data: generated,
    message: '生成发货单号成功'
  };
}

function formatDateKeyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;
  return /^\d{8}$/.test(dateStr) ? dateStr : '';
}

function stripDupSuffixFromOrderNo(orderNo) {
  const s = String(orderNo || '').trim();
  const idx = s.indexOf('_dup_');
  if (idx < 0) return s;
  return s.slice(0, idx);
}

function extractDateKeyFromOrderNo(orderNo) {
  const s = String(orderNo || '').trim();
  const m = s.match(/^(QXDD|QXBZ)(\d{8})/i);
  return m ? String(m[2] || '').trim() : '';
}

function randomFixedDigits(length) {
  const len = Math.max(1, Number(length) || 1);
  const max = 10 ** len;
  const n = Math.floor(Math.random() * max);
  return String(n).padStart(len, '0');
}

function buildDedupOrderNo(baseOrderNo, timestampMs, random4) {
  const base = String(baseOrderNo || '').trim();
  const ts = String(Number(timestampMs) || Date.now());
  const r = String(random4 || randomFixedDigits(4)).padStart(4, '0').slice(0, 4);
  return `${base}${ts}${r}`;
}

async function ensureCloudCollectionsExist(names = []) {
  const list = Array.isArray(names) ? names.map(s => String(s || '').trim()).filter(Boolean) : [];
  for (const name of list) {
    try {
      await db.collection(name).limit(1).get();
    } catch (e) {
      if (e && e.message && e.message.includes('collection not exists')) {
        try { await db.createCollection(name); } catch (_) { void 0; }
      }
    }
  }
}

function normalizeErrorForLog(err) {
  const e = err || {}
  const out = {
    message: String(e.errMsg || e.message || e || ''),
    name: e.name ? String(e.name) : undefined,
    code: e.code != null ? String(e.code) : undefined,
    errCode: typeof e.errCode === 'number' ? e.errCode : undefined,
    stack: e.stack ? String(e.stack).slice(0, 4000) : undefined
  }
  return out
}

function isRetryableDbError(err) {
  const e = err || {}
  const msg = String(e.errMsg || e.message || e || '').toLowerCase()
  const errCode = typeof e.errCode === 'number' ? e.errCode : null
  if (errCode != null && [-1, -501000, -501001, -501002, -501003].includes(errCode)) return true
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('network') ||
    msg.includes('connection') ||
    msg.includes('too many requests') ||
    msg.includes('rate limit') ||
    msg.includes('request fail') ||
    msg.includes('server busy')
  )
}

async function retryAsync(fn, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? 2))
  const baseMs = Math.max(10, Number(options.baseMs ?? 80))
  const maxMs = Math.max(baseMs, Number(options.maxMs ?? 800))
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastErr = e
      if (attempt >= retries) break
      if (!isRetryableDbError(e)) break
      const wait = Math.min(maxMs, baseMs * (2 ** attempt)) + Math.floor(Math.random() * 40)
      await new Promise(resolve => setTimeout(resolve, wait))
    }
  }
  throw lastErr
}

async function acquireDistributedLock(lockId, ttlMs, owner) {
  const key = String(lockId || '').trim()
  const usedTtl = Math.max(1000, Number(ttlMs) || 0)
  const who = String(owner || '').trim() || `anon_${Date.now()}_${randomFixedDigits(4)}`
  if (!key) throw new Error('lockId不能为空')
  await ensureCloudCollectionsExist(['distributed_locks'])
  const lockDocId = (() => {
    if (/^[A-Za-z0-9_-]{1,80}$/.test(key)) return key
    const h = crypto.createHash('sha1').update(key).digest('hex')
    return `lock_${h.slice(0, 40)}`
  })()

  for (let attempt = 0; attempt < 80; attempt++) {
    const now = Date.now()
    try {
      await db.runTransaction(async (t) => {
        const ref = t.collection('distributed_locks').doc(lockDocId)
        let current = null
        try {
          const got = await ref.get()
          current = got && got.data ? got.data : null
        } catch (_) { void 0 }

        const expireAt = Number(current?.expireAt || 0)
        const lockedBy = String(current?.owner || '').trim()
        const locked = Number.isFinite(expireAt) && expireAt > now && lockedBy && lockedBy !== who
        if (locked) {
          throw new Error('LOCKED')
        }
        await ref.set({ data: { lockId: key, owner: who, expireAt: now + usedTtl, updatedAt: now } })
      })
      return { lockId: key, owner: who, docId: lockDocId }
    } catch (e) {
      const msg = String(e?.message || e || '')
      if (msg.includes('LOCKED')) {
        await new Promise(resolve => setTimeout(resolve, 30 + Math.floor(Math.random() * 70)))
        continue
      }
      throw e
    }
  }
  throw new Error('获取锁超时')
}

async function releaseDistributedLock(lockId, owner) {
  const key = String(lockId || '').trim()
  const who = String(owner || '').trim()
  if (!key) return
  const lockDocId = (() => {
    if (/^[A-Za-z0-9_-]{1,80}$/.test(key)) return key
    const h = crypto.createHash('sha1').update(key).digest('hex')
    return `lock_${h.slice(0, 40)}`
  })()
  try {
    await db.runTransaction(async (t) => {
      const ref = t.collection('distributed_locks').doc(lockDocId)
      let current = null
      try {
        const got = await ref.get()
        current = got && got.data ? got.data : null
      } catch (_) { void 0 }
      const lockedBy = String(current?.owner || '').trim()
      if (who && lockedBy && lockedBy !== who) return
      await ref.update({ data: { owner: '', expireAt: 0, updatedAt: Date.now() } })
    })
  } catch (_) { void 0 }
}

async function withDistributedLock(lockId, ttlMs, owner, fn) {
  const got = await acquireDistributedLock(lockId, ttlMs, owner)
  try {
    return await fn(got)
  } finally {
    await releaseDistributedLock(lockId, got.owner)
  }
}

async function orderNoTakenByOther(orderNo, options = {}) {
  const no = String(orderNo || '').trim();
  if (!no) return true;

  const selfId = String(options?.selfId || '').trim();
  const selfCollection = String(options?.selfCollection || '').trim();
  const collections = Array.isArray(options?.collections) && options.collections.length
    ? options.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];

  for (const name of collections) {
    try {
      const q = await db.collection(name).where(
        _.or([
          { orderNumber: no },
          { orderNo: no },
          { 'data.orderNumber': no },
          { 'data.orderNo': no }
        ])
      ).limit(20).get();
      const rows = Array.isArray(q?.data) ? q.data : [];
      for (const row of rows) {
        const id = String(row?._id || '').trim();
        if (!id) continue;
        if (selfId && id === selfId && selfCollection && name === selfCollection) continue;
        return true;
      }
    } catch (_) { void 0; }
  }

  try {
    const r = await db.collection('order_number_reservations').where({ orderNumber: no }).limit(1).get();
    if (r?.data?.length) return true;
  } catch (_) { void 0; }

  return false;
}

async function applyOrderNoChangeTx(input = {}) {
  const jobId = String(input?.jobId || '').trim();
  const collectionName = String(input?.collectionName || '').trim();
  const docId = String(input?.docId || '').trim();
  const newOrderNo = String(input?.newOrderNo || '').trim();
  const operator = String(input?.operator || '').trim() || 'system';
  const timestamp = Number(input?.timestamp) || Date.now();
  const dryRun = Boolean(input?.dryRun);
  const forceRebindRegistry = Boolean(input?.forceRebindRegistry);

  if (!jobId || !collectionName || !docId || !newOrderNo) {
    throw new Error('applyOrderNoChangeTx参数无效');
  }

  const backupId = `b_${jobId}_${collectionName}_${docId}`;
  const logId = `l_${jobId}_${collectionName}_${docId}_${timestamp}`;

  if (dryRun) {
    return { success: true, dryRun: true };
  }

  return await db.runTransaction(async (t) => {
    const orderRef = t.collection(collectionName).doc(docId);
    const backupRef = t.collection('order_no_fix_backups').doc(backupId);
    const logRef = t.collection('order_no_change_logs').doc(logId);
    const regRef = t.collection('order_no_registry').doc(newOrderNo);

    const orderSnap = await orderRef.get();
    const current = orderSnap && orderSnap.data ? orderSnap.data : null;
    if (!current) throw new Error('订单不存在');

    const oldOrderNo = String(current?.orderNo || current?.orderNumber || '').trim();
    const oldQrCodeUrl = String(current?.qrCodeUrl || '').trim();

    const regExisting = await regRef.get().catch(() => null);
    if (regExisting && regExisting.data) {
      const boundDocId = String(regExisting.data?.docId || '').trim();
      const boundCol = String(regExisting.data?.collection || '').trim();
      if (!(boundDocId === docId && boundCol === collectionName)) {
        if (!forceRebindRegistry) throw new Error('ORDER_NO_REGISTRY_CONFLICT');
      }
    }

    const backupExisting = await backupRef.get().catch(() => null);
    if (!(backupExisting && backupExisting.data)) {
      await backupRef.set({
        data: {
          jobId,
          collection: collectionName,
          docId,
          createdAt: timestamp,
          operator,
          before: {
            orderNo: String(current?.orderNo || '').trim(),
            orderNumber: String(current?.orderNumber || '').trim(),
            qrCodeUrl: oldQrCodeUrl,
            originalOrderNumber: String(current?.originalOrderNumber || current?.originalOrderNo || '').trim(),
            oldQrCodeUrl: String(current?.oldQrCodeUrl || '').trim(),
            isDuplicateFixed: Boolean(current?.isDuplicateFixed),
            fixedAt: current?.fixedAt ?? null
          }
        }
      });
    }

    await regRef.set({
      data: {
        _id: newOrderNo,
        jobId,
        collection: collectionName,
        docId,
        createdAt: timestamp,
        operator
      }
    });

    const nested = (current && current.data && typeof current.data === 'object') ? current.data : null;
    const updateData = {
      orderNo: newOrderNo,
      orderNumber: newOrderNo,
      isDuplicateFixed: true,
      originalOrderNumber: oldOrderNo || String(current?.originalOrderNumber || current?.originalOrderNo || '').trim(),
      fixedAt: timestamp,
      fixedBy: operator
    };
    if (nested) {
      updateData.data = { ...(nested || {}), orderNo: newOrderNo, orderNumber: newOrderNo };
    }

    const newQrCodeUrl = buildQrServerUrl(
      buildOrderQrPayload({ orderId: docId, orderNo: newOrderNo }),
      220
    );
    updateData.qrCodeUrl = newQrCodeUrl;
    updateData.oldQrCodeUrl = oldQrCodeUrl;

    await orderRef.update({ data: updateData });

    await logRef.set({
      data: {
        jobId,
        collection: collectionName,
        docId,
        oldOrderNo,
        newOrderNo,
        operator,
        createdAt: timestamp
      }
    });

    return { success: true, oldOrderNo, newOrderNo };
  });
}

async function computeMaxSeqForDate(dateStr, options = {}) {
  const seqLength = 3;
  const collections = Array.isArray(options?.collections) && options.collections.length
    ? options.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];

  const parseSeq = (no) => {
    const s = String(no || '').trim();
    const m = s.match(new RegExp(`^QXDD${dateStr}(\\d{${seqLength},})$`, 'i'));
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  let lastSeq = 0;
  const re = db.RegExp({ regexp: `^QXDD${dateStr}\\d{${seqLength},}$`, options: 'i' });
  for (const name of collections) {
    try {
      const latest1 = await db.collection(name).where({ orderNumber: re }).orderBy('orderNumber', 'desc').limit(1).get();
      if (latest1?.data?.length) lastSeq = Math.max(lastSeq, parseSeq(latest1.data[0]?.orderNumber));
    } catch (_) { void 0; }
    try {
      const latest2 = await db.collection(name).where({ orderNo: re }).orderBy('orderNo', 'desc').limit(1).get();
      if (latest2?.data?.length) lastSeq = Math.max(lastSeq, parseSeq(latest2.data[0]?.orderNo));
    } catch (_) { void 0; }
  }

  try {
    const latest3 = await db.collection('order_number_reservations').where({ date: dateStr }).orderBy('number', 'desc').limit(1).get();
    if (latest3?.data?.length) {
      const n = Number(latest3.data[0]?.number || 0);
      if (Number.isFinite(n) && n > 0) lastSeq = Math.max(lastSeq, n);
      lastSeq = Math.max(lastSeq, parseSeq(latest3.data[0]?.orderNumber || latest3.data[0]?.orderNo || ''));
    }
  } catch (_) { void 0; }

  return lastSeq;
}

async function isOrderNumberTaken(orderNumber, options = {}) {
  const no = String(orderNumber || '').trim();
  if (!no) return true;

  const collections = Array.isArray(options?.collections) && options.collections.length
    ? options.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];

  try {
    const reg = await db.collection('order_no_registry').doc(no).get().catch(() => null);
    if (reg && reg.data) return true;
  } catch (_) { void 0; }

  for (const name of collections) {
    try {
      const [a, b] = await Promise.all([
        db.collection(name).where({ orderNumber: no }).limit(1).get(),
        db.collection(name).where({ orderNo: no }).limit(1).get()
      ]);
      const exists =
        (a?.data && a.data.length > 0) ||
        (b?.data && b.data.length > 0);
      if (exists) return true;
    } catch (_) { void 0; }
  }

  try {
    const tmp = await db.collection('orders_tmp').where(_.or([{ orderNo: no }, { orderNumber: no }])).limit(1).get();
    if (tmp?.data?.length) return true;
  } catch (_) { void 0; }

  try {
    const r = await db.collection('order_number_reservations').where({ orderNumber: no }).limit(1).get();
    if (r?.data?.length) return true;
  } catch (_) { void 0; }

  return false;
}

async function generateOrderNumberByDate(dateStr, options = {}) {
  const keyDate = /^\d{8}$/.test(String(dateStr || '').trim()) ? String(dateStr || '').trim() : formatDateKeyFromDate(new Date());
  const key = `order_no_daily:${keyDate}`;
  const seqLength = 3;
  const maxRetries = 20;
  const collections = Array.isArray(options?.collections) && options.collections.length
    ? options.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];

  const cache = options?.seedCache && typeof options.seedCache === 'object' ? options.seedCache : null;
  let seedLastSeq = cache && cache.has(keyDate) ? Number(cache.get(keyDate)) : NaN;
  if (!Number.isFinite(seedLastSeq) || seedLastSeq < 0) {
    seedLastSeq = await computeMaxSeqForDate(keyDate, { collections });
    if (cache) cache.set(keyDate, seedLastSeq);
  }

  const allocateNextSeq = async () => {
    const tx = await db.runTransaction(async (t) => {
      const docRef = t.collection('counters').doc(key);
      let current = null;
      try {
        const got = await docRef.get();
        current = got && got.data ? got.data : null;
      } catch (_) { void 0; }
      const currentSeq = Number(current?.seq);
      const baseSeq = Number.isFinite(currentSeq) ? currentSeq : (Number.isFinite(seedLastSeq) ? seedLastSeq : 0);
      const nextSeq = baseSeq + 1;
      if (current) {
        await docRef.update({ data: { seq: nextSeq } });
      } else {
        await docRef.set({ data: { seq: nextSeq } });
      }
      return nextSeq;
    });
    return Number(tx);
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const seqValue = await allocateNextSeq();
    const seqStr = String(seqValue).padStart(seqLength, '0');
    const orderNumber = `QXDD${keyDate}${seqStr}`;

    const exists = await isOrderNumberTaken(orderNumber, { collections });
    if (!exists) {
      console.log(`[OrderNumber] Generated unique order number: ${orderNumber} (attempt ${attempt + 1})`);
      if (cache) cache.set(keyDate, Math.max(Number(cache.get(keyDate) || 0), seqValue));
      return orderNumber;
    }
    console.warn(`[OrderNumber] Duplicate detected: ${orderNumber}, retrying... (attempt ${attempt + 1}/${maxRetries})`);
  }

  throw new Error(`Failed to generate unique order number after ${maxRetries} attempts`);
}

async function generateOrderNumberDaily() {
  const dateStr = formatDateKeyFromDate(new Date());
  return await generateOrderNumberByDate(dateStr);
}

async function getOrderNumberMaxSeqAction(params = {}) {
  const date = String(params?.date || params?.dateKey || '').trim();
  const prefix = String(params?.prefix || 'QXDD').trim() || 'QXDD';
  if (!/^\d{8}$/.test(date)) {
    throw new Error('date参数无效');
  }

  const re = db.RegExp({ regexp: `^${prefix}${date}\\d{3,}$`, options: 'i' });

  const parseSeq = (no) => {
    const s = String(no || '').trim();
    const m = s.match(new RegExp(`^${prefix}${date}(\\d{3,})$`, 'i'));
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  let maxSeq = 0;
  let maxOrderNumber = '';

  try {
    const latest1 = await db.collection('orders').where({ orderNumber: re }).orderBy('orderNumber', 'desc').limit(1).get();
    if (latest1?.data?.length) {
      const no = latest1.data[0]?.orderNumber || '';
      const seq = parseSeq(no);
      if (seq > maxSeq) {
        maxSeq = seq;
        maxOrderNumber = String(no || '').trim();
      }
    }
  } catch (_) { void 0; }

  try {
    const latest2 = await db.collection('orders').where({ orderNo: re }).orderBy('orderNo', 'desc').limit(1).get();
    if (latest2?.data?.length) {
      const no = latest2.data[0]?.orderNo || '';
      const seq = parseSeq(no);
      if (seq > maxSeq) {
        maxSeq = seq;
        maxOrderNumber = String(no || '').trim();
      }
    }
  } catch (_) { void 0; }

  try {
    const latest3 = await db.collection('order_number_reservations').where({ date }).orderBy('number', 'desc').limit(1).get();
    if (latest3?.data?.length) {
      const no = latest3.data[0]?.orderNumber || latest3.data[0]?.orderNo || '';
      const seq = parseSeq(no);
      if (seq > maxSeq) {
        maxSeq = seq;
        maxOrderNumber = String(no || '').trim();
      }
    }
  } catch (_) { void 0; }

  return {
    success: true,
    data: { date, prefix, maxSeq, maxOrderNumber }
  };
}

async function fixDuplicateOrders(params = {}) {
  const collections = Array.isArray(params?.collections) && params.collections.length
    ? params.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];
  const dryRun = Boolean(params?.dryRun);
  const pageSize = Math.min(Math.max(Number(params?.pageSize || 200) || 200, 1), 500);
  const maxDocs = Math.min(Math.max(Number(params?.maxDocs || 50000) || 50000, 1), 200000);
  const operator = String(params?.operator || params?.operatorId || params?.userId || '').trim() || 'system';
  const jobId = String(params?.jobId || '').trim() || `job_${Date.now()}_${randomFixedDigits(4)}`;
  const targetOrderNoRaw = String(params?.targetOrderNo || params?.targetOrderNumber || params?.orderNo || params?.orderNumber || '').trim()
  const targetBase = targetOrderNoRaw ? stripDupSuffixFromOrderNo(targetOrderNoRaw) : ''
  const keepId = String(params?.keepId || params?.keepDocId || '').trim()
  const keepCollection = String(params?.keepCollection || '').trim()

  await ensureCloudCollectionsExist(['order_no_fix_backups', 'order_no_change_logs', 'order_no_registry']);

  const report = {
    jobId,
    dryRun,
    operator,
    scannedCollections: collections,
    scannedDocs: 0,
    duplicateGroups: 0,
    duplicateDocs: 0,
    dupSuffixDocs: 0,
    fixed: 0,
    details: []
  };

  const fixedKey = new Set();

  const safeGetCanonical = (doc) => {
    const nested = (doc && doc.data && typeof doc.data === 'object') ? doc.data : null;
    const aNo = String(nested?.orderNo || '').trim();
    const aNum = String(nested?.orderNumber || '').trim();
    const bNum = String(doc?.orderNumber || '').trim();
    const cNo = String(doc?.orderNo || '').trim();
    const validPattern = /^(QXDD|QXBZ)\d{7,16}$/i
    const aNoOk = validPattern.test(aNo)
    const aNumOk = validPattern.test(aNum)
    const bNumOk = validPattern.test(bNum)
    const cNoOk = validPattern.test(cNo)
    if (cNoOk && bNumOk && cNo !== bNum) return cNo
    if (aNoOk && aNumOk && aNo !== aNum) return aNo
    return aNo || aNum || bNum || cNo;
  };

  console.log(`[FixDuplicate] Starting cleanup jobId=${jobId}, dryRun=${dryRun}`);

  for (const collectionName of collections) {
    let collectionExists = true;
    try {
      await db.collection(collectionName).limit(1).get();
    } catch (e) {
      if (e && e.message && e.message.includes('collection not exists')) collectionExists = false;
    }
    if (!collectionExists) continue;

    const groups = new Map();
    const dupSuffixSingles = [];

    let scanned = 0;
    let lastId = '';
    for (let round = 0; round < 100000; round++) {
      if (scanned >= maxDocs) break;
      let q = db.collection(collectionName);
      if (lastId) q = q.where({ _id: _.gt(lastId) });
      q = q.orderBy('_id', 'asc').limit(pageSize);
      const res = await q.get();
      const docs = res && Array.isArray(res.data) ? res.data : [];
      if (!docs.length) break;

      scanned += docs.length;
      report.scannedDocs += docs.length;
      lastId = String(docs[docs.length - 1]?._id || '').trim() || lastId;

      for (const doc of docs) {
        const id = String(doc?._id || '').trim();
        if (!id) continue;

        const canonical = safeGetCanonical(doc);
        if (!canonical) continue;

        const nested = (doc && doc.data && typeof doc.data === 'object') ? doc.data : null;
        const rawOrderNo = String(doc?.orderNo || nested?.orderNo || '').trim();
        const rawOrderNumber = String(doc?.orderNumber || nested?.orderNumber || '').trim();
        const mismatch = Boolean(rawOrderNo && rawOrderNumber && rawOrderNo !== rawOrderNumber);

        const base = stripDupSuffixFromOrderNo(canonical);
        if (!base) continue;

        const createdAt = Number(doc?.createdAt || doc?.data?.createdAt || doc?._createTime || doc?.createTime || doc?.data?.createTime || 0) || 0;
        const info = {
          _id: id,
          collection: collectionName,
          canonical,
          base,
          createdAt,
          hasDupSuffix: /_dup_/i.test(canonical),
          orderNo: rawOrderNo,
          orderNumber: rawOrderNumber,
          mismatch
        };

        const arr = groups.get(base) || [];
        arr.push(info);
        groups.set(base, arr);

        if (info.hasDupSuffix) dupSuffixSingles.push(info);
      }
      if (docs.length < pageSize) break;
    }

    for (const [, arr] of groups.entries()) {
      if (!Array.isArray(arr) || arr.length <= 1) continue;
      if (targetBase && String(arr[0]?.base || '').trim() !== targetBase) continue;

      report.duplicateGroups += 1;
      report.duplicateDocs += Math.max(0, arr.length - 1);

      const sorted = arr.slice().sort((a, b) => {
        const aNoDup = a.hasDupSuffix ? 0 : 1;
        const bNoDup = b.hasDupSuffix ? 0 : 1;
        if (aNoDup !== bNoDup) return bNoDup - aNoDup;
        const at = Number(a.createdAt || 0);
        const bt = Number(b.createdAt || 0);
        if (at !== bt) return at - bt;
        return String(a._id).localeCompare(String(b._id));
      });

      let keep = sorted[0];
      if (keepId) {
        const forced = sorted.find(x => String(x?._id || '').trim() === keepId && (!keepCollection || String(x?.collection || '') === keepCollection))
        if (forced) keep = forced
      }
      const toFix = sorted.filter(x => String(x?._id || '').trim() !== String(keep?._id || '').trim());

      const keepKey = `${collectionName}::${keep._id}`;
      if (!fixedKey.has(keepKey)) {
        const keepCanonical = String(keep.canonical || '').trim();
        const keepBase = String(keep.base || '').trim();
        const needNormalize = keepBase && keepCanonical !== keepBase;
        const needAlign = keepBase && keep.mismatch === true;
        if (needNormalize) {
          const taken = await orderNoTakenByOther(keepBase, { collections, selfId: keep._id, selfCollection: collectionName });
          if (taken) {
            report.details.push({ collection: collectionName, id: keep._id, oldOrderNo: keepCanonical, error: '保留单号去后缀后与其他订单冲突，保留原值' });
          } else {
            try {
              await applyOrderNoChangeTx({
                jobId,
                collectionName,
                docId: keep._id,
                newOrderNo: keepBase,
                operator,
                timestamp: Date.now(),
                dryRun
              });
              fixedKey.add(keepKey);
              report.fixed += 1;
              report.details.push({ collection: collectionName, id: keep._id, oldOrderNo: keepCanonical, newOrderNo: keepBase, note: '归一化保留单号' });
            } catch (e) {
              report.details.push({ collection: collectionName, id: keep._id, oldOrderNo: keepCanonical, error: e.message || String(e) });
            }
          }
        }
        if (needAlign) {
          try {
            await applyOrderNoChangeTx({
              jobId,
              collectionName,
              docId: keep._id,
              newOrderNo: keepBase,
              operator,
              timestamp: Date.now(),
              dryRun,
              forceRebindRegistry: true
            });
            fixedKey.add(keepKey);
            report.fixed += 1;
            report.details.push({ collection: collectionName, id: keep._id, oldOrderNo: keep.orderNumber || keepCanonical, newOrderNo: keepBase, note: '对齐orderNumber与orderNo' });
          } catch (e) {
            report.details.push({ collection: collectionName, id: keep._id, oldOrderNo: keep.orderNumber || keepCanonical, error: e.message || String(e) });
          }
        }
        if (!dryRun && keepBase && keepCanonical === keepBase) {
          try {
            await db.runTransaction(async (t) => {
              const ref = t.collection('order_no_registry').doc(keepBase)
              await ref.set({
                data: {
                  _id: keepBase,
                  jobId,
                  collection: collectionName,
                  docId: keep._id,
                  createdAt: Date.now(),
                  operator
                }
              })
            })
          } catch (_) { void 0 }
        }
      }

      for (const doc of toFix) {
        const k = `${collectionName}::${doc._id}`;
        if (fixedKey.has(k)) continue;

        const base = String(doc.base || '').trim();
        const oldNo = String(doc.canonical || '').trim();
        if (!base) continue;

        let newNo = '';
        const m = base.match(/^(QXDD)(\d{8})\d{3,}$/i)
        if (m && m[2]) {
          for (let attempt = 0; attempt < 40; attempt++) {
            const candidate = await generateOrderNumberByDate(m[2], { collections: ['orders', 'orders_tmp', 'purchase_orders', 'production'] })
            const taken = await orderNoTakenByOther(candidate, { collections, selfId: doc._id, selfCollection: collectionName });
            if (!taken) { newNo = candidate; break; }
          }
        } else {
          for (let attempt = 0; attempt < 40; attempt++) {
            const candidate = buildDedupOrderNo(base, Date.now(), randomFixedDigits(4));
            const taken = await orderNoTakenByOther(candidate, { collections, selfId: doc._id, selfCollection: collectionName });
            if (!taken) { newNo = candidate; break; }
          }
        }

        if (!newNo) {
          report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, error: '无法生成唯一订单号' });
          continue;
        }

        try {
          await applyOrderNoChangeTx({
            jobId,
            collectionName,
            docId: doc._id,
            newOrderNo: newNo,
            operator,
            timestamp: Date.now(),
            dryRun
          });
          fixedKey.add(k);
          report.fixed += 1;
          report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, newOrderNo: newNo });
        } catch (e) {
          const msg = e && e.message ? e.message : String(e);
          if (msg === 'ORDER_NO_REGISTRY_CONFLICT') {
            report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, error: '订单号注册表冲突，请重试' });
          } else {
            report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, error: msg });
          }
        }
      }
    }

    for (const doc of dupSuffixSingles) {
      if (!doc?.hasDupSuffix) continue;
      const k = `${collectionName}::${doc._id}`;
      if (fixedKey.has(k)) continue;

      report.dupSuffixDocs += 1;

      const oldNo = String(doc.canonical || '').trim();
      const base = String(doc.base || '').trim();
      if (!base) continue;

      let newNo = '';
      const baseTaken = await orderNoTakenByOther(base, { collections, selfId: doc._id, selfCollection: collectionName });
      if (!baseTaken) {
        newNo = base;
      } else {
        for (let attempt = 0; attempt < 40; attempt++) {
          const candidate = buildDedupOrderNo(base, Date.now(), randomFixedDigits(4));
          const taken = await orderNoTakenByOther(candidate, { collections, selfId: doc._id, selfCollection: collectionName });
          if (!taken) {
            newNo = candidate;
            break;
          }
        }
      }

      if (!newNo) {
        report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, error: '无法生成唯一订单号' });
        continue;
      }

      try {
        await applyOrderNoChangeTx({
          jobId,
          collectionName,
          docId: doc._id,
          newOrderNo: newNo,
          operator,
          timestamp: Date.now(),
          dryRun
        });
        fixedKey.add(k);
        report.fixed += 1;
        report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, newOrderNo: newNo, note: '去除_dup后缀' });
      } catch (e) {
        report.details.push({ collection: collectionName, id: doc._id, oldOrderNo: oldNo, error: e.message || String(e) });
      }
    }
  }

  const verify = await verifyOrderNumberUniqueness({ collections }).catch(() => ({ success: false }));
  const dupGroups = Number(verify?.data?.duplicateGroups || 0);
  const dupSuffixLeft = Number(verify?.data?.dupSuffixDocs || 0);

  const msgParts = [
    `作业${jobId}`,
    `修复${report.fixed}条`,
    `重复组${report.duplicateGroups}（涉及重复记录${report.duplicateDocs}条）`,
    `含_dup记录${report.dupSuffixDocs}条`,
    `唯一性校验重复组=${dupGroups}`,
    `剩余_dup=${dupSuffixLeft}`
  ];

  return {
    success: true,
    data: report,
    jobId,
    message: msgParts.join('，')
  };
}

async function verifyOrderNumberUniqueness(params = {}) {
  const collections = Array.isArray(params?.collections) && params.collections.length
    ? params.collections.map(s => String(s || '').trim()).filter(Boolean)
    : ['orders', 'purchase_orders', 'production'];

  const pageSize = Math.min(Math.max(Number(params?.pageSize || 500) || 500, 1), 500);
  const maxDocs = Math.min(Math.max(Number(params?.maxDocs || 500000) || 500000, 1), 2000000);

  const result = {
    collections,
    scannedDocs: 0,
    duplicateGroups: 0,
    duplicateDocs: 0,
    dupSuffixDocs: 0,
    byCollection: {},
    samples: {}
  };

  const safeGetCanonical = (doc) => {
    const a = String(doc?.orderNumber || '').trim();
    const b = String(doc?.orderNo || '').trim();
    const validPattern = /^(QXDD|QXBZ)\d{7,16}$/i
    if (validPattern.test(b) && validPattern.test(a) && a && b && a !== b) return b
    return a || b;
  };

  for (const collectionName of collections) {
    let collectionExists = true;
    try {
      await db.collection(collectionName).limit(1).get();
    } catch (e) {
      if (e && e.message && e.message.includes('collection not exists')) collectionExists = false;
    }
    if (!collectionExists) continue;

    const counters = new Map();
    const dupSuffix = [];
    let scanned = 0;
    let lastId = '';

    for (let round = 0; round < 100000; round++) {
      if (scanned >= maxDocs) break;
      let q = db.collection(collectionName);
      if (lastId) q = q.where({ _id: _.gt(lastId) });
      q = q.orderBy('_id', 'asc').limit(pageSize);
      const res = await q.get();
      const docs = res && Array.isArray(res.data) ? res.data : [];
      if (!docs.length) break;

      scanned += docs.length;
      result.scannedDocs += docs.length;
      lastId = String(docs[docs.length - 1]?._id || '').trim() || lastId;

      for (const doc of docs) {
        const id = String(doc?._id || '').trim();
        if (!id) continue;
        const canonical = safeGetCanonical(doc);
        if (!canonical) continue;

        if (/_dup_/i.test(canonical)) {
          result.dupSuffixDocs += 1;
          if (dupSuffix.length < 3) {
            dupSuffix.push({ _id: id, orderNo: doc?.orderNo, orderNumber: doc?.orderNumber });
          }
        }

        const hit = counters.get(canonical);
        if (!hit) {
          counters.set(canonical, { count: 1, ids: [id] });
        } else {
          hit.count += 1;
          if (hit.ids.length < 3) hit.ids.push(id);
        }
      }

      if (docs.length < pageSize) break;
    }

    let groups = 0;
    let dupDocs = 0;
    const dupSamples = [];
    for (const [no, v] of counters.entries()) {
      if (!v || v.count <= 1) continue;
      groups += 1;
      dupDocs += (v.count - 1);
      if (dupSamples.length < 3) dupSamples.push({ orderNo: no, count: v.count, ids: v.ids });
    }

    result.duplicateGroups += groups;
    result.duplicateDocs += dupDocs;
    result.byCollection[collectionName] = { scanned, duplicateGroups: groups, duplicateDocs: dupDocs };

    if (dupSuffix.length || dupSamples.length) {
      result.samples[collectionName] = {};
      if (dupSuffix.length) result.samples[collectionName].dupSuffix = dupSuffix;
      if (dupSamples.length) result.samples[collectionName].duplicate = dupSamples;
    }
  }

  return { success: true, data: result, message: '校验完成' };
}

async function rollbackOrderNumberFix(params = {}) {
  const jobId = String(params?.jobId || '').trim();
  if (!jobId) return { success: false, message: '缺少jobId' };

  const dryRun = Boolean(params?.dryRun);
  const pageSize = Math.min(Math.max(Number(params?.pageSize || 200) || 200, 1), 500);

  await ensureCloudCollectionsExist(['order_no_fix_backups', 'order_no_change_logs', 'order_no_registry']);

  let rolledBack = 0;
  const errors = [];

  let lastId = '';
  for (let round = 0; round < 100000; round++) {
    const cond = lastId
      ? _.and([{ jobId }, { _id: _.gt(lastId) }])
      : { jobId };
    let q = db.collection('order_no_fix_backups').where(cond);
    q = q.orderBy('_id', 'asc').limit(pageSize);
    const res = await q.get();
    const rows = Array.isArray(res?.data) ? res.data : [];
    if (!rows.length) break;
    lastId = String(rows[rows.length - 1]?._id || '').trim() || lastId;

    for (const rec of rows) {
      const collectionName = String(rec?.collection || '').trim();
      const docId = String(rec?.docId || '').trim();
      const before = rec?.before && typeof rec.before === 'object' ? rec.before : null;
      if (!collectionName || !docId || !before) continue;

      if (dryRun) {
        rolledBack += 1;
        continue;
      }

      try {
        await db.collection(collectionName).doc(docId).update({
          data: {
            orderNo: String(before.orderNo || '').trim(),
            orderNumber: String(before.orderNumber || '').trim(),
            qrCodeUrl: String(before.qrCodeUrl || '').trim(),
            oldQrCodeUrl: String(before.oldQrCodeUrl || '').trim(),
            originalOrderNumber: String(before.originalOrderNumber || '').trim(),
            isDuplicateFixed: Boolean(before.isDuplicateFixed),
            fixedAt: before.fixedAt ?? null,
            rolledBackAt: Date.now(),
            rolledBackJobId: jobId
          }
        });
        rolledBack += 1;
      } catch (e) {
        errors.push({ collection: collectionName, id: docId, error: e?.message || String(e) });
      }
    }

    if (rows.length < pageSize) break;
  }

  if (!dryRun) {
    try {
      const logs = await db.collection('order_no_change_logs').where({ jobId }).limit(2000).get();
      const entries = Array.isArray(logs?.data) ? logs.data : [];
      for (const l of entries) {
        const newNo = String(l?.newOrderNo || '').trim();
        if (!newNo) continue;
        await db.collection('order_no_registry').doc(newNo).remove().catch(() => null);
      }
    } catch (_) { void 0; }
  }

  return {
    success: errors.length === 0,
    data: { jobId, dryRun, rolledBack, errors },
    message: dryRun ? `回滚预演完成，预计回滚${rolledBack}条` : `回滚完成，已回滚${rolledBack}条`
  };
}

async function reserveOrderNumber(wxContext) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateKey = `${year}${month}${day}`;
  const source = wxContext && wxContext.OPENID ? 'wechat' : 'pc';

  try {
    const released = await db.collection('order_number_reservations')
      .where({ date: dateKey, status: 'released' })
      .orderBy('number', 'asc')
      .limit(1)
      .get();
    if (released && released.data && released.data.length) {
      const r = released.data[0];
      await db.collection('order_number_reservations').doc(r._id).update({
        data: { status: 'reserved', reservedBy: wxContext.OPENID || 'pc', updatedAt: Date.now() }
      });
      return { success: true, data: { orderNumber: r.orderNumber, reservationId: r._id } };
    }
  } catch (e) {
    if (e && e.message && e.message.includes('collection not exists')) {
      try { await db.createCollection('order_number_reservations'); } catch (_) { }
    }
  }

  const orderNumber = await generateOrderNumberDaily();
  const num = Number(orderNumber.slice(-3));
  const reservation = {
    _id: `res_${uuidv4()}`,
    year,
    date: dateKey,
    orderNumber,
    number: num,
    status: 'reserved',
    source,
    reservedBy: wxContext.OPENID || 'pc',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  try {
    await db.collection('order_number_reservations').add({ data: reservation });
    return { success: true, data: { orderNumber, reservationId: reservation._id } };
  } catch (e) {
    if (e && e.message && e.message.includes('collection not exists')) {
      try {
        await db.createCollection('order_number_reservations');
        await db.collection('order_number_reservations').add({ data: reservation });
        return { success: true, data: { orderNumber, reservationId: reservation._id } };
      } catch (_) { }
    }
    return { success: true, data: { orderNumber, reservationId: '' } };
  }
}

// 释放预约的订单号（取消时调用）
async function releaseOrderNumber(data, wxContext) {
  const { reservationId, orderNumber } = data || {};
  if (!reservationId && !orderNumber) return { success: false, message: '缺少reservationId或orderNumber' };
  // 优先：统一后端服务释放
  try {
    const url = `${BACKEND_URL}/api/order-numbers/release`;
    const res = await axios.post(url, { reservationId, orderNo: orderNumber });
    const d = res && res.data && res.data.data ? res.data.data : null;
    if (d && (d.orderNo || orderNumber)) {
      return { success: true, data: { orderNumber: d.orderNo || orderNumber, reservationId: d.reservationId } };
    }
  } catch (e) { /* fallback to cloud collection */ }

  try {
    const db = cloud.database();
    if (reservationId) {
      await db.collection('order_number_reservations').doc(reservationId).update({
        data: { status: 'released', releasedAt: Date.now() }
      });
      return { success: true, message: '已释放' };
    } else if (orderNumber) {
      const rec = await db.collection('order_number_reservations').where({ orderNumber }).limit(1).get();
      if (rec && rec.data && rec.data.length) {
        await db.collection('order_number_reservations').doc(rec.data[0]._id).update({
          data: { status: 'released', releasedAt: Date.now() }
        });
        return { success: true, message: '已释放' };
      }
    }
  } catch (_) { }
  return { success: true, message: '释放操作完成' };
}

// 数据验证函数
function validateOrderData(order) {
  const isMeaningfulText = (v) => {
    const s = String(v ?? '').trim();
    if (!s) return false;
    return !['-', '—', '--', '---', '暂无', '无'].includes(s);
  };
  const orderNumber = String(order?.orderNumber || order?.orderNo || '').trim();
  if (!orderNumber) throw new Error('订单号不能为空');

  const orderType = String(order?.orderType || '').toLowerCase();
  const source = String(order?.source || '').toLowerCase();
  const purchaseCategory = String(order?.purchaseCategory || order?.category || '').toLowerCase();

  const supplierName = String(order?.supplierName || '').trim();
  const customerName = String(order?.customerName || '').trim();
  const productName = String(order?.productName || '').trim();
  const goodsName = String(order?.goodsName || order?.productTitle || '').trim();

  const items = Array.isArray(order?.items) ? order.items : [];
  const itemsQty = items.reduce((s, it) => s + (Number(it?.quantity) || 0), 0);
  const qty = Number(order?.quantity ?? (items.length ? itemsQty : undefined));
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('数量必须大于0');

  const isPurchase =
    orderType === 'purchase' ||
    source === 'purchased' ||
    Boolean(purchaseCategory);

  if (isPurchase) {
    if (!isMeaningfulText(supplierName)) throw new Error('供应商不能为空');
    if (!isMeaningfulText(goodsName) && !isMeaningfulText(productName)) throw new Error('商品名称不能为空');
    return;
  }

  if (!isMeaningfulText(customerName)) throw new Error('客户不能为空');
  if (!isMeaningfulText(productName) && !isMeaningfulText(goodsName)) throw new Error('产品不能为空');
}

async function ensureProductCategoryValid(productName, wxContext) {
  const name = String(productName || '').trim()
  if (!name) return
  await ensureCloudCollectionsExist(['product_categories'])
  const found = await db.collection('product_categories').where({ name }).limit(1).get().catch(() => null)
  const row = found && Array.isArray(found.data) && found.data.length ? found.data[0] : null
  if (row) {
    const disabled =
      row.isDeleted === true ||
      row.deleted === true ||
      Boolean(row.deletedAt || row.removedAt) ||
      String(row.status || '').toLowerCase() === 'disabled' ||
      String(row.status || '').toLowerCase() === 'inactive'
    if (disabled) throw new Error('产品类别已下架')
    return
  }
  const now = Date.now()
  const actor = wxContext && wxContext.OPENID ? wxContext.OPENID : 'system'
  const doc = { _id: uuidv4(), name, status: 'active', createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor }
  await db.collection('product_categories').add({ data: doc }).catch(() => null)
}

function validateCustomerData(customer) {
  console.log('[ERP-API] validateCustomerData called from:', new Error().stack);
  if (!customer.companyName) {
    throw new Error('客户名称不能为空');
  }
}

function validateProductData(product) {
  if (!product.name) {
    throw new Error('产品名称不能为空');
  }
  if (!product.sku) {
    throw new Error('产品SKU不能为空');
  }
  if (!product.price || product.price <= 0) {
    throw new Error('产品价格必须大于0');
  }
}

// 记录操作日志
async function logOperation(operation, collection, recordId, data, userId) {
  try {
    await db.collection('operation_logs').add({
      data: {
        operation,
        collection,
        recordId,
        data,
        userId,
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('记录操作日志失败:', error);
  }
}

/**
 * 获取采购订单列表（仅返回 purchase_orders 集合）
 */
async function getPurchaseOrders(params = {}) {
  const parseBool = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    return fallback;
  };

  const { page = 1, limit = 20, status, supplierId, dateRange, category, withTotal, withProducts, compact, debug } = params;
  const shouldCountTotal = parseBool(withTotal, true);
  const shouldEnrichProducts = parseBool(withProducts, true);
  const shouldCompact = parseBool(compact, false);
  const shouldDebug = parseBool(debug, false);
  const skip = (page - 1) * limit;

  const buildQuery = (collectionName) => {
    let query = db.collection(collectionName);
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
    if (status) query = query.where({ status });
    if (supplierId) query = query.where({ supplierId });
    if (dateRange && dateRange.start && dateRange.end) {
      query = query.where({ createdAt: _.gte(dateRange.start).and(_.lte(dateRange.end)) });
    }
    return query;
  };

  const take = skip + limit;
  // 快速路径：直接从 orders 集合按采购单条件分页，优先返回
  try {
    const fastRes = await (async () => {
      const orderFields = ['createdAt', '_createTime', 'createTime', 'updatedAt', 'updateTime'];
      for (const f of orderFields) {
        try {
          const r = await buildQuery('orders').orderBy(f, 'desc').skip(skip).limit(limit).get();
          if (r && Array.isArray(r.data)) return r;
        } catch (_) { void 0; }
      }
      try {
        const r = await buildQuery('orders').skip(skip).limit(limit).get();
        if (r && Array.isArray(r.data)) return r;
      } catch (_) { void 0; }
      return { data: [] };
    })();
    const fastRows = Array.isArray(fastRes.data) ? fastRes.data : [];
    if (fastRows.length >= limit || page > 1) {
      const orders = fastRows;
      const productIds = shouldEnrichProducts
        ? [...new Set(orders.map(o => o.productId).filter(id => id && typeof id === 'string'))]
        : [];
      let productMap = {};
      if (productIds.length > 0) {
        try {
          const productsRes = await db.collection('products').where({ _id: _.in(productIds) }).limit(100).get();
          productsRes.data.forEach(p => { productMap[p._id] = p; });
        } catch (_) { void 0; }
      }
      const enrichedOrders = orders.map(o => {
        const product = productMap[o.productId];
        const canonicalOrderNo = o && (o.orderNo || o.orderNumber) ? (o.orderNo || o.orderNumber) : '';
        const derivedQrCodeUrl = canonicalOrderNo
          ? buildQrServerUrl(buildOrderQrPayload({ orderId: o._id || o.id || canonicalOrderNo, orderNo: canonicalOrderNo }), 220)
          : undefined;
        const nextQrCodeUrl = (o && o.qrCodeUrl && o._id && isQrCodeUrlForOrder(o.qrCodeUrl, o._id)) ? o.qrCodeUrl : derivedQrCodeUrl;
        const { __src, ...rest } = o || {};
        const normalized = {
          ...rest,
          productSellingPrice: shouldEnrichProducts ? (product ? product.price : null) : null,
          ...(nextQrCodeUrl ? { qrCodeUrl: nextQrCodeUrl } : {})
        };
        if (!shouldCompact) return normalized;
        const items = Array.isArray(normalized.items) ? normalized.items : [];
        const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
        const goodsName = normalized.goodsName || normalized.productTitle || normalized.goods_name || normalized.product_title || first?.goodsName || first?.title || first?.productName || first?.name;
        const materialNo = normalized.materialNo || normalized.material_no || first?.materialNo || first?.material_no;
        const spec = normalized.spec || first?.spec;
        const flute = normalized.flute || normalized.fluteType || first?.flute;
        const quantity = normalized.quantity ?? normalized.totalQty ?? normalized.sheetCount ?? first?.quantity;
        const unit = normalized.unit || first?.unit;
        const unitPrice = normalized.unitPrice ?? normalized.salePrice ?? normalized.price ?? first?.unitPrice ?? first?.salePrice ?? first?.price;
        const amount = normalized.amount ?? normalized.totalAmount ?? normalized.finalAmount;
        return {
          _id: normalized._id,
          id: normalized.id,
          orderNo: normalized.orderNo,
          orderNumber: normalized.orderNumber,
          supplierId: normalized.supplierId,
          supplierName: normalized.supplierName,
          customerId: normalized.customerId,
          customerName: normalized.customerName,
          productName: normalized.productName,
          goodsName,
          materialNo,
          spec,
          flute,
          quantity,
          unit,
          unitPrice,
          salePrice: normalized.salePrice,
          amount,
          status: normalized.status,
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
          orderType: normalized.orderType,
          source: normalized.source,
          purchaseCategory: normalized.purchaseCategory,
          productSellingPrice: normalized.productSellingPrice,
          sheetCount: normalized.sheetCount,
          items: first ? [first] : [],
          qrCodeUrl: normalized.qrCodeUrl
        };
      });
      if (shouldDebug) {
        console.log(`[getPurchaseOrders][fast] page=${page}, limit=${limit}, returned=${enrichedOrders.length}`);
      }
      let total = undefined;
      if (shouldCountTotal) {
        try {
          const c = await buildQuery('orders').count();
          total = Number(c.total || 0);
        } catch (_) { total = undefined; }
      }
      return {
        success: true,
        data: enrichedOrders,
        pagination: {
          page,
          limit,
          total,
          hasMore: total != null ? (skip + enrichedOrders.length < total) : (enrichedOrders.length >= limit)
        }
      };
    }
  } catch (_) { void 0; }
  const fetchWithOrderFallback = async (collectionName, takeCount) => {
    const orderFields = collectionName === 'purchase_orders'
      ? ['createdAt', '_createTime', 'createTime', 'updatedAt', 'updateTime']
      : ['createdAt', 'updatedAt', '_createTime', 'createTime', 'updateTime'];
    for (const f of orderFields) {
      try {
        const res = await buildQuery(collectionName).orderBy(f, 'desc').limit(takeCount).get();
        if (res && Array.isArray(res.data)) return res;
      } catch (_) { void 0; }
    }
    try {
      const res = await buildQuery(collectionName).limit(takeCount).get();
      if (res && Array.isArray(res.data)) return res;
    } catch (_) { void 0; }
    return { data: [] };
  };

  const [ordersRes, legacyRes] = await Promise.all([
    fetchWithOrderFallback('orders', take),
    fetchWithOrderFallback('purchase_orders', take)
  ]);

  const toTs = (v) => (typeof v === 'number' ? v : (Date.parse(v) || 0));
  const ordersRows = (ordersRes.data || []).map(o => (o ? { ...o, __src: 'orders' } : o));
  const legacyRows = (legacyRes.data || []).map(o => (o ? { ...o, __src: 'purchase_orders' } : o));
  const mergedAll = [...ordersRows, ...legacyRows];
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

  const pageRows = mergedSorted.slice(skip, skip + limit);

  // 补充商品信息（如销售价格，用于计算利润）
  const orders = pageRows;
  const productIds = shouldEnrichProducts
    ? [...new Set(orders.map(o => o.productId).filter(id => id && typeof id === 'string'))]
    : [];

  let productMap = {};
  if (productIds.length > 0) {
    try {
      const productsRes = await db.collection('products').where({
        _id: _.in(productIds)
      }).limit(100).get(); // limit matches page size roughly

      productsRes.data.forEach(p => {
        productMap[p._id] = p;
      });
    } catch (e) {
      console.error('Fetch products for purchase orders failed:', e);
    }
  }

  const enrichedOrders = orders.map(o => {
    const product = productMap[o.productId];
    const canonicalOrderNo = o && (o.orderNo || o.orderNumber) ? (o.orderNo || o.orderNumber) : '';
    const derivedQrCodeUrl = canonicalOrderNo
      ? buildQrServerUrl(buildOrderQrPayload({ orderId: o._id || o.id || canonicalOrderNo, orderNo: canonicalOrderNo }), 220)
      : undefined;
    const nextQrCodeUrl = (o && o.qrCodeUrl && o._id && isQrCodeUrlForOrder(o.qrCodeUrl, o._id)) ? o.qrCodeUrl : derivedQrCodeUrl;
    const { __src, ...rest } = o || {};
    const normalized = {
      ...rest,
      productSellingPrice: shouldEnrichProducts ? (product ? product.price : null) : null,
      ...(nextQrCodeUrl ? { qrCodeUrl: nextQrCodeUrl } : {})
    };
    if (!shouldCompact) return normalized;
    const items = Array.isArray(normalized.items) ? normalized.items : [];
    const first = items[0] && typeof items[0] === 'object' ? items[0] : null;
    const goodsName = normalized.goodsName || normalized.productTitle || normalized.goods_name || normalized.product_title || first?.goodsName || first?.title || first?.productName || first?.name;
    const materialNo = normalized.materialNo || normalized.material_no || first?.materialNo || first?.material_no;
    const spec = normalized.spec || first?.spec;
    const flute = normalized.flute || normalized.fluteType || first?.flute;
    const quantity = normalized.quantity ?? normalized.totalQty ?? normalized.sheetCount ?? first?.quantity;
    const unit = normalized.unit || first?.unit;
    const unitPrice = normalized.unitPrice ?? normalized.salePrice ?? normalized.price ?? first?.unitPrice ?? first?.salePrice ?? first?.price;
    const amount = normalized.amount ?? normalized.totalAmount ?? normalized.finalAmount;
    return {
      _id: normalized._id,
      id: normalized.id,
      orderNo: normalized.orderNo,
      orderNumber: normalized.orderNumber,
      supplierId: normalized.supplierId,
      supplierName: normalized.supplierName,
      customerId: normalized.customerId,
      customerName: normalized.customerName,
      productName: normalized.productName,
      goodsName,
      materialNo,
      spec,
      flute,
      quantity,
      unit,
      unitPrice,
      salePrice: normalized.salePrice,
      amount,
      status: normalized.status,
      createdAt: normalized.createdAt,
      updatedAt: normalized.updatedAt,
      orderType: normalized.orderType,
      source: normalized.source,
      purchaseCategory: normalized.purchaseCategory,
      productSellingPrice: normalized.productSellingPrice,
      sheetCount: normalized.sheetCount,
      items: first ? [first] : [],
      qrCodeUrl: normalized.qrCodeUrl
    };
  });
  // 获取总数
  let total = mergedSorted.length;
  if (shouldCountTotal) {
    const [countOrders, countLegacy] = await Promise.all([
      buildQuery('orders').count().catch(() => ({ total: 0 })),
      buildQuery('purchase_orders').count().catch(() => ({ total: 0 }))
    ]);
    total = Number(countOrders.total || 0) + Number(countLegacy.total || 0);
  }

  if (shouldDebug) {
    console.log(`[getPurchaseOrders] page=${page}, limit=${limit}, category=${category || ''}, returned=${enrichedOrders.length}, withTotal=${shouldCountTotal}, withProducts=${shouldEnrichProducts}, compact=${shouldCompact}`);
  }

  return {
    success: true,
    data: enrichedOrders,
    pagination: {
      page,
      limit,
      total,
      hasMore: skip + enrichedOrders.length < total
    }
  };
}

/**
 * 更新采购订单
 */
async function updatePurchaseOrder(updateData, wxContext) {
  const { id, ...fields } = updateData;

  if (!id) {
    throw new Error('订单ID不能为空');
  }

  // 1. 尝试在 purchase_orders 集合中查找
  let inPurchaseCollection = false;
  try {
    const res = await db.collection('purchase_orders').doc(id).get();
    if (res.data) inPurchaseCollection = true;
  } catch (e) {
    // 忽略错误，可能不在该集合
  }

  // 2. 如果在 purchase_orders 中，更新它
  if (inPurchaseCollection) {
    const currentOrder = await db.collection('purchase_orders').doc(id).get();

    const updatedOrder = {
      ...fields,
      updatedAt: Date.now(),
      updatedBy: wxContext.OPENID
    };

    // 自动计算金额
    if (fields.quantity !== undefined || fields.unitPrice !== undefined) {
      const qty = Number(fields.quantity !== undefined ? fields.quantity : (currentOrder.data.quantity || 0));
      const price = Number(fields.unitPrice !== undefined ? fields.unitPrice : (currentOrder.data.unitPrice || 0));
      updatedOrder.amount = qty * price;
    }

    await db.collection('purchase_orders').doc(id).update({
      data: updatedOrder
    });

    await logOperation('update_purchase_order', 'purchase_orders', id, fields, wxContext.OPENID);

    return {
      success: true,
      data: updatedOrder,
      message: '采购订单更新成功'
    };
  }

  // 3. 如果不在 purchase_orders 中，尝试使用通用 updateOrder (针对 orders 集合)
  return await updateOrder(updateData, wxContext);
}

async function relinkBoardPurchaseAssociation(payload, wxContext) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const purchaseOrderId = String(body.purchaseOrderId || body.id || '').trim();
  const itemIndex = Number(body.itemIndex);
  const newOrderId = String(body.newOrderId || '').trim();
  const newOrderNo = String(body.newOrderNo || '').trim();
  const expectedPurchaseOrderVersion =
    body.expectedPurchaseOrderVersion != null && body.expectedPurchaseOrderVersion !== ''
      ? Number(body.expectedPurchaseOrderVersion)
      : undefined;
  const oldRelatedOrderId = String(body.oldRelatedOrderId || '').trim();
  const oldRelatedOrderNo = String(body.oldRelatedOrderNo || '').trim();

  if (!purchaseOrderId) throw new Error('缺少采购单ID');
  if (!Number.isFinite(itemIndex) || itemIndex < 0) throw new Error('明细行索引无效');
  if (!newOrderId || !newOrderNo) throw new Error('缺少新关联订单信息');

  const now = Date.now();
  const operatorId = wxContext?.OPENID || '';

  const tx = await db.runTransaction(async (t) => {
    const getDoc = async (collectionName, docId) => {
      try {
        const res = await t.collection(collectionName).doc(docId).get();
        if (res && res.data) return res.data;
      } catch (_) { void 0; }
      return null;
    };

    let purchaseCollection = 'orders';
    let po = await getDoc('orders', purchaseOrderId);
    if (!po) {
      purchaseCollection = 'purchase_orders';
      po = await getDoc('purchase_orders', purchaseOrderId);
    }
    if (!po) throw new Error('采购单不存在');

    const purchaseOrderNo = String(po.orderNo || po.orderNumber || '').trim();
    const category = String(po.purchaseCategory || po.category || '').trim().toLowerCase();
    if (category !== 'boards') throw new Error('仅支持纸板采购单修改关联');

    const currentVersion = Number(po._version || 1);
    if (expectedPurchaseOrderVersion != null && Number.isFinite(expectedPurchaseOrderVersion)) {
      if (currentVersion !== expectedPurchaseOrderVersion) {
        throw new Error('采购单已被其他人更新，请刷新后重试');
      }
    }

    const items = Array.isArray(po.items) ? po.items.slice() : [];
    if (!items.length) throw new Error('采购单明细为空');
    if (itemIndex >= items.length) throw new Error('明细行索引超出范围');

    const prevItem = (items[itemIndex] && typeof items[itemIndex] === 'object') ? items[itemIndex] : {};
    const prevOrderId = String(prevItem.relatedOrderId || prevItem.orderId || oldRelatedOrderId || '').trim();
    const prevOrderNo = String(prevItem.relatedOrderNo || prevItem.orderNo || oldRelatedOrderNo || '').trim();

    items[itemIndex] = {
      ...prevItem,
      relatedOrderId: newOrderId,
      relatedOrderNo: newOrderNo
    };

    const metaBase = (po.meta && typeof po.meta === 'object') ? po.meta : {};
    const meta = { ...metaBase };
    const sourceOrdersBase = Array.isArray(meta.sourceOrders) ? meta.sourceOrders : [];
    const sourceOrders = sourceOrdersBase
      .map((x) => (x && typeof x === 'object' ? { ...x } : x))
      .filter(Boolean);

    const normalizeSourcePair = (so) => {
      const id = String(so?.id || so?._id || '').trim();
      const no = String(so?.orderNo || so?.orderNumber || '').trim();
      return { id, orderNo: no };
    };
    const matchPrev = (so) => {
      const p = normalizeSourcePair(so);
      if (prevOrderId && p.id && p.id === prevOrderId) return true;
      if (prevOrderNo && p.orderNo && p.orderNo === prevOrderNo) return true;
      return false;
    };

    let replaced = false;
    const nextSourceOrders = sourceOrders.map((so) => {
      if (!replaced && matchPrev(so)) {
        replaced = true;
        return { ...(so || {}), id: newOrderId, orderNo: newOrderNo };
      }
      return so;
    });
    if (!replaced) {
      if (nextSourceOrders.length > itemIndex) {
        nextSourceOrders[itemIndex] = { ...(nextSourceOrders[itemIndex] || {}), id: newOrderId, orderNo: newOrderNo };
      } else {
        nextSourceOrders.push({ id: newOrderId, orderNo: newOrderNo });
      }
    }

    const uniq = new Map();
    for (const so of nextSourceOrders) {
      const p = normalizeSourcePair(so);
      const k = p.id ? `id:${p.id}` : (p.orderNo ? `no:${p.orderNo}` : '');
      if (!k) continue;
      if (!uniq.has(k)) uniq.set(k, { id: p.id || undefined, orderNo: p.orderNo || undefined });
    }
    const finalSourceOrders = Array.from(uniq.values());
    meta.sourceOrders = finalSourceOrders;
    meta.sourceOrderIds = finalSourceOrders.map((x) => x.id).filter(Boolean);
    meta.sourceOrderNos = finalSourceOrders.map((x) => x.orderNo).filter(Boolean);

    if (prevOrderId && prevOrderId !== newOrderId) {
      const oldOrder = await getDoc('orders', prevOrderId);
      if (oldOrder) {
        const oldPOId = String(oldOrder.purchaseOrderId || '').trim();
        const oldPONo = String(oldOrder.purchaseOrderNo || '').trim();
        const shouldClear =
          (oldPOId && oldPOId === purchaseOrderId) ||
          (purchaseOrderNo && oldPONo && oldPONo === purchaseOrderNo);
        if (shouldClear) {
          await t.collection('orders').doc(prevOrderId).update({
            data: {
              purchaseOrderId: _.remove(),
              purchaseOrderNo: _.remove(),
              purchaseOrderCreatedAt: _.remove(),
              updatedAt: now,
              updatedBy: operatorId
            }
          });
        }
      }
    }

    const newOrder = await getDoc('orders', newOrderId);
    if (!newOrder) throw new Error('新关联订单不存在');
    const newOrderType = String(newOrder.orderType || newOrder.type || '').toLowerCase();
    const newOrderSource = String(newOrder.source || '').toLowerCase();
    if (newOrderType === 'purchase' || newOrderSource === 'purchased') throw new Error('不能关联采购订单');
    const existingPOId = String(newOrder.purchaseOrderId || '').trim();
    const existingPONo = String(newOrder.purchaseOrderNo || '').trim();
    if (existingPOId && existingPOId !== purchaseOrderId) throw new Error(`订单${newOrderNo}已关联其他采购单`);
    if (!existingPOId && existingPONo && purchaseOrderNo && existingPONo !== purchaseOrderNo) {
      throw new Error(`订单${newOrderNo}已关联其他采购单`);
    }

    await t.collection('orders').doc(newOrderId).update({
      data: {
        purchaseOrderId,
        purchaseOrderNo: purchaseOrderNo || newOrderNo,
        purchaseOrderCreatedAt: now,
        updatedAt: now,
        updatedBy: operatorId
      }
    });

    const nextVersion = currentVersion + 1;
    const poUpdate = {
      items,
      meta,
      updatedAt: now,
      updatedBy: operatorId,
      _version: nextVersion
    };
    await t.collection(purchaseCollection).doc(purchaseOrderId).update({ data: poUpdate });

    return { purchaseCollection, purchaseOrderNo, purchaseOrderVersion: nextVersion, prevOrderId, prevOrderNo };
  });

  let fresh = null;
  try {
    const res = await db.collection(tx.purchaseCollection).doc(purchaseOrderId).get();
    fresh = res?.data || null;
  } catch (_) { void 0; }

  await logOperation(
    'relink_board_purchase_association',
    tx.purchaseCollection,
    purchaseOrderId,
    {
      purchaseOrderId,
      purchaseOrderNo: tx.purchaseOrderNo,
      itemIndex,
      oldRelatedOrderId: oldRelatedOrderId || tx.prevOrderId || undefined,
      oldRelatedOrderNo: oldRelatedOrderNo || tx.prevOrderNo || undefined,
      newOrderId,
      newOrderNo,
      purchaseOrderVersion: tx.purchaseOrderVersion
    },
    operatorId
  );

  return { success: true, data: { purchaseOrder: fresh }, message: '关联更新成功' };
}

async function syncBoardUsageOnStart(payload, wxContext) {
  const orderId = String(payload?.orderId || payload?.id || '').trim();
  const orderNo = String(payload?.orderNo || payload?.orderNumber || '').trim();
  if (!orderId && !orderNo) {
    throw new Error('缺少订单标识');
  }

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const safeArray = (v) => (Array.isArray(v) ? v : []);

  const getOrderSheetCount = (o) => {
    const items = safeArray(o?.items);
    const first = items[0] || {};
    const raw =
      o?.sheetCount ??
      o?.sheet_count ??
      o?.sheetQty ??
      o?.sheet_qty ??
      (o?.product && (o.product.sheetCount ?? o.product.sheet_count ?? o.product.sheetQty ?? o.product.sheet_qty)) ??
      first?.sheetCount ??
      first?.sheet_count ??
      first?.sheetQty ??
      first?.sheet_qty ??
      undefined;
    const n = toNumber(raw);
    if (Number.isFinite(n) && n > 0) return n;
    const qty = toNumber(o?.quantity ?? o?.totalQty ?? first?.quantity);
    return Number.isFinite(qty) && qty > 0 ? qty : 0;
  };

  const findOrderDoc = async () => {
    if (orderId) {
      try {
        const res = await db.collection('orders').doc(orderId).get();
        if (res?.data) return res.data;
      } catch (_) { }
    }
    if (orderNo) {
      try {
        const res = await db.collection('orders').where(
          _.or([
            { orderNo },
            { orderNumber: orderNo }
          ])
        ).limit(1).get();
        if (Array.isArray(res?.data) && res.data[0]) return res.data[0];
      } catch (_) { }
    }
    return null;
  };

  const orderDoc = await findOrderDoc();
  const orderSheetCount = orderDoc ? getOrderSheetCount(orderDoc) : 0;
  const effectiveOrderId = orderDoc ? String(orderDoc._id || orderDoc.id || orderId || '').trim() : orderId;
  const effectiveOrderNo = orderDoc ? String(orderDoc.orderNo || orderDoc.orderNumber || orderNo || '').trim() : orderNo;

  const fetchBySourceOrderId = async () => {
    if (!effectiveOrderId) return [];
    const fetchFrom = async (collectionName) => {
      try {
        const res = await db.collection(collectionName).where({
          orderType: 'purchase',
          purchaseCategory: 'boards',
          'meta.sourceOrderIds': _.all([effectiveOrderId])
        }).limit(50).get();
        return safeArray(res?.data).map((x) => ({ ...(x || {}), _collection: collectionName }));
      } catch (_) {
        return [];
      }
    };
    const [inOrders, inLegacy] = await Promise.all([
      fetchFrom('orders'),
      fetchFrom('purchase_orders')
    ]);
    return [...inOrders, ...inLegacy];
  };

  const fetchBySourceOrderNo = async () => {
    if (!effectiveOrderNo) return [];
    const fetchFrom = async (collectionName) => {
      try {
        const res = await db.collection(collectionName).where({
          orderType: 'purchase',
          purchaseCategory: 'boards',
          'meta.sourceOrderNos': _.all([effectiveOrderNo])
        }).limit(50).get();
        return safeArray(res?.data).map((x) => ({ ...(x || {}), _collection: collectionName }));
      } catch (_) {
        return [];
      }
    };
    const [inOrders, inLegacy] = await Promise.all([
      fetchFrom('orders'),
      fetchFrom('purchase_orders')
    ]);
    return [...inOrders, ...inLegacy];
  };

  const [listById, listByNo] = await Promise.all([
    fetchBySourceOrderId(),
    fetchBySourceOrderNo()
  ]);

  const uniq = new Map();
  [...listById, ...listByNo].forEach((o) => {
    if (!o) return;
    const k = String(o._id || o.id || '');
    if (!k) return;
    if (!uniq.has(k)) uniq.set(k, o);
  });
  const targets = Array.from(uniq.values());
  if (!targets.length) {
    return { success: true, data: { updatedCount: 0, purchaseOrderIds: [] } };
  }

  const nowIso = new Date().toISOString();
  const now = Date.now();

  const computeTargetQtyForPurchaseOrder = (po) => {
    const items = safeArray(po?.items);
    const matchedQty = items.reduce((s, it) => {
      const rid = String(it?.relatedOrderId || '').trim();
      const rno = String(it?.relatedOrderNo || '').trim();
      const isHit =
        (effectiveOrderId && rid && rid === effectiveOrderId) ||
        (effectiveOrderNo && rno && rno === effectiveOrderNo);
      if (!isHit) return s;
      const q = toNumber(it?.quantity);
      if (!Number.isFinite(q) || q <= 0) return s;
      return s + q;
    }, 0);
    if (matchedQty > 0) return matchedQty;
    if (orderSheetCount > 0) return orderSheetCount;
    return 0;
  };

  const results = await Promise.allSettled(
    targets.map(async (po) => {
      const poId = String(po?._id || po?.id || '').trim();
      if (!poId) return null;
      const collectionName = String(po?._collection || 'orders').trim() || 'orders';

      const targetQty = computeTargetQtyForPurchaseOrder(po);
      if (!(targetQty > 0)) return { poId, changed: false };

      const prevShipped = Math.max(0, toNumber(po?.shippedQty || po?.deliveredQty || 0) || 0);
      const total = Math.max(0, toNumber(po?.stockedQty || po?.quantity || 0) || 0);
      const nextShipped = Math.max(prevShipped, total > 0 ? Math.min(total, targetQty) : targetQty);
      const delta = Math.max(0, nextShipped - prevShipped);

      const prevShipments = safeArray(po?.shipments);
      const nextShipments = delta > 0
        ? prevShipments.concat([{ qty: delta, time: nowIso, type: 'used', source: 'mp_start' }])
        : prevShipments;

      const prevLogs = safeArray(po?.inventoryChangeLogs);
      const nextLogsRaw = prevLogs.concat([{
        at: nowIso,
        ts: now,
        action: 'syncBoardUsageOnStart',
        orderId: effectiveOrderId || undefined,
        orderNo: effectiveOrderNo || undefined,
        beforeShipped: prevShipped,
        afterShipped: nextShipped,
        qty: delta,
        by: wxContext?.OPENID || undefined
      }]);
      const nextLogs = nextLogsRaw.length > 60 ? nextLogsRaw.slice(nextLogsRaw.length - 60) : nextLogsRaw;

      await db.collection(collectionName).doc(poId).update({
        data: {
          shippedQty: nextShipped,
          shippedAt: nowIso,
          shipments: nextShipments,
          inventoryChangeLogs: nextLogs,
          updatedAt: now,
          updatedBy: wxContext.OPENID
        }
      });

      await logOperation('sync_board_usage_on_start', collectionName, poId, {
        orderId: effectiveOrderId,
        orderNo: effectiveOrderNo,
        beforeShipped: prevShipped,
        afterShipped: nextShipped,
        delta,
        targetQty
      }, wxContext.OPENID);

      return { poId, changed: delta > 0 };
    })
  );

  const changedIds = results
    .map((r) => (r && r.status === 'fulfilled' ? r.value : null))
    .filter((v) => v && v.poId)
    .map((v) => v.poId);
  const updatedCount = results
    .map((r) => (r && r.status === 'fulfilled' ? r.value : null))
    .filter((v) => v && v.changed).length;

  return {
    success: true,
    data: {
      updatedCount,
      purchaseOrderIds: changedIds,
      orderId: effectiveOrderId || undefined,
      orderNo: effectiveOrderNo || undefined
    }
  };
}

/**
 * 采购订单入库
 */
async function stockInPurchaseOrder(data, wxContext) {
  let { orderId, quantity, productId, goodsName, spec, unit } = data;
  if (!orderId) throw new Error('订单ID不能为空');

  // Determine collection and get order
  let collectionName = 'purchase_orders';
  let orderRes;
  try {
    orderRes = await db.collection('purchase_orders').doc(orderId).get();
  } catch (e) {
    collectionName = 'orders';
    try {
      orderRes = await db.collection('orders').doc(orderId).get();
    } catch (e2) {
      throw new Error('订单不存在');
    }
  }

  const orderData = orderRes.data;

  // 补充字段
  if (!goodsName) goodsName = orderData.productTitle || orderData.goodsName;
  if (!spec) spec = orderData.spec || orderData.materialNo;
  if (!unit) unit = orderData.unit;
  if (quantity === undefined) quantity = orderData.quantity;

  const now = Date.now();

  // 1. 更新采购订单状态
  await db.collection(collectionName).doc(orderId).update({
    data: {
      status: 'stocked',
      stockedQty: quantity, // 记录实际入库数量
      stockedAt: now,
      updatedAt: now,
      updatedBy: wxContext.OPENID
    }
  });

  // 2. 准备更新库存
  let finalProductId = productId;

  // 如果没有产品ID，尝试查找或创建产品
  if (!finalProductId && goodsName) {
    let productRes = { data: [] };
    try {
      productRes = await db.collection('products').where({
        name: goodsName
      }).limit(1).get();
    } catch (e) {
      // 集合可能不存在
      console.warn('查询产品失败，可能集合不存在:', e);
    }

    if (productRes.data.length > 0) {
      finalProductId = productRes.data[0]._id;
    } else {
      // 创建新产品
      const newProduct = {
        _id: uuidv4(),
        name: goodsName,
        spec: spec || '',
        unit: unit || '件',
        category: 'goods', // 默认商品
        status: 'active',
        createdAt: now,
        updatedAt: now,
        createdBy: wxContext.OPENID,
        updatedBy: wxContext.OPENID
      };
      await db.collection('products').add({ data: newProduct });
      finalProductId = newProduct._id;
    }
  }

  if (!finalProductId) {
    console.warn('Cannot update inventory: missing productId and goodsName');
    return { success: true, message: '订单状态已更新，但未关联产品，未更新库存' };
  }

  // 3. 获取默认仓库
  let warehouseId = 'default_warehouse';
  let warehouseRes = { data: [] };
  try {
    warehouseRes = await db.collection('warehouses').limit(1).get();
  } catch (e) {
    console.warn('查询仓库失败，可能集合不存在:', e);
  }

  if (warehouseRes.data.length > 0) {
    warehouseId = warehouseRes.data[0]._id;
  } else {
    // 尝试创建默认仓库
    try {
      await db.collection('warehouses').add({
        data: {
          _id: 'default_warehouse',
          name: '默认仓库',
          createdAt: now,
          updatedAt: now
        }
      });
      warehouseId = 'default_warehouse';
    } catch (e) {
      // 可能已存在并发创建
    }
  }

  // 4. 更新库存
  let inventoryRes = { data: [] };
  try {
    inventoryRes = await db.collection('inventory').where({
      productId: finalProductId,
      warehouseId: warehouseId
    }).get();
  } catch (e) {
    console.warn('查询库存失败，可能集合不存在:', e);
  }

  if (inventoryRes.data.length > 0) {
    const rec = inventoryRes.data[0];
    await db.collection('inventory').doc(rec._id).update({
      data: {
        quantity: _.inc(Number(quantity)),
        updatedAt: now,
        updatedBy: wxContext.OPENID
      }
    });
  } else {
    await db.collection('inventory').add({
      data: {
        _id: uuidv4(),
        productId: finalProductId,
        warehouseId: warehouseId,
        quantity: Number(quantity),
        createdAt: now,
        updatedAt: now,
        createdBy: wxContext.OPENID,
        updatedBy: wxContext.OPENID
      }
    });
  }

  await logOperation('stock_in', 'purchase_orders', orderId, { quantity, warehouseId }, wxContext.OPENID);

  return { success: true, message: '入库成功' };
}

/**
 * 获取采购订单详情
 */
async function getPurchaseOrderDetail(id) {
  if (!id) {
    throw new Error('订单ID不能为空');
  }

  let result;
  try {
    result = await db.collection('purchase_orders').doc(id).get();
  } catch (e) {
    // Try fallback to orders collection
    try {
      result = await db.collection('orders').doc(id).get();
    } catch (e2) {
      throw new Error('订单不存在');
    }
  }

  if (!result.data) {
    throw new Error('订单不存在');
  }

  const order = result.data;
  let productData = {};

  if (order.productId) {
    try {
      const productRes = await db.collection('products').doc(order.productId).get();
      if (productRes.data) {
        productData = productRes.data;
      }
    } catch (e) {
      console.error('Fetch product for detail failed:', e);
    }
  }

  // 尝试查找关联的销售订单以获取真实售价
  let realSellingPrice = null;
  const lookupOrderNo = order.orderNo || order.orderNumber;

  if (lookupOrderNo) {
    try {
      // 优先匹配 orderNumber，其次匹配 orderNo
      const salesOrderRes = await db.collection('orders').where(
        _.or([
          { orderNumber: lookupOrderNo },
          { orderNo: lookupOrderNo }
        ])
      ).limit(1).get();

      if (salesOrderRes.data && salesOrderRes.data.length > 0) {
        const salesOrder = salesOrderRes.data[0];

        // 策略1: 如果有 items 数组，尝试匹配
        if (salesOrder.items && Array.isArray(salesOrder.items)) {
          // 优先按 ID 匹配
          let match = null;
          if (order.productId) {
            match = salesOrder.items.find(i => i.productId === order.productId);
          }
          // 其次按名称匹配
          if (!match && (order.goodsName || order.productTitle)) {
            const name = (order.goodsName || order.productTitle || '').trim();

            // 1. 精确匹配
            match = salesOrder.items.find(i => {
              const iName = (i.name || i.productTitle || i.goodsName || '').trim();
              return iName === name;
            });

            // 2. 包含匹配 (Sales Order item name includes Purchase Order item name OR vice versa)
            if (!match && name) {
              match = salesOrder.items.find(i => {
                const iName = (i.name || i.productTitle || i.goodsName || '').trim();
                return iName && (iName.includes(name) || name.includes(iName));
              });
            }
          }
          // 如果只有一个商品，直接匹配
          if (!match && salesOrder.items.length === 1) {
            match = salesOrder.items[0];
          }

          if (match) {
            realSellingPrice = Number(match.price || match.unitPrice || match.sellingPrice || 0);
          }
        }
        // 策略2: 如果没有 items 但有总金额和数量，且只有这一个关联（简单订单结构）
        else if (salesOrder.totalAmount && salesOrder.quantity) {
          // 这种情况比较少见，谨慎处理，这里暂不推断
        }
      }
    } catch (e) {
      console.warn('Failed to lookup real selling price from sales order:', e);
    }
  }

  const canonicalOrderNo = order.orderNo || order.orderNumber || '';
  const derivedQrCodeUrl = canonicalOrderNo
    ? buildQrServerUrl(buildOrderQrPayload({ orderId: order._id, orderNo: canonicalOrderNo }), 220)
    : undefined;

  // Merge logic to ensure fields are populated, similar to PC
  const merged = {
    ...order,
    productName: order.productName || productData.name,
    // Ensure numeric values are numbers
    quantity: Number(order.quantity || 0),
    unitPrice: Number(order.unitPrice || productData.price || 0),
    amount: Number(order.amount || (Number(order.quantity || 0) * Number(order.unitPrice || productData.price || 0)) || 0),
    // 优先使用查找到的真实订单售价，其次是产品库售价
    productSellingPrice: realSellingPrice !== null ? realSellingPrice : productData.price,

    // Pass through extended attributes explicitly (though ...order covers them if present)
    materialCode: order.materialCode,
    flute: order.flute,
    joinMethod: order.joinMethod,
    boardWidth: order.boardWidth,
    boardHeight: order.boardHeight,
    creasingSize1: order.creasingSize1,
    creasingSize2: order.creasingSize2,
    creasingSize3: order.creasingSize3,
    creasingType: order.creasingType,
    deliveryDate: order.deliveryDate,
    notes: order.notes,
    attachments: order.attachments || [],

    // Generate QR Code URL if not present
    qrCodeUrl: (order.qrCodeUrl && isQrCodeUrlForOrder(order.qrCodeUrl, order._id)) ? order.qrCodeUrl : derivedQrCodeUrl
  };

  return {
    success: true,
    data: merged
  };
}
