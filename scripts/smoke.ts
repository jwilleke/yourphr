/**
 * Smoke test: does the adopted stack actually hold a YourPHR corpus and answer FHIR searches?
 *
 * Deliberately uses MemoryRepository — the reference implementation that ships with
 * @medplum/fhir-router. That isolates one question (do the resources load and do searches return
 * what they should) from the question the spike exists to answer (can a SQLite-backed
 * FhirRepository do the same). If this fails, stop: nothing further is worth building.
 *
 *   npm run smoke -- --in phi/resources.ndjson
 */
import { MemoryRepository } from '@medplum/fhir-router';
import type { Resource, ResourceType } from '@medplum/fhirtypes';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--in');
  const input = resolve(i === -1 ? 'phi/resources.ndjson' : (argv[i + 1] ?? 'phi/resources.ndjson'));

  const lines = readFileSync(input, 'utf8').split('\n').filter(Boolean);
  const repo = new MemoryRepository();

  const counts: Record<string, number> = {};
  const rejected: { line: number; reason: string }[] = [];

  for (const [index, line] of lines.entries()) {
    let resource: Resource;
    try {
      resource = JSON.parse(line) as Resource;
    } catch (err) {
      rejected.push({ line: index + 1, reason: `unparseable JSON: ${(err as Error).message}` });
      continue;
    }
    if (!resource.resourceType) {
      rejected.push({ line: index + 1, reason: 'no resourceType' });
      continue;
    }
    try {
      await repo.createResource(resource);
      counts[resource.resourceType] = (counts[resource.resourceType] ?? 0) + 1;
    } catch (err) {
      // Worth reading carefully rather than ignoring: rejections here are where Medplum's identity
      // and validation model disagrees with what YourPHR stored. That seam is open question 1 in
      // docs/archive/typescript-stack-evaluation.md.
      rejected.push({ line: index + 1, reason: `${resource.resourceType}: ${(err as Error).message}` });
    }
  }

  console.log(`loaded ${lines.length - rejected.length}/${lines.length} resources\n`);
  for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(7)}  ${type}`);
  }

  if (rejected.length > 0) {
    console.log(`\n${rejected.length} rejected — first 10:`);
    for (const r of rejected.slice(0, 10)) {
      console.log(`  line ${r.line}: ${r.reason}`);
    }
  }

  // The actual claim under test: search semantics come from the library, not from hand-written
  // per-resource-type columns.
  console.log('\nsearches:');
  for (const type of Object.keys(counts).slice(0, 5)) {
    const bundle = await repo.search({ resourceType: type as ResourceType, count: 3 });
    const got = bundle.entry?.length ?? 0;
    console.log(`  ${type}?_count=3 -> ${got} entr${got === 1 ? 'y' : 'ies'} (total ${bundle.total ?? '?'})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
