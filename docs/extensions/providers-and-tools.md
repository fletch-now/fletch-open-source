# Add a model provider or tool

## Existing model paths

`lib/agent/selection.ts` defines provider/model capabilities and selection. `provider.ts` builds platform or user configurations; `provider-transport.ts` implements the request formats. Hosted user keys use `credential-secret.ts` and scoped proxy leases. Gateway-backed connections relay through `lib/agent/gateway.ts` to the user process.

The default platform configuration reads `MOONSHOT_API_KEY`. Hosted own-key and gateway selections support the providers enumerated in source. Settings selects the connection; a server environment variable alone does not change the selected provider. Model IDs and pricing are source/configuration data that operators should review against their provider before offering paid service.

## Provider implementation checklist

1. Add a typed provider ID, capabilities and explicit supported models. Preserve text/image/tool capability validation and do not silently substitute a model.
2. Implement transport mapping for messages, tool calls, streaming, usage, errors and cancellation. Restrict upstream URLs/headers on the trusted server; never accept model-provided credential destinations.
3. Update connection validation, Settings and gateway policy if the gateway supports this provider. Keep raw keys out of events, logs, artifacts and workspaces.
4. Bind provider, model, credential version and billing mode at build creation. Revocation must invalidate leases; continuation must honor the saved selection.
5. Test limits, retries, rate-limit responses, malformed streams, model failure, cancel/revoke and usage accounting. Unknown usage must not invent a bill. Keep the credit ledger append-only.

Do not bypass `credential-proxy.ts` by placing an upstream API key in the agent container. The gateway is a provider relay, not a general remote command executor.

## Tools

Trace `lib/agent/cli-runner.ts`, `sandbox.ts` and the compile/test/web runners in `lib/build/`. A new tool needs validated structured input, a bounded output size, timeout/cancellation, a per-build workspace and a clear network policy. Invoke executables with argument arrays; never concatenate model text into a host shell command.

Add required binaries and dependencies to a versioned agent image. Compiler and test tools operate offline. Tools with external effects need a separate trusted implementation with authenticated ownership, explicit policy, idempotency and durable records. The agent does not get an unrestricted deployment key or privileged publishing shell.

Test path traversal, symlinks, command metacharacters, excessive output, a stuck child process, revoked leases and stale worker ownership. A tool returning “success” is not enough: the completion layer must verify the expected artifact or external receipt.
