.PHONY: build test fmt vet web-assets assets run render

build:
	go build ./cmd/markdownoffice

test:
	go test ./...

fmt:
	gofmt -w .

vet:
	go vet ./...

# Dev helpers: run against a system Typst + the vendored .dev-assets/ tree, so
# neither `serve` nor `render` needs the embedded assets or manual MDO_* exports.
DEV_ENV = MDO_PACKAGE_PATH=$(CURDIR)/.dev-assets/pkgs \
          MDO_PACKAGE_CACHE_PATH=$(CURDIR)/.dev-assets/cache \
          MDO_FONT_PATH=$(CURDIR)/.dev-assets/fonts

# Start the local editor:  make run           (add ARGS='--addr 127.0.0.1:9000')
run: build
	$(DEV_ENV) ./markdownoffice serve $(ARGS)

# Render a letter from the terminal:  make render FILE=brief.md [OUT=out.pdf]
render: build
	@test -n "$(FILE)" || { echo "usage: make render FILE=brief.md [OUT=out.pdf]"; exit 1; }
	$(DEV_ENV) ./markdownoffice render $(FILE) $(if $(OUT),-o $(OUT))

# Pinned versions keep the committed CodeMirror bundle reproducible.
CM_VERSION ?= 6.0.2

# Rebuild internal/web/static/vendor/codemirror.js from the in-repo entry source.
# Requires node/npm. Bundles into a self-contained IIFE (global `MDO`).
web-assets:
	@tmp=$$(mktemp -d) && \
	cd $$tmp && npm init -y >/dev/null 2>&1 && \
	npm i --no-audit --no-fund codemirror@$(CM_VERSION) @codemirror/state@6 @codemirror/lang-markdown@6 esbuild >/dev/null 2>&1 && \
	cp "$(CURDIR)/internal/web/assetsrc/codemirror.entry.js" entry.js && \
	npx esbuild entry.js --bundle --format=iife --global-name=MDO --minify --outfile="$(CURDIR)/internal/web/static/vendor/codemirror.js" && \
	rm -rf $$tmp && \
	echo "vendored internal/web/static/vendor/codemirror.js"

# Fetch embedded runtime assets (Typst + fonts + packages) for the host target.
assets:
	./scripts/fetch-assets.sh
