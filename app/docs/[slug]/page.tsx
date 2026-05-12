export const dynamic = 'force-dynamic';

import fs from 'fs/promises';
import path from 'path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { requireUser } from '@/lib/auth';

const DOCS_DIR = path.join(process.cwd(), 'docs/sot-modules');
const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export default async function DocPage({ params }: { params: { slug: string } }) {
  await requireUser('read');

  if (!SLUG_RE.test(params.slug)) {
    notFound();
  }

  const filePath = path.join(DOCS_DIR, `${params.slug}.md`);
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    notFound();
  }

  return (
    <section style={{ padding: '2rem', maxWidth: '60rem', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link
          href="/docs"
          style={{ fontSize: '0.85rem', color: '#64748b', textDecoration: 'none' }}
        >
          ← All docs
        </Link>
      </div>

      <article className="sot-doc">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>

      <style>{`
        .sot-doc {
          color: #0f172a;
          line-height: 1.6;
          font-size: 0.95rem;
        }
        .sot-doc h1 { font-size: 1.75rem; margin: 1.5rem 0 0.75rem; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.35rem; }
        .sot-doc h2 { font-size: 1.35rem; margin: 1.75rem 0 0.5rem; color: #1e293b; }
        .sot-doc h3 { font-size: 1.1rem; margin: 1.25rem 0 0.5rem; color: #334155; }
        .sot-doc h4 { font-size: 1rem; margin: 1rem 0 0.4rem; color: #475569; }
        .sot-doc p { margin: 0.6rem 0; }
        .sot-doc ul, .sot-doc ol { margin: 0.6rem 0; padding-left: 1.5rem; }
        .sot-doc li { margin: 0.25rem 0; }
        .sot-doc code {
          background: #f1f5f9;
          padding: 0.1rem 0.35rem;
          border-radius: 3px;
          font-size: 0.85rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .sot-doc pre {
          background: #0f172a;
          color: #e2e8f0;
          padding: 1rem;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .sot-doc pre code { background: transparent; padding: 0; color: inherit; }
        .sot-doc blockquote {
          border-left: 4px solid #cbd5e1;
          background: #f8fafc;
          padding: 0.5rem 1rem;
          margin: 0.75rem 0;
          color: #475569;
        }
        .sot-doc table {
          border-collapse: collapse;
          margin: 0.75rem 0;
          font-size: 0.85rem;
          width: 100%;
        }
        .sot-doc th, .sot-doc td {
          border: 1px solid #e2e8f0;
          padding: 0.45rem 0.7rem;
          text-align: left;
          vertical-align: top;
        }
        .sot-doc th { background: #f1f5f9; font-weight: 600; }
        .sot-doc a { color: #0369a1; text-decoration: underline; }
        .sot-doc hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
        .sot-doc img { max-width: 100%; }
      `}</style>
    </section>
  );
}
