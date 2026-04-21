/**
 * 数据映射服务
 * 处理PC端与小程序端数据结构的映射和转换
 * 解决两端数据类型和字段结构不一致的问题
 */

class DataMappingService {
  constructor() {
    // 客户数据字段映射配置
    this.customerFieldMapping = {
      // 字段名映射
      fieldMapping: {
        'customerType': 'customerType',
        'status': 'status',
        'creditLimit': 'creditLimit',
        'createdBy': 'createdBy',
        'supervisor': 'supervisor',
        'createdAt': 'createdAt',
        'updatedAt': 'updatedAt'
      },
      // 字段类型转换配置
      typeMapping: {
        'customerType': {
          pcType: 'string',
          wechatType: 'number',
          converter: {
            pcToWechat: (value) => {
              // 字符串转数字: 'enterprise' -> 1, 'individual' -> 2
              const mapping = { 'enterprise': 1, 'individual': 2, 'government': 3 };
              return mapping[value] || 1;
            },
            wechatToPc: (value) => {
              // 数字转字符串: 1 -> 'enterprise', 2 -> 'individual'
              const mapping = { 1: 'enterprise', 2: 'individual', 3: 'government' };
              return mapping[value] || 'enterprise';
            }
          }
        },
        'status': {
          pcType: 'string',
          wechatType: 'number',
          converter: {
            pcToWechat: (value) => {
              // 字符串转数字: 'active' -> 1, 'inactive' -> 0
              const mapping = { 'active': 1, 'inactive': 0, 'pending': 2 };
              return mapping[value] || 1;
            },
            wechatToPc: (value) => {
              // 数字转字符串: 1 -> 'active', 0 -> 'inactive'
              const mapping = { 1: 'active', 0: 'inactive', 2: 'pending' };
              return mapping[value] || 'active';
            }
          }
        },
        'creditLimit': {
          pcType: 'number',
          wechatType: 'string',
          converter: {
            pcToWechat: (value) => {
              // 数字转字符串
              return value ? value.toString() : '0';
            },
            wechatToPc: (value) => {
              // 字符串转数字
              return value ? parseFloat(value) || 0 : 0;
            }
          }
        }
      },
      // 字段同步策略
      syncStrategy: {
        'createdBy': 'pc_only',      // 只在PC端维护
        'supervisor': 'pc_only',     // 只在PC端维护
        'createdAt': 'pc_only',      // 只在PC端维护
        'updatedAt': 'pc_only',      // 只在PC端维护
        'customerType': 'bidirectional', // 双向同步
        'status': 'bidirectional',   // 双向同步
        'creditLimit': 'bidirectional'   // 双向同步
      }
    };

    // 订单数据字段映射配置
    this.orderFieldMapping = {
      fieldMapping: {
        'orderStatus': 'orderStatus',
        'priority': 'priority',
        'totalAmount': 'totalAmount'
      },
      typeMapping: {
        'orderStatus': {
          pcType: 'string',
          wechatType: 'number',
          converter: {
            pcToWechat: (value) => {
              const mapping = { 
                'pending': 1, 
                'processing': 2, 
                'completed': 3, 
                'cancelled': 4 
              };
              return mapping[value] || 1;
            },
            wechatToPc: (value) => {
              const mapping = { 
                1: 'pending', 
                2: 'processing', 
                3: 'completed', 
                4: 'cancelled' 
              };
              return mapping[value] || 'pending';
            }
          }
        }
      },
      syncStrategy: {
        'orderStatus': 'bidirectional',
        'priority': 'bidirectional',
        'totalAmount': 'bidirectional'
      }
    };
  }

