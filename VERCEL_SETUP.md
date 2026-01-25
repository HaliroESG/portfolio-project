# Vercel Deployment Setup Guide

This guide explains how to configure Vercel to deploy the frontend application from this monorepo.

## Project Configuration

### Root Directory

1. Go to your Vercel project settings
2. Navigate to **Settings** → **General**
3. Set **Root Directory** to: `frontend`

This tells Vercel to treat the `frontend/` directory as the project root.

### Build Settings

Vercel will automatically detect Next.js, but verify these settings:

- **Framework Preset**: Next.js
- **Build Command**: `npm run build` (default, runs from `frontend/` directory)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)

### Environment Variables

Add the following environment variables in **Settings** → **Environment Variables**:

#### Required Variables

- `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase anonymous/public key

#### Optional Variables

- `NEXT_PUBLIC_APP_URL`: Your application URL (if needed for redirects)

### Environment Configuration

Set environment variables for all environments:
- **Production**
- **Preview**
- **Development**

## Deployment Process

1. **Connect Repository**: Link your GitHub repository to Vercel
2. **Configure Root Directory**: Set to `frontend` as described above
3. **Add Environment Variables**: Configure all required variables
4. **Deploy**: Vercel will automatically deploy on push to main branch

## Verification

After deployment, verify:

1. ✅ Application loads without errors
2. ✅ Supabase connection works (check browser console)
3. ✅ Data displays correctly from Supabase
4. ✅ Dark/light mode toggle works
5. ✅ All routes are accessible (`/`, `/geo`, `/fx`)

## Troubleshooting

### Build Fails

- Check that Root Directory is set to `frontend`
- Verify all environment variables are set
- Check build logs for specific errors

### Supabase Connection Issues

- Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are correct
- Check Supabase project settings and API keys
- Ensure Supabase project is active

### Import Errors

- All imports use relative paths, so they should work correctly
- If using path aliases (`@/*`), ensure `tsconfig.json` is configured correctly

## Notes

- The backend Python scripts run separately via GitHub Actions, not through Vercel
- Only the frontend Next.js application is deployed to Vercel
- Environment variables are separate from GitHub Secrets (used for backend CI/CD)
