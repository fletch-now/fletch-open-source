# Sandbox for the build agent. The agent runs arbitrary model-authored code, so it
# never touches the host: no host mounts beyond the build workspace, no root, no
# added capabilities, and a read-only root filesystem.
#
# Debian (not Alpine): kimi-code pulls in keytar, whose prebuilt native binary is
# glibc-linked and needs libsecret at load time.
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git libsecret-1-0 \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @moonshot-ai/kimi-code@0.39.1 \
 && npm cache clean --force

# Foundry is what makes a build real: the agent compiles and tests the contract it
# just wrote, reads the actual solc errors, and fixes them — instead of emitting
# plausible Solidity nobody ever ran.
ENV FOUNDRY_DIR=/opt/foundry
ENV PATH=/opt/foundry/bin:$PATH
RUN curl -fsSL https://foundry.paradigm.xyz | bash \
 && /opt/foundry/bin/foundryup \
 && chmod -R a+rX /opt/foundry \
 && forge --version

# Pre-download solc into the image and pin the version. Two reasons: a container
# that is destroyed after every build would otherwise re-fetch the compiler each
# time, and on arm64 there is no official solc — foundry falls back to a community
# mirror, which is not something a build should depend on at request time. The
# workspace foundry.toml pins this exact version (see lib/build/cli-builder.ts).
# Foundry 1.8 ignores SVM_HOME and always caches under $HOME/.svm, so the warmed
# copy is staged at /opt/svm and linked into the writable HOME by the entrypoint.
ENV FLETCH_SOLC=0.8.28
RUN mkdir -p /opt/svm /tmp/warm/src \
 && printf '[profile.default]\nsrc = "src"\nout = "out"\nsolc = "%s"\n' "$FLETCH_SOLC" > /tmp/warm/foundry.toml \
 && printf '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\ncontract Warm { uint256 public n; }\n' > /tmp/warm/src/Warm.sol \
 && cd /tmp/warm \
 && (forge build || forge build || forge build) \
 && cd / && rm -rf /tmp/warm \
 && cp -r "$HOME/.svm/." /opt/svm/ \
 && chmod -R a+rX /opt/svm \
 # Fail the image build loudly rather than shipping one that downloads at runtime.
 && test -n "$(find /opt/svm -name 'solc-*' -type f)" \
 && find /opt/svm -name 'solc-*' -type f

# Slither, so every contract the agent writes is read by a static analyser
# before it is deployed: reentrancy, unchecked calls, dangerous delegatecall,
# tx.origin, uninitialised storage and the rest of its detectors. It runs
# offline against the solc already in the image (lib/build/analysis.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/slither \
 && /opt/slither/bin/pip install --no-cache-dir "slither-analyzer==0.11.3" \
 && ln -s /opt/slither/bin/slither /usr/local/bin/slither \
 && chmod -R a+rX /opt/slither \
 && slither --version

# forge-std, vendored. Tests are the point of having a toolchain at all, and
# `forge install` would need git plus network access at request time; the workspace
# foundry.toml remaps forge-std/ to this path.
RUN git clone --depth 1 https://github.com/foundry-rs/forge-std /opt/forge-std \
 && rm -rf /opt/forge-std/.git \
 && chmod -R a+rX /opt/forge-std \
 && test -f /opt/forge-std/src/Test.sol

# The front-end dependency set, installed once here and never at request time:
# the sandbox has no network, and a build that installs packages is a build whose
# result depends on what npm served that minute. lib/build/web.ts links the
# workspace's node_modules to this directory and runs vite against it.
COPY --chmod=0644 docker/webapp-template/package.json docker/webapp-template/package-lock.json /opt/webapp/
RUN cd /opt/webapp \
 && npm ci --no-audit --no-fund --ignore-scripts \
 && npm cache clean --force \
 && chmod -R a+rX /opt/webapp \
 && test -x /opt/webapp/node_modules/.bin/vite

COPY docker/webapp-template/foundation /opt/webapp/foundation
COPY docker/webapp-template/example /opt/webapp/example
RUN chmod -R a+rX /opt/webapp/foundation /opt/webapp/example
COPY --chmod=0644 docker/webapp-template/template.json docker/webapp-template/prepare.mjs docker/webapp-template/build.mjs /opt/webapp/
LABEL io.fletch.webapp-template="2.0.4"

# Keep the CLI's HTTP transport alive until the credential proxy can return its
# terminal deadline. This dependency is isolated from generated applications.
COPY --chmod=0644 docker/cli-runtime/package.json docker/cli-runtime/package-lock.json /opt/fletch-cli-runtime/
RUN cd /opt/fletch-cli-runtime \
 && npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && chmod -R a+rX /opt/fletch-cli-runtime
COPY --chmod=0644 docker/cli-runtime/http-timeout.mjs /opt/fletch-cli-runtime/http-timeout.mjs

# Root is read-only at runtime, so the solc cache is linked into the writable HOME
# rather than downloaded again.
COPY --chmod=0755 docker/agent-entrypoint.sh /usr/local/bin/agent-entrypoint

# node:22-slim already ships an unprivileged "node" user.
USER node
WORKDIR /work

# The prelude runs for every command, so the same sandbox serves the agent and
# the toolchain runs that verify its output.
ENTRYPOINT ["/usr/local/bin/agent-entrypoint"]
CMD ["kimi"]
