# Security policy

Please **do not** open a public issue for a security problem.

Email **info@worldlines.gg** with "SECURITY" in the subject. Include:
- what is affected (this repository, the hosted service at canvas.worldlines.gg, or both),
- the steps to reproduce it, and
- the impact you expect.

We will acknowledge your report within 5 working days and keep you updated until it is fixed. Please give us a reasonable time to fix the issue before you disclose it publicly. We are happy to credit you.

## Scope

- **This repository**: the local server, the web app, the browser runtime and the bundled tools. Of particular interest: anything that lets a story agent read files outside its world or read your API keys, and anything that lets world content run code it shouldn't.
- **The hosted service** (`*.worldlines.gg`): report it the same way. Do not test against other people's accounts or data, do not degrade the service, and do not use automated scanners at volume.

Only the latest `main` is supported.
