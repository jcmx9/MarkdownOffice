import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'package:printing/printing.dart';
import '../../core/config_loader.dart';
import '../../providers/config_provider.dart';
import '../../models/profile.dart';
import '../../providers/profile_provider.dart';
import '../../providers/template_provider.dart';
import '../../providers/editor_provider.dart';
import 'dynamic_form.dart';
import 'pdf_preview.dart';
import '../profiles/profiles_screen.dart';

class EditorScreen extends ConsumerWidget {
  const EditorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final templates = ref.watch(templateListProvider);
    final selectedTemplate = ref.watch(selectedTemplateProvider);
    final profiles = ref.watch(templateProfilesProvider);
    final selectedProfile = ref.watch(selectedProfileProvider);
    final width = MediaQuery.of(context).size.width;
    final isWide = width > 800;

    final appBar = AppBar(
      title: const Text('MarkdownOffice'),
      actions: [
        _TemplateDropdown(
          templates: templates,
          selected: selectedTemplate,
          onChanged: (t) =>
              ref.read(selectedTemplateProvider.notifier).state = t,
        ),
        const SizedBox(width: 8),
        _ProfileDropdown(
          profiles: profiles,
          selected: selectedProfile,
          onChanged: (key) =>
              ref.read(selectedProfileProvider.notifier).state = key,
        ),
        const SizedBox(width: 8),
        IconButton(
          icon: const Icon(Icons.save),
          tooltip: 'PDF speichern',
          onPressed: () => _savePdf(ref, context),
        ),
        IconButton(
          icon: const Icon(Icons.share),
          tooltip: 'PDF teilen',
          onPressed: () => _sharePdf(ref, context),
        ),
        IconButton(
          icon: const Icon(Icons.print),
          tooltip: 'PDF drucken',
          onPressed: () => _printPdf(ref, context),
        ),
      ],
    );

    final drawer = Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          const DrawerHeader(
            decoration: BoxDecoration(color: Colors.blueGrey),
            child: Text(
              'MarkdownOffice',
              style: TextStyle(color: Colors.white, fontSize: 20),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.edit_document),
            title: const Text('Editor'),
            onTap: () => Navigator.of(context).pop(),
          ),
          ListTile(
            leading: const Icon(Icons.person),
            title: const Text('Profile'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const ProfilesScreen()),
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.download),
            title: const Text('Template importieren'),
            onTap: () {
              Navigator.of(context).pop();
              _importTemplate(ref, context);
            },
          ),
        ],
      ),
    );

    Widget body;
    if (isWide) {
      body = Row(
        children: [
          const Expanded(child: DynamicForm()),
          const VerticalDivider(width: 1),
          const Expanded(child: PdfPreviewWidget()),
        ],
      );
    } else {
      body = DefaultTabController(
        length: 2,
        child: Column(
          children: [
            const TabBar(
              tabs: [
                Tab(icon: Icon(Icons.edit), text: 'Felder'),
                Tab(icon: Icon(Icons.picture_as_pdf), text: 'Vorschau'),
              ],
            ),
            const Expanded(
              child: TabBarView(children: [DynamicForm(), PdfPreviewWidget()]),
            ),
          ],
        ),
      );
    }

    return Scaffold(appBar: appBar, drawer: drawer, body: body);
  }
}

Future<void> _savePdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  final path = await FilePicker.platform.saveFile(
    dialogTitle: 'PDF speichern',
    fileName: 'dokument.pdf',
    type: FileType.custom,
    allowedExtensions: ['pdf'],
  );
  if (path != null) {
    File(path).writeAsBytesSync(bytes);
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Gespeichert: $path')));
    }
  }
}

Future<void> _sharePdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  await Printing.sharePdf(bytes: bytes, filename: 'dokument.pdf');
}

Future<void> _printPdf(WidgetRef ref, BuildContext context) async {
  final bytes = await ref.read(pdfBytesProvider.future);
  if (bytes == null) return;
  await Printing.layoutPdf(onLayout: (_) async => bytes);
}

Future<void> _importTemplate(WidgetRef ref, BuildContext context) async {
  final controller = TextEditingController();
  final url = await showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Template importieren'),
      content: TextField(
        controller: controller,
        decoration: const InputDecoration(
          labelText: 'URL zur .typ-Datei',
          hintText: 'https://raw.githubusercontent.com/.../template.typ',
          border: OutlineInputBorder(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Abbrechen'),
        ),
        ElevatedButton(
          onPressed: () => Navigator.pop(ctx, controller.text),
          child: const Text('Importieren'),
        ),
      ],
    ),
  );
  controller.dispose();
  if (url == null || url.isEmpty) return;

  try {
    final loader = ref.read(configLoaderProvider);
    await loader.importTemplate(url);
    ref.invalidate(templateListProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Template importiert!')),
      );
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Fehler: $e')),
      );
    }
  }
}

class _TemplateDropdown extends StatelessWidget {
  final List<TemplateInfo> templates;
  final TemplateInfo? selected;
  final ValueChanged<TemplateInfo?> onChanged;

  const _TemplateDropdown({
    required this.templates,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (templates.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 8),
        child: Text('Keine Templates', style: TextStyle(color: Colors.white70)),
      );
    }
    return DropdownButton<TemplateInfo>(
      value: selected,
      hint: const Text('Template', style: TextStyle(color: Colors.white70)),
      dropdownColor: Theme.of(context).colorScheme.surface,
      underline: const SizedBox.shrink(),
      items: templates
          .map((t) => DropdownMenuItem(value: t, child: Text(t.name)))
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _ProfileDropdown extends StatelessWidget {
  final Map<String, Profile> profiles;
  final String? selected;
  final ValueChanged<String?> onChanged;

  const _ProfileDropdown({
    required this.profiles,
    required this.selected,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (profiles.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 8),
        child: Text('Keine Profile', style: TextStyle(color: Colors.white70)),
      );
    }
    return DropdownButton<String>(
      value: selected,
      hint: const Text('Profil', style: TextStyle(color: Colors.white70)),
      dropdownColor: Theme.of(context).colorScheme.surface,
      underline: const SizedBox.shrink(),
      items: profiles.keys
          .map((k) => DropdownMenuItem(value: k, child: Text(k)))
          .toList(),
      onChanged: onChanged,
    );
  }
}
