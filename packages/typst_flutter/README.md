# typst_flutter

A Flutter FFI plugin for compiling [Typst](https://typst.app/) templates to PDF.

## Features

- Compile Typst templates to PDF
- Pass dynamic data via `sys.inputs`
- Load fonts from Flutter assets
- Load template files from assets
- Works on Android, iOS, Linux, macOS, Windows, and Web

## Usage

```dart
import 'package:flutter/material.dart';
import 'package:typst_flutter/typst_flutter.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TypstFlutter.init(); // Requires initialization before use

  final pdf = await TypstFlutter.compileString(
    template: '''
= Hello, #sys.inputs.at("name", default: "World")!

This is a Typst document compiled in Flutter.
''',
    inputs: {'name': 'Flutter'},
  );
  
  // pdf is a Uint8List containing the PDF bytes
}
```

### Loading from Assets

```dart
final pdf = await TypstFlutter.compileAsset(
  assetPath: 'assets/templates/my_template.typ',
  inputs: {'title': 'My Report'},
);
```

### Adding Custom Fonts & Extra Files

```dart
final pdf = await TypstFlutter.compileString(
  template: '''
#set text(font: "Roboto")
#image("logo.png")
= Hello World!
''',
  fonts: [FontSource.asset('assets/fonts/Roboto-Regular.ttf')],
  extraFiles: [ExtraFileSource.bytes("logo.png", imageBytes)],
);
```

## API

### `TypstFlutter.compileString()`

| Parameter | Type | Description |
|-----------|------|-------------|
| `template` | `String` | Typst template content |
| `inputs` | `Map<String, String>?` | Data injected as `sys.inputs` |
| `fonts` | `List<FontSource>` | Custom fonts (e.g., `FontSource.asset(...)`) |
| `extraFiles` | `List<ExtraFileSource>` | Additional files like images or sub-templates |

Returns a `Future<Uint8List>` containing the PDF bytes.

### `TypstFlutter.compileAsset()`

Behaves identically to `compileString()`, but accepts an `assetPath` argument to load the Typst template directly from a Flutter asset.

### `TypstFlutter.compileFile()`

Behaves identically to `compileString()`, but accepts a `file` argument of type `File` (`dart:io`) to load the template directly from the file system.

## Example

See the `example/` directory for a complete demo app with:
- Live Typst editor
- PDF preview using pdfrx
- Asset loading demonstration
- Integration tests

## Requirements

- Flutter 3.x
- Rust toolchain (for building the plugin)

## Building

```bash
# Build debug
make build

# Run example
make run-example-linux
```

## License

MIT
