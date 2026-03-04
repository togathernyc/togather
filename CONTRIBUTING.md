# Contributing to Togather

Thank you for your interest in contributing to Togather! This guide will help you get started.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/togather.git
   cd togather
   ```
3. **Install dependencies:**
   ```bash
   pnpm install
   ```
4. **Set up environment variables:**
   ```bash
   cp .env.example .env.local
   # Fill in the required values
   ```
5. **Create a Convex development deployment:**
   ```bash
   npx convex dev
   ```
6. **Seed test data:**
   ```bash
   npx convex run functions/seed:seedDemoData
   ```
7. **Start development:**
   ```bash
   pnpm dev
   ```

## Development Workflow

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes following our coding standards (see `CLAUDE.md`)
3. Write tests for new functionality
4. Run the test suite:
   ```bash
   pnpm test        # Run tests across all packages
   pnpm test:e2e    # E2E tests (Playwright)
   pnpm lint        # Linter
   ```
5. Commit your changes with a descriptive message
6. Push to your fork and open a Pull Request

## Pull Request Guidelines

- Keep PRs focused on a single change
- Write a clear description of what the PR does and why
- Include test coverage for new features
- Ensure all CI checks pass
- Reference any related issues

## Coding Standards

- See `CLAUDE.md` for detailed coding standards and conventions
- Prefer simplicity over cleverness
- Write readable code with meaningful variable names
- Follow existing patterns in the codebase
- Use TypeScript strict mode

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bug reports
- Check existing issues before creating duplicates

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## The `/ee` Directory

The `/ee` directory contains enterprise-only code licensed under the [Elastic License 2.0](./ee/LICENSE). This code is **not open for outside contributions**. Please do not submit PRs that modify files in `/ee`.

All community contributions should target the core codebase outside of `/ee`.

## License

By contributing to Togather, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
