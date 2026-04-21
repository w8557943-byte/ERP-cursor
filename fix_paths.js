const fs = require('fs');
const path = require('path');

const filesToFix = [
  'pages/management-sub/customers/customers.js',
  'pages/management-sub/customers/customers.json',
  'pages/management-sub/customers/customers.wxss',
  'pages/management-sub/customers/add-customer/add-customer.js',
  'pages/management-sub/customers/add-customer/add-customer.json',
  'pages/management-sub/customers/add-customer/add-customer.wxss',
  'pages/management-sub/customers/edit/edit.js',
  'pages/management-sub/customers/edit/edit.json',
  'pages/management-sub/customers/edit/edit.wxss',
  'pages/order-sub/order-create/order-create.js',
  'pages/order-sub/order-create/order-create.json',
  'pages/order-sub/order-create/order-create.wxss',
  'pages/purchase-sub/purchase/purchase.js',
  'pages/purchase-sub/purchase/purchase.json',
  'pages/purchase-sub/purchase/purchase.wxss',
  'pages/inventory-sub/inventory/inventory.js',
  'pages/inventory-sub/inventory/inventory.json',
  'pages/inventory-sub/inventory/inventory.wxss',
  'pages/system-sub/deploy-test/deploy-test.js',
  'pages/system-sub/deploy-test/deploy-test.json',
  'pages/system-sub/deploy-test/deploy-test.wxss',
  'pages/system-sub/db-init/db-init.js',
  'pages/system-sub/db-init/db-init.json',
  'pages/system-sub/db-init/db-init.wxss',
  'pages/system-sub/login/test-login.js',
  'pages/system-sub/login/test-login.json',
  'pages/system-sub/login/test-login.wxss'
];

function fixFile(filePath) {
  const absPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(absPath)) {
    console.log(`Skipping ${filePath}: File not found`);
    return;
  }

  let content = fs.readFileSync(absPath, 'utf8');
  let originalContent = content;

  // Fix JS require/import and image src
  // Matches: require('...'), from '...', src='...'
  // Also handles JSON "path": "..." (less common for relative paths but possible in usingComponents)
  // And WXSS @import "..."
  
  // Regex for JS require/import/src
  // Captures: 1: prefix, 2: path, 3: suffix
  // We only target paths starting with ../
  const regex = /((?:require\(|from\s+|src=|url\()s*['"])([\.\/][^'"]+)(['"])/g;
  
  content = content.replace(regex, (match, prefix, p, suffix) => {
    if (p.startsWith('../')) {
      return `${prefix}../${p}${suffix}`;
    }
    return match;
  });

  // Regex for WXSS @import
  const wxssRegex = /(@import\s+['"])([\.\/][^'"]+)(['"])/g;
  content = content.replace(wxssRegex, (match, prefix, p, suffix) => {
    if (p.startsWith('../')) {
      return `${prefix}../${p}${suffix}`;
    }
    return match;
  });

  // Regex for JSON usingComponents
  // "component": "../../components/..."
  const jsonRegex = /("[\w-]+"\s*:\s*")([\.\/][^"]+)(")/g;
  content = content.replace(jsonRegex, (match, prefix, p, suffix) => {
    if (p.startsWith('../')) {
      return `${prefix}../${p}${suffix}`;
    }
    return match;
  });

  if (content !== originalContent) {
    fs.writeFileSync(absPath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  } else {
    // console.log(`No changes for ${filePath}`);
  }
}

filesToFix.forEach(fixFile);
