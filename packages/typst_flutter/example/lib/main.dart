import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:pdfrx/pdfrx.dart';
import 'package:typst_flutter/typst_flutter.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TypstFlutter.init();
  runApp(const TypstEditorApp());
}

class TypstEditorApp extends StatelessWidget {
  const TypstEditorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Typst Editor',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const TypstEditorScreen(),
    );
  }
}

class TypstEditorScreen extends StatefulWidget {
  const TypstEditorScreen({super.key});

  @override
  State<TypstEditorScreen> createState() => _TypstEditorScreenState();
}

class _TypstEditorScreenState extends State<TypstEditorScreen> {
  final _templateController = TextEditingController(
    text: r'''= Test Report

== Introduction

This is a document generated with *Typst* in Flutter!

- Item 1
- Item 2
- Item 3

== Data

#table(
  columns: (1fr, 1fr),
  [Name], [Value],
  [Item A], [100],
  [Item B], [200],
  [Item C], [300],
)

== Conclusion

The document was compiled successfully.
''',
  );

  final _inputsController = TextEditingController(
    text: r'{"title": "My Report"}',
  );

  Uint8List? _pdfBytes;
  String? _error;
  bool _isLoading = false;

  @override
  void dispose() {
    _templateController.dispose();
    _inputsController.dispose();
    super.dispose();
  }

  Future<void> _compile() async {
    setState(() {
      _error = null;
      _isLoading = true;
    });

    try {
      Map<String, String>? inputs;
      if (_inputsController.text.isNotEmpty) {
        inputs = Map<String, String>.from(jsonDecode(_inputsController.text));
      }

      final pdf = await TypstFlutter.compileString(
        template: _templateController.text,
        inputs: inputs,
        fonts: [FontSource.asset('assets/fonts/Roboto-Regular.ttf')],
      );

      setState(() {
        _pdfBytes = pdf;
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Typst Editor'),
        actions: [
          IconButton(
            icon: const Icon(Icons.play_arrow),
            onPressed: _isLoading ? null : _compile,
            tooltip: 'Compile PDF',
          ),
        ],
      ),
      body: Row(
        children: [
          Expanded(
            child: Column(
              children: [
                Expanded(
                  flex: 3,
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Typst Template:',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        Expanded(
                          child: TextField(
                            controller: _templateController,
                            maxLines: null,
                            expands: true,
                            textAlignVertical: TextAlignVertical.top,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 12,
                            ),
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              hintText: 'Enter your Typst template here...',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  flex: 1,
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Inputs (JSON):',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        Expanded(
                          child: TextField(
                            controller: _inputsController,
                            maxLines: null,
                            expands: true,
                            textAlignVertical: TextAlignVertical.top,
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 12,
                            ),
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              hintText: '{"key": "value"}',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          const VerticalDivider(width: 1),
          Expanded(child: _buildPdfViewer()),
        ],
      ),
    );
  }

  Widget _buildPdfViewer() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Compiling...'),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 48),
              const SizedBox(height: 8),
              Text('Error:', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Expanded(
                child: SingleChildScrollView(
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (_pdfBytes == null) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.picture_as_pdf, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text('Click the ▶ button to compile'),
          ],
        ),
      );
    }

    return PdfViewer.data(
      _pdfBytes!,
      sourceName: 'document.pdf',
      params: const PdfViewerParams(enableTextSelection: true),
    );
  }
}
