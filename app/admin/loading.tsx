export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 h-[57px] border-b border-blue-100 bg-surface/90" />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        <div className="flex animate-pulse items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-blue-100" />
          <div>
            <div className="mb-2 h-6 w-32 rounded bg-blue-100" />
            <div className="h-4 w-56 rounded bg-blue-100" />
          </div>
        </div>

        <div className="animate-pulse rounded-lg border border-blue-100 bg-surface p-5 shadow-sm">
          <div className="mb-4 h-5 w-32 rounded bg-blue-100" />
          <div className="h-11 w-full rounded-lg bg-blue-100" />
        </div>

        <div className="animate-pulse rounded-lg border border-blue-100 bg-surface p-5 shadow-sm">
          <div className="mb-4 h-5 w-24 rounded bg-blue-100" />
          <div className="mb-4 h-10 w-full rounded-lg bg-blue-100" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-10 rounded-lg bg-blue-100" />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
