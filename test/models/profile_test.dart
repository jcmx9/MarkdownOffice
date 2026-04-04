import 'package:flutter_test/flutter_test.dart';
import 'package:markdownoffice/models/profile.dart';

void main() {
  group('Profile', () {
    test('creates from map with all values as strings', () {
      final map = {
        'sender_name': 'Roland Kreus',
        'sender_street': 'Schillerstrasse 20B',
        'sender_zip': 33609,
        'sender_city': 'Bielefeld',
      };
      final p = Profile.fromMap('default', map);
      expect(p.name, 'default');
      expect(p.values['sender_zip'], '33609');
      expect(p.values.length, 4);
    });

    test('all values are stored as strings', () {
      final p = Profile.fromMap('test', {'number': 12345, 'flag': true});
      expect(p.values['number'], '12345');
      expect(p.values['flag'], 'true');
    });
  });
}
