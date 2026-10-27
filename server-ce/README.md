# Build and run this fork

From the repository root, use Docker Engine/Desktop with the Compose plugin
(version 2.24 or newer):

```sh
cp .env.example .env          # or configure the variables in Dokploy
# Set the public URL and configure email settings or the source link as needed.
docker compose up --build -d
docker compose ps
docker compose logs -f sharelatex
```

In Dokploy, route your domain to the `sharelatex` service on container port `80`
and set `OVERLEAF_SITE_URL` to that public URL. Open `/launchpad` on your domain
to create the first administrator, then use Account → Admin panel. Compose does
not publish host ports; Dokploy's reverse proxy provides access to the app. The
application is built from the checkout with `server-ce/Dockerfile`; no published
Overleaf application or Overleaf base image is required. OS, MongoDB, and Redis
images are downloaded normally. The first build downloads TeX Live and Node
dependencies and takes longer than later source rebuilds. The default platform
is `linux/amd64`, including on Apple Silicon through Docker's emulation.

The Dockerfile has `base` and `community` targets. Both share the same dependency
layers; `make -C server-ce build-community` also builds the complete application
without a separate base-image build. `make -C server-ce build-base` remains
available for CI jobs that publish the dependency target.

MongoDB initializes an `overleaf` replica set on a fresh volume. The initializer
also handles existing replica sets without replacing them. The app waits for
a writable primary, successful initialization, and a healthy Redis server.
MongoDB and Redis do not publish host ports. Redis uses version 7.4, matching
existing Redis 7.4 deployments without downgrading their persistence format.

## Node.js security updates

