"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="space-y-2 text-center">
          <p className="text-sm text-zinc-400">Something went wrong.</p>
          <button
            onClick={reset}
            className="text-xs text-emerald-500 hover:underline"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
