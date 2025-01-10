const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const backupPath = path.join(__dirname, '..', '.version.bak');

// Read backup version
const backupVersion = fs.readFileSync(backupPath, 'utf8');

// Read package.json
const package = require(packagePath);

// Restore version
package.version = backupVersion;

// Write back to package.json
fs.writeFileSync(packagePath, JSON.stringify(package, null, 2));

// Delete backup file
fs.unlinkSync(backupPath); 