import React from 'react'
import { Card } from 'antd'
import { Line } from '@ant-design/charts'

const SalesChart = ({ data, loading = false }) => {
  const config = {
    data: data || [],
    padding: 'auto',
    xField: 'date',
    yField: 'value',
    xAxis: {
      type: 'time',
      tickCount: 5,
    },
    yAxis: {
      label: {
        formatter: (v) => `${v}`.replace(/\d{1,3}(?=(\d{3})+$)/g, (s) => `${s},`),
      },
    },
    point: {
      size: 5,
      shape: 'diamond',
    },
    tooltip: {
      showMarkers: false,
    },
    state: {
      active: {
        style: {
          shadowBlur: 4,
          stroke: '#000',
          fill: 'red',
        },
      },
    },
    interactions: [
      {
        type: 'marker-active',
      },
    ],
  }

  return (
    <Card title="销售趋势" loading={loading}>
      <Line {...config} />
    </Card>
  )
}

export default SalesChart