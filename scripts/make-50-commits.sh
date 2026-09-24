#!/usr/bin/env bash
# Split current workspace changes into exactly 50 English conventional commits, then push.
# Usage: bash scripts/make-50-commits.sh [--push]
set -euo pipefail
cd "$(dirname "$0")/.."

DO_PUSH=false
[[ "${1:-}" == "--push" ]] && DO_PUSH=true

# Never commit secrets or the source zip
grep -q 'boutique-maman-etape2' .gitignore 2>/dev/null || echo "boutique-maman-etape2(1).zip" >> .gitignore

commit() {
  local msg="$1"
  shift
  local paths=()
  local p
  for p in "$@"; do
    if [ -e "$p" ] || git ls-files --error-unmatch "$p" >/dev/null 2>&1 || git status --porcelain -- "$p" 2>/dev/null | grep -q .; then
      paths+=("$p")
    fi
  done
  if [ "${#paths[@]}" -eq 0 ]; then
    echo "ERROR: no paths for: $msg" >&2
    exit 1
  fi
  git add -A -- "${paths[@]}"
  if git diff --cached --quiet; then
    echo "ERROR: empty stage for: $msg (paths: ${paths[*]})" >&2
    exit 1
  fi
  git commit -m "$msg"
  echo "✓ $msg"
}

echo "Creating 50 commits…"

# --- 1–5 bootstrap ---
commit "[chore]: update gitignore for env secrets and native folders" .gitignore
commit "[chore]: add Expo app config Metro and TypeScript settings" app.json metro.config.js tsconfig.json
commit "[chore]: add EAS build profile configuration" eas.json
commit "[chore]: add environment variable examples for app and admin" .env.example .env.admin.example
commit "[chore]: install Expo Router SQLite Supabase and UI dependencies" package.json package-lock.json

# --- 6–10 docs & data ---
commit "[docs]: add stage-2 requirements for accounts and sync" docs/CAHIER_DES_CHARGES_ETAPE2.md
commit "[docs]: add bilans inventaires and export requirements" docs/CAHIER_DES_CHARGES_BILANS.md
commit "[docs]: add setup guide and Claude handoff notes" docs/LISEZ-MOI.md docs/MESSAGE_POUR_CLAUDE_CODE.md
commit "[chore]: replace app icons and splash screen assets" \
  assets/images/icon.png assets/images/adaptive-icon.png \
  assets/images/favicon.png assets/images/splash-icon.png \
  assets/android-icon-background.png assets/android-icon-foreground.png \
  assets/android-icon-monochrome.png assets/favicon.png assets/icon.png assets/splash-icon.png
commit "[chore]: add seed articles JSON and Excel catalog with purchase prices" \
  assets/data/articles.json articles-boutique-maman.xlsx

# --- 11–15 theme & core libs ---
commit "[feat]: add brand color and typography tokens" src/theme/colors.ts src/theme/typography.ts
commit "[feat]: add theme hook for light and dark colors" src/theme/useTheme.ts
commit "[feat]: add CFA format helpers and stock state labels" src/lib/format.ts src/lib/stockState.ts
commit "[feat]: add phone identifiant helper and unit tests" src/lib/identifiant.ts src/lib/identifiant.test.ts
commit "[feat]: add config text UUID generator and Supabase client" src/lib/config.ts src/lib/uuid.ts src/lib/supabase.ts

# --- 16–17 sessions ---
commit "[feat]: add admin PIN session context" src/lib/AdminSession.tsx
commit "[feat]: add auth session with local boutique cache" src/lib/AuthSession.tsx

# --- 18–27 database ---
commit "[feat]: define SQLite schema v2 with UUID primary keys" src/db/schema.ts
commit "[feat]: add schema migration that resets local tables" src/db/migrate.ts
commit "[feat]: add shared article and mouvement TypeScript types" src/db/types.ts
commit "[feat]: add stock calculation SQL matching Supabase view" src/db/stockSql.ts
commit "[test]: cover stock math for sales entries and voids" src/db/stock.test.ts
commit "[feat]: add local settings key-value store" src/db/settings.ts
commit "[feat]: add article CRUD with computed stock" src/db/articles.ts
commit "[feat]: add ventes entrees corrections with cout_unitaire" src/db/mouvements.ts
commit "[feat]: add remote boutique download into local SQLite" src/db/remote.ts
commit "[feat]: add JSON seed fallback for empty boutiques" src/db/seed.ts

# --- 28–37 UI components ---
commit "[feat]: add reusable Button and BigButton components" src/components/Button.tsx src/components/BigButton.tsx
commit "[feat]: add screen Header component" src/components/Header.tsx
commit "[feat]: add scroll and list screen wrappers" src/components/ScreenScroll.tsx src/components/ScreenList.tsx
commit "[feat]: add category tabs for mèches and produits" src/components/CategoryTabs.tsx
commit "[feat]: add search bar for article lists" src/components/SearchBar.tsx
commit "[feat]: add alphabetic article list view" src/components/ArticleListView.tsx
commit "[feat]: add stock chip and quantity stepper" src/components/StockChip.tsx src/components/Stepper.tsx
commit "[feat]: add PIN pad and unlock gate" src/components/PinPad.tsx src/components/RequireUnlocked.tsx
commit "[feat]: add password field and confirm dialog" src/components/PasswordField.tsx src/components/ConfirmDialog.tsx
commit "[feat]: add bottom sheet and toast notifications" src/components/Sheet.tsx src/components/Toast.tsx

# --- 38–45 screens ---
commit "[feat]: add root layout with SQLite and auth providers" src/app/_layout.tsx
commit "[feat]: add home screen with daily totals and actions" src/app/index.tsx
commit "[feat]: add login screen with phone and password" src/app/connexion.tsx
commit "[feat]: add join-boutique screen with invitation code" src/app/rejoindre.tsx
commit "[feat]: add welcome PIN setup and catalog download" src/app/bienvenue.tsx
commit "[feat]: add article picker and quantity sale screens" src/app/pick.tsx src/app/qty.tsx
commit "[feat]: add day summary and stock remaining screens" src/app/day.tsx src/app/stock.tsx
commit "[feat]: add admin article manager PIN and edit screens" \
  src/app/admin/index.tsx src/app/admin/pin.tsx src/app/admin/change-pin.tsx src/app/admin/edit.tsx

# --- 46–50 scripts tooling docs cleanup ---
commit "[feat]: add script to create Maman account from Excel" scripts/creer-compte-maman.mjs
commit "[test]: add end-to-end schema verifier for stage 2" scripts/verifier-etape2.mjs
commit "[chore]: add ESLint config and remove legacy entrypoints" eslint.config.js App.tsx index.ts
commit "[docs]: add README with install launch and test commands" README.md
commit "[chore]: add commit batch script and auth error helpers" \
  scripts/make-50-commits.sh src/lib/errors.ts

# Safety net
git add -A
git reset HEAD -- .env .env.admin 'boutique-maman-etape2(1).zip' 2>/dev/null || true
if ! git diff --cached --quiet; then
  echo "WARNING: leftover files bundled into final fixup:" >&2
  git status --short >&2
  git commit -m "[chore]: include remaining untracked project files"
fi

NEW=$(git rev-list --count 071cf01..HEAD)
echo
echo "New commits since initial: $NEW"
git log --oneline -55

if $DO_PUSH; then
  echo
  echo "Pushing to origin…"
  git push -u origin HEAD
  echo "Push complete."
fi
