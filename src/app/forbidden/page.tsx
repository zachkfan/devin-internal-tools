import Link from "next/link";

export default async function Forbidden({ searchParams }: { searchParams: Promise<{ permission?: string }> }) {
  const { permission } = await searchParams;
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">
        Your role doesn&apos;t include <code>{permission}</code>. This attempt was recorded in the audit log.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-blue-700 hover:underline">Back home</Link>
    </div>
  );
}
