const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const backupPath = path.join(__dirname, '..', '.version.bak');

// Read package.json
const package = require(packagePath);

// Backup current version
fs.writeFileSync(backupPath, package.version);

// Update version
const timestamp = Math.floor(Date.now() / 1000);
package.version = `0.1.${timestamp}`;

// Write back to package.json
fs.writeFileSync(packagePath, JSON.stringify(package, null, 2)); 