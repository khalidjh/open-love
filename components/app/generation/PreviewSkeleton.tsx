// A Lovable-style skeleton for the preview surface. Instead of a bare spinner,
// we show a shimmering mock of a web app — browser chrome, a nav bar, a hero
// block and a content grid — so the wait reads as "your app is materializing"
// rather than "nothing is happening". Light theme, matching the builder chrome.
export default function PreviewSkeleton({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#fbfafd] p-8 md:p-16">
      <div className="flex flex-1 flex-col overflow-hidden rounded-12 border border-[#d8d2e6] bg-white">
        {/* Browser chrome */}
        <div className="flex shrink-0 items-center gap-8 border-b border-[#f0edf6] px-16 py-12">
          <div className="flex gap-6">
            <span className="h-10 w-10 rounded-full bg-[#efeaf8]" />
            <span className="h-10 w-10 rounded-full bg-[#efeaf8]" />
            <span className="h-10 w-10 rounded-full bg-[#efeaf8]" />
          </div>
          <div className="ml-8 h-20 flex-1 animate-pulse rounded-8 bg-[#f4f1fa]" />
        </div>

        {/* App body */}
        <div className="flex flex-1 flex-col gap-24 overflow-hidden p-24">
          {/* Nav row */}
          <div className="flex items-center justify-between">
            <div className="h-20 w-120 animate-pulse rounded-8 bg-[#efeaf8]" />
            <div className="flex gap-12">
              <div className="h-16 w-64 animate-pulse rounded-6 bg-[#f1eef7]" />
              <div className="h-16 w-64 animate-pulse rounded-6 bg-[#f1eef7]" />
              <div className="h-16 w-64 animate-pulse rounded-6 bg-[#f1eef7]" />
            </div>
          </div>

          {/* Hero */}
          <div className="flex flex-col items-center gap-16 py-24">
            <div className="h-36 w-1/2 animate-pulse rounded-10 bg-[#efeaf8]" />
            <div className="h-16 w-2/3 animate-pulse rounded-8 bg-[#f1eef7]" />
            <div className="h-16 w-1/3 animate-pulse rounded-8 bg-[#f1eef7]" />
            <div className="mt-8 h-40 w-140 animate-pulse rounded-10 bg-[#e7e0f7]" />
          </div>

          {/* Content grid */}
          <div className="grid grid-cols-1 gap-16 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-12 rounded-12 border border-[#f0edf6] p-16"
              >
                <div className="h-72 w-full animate-pulse rounded-8 bg-[#f4f1fa]" />
                <div className="h-14 w-2/3 animate-pulse rounded-6 bg-[#efeaf8]" />
                <div className="h-12 w-full animate-pulse rounded-6 bg-[#f1eef7]" />
                <div className="h-12 w-5/6 animate-pulse rounded-6 bg-[#f1eef7]" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Caption */}
      <div className="flex shrink-0 items-center justify-center gap-8 pt-16">
        <span className="h-14 w-14 animate-spin rounded-full border-2 border-[#cfc7e2] border-t-[#6147D4]" />
        <p className="text-[13px] text-[#6b6577]">{label ?? 'Starting your preview…'}</p>
      </div>
    </div>
  );
}
