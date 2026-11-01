# Personal Calendar

A simple personal calendar for appointments, tasks, reminders and a daily routine. Sign in with email and password; each user's data is private and synced across devices.

🔗 **Open the app: https://guillermojmn.github.io/personal_calendar/**

## Features

- **Month, week and day views.** Week and day views place each item in its time slot, with a red line marking the current time.
- **Repeating events** — daily, weekly, monthly or yearly (e.g. a class every Tuesday at 19:00).
- **Color-coded types:** appointment, task, reminder, work, personal, sport, birthday…
- **Tasks** with a checkbox to mark them as done.
- **To do:** a quick list for things you remember and don't want to forget — optionally with a due date. Overdue items are highlighted, and done items are kept in a collapsible list.
- **Daily routine:** things to do every day (e.g. drink 2 L of water), with a progress bar. The month view shows a ✓ on days you completed it.
- **Search** by title, notes or location.
- Light / dark theme and mobile-friendly layout.
- Sign-in with email + password; data synced across devices.

## How to use

- **Click** a day → see what's planned in the side panel.
- **Double-click** a day (or a time slot in week/day view) → add something.
- **Click** a day number or a week header → open that day.
- **Click** any item → edit or delete it.
- Shortcuts: `←` / `→` previous / next, `T` today, `M` month, `W` week, `D` day, `N` new.

## Data and security

- Data is stored in [Supabase](https://supabase.com) (PostgreSQL). Nothing is stored in this repository.
- Sign-in uses Supabase Auth with email + password. Public sign-up is disabled, so only existing accounts can sign in.
- Every table has a `user_id` column and **Row Level Security**: each user can only read and write their own rows. Signed-out visitors can't access any data.
- The frontend only uses the Supabase **anon** key, which is public by design; the `service_role` key is never used.
- **⋯ → Export backup** downloads all your data as a `.json` file, which **Import backup** can load back.

## Setup

1. **Database:** run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor. It creates the `cal_*` tables and their RLS policies.
2. **Auth:** in Supabase → Authentication → URL Configuration, add the app URL to the *Redirect URLs* (used by the password-reset link).
3. **Secrets:** in GitHub → Settings → Secrets and variables → Actions, add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. **Pages:** in GitHub → Settings → Pages, set *Source* to **GitHub Actions**. Every push to `main` deploys the site via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which writes `config.js` from the secrets.

## Run locally

Copy `config.example.js` to `config.js`, fill in your project URL and anon key, then serve the folder (e.g. `npx serve .`) and open it in the browser. `config.js` is git-ignored.
