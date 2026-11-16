import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/** Alpha's safe ReactMarkdown composition, scoped to the actual model text.
 * Headings, facts, quantities and status labels are never inferred in the UI.
 * Existing plain narratives remain plain; new Markdown keeps its structure. */
export function BetaSummaryBody({ narrative }: { narrative: string }) {
  return <div className="exomind-selectable min-w-0 space-y-3 break-words text-[13px] leading-[1.8] [&>p:first-of-type]:text-strong">
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkBreaks]} components={{
        h1: ({ children }) => <h3 className="mt-1 text-base font-semibold leading-relaxed text-strong">{children}</h3>,
        h2: ({ children }) => <h3 className="mt-1 text-base font-semibold leading-relaxed text-strong">{children}</h3>,
        h3: ({ children }) => <h3 className="mt-1 text-base font-semibold leading-relaxed text-strong">{children}</h3>,
        h4: ({ children }) => <h4 className="pt-1 text-sm font-semibold leading-relaxed text-strong">{children}</h4>,
        h5: ({ children }) => <h4 className="pt-1 text-sm font-semibold leading-relaxed text-strong">{children}</h4>,
        h6: ({ children }) => <h4 className="pt-1 text-sm font-semibold leading-relaxed text-strong">{children}</h4>,
        p: ({ children }) => <p className="m-0 break-words">{children}</p>,
        ul: ({ children }) => <ul className="my-1 list-disc space-y-1.5 pl-5 marker:text-muted">{children}</ul>,
        ol: ({ children, start }) => <ol start={start} className="my-1 list-decimal space-y-1.5 pl-5 marker:text-muted">{children}</ol>,
        li: ({ children }) => <li className="pl-0.5 [&>p+p]:mt-1">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-strong">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        blockquote: ({ children }) => <blockquote className="space-y-1 border-l-2 border-input pl-3 text-secondary">{children}</blockquote>,
        hr: () => <hr className="border-input" />,
        pre: ({ children }) => <pre className="max-w-full overflow-x-auto rounded-lg bg-surface p-3 text-xs leading-relaxed">{children}</pre>,
        code: ({ children, className }) => <code className={`rounded bg-surface px-1 py-0.5 font-mono text-xs ${className ?? ''}`}>{children}</code>,
        table: ({ children }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-left text-xs leading-relaxed">{children}</table></div>,
        th: ({ children }) => <th className="border-b border-input bg-surface px-2 py-2 font-semibold text-strong">{children}</th>,
        td: ({ children }) => <td className="border-b border-input px-2 py-2 align-top">{children}</td>,
        // Model text cannot trigger remote image requests or execute raw HTML.
        img: ({ alt }) => <span className="text-secondary">{alt || '图片引用'}</span>,
        a: ({ children }) => <span>{children}</span>,
      }}>{narrative}</ReactMarkdown>
  </div>;
}
