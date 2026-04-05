import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:typst_flutter/typst_flutter.dart';

/// Discovers required fonts from Typst templates, loads bundled fonts,
/// downloads missing fonts from Google Fonts, and provides them for compilation.
class FontManager {
  static final Map<String, List<FontSource>> _cache = {};
  static List<FontSource>? _bundledFonts;

  /// Font directory for downloaded fonts.
  static Future<Directory> get _fontDir async {
    if (Platform.isIOS) {
      final docs = await getApplicationDocumentsDirectory();
      final dir = Directory('${docs.path}/fonts');
      if (!dir.existsSync()) dir.createSync(recursive: true);
      return dir;
    }
    final home = Platform.environment['HOME'] ?? '.';
    final dir = Directory('$home/.config/markdownoffice/fonts');
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir;
  }

  /// Extract all font family names from a Typst template.
  static List<String> discoverFonts(String templateSource) {
    final fonts = <String>{};

    // Match: font: "Family Name"
    final singlePattern = RegExp(r'font:\s*"([^"]+)"');
    for (final match in singlePattern.allMatches(templateSource)) {
      fonts.add(match.group(1)!);
    }

    // Match: font: ("Family 1", "Family 2")
    final listPattern = RegExp(r'font:\s*\(([^)]+)\)');
    for (final match in listPattern.allMatches(templateSource)) {
      final inner = match.group(1)!;
      final namePattern = RegExp(r'"([^"]+)"');
      for (final nameMatch in namePattern.allMatches(inner)) {
        fonts.add(nameMatch.group(1)!);
      }
    }

    return fonts.toList();
  }

  /// Load bundled fonts from app assets (Source Serif 4, Source Sans 3, etc.)
  static Future<List<FontSource>> loadBundledFonts() async {
    if (_bundledFonts != null) return _bundledFonts!;

    const fontFiles = [
      'assets/fonts/SourceSerif4-Regular.ttf',
      'assets/fonts/SourceSerif4-Bold.ttf',
      'assets/fonts/SourceSans3-Regular.ttf',
      'assets/fonts/SourceSans3-Bold.ttf',
      'assets/fonts/SourceCodePro-Regular.ttf',
    ];

    final fonts = <FontSource>[];
    for (final path in fontFiles) {
      try {
        final data = await rootBundle.load(path);
        fonts.add(FontSource.bytes(data.buffer.asUint8List()));
      } catch (_) {
        // Font not found in assets — skip
      }
    }
    _bundledFonts = fonts;
    return fonts;
  }

  /// Known bundled font families — these don't need downloading.
  static const _bundledFamilies = {
    'Source Serif 4',
    'Source Sans 3',
    'Source Code Pro',
  };

  /// Get all fonts needed for a template. Downloads missing ones from Google Fonts.
  static Future<List<FontSource>> getFontsForTemplate(
      String templateSource) async {
    final bundled = await loadBundledFonts();
    final required = discoverFonts(templateSource);

    // Filter out bundled fonts
    final missing =
        required.where((f) => !_bundledFamilies.contains(f)).toList();

    if (missing.isEmpty) return bundled;

    // Load/download missing fonts
    final extra = <FontSource>[];
    for (final family in missing) {
      final fonts = await _loadOrDownloadFont(family);
      extra.addAll(fonts);
    }

    return [...bundled, ...extra];
  }

  /// Load a font from local cache or download from Google Fonts.
  static Future<List<FontSource>> _loadOrDownloadFont(String family) async {
    // Check cache
    if (_cache.containsKey(family)) return _cache[family]!;

    // Check local font directory
    final dir = await _fontDir;
    final localFonts = await _loadLocalFont(dir, family);
    if (localFonts.isNotEmpty) {
      _cache[family] = localFonts;
      return localFonts;
    }

    // Download from Google Fonts
    final downloaded = await _downloadGoogleFont(dir, family);
    _cache[family] = downloaded;
    return downloaded;
  }

  /// Load font files from local directory.
  static Future<List<FontSource>> _loadLocalFont(
      Directory dir, String family) async {
    final safeName = family.replaceAll(' ', '_');
    final fonts = <FontSource>[];

    for (final entity in dir.listSync()) {
      if (entity is File &&
          entity.uri.pathSegments.last.startsWith(safeName) &&
          (entity.path.endsWith('.ttf') || entity.path.endsWith('.otf'))) {
        fonts.add(FontSource.bytes(entity.readAsBytesSync()));
      }
    }
    return fonts;
  }

  /// Download font from Google Fonts API and save locally.
  static Future<List<FontSource>> _downloadGoogleFont(
      Directory dir, String family) async {
    final safeName = family.replaceAll(' ', '_');
    final encodedFamily = Uri.encodeComponent(family);
    final apiUrl = Uri.parse(
      'https://fonts.googleapis.com/css2?family=$encodedFamily:wght@400;700',
    );

    final client = HttpClient();
    try {
      // Step 1: Get CSS with font URLs
      final request = await client.getUrl(apiUrl);
      // Google Fonts returns different formats based on User-Agent
      // We want .ttf files
      request.headers.set('User-Agent',
          'Mozilla/5.0 (compatible; MarkdownOffice/1.0)');
      final response = await request.close();
      final css = await response.transform(
        const SystemEncoding().decoder,
      ).join();

      // Step 2: Extract .ttf/.woff2 URLs from CSS
      final urlPattern = RegExp(r'url\(([^)]+\.(?:ttf|woff2))\)');
      final fonts = <FontSource>[];
      var fileIndex = 0;

      for (final match in urlPattern.allMatches(css)) {
        final fontUrl = Uri.parse(match.group(1)!);
        final fontRequest = await client.getUrl(fontUrl);
        final fontResponse = await fontRequest.close();
        final fontBytes = await fontResponse.fold<List<int>>(
          [],
          (prev, chunk) => prev..addAll(chunk),
        );

        // Save locally
        final ext = fontUrl.path.endsWith('.woff2') ? 'woff2' : 'ttf';
        final localFile = File('${dir.path}/${safeName}_$fileIndex.$ext');
        localFile.writeAsBytesSync(fontBytes);
        fileIndex++;

        fonts.add(FontSource.bytes(Uint8List.fromList(fontBytes)));
      }

      return fonts;
    } catch (e) {
      // Google Fonts download failed — font not available or no network
      return [];
    } finally {
      client.close();
    }
  }
}
