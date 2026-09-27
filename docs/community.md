# Help people use and improve the software

The purpose of this release is to make the builder useful beyond one hosted service. Keep onboarding reproducible, limitations visible and improvements easy to share.

Start with three independently runnable examples: a frontend-only personal tool, a dashboard over a synthetic dataset, and a small testnet contract app. Record the actual setup and outcomes. Add a data-worker example only after its scheduler and server adapter exist.

Good early contributions include accessibility fixes, clearer errors, offline fixtures, setup improvements, dependency/toolchain pinning, translations, new templates and documented adapters. Label unimplemented runtimes as requests for contributions rather than completed integrations. Accept focused work that helps another person run the software without the original operator's infrastructure.

For a public introduction, show a short real build, source inspection, preview and explicit publication. Link the README and one reproducible example. Explain which parts need Docker, provider access or a separately operated server. Avoid promises that generated code is automatically safe or that every target works already.

Maintain a public capability matrix and concise release notes. Collect setup failures with redacted logs and synthetic reproduction steps. Use private reporting for vulnerabilities. Review contributions for portability and privacy as well as code style. Success is another person being able to understand, run, adapt and contribute useful software.
