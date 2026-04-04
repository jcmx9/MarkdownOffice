import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: MarkdownOfficeApp()));
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
      home: const Scaffold(
        body: Center(child: Text('MarkdownOffice')),
      ),
    );
  }
}
