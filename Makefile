.PHONY: build test fmt vet web-assets assets

build:
	go build ./cmd/mdo-service

test:
	go test ./...

fmt:
	gofmt -w .

vet:
	go vet ./...

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
