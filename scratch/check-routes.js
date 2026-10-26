const fs = require('fs');

const content = fs.readFileSync('backend/src/docs/routes.ts', 'utf8');
const regex = /path:\s*['"]([^'"]+)['"]/g;
let match;
const paths = new Set();
while ((match = regex.exec(content)) !== null) {
  paths.add(match[1]);
}
console.log('Total documented backend paths: ' + paths.size);
for (const p of [...paths].sort()) {
  console.log(p);
}
