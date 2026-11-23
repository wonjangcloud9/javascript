---
'@clerk/clerk-js': minor
'@clerk/shared': minor
'@clerk/mosaic': minor
---

Add `logomarkImageUrl` to `DisplayConfig`, the square logomark set for the application in the Clerk Dashboard. Mosaic's `OAuthConsent` shows this logomark filling its circle, and falls back to the application logo, fitted inside the circle, when none is set.
