import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config_loader.dart';
import 'core/typst_bridge.dart';
import 'features/editor/editor_screen.dart';
import 'providers/config_provider.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TypstBridge.init();

  final homeDir = Platform.environment['HOME'] ?? '.';
  final configPath = '$homeDir/.config/markdownoffice';
  final cwdPath = Directory.current.path;

  final tempLoader = ConfigLoader(homePath: configPath);
  final config = tempLoader.loadConfig();

  final loader = ConfigLoader(
    homePath: configPath,
    cwdPath: cwdPath,
    cloudPath: config.cloudPath,
  );

  runApp(
    ProviderScope(
      overrides: [configLoaderProvider.overrideWithValue(loader)],
      child: const MarkdownOfficeApp(),
    ),
  );
}

class MarkdownOfficeApp extends StatelessWidget {
  const MarkdownOfficeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MarkdownOffice',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blueGrey),
        useMaterial3: true,
      ),
      home: const EditorScreen(),
    );
  }
}
