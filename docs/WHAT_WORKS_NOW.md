# V2 Working Features

## Nexora roadmap and engineering status

- Phase 1 — Nexora ThinkMax: Ready for review. Optional, off by default, and built on the existing generation reservation, planner, council, validator, and event flow.
- Phase 2 — Screenshot-to-Website: Planned. Depends on explicit approval after ThinkMax; no implementation started.
- Phase 3 — Business-Knowledge Chatbot: Planned. Requires a future storage and ownership review; no implementation started.
- Phase 4 — Free-Tier Nexora Badge: Planned. Depends on verified billing entitlements; no implementation started.
- Phase 5 — Nexora Ultra Intelligence Engine: Approved for design and roadmap preservation only. It must remain server-side and requires explicit implementation approval after ThinkMax review.

### ThinkMax engineering decisions

- Preserve backward compatibility by treating the request flag as an optional strict boolean and omitting it from standard mobile requests.
- Reuse the existing Groq council configuration for a required architecture-refinement pass; ThinkMax fails explicitly when that pass is unavailable or invalid.
- Feed the validated refined plan and concise architecture brief into the existing builder/coder path rather than creating a second generation system.
- Preserve the existing flat `website_generation` reservation and refund/finalization lifecycle. No database, dependency, provider, or billing-schema change is required.
- Store only concise events and structured counts for the ThinkMax pass; raw model output and private reasoning are not recorded.

### ThinkMax validation status

- Passed: mobile and API TypeScript checks, repository-wide TypeScript checks, focused ThinkMax tests, existing API policy/file/delivery tests, mobile production build, an API production dry-run before the final review-only job-claim repair, and `git diff --check`.
- Environment note: the post-review Wrangler dry-run rerun was blocked by the execution environment's external-code policy; the repaired API still passes TypeScript and all local API tests.
- Known baseline issue: the unchanged root smoke test expects a jewellery plan to contain a `products` page, while the existing built-in planner returns its established jewellery page set.
- Remaining manual validation: a configured live-provider generation and Android UI/device test. No deployment or APK build has been performed.

## Implemented

- Real Supabase OTP login; no demo account
- Admin-approved subscriber access
- Two-device enforcement
- Subscription expiry and daily generation limit
- Built-in zero-cost planning brain
- Optional Gemini planning brain
- Multi-file React/Vite project generation
- Responsive preview
- SVG logo and SEO metadata
- Database-backed contact form
- AI website editing and version history
- GitHub OAuth start/callback and encrypted token storage
- GitHub repository creation and source push
- Vercel Integration start/callback and encrypted token storage
- Production Vercel deployment and saved live URL
- Project list with GitHub and live-site links
- Username/password admin login with server-side sessions and brute-force lockout
- Admin dashboard and subscriber approval

## External setup required

These features are implemented but cannot work until the owner's credentials are configured:

- Supabase OTP/database
- GitHub OAuth connection
- Vercel Integration connection
- Cloudflare deployment
- Optional Gemini API

## Not included yet

- Automatic FamApp payment confirmation
- Drag-and-drop visual editor
- AI image generation
- Custom-domain automation
- Full ecommerce checkout
- Advanced Vercel build-log auto-repair
