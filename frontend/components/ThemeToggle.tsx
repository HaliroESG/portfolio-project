"use client"
import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const activeTheme = resolvedTheme || theme

  return (
    <button
      aria-label="Theme toggle"
      onClick={() => setTheme(activeTheme === "dark" ? "light" : "dark")}
      className="p-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
    >
      <Sun size={18} className="hidden dark:block text-amber-400" />
      <Moon size={18} className="block dark:hidden text-blue-500" />
    </button>
  )
}
