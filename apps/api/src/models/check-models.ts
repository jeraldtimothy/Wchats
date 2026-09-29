/**
 * `pnpm check-models`: asks each configured provider for its model list and
 * reports which provider_model_ids in seed/models.config.ts are valid.
 */
import type { Provider } from '@wchats/shared';
import { PROVIDER_LABELS } from '@wchats/shared';
import { seedModels } from '../../seed/models.config.js';
import { createProvidersFromEnv } from '../providers/index.js';
import { safeErrorMessage } from '../providers/util.js';

const registry = createProvidersFromEnv();
let invalid = 0;
let checked = 0;

for (const provider of Object.keys(PROVIDER_LABELS) as Provider[]) {
  const seeded = seedModels.filter((m) => m.provider === provider);
  console.log(`\n${PROVIDER_LABELS[provider]}`);
  if (!registry.isConfigured(provider)) {
    console.log('  – skipped: no API key in env');
    continue;
  }
  let available: Set<string>;
  try {
    available = new Set(await registry.get(provider).listModels());
  } catch (err) {
    console.log(`  ✗ could not list models: ${safeErrorMessage(err)}`);
    invalid += seeded.length;
    continue;
  }
  for (const m of seeded) {
    checked += 1;
    const ok = available.has(m.providerModelId);
    if (!ok) invalid += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${m.displayName.padEnd(24)} ${m.providerModelId}`);
  }
}

if (checked === 0 && invalid === 0) console.log('\nNo provider keys configured; nothing was checked.');
else if (invalid === 0) console.log(`\nAll ${checked} checked id(s) are valid.`);
else console.log(`\n${invalid} id(s) are not available to your keys.`);
process.exitCode = invalid === 0 ? 0 : 1;
