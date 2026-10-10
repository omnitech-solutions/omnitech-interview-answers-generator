# products/interview/src/frontend/studio/live/overlay/panels/behaviour-flags-form.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/behaviour-flags-form.ts` (header-comment fallback)_

Settings › Behaviour as a declared form: every part of it is read from the
registry (BEHAVIOUR_FLAGS in the contracts), so a flag added there is drawn,
validated and saved here with no further code. The library's DynamicForm
draws it; nothing in this file is React.
