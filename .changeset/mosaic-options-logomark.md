---
'@clerk/mosaic': minor
---

Add an `options` prop to `MosaicProvider` and `OAuthConsent`. Its first key, `logomark`, shows your own logomark, such as an `<svg>` or a `next/image` `<Image>`, in place of the one set in the Clerk Dashboard: `options={{ logomark: <Logo /> }}`. A component's `options` override the ones on `MosaicProvider` key by key, and `logomark: false` hides the logomark. A custom component passed as the logomark must spread the `className` it receives onto the element it renders. `OAuthConsent` also shows the Claude or ChatGPT logo when the OAuth application has no logo and redirects to one of those clients.
