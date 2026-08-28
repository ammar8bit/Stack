# StackTime UI Instructions

When adding or refining interaction and visual design, prefer these tools in this order when they are compatible with the project's architecture:

1. Motion for JavaScript for browser-native animation, transitions, and gesture effects in the current vanilla HTML/JavaScript implementation.
2. BKLit UI for data visualizations and chart components after the project is using React, Tailwind CSS, and shadcn/ui.
3. Kokonut UI for polished interactive UI components after the project is using React, Tailwind CSS, and shadcn/ui.

Do not introduce React-only BKLit UI or Kokonut UI code into the current standalone HTML implementation without first migrating the site to a compatible React/Tailwind/shadcn setup. Preserve StackTime's minimal, privacy-first experience and avoid unnecessary dependencies.
