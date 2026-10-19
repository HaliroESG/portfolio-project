import React from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { ResearchWorkspace } from '../../components/research/ResearchWorkspace'

createRoot(document.getElementById('root')).render(<ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
  <div style={{ padding: '5px 16px', background: '#fff7df', color: '#7d5416', font: '11px Arial,sans-serif' }}>RECETTE LOCALE · DONNÉES FICTIVES · AUCUNE CONNEXION SUPABASE</div>
  <ResearchWorkspace />
</ThemeProvider>)
