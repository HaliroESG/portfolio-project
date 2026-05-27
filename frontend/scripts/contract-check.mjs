import fs from 'node:fs';
import path from 'node:path';

const frontendDir = process.cwd();
const root = path.resolve(frontendDir, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(frontendDir).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));
const offenders = [];
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const starSelectRegex = /select\(\s*['\"]\*['\"]\s*\)/;
  if (starSelectRegex.test(txt)) offenders.push(path.relative(root, f));
}

const typesPath = path.join(frontendDir, 'types.ts');
const typesText = fs.readFileSync(typesPath, 'utf8');
const trendTokens = ['UNKNOWN', 'INSUFFICIENT_HISTORY'];
const missingTrendTokens = trendTokens.filter((t) => !typesText.includes(`'${t}'`));

const requiredInterfaces = ['NewsFeedRow', 'MacroIndicatorRow', 'GovernanceTargetRow', 'PortfolioDecisionItemRow', 'TridentStockInsightRow'];
const missingInterfaces = requiredInterfaces.filter((name) => !typesText.includes(`interface ${name}`));

const result = {
  pass: offenders.length === 0 && missingTrendTokens.length === 0 && missingInterfaces.length === 0,
  selectStarOffenders: offenders,
  missingTrendTokens,
  missingInterfaces,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
