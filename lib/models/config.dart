class AppConfig {
  final String? cloudPath;

  const AppConfig({this.cloudPath});

  factory AppConfig.fromMap(Map<String, dynamic> map) {
    return AppConfig(cloudPath: map['cloud_path']?.toString());
  }
}
