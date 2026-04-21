import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout/Layout'
import Login from '@/pages/Login'
import OrderManagement from '@/pages/OrderManagement'
import ProductionManagement from '@/pages/ProductionManagement'
import CustomerManagement from '@/pages/CustomerManagement'
import CustomerManagementDetail from '@/pages/CustomerManagementDetail'
import ProductManagement from '@/pages/ProductManagement'
import ProductManagementDetail from '@/pages/ProductManagementDetail'
import SupplierMaterialLibraryEdit from '@/pages/SupplierMaterialLibraryEdit'
import FinancialManagement from '@/pages/FinancialManagement'
import SystemSettings from '@/pages/SystemSettings'
import DataManagement from '@/pages/DataManagement'

const Router = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/data-management" replace />} />
        <Route path="data-management" element={<DataManagement />} />
        <Route path="orders" element={<OrderManagement />} />
        <Route path="production" element={<ProductionManagement />} />
        <Route path="customers" element={<CustomerManagement />} />
        <Route path="customers/:id" element={<CustomerManagementDetail />} />
        <Route path="products" element={<ProductManagement />} />
        <Route path="products/customer/:id" element={<CustomerManagementDetail />} />
        <Route path="products/supplier-materials/:id" element={<SupplierMaterialLibraryEdit />} />
        <Route path="products/:id" element={<ProductManagementDetail />} />
        <Route path="financial" element={<Navigate to="/finance" replace />} />
        <Route path="finance" element={<FinancialManagement />} />
        <Route path="settings" element={<SystemSettings />} />
      </Route>
    </Routes>
  )
}

export default Router
