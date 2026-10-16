---
name: react-review
description: Reviews StitchVue React and TypeScript UI for renders, state, and gallery rules. Use when changing components, hooks, stores, SCSS, gallery tiles, zoom, sidebar, or navbar.
---

# React review

React renders. It does not scan disks, decode images, or talk to SQLite directly.

## Reject

- Loading an original image in the gallery (`<img src={original}>`, `URL.createObjectURL` on a full file, fetch of the source photo)
- A DOM node per photo; large folders must be virtualized
- Filesystem logic, directory walks, or thumbnail encoding in components
- New global state for data that can stay local
- `useEffect` that copies props into state or refetches on every render
- Unstable object/array/function props on virtualized rows
- Expensive layout or sort work during render of every tile
- Missing virtualization on a list that can reach thousands of items
- Premature `memo` / `useMemo` / `useCallback` with no render evidence
- Large components that mix gallery, sidebar, and viewer
- MUI, Bootstrap, Tailwind, Redux, or another UI framework

## Expect

- TypeScript functional components
- SCSS Modules
- Zustand only where state is shared across the shell
- Gallery shows cached thumbnails and placeholders
- Zoom changes layout geometry; it does not reread originals
- Animations use `transform` and `opacity`
- Folder tree loads a level at a time

## Result

List findings as `bug`, `perf`, or `scope`. `scope` means an unrelated rewrite — do not do it inside the current task.
