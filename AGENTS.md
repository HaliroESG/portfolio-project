# Portfolio Project - Agent Guidelines

## Project Structure

This is a **monorepo** containing:

- **Frontend** (`frontend/`): Next.js 14 application with TypeScript, Tailwind CSS, and Shadcn/UI
- **Backend** (`backend/`): Python ETL scripts for financial data synchronization with Supabase

## Frontend Stack

- **Framework**: Next.js 14
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS
- **UI Components**: Shadcn/UI
- **Design System**: High Contrast Financial UI
  - Light mode: Slate-950 text, shadow-2xl for depth
  - Dark mode: Custom dark theme with high contrast
- **State Management**: React hooks (useState, useEffect)
- **Database**: Supabase (client-side)

### Frontend Guidelines

- Use `"use client"` directive for client components
- Follow TypeScript strict standards
- Use Tailwind utility classes for styling
- Path aliases: `@/*` maps to `frontend/` root (configured in `tsconfig.json`)
- Component structure: Co-locate related components
- Financial UI standards: Maintain high contrast, use shadow-2xl in light mode

## Backend Stack

- **Language**: Python 3.11
- **Libraries**: yfinance, supabase, pandas, numpy, gspread, oauth2client, scipy, statsmodels
- **Database**: Supabase (server-side)
- **CI/CD**: GitHub Actions (scheduled runs)
- **Dependencies**: Managed via `backend/requirements.txt` with pinned versions for stability

### Backend Guidelines

- Follow PEP 8 coding standards
- Use Pydantic for data validation when applicable
- Environment variables: Load from GitHub Secrets in CI/CD
- Error handling: Comprehensive try/except blocks with logging
- Supabase interaction: Use service key for backend operations

## Monorepo Interdependencies

- **Data Flow**: Backend scripts → Supabase → Frontend reads
- **Type Safety**: When modifying backend data structures, update `frontend/types.ts`
- **Synchronization**: Backend runs on schedule via GitHub Actions

## Architecture Reference

See `.cursor/rules/architecture.mdc` for detailed architecture documentation.

## Development Workflow

1. **Frontend Development**: Work in `frontend/` directory
2. **Backend Development**: Work in `backend/` directory
3. **Type Alignment**: When backend data changes, verify frontend types match
4. **Testing**: Test locally before pushing to trigger CI/CD