The image pins Node.js **24.22.1**, the October 21, 2026 security release,
including the Brotli decoder fix (CVE-2026-111497). Earlier images can contain
an affected runtime even though they install from the NodeSource 24.x channel:
Docker can reuse the cached apt layer. `NODE_VERSION` pins the package and
invalidates that layer when changed; local development requires at least 24.22.1.
See the [Node.js advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

After updating the checkout, rebuild and recreate the application:

```sh
docker compose build --pull sharelatex
docker compose up -d --no-deps --force-recreate sharelatex
docker compose exec sharelatex node --version
docker compose ps sharelatex
```

Expect `v24.22.1`. Keep all existing volumes and secrets, and verify editor
reconnects and a document compile after deployment. Updating the checkout alone
does not patch a running container. This assessment covers the source build;
production runtime versions must be checked on the deployment host.

## Persistent state and secrets

Compose creates separate named volumes for MongoDB, Redis, application files,
and TeX Live. `docker compose down` keeps them. Removing volumes deletes the
corresponding state; do not use `docker compose down -v` to upgrade an installation.

On a fresh installation, invitation and session signing keys are generated once
in `/var/lib/overleaf/secrets/invite-token-secret` and
`/var/lib/overleaf/secrets/session-secret`, inside the app volume. Recreating the
container reuses both, so pending invitations and existing sessions survive.
Nonempty `OVERLEAF_INVITE_TOKEN_SECRET` and `OVERLEAF_SESSION_SECRET` values in
`.env` take precedence and are saved for subsequent restarts. Startup logs never
print either key. Back up the app volume along with MongoDB.

For an existing installation, keep its original `OVERLEAF_INVITE_TOKEN_SECRET`
and `OVERLEAF_SESSION_SECRET` values while migrating. A newly generated key
cannot validate invitations signed with the previous key. Do not rotate either
secret as part of an ordinary rebuild.

To adopt existing data, stop the old application and back up its MongoDB, Redis,
and application data first. Use a local Compose override to mount those existing
volumes or host directories at `/data/db`, `/data`, and `/var/lib/overleaf`
respectively. The MongoDB data must already be compatible with MongoDB 8;
perform MongoDB's supported sequential upgrades before attaching older data.
Keep the replica-set name `overleaf` and the existing database name `sharelatex`,
or adjust the connection URL deliberately. This setup does not modify another
installation or migrate data automatically.

SMTP is optional. Without it, admins can create invitations and copy activation
links from the admin panel. Configure the SMTP values in `.env` to send email.
Account → Source code defaults to this fork's public repository at
`https://github.com/cerulean-works/overleaf`. Override `OVERLEAF_SOURCE_URL` if
you publish further changes in another repository.

## Installing and retaining TeX packages

The entire TeX tree, including the `tlmgr` package database, is persisted at
`/usr/local/texlive`. An empty named volume is initially populated from the
image's basic installation. Install packages once:

```sh
docker compose exec --user root sharelatex tlmgr install float
# Or install a larger collection:
# docker compose exec --user root sharelatex tlmgr install collection-latexextra
docker compose exec --user root sharelatex tlmgr path add
```

For a complete installation, use `tlmgr install scheme-full`.
After a source rebuild or container recreation, these packages remain installed:

```sh
docker compose build sharelatex
docker compose up -d --force-recreate sharelatex
docker compose exec sharelatex kpsewhich float.sty
```

Every startup verifies the persisted tree's release, architecture, and baseline,
then runs `tlmgr path add` to recreate command symlinks in the new container.
A mismatched or incomplete volume stops startup with an explanation rather than
silently running incompatible binaries.

The default volume is named
`overleaf-texlive-2026-x86_64-linux-basic-v1`. `COMPOSE_PROJECT_NAME`,
`TEXLIVE_RELEASE`, `TEXLIVE_ARCH`, and `TEXLIVE_BASELINE` select its name and the
matching build arguments. Do not rename an old year's volume to a new year.

For a TeX Live release upgrade, change `TEXLIVE_RELEASE` and select a repository
that serves that release, build the image, and recreate the app. Compose chooses
a new volume and seeds it from the new image. Reinstall your extra packages in
the new volume; keep the old image and volume for rollback. Change
`TEXLIVE_BASELINE` when intentionally changing the baked package baseline within
the same release. Rolling CTAN mirrors eventually move to the next release;
use the matching year's historic `tlnet-final` repository through
`TEXLIVE_MIRROR` for older releases. For an existing persisted tree, also run
`tlmgr option repository <matching-repository-url>` inside the app container:
the image build argument does not rewrite the existing tree's package database.
Builds reject an unexpected TeX Live year.

The default binary architecture is `x86_64-linux`. If you deliberately build a
native ARM image, set `OVERLEAF_PLATFORM=linux/arm64` and
`TEXLIVE_ARCH=aarch64-linux` together and use a separate volume. Native ARM is not
part of the default deployment validation.

## Public URLs and reverse proxies

Set `OVERLEAF_SITE_URL` to the URL users open, including HTTPS when applicable.
In Dokploy, configure the domain to target service `sharelatex`, container port
`80`. The proxy must share a Docker network with the app and allow WebSocket
upgrades and long-lived connections. No host port mapping is required.
Set `OVERLEAF_TRUSTED_PROXY_IPS` to include the proxy's address
range and `loopback` for nginx inside the app container. For public HTTPS,
uncomment `OVERLEAF_SECURE_COOKIE=true` in `.env`. Omit that variable entirely for
local HTTP: this setting is enabled by the variable's presence, even if its value
is `false`.

This deployment uses Community Edition's in-container compiles. The Compose file
does not enable Server Pro sibling containers or mount the Docker socket.

### WebSocket keepalives

The fork patches `socket.io@0.9.19-overleaf-12` to handle RFC 6455 ping/pong
control frames correctly. The original transport writes its pong header as a
UTF-8 string, producing `C2 8A 00` instead of `8A 00`. A browser or reverse proxy
that sends a control ping can therefore terminate the connection as malformed,
even while Socket.IO's separate application heartbeats are working. The editor
then displays its normal reconnect countdown.

The [dependency patch](../.yarn/patches/socket.io-https-2266d71a24.patch) sends
binary pong frames with the original payload, consumes empty masked pings, and
handles unsolicited pongs. It is installed by Yarn and included in source-built
images. Rebuild and deploy the image to update an existing installation; the
patch does not alter a running server automatically.

Run the wire-protocol regression checks with:

```sh
yarn workspace @overleaf/real-time exec vitest run --config vitest.config.unit.cjs test/unit/js/SocketIoControlFrames.test.js
```

## Validation

```sh
docker compose config --quiet
node --test server-ce/test/deployment.test.mjs
bash -n server-ce/init_scripts/000_check_missing_secrets.sh
bash -n server-ce/init_scripts/110_check_texlive_volume.sh
bash -n server-ce/scripts/init-mongo.sh
```

The unit checks cover secret persistence/override, TeX compatibility checks and
symlink restoration, and idempotent MongoDB initialization. For a full runtime
check, start the stack, compile a document, install a package, recreate the app,
and compile again; also verify pending invitations survive app recreation.
