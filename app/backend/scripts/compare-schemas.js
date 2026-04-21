
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

mongoose.connect = async () => {};
mongoose.createConnection = () => ({ model: () => {} });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../src');

const mapMongooseType = (path) => {
  const type = path.instance;
  const normalized = String(type || '').toLowerCase();
  if (type === 'String') return 'STRING';
  if (type === 'Number') return 'NUMBER';
  if (type === 'Boolean') return 'BOOLEAN';
  if (type === 'Date') return 'DATE';
  if (normalized === 'objectid') return 'STRING';
  if (type === 'Array') return 'JSON'; // Arrays are JSON in local
  if (type === 'Embedded') return 'JSON'; // Embedded docs are JSON
  if (type === 'Mixed') return 'JSON';
  return type.toUpperCase();
};

const mapSequelizeType = (attr) => {
  const type = attr.type.constructor.name; // e.g., 'STRING', 'INTEGER', 'JSON'
  if (type === 'STRING' || type === 'TEXT' || type === 'CHAR') return 'STRING';
  if (type === 'INTEGER' || type === 'FLOAT' || type === 'DOUBLE' || type === 'DECIMAL' || type === 'NUMBER') return 'NUMBER';
  if (type === 'BOOLEAN') return 'BOOLEAN';
  if (type === 'DATE' || type === 'DATEONLY') return 'DATE';
  if (type === 'JSON' || type === 'JSONB' || type === 'JSONTYPE') return 'JSON';
  if (type === 'ENUM') return 'STRING';
  return type;
};

const isCompatibleType = (cloudType, localType) => {
  if (cloudType === localType) return true;
  if (cloudType === 'OBJECTID' && localType === 'STRING') return true;
  if (cloudType === 'MIXED' && localType === 'JSON') return true;
  if (cloudType === 'JSON' && localType === 'JSON') return true;
  if (cloudType === 'STRING' && localType === 'STRING') return true;
  if (cloudType === 'NUMBER' && localType === 'NUMBER') return true;
  if (cloudType === 'DATE' && localType === 'DATE') return true;
  return false;
};

const hasCloudNestedPaths = (mongooseModel, key) => {
  const prefix = `${key}.`;
  return Object.keys(mongooseModel.schema.paths).some((p) => p.startsWith(prefix));
};

const compareModels = async () => {
  const modelsToCompare = ['Order', 'Product', 'Customer', 'OrderSequence', 'OrderReservation', 'OrderNumberLog'];
  const diffs = {};

  for (const modelName of modelsToCompare) {
    console.log(`Comparing ${modelName}...`);
    try {
      // Import Mongoose Model
      const mongooseModelPath = path.join(ROOT_DIR, 'models', `${modelName}.js`);
      if (!fs.existsSync(mongooseModelPath)) {
        diffs[modelName] = { error: 'Mongoose model not found' };
        continue;
      }
      const { default: MongooseModel } = await import(`file://${mongooseModelPath}`);

      // Import Sequelize Model
      const sequelizeModelPath = path.join(ROOT_DIR, 'models', 'local', `${modelName}.js`);
      if (!fs.existsSync(sequelizeModelPath)) {
        diffs[modelName] = { error: 'Sequelize model not found' };
        continue;
      }
      const { default: SequelizeModel } = await import(`file://${sequelizeModelPath}`);

      const modelDiff = {
        missingInLocal: [],
        missingInCloud: [],
        typeMismatch: []
      };

      MongooseModel.schema.eachPath((pathname, schemaType) => {
        if (pathname === '__v' || pathname === '_id') return; // Skip internal fields

        const localAttr = SequelizeModel.rawAttributes[pathname];
        if (!localAttr && pathname.includes('.')) {
          const rootKey = pathname.split('.')[0];
          const rootAttr = SequelizeModel.rawAttributes[rootKey];
          if (rootAttr && mapSequelizeType(rootAttr) === 'JSON') return;
        }
        if (!localAttr) {
          modelDiff.missingInLocal.push({ field: pathname, type: mapMongooseType(schemaType) });
        } else {
          const mongooseType = mapMongooseType(schemaType);
          const sequelizeType = mapSequelizeType(localAttr);
          if (!isCompatibleType(mongooseType, sequelizeType)) {
            modelDiff.typeMismatch.push({
              field: pathname,
              cloudType: mongooseType,
              localType: sequelizeType
            });
          }
        }
      });

      Object.keys(SequelizeModel.rawAttributes).forEach(key => {
        if (key === 'id' || key === 'createdAt' || key === 'updatedAt') return; // Skip internal fields
        // Skip fields that are local-only (e.g. syncStatus, lastSyncedAt, cloudId)
        if (['syncStatus', 'lastSyncedAt', 'cloudId'].includes(key)) return;

        if (!MongooseModel.schema.paths[key] && !hasCloudNestedPaths(MongooseModel, key)) {
             // Check if it's a virtual or alias? For now assume strict schema.
             modelDiff.missingInCloud.push({ field: key, type: mapSequelizeType(SequelizeModel.rawAttributes[key]) });
        }
      });

      if (modelDiff.missingInLocal.length > 0 || modelDiff.missingInCloud.length > 0 || modelDiff.typeMismatch.length > 0) {
        diffs[modelName] = modelDiff;
      } else {
        diffs[modelName] = 'MATCH';
      }

    } catch (err) {
      console.error(`Error comparing ${modelName}:`, err);
      diffs[modelName] = { error: err.message };
    }
  }

  console.log('Comparison complete.');
  const reportPath = path.join(process.cwd(), 'schema-diff-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(diffs, null, 2));
  console.log(`Report saved to ${reportPath}`);
};

compareModels();
