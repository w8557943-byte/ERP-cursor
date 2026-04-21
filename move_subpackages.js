const fs = require('fs');
const path = require('path');

const moves = [
  // Order Subpackage
  { src: 'pages/order/detail', dest: 'pages/order-sub/detail' },
  { src: 'pages/order/create', dest: 'pages/order-sub/create' },
  { src: 'pages/order-create', dest: 'pages/order-sub/order-create' },

  // Production Subpackage
  { src: 'pages/production/detail', dest: 'pages/production-sub/detail' },
  { src: 'pages/production-detail', dest: 'pages/production-sub/production-detail' },
  { src: 'pages/workorder-print', dest: 'pages/production-sub/workorder-print' },
  { src: 'pages/print-quality', dest: 'pages/production-sub/print-quality' },

  // Management Subpackage
  { src: 'pages/data-management', dest: 'pages/management-sub/data-management' },
  { src: 'pages/management/permissions', dest: 'pages/management-sub/management/permissions' },
  { src: 'pages/management/roles', dest: 'pages/management-sub/management/roles' },
  { src: 'pages/management/users', dest: 'pages/management-sub/management/users' },
  { src: 'pages/customers', dest: 'pages/management-sub/customers' },

  // Shipping Subpackage
  { src: 'pages/shipping/list', dest: 'pages/shipping-sub/list' },
  { src: 'pages/shipping/detail', dest: 'pages/shipping-sub/detail' },
  { src: 'pages/shipping/scan-generate', dest: 'pages/shipping-sub/scan-generate' },
  { src: 'pages/shipping/tracking', dest: 'pages/shipping-sub/tracking' },

  // Purchase Subpackage folders
  { src: 'pages/purchase/detail', dest: 'pages/purchase-sub/detail' },
  { src: 'pages/purchase/goods-purchase', dest: 'pages/purchase-sub/goods-purchase' },
  { src: 'pages/purchase/raw-material-purchase', dest: 'pages/purchase-sub/raw-material-purchase' },

  // Inventory Subpackage
  { src: 'pages/inventory', dest: 'pages/inventory-sub/inventory' },

  // System Subpackage
  { src: 'pages/deploy-test', dest: 'pages/system-sub/deploy-test' },
  { src: 'pages/db-init', dest: 'pages/system-sub/db-init' },
];

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    let entries = fs.readdirSync(src, { withFileTypes: true });

    for (let entry of entries) {
        let srcPath = path.join(src, entry.name);
        let destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function move(src, dest) {
  const srcPath = path.resolve(__dirname, src);
  const destPath = path.resolve(__dirname, dest);
  
  if (!fs.existsSync(srcPath)) {
    console.log(`Skipping ${src}: Source does not exist`);
    return;
  }

  // Create destination parent directory if not exists
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Check if it's a file or directory
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    // If destination exists, we might need to merge or move contents
    if (!fs.existsSync(destPath)) {
        // Simple rename/move
        try {
            fs.renameSync(srcPath, destPath);
            console.log(`Moved dir ${src} to ${dest}`);
        } catch (e) {
            console.error(`Failed to rename ${src} to ${dest}: ${e.message}. Trying copy+delete.`);
            try {
                copyDir(srcPath, destPath);
                fs.rmSync(srcPath, { recursive: true, force: true });
                console.log(`Copied and deleted ${src} to ${dest}`);
            } catch (e2) {
                 console.error(`Failed to copy+delete ${src}: ${e2.message}`);
            }
        }
    } else {
        // Destination directory exists (e.g. created by previous step)
        // Move contents
        const files = fs.readdirSync(srcPath);
        for (const file of files) {
            const childSrc = path.join(srcPath, file);
            const childDest = path.join(destPath, file);
            try {
                fs.renameSync(childSrc, childDest);
                 console.log(`Moved content ${file} from ${src} to ${dest}`);
            } catch (e) {
                 console.error(`Failed to move content ${file}: ${e.message}`);
            }
        }
        // Remove empty source dir
        try {
           if (fs.readdirSync(srcPath).length === 0) {
               fs.rmdirSync(srcPath);
               console.log(`Removed empty source dir ${src}`);
           }
        } catch(e) {}
    }
  } else {
      // File
      try {
        fs.renameSync(srcPath, destPath);
        console.log(`Moved file ${src} to ${dest}`);
      } catch (e) {
          console.error(`Failed to move file ${src}: ${e.message}`);
      }
  }
}

// Execute regular moves
moves.forEach(m => move(m.src, m.dest));

// Special handling for Purchase files (purchase.*)
const purchaseSrc = path.resolve(__dirname, 'pages/purchase');
const purchaseDest = path.resolve(__dirname, 'pages/purchase-sub/purchase');

if (fs.existsSync(purchaseSrc)) {
    if (!fs.existsSync(purchaseDest)) fs.mkdirSync(purchaseDest, { recursive: true });
    
    const files = fs.readdirSync(purchaseSrc);
    for (const file of files) {
        if (file.startsWith('purchase.')) {
             const srcF = path.join(purchaseSrc, file);
             const destF = path.join(purchaseDest, file);
             try {
                fs.renameSync(srcF, destF);
                console.log(`Moved ${file} to purchase-sub/purchase`);
             } catch(e) {
                 console.error(`Failed to move ${file}: ${e.message}`);
             }
        }
    }
    // Clean up if empty
    try {
        if (fs.readdirSync(purchaseSrc).length === 0) {
            fs.rmdirSync(purchaseSrc);
            console.log('Removed empty pages/purchase');
        }
    } catch(e) {}
}

// Special handling for Login test files
const loginSrc = path.resolve(__dirname, 'pages/login');
const loginDest = path.resolve(__dirname, 'pages/system-sub/login');

if (fs.existsSync(loginSrc)) {
    if (!fs.existsSync(loginDest)) fs.mkdirSync(loginDest, { recursive: true });
    
    const files = fs.readdirSync(loginSrc);
    for (const file of files) {
        if (file.startsWith('test-login.')) {
             const srcF = path.join(loginSrc, file);
             const destF = path.join(loginDest, file);
             try {
                fs.renameSync(srcF, destF);
                console.log(`Moved ${file} to system-sub/login`);
             } catch(e) {
                 console.error(`Failed to move ${file}: ${e.message}`);
             }
        }
    }
}
