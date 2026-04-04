import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:printing/printing.dart';
import '../../providers/editor_provider.dart';

class PdfPreviewWidget extends ConsumerWidget {
  const PdfPreviewWidget({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pdfAsync = ref.watch(pdfBytesProvider);

    return pdfAsync.when(
      data: (bytes) {
        if (bytes == null) {
          return const Center(child: Text('Bitte Felder ausfüllen.'));
        }
        return PdfPreview(
          build: (_) async => bytes,
          canChangeOrientation: false,
          canChangePageFormat: false,
          canDebug: false,
          allowPrinting: true,
          allowSharing: true,
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Fehler bei der PDF-Vorschau:\n$e',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ),
      ),
    );
  }
}
