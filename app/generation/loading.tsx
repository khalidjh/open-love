// Shown instantly on navigation to the builder while its (large) client bundle
// loads, so clicking a project from the dashboard feels immediate instead of
// leaving the user on the previous page for a beat. Mirrors the split layout:
// chat rail on the left, preview surface on the right.
export default function GenerationLoading() {
  return (
    <div className="flex h-screen flex-col bg-[#fbfafd]">
      {/* Header bar — matches the builder chrome */}
      <div className="flex h-52 shrink-0 items-center gap-8 px-16">
        <img src="/etlaq-logo.svg" alt="Etlaq" className="h-[22px] w-auto" />
        <div className="h-16 w-96 animate-pulse rounded-8 bg-[#efeaf8]" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: chat rail skeleton */}
        <div className="hidden w-[440px] shrink-0 flex-col gap-12 p-16 md:flex">
          <div className="ml-auto h-32 w-40 animate-pulse rounded-16 bg-[#efeaf8]" />
          <div className="h-40 w-56 animate-pulse rounded-16 bg-[#f1eef7]" />
          <div className="ml-auto h-32 w-1/2 animate-pulse rounded-16 bg-[#efeaf8]" />
        </div>

        {/* Right: preview surface with a spinner */}
        <div className="flex flex-1 flex-col overflow-hidden p-0 md:p-8">
          <div className="flex flex-1 items-center justify-center overflow-hidden border-0 bg-white md:rounded-12 md:border md:border-[#ece8f4]">
            <div className="text-center">
              <div className="mx-auto mb-12 h-32 w-32 animate-spin rounded-full border-2 border-[#e2ddf0] border-t-[#6147D4]" />
              <p className="text-[14px] text-[#8b8798]">Opening your project…</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
