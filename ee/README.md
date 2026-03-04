# /ee — Enterprise Edition

This directory contains code licensed under the Elastic License 2.0 (ELv2).
See `LICENSE` in this directory for the full license text.

## What's in /ee?

- **deployment/** — Production deployment workflows (GitHub Actions)
- **infrastructure/** — Terraform configs (Cloudflare DNS)
- **scripts/** — Company-specific deployment and ops scripts
- **actions/** — GitHub Actions composite actions (secrets loading)
- **billing/** — Payment and pricing pages (Stripe integration)

## For Togather Cloud operators

After cloning, symlink the deployment workflows so GitHub Actions can find them:

```bash
# Symlink deployment workflows
ln -s ../../ee/deployment/workflows/*.yml .github/workflows/
ln -s ../../ee/actions/load-secrets .github/actions/load-secrets
```

## Contributing

The `/ee` directory is **not open for outside contributions**. Community contributions should target the core codebase outside of `/ee`.

## License

Code in this directory is licensed under the [Elastic License 2.0](./LICENSE).
The rest of the Togather codebase is licensed under [AGPL-3.0](../LICENSE).
