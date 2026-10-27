# syntax=docker/dockerfile:1-labs

# --------------------------------------------------
# Overleaf Base Image (sharelatex/sharelatex-base)
# --------------------------------------------------

FROM phusion/baseimage:noble-1.0.3 AS base

# Makes sure LuaTex cache is writable
# -----------------------------------
ENV TEXMFVAR=/var/lib/overleaf/tmp/texmf-var

# Update to ensure dependencies are updated
# ------------------------------------------
ENV REBUILT_AFTER="2026-10-21"

# October 2026 security release; changing this also invalidates the apt layer.
ARG NODE_VERSION=24.22.1

# Install dependencies
# --------------------
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
# Technically, we are using potentially stale package-lists with the below line.
# Practically, apt refreshes the lists as needed and release builds run in fresh CI VMs without the cache.
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked true \
# Enable caching: https://docs.docker.com/reference/dockerfile/#example-cache-apt-packages
&&  rm -f /etc/apt/apt.conf.d/docker-clean && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache \
&&  apt-get update \
&&  apt-get install -y \
      unattended-upgrades \
      build-essential wget net-tools unzip time poppler-utils optipng strace nginx git python3 python-is-python3 zlib1g-dev libpcre3-dev gettext-base libwww-perl ca-certificates curl gnupg \
      qpdf \
# upgrade base-image, batch all the upgrades together, rather than installing them on-by-one (which is slow!)
&&  unattended-upgrade --verbose --no-minimal-upgrade-steps \
# install Node.js https://github.com/nodesource/distributions#nodejs
&&  mkdir -p /etc/apt/keyrings \
&&  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
&&  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
&&  apt-get update \
&&  apt-get install -y nodejs="${NODE_VERSION}-1nodesource1" openssl \
&&  npm install --global node-gyp@11 \
    \
&&  rm -rf \
# We are adding a custom nginx config in the main Dockerfile.
      /etc/nginx/nginx.conf \
      /etc/nginx/sites-enabled/default

# Install TexLive
# ---------------
# CTAN mirrors occasionally fail, in that case install TexLive using a
# different server, for example https://ctan.crest.fr
#
# # docker build \
#     --build-arg TEXLIVE_MIRROR=https://ctan.crest.fr/tex-archive/systems/texlive/tlnet \
#     -f server-ce/Dockerfile --target base -t overleaf-base .
ARG TEXLIVE_MIRROR=https://mirror.ox.ac.uk/sites/ctan.org/systems/texlive/tlnet
ARG TEXLIVE_RELEASE=2026
ARG TEXLIVE_ARCH=x86_64-linux
ARG TEXLIVE_BASELINE=basic-v1
ENV OVERLEAF_TEXLIVE_RELEASE=${TEXLIVE_RELEASE} \
    OVERLEAF_TEXLIVE_ARCH=${TEXLIVE_ARCH} \
    OVERLEAF_TEXLIVE_BASELINE=${TEXLIVE_BASELINE}

RUN mkdir /install-tl-unx \
&&  wget --quiet https://tug.org/texlive/files/texlive.asc \
&&  gpg --import texlive.asc \
&&  rm texlive.asc \
&&  wget --quiet ${TEXLIVE_MIRROR}/install-tl-unx.tar.gz \
&&  wget --quiet ${TEXLIVE_MIRROR}/install-tl-unx.tar.gz.sha512 \
&&  wget --quiet ${TEXLIVE_MIRROR}/install-tl-unx.tar.gz.sha512.asc \
&&  gpg --verify install-tl-unx.tar.gz.sha512.asc \
&&  sha512sum -c install-tl-unx.tar.gz.sha512 \
&&  tar -xz -C /install-tl-unx --strip-components=1 -f install-tl-unx.tar.gz \
&&  rm install-tl-unx.tar.gz* \
&&  echo "tlpdbopt_autobackup 0" >> /install-tl-unx/texlive.profile \
&&  echo "tlpdbopt_install_docfiles 0" >> /install-tl-unx/texlive.profile \
&&  echo "tlpdbopt_install_srcfiles 0" >> /install-tl-unx/texlive.profile \
&&  echo "selected_scheme scheme-basic" >> /install-tl-unx/texlive.profile \
&&  echo "TEXDIR /usr/local/texlive/${TEXLIVE_RELEASE}" >> /install-tl-unx/texlive.profile \
    \
&&  /install-tl-unx/install-tl \
      -profile /install-tl-unx/texlive.profile \
      -repository ${TEXLIVE_MIRROR} \
    \
&&  test -x /usr/local/texlive/${TEXLIVE_RELEASE}/bin/${TEXLIVE_ARCH}/tlmgr \
&&  /usr/local/texlive/${TEXLIVE_RELEASE}/bin/${TEXLIVE_ARCH}/tlmgr --version | grep -E "TeX Live .* version ${TEXLIVE_RELEASE}$" \
&&  /usr/local/texlive/${TEXLIVE_RELEASE}/bin/${TEXLIVE_ARCH}/tlmgr path add \
&&  tlmgr install --repository ${TEXLIVE_MIRROR} \
      latexmk \
      texcount \
      synctex \
      etoolbox \
      xetex \
&&  tlmgr path add \
&&  mkdir -p /etc/overleaf \
&&  printf '%s/%s/%s\n' "${TEXLIVE_RELEASE}" "${TEXLIVE_ARCH}" "${TEXLIVE_BASELINE}" > /etc/overleaf/texlive-baseline \
&&  cp /etc/overleaf/texlive-baseline /usr/local/texlive/.overleaf-baseline \
&&  rm -rf /install-tl-unx


