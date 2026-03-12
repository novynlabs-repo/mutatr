import { spawnSync } from 'node:child_process';

function findDeveloperIdIdentity() {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return null;
  }

  const line = result.stdout
    .split('\n')
    .find((entry) => entry.includes('"Developer ID Application:'));
  if (!line) {
    return null;
  }

  const match = line.match(/"([^"]+)"/);
  return match?.[1] ?? null;
}

const explicitSigningConfigured = ['CSC_LINK', 'CSC_NAME'].some((name) => {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
});
const developerIdIdentity = explicitSigningConfigured ? null : findDeveloperIdIdentity();
const env = { ...process.env };
const builderArgs = ['electron-builder', '--mac', ...process.argv.slice(2)];

if (!explicitSigningConfigured && !developerIdIdentity) {
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  builderArgs.push('-c.mac.identity=-');
  console.log('[mac-package] No Developer ID Application identity found. Using ad-hoc signing for local build.');
} else if (developerIdIdentity) {
  console.log(`[mac-package] Using local signing identity: ${developerIdIdentity}`);
} else {
  console.log('[mac-package] Using signing configuration from environment.');
}

const result = spawnSync('npx', builderArgs, {
  stdio: 'inherit',
  env,
});

process.exit(result.status ?? 1);
