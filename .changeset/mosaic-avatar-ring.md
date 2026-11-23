---
'@clerk/mosaic': patch
---

Darken the edge ring on bordered avatars so it stays visible on light images, and a little more in dark mode so it shows around dark logos. This changes every bordered `Avatar`: user and organization avatars, provider icons, avatar upload, and the logos on `OAuthConsent`. The ring now uses `--cl-color-neutral-subtle`, so a theme that overrides it, or `--cl-color-neutral-alpha-200` or `-300`, changes this ring as well.