# Set up overleaf user and home directory
# -----------------------------------------
RUN adduser --system --group --home /overleaf --no-create-home overleaf && \
	mkdir -p /var/lib/overleaf && \
	chown www-data:www-data /var/lib/overleaf && \
	mkdir -p /var/log/overleaf && \
	chown www-data:www-data /var/log/overleaf && \
	mkdir -p /var/lib/overleaf/data/template_files && \
	chown www-data:www-data /var/lib/overleaf/data/template_files


# Build the application from the same checkout and dependency stage.
FROM base AS community

WORKDIR /overleaf

# Add required source files for yarn install
# -------------------------------------------
COPY --parents libraries/*/package.json .yarn/patches/ services/*/package.json tools/migrations/ package.json yarn.lock .yarnrc.yml .pnp.register.mjs /overleaf/
COPY server-ce/genScript.js server-ce/services.js /overleaf/

# Pre-install yarn via corepack so it is available at runtime for all users
# -------------------------------------------------------------------------
# Corepack setup, shared between all the images.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack install -g yarn@4.18.0
ENV COREPACK_ENABLE_NETWORK=0

# Install yarn dependencies
# -------------------------
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.yarn/berry/cache,id=server-ce-yarn-cache \
    --mount=type=cache,target=/usr/local/share/.cache/yarn,id=server-ce-yarn-fallback-cache \
    --mount=type=tmpfs,target=/tmp node genScript install | bash

# Add the actual source files
# ---------------------------
COPY --parents libraries/ services/ tools/migrations/ /overleaf/
# Archive worker processes can stall under amd64 emulation on ARM hosts. Keep
# archive creation in-process; native dependency build scripts still run.
ENV YARN_TASK_POOL_MODE=async
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.yarn/berry/cache,id=server-ce-yarn-cache \
    --mount=type=cache,target=/usr/local/share/.cache/yarn,id=server-ce-yarn-fallback-cache \
    --mount=type=cache,target=/overleaf/services/web/.cache,id=server-ce-webpack-cache \
    --mount=type=tmpfs,target=/tmp \
    node genScript compile | bash

# Enable Yarn PnP resolution for all Node.js processes
# -----------------------------------------------------
ENV NODE_OPTIONS="--require /overleaf/.pnp.cjs --import /overleaf/.pnp.register.mjs"

# Copy runit service startup scripts to its location
# --------------------------------------------------
ADD server-ce/runit /etc/service

# Copy runit global settings to its location
# ------------------------------------------
ADD server-ce/config/env.sh /etc/overleaf/env.sh

# Configure nginx
# ---------------
ADD server-ce/nginx/nginx.conf.template /etc/nginx/templates/nginx.conf.template
ADD server-ce/nginx/overleaf.conf /etc/nginx/sites-enabled/overleaf.conf
ADD server-ce/nginx/clsi-nginx.conf /etc/nginx/sites-enabled/clsi-nginx.conf


# Configure log rotation
# ----------------------
ADD server-ce/logrotate/overleaf /etc/logrotate.d/overleaf
RUN chmod 644 /etc/logrotate.d/overleaf

# Configure cron tasks
# ----------------------
ADD server-ce/cron /overleaf/cron
ADD server-ce/config/crontab-history /etc/cron.d/crontab-history
RUN chmod 600 /etc/cron.d/crontab-history
ADD server-ce/config/crontab-deletion /etc/cron.d/crontab-deletion
RUN chmod 600 /etc/cron.d/crontab-deletion

# Copy Phusion Image startup and shutdown scripts to their locations
# ------------------------------------------------------------------
COPY server-ce/init_scripts/ /etc/my_init.d/
COPY server-ce/init_preshutdown_scripts/ /etc/my_init.pre_shutdown.d/

# Copy app settings files
# -----------------------
COPY server-ce/config/settings.js /etc/overleaf/settings.js

# Copy history-v1 files
# -----------------------
COPY server-ce/config/production.json /overleaf/services/history-v1/config/production.json
COPY server-ce/config/custom-environment-variables.json /overleaf/services/history-v1/config/custom-environment-variables.json

# Copy grunt thin wrapper
# -----------------------
ADD server-ce/bin/grunt /usr/local/bin/grunt
RUN chmod +x /usr/local/bin/grunt

# Copy history helper scripts
# ---------------------------
ADD server-ce/bin/flush-history-queues /overleaf/bin/flush-history-queues
RUN chmod +x /overleaf/bin/flush-history-queues
ADD server-ce/bin/force-history-resyncs /overleaf/bin/force-history-resyncs
RUN chmod +x /overleaf/bin/force-history-resyncs

# Copy Latexmkrc
# -----------------------
COPY server-ce/config/latexmkrc /usr/local/share/latexmk/LatexMk

# File that controls open|closed status of the site
# -------------------------------------------------
ENV SITE_MAINTENANCE_FILE="/etc/overleaf/site_status"
RUN touch $SITE_MAINTENANCE_FILE

# Set Environment Variables
# --------------------------------
ENV OVERLEAF_CONFIG=/etc/overleaf/settings.js

ENV WEB_API_USER="overleaf"
ENV ADMIN_PRIVILEGE_AVAILABLE="true"

ENV OVERLEAF_APP_NAME="Overleaf Community Edition"

ENV OPTIMISE_PDF="true"

ENV REQ_VALIDATION_MODE=enforce-log

# Phusion Image timeouts before sending SIGKILL to processes
# ----------------------------------------------------------
ENV KILL_PROCESS_TIMEOUT=55
ENV KILL_ALL_PROCESSES_TIMEOUT=55
ENV GRACEFUL_SHUTDOWN_DELAY_SECONDS=1

ENV NODE_ENV="production"
ENV LOG_LEVEL="info"


EXPOSE 80

ENTRYPOINT ["/sbin/my_init"]
