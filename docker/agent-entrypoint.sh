#!/bin/sh
# Foundry caches solc under $HOME/.svm and ignores SVM_HOME. HOME lives in the
# writable workspace, so link the image's pre-warmed copy in rather than letting
# a throwaway container download the compiler again.
if [ -d /opt/svm ] && [ ! -e "$HOME/.svm" ]; then
  mkdir -p "$HOME" 2>/dev/null && ln -s /opt/svm "$HOME/.svm" 2>/dev/null
fi
if [ -f /opt/webapp/prepare.mjs ] && [ "$PWD" = /work ]; then
  node /opt/webapp/prepare.mjs /work || exit 1
fi
if [ "$1" = "kimi" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=/opt/fletch-cli-runtime/http-timeout.mjs"
fi
exec "$@"
