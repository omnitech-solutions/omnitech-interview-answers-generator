# products/interview/src/frontend/studio/live/overlay/panels/behaviour-flags-setting.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/behaviour-flags-setting.tsx` (header-comment fallback)_

Settings › Behaviour: the product's behaviour flags (BEHAVIOUR_FLAGS in the
contracts), one control per row of the registry. The Studio holds them; this
reads what is in force and changes one at a time. A flag the host set in the
environment is shown as it is and cannot be changed here. Until the Studio
has answered there is nothing to show, rather than a control that may lie.

[SAFETY] Each line of help says what the flag really does and when a change
takes hold; the words are the registry's, so they cannot drift from it.
