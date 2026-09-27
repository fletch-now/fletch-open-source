# Upgrade only the frontend foundation of an already validated sandbox image.
# Verify BASE_IMAGE against its recorded sha256 ID; never retag a running generation.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY docker/webapp-template/package.json docker/webapp-template/package-lock.json /opt/webapp/
RUN cd /opt/webapp && npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force && chmod -R a+rX /opt/webapp
COPY docker/webapp-template/foundation /opt/webapp/foundation
COPY docker/webapp-template/template.json /opt/webapp/template.json
RUN chmod -R a+rX /opt/webapp/foundation /opt/webapp/template.json
LABEL io.fletch.webapp-template="2.0.4"
USER node
