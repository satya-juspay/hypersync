import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, GitBranch, User, Calendar, Hash, FileText, GitCommit } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/status-badge";
import { Navbar } from "@/components/navbar";
import { EditPRForm } from "@/components/edit-pr-form";
import { prUrl } from "@/lib/bitbucket";

const REPO = "hyper-widget";

function fmt(date: Date | null | string | undefined) {
  if (!date) return "—";
  return new Date(date as string).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetaCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium text-blue-900">{children}</div>
    </div>
  );
}

/** Parse `- **label** - value` style description into structured rows */
function parseDescription(text: string): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Match: - **label** optionally followed by (- value) or just (value)
    // Handles: "- **label** - val", "- **label**- val", "- **label** val", "- **label**"
    const match = line.match(/^-\s+\*\*(.+?)\*\*\s*-?\s*(.*)?$/);
    if (match) {
      // Strip Bitbucket attachment markdown images: ![text](attachment:...)
      const val = (match[2] ?? "").replace(/!\[.*?\]\(attachment:[^)]*\)/g, "").trim();
      rows.push({ label: match[1].trim(), value: val });
    } else if (rows.length > 0) {
      // Continuation line — append to last row's value (strip attachment images too)
      const cleaned = line.replace(/!\[.*?\]\(attachment:[^)]*\)/g, "").trim();
      if (!cleaned) continue;
      const last = rows[rows.length - 1];
      last.value = last.value ? `${last.value}\n${cleaned}` : cleaned;
    }
  }

  return rows;
}

/** Render a value string — turns URLs into clickable links */
function RichValue({ text }: { text: string }) {
  if (!text) return <span className="text-blue-300">—</span>;

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return (
    <>
      {parts.map((part, i) =>
        urlRegex.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 break-all text-blue-600 hover:underline"
          >
            {part}
            <ExternalLink className="inline h-3 w-3 shrink-0" />
          </a>
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        )
      )}
    </>
  );
}

export default async function PRDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pr = await prisma.releasePR.findUnique({ where: { id } });

  if (!pr) notFound();

  const commitShas = (pr.commitShas as string[] | null) ?? [];
  const changedFiles = (pr.changedFiles as string[] | null) ?? [];

  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <Navbar backHref="/" />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        {/* Header */}
        <div className="rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <StatusBadge status={pr.syncStatus} />
            <a
              href={prUrl(REPO, pr.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-sm text-blue-600 hover:underline"
            >
              #{pr.id}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {pr.mainPrId && (
              <span className="text-xs text-blue-400">
                Main PR:{" "}
                <a
                  href={prUrl(REPO, pr.mainPrId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  #{pr.mainPrId}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-xl font-bold leading-snug text-blue-900">
              {pr.title}
            </h1>
            <div className="shrink-0">
              <EditPRForm
                id={pr.id}
                currentSyncStatus={pr.syncStatus}
                currentMainPrId={pr.mainPrId}
              />
            </div>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetaCard icon={<User className="h-3.5 w-3.5" />} label="Author">
            {pr.author}
          </MetaCard>
          <MetaCard icon={<Hash className="h-3.5 w-3.5" />} label="Jira Key">
            {pr.jiraKey ? (
              <span className="font-mono">{pr.jiraKey}</span>
            ) : (
              <span className="text-blue-300">—</span>
            )}
          </MetaCard>
          <MetaCard
            icon={<GitBranch className="h-3.5 w-3.5" />}
            label="Release Branch"
          >
            <span className="font-mono text-xs">{pr.releaseBranch}</span>
          </MetaCard>
          <MetaCard
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Merged At"
          >
            {fmt(pr.mergedAt)}
          </MetaCard>
          <MetaCard
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Created At"
          >
            {fmt(pr.createdAt)}
          </MetaCard>
          <MetaCard
            icon={<Calendar className="h-3.5 w-3.5" />}
            label="Updated At"
          >
            {fmt(pr.updatedAt)}
          </MetaCard>
          {pr.mergeCommitSha && (
            <MetaCard
              icon={<GitCommit className="h-3.5 w-3.5" />}
              label="Merge Commit"
            >
              <span className="font-mono text-xs">{pr.mergeCommitSha}</span>
            </MetaCard>
          )}
        </div>

        {/* Description */}
        {pr.description && (() => {
          const rows = parseDescription(pr.description!);
          return rows.length > 0 ? (
            <div className="rounded-xl border border-blue-100 bg-white shadow-sm">
              <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600">
                <FileText className="h-3.5 w-3.5" />
                Description
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-blue-50">
                  {rows.map(({ label, value }) => (
                    <tr key={label} className="align-top">
                      <td className="w-48 shrink-0 px-5 py-3 text-xs font-semibold text-blue-500">
                        {label}
                      </td>
                      <td className="px-5 py-3 text-blue-900">
                        <RichValue text={value} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
                <FileText className="h-3.5 w-3.5" />
                Description
              </div>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-blue-900">
                {pr.description}
              </pre>
            </div>
          );
        })()}

        {/* Changed Files */}
        {changedFiles.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Changed Files{" "}
                <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                  {changedFiles.length}
                </span>
              </span>
            </div>
            <ul className="divide-y divide-blue-50">
              {changedFiles.map((file, i) => (
                <li
                  key={i}
                  className="px-5 py-2 font-mono text-xs text-blue-800"
                >
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Commit SHAs */}
        {commitShas.length > 0 && (
          <div className="rounded-xl border border-blue-100 bg-white shadow-sm">
            <div className="border-b border-blue-50 bg-blue-50/60 px-5 py-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Commits{" "}
                <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                  {commitShas.length}
                </span>
              </span>
            </div>
            <ul className="divide-y divide-blue-50">
              {commitShas.map((sha, i) => (
                <li
                  key={i}
                  className="px-5 py-2 font-mono text-xs text-blue-500"
                >
                  {sha}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
