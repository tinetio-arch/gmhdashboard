export const dynamic = 'force-dynamic';

import fs from 'fs/promises';
import path from 'path';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';

const DOCS_DIR = path.join(process.cwd(), 'docs/sot-modules');

type ModuleEntry = {
  slug: string;
  file: string;
  title: string;
  firstLine: string;
};

async function listModules(): Promise<ModuleEntry[]> {
  const files = await fs.readdir(DOCS_DIR);
  const mdFiles = files
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .sort();

  const entries = await Promise.all(
    mdFiles.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const content = await fs.readFile(path.join(DOCS_DIR, file), 'utf8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = (titleMatch?.[1] ?? slug).trim();
      const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      const firstLine = (lines[0] ?? '').replace(/^>\s*/, '').slice(0, 200);
      return { slug, file, title, firstLine };
    }),
  );

  return entries;
}

export default async function DocsIndexPage() {
  await requireUser('read');
  const modules = await listModules();

  return (
    <section style={{ padding: '2rem', maxWidth: '60rem', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>GMH Dashboard — Documentation</h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', maxWidth: '44rem' }}>
        Source-of-truth reference for the GMH Dashboard system. These are the same modules used by the AntiGravity
        AI assistant when working on the codebase. Start with the INDEX for the full table of contents.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {modules.map((m) => (
          <li
            key={m.slug}
            style={{
              padding: '0.9rem 0',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <Link
              href={`/docs/${m.slug}`}
              style={{ fontSize: '1rem', fontWeight: 600, color: '#0369a1', textDecoration: 'none' }}
            >
              {m.title}
            </Link>
            {m.firstLine ? (
              <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '0.25rem' }}>{m.firstLine}</div>
            ) : null}
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem', fontFamily: 'monospace' }}>
              {m.file}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
