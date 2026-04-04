class InputField {
  final String name;
  final bool required;
  final String? defaultValue;
  final String? label;

  const InputField({
    required this.name,
    required this.required,
    this.defaultValue,
    this.label,
  });

  String get displayLabel => label ?? name;
}
