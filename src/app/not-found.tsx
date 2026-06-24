import Link from 'next/link';

export default function NotFound() {
  return <main className="grid min-h-screen place-items-center bg-[#0d0e12] p-6 text-white"><div className="text-center"><p className="text-6xl font-black text-blue-400">404</p><h1 className="mt-3 text-2xl font-bold">Page not found</h1><Link href="/chat" className="mt-6 inline-block rounded-xl bg-brand-gradient px-5 py-3">Return to chats</Link></div></main>;
}
