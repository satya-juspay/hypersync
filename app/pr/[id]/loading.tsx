export default function PRDetailLoading() {
  return (
    <div className="min-h-screen bg-[#f0f4ff]">
      <div className="sticky top-0 z-50 h-[57px] border-b border-blue-100 bg-white/90" />

      <main className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        <div className="animate-pulse rounded-xl border border-blue-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex gap-3">
            <div className="h-6 w-24 rounded-full bg-blue-100" />
            <div className="h-6 w-16 rounded bg-blue-100" />
          </div>
          <div className="h-7 w-3/4 rounded bg-blue-100" />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
            >
              <div className="mb-3 h-3 w-24 rounded bg-blue-100" />
              <div className="h-5 w-2/3 rounded bg-blue-100" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
