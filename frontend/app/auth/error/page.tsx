import Link from 'next/link'

export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 dark:bg-[#080A0F]">
      <section className="w-full max-w-md rounded-md border border-red-200 bg-white p-6 dark:border-red-900/50 dark:bg-[#0D1117]">
        <h1 className="text-lg font-black text-slate-950 dark:text-white">Lien invalide ou expiré</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-gray-400">
          Demandez un nouveau lien de connexion depuis l’écran sécurisé.
        </p>
        <Link href="/login" className="mt-6 inline-flex text-sm font-black text-emerald-600 dark:text-emerald-400">
          Revenir à la connexion
        </Link>
      </section>
    </main>
  )
}