  /**
   * 转换PC端数据到小程序端格式
   */
  convertPcToWechat(dataType, pcData) {
    const mapping = this.getMappingConfig(dataType);
    if (!mapping) {
      return pcData;
    }

    const convertedData = { ...pcData };
    
    // 处理字段类型转换
    Object.keys(mapping.typeMapping).forEach(field => {
      if (convertedData.hasOwnProperty(field)) {
        const fieldConfig = mapping.typeMapping[field];
        const converter = fieldConfig.converter.pcToWechat;
        
        if (converter) {
          try {
            convertedData[field] = converter(convertedData[field]);
          } catch (error) {
            console.error(`字段 ${field} 转换失败:`, error);
            // 保持原值
          }
        }
      }
    });

    // 根据同步策略过滤字段
    Object.keys(mapping.syncStrategy).forEach(field => {
      if (mapping.syncStrategy[field] === 'pc_only') {
        delete convertedData[field];
      }
    });

    return convertedData;
  }

  /**
   * 转换小程序端数据到PC端格式
   */
  convertWechatToPc(dataType, wechatData) {
    const mapping = this.getMappingConfig(dataType);
    if (!mapping) {
      return wechatData;
    }

    const convertedData = { ...wechatData };
    
    // 处理字段类型转换
    Object.keys(mapping.typeMapping).forEach(field => {
      if (convertedData.hasOwnProperty(field)) {
        const fieldConfig = mapping.typeMapping[field];
        const converter = fieldConfig.converter.wechatToPc;
        
        if (converter) {
          try {
            convertedData[field] = converter(convertedData[field]);
          } catch (error) {
            console.error(`字段 ${field} 转换失败:`, error);
            // 保持原值
          }
        }
      }
    });

    return convertedData;
  }

  /**
   * 获取映射配置
   */
  getMappingConfig(dataType) {
    const mappingConfigs = {
      'customers': this.customerFieldMapping,
      'orders': this.orderFieldMapping,
      'products': null // 产品数据暂不需要映射
    };
    
    return mappingConfigs[dataType];
  }

  /**
   * 检测数据差异
   */
  detectDataDifferences(dataType, pcData, wechatData) {
    const mapping = this.getMappingConfig(dataType);
    if (!mapping) {
      return {
        hasDifferences: false,
        differences: []
      };
    }

    const differences = [];
    
    // 检查类型映射字段
    Object.keys(mapping.typeMapping).forEach(field => {
      if (pcData.hasOwnProperty(field) && wechatData.hasOwnProperty(field)) {
        const fieldConfig = mapping.typeMapping[field];
        const pcValue = pcData[field];
        const wechatValue = wechatData[field];
        
        // 转换后比较
        const convertedPcValue = fieldConfig.converter.pcToWechat(pcValue);
        
        if (convertedPcValue !== wechatValue) {
          differences.push({
            field,
            type: 'value_mismatch',
            pcValue,
            wechatValue,
            convertedPcValue,
            message: `字段 ${field} 值不匹配: PC端(${pcValue}) -> 小程序端(${convertedPcValue}) vs 实际(${wechatValue})`
          });
        }
      }
    });

    // 检查缺失字段
    Object.keys(mapping.syncStrategy).forEach(field => {
      if (mapping.syncStrategy[field] === 'bidirectional') {
        const pcHasField = pcData.hasOwnProperty(field);
        const wechatHasField = wechatData.hasOwnProperty(field);
        
        if (pcHasField && !wechatHasField) {
          differences.push({
            field,
            type: 'missing_in_wechat',
            message: `字段 ${field} 在小程序端缺失`
          });
        } else if (!pcHasField && wechatHasField) {
          differences.push({
            field,
            type: 'missing_in_pc',
            message: `字段 ${field} 在PC端缺失`
          });
        }
      }
    });

    return {
      hasDifferences: differences.length > 0,
      differences
    };
  }

  /**
   * 获取字段映射信息
   */
  getFieldMappingInfo(dataType) {
    const mapping = this.getMappingConfig(dataType);
    if (!mapping) {
      return null;
    }

    return {
      dataType,
      fieldMapping: mapping.fieldMapping,
      typeMapping: Object.keys(mapping.typeMapping).reduce((acc, field) => {
        acc[field] = {
          pcType: mapping.typeMapping[field].pcType,
          wechatType: mapping.typeMapping[field].wechatType,
          strategy: mapping.syncStrategy[field]
        };
        return acc;
      }, {}),
      syncStrategy: mapping.syncStrategy
    };
  }
}

export default new DataMappingService();