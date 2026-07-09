---
name: thevitalya-forum-admin
description: theVitalya forum roles/moderation + media storage notes; keep firestore.rules in sync with client code.
---

- Roles enforced client-side (forum.ts/App.tsx) and in `firestore.rules` (repo root, undeployed by agent — user must paste into Firebase Console → Firestore → Rules → Publish). Keep rules in sync with forum.ts moderation logic (esp. reaction counter field paths).
- Firebase Storage is NOT usable on this project — it requires the paid Blaze plan and the user is on the free Spark plan (confirmed via screenshot of Firebase Console showing "upgrade project" gate). Do not reintroduce `firebase/storage` uploads without confirming the plan changed.
- Forum post/reply image attachments are instead compressed client-side (canvas downscale + JPEG re-encode, iterating quality down) into a base64 data URL and stored directly on the Firestore document (`imageUrl` field). Hard byte cap enforced before accepting, to stay safely under Firestore's ~1MiB document limit.
- `uploadImage()` (forum.ts) throws on failure (e.g. still-too-large-after-compression) — callers in App.tsx wrap it in try/catch with a user-facing alert; never let this fail silently again (it did once, when Storage permission errors weren't caught).
