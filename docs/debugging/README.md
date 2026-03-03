# Debugging Playbooks

This directory contains troubleshooting guides for common issues encountered during development.

## Available Playbooks

### Metro & Bundling Issues

- **[Metro React Multiple Instances](./METRO_REACT_MULTIPLE_INSTANCES.md)** - Fix for "Cannot read properties of null (reading 'useEffect')" error in pnpm monorepos with React 19 and SSR

## How to Use

1. **Identify the Error**: Check the error message and stack trace
2. **Find the Playbook**: Look for a playbook that matches your issue
3. **Follow the Solution**: Each playbook includes:
   - Problem description
   - Root cause analysis
   - Step-by-step solution
   - Prevention tips

## Contributing

When you solve a tricky debugging issue:

1. Document the problem, root cause, and solution
2. Add it to this directory
3. Update this README with a link to the new playbook
4. Include code examples and configuration snippets

## Format

Each playbook should include:

- **Problem Summary**: Clear description of the issue
- **Symptoms**: What you'll see when encountering the issue
- **Root Cause**: Why the issue occurs
- **Solution**: Step-by-step fix with code examples
- **Prevention**: How to avoid the issue in the future
- **Related Issues**: Links to similar problems or resources

