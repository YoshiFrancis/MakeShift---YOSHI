# MakeShift Repository Organization

## Repository Tree

```text
MakeShift/
├── .claude/
├── .github/
│   └── workflows/
├── backend/
│   └── src/
│       ├── API/
│       ├── audio/
│       ├── CV/
│       ├── MIDI/
│       └── __init__.py
├── docs/
│   └── organization.md
├── frontend/
│   ├── public/
│   ├── src/
│   │   └── app/
│   │       ├── calibration/
│   │       ├── documentation/
│   │       ├── tutorial/
│   │       ├── CameraContext.tsx
│   │       ├── globals.css
│   │       ├── layout.tsx
│   │       └── page.tsx
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   └── README.md
├── tests/
├── .gitignore
├── LICENSE
├── README.md
└── requirements.txt
```

## Branching Model

We use a fork-and-pull-request workflow:

- Each developer creates and works from their own fork of the repository.
- Feature or fix branches are created in the developer fork (for example: `feature/audio-sync`).
- Pull requests are opened from fork branches into the upstream repository `main` branch.
- All feature updates are merged through pull requests (no direct pushes to `main`).

## Code Development and Review Policy

### Pull Request Requirements

- Every code change must be submitted through a pull request.
- Every feature update must be merged through the PR process.
- PRs must target the upstream `main` branch from a branch in a personal fork.
- PR descriptions should clearly explain:
  - what changed
  - why it changed
  - how it was tested

### CI and Quality Gates

- CI must pass before a PR can be merged.
- CI checks include:
  - tests passing
  - code quality/lint/cleanliness checks passing
- PRs with failing CI checks are not eligible for merge.

### Review and Approval Rules

- At least one reviewer approval is required before merge.
- The required approval must be completed on the PR before it is merged into `main`.
- The merge to `main` happens only after:
  - CI passes
  - minimum reviewer approval threshold is met
