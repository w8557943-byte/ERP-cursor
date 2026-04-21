import React from 'react'
import { Card, Statistic, Row, Col } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'

const StatsCard = ({ title, value, prefix, suffix, precision = 0, trend, loading = false }) => {
  const getTrendIcon = () => {
    if (!trend) return null
    
    if (trend > 0) {
      return <ArrowUpOutlined style={{ color: '#3f8600' }} />
    } else if (trend < 0) {
      return <ArrowDownOutlined style={{ color: '#cf1322' }} />
    }
    return null
  }

  const getTrendText = () => {
    if (!trend) return ''
    
    const absTrend = Math.abs(trend)
    if (trend > 0) {
      return `+${absTrend}%`
    } else if (trend < 0) {
      return `-${absTrend}%`
    }
    return '0%'
  }

  return (
    <Card loading={loading}>
      <Statistic
        title={title}
        value={value}
        precision={precision}
        valueStyle={{ color: trend ? (trend > 0 ? '#3f8600' : '#cf1322') : '#000' }}
        prefix={getTrendIcon()}
        suffix={
          <span>
            {suffix}
            {trend && (
              <span style={{ fontSize: '12px', marginLeft: '8px', color: trend > 0 ? '#3f8600' : '#cf1322' }}>
                {getTrendText()}
              </span>
            )}
          </span>
        }
      />
    </Card>
  )
}

export default StatsCard