class Profile {
  final String name;
  final List<String> fieldsOrder;
  final Map<String, String> values;

  const Profile({
    required this.name,
    this.fieldsOrder = const [],
    required this.values,
  });

  factory Profile.fromMap(String name, Map<String, dynamic> map) {
    final orderRaw = map['fields_order'];
    final List<String> order;
    if (orderRaw is List) {
      order = orderRaw.map((e) => e.toString()).toList();
    } else {
      order = [];
    }

    final values = <String, String>{};
    final valuesRaw = map['values'];
    if (valuesRaw is Map) {
      for (final entry in valuesRaw.entries) {
        values[entry.key.toString()] = entry.value.toString();
      }
    } else {
      // Flat format fallback: everything except fields_order is a value
      for (final entry in map.entries) {
        if (entry.key != 'fields_order') {
          values[entry.key.toString()] = entry.value.toString();
        }
      }
    }

    return Profile(name: name, fieldsOrder: order, values: values);
  }
}
