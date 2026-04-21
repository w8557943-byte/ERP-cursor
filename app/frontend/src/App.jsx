import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout, App as AntApp, Spin } from 'antd'
import AppHeader from './components/Layout/AppHeader'
import AppSider from './components/Layout/AppSider'
import ErrorBoundary from './components/ErrorBoundary'
import Login from './pages/Login'
import { useAuthStore } from '@/stores/authStore'
import { prefetchHotData } from './services/cachedAPI'
import './App.css'

const { Content, Sider } = Layout

const DataManagementPage = lazy(() => import('./pages/DataManagement'))
const OrderManagementPage = lazy(() => import('./pages/OrderManagement'))
const OrderDetailPage = lazy(() => import('./pages/OrderDetail'))
const OrderGroupDetailPage = lazy(() => import('./pages/OrderGroupDetail'))
const OrderCreatePage = lazy(() => import('./pages/OrderCreate'))
const ProductionManagementPage = lazy(() => import('./pages/ProductionManagement'))
const PurchaseManagementPage = lazy(() => import('./pages/PurchaseManagement'))
const RawMaterialPurchasePage = lazy(() => import('./pages/RawMaterialPurchase'))
const GoodsPurchasePage = lazy(() => import('./pages/GoodsPurchase'))
const BoardPurchasePreviewPage = lazy(() => import('./pages/BoardPurchasePreview'))
const InventoryManagementPage = lazy(() => import('./pages/InventoryManagement'))
const ShippingManagementPage = lazy(() => import('./pages/ShippingManagement'))
const OrderStatsPage = lazy(() => import('./pages/OrderStats'))
const ShippingPrintPreviewPage = lazy(() => import('./pages/ShippingPrintPreview'))
const ShippingNoteStatsPage = lazy(() => import('./pages/ShippingNoteStats'))
const ProductionDetailPage = lazy(() => import('./pages/ProductionDetail'))
const WorkOrderPrintPreviewPage = lazy(() => import('./pages/WorkOrderPrintPreview'))
const CustomerManagementPage = lazy(() => import('./pages/CustomerManagement'))
const CustomerManagementDetailPage = lazy(() => import('./pages/CustomerManagementDetail'))
const CustomerOrderCreatePage = lazy(() => import('./pages/CustomerOrderCreate'))
const ProductManagementPage = lazy(() => import('./pages/ProductManagement'))
const ProductManagementDetailPage = lazy(() => import('./pages/ProductManagementDetail'))
const SupplierMaterialLibraryEditPage = lazy(() => import('./pages/SupplierMaterialLibraryEdit'))
const EmployeeManagementPage = lazy(() => import('./pages/EmployeeManagement'))
const EmployeeDetailPage = lazy(() => import('./pages/EmployeeDetail'))
const FinancialManagementPage = lazy(() => import('./pages/FinancialManagement'))
const SystemSettingsPage = lazy(() => import('./pages/SystemSettings'))
const CloudSyncManagerPage = lazy(() => import('./pages/CloudSyncManager'))

const idle = (fn) => {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }
  const t = setTimeout(fn, 300)
  return () => clearTimeout(t)
}

