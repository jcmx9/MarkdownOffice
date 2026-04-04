class Profile {
  final String name;
  final Map<String, String> values;

  const Profile({required this.name, required this.values});

  factory Profile.fromMap(String name, Map<String, dynamic> map) {
    final values = <String, String>{};
    for (final entry in map.entries) {
      values[entry.key] = entry.value.toString();
    }
    return Profile(name: name, values: values);
  }
}
