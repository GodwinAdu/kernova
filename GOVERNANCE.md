# Governance

How Kernova is run: who decides what, how changes get in, and how you can take on more responsibility.

Kernova is young and has one maintainer today. This document describes how that grows, and it will change as the community does.

## Roles

### Lead maintainer

**Godwin Adu** ([GodwinAdu](https://github.com/GodwinAdu)), who created Kernova.

- Sets the project's direction ([`docs/VISION.md`](docs/VISION.md), [`ROADMAP.md`](ROADMAP.md)) and owns the architecture
- Makes the final call when maintainers disagree
- Appoints maintainers and manages repository, npm, and release access
- Cuts releases

### Maintainers

Trusted contributors who look after the project day to day, usually one or more areas (a package, the docs, the language SDKs).

- Review and merge pull requests in their areas
- Triage issues: label them, reproduce bugs, and write up `good first issue`s
- Keep CI green and help contributors land their work
- Are listed in [Maintainers](#maintainers) and in [`.github/CODEOWNERS`](.github/CODEOWNERS)

### Contributors

Anyone who has had a pull request merged, or who helps with issues, reviews, documentation, or answering questions. Every contributor is credited in the release notes of the release that includes their work.

### Community

Everyone who uses Kernova, reports bugs, suggests ideas, or helps others. You don't need permission to take part: open an issue or start a discussion.

## How changes are made

**Most changes** (bug fixes, docs, tests, small features) go through a pull request from a fork, as described in [`CONTRIBUTING.md`](CONTRIBUTING.md). A pull request merges when CI passes and a maintainer for that area approves it. Nobody, including maintainers, pushes directly to `main`.

**Significant changes** start as an issue before any code, so the design can be agreed first. A change is significant if it:

- adds a package, or a new concept to the public API
- breaks existing users (anything that needs a major version)
- changes the Kernova protocol ([`docs/protocols`](docs/protocols)) or the object model in `@kernova/types`
- adds a runtime dependency to `@kernova/core`

Once agreed, the decision is recorded as an architecture decision record in [`docs/decisions/`](docs/decisions) (see `001-typescript-first.md` for the format), and the pull request links to it.

**Decisions** are made by consensus among the maintainers of the affected area. If they can't agree, the lead maintainer decides and explains why on the issue.

## Becoming a maintainer

Maintainers are invited, based on a track record rather than a number of pull requests. The lead maintainer looks for someone who has, over at least a few months:

- landed several substantial, well-tested changes
- reviewed other people's pull requests helpfully
- helped users in issues or discussions
- shown good judgment about Kernova's design and its users

If you'd like to become a maintainer, say so to the lead maintainer. New maintainers start with triage access and are given merge rights for their area after a trial period.

Maintainers who are inactive for six months, or who ask to step back, become emeritus maintainers. They're thanked in this file and can return by asking.

## Releases

Releases follow [Semantic Versioning](https://semver.org/) and are published from GitHub Actions with npm trusted publishing, so every package carries a provenance attestation and no one publishes from a personal machine. Only the lead maintainer can approve a release; the steps are in [`CONTRIBUTING.md`](CONTRIBUTING.md#releasing-maintainers).

## Licensing

Kernova is released under the [MIT License](LICENSE). Contributions are accepted under the same license: by opening a pull request, you agree that your contribution is licensed under MIT, as described in GitHub's [terms of service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license). There is no separate contributor agreement.

## Conduct and security

Everyone in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md). The maintainers enforce it.

Security vulnerabilities are reported privately, as described in [`SECURITY.md`](SECURITY.md), never in public issues.

## Changing this document

Changes to governance are made by pull request to this file, open for comment for at least a week, and approved by the lead maintainer.

## Maintainers

| Name | GitHub | Areas |
|------|--------|-------|
| Godwin Adu | [GodwinAdu](https://github.com/GodwinAdu) | Everything (lead maintainer) |
