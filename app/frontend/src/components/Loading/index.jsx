import React from 'react'
import { Spin } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'

/**
 * 加载组件
 */
export const Loading = ({ size = 'large', tip = '加载中...', fullScreen = false }) => {
  const antIcon = <LoadingOutlined style={{ fontSize: 24 }} spin />
  
  if (fullScreen) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        zIndex: 9999
      }}>
        <Spin indicator={antIcon} size={size} tip={tip} />
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 0'
    }}>
      <Spin indicator={antIcon} size={size} tip={tip} />
    </div>
  )
}

/**
 * 页面加载组件
 */
export const PageLoading = () => {
  return <Loading fullScreen tip="页面加载中..." />
}

/**
 * 表格加载组件
 */
export const TableLoading = () => {
  return <Loading size="default" tip="数据加载中..." />
}