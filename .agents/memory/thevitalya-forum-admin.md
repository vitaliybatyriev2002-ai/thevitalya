---
name: thevitalya-forum-admin
description: theVitalya forum roles/moderation + media upload notes; keep firestore.rules and storage.rules in sync with client code.
---

- Roles enforced client-side (forum.ts/App.tsx) and in `firestore.rules` (repo root, undeployed by agent — user must paste into Firebase Console → Firestore → Rules → Publish). Keep rules in sync with forum.ts moderation logic (esp. reaction counter field paths).
- Firebase Storage previously had NO rules file/deploy at all, so image/video uploads on post/reply creation failed with a permission error. Added `storage.rules` (repo root) mirroring the auth model — also undeployed by agent, user must paste into Firebase Console → Storage → Rules → Publish.
- `uploadImage()` calls in App.tsx (handleNewPost/handleReply) previously had no catch block — a Storage permission error would silently abort post/reply creation with no feedback. Now wrapped in try/catch with a user-facing alert. Any future upload-adjacent flow should keep this pattern (never let uploadImage failures fail silently).
