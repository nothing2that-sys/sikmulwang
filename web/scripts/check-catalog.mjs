import { readFileSync } from 'node:fs';
import { validateCatalog } from '../src/lib/recommendation/catalog-contract.ts';
const data = JSON.parse(readFileSync(new URL('../src/data/official-catalog.json', import.meta.url), 'utf8'));
const catalog = validateCatalog(data);
console.log('Official catalog contract PASS:', catalog.plants.length, 'guide-only plants; no agricultural suitability approval');
