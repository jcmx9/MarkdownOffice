.PHONY: all build test clean check clippy fmt doc release run-example

# === Configuration ===
CARGO := cargo
RUST_DIR := rust
FLUTTER_PROJECT_DIR := .

# === Build ===
build:
	cd $(RUST_DIR) && $(CARGO) build

release:
	cd $(RUST_DIR) && $(CARGO) build --release

# === Clean ===
clean:
	cd $(RUST_DIR) && $(CARGO) clean

# === Tests ===
test:
	cd $(RUST_DIR) && $(CARGO) test

# === Analysis ===
check:
	cd $(RUST_DIR) && $(CARGO) check

clippy:
	cd $(RUST_DIR) && $(CARGO) clippy -- -D warnings

fmt:
	cd $(RUST_DIR) && $(CARGO) fmt

# === Documentation ===
doc:
	cd $(RUST_DIR) && $(CARGO) doc --no-deps

# === Flutter Build ===
flutter-build:
	flutter build apk --debug

flutter-build-release:
	flutter build apk --release

# === Run Example ===
run-example:
	cd example && flutter run

run-example-linux:
	cd example && flutter run -d linux

run-example-android:
	cd example && flutter run -d android

# === Tests ===
test-integration:
	cd example && flutter test integration_test/

test-integration-simple:
	cd example && flutter test integration_test/simple_test.dart

# === Typst Version ===
typst-version:
	cd $(RUST_DIR) && $(CARGO) run --example typst_version 2>/dev/null || $(CARGO) build && echo "Version set in Cargo.toml"

# === Rebuild Rust FFI ===
rebuild-ffi:
	cd $(RUST_DIR) && rm -rf target && $(CARGO) build
