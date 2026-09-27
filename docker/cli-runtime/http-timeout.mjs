import { Agent, setGlobalDispatcher } from "undici";

// Node fetch supplies its own 300s parser timeouts, so Agent defaults alone
// cannot change them. Override dispatch options through Undici's public API.
// Only the sandbox's scoped credential proxy gets the longer parser deadline;
// request AbortSignals and the CLI SDK's 600s overall timeout still apply.
class CredentialProxyDispatcher extends Agent {
  dispatch(options, handler) {
    const origin = new URL(options.origin);
    if (origin.protocol === "http:" && origin.hostname === "host.docker.internal") {
      return super.dispatch({ ...options, headersTimeout: 630_000, bodyTimeout: 630_000 }, handler);
    }
    return super.dispatch(options, handler);
  }
}

setGlobalDispatcher(new CredentialProxyDispatcher());