function App() {
  const token = useAuthStore((state) => state.token)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const authed = Boolean(token) || Boolean(isAuthenticated)
  const [collapsed, setCollapsed] = useState(false)
  const location = useLocation()
  const hotPrefetchedRef = useRef(false)

  const keepAlivePages = useMemo(() => ([
    ['/data-management', <DataManagementPage />],
    ['/orders', <OrderManagementPage />],
    ['/production', <ProductionManagementPage />],
    ['/purchase', <PurchaseManagementPage />],
    ['/inventory', <InventoryManagementPage />],
    ['/customers', <CustomerManagementPage />],
    ['/products', <ProductManagementPage />],
    ['/financial', <FinancialManagementPage />]
  ]), [])

  const keepAlivePaths = useMemo(() => new Set(keepAlivePages.map(([path]) => path)), [keepAlivePages])
  const isKeepAlivePath = keepAlivePaths.has(location.pathname)
  const [keepAliveMounted, setKeepAliveMounted] = useState(() => (
    isKeepAlivePath ? new Set([location.pathname]) : new Set()
  ))

  useEffect(() => {
    if (!authed) return
    if (!isKeepAlivePath) return
    setKeepAliveMounted((prev) => {
      if (prev.has(location.pathname)) return prev
      const next = new Set(prev)
      next.add(location.pathname)
      return next
    })
  }, [authed, isKeepAlivePath, location.pathname])

  useEffect(() => {
    if (!authed) return
    if (hotPrefetchedRef.current) return
    hotPrefetchedRef.current = true
    prefetchHotData().catch(() => { })
  }, [authed])

  useEffect(() => {
    if (!authed) return undefined
    return idle(() => {
      void import('./pages/OrderManagement').catch(() => { })
      void import('./pages/ProductionManagement').catch(() => { })
      void import('./pages/PurchaseManagement').catch(() => { })
      void import('./pages/InventoryManagement').catch(() => { })
      void import('./pages/FinancialManagement').catch(() => { })
      void import('./pages/CustomerManagement').catch(() => { })
      void import('./pages/ShippingManagement').catch(() => { })
      void import('./pages/DataManagement').catch(() => { })
      void import('./pages/ProductManagement').catch(() => { })
    })
  }, [authed])

  return (
    <AntApp>
      {!authed ? (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : (
        <Layout className="app-layout">
          <AppHeader collapsed={collapsed} setCollapsed={setCollapsed} />
          <Layout>
            <Sider
              collapsible
              trigger={null}
              collapsed={collapsed}
              onCollapse={setCollapsed}
              width={240}
              collapsedWidth={60}
              theme="light"
              style={{
                overflow: 'auto',
                height: 'calc(100vh - 64px)',
                position: 'fixed',
                left: 0,
                top: 64,
                bottom: 0,
                zIndex: 1001,
                backgroundColor: '#fafafa',
                borderRight: '1px solid #f0f0f0',
                boxShadow: '2px 0 6px rgba(0, 0, 0, 0.1)'
              }}
            >
              <AppSider collapsed={collapsed} />
            </Sider>
            <Layout
              className="content-layout"
              style={{
                marginLeft: collapsed ? 60 : 240,
                minHeight: 'calc(100vh - 64px)',
                transition: 'margin-left 0.2s',
                paddingTop: 64
              }}
            >
              <Content className="app-content">
                <ErrorBoundary>
                  <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>}>
                    {keepAlivePages.map(([path, element]) => {
                      if (!keepAliveMounted.has(path)) return null
                      const active = location.pathname === path
                      return (
                        <div key={path} style={{ display: active ? 'block' : 'none' }}>
                          {element}
                        </div>
                      )
                    })}
                  </Suspense>
                  <Suspense fallback={<div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>}>
                    <Routes location={isKeepAlivePath ? { ...location, pathname: '/__keepalive__' } : location}>
                      <Route path="/__keepalive__" element={null} />
                      <Route path="/" element={<Navigate to="/data-management" replace />} />
                      <Route path="/data-management" element={<DataManagementPage />} />
                      <Route path="/orders" element={<OrderManagementPage />} />
                      <Route path="/orders/create" element={<OrderCreatePage />} />
                      <Route path="/orders/stats" element={<OrderStatsPage />} />
                      <Route path="/orders/group/:orderNo" element={<OrderGroupDetailPage />} />
                      <Route path="/orders/:id" element={<OrderDetailPage />} />
                      <Route path="/orders/edit/:id" element={<OrderCreatePage />} />
                      <Route path="/production" element={<ProductionManagementPage />} />
                      <Route path="/production/:id" element={<ProductionDetailPage />} />
                      <Route path="/production/workorder-print" element={<WorkOrderPrintPreviewPage />} />
                      <Route path="/purchase" element={<PurchaseManagementPage />} />
                      <Route path="/purchase/goods/create" element={<GoodsPurchasePage />} />
                      <Route path="/purchase/materials/create" element={<RawMaterialPurchasePage />} />
                      <Route path="/purchase/boards/preview" element={<BoardPurchasePreviewPage />} />
                      <Route path="/inventory" element={<InventoryManagementPage />} />
                      <Route path="/inventory/boards/detail" element={<BoardPurchasePreviewPage />} />
                      <Route path="/shipping" element={<ShippingManagementPage />} />
                      <Route path="/shipping/stats" element={<ShippingNoteStatsPage />} />
                      <Route path="/shipping/print-preview" element={<ShippingPrintPreviewPage />} />
                      <Route path="/customers" element={<CustomerManagementPage />} />
                      <Route path="/customers/:id" element={<CustomerManagementDetailPage />} />
                      <Route path="/customers/:id/orders/create" element={<CustomerOrderCreatePage />} />
                      <Route path="/products" element={<ProductManagementPage />} />
                      <Route path="/products/customer/:id" element={<CustomerManagementDetailPage />} />
                      <Route path="/products/supplier-materials/:id" element={<SupplierMaterialLibraryEditPage />} />
                      <Route path="/products/:id" element={<ProductManagementDetailPage />} />
                      <Route path="/employees" element={<EmployeeManagementPage />} />
                      <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                      <Route path="/financial" element={<FinancialManagementPage />} />
                      <Route path="/cloud-sync" element={<CloudSyncManagerPage />} />
                      <Route path="/settings" element={<SystemSettingsPage />} />
                      <Route path="*" element={<Navigate to="/data-management" replace />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </Content>
            </Layout>
          </Layout>
        </Layout>
      )}
    </AntApp>
  )
}

export default App
